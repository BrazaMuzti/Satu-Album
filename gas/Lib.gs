/* Utilitas bersama: slug, kunci rahasia, sniffing gambar, cache, rate limit,
   dan pembentukan respons. Semua fungsi berakhiran `_` = internal (tidak
   diekspor/dipanggil klien). Port dari server/src/lib/*.js. */

/* ── Error yang bisa diterjemahkan jadi envelope {ok:false,status,code} ─── */

class ApiFailure extends Error {
  constructor(message, status, code) {
    super(String(message || "internal error"));
    this.name = "ApiFailure";
    this.status = Number(status) || 500;
    this.code = code || undefined;
  }
}

function fail_(message, status, code) {
  throw new ApiFailure(message, status, code);
}

/* ── Slug & kunci rahasia ──────────────────────────────────────────────── */

/** Hex acak sepanjang `length` karakter (sumber: UUID v4 milik GAS). */
function randomHex_(length) {
  var out = "";
  while (out.length < length) out += String(Utilities.getUuid()).replace(/-/g, "");
  return out.slice(0, length);
}

/** Slug acara: dipakai sebagai nama folder Drive (`event-<slug>`) dan URL rute. */
function slugify_(text) {
  var base = String(text || "").toLowerCase().trim();
  var slug = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || randomHex_(8);
}

/** Slug unik: bila sudah dipakai, tambah angka; kalau mentok, tambah acak. */
function uniqueSlug_(base, taken) {
  var used = taken || {};
  if (!used[base]) return base;
  for (var i = 2; i < 100; i += 1) {
    var candidate = base + "-" + i;
    if (!used[candidate]) return candidate;
  }
  return base + "-" + randomHex_(6);
}

/** Kunci rahasia yang dipakai tamu (ada di link kamera & galeri). */
function makeUploadKey_() {
  return randomHex_(32);
}

function makeEventId_() {
  return "evt_" + randomHex_(12);
}

/** Perbandingan waktu-tetap (GAS tidak punya crypto.timingSafeEqual). */
function secretsEqual_(a, b) {
  var da = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(a));
  var db = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(b));
  var diff = 0;
  for (var i = 0; i < da.length; i += 1) diff |= da[i] ^ db[i];
  return diff === 0;
}

/** Kunci tamu cocok dengan metadata acara? (perbandingan waktu-tetap) */
function keyMatches_(meta, key) {
  if (!meta || !meta.uploadKey || key === undefined || key === null || key === "") return false;
  return secretsEqual_(meta.uploadKey, String(key));
}

/* ── Gambar ────────────────────────────────────────────────────────────── */

/** Terima base64 mentah maupun data URL (`data:image/jpeg;base64,...`). */
function bytesFromBase64_(data) {
  var text = String(data || "");
  var comma = text.indexOf(",");
  if (text.indexOf("data:") === 0 && comma > 0) text = text.slice(comma + 1);
  text = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!text) return null;
  try {
    return Utilities.base64Decode(text);
  } catch (err) {
    return null;
  }
}

function bytesStartsWith_(bytes, signature, offset) {
  var start = offset || 0;
  if (!bytes || bytes.length < start + signature.length) return false;
  for (var i = 0; i < signature.length; i += 1) {
    if ((bytes[start + i] & 0xff) !== signature[i]) return false;
  }
  return true;
}

function bytesAscii_(bytes, offset, length) {
  if (!bytes || bytes.length < offset + length) return "";
  var out = "";
  for (var i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i] & 0xff);
  return out;
}

/** Deteksi tipe gambar sebenarnya dari isi file (bukan dari label klien). */
function sniffImageMime_(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytesStartsWith_(bytes, [0xff, 0xd8, 0xff], 0)) return "image/jpeg";
  if (bytesStartsWith_(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)) return "image/png";
  if (bytesAscii_(bytes, 0, 4) === "RIFF" && bytesAscii_(bytes, 8, 4) === "WEBP") return "image/webp";
  if (bytesAscii_(bytes, 4, 4) === "ftyp") {
    var brand = bytesAscii_(bytes, 8, 4).toLowerCase();
    if (brand.indexOf("heic") === 0 || brand.indexOf("heix") === 0 || brand.indexOf("mif1") === 0) return "image/heic";
  }
  return null;
}

