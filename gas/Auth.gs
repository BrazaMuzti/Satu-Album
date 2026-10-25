/* Autentikasi admin & sesi (Google Apps Script).

   GAS tidak punya cookie/session bawaan yang bisa dipakai lintas domain
   GitHub Pages, jadi admin memakai **token sesi** yang dikirim klien di body
   JSON (`{ sid: "..." }`) dan disimpan di sessionStorage browser.

   Bentuk token:  "<adminId>.<expSec>.<hmacHex>"
     - adminId  : id baris Admin di Sheets (mis. adm_ab12...)
     - expSec   : detik epoch kedaluwarsa
     - hmacHex  : HMAC-SHA256(SESSION_SECRET, adminId + "." + expSec)

   Verifikasi = cek HMAC (waktu-tetap) + cek kedaluwarsa. Sesi yang sah juga
   dicatat di CacheService (`sid:<hash>`) agar bisa dicabut saat logout tanpa
   menunggu token kedaluwarsa. Bila cache terhapus, token tetap berlaku sampai
   `exp` — perilaku yang dapat diterima untuk aplikasi album. */

function authSecret_() {
  var cfg = config_();
  if (!cfg.sessionSecret) {
    fail_("SESSION_SECRET belum diisi di Script Properties", 503, "auth-not-configured");
  }
  return cfg.sessionSecret;
}

function hmacHex_(message) {
  var raw = Utilities.computeHmacSha256Signature(String(message), authSecret_());
  var hex = "";
  for (var i = 0; i < raw.length; i += 1) hex += ("0" + (raw[i] & 0xff).toString(16)).slice(-2);
  return hex;
}

/** Fingerprint token untuk kunci cache sesi/blacklist (tidak membocorkan token). */
function sessionFingerprint_(token) {
  return hmacHex_("sid:" + String(token || "")).slice(0, 32);
}

/** Buat token sesi untuk admin yang berhasil login. */
function issueSession_(adminRow) {
  var cfg = config_();
  var adminId = String(adminRow.admin_id);
  var exp = Math.round(Date.now() / 1000) + cfg.sessionTtlSec;
  var token = adminId + "." + exp + "." + hmacHex_(adminId + "." + exp);
  /* Catat sesi aktif (dipakai untuk logout & audit ringan). */
  cacheStore_().put(cacheKey_("sid:" + sessionFingerprint_(token)), "1", cfg.sessionTtlSec);
  return {
    sid: token,
    admin: presentAdmin_(adminRow),
    expiresAt: new Date(exp * 1000).toISOString(),
    ttlSec: cfg.sessionTtlSec
  };
}

/**
 * Cabut sesi saat logout. GAS tidak punya cookie, jadi token HMAC tetap sah
 * secara kriptografis; pencabutan dicatat sebagai tombstone di cache selama
 * sisa TTL. Bila cache terhapus, token kembali berlaku sampai `exp`.
 */
function revokeSession_(token) {
  var text = String(token || "").trim();
  if (!text) return;
  var cfg = config_();
  var fp = sessionFingerprint_(text);
  cacheStore_().remove(cacheKey_("sid:" + fp));
  cacheStore_().put(cacheKey_("sidrevoked:" + fp), "1", cfg.sessionTtlSec);
}


/** Baca token dari body/parameter; kembalikan null bila kosong. */
function sessionToken_(params, body) {
  var value = pick_(params, body, "sid") || pick_(params, body, "session");
  var text = String(value || "").trim();
  return text || null;
}

/**
 * Validasi token sesi → baris Admin. Gagal = ApiFailure 401.
 * @return {Object} baris Admin (dengan `_row`)
 */
function requireSession_(params, body) {
  var token = sessionToken_(params, body);
  if (!token) fail_("sesi admin diperlukan, silakan login", 401, "no-session");
  var parts = token.split(".");
  if (parts.length !== 3) fail_("token sesi tidak valid", 401, "bad-session");
  var adminId = parts[0];
  var exp = Number(parts[1]);
  if (!isFinite(exp) || exp <= 0) fail_("token sesi tidak valid", 401, "bad-session");
  var expected = hmacHex_(adminId + "." + parts[1]);
  if (!secretsEqual_(expected, parts[2])) fail_("token sesi tidak valid", 401, "bad-session");
  if (Math.round(Date.now() / 1000) > exp) fail_("sesi kedaluwarsa, silakan login ulang", 401, "session-expired");
  if (cacheStore_().get(cacheKey_("sidrevoked:" + sessionFingerprint_(token)))) {
    fail_("sesi sudah keluar, silakan login ulang", 401, "session-revoked");
  }
  var admin = findAdminById_(adminId);
  if (!admin || !isActive_(admin.aktif)) fail_("akun admin tidak aktif", 401, "admin-inactive");
  return admin;
}

