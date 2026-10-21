/* Konfigurasi terpusat. Semua env dibaca di sini supaya mudah diaudit dan
   gagal-cepat (fail fast) ketika nilai wajib belum diisi.

   Catatan: `npm start` / `npm run dev` sudah memakai `--env-file-if-exists=.env`
   sehingga file .env lokal ikut terbaca (sebelumnya tidak). */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Akar folder server/ (tempat drive.js, store.js, dst.). */
export const SERVER_ROOT = path.resolve(__dirname, "..");

export const VERSION = "1.1.0";

function absPath(value, fallback) {
  const p = value || fallback;
  return path.isAbsolute(p) ? p : path.join(SERVER_ROOT, p);
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/* PORT=0 diperbolehkan (pilih port bebas) — dipakai oleh test. */
const rawPort = Number(process.env.PORT);
export const PORT = Number.isInteger(rawPort) && rawPort >= 0 ? rawPort : 3001;
export const HOST = process.env.HOST || "0.0.0.0";
export const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** URL publik API (ex: https://satu-album-api.onrender.com), dipakai untuk URL foto lokal. */
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");

/** Allowlist CORS (domain client). Kosong = izinkan semua (khusus dev). */
export const ALLOWED_ORIGINS = csv(process.env.ALLOWED_ORIGIN);

/** Token admin untuk membuat/mengubah acara. Boleh beberapa, dipisah koma. */
export const ADMIN_TOKENS = csv(process.env.ADMIN_TOKEN);

export const DATA_DIR = absPath(process.env.DATA_DIR, "data");
export const UPLOAD_DIR = absPath(process.env.UPLOAD_DIR || process.env.LOCAL_UPLOAD_DIR, "uploads");

/** Batas ukuran 1 foto (byte). Klien sudah mengecilkan gambar sebelum kirim. */
export const MAX_UPLOAD_BYTES = Math.round(num(process.env.MAX_UPLOAD_MB, 8) * 1024 * 1024);
/** Batas jumlah foto per acara (proteksi kuota Drive 15 GB). */
export const MAX_PHOTOS_PER_EVENT = num(process.env.MAX_PHOTOS_PER_EVENT, 800);
/** Umur cache metadata/daftar foto (ms). */
export const CACHE_TTL_MS = num(process.env.SA_CACHE_TTL_MS, 10000);
/** Jeda sebelum metadata (event.json/count) ditulis ulang ke penyimpanan (ms). */
export const META_FLUSH_MS = num(process.env.SA_META_FLUSH_MS, 3000);
/** Jendela waktu tombol Undo: tamu hanya bisa membatalkan foto dalam rentang ini (ms). */
export const UNDO_WINDOW_MS = num(process.env.SA_UNDO_WINDOW_MS, 120000);

export const RATE_LIMITS = {
  create: { windowMs: num(process.env.RATE_CREATE_WINDOW_MS, 3600_000), max: num(process.env.RATE_CREATE_PER_HOUR, 10), label: "membuat acara" },
  upload: { windowMs: num(process.env.RATE_UPLOAD_WINDOW_MS, 3600_000), max: num(process.env.RATE_UPLOAD_PER_HOUR, 300), label: "mengunggah foto" },
};

/** MIME gambar yang diterima endpoint upload. */
export const ALLOWED_UPLOAD_MIME = ["image/jpeg", "image/png", "image/webp"];

/** Peringatan konfigurasi yang membahayakan/merusak pengalaman tamu. */
export function configWarnings(storageMode) {
  const warn = [];
  if (ADMIN_TOKENS.length === 0) {
    warn.push("ADMIN_TOKEN kosong: endpoint POST/PATCH /api/events tidak bisa dipakai (selalu 401).");
  }
  if (ALLOWED_ORIGINS.length === 0 && IS_PRODUCTION) {
    warn.push("ALLOWED_ORIGIN kosong di production: semua domain boleh memanggil API.");
  }
  if (storageMode === "local") {
    warn.push("Google Drive nonaktif: foto tersimpan lokal dan akan HILANG saat Render restart.");
  }
  if (IS_PRODUCTION && !PUBLIC_BASE_URL) {
    warn.push("PUBLIC_BASE_URL kosong: URL foto lokal tidak akan bisa dibuka dari domain lain.");
  }
  return warn;
}
