/* Fasad penyimpanan untuk API.
   - Memilih backend otomatis: Google Drive (bila kredensial siap) atau disk lokal.
   - Menambah cache TTL supaya galeri yang polling tidak membanjiri Drive API.
   - Menulis metadata (event.json / events.json) secara debounce agar hemat kuota.

   Ketika Drive dipakai, metadata acara TIDAK lagi bergantung pada disk Render yang
   ephemeral: `event.json` di folder acara adalah sumber kebenaran, dan `rebuild()`
   mengembalikan daftar acara walau instance baru saja di-restart. */
import crypto from "node:crypto";
import { isDriveReady } from "./drive.js";
import { CACHE_TTL_MS, MAX_PHOTOS_PER_EVENT, META_FLUSH_MS } from "./src/config.js";
import * as driveBackend from "./src/drive-store.js";
import * as localBackend from "./src/local-store.js";
import { StoreError, isStorageUnavailable } from "./src/lib/errors.js";
import { makeEventId, makeUploadKey, slugify, uniqueSlug } from "./src/lib/slug.js";

const backend = isDriveReady() ? driveBackend : localBackend;

export const storageMode = backend.mode;
export const usesDrive = storageMode === "drive";

const PHOTO_LIMIT = MAX_PHOTOS_PER_EVENT;
const PHOTO_FETCH_LIMIT = MAX_PHOTOS_PER_EVENT + 500;

const cache = {
  events: null,
  eventsAt: 0,
  photos: new Map(), /* slug -> { list, at } */
  stale: false,
};

const flushTimers = new Map();
let booted = false;

export function resetCache() {
  cache.events = null;
  cache.eventsAt = 0;
  cache.photos.clear();
  cache.stale = false;
}

/* ── Bentuk data yang dikirim ke klien ──────────────────────────────── */

/** Metadata publik acara. `uploadKey` hanya disertakan bila diminta (admin). */
export function presentEvent(meta, withKey = false) {
  if (!meta) return null;
  const event = {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    type: meta.type || "lainnya",
    preset: meta.preset || "funsaver",
    revealAt: meta.revealAt || null,
    createdAt: meta.createdAt,
    count: Number(meta.count || 0),
    legacy: Boolean(meta.legacy),
  };
  if (withKey) event.uploadKey = meta.uploadKey;
  return event;
}

function secretsEqual(a, b) {
  const ba = crypto.createHash("sha256").update(String(a)).digest();
  const bb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ba, bb);
}

/** Kunci tamu cocok dengan metadata acara? (perbandingan waktu-tetap) */
export function keyMatches(meta, key) {
  if (!meta || !meta.uploadKey || !key) return false;
  return secretsEqual(meta.uploadKey, String(key));
}

/* ── Baca acara ─────────────────────────────────────────────────────── */

async function loadEvents({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.events && now - cache.eventsAt < CACHE_TTL_MS) {
    return { events: cache.events, stale: cache.stale };
  }
  try {
    const events = await backend.listEvents();
    cache.events = events;
    cache.eventsAt = now;
    cache.stale = false;
    booted = true;
    return { events, stale: false };
  } catch (err) {
    if (cache.events && isStorageUnavailable(err)) {
      console.warn("[store] pakai cache acara lama: " + err.message);
      cache.stale = true;
      return { events: cache.events, stale: true };
    }
    throw err;
  }
}

function countFor(slug, fallback = 0) {
  const cached = cache.photos.get(slug);
  return cached ? cached.list.length : Number(fallback || 0);
}

export async function getEvents(options = {}) {
  const { events, stale } = await loadEvents(options);
  const withKeys = options.withKeys === true;
  return {
    events: events.map((meta) => ({
      ...presentEvent(meta, withKeys),
      count: countFor(meta.slug, meta.count),
    })),
    stale,
  };
}

export async function getEvent(slug, withKey = false) {
  const { events, stale } = await loadEvents();
  const meta = events.find((e) => e.slug === slug);
  if (meta) {
    return { event: { ...presentEvent(meta, withKey), count: countFor(slug, meta.count) }, stale };
  }
  /* Cache mungkin belum memuat acara ini → cek langsung ke backend. */
  const direct = await backend.getEventMeta(slug);
  if (!direct) return { event: null, stale };
  return { event: { ...presentEvent(direct, withKey), count: countFor(slug, direct.count) }, stale };
}

