/* Logika acara (event) di atas Google Sheets + Google Drive.

   Satu baris tab `Events` = satu acara:
     event_id, slug, nama, jenis, tanggal, lokasi, join_key,
     drive_folder_id, preset, reveal_at, aktif, dibuat_pada

   `join_key` adalah kunci tamu 32 hex yang ikut di link kamera/galeri:
     <BASE_URL>#/camera/<slug>?k=<join_key>
   Link ini diubah menjadi QR (sisi admin, lihat web/admin.js).

   `drive_folder_id` menunjuk folder Drive milik acara; folder TIDAK dibagikan
   publik — hanya berkas foto yang dibagikan (lihat DriveStore.gs). */

/* ── Presentasi ───────────────────────────────────────────────────────── */

/**
 * Ubah baris Sheets menjadi objek JSON siap kirim.
 * @param {Object} row      baris tab Events
 * @param {number} photoCount jumlah foto (opsional)
 */
function presentEventRow_(row, photoCount) {
  var count = Number(photoCount);
  return {
    id: String(row.event_id),
    slug: String(row.slug),
    nama: String(row.nama || ""),
    jenis: String(row.jenis || "lainnya"),
    tanggal: row.tanggal ? normalizeDate_(row.tanggal) : null,
    lokasi: String(row.lokasi || ""),
    preset: String(row.preset || "funsaver"),
    revealAt: row.reveal_at ? toIso_(row.reveal_at) : null,
    aktif: isActive_(row.aktif),
    createdAt: row.dibuat_pada ? toIso_(row.dibuat_pada) : null,
    count: isFinite(count) ? count : undefined,
    driveFolderId: String(row.drive_folder_id || "")
  };
}

/** Tanggal acara boleh "2026-11-01" (teks) atau datetime; disimpan apa adanya. */
function normalizeDate_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, "GMT+7", "yyyy-MM-dd");
  var text = String(value || "").trim();
  if (!text) return null;
  return text;
}

