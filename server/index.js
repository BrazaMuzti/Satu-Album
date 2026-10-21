/* satualbum backend: Express + Google Drive */
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import * as store from "./store.js";
import { driveInfo, isDriveReady, uploadPhotoToDrive } from "./drive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";
/* URL publik API (ex: https://satu-album-api.onrender.com). Digunakan untuk membuat
   URL foto lokal menjadi absolut supaya SPA di domain lain bisa display. */
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
/* Allowlist CORS (domain client, ex: https://satu-album.vercel.app).
   Vazio = allow all (dev local). */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
const uploadDirEnv = process.env.UPLOAD_DIR || process.env.LOCAL_UPLOAD_DIR || "uploads";
const LOCAL_DIR = path.isAbsolute(uploadDirEnv) ? uploadDirEnv : path.join(__dirname, uploadDirEnv);
fs.mkdirSync(LOCAL_DIR, { recursive: true });
app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.length === 0) return cb(null, true);
    cb(null, ALLOWED_ORIGINS.includes(origin));
  }
}));
app.use(express.json());
app.use("/uploads", express.static(LOCAL_DIR));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
function slugify(t) {
  const base = (t || "").toLowerCase().trim();
  return base.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || nanoid(8);
}

app.get("/api/health", (req, res) => {
  const info = driveInfo();
  res.json({ ok: true, drive: isDriveReady(), driveMode: info.mode, driveRootFolderId: info.rootFolderId });
});

app.post("/api/events", (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "name is required" });
  const slug = slugify(b.name);
  const events = store.getEvents();
  events.push({ id: nanoid(10), slug, name: b.name, type: b.type || "lainnya", preset: b.preset || "funsaver", revealAt: b.revealAt || null, createdAt: new Date().toISOString(), count: 0 });
  store.saveEvents(events);
  res.status(201).json({ event: events.find(e => e.slug === slug) });
});

app.get("/api/events/:slug", (req, res) => {
  const event = store.getEventBySlug(req.params.slug);
  if (!event) return res.status(404).json({ error: "event not found" });
  res.json({ event });
});

app.post("/api/events/:slug/photos", upload.single("photo"), async (req, res) => {
  const event = store.getEventBySlug(req.params.slug);
  if (!event) return res.status(404).json({ error: "event not found" });
  if (!req.file) return res.status(400).json({ error: "photo is required" });
  try {
    const drive = await uploadPhotoToDrive(req.file.buffer, req.file.mimetype, event);
    let photo;
    if (drive) {
      photo = { id: nanoid(10), eventSlug: event.slug, url: drive.url, thumb: drive.thumb, source: "drive", createdAt: new Date().toISOString() };
    } else {
      const name = "photo-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".jpg";
      fs.writeFileSync(path.join(LOCAL_DIR, name), req.file.buffer);
      const abs = PUBLIC_BASE_URL + "/uploads/" + name;
      photo = { id: nanoid(10), eventSlug: event.slug, url: abs, thumb: abs, source: "local", createdAt: new Date().toISOString() };
    }
    store.addPhoto(photo);
    const events = store.getEvents();
    events.forEach(e => { if (e.slug === event.slug) e.count = (e.count || 0) + 1; });
    store.saveEvents(events);
    res.status(201).json({ photo });
  } catch (err) {
    res.status(500).json({ error: "upload failed: " + err.message });
  }
});

app.get("/api/events/:slug/photos", (req, res) => {
  res.json({ photos: store.getPhotos(req.params.slug) });
});

app.listen(PORT, HOST, () => {
  const info = driveInfo();
  console.log("satualbum api on http://" + HOST + ":" + PORT);
  console.log("drive: " + (info.ready ? "aktif via " + info.mode : "nonaktif, foto disimpan lokal"));
});