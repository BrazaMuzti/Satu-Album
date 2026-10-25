/* Interactions.gs — RSVP & buku tamu tamu undangan.

   Keduanya memakai kunci tamu yang sama (`slug` + `k`) sehingga hanya orang
   yang memegang link undangan yang bisa mengisi. Data disimpan di tab `RSVP`
   dan `Guestbook` (lihat Sheets.gs).

   RSVP bersifat *upsert per kontak*: bila tamu mengirim ulang dengan kontak
   yang sama, baris lama diperbarui (bukan menumpuk jawaban ganda). */

var RSVP_MAX_PER_HOUR = 30;
var GUESTBOOK_MAX_PER_HOUR = 20;
var GUESTBOOK_MAX_ITEMS = 200;

/** Bersihkan teks masukan tamu (buang karakter kontrol, batasi panjang). */
function cleanGuestText_(value, maxLen, label, required) {
  var text = String(value === undefined || value === null ? "" : value).trim();
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  if (required && !text) fail_(label + " wajib diisi.", 400, "missing-" + String(label).toLowerCase());
  if (text.length > maxLen) text = text.slice(0, maxLen);
  return text;
}

/** "hadir"/"ya"/true → "TRUE"; "tidak"/false → "FALSE"; kosong → "" (tidak valid). */
function attendanceFlag_(value) {
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  var text = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
  if (!text) return "";
  if (["true", "1", "ya", "hadir", "yes", "y"].indexOf(text) >= 0) return "TRUE";
  if (["false", "0", "tidak", "tidak hadir", "no", "n"].indexOf(text) >= 0) return "FALSE";
  return "";
}

function presentRsvp_(row) {
  return {
    id: String(row.rsvp_id || ""),
    eventId: String(row.event_id || ""),
    nama: String(row.nama || ""),
    kontak: String(row.kontak || ""),
    hadir: isActive_(row.hadir),
    jumlahTamu: Number(row.jumlah_tamu) || 0,
    pesan: String(row.pesan || ""),
    createdAt: toIso_(row.dibuat_pada)
  };
}

function rsvpSummary_(eventRow) {
  var rows = listRsvpByEvent_(String(eventRow.event_id));
  var summary = { total: rows.length, hadir: 0, tidakHadir: 0, totalTamu: 0 };
  for (var i = 0; i < rows.length; i += 1) {
    if (isActive_(rows[i].hadir)) {
      summary.hadir += 1;
      summary.totalTamu += Math.max(1, Number(rows[i].jumlah_tamu) || 1);
    } else {
      summary.tidakHadir += 1;
    }
  }
  return summary;
}

function listRsvpForEvent_(eventRow) {
  var rows = listRsvpByEvent_(String(eventRow.event_id));
  return {
    items: rows.map(presentRsvp_),
    total: rows.length,
    summary: rsvpSummary_(eventRow)
  };
}

/** Tambah/perbarui RSVP seorang tamu. */
function createRsvp_(eventRow, input) {
  var data = input || {};
  rateLimit_("rsvp:" + eventRow.slug, RSVP_MAX_PER_HOUR, 3600);

  var nama = cleanGuestText_(data.nama || data.name, 100, "Nama", true);
  var kontak = cleanGuestText_(data.kontak || data.contact || data.telepon, 60, "Kontak", false);
  var hadir = attendanceFlag_(data.hadir !== undefined ? data.hadir : data.kehadiran);
  if (!hadir) fail_("Kehadiran wajib dipilih (hadir / tidak).", 400, "missing-kehadiran");
  var pesan = cleanGuestText_(data.pesan || data.message, 500, "Pesan", false);
  var jumlah = hadir === "TRUE" ? Number(data.jumlahTamu !== undefined ? data.jumlahTamu : data.jumlah_tamu) || 1 : 0;
  if (jumlah < 1) jumlah = 1;
  if (jumlah > 20) jumlah = 20;

  var existing = kontak ? findRsvpByContact_(eventRow.event_id, kontak) : null;
  var patch = {
    nama: nama,
    kontak: kontak,
    hadir: hadir,
    jumlah_tamu: jumlah,
    pesan: pesan
  };

  var row;
  if (existing) {
    updateRow_("RSVP", existing._row, patch);
    row = findRow_("RSVP", function (r) {
      return String(r.rsvp_id) === String(existing.rsvp_id);
    });
  } else {
    patch.rsvp_id = makeRowId_("rsv");
    patch.event_id = String(eventRow.event_id);
    patch.dibuat_pada = toIso_(new Date());
    patch.ip_hash = "";
    row = appendRow_("RSVP", patch);
  }
  return presentRsvp_(row || patch);
}

/** Cari RSVP dengan kontak sama (tanpa membedakan huruf besar/kecil). */
function findRsvpByContact_(eventId, kontak) {
  var target = String(kontak || "").trim().toLowerCase();
  if (!target) return null;
  return findRow_("RSVP", function (r) {
    return String(r.event_id) === String(eventId) && String(r.kontak || "").trim().toLowerCase() === target;
  });
}

/* ── Buku tamu ──────────────────────────────────────────────────────────── */

function presentGuestbook_(row) {
  return {
    id: String(row.entry_id || ""),
    eventId: String(row.event_id || ""),
    nama: String(row.nama || ""),
    pesan: String(row.pesan || ""),
    createdAt: toIso_(row.dibuat_pada)
  };
}

function listGuestbookForEvent_(eventRow) {
  var rows = listGuestbookByEvent_(String(eventRow.event_id)) || [];
  return rows.slice(0, GUESTBOOK_MAX_ITEMS).map(presentGuestbook_);
}

function addGuestbookEntry_(eventRow, input) {
  var data = input || {};
  rateLimit_("gb:" + eventRow.slug, GUESTBOOK_MAX_PER_HOUR, 3600);
  var nama = cleanGuestText_(data.nama || data.name, 100, "Nama", true);
  var pesan = cleanGuestText_(data.pesan || data.ucapan || data.message, 500, "Pesan", true);
  var row = appendRow_("Guestbook", {
    entry_id: makeRowId_("gbk"),
    event_id: String(eventRow.event_id),
    nama: nama,
    pesan: pesan,
    dibuat_pada: toIso_(new Date())
  });
  return presentGuestbook_(row);
}

function deleteGuestbookEntry_(eventRow, entryId) {
  var row = findRow_("Guestbook", function (r) {
    return String(r.event_id) === String(eventRow.event_id) && String(r.entry_id) === String(entryId);
  });
  if (!row) fail_("ucapan tidak ditemukan", 404, "not-found");
  deleteRow_("Guestbook", row._row);
  return presentGuestbook_(row);
}
