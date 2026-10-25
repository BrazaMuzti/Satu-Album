/* Uji end-to-end Web App Satu-Album (arsitektur Sheets + Drive).

   Jalankan:  node --test gas/test
   Tidak butuh kredensial Google: SpreadsheetApp, DriveApp, CacheService,
   PropertiesService, dan Utilities disimulasikan oleh harness.mjs.

   Cakupan: envelope & JSONP, login/sesi admin, CRUD acara, kunci tamu,
   unggah/hapus/sinkron foto, template undangan, daftar cetak, RSVP, buku tamu,
   serta fungsi Setup.gs. */

import assert from "node:assert/strict";
import test from "node:test";
import { loadGas } from "./harness.mjs";

const ADMIN_PIN = "123456";
const SESSION_SECRET = "rahasia-uji-yang-panjang";
const BASE_URL = "https://contoh.test/satu-album";

/* PNG 1×1 valid (70 byte) — lolos sniffImageMime_. */
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==";
/* JPEG palsu: hanya signature + isi, cukup untuk uji sniffing & batas ukuran. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4000, 7)]).toString("base64");
/* HEIC palsu: brand "heic" pada offset 8. */
const HEIC = Buffer.from("____ftypheic____", "utf8").toString("base64");
/* GIF palsu (≥12 byte, signature tak dikenal) → sniffing mengembalikan null. */
const GIF = Buffer.concat([Buffer.from("GIF89a", "utf8"), Buffer.alloc(10, 3)]).toString("base64");


function props(extra = {}) {
  return {
    SHEET_ID: "sheet_uji",
    ADMIN_PIN,
    SESSION_SECRET,
    BASE_URL,
    CACHE_TTL_MS: "1000",
    ...extra
  };
}

function load(extra = {}) {
  return loadGas({ properties: props(extra) });
}

function login(h, pin = ADMIN_PIN) {
  const response = h.post({ action: "login", pin });
  assert.equal(response.json.ok, true, JSON.stringify(response.json));
  return response.json.data;
}

function makeEvent(h, session, payload = {}) {
  const response = h.post({
    action: "createEvent",
    sid: session.sid,
    nama: "Pesta Ulang Tahun",
    jenis: "ulang-tahun",
    tanggal: "2026-11-01",
    lokasi: "Bandung",
    ...payload
  });
  assert.equal(response.json.ok, true, JSON.stringify(response.json));
  return response.json.data.event;
}

function upload(h, event, data = PNG_1X1, mime = "image/png") {
  return h.post({ action: "uploadPhoto", slug: event.slug, k: event.joinKey, mime, data });
}

function folderFor(h, slug) {
  const folder = h.state.helpers.foldersNamed("event-" + slug)[0];
  assert.ok(folder, "folder event-" + slug + " harus ada di Drive");
  return folder;
}

function photoRows(h) {
  return h.call("readRows_", "Photos");
}

/* ── Envelope & routing ────────────────────────────────────────────────── */

test("semua berkas .gs dimuat tanpa error sintaks", () => {
  const h = load();
  assert.deepEqual(h.state.fileNames, [
    "Auth.gs",
    "Code.gs",
    "Config.gs",
    "DriveStore.gs",
    "Events.gs",
    "Interactions.gs",
    "Lib.gs",
    "PrintOrders.gs",
    "Setup.gs",
    "Sheets.gs",
    "Templates.gs"
  ]);
});

test("envelope sukses: GET ?action=ping", () => {
  const h = load();
  const response = h.get({ action: "ping" });
  assert.equal(response.mimeType, "application/json");
  assert.equal(response.json.ok, true);
  assert.equal(response.json.data.pong, true);
  assert.equal(response.json.data.version, "3.0.0-sheets");
  for (const action of ["login", "createEvent", "uploadPhoto", "rsvp", "guestbook", "listPrintOrders"]) {
    assert.ok(response.json.data.actions.includes(action), "action " + action + " terdaftar");
  }
  assert.equal(typeof response.json.serverTime, "string");
});

test("action tidak dikenal / kosong ditolak dengan 400 bad-action", () => {
  const h = load();
  const unknown = h.get({ action: "hapusSemua" });
  assert.equal(unknown.json.ok, false);
  assert.equal(unknown.json.status, 400);
  assert.equal(unknown.json.code, "bad-action");
  assert.match(unknown.json.error, /action tidak dikenal/);

  const missing = h.post({});
  assert.equal(missing.json.status, 400);
  assert.equal(missing.json.code, "bad-action");
});

test("JSONP: callback aman dibungkus, callback berbahaya diabaikan", () => {
  const h = load();
  const jsonp = h.get({ action: "ping", callback: "sa.ping" });
  assert.equal(jsonp.mimeType, "application/javascript");
  assert.equal(jsonp.json, null);
  assert.ok(jsonp.raw.startsWith("sa.ping("), jsonp.raw.slice(0, 40));
  assert.ok(jsonp.raw.endsWith(");"));
  assert.equal(JSON.parse(jsonp.raw.slice("sa.ping(".length, -2)).ok, true);

  const unsafe = h.get({ action: "ping", callback: "alert(1)//" });
  assert.equal(unsafe.mimeType, "application/json");
  assert.equal(unsafe.json.ok, true);
});

test("body JSON rusak dibalas 400 bad-json (bukan lemparan)", () => {
  const h = load();
  const response = h.post("{bukan json");
  assert.equal(response.json.ok, false);
  assert.equal(response.json.status, 400);
  assert.equal(response.json.code, "bad-json");
});

test("health melaporkan mode sheets+drive dan jumlah baris", () => {
  const h = load();
  const data = h.get({ action: "health" }).json.data;
  assert.equal(data.mode, "sheets+drive");
  assert.equal(data.sheetConfigured, true);
  assert.equal(data.sessionConfigured, true);
  assert.equal(data.version, "3.0.0-sheets");
  assert.deepEqual(data.counts, { events: 0, photos: 0, templates: 0, printOrders: 0, rsvp: 0, guestbook: 0 });
  assert.equal(data.limits.maxUploadBytes, 8 * 1024 * 1024);
  assert.equal(data.ready, true);
  assert.deepEqual(data.errors, []);
});

