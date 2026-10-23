/* Utilitas manual Satu-Album. Fungsi di file ini TIDAK dipanggil lewat HTTP —
   jalankan dari editor Apps Script (pilih fungsi → Run) atau lewat menu
   "Run" untuk menyiapkan Drive, memeriksa kesehatan, dan menguji end-to-end. */

/** Jalankan sekali setelah mengisi Script Properties. */
function setupDrive() {
  var cfg = config_();
  var root = driveRoot_();
  var report = [
    "root folder   : " + root.getName() + " (" + root.getId() + ")",
    "ADMIN_TOKEN   : " + (cfg.adminTokens.length ? "terisi (" + cfg.adminTokens.length + " token)" : "BELUM DIISI → Project Settings → Script properties"),
    "batas unggah  : " + Math.round(cfg.maxUploadBytes / 1024 / 1024) + " MB per foto, " + cfg.maxPhotosPerEvent + " foto per album",
    "jendela Undo  : " + Math.round(cfg.undoWindowMs / 1000) + " detik",
    "cache         : " + cfg.cacheTtlSec + " detik",
    "jumlah album  : " + listEvents_(true).length
  ].join("\n");
  Logger.log(report);
  return report;
}

/** Simpan token panitia tanpa menempelkannya di kode (bisa dipisah koma). */
function setAdminToken(token) {
  var saved = setConfigProperty_("ADMIN_TOKEN", token);
  Logger.log("ADMIN_TOKEN tersimpan (" + saved.adminTokens.length + " token aktif, " + String(token || "").length + " karakter).");
  return saved.adminTokens.length;
}

/** Kesehatan penyimpanan + batas yang berlaku (sama dengan action=health). */
function showHealth() {
  var text = JSON.stringify(health_({ force: true }), null, 2);
  Logger.log(text);
  return text;
}

/** Daftar album beserta kunci tamunya (hanya untuk panitia). */
function showEvents() {
  var events = listEvents_(true).map(function (meta) {
    return presentEvent_(meta, true);
  });
  var text = JSON.stringify(events, null, 2);
  Logger.log(text);
  return text;
}

/** Padanan `npm run sync` versi lama: perbaiki `count` di setiap event.json. */
function syncAlbumMetadata() {
  var cfg = config_();
  var events = listEvents_(true);
  var lines = [];
  for (var i = 0; i < events.length; i += 1) {
    var slug = events[i].slug;
    var photos = listPhotos_(slug, { force: true, limit: cfg.maxPhotosPerEvent + 500 });
    var bytes = 0;
    for (var j = 0; j < photos.length; j += 1) bytes += Number(photos[j].size || 0);
    reconcileCount_(slug, photos.length);
    lines.push(
      "- " + slug + ": " + photos.length + " foto, " + Math.round((bytes / 1024 / 1024) * 10) / 10 + " MB" +
        (events[i].legacy ? " [legacy]" : "")
    );
  }
  var report = lines.length ? lines.join("\n") : "(belum ada album)";
  Logger.log(report);
  return report;
}

/* PNG 1×1 (70 byte) yang valid — dipakai selfTest() untuk membuktikan jalur
   validasi → simpan → baca → hapus tanpa perlu file contoh di repo. */
var SETUP_TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==";

/** Uji end-to-end di dalam Drive Anda sendiri: buat album → unggah → baca →
 *  hapus foto → hapus album. Semua yang dibuat ikut dibersihkan (folder masuk
 *  Trash Drive, masih bisa dipulihkan ±30 hari). */
function selfTest() {
  var lines = [];
  var name = "Uji Satu-Album " + new Date().toISOString().slice(0, 16).replace("T", " ");
  var event = createEventMeta_({ name: name, type: "lainnya", preset: "funsaver" });
  lines.push("buat album       : " + event.slug + " (kunci " + String(event.uploadKey).slice(0, 8) + "…)");

  var bytes = bytesFromBase64_(SETUP_TEST_PNG_BASE64);
  var check = validateImage_(bytes, config_().allowedMime, "image/png");
  lines.push(
    "validasi gambar  : " +
      (check.ok ? "ok (" + check.mime + ", " + bytes.length + " byte)" : "GAGAL → " + check.error)
  );

  var added = addPhoto_({ slug: event.slug, bytes: bytes, mime: check.mime });
  lines.push("unggah foto      : " + added.photo.id + " (" + added.photo.thumb + ")");

  var listed = listPhotos_(event.slug, { force: true });
  lines.push("baca daftar foto : " + listed.length + " foto");

  var meta = getEventMeta_(event.slug, true);
  lines.push("count di event   : " + (meta ? meta.count : "?"));

  var removed = removePhoto_(event.slug, added.photo.id);
  lines.push("hapus foto       : " + (removed ? "ok" : "GAGAL"));

  lines.push("hapus album      : " + (trashEvent_(event.slug) ? "ok (folder → Trash Drive)" : "GAGAL"));

  var report = lines.join("\n");
  Logger.log(report);
  return report;
}