/**
 * Hasil validasi (parity dengan server/src/lib/image.js):
 *   { ok: true, mime }                      → lanjutkan upload
 *   { ok: false, status, code, error }      → balas error ke klien
 */
function validateImage_(bytes, allowedMime, declaredMime) {
  var allowed = allowedMime || [];
  var declared = String(declaredMime || "").split(";")[0].trim().toLowerCase();
  if (!bytes || bytes.length === 0) {
    /* Body tidak terbaca sebagai gambar (mis. klien lama masih kirim multipart). */
    if (declared && declared !== "application/octet-stream" && allowed.indexOf(declared) < 0) {
      return {
        ok: false,
        status: 415,
        code: "unsupported",
        error: "kirim foto sebagai base64 dengan mime " + allowed.join(", ") + " (diterima: " + allowed.join(", ") + ")"
      };
    }
    return { ok: false, status: 400, code: "bad-request", error: "photo is required" };
  }
  var sniffed = sniffImageMime_(bytes);
  if (!sniffed) {
    return { ok: false, status: 415, code: "unsupported", error: "file bukan gambar yang dikenali (JPEG/PNG/WebP)" };
  }
  if (sniffed === "image/heic") {
    return { ok: false, status: 415, code: "unsupported", error: "format HEIC belum didukung, pakai JPEG/PNG/WebP" };
  }
  if (allowed.indexOf(sniffed) < 0) {
    return { ok: false, status: 415, code: "unsupported", error: "tipe gambar " + sniffed + " tidak diizinkan" };
  }
  /* Label MIME dari klien hanya dipakai sebagai info: iPhone kadang mengirim
     application/octet-stream padahal isinya JPEG. */
  return { ok: true, mime: sniffed, declared: declared || sniffed };
}


/* ── Cache (CacheService) ──────────────────────────────────────────────── */

/* Nilai CacheService dibatasi ±100 KB per kunci, jadi payload besar dipecah.
   Kunci `<key>` menyimpan header: "~<json>" bila muat, atau "#<jumlah chunk>"
   bila dipecah ke `<key>.0`, `<key>.1`, ... Bila satu chunk hilang (cache
   digusur), pembacaan mengembalikan null → pemanggil membaca ulang dari Drive. */
var CACHE_CHUNK_SIZE = 90000;
var CACHE_TTL_MAX = 21600;

function cacheStore_() {
  return CacheService.getScriptCache();
}

function cacheKey_(key) {
  return "sa1:" + key;
}

/** Cek keberadaan entri cache tanpa mem-parse isinya (murah). */
function cacheHas_(key) {
  var head = cacheStore_().get(cacheKey_(key));
  return head !== null && head !== undefined && head !== "";
}

function cacheGetJson_(key) {
  var cache = cacheStore_();
  var head = cache.get(cacheKey_(key));
  if (head === null || head === undefined || head === "") return null;
  if (head.charAt(0) === "#") {
    var count = Number(head.slice(1));
    if (!isFinite(count) || count <= 0) return null;
    var payload = "";
    for (var i = 0; i < count; i += 1) {
      var part = cache.get(cacheKey_(key) + "." + i);
      if (part === null || part === undefined) return null;
      payload += part;
    }
    try {
      return JSON.parse(payload);
    } catch (err) {
      return null;
    }
  }
  try {
    return JSON.parse(head.slice(1));
  } catch (err) {
    return null;
  }
}

function cachePutJson_(key, value, ttlSec) {
  var cache = cacheStore_();
  var ttl = Math.max(1, Math.min(CACHE_TTL_MAX, Math.round(Number(ttlSec) || 10)));
  var payload;
  try {
    payload = JSON.stringify(value);
  } catch (err) {
    return false;
  }
  if (payload === undefined || payload === null) return false;
  cacheRemove_(key);
  if (payload.length <= CACHE_CHUNK_SIZE) {
    cache.put(cacheKey_(key), "~" + payload, ttl);
    return true;
  }
  var chunks = [];
  for (var offset = 0; offset < payload.length; offset += CACHE_CHUNK_SIZE) {
    chunks.push(payload.substr(offset, CACHE_CHUNK_SIZE));
  }
  for (var i = 0; i < chunks.length; i += 1) cache.put(cacheKey_(key) + "." + i, chunks[i], ttl);
  /* Header ditulis terakhir: pembaca tidak akan menemukan header tanpa chunk. */
  cache.put(cacheKey_(key), "#" + chunks.length, ttl);
  return true;
}

