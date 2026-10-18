/* Google Drive upload via Service Account. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let driveClient = null;
const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "";

function loadCredentials() {
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "credentials/google-service-account.json";
  const abs = path.join(__dirname, file);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, "utf-8")); } catch { return null; }
}

function getClient() {
  if (driveClient) return driveClient;
  const creds = loadCredentials();
  if (!creds) return null;
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/drive.file"] });
  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
}

export function isDriveReady() { return Boolean(getClient() && rootFolderId); }

const Q = String.fromCharCode(39);

async function ensureEventFolder(drive, slug) {
  const qName = "name=" + Q + "event-" + slug + Q + " and mimeType=" + Q + "application/vnd.google-apps.folder" + Q + " and trashed=false";
  const search = await drive.files.list({ q: qName, fields: "files(id,name)", spaces: "drive" });
  const found = search.data.files?.[0];
  if (found) return found.id;
  const created = await drive.files.create({
    requestBody: { name: "event-" + slug, mimeType: "application/vnd.google-apps.folder", parents: rootFolderId ? [rootFolderId] : [] },
    fields: "id",
  });
  const id = created.data.id;
  await drive.permissions.create({ fileId: id, requestBody: { role: "reader", type: "anyone" } });
  return id;
}

export async function uploadPhotoToDrive(buffer, mimetype, event) {
  const drive = getClient();
  if (!drive || !rootFolderId) return null;
  const folderId = await ensureEventFolder(drive, event.slug);
  const fileName = "photo-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".jpg";
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType: mimetype || "image/jpeg", body: buffer },
    fields: "id,webContentLink,thumbnailLink",
  });
  await drive.permissions.create({ fileId: res.data.id, requestBody: { role: "reader", type: "anyone" } });
  const webContentLink = "https://drive.google.com/uc?export=view&id=" + res.data.id;
  return { driveId: res.data.id, webContentLink, thumbnail: res.data.thumbnailLink || webContentLink, name: fileName };
}
