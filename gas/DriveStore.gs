/* Penyimpanan foto di Google Drive + indeks di tab `Photos`.

   Analogi yang dipakai:  Google Drive = "hard disk", tab Photos = "katalog".

     <DRIVE_ROOT_FOLDER_NAME>/           ← default "Satu-Album"
       event-<slug>/                     ← folder per acara (TIDAK publik)
         photo-<ts>-<n>.jpg              ← berkas foto (dibagikan per-file)

   Kolom tab Photos: photo_id, event_id, nama_file, url, thumb, ukuran, mime,
                     sumber, diunggah_pada
   `photo_id` = ID berkas Drive (dipakai juga untuk URL thumbnail), sehingga
   tidak perlu kolom tambahan.

   Folder acara TIDAK dibagikan publik: hanya berkas yang dibagikan
   (Anyone with the link, view) supaya URL thumbnail bisa dirender. */

var DRIVE_FOLDER_PREFIX = "event-";
var DRIVE_SYNC_MAX_FILES = 2000;     /* pengaman batas waktu eksekusi GAS */
var DRIVE_SYNC_MAX_REQUESTS = 3;     /* antrian ulang bila 6 menit hampir habis */

/* ── Folder ───────────────────────────────────────────────────────────── */

/**
 * Root folder album; dibuat otomatis bila belum ada (ID disimpan di Properties).
 * Dipakai saat initSheets/setup, bukan di jalur baca tamu.
 */
function driveRoot_() {
  var cfg = config_();
  if (cfg.rootFolderId) {
    try {
      return DriveApp.getFolderById(cfg.rootFolderId);
    } catch (err) {
      Logger.log("[drive] root folder id " + cfg.rootFolderId + " tidak terbaca: " + err);
    }
  }
  var it = DriveApp.getFoldersByName(cfg.rootFolderName);
  var folder = it.hasNext() ? it.next() : null;
  if (!folder) folder = DriveApp.createFolder(cfg.rootFolderName);
  rememberRootFolderId_(folder.getId());
  return folder;
}

function folderNameFor_(slug) {
  return DRIVE_FOLDER_PREFIX + slug;
}

/** Folder acara berdasarkan ID tersimpan (fallback: cari nama di root). */
function eventFolder_(row) {
  if (!row) return null;
  var folderId = String(row.drive_folder_id || "");
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (err) {
      Logger.log("[drive] folder " + folderId + " tidak terbaca, mencari berdasarkan nama: " + err);
    }
  }
  var it = driveRoot_().getFoldersByName(folderNameFor_(String(row.slug)));
  return it.hasNext() ? it.next() : null;
}

/** Pastikan folder acara ada; kembalikan Folder. */
function ensureEventFolder_(slug, nama) {
  var row = findEventBySlug_(slug);
  if (row) {
    var existing = eventFolder_(row);
    if (existing) return existing;
  }
  /* Nama folder: "event-<slug>" agar unik walau nama acara berubah. */
  var root = driveRoot_();
  var it = root.getFoldersByName(folderNameFor_(slug));
  if (it.hasNext()) return it.next();
  var folder = root.createFolder(folderNameFor_(slug));
  if (folder.getName() !== folderNameFor_(slug)) folder.setName(folderNameFor_(slug));
  Logger.log("[drive] folder dibuat untuk " + slug + " (" + String(nama || "") + ")");
  return folder;
}

/* ── URL & bentuk data foto ───────────────────────────────────────────── */

/* URL thumbnail Drive: `uc?export=view` sering gagal render, sedangkan
   `thumbnail?id=&sz=w<lebar>` stabil dan tidak butuh API key. */
function imageUrl_(fileId, width) {
  return "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w" + width;
}

function photoFileName_(ext) {
  return "photo-" + Date.now() + "-" + Math.floor(Math.random() * 1000000) + "." + ext;
}

function extFor_(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** Baris Photos → objek JSON untuk galeri (bentuk sama dengan API lama). */
function presentPhoto_(row) {
  return {
    id: String(row.photo_id),
    name: String(row.nama_file || ""),
    url: String(row.url || ""),
    thumb: String(row.thumb || row.url || ""),
    size: row.ukuran === "" || row.ukuran === undefined ? null : Number(row.ukuran),
    mime: String(row.mime || ""),
    source: String(row.sumber || "camera"),
    createdAt: toIso_(row.diunggah_pada)
  };
}

/* ── Baca daftar foto ─────────────────────────────────────────────────── */

/**
 * Daftar foto sebuah acara (dari tab Photos, tanpa menyentuh Drive).
 * @param {Object} row baris Events
 * @param {Object} [options] { since, force }
 */
function listPhotos_(row, options) {
  var opts = options || {};
  var eventId = String(row.event_id);
  var cacheKey = "photos:" + row.slug;
  var list = opts.force ? null : cacheGetJson_(cacheKey);
  if (!list) {
    list = listPhotoRowsByEvent_(eventId).map(presentPhoto_);
    cachePutJson_(cacheKey, list, config_().cacheTtlSec);
  }
  if (opts.since) {
    list = list.filter(function (photo) {
      return String(photo.createdAt) > String(opts.since);
    });
  }
  return list;
}

/* ── Unggah ───────────────────────────────────────────────────────────── */

/** Bagikan SATU file foto ke siapa pun yang punya link (bukan foldernya). */
function shareAnyone_(file, label) {
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return true;
  } catch (err) {
    /* Gagal berbagi tidak membatalkan unggahan: foto tetap tersimpan di Drive,
       hanya belum bisa dirender lewat thumbnail publik. */
    Logger.log("[drive] gagal berbagi " + label + ": " + err);
    return false;
  }
}

