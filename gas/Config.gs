/* Konfigurasi terpusat Web App Satu-Album (Google Apps Script).

   Semua nilai disimpan di **Script Properties** (Project Settings → Script
   properties, atau `setConfigProperty_` dari editor), BUKAN di kode, supaya
   token admin tidak ikut ter-commit ke Git.

   Yang wajib diisi hanya `ADMIN_TOKEN`; sisanya punya default aman. Nama kunci
   Property sengaja dibuat generik (tanpa awalan GOOGLE_) karena GAS sendiri
   yang menjadi Drive client — lihat tabel pemetaan di gas/README.md. */

/** Nilai default bila Script Property belum diisi. */
var CONFIG_DEFAULTS = {
  ADMIN_TOKEN: "",
  DRIVE_ROOT_FOLDER_NAME: "Satu-Album",
  DRIVE_ROOT_FOLDER_ID: "",
  MAX_PHOTOS_PER_EVENT: "800",
  MAX_UPLOAD_MB: "8",
  UNDO_WINDOW_MS: "120000",
  CACHE_TTL_MS: "10000",
  IMAGE_WIDTH: "1600",
  THUMB_WIDTH: "400",
  RATE_UPLOAD_PER_HOUR: "300",
  RATE_CREATE_PER_HOUR: "10",
  ALLOWED_MIME: "image/jpeg,image/png,image/webp"
};

var CONFIG_VERSION = "2.0.0-gas";

/* Cache config per-eksekusi (GAS memuat ulang global setiap invocation). */
var CONFIG_CACHE = null;

function props_() {
  return PropertiesService.getScriptProperties();
}

function config_() {
  if (CONFIG_CACHE) return CONFIG_CACHE;
  var stored = props_().getProperties() || {};

  function raw(key) {
    var value = stored[key];
    if (value === undefined || value === null || value === "") return CONFIG_DEFAULTS[key];
    return value;
  }
  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) && n > 0 ? n : fallback;
  }
  function list(value) {
    return String(value || "")
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(function (part) {
        return part.length > 0;
      });
  }

  CONFIG_CACHE = {
    version: CONFIG_VERSION,
    /* Beberapa token dipisah koma → bisa rotasi token tanpa memutus panitia lama. */
    adminTokens: list(raw("ADMIN_TOKEN")),
    rootFolderName: String(raw("DRIVE_ROOT_FOLDER_NAME")).trim() || "Satu-Album",
    /* Diisi otomatis saat root folder pertama kali dibuat/ditemukan. */
    rootFolderId: String(raw("DRIVE_ROOT_FOLDER_ID")).trim(),
    maxPhotosPerEvent: Math.round(num(raw("MAX_PHOTOS_PER_EVENT"), 800)),
    maxUploadBytes: Math.round(num(raw("MAX_UPLOAD_MB"), 8) * 1024 * 1024),
    undoWindowMs: Math.round(num(raw("UNDO_WINDOW_MS"), 120000)),
    /* CacheService menyimpan TTL dalam detik, maksimum 6 jam. */
    cacheTtlSec: Math.max(1, Math.min(21600, Math.round(num(raw("CACHE_TTL_MS"), 10000) / 1000))),
    imageWidth: Math.round(num(raw("IMAGE_WIDTH"), 1600)),
    thumbWidth: Math.round(num(raw("THUMB_WIDTH"), 400)),
    rateUploadPerHour: Math.round(num(raw("RATE_UPLOAD_PER_HOUR"), 300)),
    rateCreatePerHour: Math.round(num(raw("RATE_CREATE_PER_HOUR"), 10)),
    allowedMime: list(raw("ALLOWED_MIME"))
  };
  return CONFIG_CACHE;
}

/** Ubah satu Script Property (dipakai Setup.gs & test). Nilai kosong = hapus. */
function setConfigProperty_(key, value) {
  if (value === undefined || value === null || value === "") props_().deleteProperty(key);
  else props_().setProperty(key, String(value));
  CONFIG_CACHE = null;
  return config_();
}

/** Simpan ID root folder agar pencarian nama folder tidak diulang tiap request. */
function rememberRootFolderId_(id) {
  props_().setProperty("DRIVE_ROOT_FOLDER_ID", String(id));
  if (CONFIG_CACHE) CONFIG_CACHE.rootFolderId = String(id);
}

function resetConfigCache_() {
  CONFIG_CACHE = null;
}
