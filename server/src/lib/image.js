/* Validasi gambar tanpa file tambahan: cek magic bytes supaya file yang
   mengaku "image/jpeg" tapi isinya bukan gambar tetap ditolak (G9). */

function startsWith(buffer, bytes, offset = 0) {
  if (!buffer || buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function ascii(buffer, offset, length) {
  if (!buffer || buffer.length < offset + length) return "";
  return buffer.subarray(offset, offset + length).toString("latin1");
}

/** Deteksi tipe gambar sebenarnya dari isi file. */
export function sniffImageMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WEBP") return "image/webp";
  if (ascii(buffer, 4, 4) === "ftyp") {
    const brand = ascii(buffer, 8, 4).toLowerCase();
    if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1")) return "image/heic";
  }
  return null;
}

/**
 * Hasil validasi:
 *  - { ok: true, mime }                  → lanjutkan upload
 *  - { ok: false, status, error }        → balas error ke klien
 */
export function validateImage(buffer, allowedMime, declaredMime) {
  const declared = String(declaredMime || "").split(";")[0].trim().toLowerCase();
  if (!buffer || buffer.length === 0) {
    /* Body tidak terbaca sebagai biner (mis. klien lama masih mengirim multipart). */
    if (declared && declared !== "application/octet-stream" && !allowedMime.includes(declared)) {
      return {
        ok: false,
        status: 415,
        error: "kirim foto sebagai biner mentah dengan content-type image/jpeg (diterima: " + allowedMime.join(", ") + ")",
      };
    }
    return { ok: false, status: 400, error: "photo is required" };
  }
  const sniffed = sniffImageMime(buffer);
  if (!sniffed) {
    return { ok: false, status: 415, error: "file bukan gambar yang dikenali (JPEG/PNG/WebP)" };
  }
  if (sniffed === "image/heic") {
    return { ok: false, status: 415, error: "format HEIC belum didukung, pakai JPEG/PNG/WebP" };
  }
  if (!allowedMime.includes(sniffed)) {
    return { ok: false, status: 415, error: "tipe gambar " + sniffed + " tidak diizinkan" };
  }
  /* Declared MIME opsional: kalau ada dan jelas berbeda, tetap pakai hasil sniffing
     (klien iPhone kadang mengirim application/octet-stream). */
  return { ok: true, mime: sniffed, declared: declared || sniffed };
}
