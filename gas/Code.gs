/* Entry point Web App Satu-Album (Google Apps Script).

   GAS hanya menyediakan doGet/doPost dan TIDAK bisa mengatur status code atau
   header respons, jadi seluruh API berbentuk RPC:

     GET  <web-app-url>?action=<nama>&...        → baca  (health, event, photos, events)
     POST <web-app-url>                          → tulis (body JSON)

   Body dikirim sebagai `text/plain` (bukan application/json) supaya browser
   memperlakukan permintaan sebagai *simple request* → tidak ada preflight
   OPTIONS (GAS tidak punya doOptions). GAS sendiri yang mengirim header
   `Access-Control-Allow-Origin: *`, jadi CORS aman untuk GET & POST.

   Envelope respons (selalu HTTP 200 dari GAS):

     { ok: true,  data: {...}, serverTime: "..." }
     { ok: false, status: 401, code: "invalid-key", error: "...", serverTime: "..." }

   `status` adalah status HTTP yang "seharusnya" — klien memetakannya kembali
   ke ApiError seperti pada versi Express.

   Pemetaan dari server/index.js:
     GET    /api/health                       → action=health
     POST   /api/events                       → action=createEvent   (admin)
     GET    /api/events                       → action=events        (admin)
     GET    /api/events/:slug                 → action=event
     PATCH  /api/events/:slug                 → action=updateEvent   (admin)
     DELETE /api/events/:slug                 → action=deleteEvent   (admin)
     POST   /api/events/:slug/photos          → action=uploadPhoto
     GET    /api/events/:slug/photos          → action=photos
     DELETE /api/events/:slug/photos/:photoId → action=deletePhoto   */