/* ── Sesi admin ────────────────────────────────────────────────────────── */

test("login: PIN salah 401, PIN benar menerbitkan token HMAC", () => {
  const h = load();

  const kosong = h.post({ action: "login" });
  assert.equal(kosong.json.status, 400);
  assert.equal(kosong.json.code, "bad-request");

  const salah = h.post({ action: "login", pin: "000000" });
  assert.equal(salah.json.ok, false);
  assert.equal(salah.json.status, 401);
  assert.equal(salah.json.code, "invalid-pin");

  const session = login(h);
  assert.match(session.sid, /^adm_[0-9a-f]{12}\.\d+\.[0-9a-f]{64}$/);
  assert.equal(session.admin.nama, "Admin Utama");
  assert.equal(session.admin.role, "admin");
  assert.equal(session.admin.aktif, true);
  assert.ok(session.ttlSec > 0);
  assert.equal(new Date(session.expiresAt).getTime(), Number(session.sid.split(".")[1]) * 1000);

  /* Sekali login, baris Admin hanya dibuat sekali (idempoten). */
  assert.equal(h.call("readRows_", "Admin").length, 1);
  const again = login(h);
  assert.equal(again.admin.id, session.admin.id);
  assert.equal(h.call("readRows_", "Admin").length, 1);
});

test("me & events butuh sesi sah; tanpa sesi 401 no-session", () => {
  const h = load();
  const tanpa = h.get({ action: "events" });
  assert.equal(tanpa.json.status, 401);
  assert.equal(tanpa.json.code, "no-session");

  const session = login(h);
  const me = h.get({ action: "me", sid: session.sid });
  assert.equal(me.json.ok, true);
  assert.equal(me.json.data.admin.id, session.admin.id);

  const list = h.get({ action: "events", sid: session.sid });
  assert.deepEqual(list.json.data, { events: [], total: 0 });

  const rusak = h.get({ action: "me", sid: "bukan.token.sah" });
  assert.equal(rusak.json.status, 401);
  assert.equal(rusak.json.code, "bad-session");

  /* Tanda tangan diubah → HMAC tidak cocok. */
  const parts = session.sid.split(".");
  const dipalsukan = h.get({ action: "me", sid: parts[0] + "." + parts[1] + "." + "f".repeat(64) });
  assert.equal(dipalsukan.json.status, 401);
  assert.equal(dipalsukan.json.code, "bad-session");
});

test("sesi kedaluwarsa ditolak dengan 401 session-expired", () => {
  const h = load();
  const session = login(h);
  const adminId = session.sid.split(".")[0];
  const exp = Math.round(Date.now() / 1000) - 60;
  const kedaluwarsa = adminId + "." + exp + "." + h.call("hmacHex_", adminId + "." + exp);

  const response = h.post({ action: "me", sid: kedaluwarsa });
  assert.equal(response.json.status, 401);
  assert.equal(response.json.code, "session-expired");
});

test("logout mencabut sesi (token jadi tidak berlaku)", () => {
  const h = load();
  const session = login(h);

  const keluar = h.post({ action: "logout", sid: session.sid });
  assert.equal(keluar.json.ok, true);
  assert.equal(keluar.json.data.ok, true);

  const setelah = h.post({ action: "me", sid: session.sid });
  assert.equal(setelah.json.status, 401);
  assert.equal(setelah.json.code, "session-revoked");

  const tanpaSesi = h.post({ action: "logout" });
  assert.equal(tanpaSesi.json.status, 401);
  assert.equal(tanpaSesi.json.code, "no-session");
});

test("rate limit login: percobaan melebihi batas dibalas 429", () => {
  const h = load({ LOGIN_MAX_ATTEMPTS: "1" });
  const pertama = h.post({ action: "login", pin: "000000" });
  assert.equal(pertama.json.status, 401);
  assert.equal(pertama.json.code, "invalid-pin");

  const kedua = h.post({ action: "login", pin: ADMIN_PIN });
  assert.equal(kedua.json.status, 429);
  assert.equal(kedua.json.code, "rate-limited");
});

/* ── Acara (admin) & kunci tamu ────────────────────────────────────────── */

test("createEvent: slug, kunci tamu, folder Drive, template default", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);

  assert.match(event.id, /^evt_[0-9a-f]{12}$/);
  assert.equal(event.slug, "pesta-ulang-tahun");
  assert.equal(event.jenis, "ulang-tahun");
  assert.equal(event.tanggal, "2026-11-01");
  assert.equal(event.lokasi, "Bandung");
  assert.equal(event.preset, "funsaver");
  assert.equal(event.aktif, true);
  assert.equal(event.count, 0);
  assert.match(event.joinKey, /^[0-9a-f]{32}$/);
  assert.ok(event.createdAt);

  const folder = folderFor(h, event.slug);
  assert.equal(folder.getName(), "event-pesta-ulang-tahun");
  assert.equal(folder.getId(), event.driveFolderId);
  assert.equal(h.state.helpers.foldersNamed("Satu-Album").length, 1, "root folder dibuat sekali");

  const kunci = "?k=" + encodeURIComponent(event.joinKey);
  assert.equal(event.links.camera, BASE_URL + "/camera.html#pesta-ulang-tahun" + kunci);
  assert.equal(event.links.galeri, BASE_URL + "/galeri.html#pesta-ulang-tahun" + kunci);
  assert.equal(event.links.undangan, BASE_URL + "/undangan.html#pesta-ulang-tahun" + kunci);
  assert.equal(event.links.rsvp, BASE_URL + "/rsvp.html#pesta-ulang-tahun" + kunci);

  const templates = h.call("readRows_", "Templates");
  assert.equal(templates.length, 1);
  assert.equal(templates[0].event_id, event.id);
  assert.equal(templates[0].tema_warna, "#7c3aed");
  assert.equal(templates[0].tata_letak, "elegan");

  const list = h.get({ action: "events", sid: session.sid }).json.data;
  assert.equal(list.total, 1);
  assert.equal(list.events[0].slug, event.slug);
  assert.equal(list.events[0].count, 0);
  assert.equal(list.events[0].joinKey, event.joinKey);

  /* Slug bentrok diberi akhiran angka. */
  const kedua = makeEvent(h, session);
  assert.equal(kedua.slug, "pesta-ulang-tahun-2");
});

