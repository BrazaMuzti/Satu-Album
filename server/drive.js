/* Google Drive upload.
   Dua mode autentikasi (dipilih otomatis dari env):

     1. OAuth2 akun Google pribadi (UTAMA) — env GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.
        File masuk ke kuota Drive akun Anda sendiri. Buat refresh token dengan:
          node scripts/get-google-refresh-token.js

     2. Service account (LEGACY) — env GOOGLE_SERVICE_ACCOUNT_FILE.
        Service account punya kuota storage 0 byte, jadi upload ke My Drive
        umumnya gagal (storageQuotaExceeded). Hanya berguna untuk Shared Drive.

   Scope `drive.file` (non-sensitive, tanpa proses verifikasi OAuth):
   app hanya dapat melihat/menulis file yang DIBUATNYA SENDIRI. Karena itu folder
   root dibuat otomatis oleh app (GOOGLE_DRIVE_ROOT_FOLDER_ID hanya dipakai bila
   folder itu memang dibuat oleh app ini). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const FOLDER_MIME = "application/vnd.google-apps.folder";
const Q = String.fromCharCode(39); /* apostrof, agar query Drive rapi tanpa escape */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || "";
const SERVICE_ACCOUNT_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "credentials/google-service-account.json";
const ROOT_FOLDER_NAME = process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME || "Satu-Album";
const ROOT_FOLDER_ID_ENV = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "";
/* Ukuran gambar (px, sisi terpanjang) yang diminta dari endpoint thumbnail Drive. */
const IMAGE_WIDTH = Number(process.env.GOOGLE_DRIVE_IMAGE_WIDTH || 1600);
const THUMB_WIDTH = Number(process.env.GOOGLE_DRIVE_THUMB_WIDTH || 400);

let driveClient = null;
let rootFolderId = "";
let rootFolderPromise = null;
let serviceAccountLoaded = false;
let serviceAccountCreds = null;

function hasOAuth() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}

function loadServiceAccount() {
  if (serviceAccountLoaded) return serviceAccountCreds;
  serviceAccountLoaded = true;
  const abs = path.isAbsolute(SERVICE_ACCOUNT_FILE) ? SERVICE_ACCOUNT_FILE : path.join(__dirname, SERVICE_ACCOUNT_FILE);
  if (!fs.existsSync(abs)) return null;
  try { serviceAccountCreds = JSON.parse(fs.readFileSync(abs, "utf-8")); } catch { serviceAccountCreds = null; }
  return serviceAccountCreds;
}

export function driveAuthMode() {
  if (hasOAuth()) return "oauth";
  if (loadServiceAccount()) return "service-account";
  return "none";
}

export function isDriveReady() { return driveAuthMode() !== "none"; }

export function driveInfo() {
  const mode = driveAuthMode();
  return {
    ready: mode !== "none",
    mode,
    rootFolderName: ROOT_FOLDER_NAME,
    rootFolderId: rootFolderId || ROOT_FOLDER_ID_ENV || null,
    imageWidth: IMAGE_WIDTH,
    thumbWidth: THUMB_WIDTH,
  };
}

function getClient() {
  if (driveClient) return driveClient;
  const mode = driveAuthMode();
  if (mode === "oauth") {
    const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    auth.setCredentials({ refresh_token: REFRESH_TOKEN });
    driveClient = google.drive({ version: "v3", auth });
  } else if (mode === "service-account") {
    const auth = new google.auth.GoogleAuth({ credentials: loadServiceAccount(), scopes: SCOPES });
    driveClient = google.drive({ version: "v3", auth });
  } else {
    return null;
  }
  return driveClient;
}

/* URL gambar stabil untuk file Drive yang sudah dibagikan "anyone with link".
   (thumbnailLink dari API bersifat sementara, jadi tidak disimpan.) */
function imageUrl(fileId, width) {
  return "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w" + width;
}

async function canAccessFolder(drive, id) {
  try {
    const res = await drive.files.get({ fileId: id, fields: "id,trashed" });
    return Boolean(res.data && !res.data.trashed);
  } catch {
    return false;
  }
}

async function findFolderByName(drive, name, parentId) {
  const parts = ["name=" + Q + name + Q, "mimeType=" + Q + FOLDER_MIME + Q, "trashed=false"];
  if (parentId) parts.push(Q + parentId + Q + " in parents");
  const res = await drive.files.list({ q: parts.join(" and "), fields: "files(id,name)", spaces: "drive", pageSize: 10 });
  const found = res.data.files?.[0];
  return found ? found.id : null;
}

async function ensureRootFolder(drive) {
  if (ROOT_FOLDER_ID_ENV) {
    if (await canAccessFolder(drive, ROOT_FOLDER_ID_ENV)) return ROOT_FOLDER_ID_ENV;
    console.warn("[drive] GOOGLE_DRIVE_ROOT_FOLDER_ID tidak bisa diakses. Folder yang dibuat manual di");
    console.warn("[drive] Drive tidak terlihat oleh scope drive.file. Otomatis pakai folder \"" + ROOT_FOLDER_NAME + "\".");
  }
  const existing = await findFolderByName(drive, ROOT_FOLDER_NAME, null);
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: { name: ROOT_FOLDER_NAME, mimeType: FOLDER_MIME },
    fields: "id",
  });
  console.log("[drive] folder root baru dibuat: " + ROOT_FOLDER_NAME + " (" + created.data.id + ")");
  return created.data.id;
}

/* ID folder root, dibuat otomatis bila belum ada (di-cache sekali per proses). */
export async function getRootFolderId() {
  const drive = getClient();
  if (!drive) return "";
  if (rootFolderId) return rootFolderId;
  if (!rootFolderPromise) {
    rootFolderPromise = ensureRootFolder(drive)
      .then((id) => { rootFolderId = id; return id; })
      .catch((err) => { rootFolderPromise = null; throw err; });
  }
  return rootFolderPromise;
}

async function ensureEventFolder(drive, slug) {
  const parentId = await getRootFolderId();
  const name = "event-" + slug;
  const existing = await findFolderByName(drive, name, parentId);
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : [] },
    fields: "id",
  });
  const id = created.data.id;
  try {
    await drive.permissions.create({ fileId: id, requestBody: { role: "reader", type: "anyone" } });
  } catch (err) {
    console.warn("[drive] folder " + name + " tidak bisa dibagikan publik: " + err.message);
  }
  return id;
}

export async function uploadPhotoToDrive(buffer, mimetype, event) {
  const drive = getClient();
  if (!drive) return null;
  const folderId = await ensureEventFolder(drive, event.slug);
  const fileName = "photo-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".jpg";
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType: mimetype || "image/jpeg", body: buffer },
    fields: "id,name",
  });
  const fileId = res.data.id;
  try {
    await drive.permissions.create({ fileId, requestBody: { role: "reader", type: "anyone" } });
  } catch (err) {
    console.warn("[drive] " + fileName + " tidak bisa dibagikan publik: " + err.message);
  }
  return {
    driveId: fileId,
    url: imageUrl(fileId, IMAGE_WIDTH),
    thumb: imageUrl(fileId, THUMB_WIDTH),
    /* webContentLink/thumbnail dipertahankan untuk kompatibilitas pemanggil lama. */
    webContentLink: imageUrl(fileId, IMAGE_WIDTH),
    thumbnail: imageUrl(fileId, THUMB_WIDTH),
    viewLink: "https://drive.google.com/file/d/" + fileId + "/view",
    name: fileName,
  };
}
