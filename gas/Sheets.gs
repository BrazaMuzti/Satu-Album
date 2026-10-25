/* Lapisan repositori Google Sheets — satu-satunya berkas yang menyentuh
   SpreadsheetApp. Semua fungsi berakhiran `_` = internal.

   Model data: satu Spreadsheet (SHEET_ID) berisi banyak tab. Baris pertama
   tiap tab adalah HEADER (nama kolom). Setiap baris data dipetakan ke objek
   JS {kolom: nilai}. Nomor baris di Sheets disimpan sebagai `_row` agar update
   & hapus bisa langsung menarget baris tanpa pencarian ulang.

   Tab & header (lihat docs/DB-SCHEMA-SHEETS.md):
     Admin        : admin_id, pin_hash, nama, role, aktif, dibuat_pada
     Events       : event_id, slug, nama, jenis, tanggal, lokasi, join_key,
                    drive_folder_id, preset, reveal_at, aktif, dibuat_pada
     Photos       : photo_id, event_id, nama_file, url, thumb, ukuran, mime,
                    sumber, diunggah_pada
     Templates    : template_id, event_id, nama_template, tema_warna,
                    teks_hero, teks_couple, teks_acara, teks_penutup,
                    musik_url, tata_letak, diperbarui_pada
     PrintOrders  : order_id, event_id, nama_pemesan, kontak, alamat, catatan,
                    status, total_foto, dibuat_pada
     PrintItems   : item_id, order_id, photo_id, url, jumlah, ukuran_cetak
     RSVP         : rsvp_id, event_id, nama, kontak, hadir, jumlah_tamu,
                    pesan, dibuat_pada, ip_hash
     Guestbook    : entry_id, event_id, nama, pesan, dibuat_pada */

var SHEET_HEADERS = {
  Admin: ["admin_id", "pin_hash", "nama", "role", "aktif", "dibuat_pada"],
  Events: [
    "event_id", "slug", "nama", "jenis", "tanggal", "lokasi", "join_key",
    "drive_folder_id", "preset", "reveal_at", "aktif", "dibuat_pada"
  ],
  Photos: [
    "photo_id", "event_id", "nama_file", "url", "thumb", "ukuran", "mime",
    "sumber", "diunggah_pada"
  ],
  Templates: [
    "template_id", "event_id", "nama_template", "tema_warna", "teks_hero",
    "teks_couple", "teks_acara", "teks_penutup", "musik_url", "tata_letak",
    "diperbarui_pada"
  ],
  PrintOrders: [
    "order_id", "event_id", "nama_pemesan", "kontak", "alamat", "catatan",
    "status", "total_foto", "dibuat_pada"
  ],
  PrintItems: ["item_id", "order_id", "photo_id", "url", "jumlah", "ukuran_cetak"],
  RSVP: [
    "rsvp_id", "event_id", "nama", "kontak", "hadir", "jumlah_tamu", "pesan",
    "dibuat_pada", "ip_hash"
  ],
  Guestbook: ["entry_id", "event_id", "nama", "pesan", "dibuat_pada"]
};

/* Status pesanan cetak yang sah. Ditampilkan berurutan di dasbor admin. */
var PRINT_STATUS = ["baru", "diproses", "selesai", "dibatalkan"];

/* ── Akses Spreadsheet & tab ──────────────────────────────────────────── */

var SHEET_CACHE = {};

function spreadsheet_() {
  var cfg = config_();
  if (!cfg.sheetId) {
    fail_("SHEET_ID belum diisi di Script Properties (jalankan initSheets)", 503, "sheet-not-configured");
  }
  if (SHEET_CACHE.spreadsheet) return SHEET_CACHE.spreadsheet;
  var ss;
  try {
    ss = SpreadsheetApp.openById(cfg.sheetId);
  } catch (err) {
    fail_("Spreadsheet tidak terbuka (periksa SHEET_ID & izin): " + (err && err.message ? err.message : err), 503, "sheet-open-failed");
  }
  SHEET_CACHE.spreadsheet = ss;
  return ss;
}