test("detail event: kunci tamu menentukan `authorized`", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);

  const tanpaKunci = h.get({ action: "event", slug: event.slug }).json.data;
  assert.equal(tanpaKunci.authorized, false);
  assert.equal(tanpaKunci.event.slug, event.slug);
  assert.equal("joinKey" in tanpaKunci.event, false, "kunci tamu tidak bocor tanpa otorisasi");
  assert.equal("links" in tanpaKunci.event, false);

  const kunciSalah = h.get({ action: "event", slug: event.slug, k: "x".repeat(32) }).json.data;
  assert.equal(kunciSalah.authorized, false);

  const sah = h.get({ action: "event", slug: event.slug, k: event.joinKey }).json.data;
  assert.equal(sah.authorized, true);
  assert.equal(sah.event.joinKey, event.joinKey);
  assert.equal(sah.event.links.camera, event.links.camera);

  /* Admin dianggap terotorisasi walau tanpa kunci. */
  const admin = h.get({ action: "event", slug: event.slug, sid: session.sid }).json.data;
  assert.equal(admin.authorized, true);
  assert.equal(admin.event.joinKey, event.joinKey);

  const hilang = h.get({ action: "event", slug: "tidak-ada" });
  assert.equal(hilang.json.status, 404);
  assert.equal(hilang.json.code, "not-found");

  const tanpaSlug = h.get({ action: "event" });
  assert.equal(tanpaSlug.json.status, 400);
});

test("nama acara wajib diisi saat createEvent", () => {
  const h = load();
  const session = login(h);
  const response = h.post({ action: "createEvent", sid: session.sid, nama: "   " });
  assert.equal(response.json.status, 400);
  assert.equal(response.json.code, "bad-request");
});

test("updateEvent: patch field, rotateKey membatalkan link lama, aktif=false 410", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);

  const patch = h.post({
    action: "updateEvent",
    sid: session.sid,
    slug: event.slug,
    lokasi: "Yogyakarta",
    tanggal: "2026-12-24"
  }).json.data.event;
  assert.equal(patch.lokasi, "Yogyakarta");
  assert.equal(patch.tanggal, "2026-12-24");

  const diputar = h.post({ action: "updateEvent", sid: session.sid, slug: event.slug, rotateKey: true }).json.data.event;
  assert.match(diputar.joinKey, /^[0-9a-f]{32}$/);
  assert.notEqual(diputar.joinKey, event.joinKey);
  assert.equal(h.get({ action: "event", slug: event.slug, k: event.joinKey }).json.data.authorized, false);
  assert.equal(h.get({ action: "event", slug: event.slug, k: diputar.joinKey }).json.data.authorized, true);

  const nonaktif = h.post({ action: "updateEvent", sid: session.sid, slug: event.slug, aktif: false }).json.data.event;
  assert.equal(nonaktif.aktif, false);

  /* Detail masih terbuka lewat kunci tamu, tapi tanpa kunci ditolak. */
  const tamuTanpaKunci = h.get({ action: "event", slug: event.slug });
  assert.equal(tamuTanpaKunci.json.status, 410);
  assert.equal(tamuTanpaKunci.json.code, "event-inactive");

  const tamuDenganKunci = h.get({ action: "event", slug: event.slug, k: diputar.joinKey }).json.data;
  assert.equal(tamuDenganKunci.authorized, true);
  assert.equal(tamuDenganKunci.event.aktif, false);

  /* Unggahan tetap ditutup untuk tamu saat acara nonaktif. */
  const unduh = h.post({ action: "uploadPhoto", slug: event.slug, k: diputar.joinKey, mime: "image/png", data: PNG_1X1 });
  assert.equal(unduh.json.status, 410);
  assert.equal(unduh.json.code, "event-inactive");


  /* Admin tetap bisa membuka & mengaktifkan kembali. */
  const admin = h.get({ action: "event", slug: event.slug, sid: session.sid }).json.data;
  assert.equal(admin.authorized, true);
  assert.equal(admin.event.aktif, false);

  const aktifLagi = h.post({ action: "updateEvent", sid: session.sid, slug: event.slug, aktif: true }).json.data.event;
  assert.equal(aktifLagi.aktif, true);

  const hilang = h.post({ action: "updateEvent", sid: session.sid, slug: "tidak-ada", lokasi: "X" });
  assert.equal(hilang.json.status, 404);
});

test("deleteEvent: folder ke Trash + baris terkait dibersihkan", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);

  const foto = upload(h, event).json.data.photo;
  h.post({ action: "rsvp", slug: event.slug, k: event.joinKey, nama: "Budi", kontak: "0812", hadir: "ya", jumlahTamu: 2 });
  h.post({ action: "guestbook", slug: event.slug, k: event.joinKey, nama: "Sari", pesan: "Selamat!" });
  h.post({
    action: "createPrintOrder",
    slug: event.slug,
    k: event.joinKey,
    photoIds: [foto.id],
    namaPemesan: "Budi",
    kontak: "0812"
  });

  const folder = folderFor(h, event.slug);
  const response = h.post({ action: "deleteEvent", sid: session.sid, slug: event.slug }).json.data;
  assert.equal(response.ok, true);
  assert.deepEqual(response.removed, { photos: 1, orders: 1, rsvp: 1, guestbook: 1, folderTrashed: true });
  assert.equal(folder.trashed, true);

  for (const tab of ["Events", "Photos", "Templates", "RSVP", "Guestbook", "PrintOrders", "PrintItems"]) {
    assert.equal(h.call("readRows_", tab).length, 0, tab + " harus kosong");
  }
  assert.equal(h.get({ action: "event", slug: event.slug }).json.status, 404);
  assert.equal(h.get({ action: "events", sid: session.sid }).json.data.total, 0);
});

/* ── Foto: unggah, daftar, hapus ───────────────────────────────────────── */

