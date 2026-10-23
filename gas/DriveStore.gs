/* Backend penyimpanan Google Drive untuk Web App GAS.

   Layout di Drive (folder dibuat oleh app ini sendiri):

     <DRIVE_ROOT_FOLDER_NAME>/          ← default "Satu-Album"
       event-<slug>/
         event.json                     ← metadata acara (nama, preset, revealAt, uploadKey, count)
         photo-<timestamp>-<n>.jpg      ← foto asli

   `event.json` adalah SUMBER KEBENARAN: karena itu album tetap hidup walau
   eksekusi GAS selesai atau deployment dibuat ulang.

   Perbedaan dari versi Express (server/src/drive-store.js):
     - Folder acara TIDAK dibagikan publik; hanya file foto yang publik
       (Anyone with the link). Dengan begitu `event.json` yang memuat
       `uploadKey` tidak bisa diunduh orang lain.
     - Cache tidak lagi in-memory Map, tapi CacheService (lihat Lib.gs).
     - Scope OAuth `drive` (bukan `drive.file`) supaya folder album dari versi
       Express lama tetap terbaca. */

var DRIVE_META_FILE = "event.json";
var DRIVE_FOLDER_PREFIX = "event-";
/* Penjaga agar satu eksekusi tidak menembus batas waktu/kuota Drive. */
var DRIVE_MAX_EVENT_FOLDERS = 500;
var DRIVE_MAX_PHOTOS = 5000;

function folderNameFor_(slug) {
  return DRIVE_FOLDER_PREFIX + slug;
}

function slugFromFolderName_(name) {
  var text = String(name || "");
  if (text.indexOf(DRIVE_FOLDER_PREFIX) !== 0) return "";
  return text.slice(DRIVE_FOLDER_PREFIX.length);
}

