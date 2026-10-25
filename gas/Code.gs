/* Entry point Web App Satu-Album (Google Apps Script).

   GAS hanya menyediakan doGet/doPost dan TIDAK bisa mengatur status code atau
   header respons, jadi seluruh API berbentuk RPC:

     GET  <web-app-url>?action=<nama>&...        -> baca  (health, event, photos, events)
     POST <web-app-url>                          -> tulis (body JSON)

   Body dikirim sebagai `text/plain` (bukan application/json) supaya browser
   memperlakukan permintaan sebagai *simple request* -> tidak ada preflight
   OPTIONS (GAS tidak punya doOptions). GAS sendiri yang mengirim header
   `Access-Control-Allow-Origin: *`, jadi CORS aman untuk GET & POST.

   Envelope respons (selalu HTTP 200 dari GAS):

     { ok: true,  data: {...}, serverTime: "..." }
     { ok: false, status: 401, code: "invalid-key", error: "...", serverTime: "..." }

   `status` adalah status HTTP yang "seharusnya" - klien memetakannya kembali
   ke ApiError.

   Otorisasi:
     - Admin : token sesi `sid` (hasil action=login dengan PIN).
     - Tamu  : `slug` + kunci `k` dari link kamera/galeri/undangan.

   Daftar action ada di API_ACTIONS (dipakai action=ping untuk handshake). */

var API_ACTIONS = [
  "ping",
  "health",
  "login",
  "logout",
  "me",
  "events",
  "createEvent",
  "event",
  "updateEvent",
  "deleteEvent",
  "uploadPhoto",
  "photos",
  "deletePhoto",
  "syncPhotos",
  "template",
  "saveTemplate",
  "createPrintOrder",
  "listPrintOrders",
  "updatePrintOrderStatus",
  "rsvp",
  "listRsvp",
  "guestbook",
  "deleteGuestbook"
];

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  var params = (e && e.parameter) || {};
  var callback = jsonpCallback_(params.callback);
  try {
    var body = readJsonBody_(e);
    var action = String(params.action || (body && body.action) || "").trim();
    if (!action) fail_("parameter `action` wajib diisi (contoh: ?action=health)", 400, "bad-action");
    var handler = API_ROUTES[action];
    if (!handler) {
      fail_("action tidak dikenal: " + action + " (pilihan: " + API_ACTIONS.join(", ") + ")", 400, "bad-action");
    }
    return okOut_(handler(params, body), callback);
  } catch (err) {
    return failOut_(err, callback);
  }
}

/** Body POST: JSON sebagai text/plain. Body kosong dianggap {} (mis. poll GET). */
function readJsonBody_(e) {
  var raw = e && e.postData ? String(e.postData.contents || "") : "";
  if (!raw.trim()) return {};
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    fail_("body JSON tidak valid (kirim JSON dengan content-type text/plain)", 400, "bad-json");
  }
}

/** Ambil nilai dari body JSON, fallback ke query/form parameter. */
function pick_(params, body, key) {
  if (body && body[key] !== undefined && body[key] !== null) return body[key];
  if (params && params[key] !== undefined && params[key] !== null) return params[key];
  return undefined;
}

/** Nama fungsi JSONP yang aman (huruf/angka/_/$ dan titik), atau null. */
function jsonpCallback_(value) {
  var text = String(value || "").trim();
  if (!text) return null;
  if (text.length > 64) return null;
  return /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(text) ? text : null;
}


/* ── Otorisasi ────────────────────────────────────────────────────────── */

function requireSlug_(params, body) {
  var slug = String(pick_(params, body, "slug") || "").trim();
  if (!slug) fail_("slug wajib diisi", 400, "bad-request");
  return slug;
}

/** Kunci tamu dari body/parameter (`k` atau `key`). */
function guestKey_(params, body) {
  return String(pick_(params, body, "k") || pick_(params, body, "key") || "");
}

/**
 * Validasi konteks tamu: slug + kunci `k` (atau sesi admin).
 * @return {Object} { row, slug, admin }
 */
function requireGuest_(params, body) {
  var slug = requireSlug_(params, body);
  var row = findEventBySlug_(slug);
  if (!row) fail_("event not found", 404, "not-found");

  var admin = false;
  if (sessionToken_(params, body)) {
    /* Sesi kedaluwarsa tidak boleh menghalangi tamu yang membawa kunci sah. */
    try {
      requireSession_(params, body);
      admin = true;
    } catch (err) {
      if (!(err instanceof ApiFailure)) throw err;
    }
  }

  if (!admin) {
    if (!isActive_(row.aktif)) fail_("acara sudah tidak aktif", 410, "event-inactive");
    var key = guestKey_(params, body);
    if (!key || !secretsEqual_(String(row.join_key || "x"), key)) {
      fail_("link tidak valid atau kunci tamu salah", 401, "invalid-key");
    }
  }
  return { row: row, slug: slug, admin: admin };
}

