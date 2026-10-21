/* satualbum backend: Express + Google Drive.
   Drive adalah SUMBER KEBENARAN: metadata acara (event.json) dan foto tersimpan di
   Drive, sehingga galeri tetap hidup setelah instance Render restart/spin-down.

   Model otorisasi (tanpa sistem akun):
     - Panitia : header `x-admin-token: <ADMIN_TOKEN>` → buat/ubah/hapus acara, hapus foto apa pun.
     - Tamu    : `?k=<uploadKey>` (ada di link yang dibagikan) → lihat & unggah foto.
     - Foto tamu hanya bisa dihapus sendiri selama UNDO_WINDOW_MS (fitur Undo). */
import express from "express";
import cors from "cors";
import {
  ALLOWED_ORIGINS,
  ALLOWED_UPLOAD_MIME,
  HOST,
  MAX_PHOTOS_PER_EVENT,
  MAX_UPLOAD_BYTES,
  PORT,
  PUBLIC_BASE_URL,
  RATE_LIMITS,
  UNDO_WINDOW_MS,
  UPLOAD_DIR,
  VERSION,
  configWarnings,
} from "./src/config.js";
import { driveInfo } from "./drive.js";
import * as store from "./store.js";
import { guestKey, isAdmin, requireAdmin } from "./src/middleware/admin.js";
import { validateImage } from "./src/lib/image.js";
import { StoreError } from "./src/lib/errors.js";
import { clientIp, createRateLimiter, rateLimit } from "./src/lib/ratelimit.js";

const app = express();
/* Di belakang proxy Render: percayai X-Forwarded-For supaya rate limit per IP benar. */
app.set("trust proxy", true);
app.disable("x-powered-by");

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWED_ORIGINS.length === 0) return cb(null, true);
      return cb(null, ALLOWED_ORIGINS.includes(origin));
    },
    allowedHeaders: ["content-type", "x-admin-token", "x-upload-key", "x-image-name"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  })
);
app.use(express.json({ limit: "64kb" }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "1d", fallthrough: true }));

const createLimiter = createRateLimiter(RATE_LIMITS.create);
const uploadLimiter = createRateLimiter(RATE_LIMITS.upload);

/* ── Helper ─────────────────────────────────────────────────────────── */

function fail(res, err) {
  const status = err instanceof StoreError || typeof err.status === "number" ? err.status : 500;
  if (status >= 500) console.error("[api] " + (err.stack || err.message));
  res.status(status).json({ error: err.message || "internal error", code: err.code || undefined });
}

/** Bungkus handler async supaya error-nya ditangani fail(). */
function route(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => fail(res, err));
  };
}

/** Tamu wajib membawa kunci yang cocok dengan metadata acara (atau token admin). */
const requireGuest = route(async (req, res, next) => {
  const meta = await store.getEventMetaRaw(req.params.slug);
  if (!meta) {
    res.status(404).json({ error: "event not found" });
    return;
  }
  if (isAdmin(req) || store.keyMatches(meta, guestKey(req))) {
    req.eventMeta = meta;
    next();
    return;
  }
  res.status(401).json({ error: "link tidak valid atau kunci tamu salah", code: "invalid-key" });
});

/** Jadikan URL foto lokal absolut (klien SPA berada di domain lain). */
function absoluteUploadUrls(photo) {
  if (!PUBLIC_BASE_URL || photo.source !== "local") return photo;
  const abs = (value) => (value.startsWith("http") ? value : PUBLIC_BASE_URL + value);
  return { ...photo, url: abs(photo.url), thumb: abs(photo.thumb) };
}

/* ── Health ─────────────────────────────────────────────────────────── */

app.get(
  "/api/health",
  route(async (req, res) => {
    const info = driveInfo();
    const storage = await store.health();
    res.json({
      ok: true,
      version: VERSION,
      uptimeSec: Math.round(process.uptime()),
      /* storage.mode = "drive" berarti metadata & foto aman dari restart Render. */
      storage,
      drive: {
        ready: info.ready,
        mode: info.mode,
        rootFolderName: info.rootFolderName,
        rootFolderId: info.rootFolderId,
      },
      limits: {
        maxUploadBytes: MAX_UPLOAD_BYTES,
        maxPhotosPerEvent: MAX_PHOTOS_PER_EVENT,
        undoWindowMs: UNDO_WINDOW_MS,
        uploadsPerHour: RATE_LIMITS.upload.max,
      },
    });
  })
);

/* ── Acara ──────────────────────────────────────────────────────────── */

app.post(
  "/api/events",
  rateLimit(createLimiter, clientIp),
  requireAdmin,
  route(async (req, res) => {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (name.length > 120) {
      res.status(400).json({ error: "nama acara maksimal 120 karakter" });
      return;
    }
    const event = await store.createEvent({
      name,
      type: body.type,
      preset: body.preset,
      revealAt: body.revealAt || null,
    });
    res.status(201).json({ event });
  })
);

app.get(
  "/api/events",
  requireAdmin,
  route(async (req, res) => {
    /* withKeys: hanya endpoint admin yang boleh melihat kunci link tamu. */
    const { events, stale } = await store.getEvents({
      force: req.query.refresh === "1",
      withKeys: true,
    });
    res.json({ events, stale });
  })
);

app.get(
  "/api/events/:slug",
  route(async (req, res) => {
    const { event, stale } = await store.getEvent(req.params.slug);
    if (!event) {
      res.status(404).json({ error: "event not found" });
      return;
    }
    /* Kunci tamu hanya dikembalikan bila benar-benar cocok (atau pemanggil admin). */
    const meta = await store.getEventMetaRaw(req.params.slug);
    const authorized = isAdmin(req) || store.keyMatches(meta, guestKey(req));
    res.json({
      event: authorized ? { ...event, uploadKey: meta?.uploadKey } : event,
      authorized,
      stale,
    });
  })
);