test("uploadPhoto menaruh berkas di Drive dan satu baris di tab Photos", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);
  const folder = folderFor(h, event.slug);

  const response = upload(h, event, "data:image/png;base64," + PNG_1X1).json;
  assert.equal(response.ok, true);
  assert.equal(response.data.count, 1);
  assert.ok(response.data.undoWindowMs > 0);
  assert.ok(response.data.serverTime);

  const foto = response.data.photo;
  assert.match(foto.id, /^file\d+$/);
  assert.match(foto.name, /^photo-\d+-\d+\.png$/);
  assert.equal(foto.mime, "image/png");
  assert.equal(foto.source, "camera");
  assert.equal(foto.shared, true);
  assert.equal(foto.size, Buffer.from(PNG_1X1, "base64").length);

  assert.ok(foto.url.includes("thumbnail?id=" + foto.id), foto.url);
  assert.ok(foto.thumb.includes("thumbnail?id=" + foto.id), foto.thumb);
  assert.notEqual(foto.url, foto.thumb);

  const berkas = h.state.helpers.filesIn(folder.getId());
  assert.equal(berkas.length, 1);
  assert.equal(berkas[0].getId(), foto.id);
  assert.equal(berkas[0].mimeType, "image/png");
  assert.deepEqual(berkas[0].sharing, { access: "ANYONE_WITH_LINK", permission: "VIEW" });


  assert.equal(photoRows(h).length, 1);
  assert.equal(photoRows(h)[0].sumber, "camera");
  assert.equal(photoRows(h)[0].event_id, event.id);
  assert.equal(h.get({ action: "events", sid: session.sid }).json.data.events[0].count, 1);

  /* Admin boleh mengunggah tanpa kunci tamu. */
  const admin = h.post({ action: "uploadPhoto", sid: session.sid, slug: event.slug, data: PNG_1X1 });
  assert.equal(admin.json.ok, true);
  assert.equal(admin.json.data.count, 2);
});

test("photos: daftar dari cache, refresh memaksa hitung ulang, since menyaring", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);
  const pertama = upload(h, event).json.data.photo;

  const segar = h.get({ action: "photos", slug: event.slug, k: event.joinKey }).json.data;
  assert.equal(segar.fromCache, false);
  assert.equal(segar.count, 1);
  assert.equal(segar.photos[0].id, pertama.id);

  const cached = h.get({ action: "photos", slug: event.slug, k: event.joinKey }).json.data;
  assert.equal(cached.fromCache, true);

  const dipaksa = h.get({ action: "photos", slug: event.slug, k: event.joinKey, refresh: "1" }).json.data;
  assert.equal(dipaksa.fromCache, false);

  const kedua = upload(h, event).json.data.photo;
  assert.ok(String(kedua.createdAt) >= String(pertama.createdAt));

  const kosong = h.get({ action: "photos", slug: event.slug, k: event.joinKey, since: "9999-01-01T00:00:00.000Z" })
    .json.data;
  assert.deepEqual(kosong.photos, []);
  assert.equal(kosong.count, 2, "count tetap total album, bukan hasil filter");

  const semua = h.get({ action: "photos", slug: event.slug, k: event.joinKey, since: "1970-01-01T00:00:00.000Z" })
    .json.data;
  assert.equal(semua.photos.length, 2);
});

test("uploadPhoto menolak kunci salah, data kosong, base64 rusak, dan format asing", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);

  const kunciSalah = h.post({ action: "uploadPhoto", slug: event.slug, k: "x".repeat(32), data: PNG_1X1 });
  assert.equal(kunciSalah.json.status, 401);
  assert.equal(kunciSalah.json.code, "invalid-key");

  const tanpaData = h.post({ action: "uploadPhoto", slug: event.slug, k: event.joinKey, mime: "image/png" });
  assert.equal(tanpaData.json.status, 400);
  assert.equal(tanpaData.json.code, "bad-request");
  assert.match(tanpaData.json.error, /photo is required/);

  const base64Rusak = h.post({ action: "uploadPhoto", slug: event.slug, k: event.joinKey, data: "%%%bukan-base64%%%" });
  assert.equal(base64Rusak.json.status, 400);
  assert.equal(base64Rusak.json.code, "bad-request");

  const gif = h.post({ action: "uploadPhoto", slug: event.slug, k: event.joinKey, data: GIF });
  assert.equal(gif.json.status, 415);
  assert.equal(gif.json.code, "unsupported");
  assert.match(gif.json.error, /bukan gambar/);

  const heic = h.post({ action: "uploadPhoto", slug: event.slug, k: event.joinKey, data: HEIC });
  assert.equal(heic.json.status, 415);
  assert.equal(heic.json.code, "unsupported");
  assert.match(heic.json.error, /HEIC/);

  const pngPalsu = h.post({ action: "uploadPhoto", slug: event.slug, k: event.joinKey, data: JPEG, mime: "image/png" });
  assert.equal(pngPalsu.json.ok, true);
  assert.equal(pngPalsu.json.data.photo.mime, "image/jpeg", "mime diselidiki dari isi berkas");

  assert.equal(photoRows(h).length, 1, "hanya unggahan yang sah yang tercatat");
});

test("batas ukuran dan kapasitas album", () => {
  const h = load({ MAX_UPLOAD_MB: "0.001" });
  const session = login(h);
  const event = makeEvent(h, session);
  const besar = h.post({ action: "uploadPhoto", slug: event.slug, k: event.joinKey, data: JPEG });
  assert.equal(besar.json.status, 413);
  assert.equal(besar.json.code, "too-large");

  const h2 = load({ MAX_PHOTOS_PER_EVENT: "1" });
  const s2 = login(h2);
  const e2 = makeEvent(h2, s2);
  assert.equal(upload(h2, e2).json.ok, true);
  const penuh = upload(h2, e2);
  assert.equal(penuh.json.status, 409);
  assert.equal(penuh.json.code, "photo-limit");
});