/** Baris Events dari `slug` atau `eventId` (khusus admin). */
function requireEventForAdmin_(params, body) {
  var slug = String(pick_(params, body, "slug") || "").trim();
  var eventId = String(pick_(params, body, "eventId") || "").trim();
  var row = slug ? findEventBySlug_(slug) : eventId ? findEventById_(eventId) : null;
  if (!row) fail_("event not found", 404, "not-found");
  return row;
}

/** Susun objek input event dari body + query (nama/name, jenis/type, ...). */
function eventInput_(params, body) {
  var input = {};
  var keys = ["nama", "name", "jenis", "type", "tanggal", "lokasi", "preset", "revealAt", "rotateKey", "aktif", "slug"];
  for (var i = 0; i < keys.length; i += 1) {
    var value = pick_(params, body, keys[i]);
    if (value !== undefined) input[keys[i]] = value;
  }
  if (body && body.rotateUploadKey !== undefined) input.rotateKey = body.rotateUploadKey;
  return input;
}

/** Ringkas satu baris Events untuk respons admin (kunci & link ikut). */
function adminEventView_(row) {
  var counts = photoCountsByEvent_();
  var event = presentEventRow_(row, counts[String(row.event_id)] || 0);
  event.joinKey = String(row.join_key || "");
  event.links = eventLinks_(row, publicBaseUrl_());
  return event;
}

/* ── Router ───────────────────────────────────────────────────────────── */

