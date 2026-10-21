/* Slug acara: dipakai sebagai nama folder Drive (prefix "event-") dan URL rute. */
import { nanoid } from "nanoid";

export function slugify(text) {
  const base = (text || "").toLowerCase().trim();
  return (
    base
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || nanoid(8)
  );
}

/** Slug unik: bila sudah dipakai, tambah angka; kalau mentok, tambah acak. */
export function uniqueSlug(base, taken = new Set()) {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = base + "-" + i;
    if (!taken.has(candidate)) return candidate;
  }
  return base + "-" + nanoid(6);
}

/** Kunci rahasia yang dipakai tamu (ada di link kamera & galeri). */
export function makeUploadKey() {
  return nanoid(32);
}

export function makeEventId() {
  return "evt_" + nanoid(12);
}