/**
 * Simpan foto ke Drive lalu catat barisnya di tab Photos.
 * @param {Object} row    baris Events
 * @param {Array}  bytes  isi berkas
 * @param {string} mime   tipe gambar terdeteksi (sniffImageMime_)
 * @param {string} [source] "camera" (default) | "sync" | "upload"
 */
function storePhoto_(row, bytes, mime, source) {
  var cfg = config_();
  var folder = ensureEventFolder_(String(row.slug), String(row.nama));
  var name = photoFileName_(extFor_(mime));
  var file;
  try {
    file = folder.createFile(Utilities.newBlob(bytes, mime, name));
  } catch (err) {
    fail_("gagal mengunggah foto: " + (err && err.message ? err.message : err), 502, "drive-error");
  }
  var shared = shareAnyone_(file, name);
  var fileId = file.getId();
  var size = null;
  try {
    size = typeof file.getSize() === "number" ? file.getSize() : bytes.length;
  } catch (err) {
    size = bytes.length;
  }
  var entry = appendRow_("Photos", {
    photo_id: fileId,
    event_id: String(row.event_id),
    nama_file: name,
    url: imageUrl_(fileId, cfg.imageWidth),
    thumb: imageUrl_(fileId, cfg.thumbWidth),
    ukuran: size,
    mime: mime,
    sumber: source || "camera",
    diunggah_pada: new Date().toISOString()
  });
  cacheRemove_("photos:" + row.slug);
  cacheRemove_("photoCount:" + row.event_id);
  var photo = presentPhoto_(entry);
  photo.shared = shared;
  return photo;
}

/* ── Hapus ────────────────────────────────────────────────────────────── */

/**
 * Hapus foto: berkas Drive → Trash + baris Photos.
 * @param {Object} row     baris Events
 * @param {string} photoId ID berkas Drive
 * @param {boolean} admin  tamu hanya boleh membatalkan fotonya sendiri
 */
function removePhoto_(row, photoId, admin) {
  var cfg = config_();
  var entry = findPhotoRow_(String(row.event_id), String(photoId));
  if (!entry) fail_("foto tidak ditemukan", 404, "not-found");

  if (!admin) {
    /* Tamu hanya boleh Undo dalam jendela waktu singkat. */
    var age = Date.now() - new Date(entry.diunggah_pada).getTime();
    if (!isFinite(age) || age > cfg.undoWindowMs) {
      fail_("waktu Undo sudah lewat", 403, "undo-expired");
    }
  }

  /* Pastikan berkas memang di folder acara ini (cegah hapus lintas acara). */
  var folder = eventFolder_(row);
  try {
    var file = DriveApp.getFileById(String(photoId));
    if (!file.isTrashed()) {
      if (folder) {
        var parents = file.getParents();
        var inEvent = false;
        while (parents.hasNext()) {
          if (parents.next().getId() === folder.getId()) {
            inEvent = true;
            break;
          }
        }
        if (!inEvent) fail_("foto bukan milik acara ini", 403, "not-in-event");
      }
      file.setTrashed(true);
    }
  } catch (err) {
    if (err instanceof ApiFailure) throw err;
    /* Berkas sudah tidak ada di Drive: baris katalog tetap dibersihkan. */
    Logger.log("[drive] berkas " + photoId + " tidak terbaca saat hapus: " + err);
  }
  deleteRow_("Photos", entry._row);
  cacheRemove_("photos:" + row.slug);
  cacheRemove_("photoCount:" + row.event_id);
  return presentPhoto_(entry);
}

/* ── Sinkronisasi folder Drive → tab Photos ───────────────────────────── */

/**
 * Pindai folder Drive acara dan catat berkas gambar yang BELUM ada di tab
 * Photos (mis. foto yang diunggah manual lewat aplikasi Drive).
 *
 * @param {Object} row baris Events
 * @param {Object} [options] { force: true → periksa ulang berkas yang sudah ada }
 * @return {Object} { added, skipped, total, hasMore, folderId }
 */