/** Sheet untuk nama tabel; dibuat otomatis dengan header bila belum ada. */
function sheet_(name) {
  var headers = SHEET_HEADERS[name];
  if (!headers) fail_("tabel tidak dikenal: " + name, 500, "bad-table");
  if (SHEET_CACHE[name]) return SHEET_CACHE[name];
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  SHEET_CACHE[name] = sh;
  return sh;
}

/* ── Baca & tulis baris ───────────────────────────────────────────────── */

/**
 * Baca semua baris sebuah tabel sebagai array objek.
 * @param {string} name   nama tab (Events, Photos, ...)
 * @param {function} [filter] predikat (row) => boolean
 * @return {Array<Object>} baris dengan field `_row` (nomor baris Sheets, 1-based)
 */
function readRows_(name, filter) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = SHEET_HEADERS[name];
  var width = headers.length;
  var values = sh.getRange(2, 1, last - 1, width).getValues();
  var out = [];
  for (var i = 0; i < values.length; i += 1) {
    var raw = values[i];
    /* Baris kosong (semua sel blank) dilewati — Sheets sering menyisipkan. */
    var blank = true;
    var obj = { _row: i + 2 };
    for (var c = 0; c < width; c += 1) {
      var key = headers[c];
      var val = raw[c];
      obj[key] = val instanceof Date ? val.toISOString() : val;
      if (val !== "" && val !== null && val !== undefined) blank = false;
    }
    if (blank) continue;
    if (!filter || filter(obj)) out.push(obj);
  }
  return out;
}

/** Tambah satu baris (objek) sesuai urutan header; kembalikan objek + `_row`. */
function appendRow_(name, data) {
  var sh = sheet_(name);
  var headers = SHEET_HEADERS[name];
  var row = {};
  for (var i = 0; i < headers.length; i += 1) {
    var key = headers[i];
    row[key] = data[key] !== undefined && data[key] !== null ? data[key] : "";
  }
  var values = headers.map(function (key) {
    return row[key];
  });
  sh.appendRow(values);
  row._row = sh.getLastRow();
  return row;
}

/**
 * Tambah BANYAK baris sekaligus (bulk) — jauh lebih cepat daripada
 * appendRow_ per baris, dipakai sinkronisasi Drive → Photos.
 * @param {string} name
 * @param {Array<Object>} list array objek {kolom: nilai}
 * @return {number} jumlah baris tertulis
 */
function appendRows_(name, list) {
  var items = list || [];
  if (!items.length) return 0;
  var sh = sheet_(name);
  var headers = SHEET_HEADERS[name];
  var values = items.map(function (data) {
    return headers.map(function (key) {
      var val = data ? data[key] : "";
      return val === undefined || val === null ? "" : val;
    });
  });
  var start = sh.getLastRow() + 1;
  /* Bila tab baru saja dibuat, getLastRow()=1 (header) → data mulai baris 2. */
  if (start < 2) start = 2;
  var range = sh.getRange(start, 1, values.length, headers.length);
  range.setNumberFormat("@"); /* teks: cegah "1234" diubah jadi angka/rumus oleh Sheets */
  range.setValues(values);
  return values.length;
}

/** Ubah sebagian field pada baris ke-`row` (1-based). Field tak ada diabaikan. */

function updateRow_(name, row, patch) {
  var sh = sheet_(name);
  var headers = SHEET_HEADERS[name];
  var current = sh.getRange(row, 1, 1, headers.length).getValues()[0];
  var changed = false;
  for (var i = 0; i < headers.length; i += 1) {
    var key = headers[i];
    if (patch && patch[key] !== undefined) {
      current[i] = patch[key];
      changed = true;
    }
  }
  if (changed) sh.getRange(row, 1, 1, headers.length).setValues([current]);
  return changed;
}

/** Hapus baris ke-`row` dari tabel. */
function deleteRow_(name, row) {
  sheet_(name).deleteRow(row);
}

/** Cari satu baris pertama yang cocok (predikat), atau null. */
function findRow_(name, filter) {
  var rows = readRows_(name, filter);
  return rows.length ? rows[0] : null;
}

/* ── Helper spesifik tabel ────────────────────────────────────────────── */

function makeRowId_(prefix) {
  return prefix + randomHex_(12);
}

