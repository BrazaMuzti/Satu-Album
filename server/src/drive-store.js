/* Backend penyimpanan "drive": Google Drive sebagai SUMBER KEBENARAN.
   Layout di Drive (semua dibuat app ini sendiri — syarat scope `drive.file`):

     <ROOT_FOLDER_NAME>/
       event-<slug>/
         event.json              ← metadata acara (nama, preset, revealAt, uploadKey, count)
         photo-<timestamp>-<n>.jpg

   Karena metadata ikut tersimpan di Drive (bukan hanya disk Render yang ephemeral),
   daftar acara & foto tetap utuh setelah instance restart/spin-down. */
import {
  FOLDER_MIME,
  Q,
  driveInfo,
  ensureEventFolder,
  getClient,
  getRootFolderId,
  imageUrl,
  photoFileName,
  shareAnyone,
} from "../drive.js";
import { StoreError } from "./lib/errors.js";
import { makeUploadKey } from "./lib/slug.js";

export const mode = "drive";

export const META_FILE = "event.json";
const FOLDER_PREFIX = "event-";
const MAX_FOLDERS = 500;
const MAX_PHOTOS = 5000;

function client() {
  const c = getClient();
  if (!c) throw new StoreError("Google Drive belum dikonfigurasi", 503, "drive-not-configured");
  return c;
}

export function folderNameFor(slug) {
  return FOLDER_PREFIX + slug;
}

export function slugFromFolderName(name) {
  return String(name || "").replace(new RegExp("^" + FOLDER_PREFIX), "");
}

function driveError(err, context) {
  const status = err?.status || err?.code || err?.response?.status;
  const message = context + ": " + (err?.message || "gagal mengakses Drive");
  const httpStatus = typeof status === "number" && status >= 400 && status < 600 ? status : 502;
  return new StoreError(message, httpStatus, "drive-error");
}

/* ── Metadata event.json ─────────────────────────────────────────────── */

/** Hanya field yang memang bagian dari metadata acara (kolom runtime dibuang). */
function toPersisted(meta) {
  return {
    version: 1,
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    type: meta.type || "lainnya",
    preset: meta.preset || "funsaver",
    revealAt: meta.revealAt || null,
    createdAt: meta.createdAt,
    uploadKey: meta.uploadKey,
    count: Number(meta.count || 0),
    countUpdatedAt: meta.countUpdatedAt || null,
    legacy: meta.legacy ? true : undefined,
  };
}

function normalizeMeta(raw, folder) {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: raw.id || "evt_" + Math.random().toString(36).slice(2, 10),
    slug: raw.slug,
    name: raw.name || raw.slug,
    type: raw.type || "lainnya",
    preset: raw.preset || "funsaver",
    revealAt: raw.revealAt || null,
    createdAt: raw.createdAt || folder?.createdTime || now,
    uploadKey: raw.uploadKey || "",
    count: Number(raw.count || 0),
    countUpdatedAt: raw.countUpdatedAt || null,
    legacy: Boolean(raw.legacy),
    folderId: folder?.id || null,
    metaFileId: raw.metaFileId || null,
  };
}

async function findChild(drive, parentId, name) {
  const res = await drive.files.list({
    q: ["name=" + Q + name + Q, "trashed=false", Q + parentId + Q + " in parents"].join(" and "),
    fields: "files(id,name,createdTime,modifiedTime)",
    spaces: "drive",
    pageSize: 1,
  });
  return res.data.files?.[0] || null;
}

async function readMetaFromFolder(drive, folder) {
  const slug = slugFromFolderName(folder.name);
  const file = await findChild(drive, folder.id, META_FILE);
  if (!file) {
    /* Folder dari versi lama (tanpa event.json): metadata disintesis supaya album
       tetap tampil, lalu ditulis agar tidak diulang setiap kali sync. */
    const meta = normalizeMeta({ slug, name: slug, legacy: true }, folder);
    meta.uploadKey = makeUploadKey();
    try {
      return await writeEventMeta(slug, meta);
    } catch (err) {
      console.warn("[store] gagal menulis event.json untuk " + slug + ": " + err.message);
      return meta;
    }
  }
  const res = await drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "text" });
  const raw = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  const meta = normalizeMeta({ ...raw, metaFileId: file.id }, folder);
  if (!meta.uploadKey) {
    meta.uploadKey = makeUploadKey();
    await writeEventMeta(slug, meta).catch(() => {});
  }
  return meta;
}

/** Daftar acara = daftar folder "event-*" di folder root + isi event.json. */
export async function listEvents() {
  const drive = client();
  const parentId = await getRootFolderId();
  const q = ["mimeType=" + Q + FOLDER_MIME + Q, "trashed=false"];
  if (parentId) q.push(Q + parentId + Q + " in parents");

  const folders = [];
  let pageToken;
  try {
    do {
      const res = await drive.files.list({
        q: q.join(" and "),
        fields: "nextPageToken,files(id,name,createdTime)",
        spaces: "drive",
        pageSize: 200,
        pageToken,
        orderBy: "createdTime",
      });
      folders.push(...(res.data.files || []));
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken && folders.length < MAX_FOLDERS);
  } catch (err) {
    throw driveError(err, "gagal membaca folder acara");
  }

  const eventFolders = folders.filter((f) => String(f.name || "").startsWith(FOLDER_PREFIX));
  const metas = await Promise.all(
    eventFolders.map((folder) =>
      readMetaFromFolder(drive, folder).catch((err) => {
        console.warn("[store] folder " + folder.name + " dilewati: " + err.message);
        return null;
      })
    )
  );
  return metas.filter(Boolean);
}