test("deletePhoto: Undo tamu kadaluarsa, admin selalu boleh", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);
  const foto = upload(h, event).json.data.photo;
  const folder = folderFor(h, event.slug);

  const lama = new Date(Date.now() - 3600 * 1000).toISOString();
  h.call("updateRow_", "Photos", photoRows(h)[0]._row, { diunggah_pada: lama });

  const tamu = h.post({ action: "deletePhoto", slug: event.slug, k: event.joinKey, photoId: foto.id });
  assert.equal(tamu.json.status, 403);
  assert.equal(tamu.json.code, "undo-expired");
  assert.equal(photoRows(h).length, 1);

  const admin = h.post({ action: "deletePhoto", sid: session.sid, slug: event.slug, photoId: foto.id });
  assert.equal(admin.json.ok, true);
  assert.equal(admin.json.data.photo.id, foto.id);
  assert.equal(photoRows(h).length, 0);
  assert.equal(folder.getFiles().hasNext(), false);
  assert.equal([...h.state.helpers.files.values()][0].trashed, true, "berkas dikirim ke Trash");

  const ulang = h.post({ action: "deletePhoto", slug: event.slug, k: event.joinKey, photoId: foto.id });
  assert.equal(ulang.json.status, 404);

  const tanpaId = h.post({ action: "deletePhoto", slug: event.slug, k: event.joinKey });
  assert.equal(tanpaId.json.status, 400);
});

test("syncPhotos menambahkan berkas Drive yang belum tercatat", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);
  const folder = folderFor(h, event.slug);

  h.state.helpers.addFile(folder.getId(), "manual-1.jpg", "xx", "image/jpeg");
  h.state.helpers.addFile(folder.getId(), "catatan.json", "{}", "application/json");

  const hasil = h.post({ action: "syncPhotos", sid: session.sid, slug: event.slug }).json.data;
  assert.equal(hasil.total, 1);
  assert.equal(hasil.results[0].slug, event.slug);
  assert.equal(hasil.results[0].added, 1);
  assert.equal(hasil.results[0].skipped, 0, "berkas non-gambar dilewati tanpa dihitung");
  assert.equal(hasil.results[0].scanned, 2);
  assert.equal(photoRows(h).length, 1);
  assert.equal(photoRows(h)[0].sumber, "sync");

  const lagilagi = h.post({ action: "syncPhotos", sid: session.sid, slug: event.slug }).json.data;
  assert.equal(lagilagi.results[0].added, 0);
  assert.equal(lagilagi.results[0].skipped, 1);
  assert.equal(photoRows(h).length, 1);

  const tanpaSesi = h.post({ action: "syncPhotos", slug: event.slug });
  assert.equal(tanpaSesi.json.status, 401);
  assert.equal(tanpaSesi.json.code, "no-session");
});

/* ── Template undangan ─────────────────────────────────────────────────── */

test("template publik memakai kunci tamu & menyajikan default acara", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);

  const tanpaKunci = h.get({ action: "template", slug: event.slug });
  assert.equal(tanpaKunci.json.status, 401);
  assert.equal(tanpaKunci.json.code, "invalid-key");

  const template = h.get({ action: "template", slug: event.slug, k: event.joinKey }).json.data.template;
  assert.match(template.id, /^tpl/);
  assert.equal(template.eventId, event.id);
  assert.equal(template.namaTemplate, "Template Default");
  assert.equal(template.temaWarna, "#7c3aed");
  assert.equal(template.tataLetak, "elegan");
  /* Template otomatis memakai teks umum ("Acara") — admin menggantinya lewat saveTemplate. */
  assert.equal(template.teksCouple, "Acara");

  assert.match(template.teksHero, /Undangan/);
  assert.equal(template.musikUrl, "");
  assert.ok(template.updatedAt);
});

test("saveTemplate: validasi, fallback, dan efeknya ke sisi tamu", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);

  const disimpan = h.post({
    action: "saveTemplate",
    sid: session.sid,
    slug: event.slug,
    namaTemplate: "Tema Jawa",
    temaWarna: "rgb(12, 34, 56)",
    tataLetak: "floral",
    teksHero: "Undangan Syukuran",
    musikUrl: "https://contoh.test/lagu.mp3"
  }).json.data.template;
  assert.equal(disimpan.namaTemplate, "Tema Jawa");
  assert.equal(disimpan.temaWarna, "rgb(12, 34, 56)");
  assert.equal(disimpan.tataLetak, "floral");
  assert.equal(disimpan.musikUrl, "https://contoh.test/lagu.mp3");
  assert.equal(h.call("readRows_", "Templates")[0].tata_letak, "floral");

  const publik = h.get({ action: "template", slug: event.slug, k: event.joinKey }).json.data.template;
  assert.equal(publik.namaTemplate, "Tema Jawa");
  assert.equal(publik.temaWarna, "rgb(12, 34, 56)");

  /* Nilai tak dikenal dibersihkan ke default, bukan ditolak. */
  const dibersihkan = h.post({
    action: "saveTemplate",
    sid: session.sid,
    slug: event.slug,
    tataLetak: "neon",
    temaWarna: "<script>"
  }).json.data.template;
  assert.equal(dibersihkan.tataLetak, "elegan");
  assert.equal(dibersihkan.temaWarna, "#7c3aed");
  assert.equal(dibersihkan.namaTemplate, "Tema Jawa", "field yang tidak dikirim tidak berubah");

  const musikSalah = h.post({
    action: "saveTemplate",
    sid: session.sid,
    slug: event.slug,
    musikUrl: "bukan-url"
  });
  assert.equal(musikSalah.json.status, 400);
  assert.equal(musikSalah.json.code, "bad-music-url");

  const terlaluPanjang = h.post({
    action: "saveTemplate",
    sid: session.sid,
    slug: event.slug,
    teksHero: "x".repeat(2001)
  });
  assert.equal(terlaluPanjang.json.status, 400);
  assert.equal(terlaluPanjang.json.code, "text-too-long");

  const tanpaEvent = h.post({ action: "saveTemplate", sid: session.sid, temaWarna: "#000000" });
  assert.equal(tanpaEvent.json.status, 404);
  assert.equal(tanpaEvent.json.code, "not-found");

  const tanpaSesi = h.post({ action: "saveTemplate", slug: event.slug, temaWarna: "#000000" });
  assert.equal(tanpaSesi.json.status, 401);
  assert.equal(tanpaSesi.json.code, "no-session");
});

test("template acara hilang dibuat otomatis saat dibuka tamu", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);
  const rows = h.call("readRows_", "Templates");
  h.call("deleteRow_", "Templates", rows[0]._row);
  assert.equal(h.call("readRows_", "Templates").length, 0);

  const template = h.get({ action: "template", slug: event.slug, k: event.joinKey }).json.data.template;
  assert.equal(template.namaTemplate, "Template Default");
  assert.equal(template.teksCouple, "Acara");
  assert.equal(h.call("readRows_", "Templates").length, 1);

});

