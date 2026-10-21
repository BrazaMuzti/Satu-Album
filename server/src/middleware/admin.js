/* Otorisasi ringan dengan token, bukan sistem akun:
   - `x-admin-token` : untuk membuat/mengubah/menghapus acara (hanya panitia).
   - `?k=<uploadKey>`: untuk kamera & galeri (dibagikan ke tamu). */
import crypto from "node:crypto";
import { ADMIN_TOKENS } from "../config.js";

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

/** Perbandingan waktu-tetap supaya token tidak bisa diintip lewat timing. */
function safeEqual(a, b) {
  const ba = sha256(a);
  const bb = sha256(b);
  return crypto.timingSafeEqual(ba, bb);
}

export function isAdmin(req) {
  if (ADMIN_TOKENS.length === 0) return false;
  const header = req.get("x-admin-token") || req.query.token || "";
  const value = String(Array.isArray(header) ? header[0] : header);
  if (!value) return false;
  return ADMIN_TOKENS.some((token) => safeEqual(token, value));
}

export function requireAdmin(req, res, next) {
  if (ADMIN_TOKENS.length === 0) {
    return res.status(503).json({ error: "ADMIN_TOKEN belum diisi di server" });
  }
  if (!isAdmin(req)) {
    return res.status(401).json({ error: "token admin tidak valid" });
  }
  return next();
}

/** Key tamu: header `x-upload-key` atau query `?k=`. */
export function guestKey(req) {
  const header = req.get("x-upload-key");
  const value = header || req.query.k || "";
  return String(Array.isArray(value) ? value[0] : value);
}