export async function getEventMeta(slug) {
  const drive = client();
  const folderId = await findEventFolderId(slug);
  if (!folderId) return null;
  return readMetaFromFolder(drive, { id: folderId, name: folderNameFor(slug) });
}

export async function writeEventMeta(slug, meta) {
  const drive = client();
  const folderId = await ensureEventFolder(drive, slug);
  const body = JSON.stringify(toPersisted({ ...meta, slug }), null, 2);
  const existing = await findChild(drive, folderId, META_FILE);
  try {
    if (existing) {
      await drive.files.update({
        fileId: existing.id,
        media: { mimeType: "application/json", body },
        fields: "id,modifiedTime",
      });
      return { ...meta, slug, folderId, metaFileId: existing.id };
    }
    const created = await drive.files.create({
      requestBody: { name: META_FILE, parents: [folderId], mimeType: "application/json" },
      media: { mimeType: "application/json", body },
      fields: "id",
    });
    return { ...meta, slug, folderId, metaFileId: created.data.id };
  } catch (err) {
    throw driveError(err, "gagal menyimpan event.json");
  }
}

/* ── Foto ────────────────────────────────────────────────────────────── */

export async function findEventFolderId(slug) {
  const drive = client();
  const parentId = await getRootFolderId();
  const q = ["name=" + Q + folderNameFor(slug) + Q, "mimeType=" + Q + FOLDER_MIME + Q, "trashed=false"];
  if (parentId) q.push(Q + parentId + Q + " in parents");
  const res = await drive.files.list({ q: q.join(" and "), fields: "files(id,name)", spaces: "drive", pageSize: 1 });
  return res.data.files?.[0]?.id || null;
}

function toPhoto(slug, file) {
  const info = driveInfo();
  return {
    id: file.id,
    eventSlug: slug,
    name: file.name || "",
    url: imageUrl(file.id, info.imageWidth),
    thumb: imageUrl(file.id, info.thumbWidth),
    source: "drive",
    createdAt: file.createdTime || new Date().toISOString(),
    size: file.size ? Number(file.size) : null,
  };
}

export async function listPhotos(slug, options = {}) {
  const since = options.since || null;
  const limit = Math.min(Number(options.limit) || MAX_PHOTOS, MAX_PHOTOS);
  const drive = client();
  const folderId = await findEventFolderId(slug);
  if (!folderId) return [];

  const photos = [];
  let pageToken;
  try {
    do {
      const res = await drive.files.list({
        q: [Q + folderId + Q + " in parents", "trashed=false", "mimeType contains " + Q + "image/" + Q].join(" and "),
        fields: "nextPageToken,files(id,name,createdTime,size,mimeType)",
        spaces: "drive",
        pageSize: 1000,
        pageToken,
        orderBy: "createdTime",
      });
      for (const file of res.data.files || []) photos.push(toPhoto(slug, file));
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken && photos.length < limit);
  } catch (err) {
    throw driveError(err, "gagal membaca daftar foto");
  }

  const filtered = since ? photos.filter((p) => p.createdAt > since) : photos;
  return filtered.slice(0, limit);
}

export async function addPhoto({ slug, buffer, mime }) {
  const drive = client();
  const folderId = await ensureEventFolder(drive, slug);
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const name = photoFileName(ext);
  try {
    const res = await drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType: mime, body: buffer },
      fields: "id,name,createdTime,size",
    });
    await shareAnyone(drive, res.data.id, name);
    return toPhoto(slug, res.data);
  } catch (err) {
    throw driveError(err, "gagal mengunggah foto");
  }
}

export async function deletePhoto(photo) {
  const drive = client();
  const folderId = photo.eventSlug ? await findEventFolderId(photo.eventSlug) : null;
  try {
    const res = await drive.files.get({ fileId: photo.id, fields: "id,name,parents,trashed" });
    const parents = res.data.parents || [];
    if (folderId && parents.length > 0 && !parents.includes(folderId)) {
      throw new StoreError("foto bukan milik acara ini", 403, "not-in-event");
    }
    await drive.files.delete({ fileId: photo.id });
  } catch (err) {
    if (err instanceof StoreError) throw err;
    if (err?.status === 404 || err?.code === 404) return false;
    throw driveError(err, "gagal menghapus foto");
  }
  return true;
}

export async function deleteEvent(slug) {
  const drive = client();
  const folderId = await findEventFolderId(slug);
  if (!folderId) return false;
  try {
    await drive.files.update({ fileId: folderId, requestBody: { trashed: true }, fields: "id" });
  } catch (err) {
    throw driveError(err, "gagal menghapus acara");
  }
  return true;
}

export async function health() {
  const info = driveInfo();
  return { mode, ready: info.ready, rootFolderName: info.rootFolderName, rootFolderId: info.rootFolderId };
}