/* ── RSVP & buku tamu ──────────────────────────────────────────────────── */

test("rsvp: upsert per kontak, validasi wajib, ringkasan kehadiran", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);

  const pertama = h.post({
    action: "rsvp",
    slug: event.slug,
    k: event.joinKey,
    nama: "Budi",
    kontak: "0812-1111",
    hadir: "ya",
    jumlahTamu: 3,
    pesan: "Sampai jumpa"
  }).json;
  assert.equal(pertama.ok, true);
  assert.match(pertama.data.rsvp.id, /^rsv/);
  assert.equal(pertama.data.rsvp.nama, "Budi");
  assert.equal(pertama.data.rsvp.hadir, true);
  assert.equal(pertama.data.rsvp.jumlahTamu, 3);
  assert.deepEqual(pertama.data.summary, { total: 1, hadir: 1, tidakHadir: 0, totalTamu: 3 });

  /* Kontak sama → baris diperbarui, tidak menumpuk. */
  const kedua = h.post({
    action: "rsvp",
    slug: event.slug,
    k: event.joinKey,
    nama: "Budi Santoso",
    kontak: "0812-1111",
    hadir: "tidak",
    jumlahTamu: 5
  }).json;
  assert.equal(kedua.data.rsvp.id, pertama.data.rsvp.id);
  assert.equal(kedua.data.rsvp.nama, "Budi Santoso");
  assert.equal(kedua.data.rsvp.hadir, false);
  assert.equal(kedua.data.rsvp.jumlahTamu, 1, "tamu tidak hadir tetap dicatat minimal 1 kursi");

  assert.deepEqual(kedua.data.summary, { total: 1, hadir: 0, tidakHadir: 1, totalTamu: 0 });
  assert.equal(h.call("readRows_", "RSVP").length, 1);

  /* Tanpa kontak: selalu baris baru (tidak bisa dicocokkan ke tamu sebelumnya). */
  h.post({ action: "rsvp", slug: event.slug, k: event.joinKey, nama: "Sari", hadir: true });
  assert.equal(h.call("readRows_", "RSVP").length, 2);

  const tanpaNama = h.post({ action: "rsvp", slug: event.slug, k: event.joinKey, kontak: "08", hadir: "ya" });
  assert.equal(tanpaNama.json.status, 400);
  assert.equal(tanpaNama.json.code, "missing-nama");

  const tanpaHadir = h.post({ action: "rsvp", slug: event.slug, k: event.joinKey, nama: "Tono" });
  assert.equal(tanpaHadir.json.status, 400);
  assert.equal(tanpaHadir.json.code, "missing-kehadiran");

  const kunciSalah = h.post({ action: "rsvp", slug: event.slug, k: "x", nama: "Tono", hadir: "ya" });
  assert.equal(kunciSalah.json.status, 401);
  assert.equal(kunciSalah.json.code, "invalid-key");

  const daftar = h.get({ action: "listRsvp", sid: session.sid, slug: event.slug }).json.data;
  assert.equal(daftar.total, 2);
  assert.equal(daftar.items.length, 2);
  assert.equal(daftar.summary.total, 2);
  assert.equal(daftar.summary.hadir, 1);

  const tanpaSesi = h.get({ action: "listRsvp", slug: event.slug });
  assert.equal(tanpaSesi.json.status, 401);
  assert.equal(tanpaSesi.json.code, "no-session");
});

test("guestbook: tambah, baca, dan hapus oleh admin", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);

  const kosong = h.get({ action: "guestbook", slug: event.slug, k: event.joinKey }).json.data;
  assert.deepEqual(kosong, { items: [], total: 0 });

  const tambah = h.post({ action: "guestbook", slug: event.slug, k: event.joinKey, nama: "Sari", pesan: "Barakallah!" })
    .json.data.entry;
  assert.match(tambah.id, /^gbk/);
  assert.equal(tambah.nama, "Sari");
  assert.equal(tambah.pesan, "Barakallah!");
  assert.ok(tambah.createdAt);

  const kedua = h.post({ action: "guestbook", slug: event.slug, k: event.joinKey, nama: "Andi", ucapan: "Selamat ya" })
    .json.data.entry;
  assert.equal(kedua.pesan, "Selamat ya");

  const daftar = h.get({ action: "guestbook", slug: event.slug, k: event.joinKey }).json.data;
  assert.equal(daftar.total, 2);
  assert.deepEqual(
    daftar.items.map((item) => item.id).sort(),
    [tambah.id, kedua.id].sort(),
    "urutan tampil boleh terbaru dulu, isinya harus lengkap"
  );

  /* POST tanpa `pesan`/`ucapan` diperlakukan sebagai permintaan daftar. */
  const daftarLewatPost = h.post({ action: "guestbook", slug: event.slug, k: event.joinKey }).json.data;
  assert.equal(daftarLewatPost.total, 2);

  const tanpaNama = h.post({ action: "guestbook", slug: event.slug, k: event.joinKey, pesan: "Halo" });
  assert.equal(tanpaNama.json.status, 400);
  assert.equal(tanpaNama.json.code, "missing-nama");

  const hapus = h.post({ action: "deleteGuestbook", sid: session.sid, slug: event.slug, entryId: tambah.id }).json.data;
  assert.equal(hapus.ok, true);
  assert.equal(hapus.removed.id, tambah.id);
  assert.equal(h.get({ action: "guestbook", slug: event.slug, k: event.joinKey }).json.data.total, 1);

  const ulang = h.post({ action: "deleteGuestbook", sid: session.sid, slug: event.slug, entryId: tambah.id });
  assert.equal(ulang.json.status, 404);
  assert.equal(ulang.json.code, "not-found");

  const tanpaId = h.post({ action: "deleteGuestbook", sid: session.sid, slug: event.slug });
  assert.equal(tanpaId.json.status, 400);

  const tanpaSesi = h.post({ action: "deleteGuestbook", slug: event.slug, entryId: kedua.id });
  assert.equal(tanpaSesi.json.status, 401);
  assert.equal(tanpaSesi.json.code, "no-session");
});