var API_ACTIONS = [
  "health",
  "ping",
  "events",
  "createEvent",
  "event",
  "updateEvent",
  "deleteEvent",
  "uploadPhoto",
  "photos",
  "deletePhoto"
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
    var action = String((params.action || (body && body.action) || "")).trim();
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

/* Panitia memakai `adminToken` (nilai Script Property ADMIN_TOKEN); tamu
   memakai kunci album `k` dari link yang dibagikan. */

function isAdmin_(params, body) {
  var cfg = config_();
  if (cfg.adminTokens.length === 0) return false;
  var value = String(pick_(params, body, "adminToken") || pick_(params, body, "token") || "");
  if (!value) return false;
  var ok = false;
  /* Sengaja tanpa early-return: waktu komputasi seragam untuk semua token. */
  for (var i = 0; i < cfg.adminTokens.length; i += 1) {
    if (secretsEqual_(cfg.adminTokens[i], value)) ok = true;
  }
  return ok;
}

function requireAdmin_(params, body) {
  var cfg = config_();
  if (cfg.adminTokens.length === 0) {
    fail_("ADMIN_TOKEN belum diisi di Script Properties", 503, "admin-not-configured");
  }
  if (!isAdmin_(params, body)) fail_("token admin tidak valid", 401, "invalid-admin");
}

function requireSlug_(params, body) {
  var slug = String(pick_(params, body, "slug") || "").trim();
  if (!slug) fail_("slug wajib diisi", 400, "bad-request");
  return slug;
}

/** Tamu wajib membawa kunci yang cocok dengan metadata acara (atau token admin). */
function requireGuest_(params, body) {
  var slug = requireSlug_(params, body);
  var meta = getEventMeta_(slug);
  if (!meta) fail_("event not found", 404, "not-found");
  var admin = isAdmin_(params, body);
  var key = String(pick_(params, body, "k") || pick_(params, body, "key") || "");
  if (!admin && !keyMatches_(meta, key)) fail_("link tidak valid atau kunci tamu salah", 401, "invalid-key");
  return { slug: slug, meta: meta, admin: admin };
}

/* ── Router ───────────────────────────────────────────────────────────── */

var API_ROUTES = {
  /** Handshake: dipakai klien untuk memastikan URL deployment benar & hidup. */
  ping: function () {
    return { pong: true, version: config_().version, actions: API_ACTIONS };
  },

  health: function (params) {
    return health_({ force: params.refresh === "1" });
  },

  events: function (params, body) {
    requireAdmin_(params, body);
    /* withKeys: hanya endpoint admin yang boleh melihat kunci link tamu. */
    var events = listEvents_(params.refresh === "1");
    return {
      events: events.map(function (meta) {
        return presentEvent_(meta, true);
      }),
      stale: false
    };
  },

  createEvent: function (params, body) {
    requireAdmin_(params, body);
    var gate = rateLimit_("create", config_().rateCreatePerHour, 3600);
    if (!gate.allowed) fail_("terlalu banyak permintaan, coba lagi nanti", 429, "rate-limited");
    var event = createEventMeta_({
      name: pick_(params, body, "name"),
      type: pick_(params, body, "type"),
      preset: pick_(params, body, "preset"),
      revealAt: pick_(params, body, "revealAt") || null
    });
    return { event: event };
  },

  event: function (params, body) {
    var slug = requireSlug_(params, body);
    var meta = getEventMeta_(slug, params.refresh === "1");
    if (!meta) fail_("event not found", 404, "not-found");
    var key = String(pick_(params, body, "k") || pick_(params, body, "key") || "");
    var authorized = isAdmin_(params, body) || keyMatches_(meta, key);
    /* Kunci tamu hanya dikembalikan bila benar-benar cocok (atau pemanggil admin). */
    return { event: presentEvent_(meta, authorized), authorized: authorized, stale: false };
  },

  updateEvent: function (params, body) {
    requireAdmin_(params, body);
    var slug = requireSlug_(params, body);
    var event = updateEventMeta_(slug, body);
    if (!event) fail_("event not found", 404, "not-found");
    return { event: event };
  },

  deleteEvent: function (params, body) {
    requireAdmin_(params, body);
    var slug = requireSlug_(params, body);
    if (!trashEvent_(slug)) fail_("event not found", 404, "not-found");
    return { ok: true };
  },

  uploadPhoto: function (params, body) {
    var cfg = config_();
    var ctx = requireGuest_(params, body);
    var gate = rateLimit_("up:" + ctx.slug, cfg.rateUploadPerHour, 3600);
    if (!gate.allowed) fail_("terlalu banyak unggahan, coba lagi nanti", 429, "rate-limited");

    var data = String(pick_(params, body, "data") || "");
    if (!data) fail_("photo is required", 400, "bad-request");
    var bytes = bytesFromBase64_(data);
    if (bytes && bytes.length > cfg.maxUploadBytes) {
      fail_("foto terlalu besar (maks " + Math.round(cfg.maxUploadBytes / 1024 / 1024) + " MB)", 413, "too-large");
    }
    var check = validateImage_(bytes, cfg.allowedMime, pick_(params, body, "mime"));
    if (!check.ok) fail_(check.error, check.status, check.code);
    if (Number(ctx.meta.count || 0) >= cfg.maxPhotosPerEvent) {
      fail_("album sudah penuh (" + cfg.maxPhotosPerEvent + " foto)", 409, "photo-limit");
    }

    var result = addPhoto_({ slug: ctx.slug, bytes: bytes, mime: check.mime });
    return {
      photo: result.photo,
      /* Klien memakai serverTime untuk polling `?since=`. */
      undoWindowMs: cfg.undoWindowMs,
      count: Number(ctx.meta.count || 0) + 1,
      serverTime: new Date().toISOString()
    };
  },

  photos: function (params, body) {
    var cfg = config_();
    var ctx = requireGuest_(params, body);
    var force = String(pick_(params, body, "refresh") || "") === "1";
    var since = String(pick_(params, body, "since") || "");
    /* fromCache: true = daftar dilayani dari CacheService (bukan baca Drive). */
    var hasCached = !force && cacheHas_("photos:" + ctx.slug);
    var all = listPhotos_(ctx.slug, { force: force, limit: cfg.maxPhotosPerEvent + 500 });
    /* refresh=1 sekaligus menyelaraskan `count` di event.json dengan folder. */
    if (force) reconcileCount_(ctx.slug, all.length);
    var list = since
      ? all.filter(function (photo) {
          return String(photo.createdAt) > since;
        })
      : all;
    return {
      photos: list,
      count: all.length,
      stale: false,
      fromCache: hasCached,
      serverTime: new Date().toISOString()
    };
  },

  deletePhoto: function (params, body) {
    var cfg = config_();
    var ctx = requireGuest_(params, body);
    var photoId = String(pick_(params, body, "photoId") || "").trim();
    if (!photoId) fail_("photoId wajib diisi", 400, "bad-request");

    if (!ctx.admin) {
      /* Tamu hanya boleh membatalkan fotonya sendiri dalam jendela Undo. */
      var list = listPhotos_(ctx.slug, { force: true, limit: cfg.maxPhotosPerEvent + 500 });
      var photo = null;
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].id === photoId) photo = list[i];
      }
      if (!photo) fail_("foto tidak ditemukan", 404, "not-found");
      var age = Date.now() - new Date(photo.createdAt).getTime();
      if (isFinite(age) && age > cfg.undoWindowMs) {
        fail_("waktu Undo sudah lewat", 403, "undo-expired");
      }
    }

    var removed = removePhoto_(ctx.slug, photoId);
    if (!removed) fail_("foto tidak ditemukan", 404, "not-found");
    return { ok: true, photo: removed };
  }
};