function cacheRemove_(key) {
  var cache = cacheStore_();
  var head = cache.get(cacheKey_(key));
  cache.remove(cacheKey_(key));
  if (head && head.charAt(0) === "#") {
    var count = Number(head.slice(1)) || 0;
    for (var i = 0; i < count; i += 1) cache.remove(cacheKey_(key) + "." + i);
  }
}

/* ── Rate limit ───────────────────────────────────────────────────────── */

/* GAS tidak melihat IP klien, jadi pembatasnya per-slug (unggah) atau global
   (buat album). CacheService tidak atomik → ini pembatas best-effort untuk
   menahan banjir permintaan, bukan kuota keras. */
function rateLimit_(bucket, limit, windowSec) {
  var max = Number(limit) || 0;
  if (max <= 0) return { allowed: true, remaining: 0 };
  var cache = cacheStore_();
  var key = cacheKey_("rl:" + bucket);
  var current = Number(cache.get(key) || 0);
  if (isFinite(current) && current >= max) {
    return { allowed: false, remaining: 0, retryAfterSec: Math.round(Number(windowSec) || 3600) };
  }
  cache.put(key, String((isFinite(current) ? current : 0) + 1), Math.max(1, Math.round(Number(windowSec) || 3600)));
  return { allowed: true, remaining: Math.max(0, max - current - 1) };
}

/* ── Waktu & error penyimpanan ─────────────────────────────────────────── */

function toIso_(value) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? new Date().toISOString() : value.toISOString();
  }
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/** Gangguan sementara Drive/GAS → klien boleh mencoba lagi (status ≥ 500). */
function storageUnavailableStatus_(err) {
  var message = String((err && err.message) || err || "");
  if (/quota/i.test(message)) return { status: 503, code: "gas-quota" };
  if (/too many|rate ?limit|exceeded maximum|simultaneous|busy|timeout|timed out/i.test(message)) {
    return { status: 503, code: "gas-busy" };
  }
  var status = err && (err.status || err.code);
  if (status === 401 || status === 403 || status === 429 || status === 500 || status === 503) {
    return { status: 503, code: "storage-unavailable" };
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|network|socket hang up/i.test(message)) {
    return { status: 503, code: "storage-unavailable" };
  }
  return null;
}

/* ── Respons ───────────────────────────────────────────────────────────── */

/* ContentService tidak bisa mengubah status code & header, jadi status asli
   HTTP ikut dikirim di dalam envelope JSON: {ok,status,code,error,data}. */
function apiResponse_(payload, callback) {
  var body = JSON.stringify(payload);
  if (callback) {
    /* JSONP hanya untuk GET — dipakai <script> tag / browser sangat lama. */
    return ContentService.createTextOutput(callback + "(" + body + ");").setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function okOut_(data, callback) {
  return apiResponse_(
    { ok: true, data: data === undefined ? null : data, serverTime: new Date().toISOString() },
    callback
  );
}

function failOut_(err, callback) {
  var failure = err instanceof ApiFailure ? err : null;
  if (!failure) {
    var mapped = storageUnavailableStatus_(err);
    if (mapped) failure = new ApiFailure("penyimpanan sedang tidak tersedia, coba lagi", mapped.status, mapped.code);
  }
  if (!failure) {
    failure = new ApiFailure("internal error", 500, "internal");
    Logger.log("[api] unhandled: " + (err && err.stack ? err.stack : err));
  }
  return apiResponse_(
    {
      ok: false,
      status: failure.status,
      code: failure.code,
      error: failure.message,
      serverTime: new Date().toISOString()
    },
    callback
  );
}