/* ── Daftar cetak ──────────────────────────────────────────────────────── */

test("createPrintOrder: item tersimpan, dobel klik dideduplikasi, validasi ketat", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);
  const foto1 = upload(h, event).json.data.photo;
  const foto2 = upload(h, event).json.data.photo;

  const pesan = {
    action: "createPrintOrder",
    slug: event.slug,
    k: event.joinKey,
    photoIds: [foto1.id, foto2.id],
    namaPemesan: "Budi",
    kontak: "0812-1111",
    alamat: "Jl. Merdeka 1",
    catatan: "Cetak terang",
    ukuranCetak: "4R"
  };
  const pertama = h.post(pesan).json.data;
  assert.equal(pertama.duplicate, false);
  assert.match(pertama.order.id, /^ord/);
  assert.equal(pertama.order.status, "baru");
  assert.equal(pertama.order.namaPemesan, "Budi");
  assert.equal(pertama.order.alamat, "Jl. Merdeka 1");
  assert.equal(pertama.order.totalFoto, 2);
  assert.equal(pertama.order.items.length, 2);
  assert.deepEqual(pertama.order.items.map((item) => item.photoId).sort(), [foto1.id, foto2.id].sort());
  assert.equal(pertama.order.items[0].jumlah, 1);
  assert.equal(pertama.order.items[0].ukuran, "4R");
  assert.ok(pertama.order.items[0].thumb.includes("thumbnail?id=" + pertama.order.items[0].photoId));
  assert.equal(h.call("readRows_", "PrintItems").length, 2);

  /* Kirim ulang identik = dobel klik, bukan order baru. */
  const ulang = h.post(pesan).json.data;
  assert.equal(ulang.duplicate, true);
  assert.equal(ulang.order.id, pertama.order.id);
  assert.equal(h.call("readRows_", "PrintOrders").length, 1);
  assert.equal(h.call("readRows_", "PrintItems").length, 2);

  /* photoIds berupa string dipisah koma diterima. */
  const sebagaiString = h.post({
    action: "createPrintOrder",
    slug: event.slug,
    k: event.joinKey,
    photoIds: foto1.id + ", " + foto2.id,
    namaPemesan: "Sari",
    kontak: "0813"
  }).json.data;
  assert.equal(sebagaiString.duplicate, false);
  assert.equal(sebagaiString.order.totalFoto, 2);
  assert.equal(sebagaiString.order.items[0].ukuran, "4R", "ukuran default 4R");
});

test("createPrintOrder menolak input tidak lengkap atau foto asing", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);
  const foto = upload(h, event).json.data.photo;

  const tanpaFoto = h.post({
    action: "createPrintOrder",
    slug: event.slug,
    k: event.joinKey,
    photoIds: [],
    namaPemesan: "Budi",
    kontak: "0812"
  });
  assert.equal(tanpaFoto.json.status, 400);
  assert.equal(tanpaFoto.json.code, "no-photos");

  const fotoAsing = h.post({
    action: "createPrintOrder",
    slug: event.slug,
    k: event.joinKey,
    photoIds: ["file-tidak-ada"],
    namaPemesan: "Budi",
    kontak: "0812"
  });
  assert.equal(fotoAsing.json.status, 400);
  assert.equal(fotoAsing.json.code, "photo-not-found");

  const tanpaNama = h.post({
    action: "createPrintOrder",
    slug: event.slug,
    k: event.joinKey,
    photoIds: [foto.id],
    kontak: "0812"
  });
  assert.equal(tanpaNama.json.status, 400);
  assert.equal(tanpaNama.json.code, "missing-nama");

  const kebanyakan = h.post({
    action: "createPrintOrder",
    slug: event.slug,
    k: event.joinKey,
    photoIds: Array.from({ length: 51 }, (_, i) => "file-" + i),
    namaPemesan: "Budi",
    kontak: "0812"
  });
  assert.equal(kebanyakan.json.status, 400);
  assert.equal(kebanyakan.json.code, "too-many-photos");

  const kunciSalah = h.post({ action: "createPrintOrder", slug: event.slug, k: "x", photoIds: [foto.id] });
  assert.equal(kunciSalah.json.status, 401);
  assert.equal(kunciSalah.json.code, "invalid-key");
});

test("listPrintOrders & updatePrintOrderStatus hanya untuk sesi admin", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);
  const foto = upload(h, event).json.data.photo;

  const order = h.post({
    action: "createPrintOrder",
    slug: event.slug,
    k: event.joinKey,
    photoIds: [foto.id],
    namaPemesan: "Budi",
    kontak: "0812"
  }).json.data.order;

  const daftar = h.get({ action: "listPrintOrders", sid: session.sid, slug: event.slug }).json.data;
  assert.equal(daftar.total, 1);
  assert.equal(daftar.order, null);
  assert.deepEqual(daftar.counts, { baru: 1, diproses: 0, selesai: 0, dibatalkan: 0 });
  assert.equal(daftar.items[0].id, order.id);
  assert.equal(daftar.items[0].items.length, 1);

  const hanyaSelesai = h.get({ action: "listPrintOrders", sid: session.sid, slug: event.slug, status: "selesai" }).json
    .data;
  assert.equal(hanyaSelesai.total, 0);
  assert.equal(hanyaSelesai.counts.baru, 1, "counts selalu dari semua order acara");

  const diproses = h.post({
    action: "updatePrintOrderStatus",
    sid: session.sid,
    slug: event.slug,
    orderId: order.id,
    status: "Diproses"
  }).json.data.order;
  assert.equal(diproses.status, "diproses");

  const setelahnya = h.get({ action: "listPrintOrders", sid: session.sid, slug: event.slug }).json.data;
  assert.deepEqual(setelahnya.counts, { baru: 0, diproses: 1, selesai: 0, dibatalkan: 0 });

  const statusSalah = h.post({
    action: "updatePrintOrderStatus",
    sid: session.sid,
    slug: event.slug,
    orderId: order.id,
    status: "hilang"
  });
  assert.equal(statusSalah.json.status, 400);
  assert.equal(statusSalah.json.code, "bad-status");

  const tanpaId = h.post({ action: "updatePrintOrderStatus", sid: session.sid, slug: event.slug, status: "selesai" });
  assert.equal(tanpaId.json.status, 400);
  assert.equal(tanpaId.json.code, "missing-order-id");

  const idAsing = h.post({
    action: "updatePrintOrderStatus",
    sid: session.sid,
    slug: event.slug,
    orderId: "ord_tidak_ada",
    status: "selesai"
  });
  assert.equal(idAsing.json.status, 404);
  assert.equal(idAsing.json.code, "order-not-found");

  const tanpaSesi = h.post({ action: "updatePrintOrderStatus", slug: event.slug, orderId: order.id, status: "selesai" });
  assert.equal(tanpaSesi.json.status, 401);
  assert.equal(tanpaSesi.json.code, "no-session");

  /* Order milik acara lain tidak bisa diubah dari acara ini. */
  const eventLain = makeEvent(h, session, { nama: "Acara Lain" });
  const lintasAcara = h.post({
    action: "updatePrintOrderStatus",
    sid: session.sid,
    slug: eventLain.slug,
    orderId: order.id,
    status: "selesai"
  });
  assert.equal(lintasAcara.json.status, 404);
  assert.equal(lintasAcara.json.code, "order-not-found");
});

