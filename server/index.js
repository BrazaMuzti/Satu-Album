/* satualbum backend: Express + Google Drive */
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import * as store from "./store.js";
import { isDriveReady, uploadPhotoToDrive } from "./drive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const LOCAL_DIR = path.join(__dirname, process.env.LOCAL_UPLOAD_DIR || "uploads");
fs.mkdirSync(LOCAL_DIR, { recursive: true });
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(LOCAL_DIR));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
function slugify(t) { return (t || "").toLowerCase().trim().split(" ").filter(Boolean).join("-") || nanoid(8); }

app.get("/api/health", (req, res) => res.json({ ok: true, drive: isDriveReady() }));

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
      photo = { id: nanoid(10), eventSlug: event.slug, url: drive.webContentLink, thumb: drive.thumbnail, source: "drive", createdAt: new Date().toISOString() };
    } else {
      const name = "photo-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".jpg";
      fs.writeFileSync(path.join(LOCAL_DIR, name), req.file.buffer);
      photo = { id: nanoid(10), eventSlug: event.slug, url: "/uploads/" + name, thumb: "/uploads/" + name, source: "local", createdAt: new Date().toISOString() };
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

app.listen(PORT, () => console.log("satualbum api on http://localhost:" + PORT));