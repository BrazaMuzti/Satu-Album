/* Templates.gs — Panel template undangan digital.

   Satu acara punya **satu** template aktif di tab Templates (menggantikan
   model `event.json` lama). Template menyimpan tata letak, warna tema,
   teks undangan (hero/couple/acara/penutup) dan URL musik latar.

   Layout & tema disimpan sebagai string pendek + JSON bebas (kolom
   `tata_letak`), supaya frontend bebas berevolusi tanpa mengubah skema. */

var TEMPLATE_MAX_LEN = 2000;
var TEMPLATE_LAYOUT_VALUES = ["klasik", "elegan", "floral", "minimalis", "modern"];
var TEMPLATE_DEFAULT_LAYOUT = "elegan";
var TEMPLATE_DEFAULT_THEME = "#7c3aed";

/** Template default dibuat otomatis saat acara baru dibuat. */
function defaultTemplate_(namaAcara) {
  var nama = String(namaAcara || "").trim() || "Acara";
  return {
    nama_template: "Template Default",
    tema_warna: TEMPLATE_DEFAULT_THEME,
    teks_hero: "Undangan Pernikahan",
    teks_couple: nama,
    teks_acara: "Merupakan suatu kehormatan dan kebahagiaan bagi kami\napabila Bapak/Ibu/Saudara/i berkenan hadir.",
    teks_penutup: "Terima kasih atas doa dan restunya.",
    musik_url: "",
    tata_letak: TEMPLATE_DEFAULT_LAYOUT
  };
}

/** Bersihkan + validasi input template. `partial` true → hanya field yang dikirim. */
function sanitizeTemplateInput_(input, partial) {
  var src = input || {};
  var out = {};

  function has(key) {
    return Object.prototype.hasOwnProperty.call(src, key);
  }
  function text(key, maxLen, fallback) {
    if (!has(key)) return partial ? undefined : fallback;
    var value = src[key];
    if (value === undefined || value === null) value = "";
    value = String(value).trim();
    if (value.length > maxLen) throw fail_("Teks " + key + " terlalu panjang (maks " + maxLen + " karakter).", 400, "text-too-long");
    return value;
  }

  var namaTemplate = text("namaTemplate", 120, "Template Default");
  if (namaTemplate !== undefined) out.nama_template = namaTemplate || "Template Default";

  var tema = text("temaWarna", 32, TEMPLATE_DEFAULT_THEME);
  if (tema !== undefined) out.tema_warna = isValidColor_(tema) ? tema : TEMPLATE_DEFAULT_THEME;

  var layout = text("tataLetak", 32, TEMPLATE_DEFAULT_LAYOUT);
  if (layout !== undefined) {
    out.tata_letak = TEMPLATE_LAYOUT_VALUES.indexOf(layout) >= 0 ? layout : TEMPLATE_DEFAULT_LAYOUT;
  }

  var hero = text("teksHero", TEMPLATE_MAX_LEN, "");
  if (hero !== undefined) out.teks_hero = hero;
  var couple = text("teksCouple", TEMPLATE_MAX_LEN, "");
  if (couple !== undefined) out.teks_couple = couple;
  var acara = text("teksAcara", TEMPLATE_MAX_LEN, "");
  if (acara !== undefined) out.teks_acara = acara;
  var penutup = text("teksPenutup", TEMPLATE_MAX_LEN, "");
  if (penutup !== undefined) out.teks_penutup = penutup;

  var musik = text("musikUrl", 500, "");
  if (musik !== undefined) {
    if (musik && !/^https?:\/\//i.test(musik)) {
      throw fail_("URL musik harus diawali http:// atau https://", 400, "bad-music-url");
    }
    out.musik_url = musik;
  }

  return out;
}

function isValidColor_(value) {
  var v = String(value || "").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) || /^(rgb|rgba|hsl)\(/i.test(v);
}

/** Baris → objek template untuk frontend. */
function presentTemplate_(row, eventId) {
  if (!row) return null;
  return {
    id: row.template_id || "",
    eventId: row.event_id || eventId || "",
    namaTemplate: row.nama_template || "Template Default",
    temaWarna: row.tema_warna || TEMPLATE_DEFAULT_THEME,
    teksHero: row.teks_hero || "",
    teksCouple: row.teks_couple || "",
    teksAcara: row.teks_acara || "",
    teksPenutup: row.teks_penutup || "",
    musikUrl: row.musik_url || "",
    tataLetak: row.tata_letak || TEMPLATE_DEFAULT_LAYOUT,
    updatedAt: toIso_(row.diperbarui_pada)
  };
}

function getTemplateForEvent_(eventId) {
  return findTemplateByEvent_(eventId);
}

/** Ambil template publik (dipakai halaman undangan). Bila belum ada, buat default. */
function publicTemplateForEvent_(row) {
  var existing = row && row.event_id ? findTemplateByEvent_(row.event_id) : null;
  if (existing) return presentTemplate_(existing, row.event_id);
  var created = upsertTemplate_(row.event_id, defaultTemplate_(row.nama));
  return presentTemplate_(created, row.event_id);
}

/** Simpan (insert/update) satu template untuk sebuah acara. Return baris terbaru. */
function upsertTemplate_(eventId, data) {
  if (!eventId) throw fail_("eventId wajib untuk template.", 400, "missing-event-id");
  var patch = sanitizeTemplateInput_(data, true);
  var existing = findTemplateByEvent_(eventId);
  var nowIso = toIso_(new Date());

  if (existing) {
    patch.diperbarui_pada = nowIso;
    updateRow_("Templates", existing._row, patch);
    return findTemplateByEvent_(eventId);
  }

  var defaults = defaultTemplate_("");
  var row = {
    template_id: makeRowId_("tpl"),
    event_id: eventId,
    nama_template: patch.nama_template || defaults.nama_template,
    tema_warna: patch.tema_warna || defaults.tema_warna,
    teks_hero: patch.teks_hero !== undefined ? patch.teks_hero : defaults.teks_hero,
    teks_couple: patch.teks_couple !== undefined ? patch.teks_couple : defaults.teks_couple,
    teks_acara: patch.teks_acara !== undefined ? patch.teks_acara : defaults.teks_acara,
    teks_penutup: patch.teks_penutup !== undefined ? patch.teks_penutup : defaults.teks_penutup,
    musik_url: patch.musik_url !== undefined ? patch.musik_url : defaults.musik_url,
    tata_letak: patch.tata_letak || defaults.tata_letak,
    diperbarui_pada: nowIso
  };
  var created = appendRow_("Templates", row);
  return created;
}

/** Endpoint admin: GET/POST action=saveTemplate. */
function saveTemplateFromInput_(input) {
  var eventId = String((input && input.eventId) || "").trim();
  var eventRow = findEventById_(eventId);
  if (!eventRow) throw fail_("Acara tidak ditemukan.", 404, "event-not-found");
  var saved = upsertTemplate_(eventId, input || {});
  return presentTemplate_(saved, eventId);
}