/** Hitung jumlah foto per event sekaligus (satu kali baca tab Photos). */
function photoCountsByEvent_() {
  var counts = {};
  var rows = readRows_("Photos");
  for (var i = 0; i < rows.length; i += 1) {
    var id = String(rows[i].event_id);
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

/**
 * Link publik sebuah acara (dipakai QR & payload admin).
 * @param {Object} row baris Events
 * @param {string} baseUrl URL situs GitHub Pages (mis. https://user.github.io/Satu-Album)
 */
function eventLinks_(row, baseUrl) {
  var base = String(baseUrl || "").replace(/[\/#]+$/, "");
  var slug = String(row.slug);
  var key = String(row.join_key || "");
  var secret = "?k=" + encodeURIComponent(key);
  return {
    camera: base + "/camera.html#" + slug + secret,
    galeri: base + "/galeri.html#" + slug + secret,
    undangan: base + "/undangan.html#" + slug + secret,
    rsvp: base + "/rsvp.html#" + slug + secret
  };
}

/* ── Baca ──────────────────────────────────────────────────────────────── */

/** Daftar acara untuk dasbor admin (termasuk yang nonaktif). */
function listEventsForAdmin_() {
  var rows = listEventRows_(false);
  var counts = photoCountsByEvent_();
  rows.sort(function (a, b) {
    return String(b.dibuat_pada).localeCompare(String(a.dibuat_pada));
  });
  var baseUrl = publicBaseUrl_();
  return rows.map(function (row) {
    var event = presentEventRow_(row, counts[String(row.event_id)] || 0);
    event.joinKey = String(row.join_key || "");
    event.links = eventLinks_(row, baseUrl);
    return event;
  });
}

/**
 * Cari acara berdasarkan slug dan validasi kunci tamu.
 * @param {string} slug
 * @param {string} key  kunci dari link kamera/galeri
 * @return {Object} { row, authorized }
 */
function eventBySlugForGuest_(slug, key) {
  var row = findEventBySlug_(String(slug || "").trim());
  if (!row) fail_("event not found", 404, "not-found");
  if (!isActive_(row.aktif)) fail_("acara sudah tidak aktif", 410, "event-inactive");
  var authorized = Boolean(key) && secretsEqual_(String(row.join_key || "x"), String(key));
  return { row: row, authorized: authorized, event: presentEventRow_(row) };
}

/* ── Tulis ─────────────────────────────────────────────────────────────── */

/** Kumpulan slug yang sudah dipakai. */
function takenSlugs_() {
  var taken = {};
  var rows = readRows_("Events");
  for (var i = 0; i < rows.length; i += 1) taken[String(rows[i].slug)] = true;
  return taken;
}

/**
 * Buat acara baru: baris di Sheets + folder Drive + template undangan awal.
 * @param {Object} input { nama, jenis, tanggal, lokasi, preset, revealAt }
 */
function createEvent_(input) {
  var data = input || {};
  var nama = String(data.nama || data.name || "").trim();
  if (!nama) fail_("nama acara wajib diisi", 400, "bad-request");
  if (nama.length > 120) fail_("nama acara maksimal 120 karakter", 400, "bad-request");

  var cfg = config_();
  var gate = rateLimit_("create", cfg.rateCreatePerHour, 3600);
  if (!gate.allowed) fail_("terlalu banyak acara dibuat, coba lagi nanti", 429, "rate-limited");

  var slug = uniqueSlug_(slugify_(nama), takenSlugs_());
  var eventId = makeEventId_();
  /* Buat folder Drive DULU agar baris Sheets tidak menunjuk folder kosong. */
  var folder;
  try {
    folder = ensureEventFolder_(slug, nama);
  } catch (err) {
    if (err instanceof ApiFailure) throw err;
    fail_("gagal membuat folder Drive: " + (err && err.message ? err.message : err), 502, "drive-error");
  }

  var row = appendRow_("Events", {
    event_id: eventId,
    slug: slug,
    nama: nama,
    jenis: String(data.jenis || data.type || "lainnya"),
    tanggal: normalizeDate_(data.tanggal) || "",
    lokasi: String(data.lokasi || ""),
    join_key: makeUploadKey_(),
    drive_folder_id: folder.getId(),
    preset: String(data.preset || "funsaver"),
    reveal_at: data.revealAt ? toIso_(data.revealAt) : "",
    aktif: "TRUE",
    dibuat_pada: new Date().toISOString()
  });

  /* Template undangan default supaya halaman undangan langsung bisa dibuka. */
  try {
    upsertTemplate_(eventId, defaultTemplate_(nama));
  } catch (err) {
    Logger.log("[events] template default gagal dibuat untuk " + slug + ": " + err);
  }
  cacheRemove_("event:" + slug);
  cacheRemove_("photos:" + slug);

  var event = presentEventRow_(row, 0);
  event.joinKey = String(row.join_key);
  event.links = eventLinks_(row, publicBaseUrl_());
  return event;
}

/**
 * Ubah field acara. `rotateKey: true` menerbitkan kunci tamu baru (link lama
 * otomatis batal).
 */
function updateEvent_(input) {
  var data = input || {};
  var slug = String(data.slug || "").trim();
  if (!slug) fail_("slug wajib diisi", 400, "bad-request");
  var row = findEventBySlug_(slug);
  if (!row) fail_("event not found", 404, "not-found");

  var patch = {};
  if (data.nama !== undefined && data.nama !== null && String(data.nama).trim()) {
    patch.nama = String(data.nama).trim().slice(0, 120);
  }
  if (data.jenis !== undefined) patch.jenis = String(data.jenis || "lainnya");
  if (data.type !== undefined) patch.jenis = String(data.type || "lainnya");
  if (data.tanggal !== undefined) patch.tanggal = normalizeDate_(data.tanggal) || "";
  if (data.lokasi !== undefined) patch.lokasi = String(data.lokasi || "");
  if (data.preset !== undefined) patch.preset = String(data.preset || "funsaver");
  if (data.revealAt !== undefined) patch.reveal_at = data.revealAt ? toIso_(data.revealAt) : "";
  if (data.aktif !== undefined) patch.aktif = data.aktif ? "TRUE" : "FALSE";
  if (data.rotateKey) patch.join_key = makeUploadKey_();

  if (Object.keys(patch).length) updateRow_("Events", row._row, patch);
  var fresh = findEventBySlug_(slug) || row;
  cacheRemove_("event:" + slug);
  cacheRemove_("events");

  var counts = photoCountsByEvent_();
  var event = presentEventRow_(fresh, counts[String(fresh.event_id)] || 0);
  event.joinKey = String(fresh.join_key || "");
  event.links = eventLinks_(fresh, publicBaseUrl_());
  return event;
}

/** Hapus acara: baris Sheets + template + folder Drive ke Trash. */
function deleteEvent_(input) {
  var slug = String((input && input.slug) || "").trim();
  if (!slug) fail_("slug wajib diisi", 400, "bad-request");
  var row = findEventBySlug_(slug);
  if (!row) fail_("event not found", 404, "not-found");
  var eventId = String(row.event_id);
  var removed = { photos: 0, orders: 0, rsvp: 0, guestbook: 0, folderTrashed: false };

  /* Folder Drive bisa menentukan seluruh foto — kalau gagal, tetap lanjut. */
  if (row.drive_folder_id) {
    try {
      DriveApp.getFolderById(String(row.drive_folder_id)).setTrashed(true);
      removed.folderTrashed = true;
    } catch (err) {
      Logger.log("[events] folder " + row.drive_folder_id + " gagal di-trash: " + err);
    }
  }
  removed.photos = purgeEventRows_("Photos", eventId);
  removed.rsvp = purgeEventRows_("RSVP", eventId);
  removed.guestbook = purgeEventRows_("Guestbook", eventId);
  purgeEventRows_("Templates", eventId);
  var orders = readRows_("PrintOrders", function (r) {
    return String(r.event_id) === eventId;
  });
  for (var i = 0; i < orders.length; i += 1) {
    purgeEventRows_("PrintItems", null, String(orders[i].order_id));
  }
  removed.orders = orders.length;
  purgeEventRows_("PrintOrders", eventId);
  deleteRow_("Events", row._row);

  cacheRemove_("event:" + slug);
  cacheRemove_("photos:" + slug);
  cacheRemove_("events");
  return removed;
}

/**
 * Hapus semua baris tab `name` milik event (atau milik order).
 * Menghapus dari bawah ke atas agar nomor baris di atasnya tidak bergeser.
 */
function purgeEventRows_(name, eventId, orderId) {
  var rows = readRows_(name, function (r) {
    if (orderId) return String(r.order_id) === orderId;
    return String(r.event_id) === String(eventId);
  });
  rows.sort(function (a, b) {
    return b._row - a._row;
  });
  for (var i = 0; i < rows.length; i += 1) deleteRow_(name, rows[i]._row);
  return rows.length;
}

/** Ambil baris Events berdasarkan slug atau gagal 404. */
function eventRowOrFail_(slug) {
  var row = findEventBySlug_(String(slug || "").trim());
  if (!row) fail_("event not found", 404, "not-found");
  return row;
}
