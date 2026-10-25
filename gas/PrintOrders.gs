/* PrintOrders.gs — Daftar Cetak (guest memilih foto, admin memproses).

   Alur:
     1. Tamu memilih beberapa foto di galeri → action=createPrintOrder
        dengan `photoIds[]` (id = Drive file ID) + data pemesan.
     2. Server memvalidasi setiap foto benar milik acara tersebut, lalu
        menulis 1 baris di tab PrintOrders + N baris di tab PrintItems.
     3. Admin memantau/mengubah status lewat action=listPrintOrders /
        updatePrintOrderStatus.

   Deduplikasi: order identik (kontak + set foto sama) dalam 5 menit
   dianggap dobel klik dan mengembalikan order yang sudah ada. */

var PRINT_MAX_PHOTOS_PER_ORDER = 50;
var PRINT_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
var PRINT_RATE_PER_HOUR = 15;

function cleanOrderText_(value, maxLen, label, required) {
  var text = String(value === undefined || value === null ? "" : value).trim();
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  if (required && !text) throw fail_(label + " wajib diisi.", 400, "missing-" + String(label).toLowerCase());
  if (text.length > maxLen) text = text.slice(0, maxLen);
  return text;
}

/** Normalisasi daftar photoIds → array unik. */
function normalizePhotoIds_(input) {
  var raw = (input && (input.photoIds || input.photos || input.ids)) || [];
  if (typeof raw === "string") {
    raw = raw
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
  }
  if (!Array.isArray(raw)) throw fail_("photoIds harus berupa daftar.", 400, "bad-photo-ids");
  var seen = {};
  var out = [];
  raw.forEach(function (id) {
    var key = String(id || "").trim();
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(key);
  });
  return out;
}

function presentPrintOrder_(row, items) {
  var list = (items || []).map(function (item) {
    return {
      id: item.item_id || "",
      photoId: item.photo_id || "",
      url: item.url || "",
      thumb: imageUrl_(item.photo_id || "", config_().thumbWidth),
      jumlah: Number(item.jumlah) || 1,
      ukuran: item.ukuran_cetak || ""
    };
  });
  return {
    id: row.order_id || "",
    eventId: row.event_id || "",
    namaPemesan: row.nama_pemesan || "",
    kontak: row.kontak || "",
    alamat: row.alamat || "",
    catatan: row.catatan || "",
    status: row.status || "baru",
    totalFoto: Number(row.total_foto) || list.length,
    createdAt: toIso_(row.dibuat_pada),
    items: list
  };
}