export async function getEventMetaRaw(slug) {
  const { events } = await loadEvents();
  const meta = events.find((e) => e.slug === slug);
  if (meta) return meta;
  return backend.getEventMeta(slug);
}

/* ── Tulis acara ────────────────────────────────────────────────────── */

export async function createEvent({ name, type, preset, revealAt }) {
  const { events } = await loadEvents({ force: true });
  const taken = new Set((events || []).map((e) => e.slug));
  const slug = uniqueSlug(slugify(name), taken);
  const meta = {
    id: makeEventId(),
    slug,
    name: String(name).trim(),
    type: type || "lainnya",
    preset: preset || "funsaver",
    revealAt: revealAt || null,
    createdAt: new Date().toISOString(),
    uploadKey: makeUploadKey(),
    count: 0,
    countUpdatedAt: null,
  };
  let saved;
  try {
    saved = await backend.writeEventMeta(slug, meta);
  } catch (err) {
    throw new StoreError("gagal membuat acara: " + err.message, err.status || 502, "create-failed");
  }
  cache.events = [...(cache.events || []), saved];
  cache.eventsAt = Date.now();
  cache.photos.set(slug, { list: [], at: Date.now() });
  return presentEvent(saved, true);
}

export async function updateEvent(slug, patch = {}) {
  const meta = await getEventMetaRaw(slug);
  if (!meta) return null;
  const updated = {
    ...meta,
    name: patch.name != null ? String(patch.name).trim() : meta.name,
    type: patch.type != null ? patch.type : meta.type,
    preset: patch.preset != null ? patch.preset : meta.preset,
    revealAt: patch.revealAt !== undefined ? patch.revealAt : meta.revealAt,
    uploadKey: patch.rotateUploadKey ? makeUploadKey() : meta.uploadKey,
    count: countFor(slug, meta.count),
    countUpdatedAt: new Date().toISOString(),
  };
  const saved = await backend.writeEventMeta(slug, updated);
  cache.events = (cache.events || []).map((e) => (e.slug === slug ? saved : e));
  return presentEvent(saved, true);
}

export async function deleteEvent(slug) {
  const removed = await backend.deleteEvent(slug);
  if (!removed) return false;
  cache.events = (cache.events || []).filter((e) => e.slug !== slug);
  cache.photos.delete(slug);
  return true;
}

/* ── Foto ───────────────────────────────────────────────────────────── */

export async function getPhotos(slug, options = {}) {
  const since = options.since || null;
  const cached = cache.photos.get(slug);
  const now = Date.now();
  const isFresh = cached && now - cached.at < CACHE_TTL_MS;

  if (isFresh && !options.force) {
    const list = since ? cached.list.filter((p) => p.createdAt > since) : cached.list;
    return { photos: list, count: cached.list.length, stale: false, fromCache: true };
  }

  try {
    const list = await backend.listPhotos(slug, { limit: PHOTO_FETCH_LIMIT });
    cache.photos.set(slug, { list, at: now });
    cache.stale = false;
    syncCount(slug, list.length);
    const sliced = since ? list.filter((p) => p.createdAt > since) : list;
    return { photos: sliced, count: list.length, stale: false, fromCache: false };
  } catch (err) {
    if (cached && isStorageUnavailable(err)) {
      console.warn("[store] pakai cache foto lama untuk " + slug + ": " + err.message);
      const list = since ? cached.list.filter((p) => p.createdAt > since) : cached.list;
      cache.stale = true;
      return { photos: list, count: cached.list.length, stale: true, fromCache: true };
    }
    throw err;
  }
}

