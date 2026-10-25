/* Konfigurasi terpusat Web App Satu-Album (Google Apps Script).

   Semua nilai disimpan di **Script Properties** (Project Settings → Script
   properties, atau fungsi `setConfigProperty_` dari editor), BUKAN di kode,
   supaya token/rahasia tidak ikut ter-commit ke Git.

   Arsitektur baru (100% gratis):
     - Database  : Google Sheets  (SHEET_ID → lihat gas/Sheets.gs)
     - Storage   : Google Drive   (folder foto per acara → gas/DriveStore.gs)
     - Frontend  : GitHub Pages   (folder web/)

   Property yang WAJIB diisi:
     SHEET_ID      → ID Spreadsheet database (ambil dari URL /edit/d/<ID>/edit)
     ADMIN_PIN     → PIN awal admin (dipakai saat initSheets untuk seed baris Admin)
     SESSION_SECRET→ kunci HMAC untuk token sesi admin (bebas, panjang)

   Property opsional punya default aman di CONFIG_DEFAULTS. */

/** Nilai default bila Script Property belum diisi. */
var CONFIG_DEFAULTS = {
  SHEET_ID: "",
  ADMIN_PIN: "",
  SESSION_SECRET: "",
  BASE_URL: "",
  DRIVE_ROOT_FOLDER_NAME: "Satu-Album",
  DRIVE_ROOT_FOLDER_ID: "",
  SESSION_TTL_SEC: "28800",        /* 8 jam */
  LOGIN_MAX_ATTEMPTS: "8",         /* percobaan login per jam per pinId */
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

var CONFIG_VERSION = "3.0.0-sheets";

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
    sheetId: String(raw("SHEET_ID")).trim(),
    adminPin: String(raw("ADMIN_PIN")),
    sessionSecret: String(raw("SESSION_SECRET")),
    baseUrl: String(raw("BASE_URL")).trim().replace(/\/+$/, ""),
    rootFolderName: String(raw("DRIVE_ROOT_FOLDER_NAME")).trim() || "Satu-Album",
    /* Diisi otomatis saat root folder pertama kali dibuat/ditemukan. */
    rootFolderId: String(raw("DRIVE_ROOT_FOLDER_ID")).trim(),
    sessionTtlSec: Math.round(num(raw("SESSION_TTL_SEC"), 28800)),
    loginMaxAttempts: Math.round(num(raw("LOGIN_MAX_ATTEMPTS"), 8)),
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

/** Base URL frontend (GitHub Pages), tanpa garis miring di akhir.
    Kosong → link dibuat relatif di sisi frontend. */
function publicBaseUrl_() {
  return config_().baseUrl || "";
}

/** Simpan ID root folder agar pencarian nama folder tidak diulang tiap request. */
function rememberRootFolderId_(id) {
  props_().setProperty("DRIVE_ROOT_FOLDER_ID", String(id));
  if (CONFIG_CACHE) CONFIG_CACHE.rootFolderId = String(id);
}

function resetConfigCache_() {
  CONFIG_CACHE = null;
}