function syncDrivePhotos_(row, options) {
  var opts = options || {};
  var eventId = String(row.event_id);
  var known = {};
  var existing = readRows_("Photos", function (r) {
    return String(r.event_id) === eventId;
  });
  for (var i = 0; i < existing.length; i += 1) known[String(existing[i].photo_id)] = true;

  var folder = eventFolder_(row);
  if (!folder) {
    /* Acara lama tanpa folder: buat dan kembalikan hasil kosong. */
    folder = ensureEventFolder_(String(row.slug), String(row.nama));
    updateRow_("Events", row._row, { drive_folder_id: folder.getId() });
    return { added: 0, skipped: 0, total: existing.length, hasMore: false, folderId: folder.getId(), createdFolder: true };
  }

  var cfg = config_();
  var files = folder.getFiles();
  var added = 0;
  var skipped = 0;
  var scanned = 0;
  var hasMore = false;
  var started = Date.now();
  var rows = [];

  while (files.hasNext()) {
    /* Batas waktu eksekusi Apps Script ±6 menit: hentikan jauh sebelumnya. */
    if (Date.now() - started > 240000) {
      hasMore = true;
      break;
    }
    var file = files.next();
    scanned += 1;
    if (scanned > DRIVE_SYNC_MAX_FILES) {
      hasMore = true;
      break;
    }
    var fileId = file.getId();
    if (known[fileId] && !opts.force) {
      skipped += 1;
      continue;
    }
    var mime = String(file.getMimeType() || "");
    if (mime.indexOf("image/") !== 0) continue;
    if (known[fileId]) {
      skipped += 1;
      continue;
    }
    shareAnyone_(file, file.getName());
    var size = null;
    try {
      size = file.getSize();
    } catch (err) {
      size = null;
    }
    rows.push({
      photo_id: fileId,
      event_id: eventId,
      nama_file: file.getName(),
      url: imageUrl_(fileId, cfg.imageWidth),
      thumb: imageUrl_(fileId, cfg.thumbWidth),
      ukuran: size === null || size === undefined ? "" : size,
      mime: mime,
      sumber: "sync",
      diunggah_pada: toIso_(file.getDateCreated())
    });
    known[fileId] = true;
    added += 1;
  }

  /* Tulis sekaligus (bulk) — jauh lebih cepat daripada appendRow per file. */
  if (rows.length) appendRows_("Photos", rows);

  cacheRemove_("photos:" + row.slug);
  cacheRemove_("photoCount:" + eventId);
  return {
    added: added,
    skipped: skipped,
    total: existing.length + added,
    scanned: scanned,
    hasMore: hasMore,
    folderId: folder.getId()
  };
}

/* ── Statistik & kesehatan ────────────────────────────────────────────── */

/** Jumlah foto per acara (dengan cache singkat karena dipanggil dasbor). */
function photoCount_(row) {
  var key = "photoCount:" + row.event_id;
  var cached = cacheGetJson_(key);
  if (cached && isFinite(Number(cached.n))) return Number(cached.n);
  var n = listPhotoRowsByEvent_(String(row.event_id)).length;
  cachePutJson_(key, { n: n }, config_().cacheTtlSec);
  return n;
}

/** Ringkasan kesehatan untuk halaman pengaturan admin. */
function health_() {
  var cfg = config_();
  var out = {
    mode: "sheets+drive",
    version: cfg.version,
    sheetConfigured: Boolean(cfg.sheetId),
    sessionConfigured: Boolean(cfg.sessionSecret),
    rootFolderName: cfg.rootFolderName,
    rootFolderId: cfg.rootFolderId || null,
    counts: { events: 0, photos: 0, templates: 0, printOrders: 0, rsvp: 0, guestbook: 0 },
    limits: {
      maxUploadBytes: cfg.maxUploadBytes,
      maxPhotosPerEvent: cfg.maxPhotosPerEvent,
      undoWindowMs: cfg.undoWindowMs,
      uploadsPerHour: cfg.rateUploadPerHour,
      createsPerHour: cfg.rateCreatePerHour
    },
    errors: []
  };
  function safeCount(name) {
    try {
      return readRows_(name).length;
    } catch (err) {
      out.errors.push(name + ": " + (err && err.message ? err.message : err));
      return 0;
    }
  }
  out.counts.events = safeCount("Events");
  out.counts.photos = safeCount("Photos");
  out.counts.templates = safeCount("Templates");
  out.counts.printOrders = safeCount("PrintOrders");
  out.counts.rsvp = safeCount("RSVP");
  out.counts.guestbook = safeCount("Guestbook");
  if (!out.rootFolderId) {
    try {
      var it = DriveApp.getFoldersByName(cfg.rootFolderName);
      out.rootFolderId = it.hasNext() ? it.next().getId() : null;
    } catch (err) {
      out.errors.push("drive: " + (err && err.message ? err.message : err));
    }
  }
  out.ready = out.sheetConfigured && out.sessionConfigured && out.errors.length === 0;
  return out;
}
