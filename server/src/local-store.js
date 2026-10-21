/* Backend penyimpanan "local": JSON + folder uploads di disk.
   Dipakai otomatis saat kredensial Google Drive belum ada (dev/tanpa Drive).
   PENTING: pada Render free, disk bersifat ephemeral — data di sini hilang
   setiap restart/deploy. Karena itu mode ini HANYA untuk pengembangan. */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, MAX_PHOTOS_PER_EVENT, PUBLIC_BASE_URL, UPLOAD_DIR } from "./config.js";
import { photoFileName } from "../drive.js";
import { StoreError } from "./lib/errors.js";

export const mode = "local";

const EVENTS_FILE = path.join(DATA_DIR, "events.json");
const PHOTOS_FILE = path.join(DATA_DIR, "photos.json");
const MAX_PHOTOS = Math.max(MAX_PHOTOS_PER_EVENT + 200, 2000);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function publicUrl(name) {
  return PUBLIC_BASE_URL + "/uploads/" + name;
}

export async function listEvents() {
  return readJson(EVENTS_FILE, []);
}

export async function getEventMeta(slug) {
  return readJson(EVENTS_FILE, []).find((e) => e.slug === slug) || null;
}

/** Hanya field metadata acara yang disimpan (id Drive/folder tidak ikut ditulis). */
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

export async function writeEventMeta(slug, meta) {
  const events = readJson(EVENTS_FILE, []);
  const index = events.findIndex((e) => e.slug === slug);
  const record = toPersisted({ ...meta, slug });
  if (index >= 0) events[index] = record;
  else events.push(record);
  writeJson(EVENTS_FILE, events);
  return record;
}

export async function listPhotos(slug, options = {}) {
  const since = options.since || null;
  const limit = Math.min(Number(options.limit) || MAX_PHOTOS, MAX_PHOTOS);
  const photos = readJson(PHOTOS_FILE, [])
    .filter((p) => p.eventSlug === slug)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const filtered = since ? photos.filter((p) => p.createdAt > since) : photos;
  return filtered.slice(0, limit);
}

export async function addPhoto({ slug, buffer, mime }) {
  const existing = await listPhotos(slug, { limit: MAX_PHOTOS });
  if (existing.length >= MAX_PHOTOS_PER_EVENT) {
    throw new StoreError("batas foto acara ini sudah tercapai", 409, "photo-limit");
  }
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const name = photoFileName(ext);
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  const photo = {
    id: name,
    eventSlug: slug,
    name,
    url: publicUrl(name),
    thumb: publicUrl(name),
    source: "local",
    createdAt: new Date().toISOString(),
    size: buffer.length,
  };
  const all = readJson(PHOTOS_FILE, []);
  all.push(photo);
  writeJson(PHOTOS_FILE, all);
  return photo;
}

export async function deletePhoto(photo) {
  const all = readJson(PHOTOS_FILE, []);
  const kept = all.filter((p) => !(p.id === photo.id && p.eventSlug === photo.eventSlug));
  if (kept.length === all.length) return false;
  writeJson(PHOTOS_FILE, kept);
  const file = path.join(UPLOAD_DIR, path.basename(String(photo.id)));
  try {
    fs.unlinkSync(file);
  } catch {
    /* file mungkin sudah tidak ada — abaikan */
  }
  return true;
}

export async function deleteEvent(slug) {
  const events = readJson(EVENTS_FILE, []);
  const kept = events.filter((e) => e.slug !== slug);
  if (kept.length === events.length) return false;
  writeJson(EVENTS_FILE, kept);
  for (const photo of await listPhotos(slug, { limit: MAX_PHOTOS })) {
    await deletePhoto(photo).catch(() => {});
  }
  return true;
}

export async function health() {
  return { mode, ready: true, rootFolderName: "(lokal)", rootFolderId: null, dataDir: DATA_DIR, uploadDir: UPLOAD_DIR };
}