function firstChild_(folder, name) {
  var it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

/* ── Root folder ──────────────────────────────────────────────────────── */

/** Root folder album; dibuat otomatis bila belum ada (ID disimpan di Properties). */
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

function findEventFolder_(slug) {
  var root = driveRoot_();
  var it = root.getFoldersByName(folderNameFor_(slug));
  return it.hasNext() ? it.next() : null;
}

function ensureEventFolder_(slug) {
  var root = driveRoot_();
  var it = root.getFoldersByName(folderNameFor_(slug));
  if (it.hasNext()) return it.next();
  return root.createFolder(folderNameFor_(slug));
}

/* ── Metadata event.json ──────────────────────────────────────────────── */

/** Hanya field yang memang bagian dari metadata acara (kolom runtime dibuang). */
function toPersisted_(meta, slug) {
  return {
    version: 1,
    id: meta.id,
    slug: slug || meta.slug,
    name: meta.name,
    type: meta.type || "lainnya",
    preset: meta.preset || "funsaver",
    revealAt: meta.revealAt || null,
    createdAt: meta.createdAt,
    uploadKey: meta.uploadKey,
    count: Number(meta.count || 0),
    countUpdatedAt: meta.countUpdatedAt || null,
    legacy: meta.legacy ? true : undefined
  };
}

function normalizeMeta_(raw, folder, metaFileId) {
  var data = raw || {};
  var slug = String(data.slug || (folder ? slugFromFolderName_(folder.getName()) : "")).trim();
  return {
    version: 1,
    id: data.id || makeEventId_(),
    slug: slug,
    name: data.name || slug,
    type: data.type || "lainnya",
    preset: data.preset || "funsaver",
    revealAt: data.revealAt || null,
    createdAt: toIso_(data.createdAt || (folder ? folder.getDateCreated() : null)),
    uploadKey: data.uploadKey || "",
    count: Number(data.count || 0),
    countUpdatedAt: data.countUpdatedAt || null,
    legacy: Boolean(data.legacy),
    folderId: folder ? folder.getId() : null,
    metaFileId: metaFileId || null
  };
}

/** Baca `event.json` di sebuah folder; folder lama tanpa metadata disintesis. */
function readMetaFromFolder_(folder) {
  var slug = slugFromFolderName_(folder.getName());
  var file = firstChild_(folder, DRIVE_META_FILE);
  if (!file) {
    /* Folder dari versi lama (tanpa event.json): metadata disintesis + kunci
       tamu baru, lalu ditulis agar tidak diulang setiap kali dibaca. */
    var legacy = normalizeMeta_({ slug: slug, name: slug, legacy: true }, folder, null);
    legacy.uploadKey = makeUploadKey_();
    try {
      return writeEventMeta_(slug, legacy, folder);
    } catch (err) {
      Logger.log("[drive] gagal menulis event.json untuk " + slug + ": " + err);
      return legacy;
    }
  }
  var raw = {};
  try {
    raw = JSON.parse(file.getBlob().getDataAsString("UTF-8")) || {};
  } catch (err) {
    Logger.log("[drive] event.json rusak di " + slug + ", memakai metadata minimal: " + err);
    raw = {};
  }
  var meta = normalizeMeta_(raw, folder, file.getId());
  if (!meta.uploadKey) {
    meta.uploadKey = makeUploadKey_();
    try {
      meta = writeEventMeta_(slug, meta, folder);
    } catch (err) {
      Logger.log("[drive] gagal menyimpan kunci tamu " + slug + ": " + err);
    }
  }
  return meta;
}

function writeEventMeta_(slug, meta, folder) {
  var target = folder || ensureEventFolder_(slug);
  var record = toPersisted_(Object.assign({}, meta, { slug: slug }), slug);
  var text = JSON.stringify(record, null, 2);
  var existing = firstChild_(target, DRIVE_META_FILE);
  var saved;
  try {
    if (existing) {
      existing.setContent(text);
      saved = existing;
    } else {
      saved = target.createFile(Utilities.newBlob(text, "application/json", DRIVE_META_FILE));
    }
  } catch (err) {
    fail_("gagal menyimpan event.json: " + (err && err.message ? err.message : err), 502, "drive-error");
  }
  cacheRemove_("events");
  cacheRemove_("event:" + slug);
  return normalizeMeta_(record, target, saved.getId());
}

/* ── Baca daftar acara ────────────────────────────────────────────────── */

/** Daftar acara = semua folder `event-*` di dalam root + isi event.json-nya. */
function listEvents_(force) {
  if (!force) {
    var cached = cacheGetJson_("events");
    if (cached) return cached;
  }
  var root = driveRoot_();
  var folders = root.getFolders();
  var metas = [];
  var guard = 0;
  while (folders.hasNext() && guard < DRIVE_MAX_EVENT_FOLDERS) {
    guard += 1;
    var folder = folders.next();
    var name = folder.getName();
    if (name.indexOf(DRIVE_FOLDER_PREFIX) !== 0) continue;
    if (!slugFromFolderName_(name)) continue;
    try {
      metas.push(readMetaFromFolder_(folder));
    } catch (err) {
      Logger.log("[drive] folder " + name + " dilewati: " + err);
    }
  }
  metas.sort(function (a, b) {
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
  cachePutJson_("events", metas, config_().cacheTtlSec);
  return metas;
}

/** Satu acara: pakai cache bila hangat, kalau tidak baca folder itu langsung. */
function getEventMeta_(slug, force) {
  if (!force) {
    var cachedEvents = cacheGetJson_("events");
    if (cachedEvents) {
      for (var i = 0; i < cachedEvents.length; i += 1) {
        if (cachedEvents[i].slug === slug) return cachedEvents[i];
      }
    }
    var cachedOne = cacheGetJson_("event:" + slug);
    if (cachedOne) return cachedOne;
  }
  var folder = findEventFolder_(slug);
  if (!folder) return null;
  var meta = readMetaFromFolder_(folder);
  cachePutJson_("event:" + slug, meta, config_().cacheTtlSec);
  return meta;
}

/* ── Tulisan acara ────────────────────────────────────────────────────── */

function createEventMeta_(params) {
  var name = String(params.name || "").trim();
  if (!name) fail_("name is required", 400, "bad-request");
  if (name.length > 120) fail_("nama acara maksimal 120 karakter", 400, "bad-request");

  var taken = {};
  var events = listEvents_(true);
  for (var i = 0; i < events.length; i += 1) taken[events[i].slug] = true;

  var slug = uniqueSlug_(slugify_(name), taken);
  var meta = {
    id: makeEventId_(),
    slug: slug,
    name: name,
    type: params.type || "lainnya",
    preset: params.preset || "funsaver",
    revealAt: params.revealAt || null,
    createdAt: new Date().toISOString(),
    uploadKey: makeUploadKey_(),
    count: 0,
    countUpdatedAt: null
  };
  var saved;
  try {
    saved = writeEventMeta_(slug, meta);
  } catch (err) {
    if (err instanceof ApiFailure) throw err;
    fail_("gagal membuat acara: " + (err && err.message ? err.message : err), 502, "create-failed");
  }
  cachePutJson_("photos:" + slug, [], config_().cacheTtlSec);
  return presentEvent_(saved, true);
}

function updateEventMeta_(slug, patch) {
  var data = patch || {};
  var meta = getEventMeta_(slug, true);
  if (!meta) return null;
  var updated = Object.assign({}, meta, {
    name: data.name !== undefined && data.name !== null ? String(data.name).trim() : meta.name,
    type: data.type !== undefined && data.type !== null ? data.type : meta.type,
    preset: data.preset !== undefined && data.preset !== null ? data.preset : meta.preset,
    revealAt: data.revealAt !== undefined ? data.revealAt : meta.revealAt,
    /* rotateUploadKey: cabut link lama yang sudah tersebar. */
    uploadKey: data.rotateUploadKey ? makeUploadKey_() : meta.uploadKey,
    countUpdatedAt: new Date().toISOString()
  });
  var saved = writeEventMeta_(slug, updated);
  return presentEvent_(saved, true);
}

function trashEvent_(slug) {
  var folder = findEventFolder_(slug);
  if (!folder) return false;
  folder.setTrashed(true);
  cacheRemove_("events");
  cacheRemove_("event:" + slug);
  cacheRemove_("photos:" + slug);
  return true;
}

/** Metadata publik acara. `uploadKey` hanya disertakan bila dipinta (admin). */
function presentEvent_(meta, withKey) {
  if (!meta) return null;
  var event = {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    type: meta.type || "lainnya",
    preset: meta.preset || "funsaver",
    revealAt: meta.revealAt || null,
    createdAt: meta.createdAt,
    count: Number(meta.count || 0),
    legacy: Boolean(meta.legacy)
  };
  if (withKey) event.uploadKey = meta.uploadKey;
  return event;
}

/* ── Foto ─────────────────────────────────────────────────────────────── */

/* URL thumbnail Drive: `uc?export=view` sering gagal render, sedangkan
   `thumbnail?id=&sz=w<lebar>` stabil dan tidak butuh API key. */
function imageUrl_(fileId, width) {
  return "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w" + width;
}

function photoFileName_(ext) {
  return "photo-" + Date.now() + "-" + Math.floor(Math.random() * 1000000) + "." + ext;
}

function toPhoto_(slug, file, mime) {
  var cfg = config_();
  var id = file.getId();
  var size = null;
  try {
    size = typeof file.getSize() === "number" ? file.getSize() : null;
  } catch (err) {
    size = null;
  }
  return {
    id: id,
    eventSlug: slug,
    name: file.getName(),
    url: imageUrl_(id, cfg.imageWidth),
    thumb: imageUrl_(id, cfg.thumbWidth),
    source: "drive",
    createdAt: toIso_(file.getDateCreated()),
    size: size,
    mime: mime || null
  };
}

/** Daftar foto sebuah acara (hanya berkas gambar; event.json dilewati). */
function listPhotos_(slug, options) {
  var opts = options || {};
  var cfg = config_();
  var limit = Math.min(Number(opts.limit) || DRIVE_MAX_PHOTOS, DRIVE_MAX_PHOTOS);
  var cacheKey = "photos:" + slug;
  var all = opts.force ? null : cacheGetJson_(cacheKey);
  if (!all) {
    var folder = findEventFolder_(slug);
    if (!folder) return [];
    var files = folder.getFiles();
    all = [];
    var guard = 0;
    while (files.hasNext() && guard < limit) {
      guard += 1;
      var file = files.next();
      var mime = String(file.getMimeType() || "");
      if (mime.indexOf("image/") !== 0) continue;
      all.push(toPhoto_(slug, file, mime));
    }
    all.sort(function (a, b) {
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
    cachePutJson_(cacheKey, all, cfg.cacheTtlSec);
  }
  return all.slice(0, limit);
}

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

function addPhoto_(params) {
  var cfg = config_();
  var folder = ensureEventFolder_(params.slug);
  var ext = params.mime === "image/png" ? "png" : params.mime === "image/webp" ? "webp" : "jpg";
  var name = photoFileName_(ext);
  var blob = Utilities.newBlob(params.bytes, params.mime, name);
  var file;
  try {
    file = folder.createFile(blob);
  } catch (err) {
    fail_("gagal mengunggah foto: " + (err && err.message ? err.message : err), 502, "drive-error");
  }
  shareAnyone_(file, name);
  var photo = toPhoto_(params.slug, file, params.mime);
  cacheRemove_("photos:" + params.slug);
  bumpCount_(params.slug, 1, folder);
  return { photo: photo, imageWidth: cfg.imageWidth };
}

/**
 * Naik/turunkan `count` di event.json tanpa membaca ulang seluruh folder.
 * `refresh=1` pada action `photos` memakai reconcileCount_ untuk memperbaiki
 * bila pernah ada ketidakcocokan (mis. dua unggahan bersamaan).
 */
function bumpCount_(slug, delta, folder) {
  var target = folder || findEventFolder_(slug);
  if (!target) return null;
  var meta = readMetaFromFolder_(target);
  meta.count = Math.max(0, Number(meta.count || 0) + Number(delta || 0));
  meta.countUpdatedAt = new Date().toISOString();
  try {
    return writeEventMeta_(slug, meta, target);
  } catch (err) {
    Logger.log("[drive] gagal memperbarui count " + slug + ": " + err);
    return null;
  }
}

/** Selaraskan `count` di event.json dengan jumlah berkas nyata di folder. */
function reconcileCount_(slug, actual) {
  var folder = findEventFolder_(slug);
  if (!folder) return null;
  var meta = readMetaFromFolder_(folder);
  if (Number(meta.count) === Number(actual) && meta.countUpdatedAt) return meta;
  meta.count = Number(actual);
  meta.countUpdatedAt = new Date().toISOString();
  try {
    return writeEventMeta_(slug, meta, folder);
  } catch (err) {
    Logger.log("[drive] gagal menyelaraskan count " + slug + ": " + err);
    return meta;
  }
}

function removePhoto_(slug, photoId) {
  var file;
  try {
    file = DriveApp.getFileById(photoId);
  } catch (err) {
    return null; /* sudah tidak ada */
  }
  if (file.isTrashed()) return null;
  var folder = findEventFolder_(slug);
  if (folder) {
    var folderId = folder.getId();
    var parents = file.getParents();
    var inEvent = false;
    while (parents.hasNext()) {
      if (parents.next().getId() === folderId) {
        inEvent = true;
        break;
      }
    }
    if (!inEvent) fail_("foto bukan milik acara ini", 403, "not-in-event");
  }
  var photo = toPhoto_(slug, file, String(file.getMimeType() || ""));
  file.setTrashed(true);
  cacheRemove_("photos:" + slug);
  bumpCount_(slug, -1, folder);
  return photo;
}

/* ── Kesehatan & statistik ────────────────────────────────────────────── */

function health_(options) {
  var cfg = config_();
  var rootId = cfg.rootFolderId;
  if (!rootId) {
    /* Sengaja tidak membuat folder di jalur ini (health boleh dipanggil siapa saja). */
    var it = DriveApp.getFoldersByName(cfg.rootFolderName);
    if (it.hasNext()) rootId = it.next().getId();
  }
  var cachedEvents = cacheGetJson_("events");
  var total = cachedEvents ? cachedEvents.length : null;
  if (options && options.force) total = listEvents_(true).length;
  return {
    mode: "drive",
    ready: true,
    version: cfg.version,
    rootFolderName: cfg.rootFolderName,
    rootFolderId: rootId || null,
    adminConfigured: cfg.adminTokens.length > 0,
    events: total,
    cache: { ttlSec: cfg.cacheTtlSec, eventsCached: Boolean(cachedEvents) },
    limits: {
      maxUploadBytes: cfg.maxUploadBytes,
      maxPhotosPerEvent: cfg.maxPhotosPerEvent,
      undoWindowMs: cfg.undoWindowMs,
      uploadsPerHour: cfg.rateUploadPerHour,
      createsPerHour: cfg.rateCreatePerHour
    }
  };
}