function isActive_(flag) {
  if (flag === true) return true;
  var text = String(flag == null ? "" : flag).trim().toUpperCase();
  /* Kolom checkbox Sheets menghasilkan TRUE/FALSE; sel kosong dianggap aktif. */
  return text === "TRUE" || text === "1" || text === "YA" || text === "";
}

function presentAdmin_(row) {
  return {
    id: String(row.admin_id),
    nama: String(row.nama || "Admin"),
    role: String(row.role || "admin"),
    aktif: isActive_(row.aktif),
    createdAt: row.dibuat_pada || null
  };
}

/**
 * Login admin dengan PIN. Mengembalikan sesi, atau ApiFailure 401.
 * Kredensial dicatat di sesi? Tidak — CORS + GAS membuat kredensial default
 * tidak terkirim, sehingga admin dikenali lewat token sesi.
 */
function loginWithPin_(pin) {
  var cfg = config_();
  if (!String(cfg.adminPin || "")) {
    fail_("ADMIN_PIN belum diisi di Script Properties (jalankan initSheets)", 503, "admin-not-configured");
  }
  var text = String(pin || "");
  if (!text) fail_("PIN wajib diisi", 400, "bad-request");
  if (text.length > 64) fail_("PIN terlalu panjang", 400, "bad-request");

  var gate = rateLimit_("login", cfg.loginMaxAttempts, 3600);
  if (!gate.allowed) fail_("terlalu banyak percobaan login, coba lagi nanti", 429, "rate-limited");

  var admins = readRows_("Admin", function (r) {
    return String(r.role || "admin") === "admin" && isActive_(r.aktif);
  });
  /* Belum pernah initSheets → seed dari ADMIN_PIN agar tidak terkunci di luar. */
  if (admins.length === 0) {
    var seeded = seedAdminFromConfig_();
    if (seeded) admins = [seeded];
  }

  var matched = null;
  /* Sengaja tanpa early-return: waktu verifikasi seragam untuk semua baris. */
  for (var i = 0; i < admins.length; i += 1) {
    if (verifyPin_(text, admins[i].pin_hash)) matched = admins[i];
  }
  if (!matched) fail_("PIN salah", 401, "invalid-pin");
  if (!isActive_(matched.aktif)) fail_("akun admin tidak aktif", 401, "admin-inactive");
  return issueSession_(matched);
}

/** Buat baris Admin pertama dari ADMIN_PIN (idempoten: tidak menambah duplikat). */
function seedAdminFromConfig_() {
  var cfg = config_();
  var pin = String(cfg.adminPin || "");
  if (!pin) return null;
  var existing = readRows_("Admin", function (r) {
    return String(r.role || "admin") === "admin";
  });
  if (existing.length) return existing[0];
  var row = appendRow_("Admin", {
    admin_id: "adm_" + randomHex_(12),
    pin_hash: hashPin_(pin),
    nama: "Admin Utama",
    role: "admin",
    aktif: "TRUE",
    dibuat_pada: new Date().toISOString()
  });
  Logger.log("[auth] baris Admin dibuat dari ADMIN_PIN");
  return row;
}

/**
 * Ganti PIN admin yang sedang login. PIN lama wajib benar.
 * @param {Object} admin baris Admin (dari requireSession_)
 * @return {Object} info hasil (tanpa hash)
 */
function changeAdminPin_(admin, oldPin, newPin) {
  var lama = String(oldPin || "");
  var baru = String(newPin || "");
  if (baru.length < 6) fail_("PIN baru minimal 6 karakter", 400, "weak-pin");
  if (baru.length > 64) fail_("PIN baru maksimal 64 karakter", 400, "weak-pin");
  if (!verifyPin_(lama, admin.pin_hash)) fail_("PIN lama salah", 401, "invalid-pin");
  updateRow_("Admin", admin._row, { pin_hash: hashPin_(baru) });
  /* Simpan juga sebagai ADMIN_PIN agar seed berikutnya konsisten. */
  setConfigProperty_("ADMIN_PIN", baru);
  return { ok: true, updatedAt: new Date().toISOString() };
}