app.patch(
  "/api/events/:slug",
  requireAdmin,
  route(async (req, res) => {
    const event = await store.updateEvent(req.params.slug, req.body || {});
    if (!event) {
      res.status(404).json({ error: "event not found" });
      return;
    }
    res.json({ event });
  })
);

app.delete(
  "/api/events/:slug",
  requireAdmin,
  route(async (req, res) => {
    const removed = await store.deleteEvent(req.params.slug);
    if (!removed) {
      res.status(404).json({ error: "event not found" });
      return;
    }
    res.json({ ok: true });
  })
);

/* ── Foto ───────────────────────────────────────────────────────────── */

/* Body foto dikirim sebagai biner mentah (bukan multipart) supaya hemat CPU/RAM
   dan tetap kompatibel dengan Cloudflare Worker bila nanti dimigrasi (Opsi 2). */
const rawPhoto = express.raw({
  type: [...ALLOWED_UPLOAD_MIME, "application/octet-stream"],
  limit: MAX_UPLOAD_BYTES,
});

app.post(
  "/api/events/:slug/photos",
  rateLimit(uploadLimiter, (req) => clientIp(req) + ":" + req.params.slug),
  requireGuest,
  rawPhoto,
  route(async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    const check = validateImage(buffer, ALLOWED_UPLOAD_MIME, req.get("content-type"));
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    const photo = await store.addPhoto({ slug: req.params.slug, buffer, mime: check.mime });
    res.status(201).json({
      photo: absoluteUploadUrls(photo),
      undoWindowMs: UNDO_WINDOW_MS,
      /* Klien memakai serverTime untuk polling `?since=`. */
      serverTime: new Date().toISOString(),
    });
  })
);

app.get(
  "/api/events/:slug/photos",
  requireGuest,
  route(async (req, res) => {
    const since = typeof req.query.since === "string" && req.query.since ? req.query.since : null;
    const result = await store.getPhotos(req.params.slug, { since, force: req.query.refresh === "1" });
    res.json({
      photos: result.photos.map(absoluteUploadUrls),
      count: result.count,
      stale: result.stale,
      fromCache: result.fromCache,
      serverTime: new Date().toISOString(),
    });
  })
);

app.delete(
  "/api/events/:slug/photos/:photoId",
  requireGuest,
  route(async (req, res) => {
    const admin = isAdmin(req);
    if (!admin) {
      /* Tamu hanya boleh membatalkan fotonya sendiri dalam jendela Undo. */
      const list = await store.getPhotos(req.params.slug, { force: true });
      const photo = list.photos.find((p) => p.id === req.params.photoId);
      if (!photo) {
        res.status(404).json({ error: "foto tidak ditemukan" });
        return;
      }
      const age = Date.now() - new Date(photo.createdAt).getTime();
      if (Number.isFinite(age) && age > UNDO_WINDOW_MS) {
        res.status(403).json({ error: "waktu Undo sudah lewat", code: "undo-expired" });
        return;
      }
    }
    const removed = await store.deletePhoto(req.params.slug, req.params.photoId);
    if (!removed) {
      res.status(404).json({ error: "foto tidak ditemukan" });
      return;
    }
    res.json({ ok: true, photo: removed });
  })
);

/* ── 404 & error handler ────────────────────────────────────────────── */

app.use((req, res) => {
  res.status(404).json({ error: "endpoint tidak ada: " + req.method + " " + req.path });
});

app.use((err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    res.status(413).json({
      error: "foto terlalu besar (maks " + Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) + " MB)",
      code: "too-large",
    });
    return;
  }
  if (err && err.status === 415) {
    res.status(415).json({ error: "tipe konten tidak didukung (kirim gambar biner: image/jpeg)" });
    return;
  }
  if (err && err.status === 400 && err.type === "entity.parse.failed") {
    res.status(400).json({ error: "body JSON tidak valid" });
    return;
  }
  console.error("[api] unhandled: " + (err && err.stack ? err.stack : err));
  res.status(500).json({ error: "internal error" });
});

/* ── Boot ───────────────────────────────────────────────────────────── */

const server = app.listen(PORT, HOST, async () => {
  console.log("satualbum api v" + VERSION + " on http://" + HOST + ":" + PORT);
  console.log(
    "penyimpanan: " +
      store.storageMode +
      (store.usesDrive ? " (Google Drive = sumber kebenaran)" : " (disk lokal — HILANG saat restart!)")
  );
  for (const warning of configWarnings(store.storageMode)) console.warn("[config] " + warning);
  const info = driveInfo();
  if (info.ready) {
    console.log("drive: mode " + info.mode + ", root " + (info.rootFolderId || info.rootFolderName));
    try {
      const result = await store.rebuild();
      const total = result.details.reduce((sum, d) => sum + (d.photos || 0), 0);
      console.log("[store] sync dari Drive: " + result.events + " acara, " + total + " foto");
      for (const detail of result.details) {
        console.log("  - " + detail.slug + ": " + (detail.photos == null ? "error " + detail.error : detail.photos + " foto"));
      }
    } catch (err) {
      console.error("[store] sync dari Drive gagal: " + err.message);
      console.error("[store] server tetap jalan; permintaan akan mencoba lagi saat ada akses.");
    }
  }
});

/* Simpan metadata yang masih tertunda (hitungan foto) sebelum proses mati. */
async function shutdown(signal) {
  console.log("[api] " + signal + " diterima, menutup server…");
  server.close(() => process.exit(0));
  try {
    await store.flushAll();
  } catch (err) {
    console.warn("[api] flush metadata gagal: " + err.message);
  }
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app, server };