/* Admin */
function findAdminById_(id) {
  return findRow_("Admin", function (r) {
    return String(r.admin_id) === String(id);
  });
}

/* Events */
function findEventById_(id) {
  return findRow_("Events", function (r) {
    return String(r.event_id) === String(id);
  });
}

function findEventBySlug_(slug) {
  return findRow_("Events", function (r) {
    return String(r.slug) === String(slug);
  });
}

function listEventRows_(onlyActive) {
  return readRows_("Events", function (r) {
    if (onlyActive && String(r.aktif).toUpperCase() !== "TRUE" && r.aktif !== true) return false;
    return true;
  });
}

/* Photos */
function listPhotoRowsByEvent_(eventId) {
  return readRows_("Photos", function (r) {
    return String(r.event_id) === String(eventId);
  }).sort(function (a, b) {
    return String(a.diunggah_pada).localeCompare(String(b.diunggah_pada));
  });
}

function findPhotoRow_(eventId, photoId) {
  return findRow_("Photos", function (r) {
    return String(r.event_id) === String(eventId) && String(r.photo_id) === String(photoId);
  });
}

/* Templates */
function findTemplateByEvent_(eventId) {
  return findRow_("Templates", function (r) {
    return String(r.event_id) === String(eventId);
  });
}

/* Print orders */
function listPrintOrdersByEvent_(eventId, status) {
  return readRows_("PrintOrders", function (r) {
    if (String(r.event_id) !== String(eventId)) return false;
    if (status && String(r.status) !== String(status)) return false;
    return true;
  }).sort(function (a, b) {
    return String(b.dibuat_pada).localeCompare(String(a.dibuat_pada));
  });
}

function findPrintOrder_(orderId) {
  return findRow_("PrintOrders", function (r) {
    return String(r.order_id) === String(orderId);
  });
}

function listPrintItems_(orderId) {
  return readRows_("PrintItems", function (r) {
    return String(r.order_id) === String(orderId);
  });
}

/* RSVP & Guestbook */
function listRsvpByEvent_(eventId) {
  return readRows_("RSVP", function (r) {
    return String(r.event_id) === String(eventId);
  }).sort(function (a, b) {
    return String(b.dibuat_pada).localeCompare(String(a.dibuat_pada));
  });
}

function listGuestbookByEvent_(eventId) {
  return readRows_("Guestbook", function (r) {
    return String(r.event_id) === String(eventId);
  }).sort(function (a, b) {
    return String(b.dibuat_pada).localeCompare(String(a.dibuat_pada));
  });
}

/* ── Penyiapan skema (dipanggil Setup.gs:initSheets) ──────────────────── */

/** Buat semua tab + header bila belum ada. Kembalikan ringkasan. */
function ensureSchema_() {
  var created = [];
  for (var name in SHEET_HEADERS) {
    if (!SHEET_HEADERS.hasOwnProperty(name)) continue;
    var ss = spreadsheet_();
    if (!ss.getSheetByName(name)) created.push(name);
    sheet_(name);
  }
  return created;
}

/* ── Hash PIN (SHA-256 + salt per-baris) ───────────────────────────────── */

function makePinSalt_() {
  return randomHex_(16);
}

/**
 * Hash PIN: sha256(salt + ":" + pin) dalam hex. Salt disimpan di kolom
 * `pin_hash` dengan format `<salt>:<hash>` sehingga satu kolom cukup.
 */
function hashPin_(pin, salt) {
  var s = salt || makePinSalt_();
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(s) + ":" + String(pin),
    Utilities.Charset.UTF_8
  );
  var hex = "";
  for (var i = 0; i < digest.length; i += 1) {
    hex += ("0" + (digest[i] & 0xff).toString(16)).slice(-2);
  }
  return String(s) + ":" + hex;
}

/** Verifikasi PIN terhadap nilai `pin_hash` tersimpan (waktu-tetap). */
function verifyPin_(pin, storedHash) {
  var text = String(storedHash || "");
  var colon = text.indexOf(":");
  if (colon <= 0) return false;
  var salt = text.slice(0, colon);
  var expected = hashPin_(pin, salt);
  return secretsEqual_(expected, text);
}