/** Buat order cetak. `eventRow` sudah tervalidasi join_key oleh router. */
function createPrintOrder_(eventRow, input, e) {
  var slug = eventRow.slug;
  rateLimit_("print:" + slug, PRINT_RATE_PER_HOUR, 3600);

  var photoIds = normalizePhotoIds_(input);
  if (!photoIds.length) throw fail_("Pilih minimal satu foto untuk dicetak.", 400, "no-photos");
  if (photoIds.length > PRINT_MAX_PHOTOS_PER_ORDER) {
    throw fail_("Maksimal " + PRINT_MAX_PHOTOS_PER_ORDER + " foto per pesanan cetak.", 400, "too-many-photos");
  }

  var nama = cleanOrderText_(input.namaPemesan || input.nama, 100, "Nama", true);
  var kontak = cleanOrderText_(input.kontak, 60, "Kontak", true);
  var alamat = cleanOrderText_(input.alamat, 400, "Alamat", false);
  var catatan = cleanOrderText_(input.catatan, 400, "Catatan", false);
  var ukuran = cleanOrderText_(input.ukuranCetak, 40, "Ukuran", false) || "4R";

  /* Validasi: setiap foto harus milik acara ini. */
  var photoMap = {};
  listPhotoRowsByEvent_(eventRow.event_id).forEach(function (row) {
    photoMap[row.photo_id] = row;
  });
  var missing = photoIds.filter(function (id) {
    return !photoMap[id];
  });
  if (missing.length) {
    throw fail_("Sebagian foto tidak ditemukan pada acara ini.", 400, "photo-not-found");
  }

  /* Deduplikasi dobel-klik: kontak + set foto sama dalam 5 menit. */
  var recent = listPrintOrdersByEvent_(eventRow.event_id) || [];
  var signature = kontak + "|" + photoIds.slice().sort().join(",");
  var nowMs = new Date().getTime();
  for (var i = 0; i < recent.length; i++) {
    var prev = recent[i];
    var prevMs = new Date(prev.dibuat_pada).getTime();
    if (!isFinite(prevMs) || nowMs - prevMs > PRINT_DEDUPE_WINDOW_MS) continue;
    var prevSignature = String(prev.kontak || "") + "|" + (listPrintItems_(prev.order_id) || []).map(function (it) { return it.photo_id; }).sort().join(",");
    if (prevSignature === signature) {
      return { order: presentPrintOrder_(prev, listPrintItems_(prev.order_id)), duplicate: true };
    }
  }

  var nowIso = toIso_(new Date());
  var orderRow = {
    order_id: makeRowId_("ord"),
    event_id: eventRow.event_id,
    nama_pemesan: nama,
    kontak: kontak,
    alamat: alamat,
    catatan: catatan,
    status: "baru",
    total_foto: photoIds.length,
    dibuat_pada: nowIso
  };
  appendRow_("PrintOrders", orderRow);

  appendRows_(
    "PrintItems",
    photoIds.map(function (id) {
      return {
        item_id: makeRowId_("itm"),
        order_id: orderRow.order_id,
        photo_id: id,
        url: imageUrl_(id, config_().imageWidth),
        jumlah: 1,
        ukuran_cetak: ukuran
      };
    })
  );

  cacheRemove_("printcount:" + eventRow.event_id);
  var created = findPrintOrder_(orderRow.order_id) || orderRow;
  return { order: presentPrintOrder_(created, listPrintItems_(orderRow.order_id)), duplicate: false };
}

/** Daftar order untuk admin (opsional filter status). Item dimuat sekaligus. */
function listOrdersForEvent_(eventRow, status) {
  var rows = listPrintOrdersByEvent_(eventRow.event_id, status) || [];
  rows.sort(function (a, b) {
    return String(b.dibuat_pada || "").localeCompare(String(a.dibuat_pada || ""));
  });
  var items = rows.map(function (row) {
    return presentPrintOrder_(row, listPrintItems_(row.order_id));
  });
  var counts = { baru: 0, diproses: 0, selesai: 0, dibatalkan: 0 };
  /* Hitung dari SEMUA order acara, bukan hanya filter aktif. */
  listPrintOrdersByEvent_(eventRow.event_id).forEach(function (row) {
    var key = String(row.status || "baru").toLowerCase();
    if (counts[key] === undefined) counts[key] = 0;
    counts[key] += 1;
  });
  return { items: items, total: items.length, counts: counts };
}

function updateOrderStatus_(eventRow, input) {
  var orderId = String((input && (input.orderId || input.id)) || "").trim();
  if (!orderId) throw fail_("orderId wajib diisi.", 400, "missing-order-id");
  var status = String((input && input.status) || "").trim().toLowerCase();
  if (PRINT_STATUS.indexOf(status) < 0) {
    throw fail_("Status harus salah satu dari: " + PRINT_STATUS.join(", "), 400, "bad-status");
  }
  var row = findPrintOrder_(orderId);
  if (!row || row.event_id !== eventRow.event_id) {
    throw fail_("Pesanan tidak ditemukan.", 404, "order-not-found");
  }
  updateRow_("PrintOrders", row._row, { status: status });
  cacheRemove_("printcount:" + eventRow.event_id);
  return presentPrintOrder_(findPrintOrder_(orderId), listPrintItems_(orderId));
}

/** Jumlah order berstatus "baru" (badge di dashboard admin). */
function pendingPrintCount_(eventId) {
  var cacheKey = "printcount:" + eventId;
  var cached = cacheGetJson_(cacheKey);
  if (cached) return Number(cached.count) || 0;
  var rows = listPrintOrdersByEvent_(eventId, "baru") || [];
  // cachePutJson_(cacheKey, { count: rows.length }, Math.min(60, config_().cacheTtlSec));
  return rows.length;
}