var API_ROUTES = {
  /** Handshake: klien memakai ini untuk memastikan URL deployment benar. */
  ping: function () {
    return { pong: true, version: config_().version, actions: API_ACTIONS };
  },

  /** Status penyimpanan; tidak pernah melempar error agar mudah didiagnosis. */
  health: function () {
    return health_();
  },

  /* ── Sesi admin ──────────────────────────────────────────────────────── */

  login: function (params, body) {
    return loginWithPin_(pick_(params, body, "pin"));
  },

  logout: function (params, body) {
    requireSession_(params, body);
    revokeSession_(sessionToken_(params, body));
    return { ok: true };
  },

  me: function (params, body) {
    return { admin: presentAdmin_(requireSession_(params, body)) };
  },

  /* ── Acara ───────────────────────────────────────────────────────────── */

  events: function (params, body) {
    requireSession_(params, body);
    var events = listEventsForAdmin_();
    return { events: events, total: events.length };
  },

  createEvent: function (params, body) {
    requireSession_(params, body);
    return { event: createEvent_(eventInput_(params, body)) };
  },

  /** Detail acara; `authorized` menandakan kunci tamu cocok. */
  event: function (params, body) {
    var slug = requireSlug_(params, body);
    var row = findEventBySlug_(slug);
    if (!row) fail_("event not found", 404, "not-found");
    var key = guestKey_(params, body);
    var authorized = Boolean(key) && secretsEqual_(String(row.join_key || "x"), key);
    if (!authorized && sessionToken_(params, body)) {
      try {
        requireSession_(params, body);
        authorized = true;
      } catch (err) {
        if (!(err instanceof ApiFailure)) throw err;
      }
    }
    if (!authorized && !isActive_(row.aktif)) fail_("acara sudah tidak aktif", 410, "event-inactive");

    var counts = photoCountsByEvent_();
    var event = presentEventRow_(row, counts[String(row.event_id)] || 0);
    var out = { event: event, authorized: authorized };
    if (authorized) {
      out.event.joinKey = String(row.join_key || "");
      out.event.links = eventLinks_(row, publicBaseUrl_());
    }
    return out;
  },

  updateEvent: function (params, body) {
    requireSession_(params, body);
    var input = eventInput_(params, body);
    return { event: updateEvent_(input) };
  },

  deleteEvent: function (params, body) {
    requireSession_(params, body);
    var removed = deleteEvent_({ slug: requireSlug_(params, body) });
    return { ok: true, removed: removed };
  },

  /* ── Foto ────────────────────────────────────────────────────────────── */

  uploadPhoto: function (params, body) {
    var cfg = config_();
    var ctx = requireGuest_(params, body);
    var gate = rateLimit_("up:" + ctx.slug, cfg.rateUploadPerHour, 3600);
    if (!gate.allowed) fail_("terlalu banyak unggahan, coba lagi nanti", 429, "rate-limited");

    var data = String(pick_(params, body, "data") || "");
    if (!data) fail_("photo is required", 400, "bad-request");
    var bytes = bytesFromBase64_(data);
    if (!bytes) fail_("data foto bukan base64 yang valid", 400, "bad-request");
    if (bytes.length > cfg.maxUploadBytes) {
      fail_("foto terlalu besar (maks " + Math.round(cfg.maxUploadBytes / 1024 / 1024) + " MB)", 413, "too-large");
    }
    var check = validateImage_(bytes, cfg.allowedMime, pick_(params, body, "mime"));
    if (!check.ok) fail_(check.error, check.status, check.code);

    var count = photoCount_(ctx.row);
    if (count >= cfg.maxPhotosPerEvent) {
      fail_("album sudah penuh (" + cfg.maxPhotosPerEvent + " foto)", 409, "photo-limit");
    }

    var photo = storePhoto_(ctx.row, bytes, check.mime, "camera");
    return {
      photo: photo,
      undoWindowMs: cfg.undoWindowMs,
      count: count + 1,
      serverTime: new Date().toISOString()
    };
  },

  photos: function (params, body) {
    var ctx = requireGuest_(params, body);
    var force = String(pick_(params, body, "refresh") || "") === "1";
    var since = String(pick_(params, body, "since") || "");
    var hasCached = !force && cacheHas_("photos:" + ctx.slug);
    var all = listPhotos_(ctx.row, { force: force });
    var list = since
      ? all.filter(function (photo) {
          return String(photo.createdAt) > since;
        })
      : all;
    return {
      photos: list,
      count: all.length,
      fromCache: hasCached,
      serverTime: new Date().toISOString()
    };
  },

  deletePhoto: function (params, body) {
    var ctx = requireGuest_(params, body);
    var photoId = String(pick_(params, body, "photoId") || "").trim();
    if (!photoId) fail_("photoId wajib diisi", 400, "bad-request");
    return { ok: true, photo: removePhoto_(ctx.row, photoId, ctx.admin) };
  },

  /** Sinkronkan berkas Drive (unggahan manual) ke tab Photos. */
  syncPhotos: function (params, body) {
    requireSession_(params, body);
    var slug = String(pick_(params, body, "slug") || "").trim();
    var rows = slug ? [eventRowOrFail_(slug)] : listEventRows_(false);
    var results = rows.map(function (row) {
      var result = syncDrivePhotos_(row, { force: String(pick_(params, body, "force") || "") === "1" });
      result.slug = row.slug;
      return result;
    });
    return { results: results, total: results.length };
  },

  /* ── Template undangan ───────────────────────────────────────────────── */

  /** Template publik; wajib membawa kunci tamu (link undangan sudah berisi `k`). */
  template: function (params, body) {
    var ctx = requireGuest_(params, body);
    return { template: publicTemplateForEvent_(ctx.row) };
  },

  saveTemplate: function (params, body) {
    requireSession_(params, body);
    var input = body || {};
    if (input.eventId === undefined) input.eventId = pick_(params, body, "eventId");
    if (input.slug !== undefined || !input.eventId) {
      var row = requireEventForAdmin_(params, body);
      input.eventId = String(row.event_id);
    }
    return { template: saveTemplateFromInput_(input) };
  },

  /* ── Daftar cetak ────────────────────────────────────────────────────── */

  createPrintOrder: function (params, body) {
    var ctx = requireGuest_(params, body);
    var result = createPrintOrder_(ctx.row, body || {});
    return { order: result.order, duplicate: result.duplicate };
  },

  listPrintOrders: function (params, body) {
    requireSession_(params, body);
    var row = requireEventForAdmin_(params, body);
    var status = String(pick_(params, body, "status") || "").trim().toLowerCase();
    var result = listOrdersForEvent_(row, status || null);
    return { order: null, items: result.items, total: result.total, counts: result.counts };
  },

  updatePrintOrderStatus: function (params, body) {
    requireSession_(params, body);
    var row = requireEventForAdmin_(params, body);
    return { order: updateOrderStatus_(row, body || {}) };
  },

  /* ── RSVP & buku tamu ────────────────────────────────────────────────── */

  rsvp: function (params, body) {
    var ctx = requireGuest_(params, body);
    return { rsvp: createRsvp_(ctx.row, body || {}), summary: rsvpSummary_(ctx.row) };
  },

  listRsvp: function (params, body) {
    requireSession_(params, body);
    var row = requireEventForAdmin_(params, body);
    var result = listRsvpForEvent_(row);
    return { items: result.items, total: result.total, summary: result.summary };
  },

  /** GET = daftar ucapan; POST dengan `pesan` = tambah ucapan. */
  guestbook: function (params, body) {
    var ctx = requireGuest_(params, body);
    var isNew = Boolean(body && (body.pesan !== undefined || body.ucapan !== undefined));
    if (isNew) return { entry: addGuestbookEntry_(ctx.row, body) };
    var list = listGuestbookForEvent_(ctx.row);
    return { items: list, total: list.length };
  },

  deleteGuestbook: function (params, body) {
    requireSession_(params, body);
    var row = requireEventForAdmin_(params, body);
    var entryId = String(pick_(params, body, "entryId") || pick_(params, body, "id") || "").trim();
    if (!entryId) fail_("entryId wajib diisi", 400, "bad-request");
    return { ok: true, removed: deleteGuestbookEntry_(row, entryId) };
  }
};


