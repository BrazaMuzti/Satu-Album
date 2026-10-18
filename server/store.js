import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
const PHOTOS_FILE = path.join(DATA_DIR, "photos.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function read(file, fallback = []) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return fallback; }
}

function write(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

export const getEvents = () => read(EVENTS_FILE);
export const saveEvents = (evts) => write(EVENTS_FILE, evts);

export function getEventBySlug(slug) {
  return getEvents().find((e) => e.slug === slug) || null;
}

export const getPhotos = (slug) => read(PHOTOS_FILE).filter((p) => p.eventSlug === slug);

export function addPhoto(photo) {
  const all = read(PHOTOS_FILE);
  all.push(photo);
  write(PHOTOS_FILE, all);
  return photo;
}