export async function addPhoto({ slug, buffer, mime }) {
  const before = cache.photos.get(slug);
  let known = before ? before.list.length : null;
  if (known == null) {
    const current = await getPhotos(slug, { force: true });
    known = current.count;
  }
  if (known >= PHOTO_LIMIT) {
    throw new StoreError("album sudah penuh (" + PHOTO_LIMIT + " foto)", 409, "photo-limit");
  }
  const photo = await backend.addPhoto({ slug, buffer, mime });
  const cached = cache.photos.get(slug);
  if (cached) cached.list = [...cached.list, photo].sort(byCreatedAt);
  else cache.photos.set(slug, { list: [photo], at: Date.now() });
  syncCount(slug, cache.photos.get(slug).list.length);
  return photo;
}

export async function deletePhoto(slug, photoId) {
  const cached = cache.photos.get(slug);
  let photo = cached ? cached.list.find((p) => p.id === photoId) : null;
  if (!photo) {
    const list = await backend.listPhotos(slug, { limit: PHOTO_FETCH_LIMIT });
    cache.photos.set(slug, { list, at: Date.now() });
    photo = list.find((p) => p.id === photoId) || null;
  }
  if (!photo) return null;
  const removed = await backend.deletePhoto({ ...photo, eventSlug: slug });
  if (!removed) return null;
  const entry = cache.photos.get(slug);
  if (entry) entry.list = entry.list.filter((p) => p.id !== photoId);
  syncCount(slug, entry ? entry.list.length : Number(photo.count || 0));
  return photo;
}

function byCreatedAt(a, b) {
  return String(a.createdAt).localeCompare(String(b.createdAt));
}

/* ── Sinkronisasi jumlah foto ke metadata (hemat kuota: debounce) ───── */

function syncCount(slug, count) {
  const events = cache.events || [];
  const meta = events.find((e) => e.slug === slug);
  if (!meta) return;
  if (Number(meta.count) === Number(count)) return;
  meta.count = count;
  scheduleMetaFlush(slug);
}

function scheduleMetaFlush(slug) {
  const existing = flushTimers.get(slug);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    flushTimers.delete(slug);
    flushMeta(slug).catch((err) => console.warn("[store] flush metadata gagal: " + err.message));
  }, META_FLUSH_MS);
  if (typeof timer.unref === "function") timer.unref();
  flushTimers.set(slug, timer);
}

async function flushMeta(slug) {
  const meta = (cache.events || []).find((e) => e.slug === slug);
  if (!meta) return false;
  const count = countFor(slug, meta.count);
  const saved = await backend.writeEventMeta(slug, { ...meta, count, countUpdatedAt: new Date().toISOString() });
  cache.events = (cache.events || []).map((e) => (e.slug === slug ? saved : e));
  return true;
}

/** Tulis semua metadata yang tertunda (dipakai saat shutdown & test). */
export async function flushAll() {
  const slugs = [...flushTimers.keys()];
  for (const slug of slugs) {
    const timer = flushTimers.get(slug);
    if (timer) clearTimeout(timer);
    flushTimers.delete(slug);
    await flushMeta(slug).catch(() => {});
  }
  return slugs.length;
}

/* ── Sinkronisasi awal & statistik ──────────────────────────────────── */

/** Bangun ulang index dari backend (Drive). Dipanggil saat boot. */
export async function rebuild() {
  resetCache();
  const { events, stale } = await loadEvents({ force: true });
  const details = [];
  for (const meta of events) {
    try {
      const list = await backend.listPhotos(meta.slug, { limit: PHOTO_FETCH_LIMIT });
      cache.photos.set(meta.slug, { list, at: Date.now() });
      details.push({ slug: meta.slug, photos: list.length });
    } catch (err) {
      details.push({ slug: meta.slug, photos: null, error: err.message });
    }
  }
  return { mode: storageMode, events: events.length, details, stale };
}

export async function stats() {
  const photos = [...cache.photos.values()].reduce((sum, entry) => sum + entry.list.length, 0);
  return {
    mode: storageMode,
    booted,
    events: cache.events ? cache.events.length : 0,
    photos,
    cacheAgeMs: cache.events ? Date.now() - cache.eventsAt : null,
    stale: cache.stale,
    limits: { maxPhotosPerEvent: PHOTO_LIMIT },
  };
}

export async function health() {
  const backendHealth = await backend
    .health()
    .catch((err) => ({ mode: storageMode, ready: false, error: err.message }));
  return { ...backendHealth, ...(await stats()) };
}