/* ── Kelengkapan routing ──────────────────────────────────────────────── */

test("setiap action di handshake ping punya handler di dispatcher", () => {
  const h = load();
  const actions = h.get({ action: "ping" }).json.data.actions;
  assert.deepEqual(actions, [
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
  ]);

  /* Tanpa argumen, semua action harus gagal karena input — bukan 400 bad-action. */
  const tanpaHandler = actions.filter((action) => {
    const res = h.get({ action }).json;
    return res.ok === false && res.code === "bad-action";
  });
  assert.deepEqual(tanpaHandler, [], "action tanpa handler: " + tanpaHandler.join(", "));
});

/* ── Setup.gs & kesiapan konfigurasi ──────────────────────────────────── */

test("initSheets menyiapkan tab, admin, dan root folder Drive", () => {
  const h = load();
  const report = h.call("initSheets");

  assert.match(report, /Spreadsheet:/);
  assert.match(report, /Tab dibuat: .*Events/);
  assert.match(report, /Admin: adm_[0-9a-f]{12} \(Admin Utama\)/);
  assert.match(report, /Root folder Drive: Satu-Album/);
  assert.match(report, /Base URL frontend: https:\/\/contoh\.test\/satu-album/);
  assert.ok(h.state.logs.some((line) => line.includes("SELESAI")), "laporan dicatat ke Logger");

  /* Idempoten: jalan kedua tidak membuat tab/admin baru. */
  const adminId = /Admin: (adm_[0-9a-f]{12}) \(Admin Utama\)/.exec(report);
  assert.ok(adminId, "laporan menyebut id admin: " + report);
  const kedua = h.call("initSheets");
  assert.match(kedua, /Semua tab sudah ada\./);
  assert.ok(kedua.includes("Admin: " + adminId[1] + " (Admin Utama)"), kedua);
  assert.equal(h.call("readRows_", "Admin").length, 1);
  assert.equal(h.state.helpers.foldersNamed("Satu-Album").length, 1);

  /* PIN yang sudah ada tetap bisa dipakai login. */
  const session = login(h);
  assert.equal(session.admin.nama, "Admin Utama");
});

test("initSheets menolak konfigurasi tanpa SHEET_ID & memakai PIN sementara", () => {
  const tanpaSheet = load({ SHEET_ID: "" });
  assert.throws(() => tanpaSheet.call("initSheets"), /SHEET_ID belum diisi/);

  const tanpaPin = load({ ADMIN_PIN: "" });
  const report = tanpaPin.call("initSheets");
  assert.match(report, /PIN sementara '123456'/);
  assert.equal(tanpaPin.state.properties.ADMIN_PIN, "123456");
  assert.equal(login(tanpaPin, "123456").admin.nama, "Admin Utama");
});

test("setBaseUrl, showHealth, dan showEvents memakai data nyata", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);

  assert.equal(h.call("setBaseUrl"), "https://brazamuzti.github.io/Satu-Album");
  assert.equal(h.state.properties.BASE_URL, "https://brazamuzti.github.io/Satu-Album");

  const health = h.call("showHealth");
  assert.equal(health.mode, "sheets+drive");
  assert.equal(health.counts.events, 1);
  assert.equal(health.counts.templates, 1);
  assert.equal(health.ready, true);

  const events = h.call("showEvents");
  assert.equal(events.length, 1);
  assert.equal(events[0].slug, event.slug);
  assert.ok(events[0].links.camera.includes(event.joinKey));
  assert.ok(h.state.logs.some((line) => line.includes("Total event: 1")));
});

test("syncAllDrivePhotos & selfTest melaporkan kondisi sehat", () => {
  const h = load();
  const session = login(h);
  const event = makeEvent(h, session);
  const folder = folderFor(h, event.slug);
  h.state.helpers.addFile(folder.getId(), "manual-2.jpg", "xx", "image/jpeg");

  const ringkasan = h.call("syncAllDrivePhotos");
  assert.match(ringkasan, new RegExp(event.slug + ": \\+1"));
  assert.match(ringkasan, /Total foto baru: 1/);
  assert.equal(photoRows(h).length, 1);

  const selfTest = h.call("selfTest");
  assert.ok(selfTest.includes("OK   config_()"), selfTest);
  assert.equal(/FAIL/.test(selfTest), false, selfTest);
  assert.ok(selfTest.includes("cache round-trip -> ok"));
});

test("health melaporkan konfigurasi yang belum siap tanpa melempar error", () => {
  const tanpaSecret = load({ SESSION_SECRET: "" });
  const data = tanpaSecret.get({ action: "health" }).json.data;
  assert.equal(data.sessionConfigured, false);
  assert.equal(data.ready, false);
  assert.deepEqual(data.errors, []);

  const tanpaSheet = load({ SHEET_ID: "" });
  const data2 = tanpaSheet.get({ action: "health" }).json.data;
  assert.equal(data2.sheetConfigured, false);
  assert.equal(data2.ready, false);
  assert.match(data2.errors.join(" "), /SHEET_ID/);
});
