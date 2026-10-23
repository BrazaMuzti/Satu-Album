/* Uji end-to-end Web App Satu-Album dengan tiruan DriveApp/CacheService.

   Jalankan:  node --test gas/test        (atau `npm test` dari folder gas)
   Tidak butuh kredensial Google: semua sudah disimulasikan oleh harness. */

import assert from "node:assert/strict";
import test from "node:test";
import { loadGas, unwrap } from "./harness.mjs";

const ADMIN = "token-panjang-rahasia-123";
/* PNG 1×1 yang valid (70 byte) — sama dengan yang dipakai Setup.gs selfTest(). */
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==";
/* JPEG palsu berukuran besar: cukup untuk menguji batas ukuran & sniffing. */
const BIG_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4000, 7)]).toString("base64");

function props(extra = {}) {
  return { ADMIN_TOKEN: ADMIN, CACHE_TTL_MS: "1000", ...extra };
}

function makeAlbum(h, payload = {}) {
  const response = h.post({ action: "createEvent", adminToken: ADMIN, name: "Pesta Ulang Tahun", ...payload });
  assert.equal(response.json.ok, true, JSON.stringify(response.json));
  return response.json.data.event;
}

function upload(h, slug, key, data = PNG_1X1, mime = "image/png") {
  return h.post({ action: "uploadPhoto", slug, k: key, mime, data });
}

function eventFolder(h, slug) {
  const folder = h.state.helpers.foldersNamed("event-" + slug)[0];
  assert.ok(folder, "folder event-" + slug + " harus ada di Drive");
  return folder;
}

test("semua berkas .gs dimuat tanpa error sintaks", () => {
  const h = loadGas({ properties: props() });
  assert.deepEqual(h.state.fileNames, ["Code.gs", "Config.gs", "DriveStore.gs", "Lib.gs", "Setup.gs"]);
});

test("envelope sukses: GET ?action=ping", () => {
  const h = loadGas({ properties: props() });
  const response = h.get({ action: "ping" });
  assert.equal(response.mimeType, "application/json");
  assert.equal(response.json.ok, true);
  assert.equal(response.json.data.pong, true);
  assert.equal(typeof response.json.serverTime, "string");
  assert.ok(response.json.data.actions.includes("uploadPhoto"));
});

test("action tidak dikenal / kosong ditolak dengan 400 bad-action", () => {
  const h = loadGas({ properties: props() });
  const unknown = h.get({ action: "hapusSemua" });
  assert.equal(unknown.json.ok, false);
  assert.equal(unknown.json.status, 400);
  assert.equal(unknown.json.code, "bad-action");

  const missing = h.post({});
  assert.equal(missing.json.status, 400);
  assert.equal(missing.json.code, "bad-action");
});

test("JSONP: callback yang aman dibungkus, callback berbahaya diabaikan", () => {
  const h = loadGas({ properties: props() });
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
  const h = loadGas({ properties: props() });
  const response = h.post("{bukan json");
  assert.equal(response.json.ok, false);
  assert.equal(response.json.status, 400);
  assert.equal(response.json.code, "bad-json");
});

test("health melaporkan root folder setelah album pertama dibuat", () => {
  const h = loadGas({ properties: props({ DRIVE_ROOT_FOLDER_NAME: "Satu-Album" }) });
  const before = unwrap(h.get({ action: "health" }));
  assert.equal(before.rootFolderId, null, "health tidak boleh membuat folder sendiri");

  const event = makeAlbum(h);
  const after = unwrap(h.get({ action: "health" }));
  assert.equal(after.rootFolderId, after.rootFolderId && h.state.properties.DRIVE_ROOT_FOLDER_ID);
  assert.ok(after.rootFolderId, "root folder harus sudah tercatat setelah album dibuat");
  assert.equal(after.events, null, "health tanpa refresh=1 tidak memindai Drive");

  const forced = unwrap(h.get({ action: "health", refresh: "1" }));
  assert.equal(forced.events, 1);
  assert.equal(forced.adminConfigured, true);
  assert.equal(forced.limits.maxPhotosPerEvent, 800);
  assert.equal(forced.limits.undoWindowMs, 120000);
  assert.equal(forced.rootFolderName, "Satu-Album");
  assert.equal(event.slug, "pesta-ulang-tahun");
  assert.equal(event.count, 0);
  assert.ok(event.uploadKey && event.uploadKey.length === 32, "kunci tamu 32 karakter");
});

test("health tidak membuat folder saat root belum ada", () => {
  const h = loadGas({ properties: props() });
  const health = unwrap(h.get({ action: "health" }));
  assert.equal(health.rootFolderId, null);
  assert.equal(h.state.helpers.foldersNamed("Satu-Album").length, 0);
});

/* ── Album: otorisasi & pembuatan ─────────────────────────────────────── */

test("createEvent butuh token admin yang benar", () => {
  const h = loadGas({ properties: props() });
  const tanpa = h.post({ action: "createEvent", name: "Tanpa Token" });
  assert.equal(tanpa.json.status, 401);
  assert.equal(tanpa.json.code, "invalid-admin");

  const salah = h.post({ action: "createEvent", adminToken: "token-salah", name: "Salah" });
  assert.equal(salah.json.status, 401);

  const benar = h.post({ action: "createEvent", adminToken: ADMIN, name: "Benar" });
  assert.equal(benar.json.ok, true);
});

test("tanpa ADMIN_TOKEN di Script Properties, pembuatan album ditolak 503", () => {
  const h = loadGas({ properties: {} });
  const response = h.post({ action: "createEvent", adminToken: "apa-saja", name: "X" });
  assert.equal(response.json.status, 503);
  assert.equal(response.json.code, "admin-not-configured");
});

test("createEvent memvalidasi nama & menyimpan struktur Drive yang benar", () => {
  const h = loadGas({ properties: props() });
  assert.equal(h.post({ action: "createEvent", adminToken: ADMIN, name: "   " }).json.status, 400);
  assert.equal(h.post({ action: "createEvent", adminToken: ADMIN, name: "x".repeat(121) }).json.status, 400);

  const event = makeAlbum(h, { type: "pernikahan", preset: "portra", revealAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(event.type, "pernikahan");
  assert.equal(event.preset, "portra");
  assert.equal(event.revealAt, "2026-01-01T00:00:00.000Z");
  assert.equal(event.legacy, false);

  const folder = eventFolder(h, event.slug);
  const metaFiles = h.state.helpers.filesIn(folder.id);
  assert.equal(metaFiles.length, 1);
  assert.equal(metaFiles[0].name, "event.json");
  const stored = JSON.parse(metaFiles[0].bytes.toString("utf8"));
  assert.equal(stored.slug, event.slug);
  assert.equal(stored.uploadKey, event.uploadKey, "kunci tamu harus tersimpan di Drive");
  assert.equal(stored.version, 1);
});

test("nama album yang sama menghasilkan slug unik", () => {
  const h = loadGas({ properties: props() });
  const first = makeAlbum(h);
  const second = makeAlbum(h);
  const third = makeAlbum(h);
  assert.deepEqual([first.slug, second.slug, third.slug], ["pesta-ulang-tahun", "pesta-ulang-tahun-2", "pesta-ulang-tahun-3"]);
});

test("GET events hanya untuk admin dan menyertakan kunci tamu", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);

  const ditolak = h.get({ action: "events" });
  assert.equal(ditolak.json.status, 401);
  assert.equal(ditolak.json.code, "invalid-admin");

  const data = unwrap(h.get({ action: "events", token: ADMIN }));
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].slug, event.slug);
  assert.equal(data.events[0].uploadKey, event.uploadKey);
  assert.equal(data.stale, false);
});

test("GET event: kunci hanya terungkap bila benar (atau admin)", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);

  const tamuTanpaKunci = unwrap(h.get({ action: "event", slug: event.slug }));
  assert.equal(tamuTanpaKunci.authorized, false);
  assert.equal("uploadKey" in tamuTanpaKunci.event, false, "kunci tidak boleh bocor ke tamu tanpa kunci");

  const tamuSalah = unwrap(h.get({ action: "event", slug: event.slug, k: "kunci-palsu" }));
  assert.equal(tamuSalah.authorized, false);

  const tamuBenar = unwrap(h.get({ action: "event", slug: event.slug, k: event.uploadKey }));
  assert.equal(tamuBenar.authorized, true);
  assert.equal(tamuBenar.event.uploadKey, event.uploadKey);

  const admin = unwrap(h.get({ action: "event", slug: event.slug, token: ADMIN }));
  assert.equal(admin.authorized, true);

  assert.equal(h.get({ action: "event", slug: "tidak-ada" }).json.status, 404);
  assert.equal(h.get({ action: "event" }).json.status, 400);
});

/* ── Unggah foto ──────────────────────────────────────────────────────── */

test("uploadPhoto butuh kunci tamu yang benar", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);

  const tanpaKunci = upload(h, event.slug, "");
  assert.equal(tanpaKunci.json.status, 401);
  assert.equal(tanpaKunci.json.code, "invalid-key");

  const salah = upload(h, event.slug, "kunci-palsu");
  assert.equal(salah.json.status, 401);

  const slugSalah = upload(h, "album-tidak-ada", event.uploadKey);
  assert.equal(slugSalah.json.status, 404);
  assert.equal(slugSalah.json.code, "not-found");

  const tanpaSlug = h.post({ action: "uploadPhoto", k: event.uploadKey, mime: "image/png", data: PNG_1X1 });
  assert.equal(tanpaSlug.json.status, 400);
});

test("uploadPhoto menyimpan foto publik & menaikkan count di event.json", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);

  const response = upload(h, event.slug, event.uploadKey);
  assert.equal(response.json.ok, true);
  const data = unwrap(response);
  assert.equal(data.undoWindowMs, 120000);
  assert.equal(data.count, 1);
  assert.equal(typeof data.serverTime, "string");

  const photo = data.photo;
  assert.equal(photo.eventSlug, event.slug);
  assert.equal(photo.source, "drive");
  assert.equal(photo.size, 70);
  assert.equal(photo.mime, "image/png");
  assert.match(photo.url, /^https:\/\/drive\.google\.com\/thumbnail\?id=file\d+&sz=w1600$/);
  assert.match(photo.thumb, /&sz=w400$/);
  assert.match(photo.name, /^photo-\d+-\d+\.png$/);

  /* Foto dibagikan publik, tetapi folder album TIDAK. */
  const file = h.state.helpers.files.get(photo.id);
  assert.deepEqual(file.sharing, { access: "ANYONE_WITH_LINK", permission: "VIEW" });
  assert.equal(eventFolder(h, event.slug).sharing, undefined);

  const stored = JSON.parse(h.state.helpers.filesIn(eventFolder(h, event.slug).id).find((f) => f.name === "event.json").bytes.toString("utf8"));
  assert.equal(stored.count, 1, "count harus tersimpan di Drive, bukan hanya di memori");
  assert.ok(stored.countUpdatedAt);
});

test("uploadPhoto menolak data kosong, base64 rusak, dan bukan gambar", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);
  const slug = event.slug;

  const kosong = upload(h, slug, event.uploadKey, "");
  assert.equal(kosong.json.status, 400);
  assert.equal(kosong.json.code, "bad-request");

  const rusak = upload(h, slug, event.uploadKey, "!!!bukan-base64!!!");
  assert.equal(rusak.json.status, 400);

  const teks = upload(h, slug, event.uploadKey, Buffer.from("halo dunia").toString("base64"), "image/jpeg");
  assert.equal(teks.json.status, 415);
  assert.equal(teks.json.code, "unsupported");
});

test("uploadPhoto menolak foto melebihi MAX_UPLOAD_MB dengan 413 too-large", () => {
  const h = loadGas({ properties: props({ MAX_UPLOAD_MB: "0.001" }) });
  const event = makeAlbum(h);
  const response = upload(h, event.slug, event.uploadKey, BIG_JPEG, "image/jpeg");
  assert.equal(response.json.status, 413);
  assert.equal(response.json.code, "too-large");
  assert.match(response.json.error, /1 MB|0 MB/);
});

test("uploadPhoto menolak album yang sudah penuh (409 photo-limit)", () => {
  const h = loadGas({ properties: props({ MAX_PHOTOS_PER_EVENT: "1" }) });
  const event = makeAlbum(h);
  assert.equal(upload(h, event.slug, event.uploadKey).json.ok, true);
  const penuh = upload(h, event.slug, event.uploadKey);
  assert.equal(penuh.json.status, 409);
  assert.equal(penuh.json.code, "photo-limit");
});

test("uploadPhoto dibatasi per album (429 rate-limited)", () => {
  const h = loadGas({ properties: props({ RATE_UPLOAD_PER_HOUR: "2" }) });
  const event = makeAlbum(h);
  assert.equal(upload(h, event.slug, event.uploadKey).json.ok, true);
  assert.equal(upload(h, event.slug, event.uploadKey).json.ok, true);

  const ketiga = upload(h, event.slug, event.uploadKey);
  assert.equal(ketiga.json.status, 429);
  assert.equal(ketiga.json.code, "rate-limited");

  /* Album lain tidak terkena (pembatas per-slug, bukan global). */
  const lain = makeAlbum(h, { name: "Acara Lain" });
  assert.equal(upload(h, lain.slug, lain.uploadKey).json.ok, true);
});

/* ── Daftar foto ──────────────────────────────────────────────────────── */

test("GET photos melayani tamu bertamu kunci & memakai cache", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);
  unwrap(upload(h, event.slug, event.uploadKey));

  assert.equal(h.get({ action: "photos", slug: event.slug }).json.status, 401);

  const first = unwrap(h.get({ action: "photos", slug: event.slug, k: event.uploadKey }));
  assert.equal(first.photos.length, 1);
  assert.equal(first.count, 1);
  assert.equal(first.stale, false);
  assert.equal(first.fromCache, false, "panggilan pertama membaca Drive");

  const second = unwrap(h.get({ action: "photos", slug: event.slug, k: event.uploadKey }));
  assert.equal(second.fromCache, true, "panggilan berikutnya dilayani cache");
  assert.deepEqual(second.photos, first.photos);

  const refreshed = unwrap(h.get({ action: "photos", slug: event.slug, k: event.uploadKey, refresh: "1" }));
  assert.equal(refreshed.fromCache, false);
  assert.equal(refreshed.count, 1);
});

test("GET photos mendukung since= dan menyertakan serverTime", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);
  unwrap(upload(h, event.slug, event.uploadKey));

  const bomb = unwrap(h.get({ action: "photos", slug: event.slug, k: event.uploadKey, since: "2999-01-01T00:00:00.000Z" }));
  assert.equal(bomb.photos.length, 0);
  assert.equal(bomb.count, 1, "count = total album, bukan hasil filter");
  assert.equal(typeof bomb.serverTime, "string");

  const semua = unwrap(h.get({ action: "photos", slug: event.slug, k: event.uploadKey, since: "1970-01-01T00:00:00.000Z" }));
  assert.equal(semua.photos.length, 1);
});

test("refresh=1 menyelaraskan count event.json dengan jumlah foto nyata", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);
  unwrap(upload(h, event.slug, event.uploadKey));

  /* Foto ditambahkan langsung ke folder (mis. panitia mengunggah manual). */
  const folder = eventFolder(h, event.slug);
  h.state.helpers.addFile(folder.id, "photo-manual-1.jpg", "x", "image/jpeg");
  h.state.helpers.addFile(folder.id, "photo-manual-2.jpg", "x", "image/jpeg");

  const meta = JSON.parse(h.state.helpers.filesIn(folder.id).find((f) => f.name === "event.json").bytes.toString("utf8"));
  assert.equal(meta.count, 1, "sebelum refresh, count masih 1");

  const refreshed = unwrap(h.get({ action: "photos", slug: event.slug, k: event.uploadKey, refresh: "1" }));
  assert.equal(refreshed.photos.length, 3);
  assert.equal(refreshed.count, 3);

  const repaired = JSON.parse(h.state.helpers.filesIn(folder.id).find((f) => f.name === "event.json").bytes.toString("utf8"));
  assert.equal(repaired.count, 3, "count di Drive sudah diperbaiki");
});

test("daftar foto besar tetap akurat walau cache dipecah menjadi beberapa chunk", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);
  const folder = eventFolder(h, event.slug);
  for (let i = 0; i < 400; i += 1) {
    h.state.helpers.addFile(folder.id, "photo-banyak-" + i + ".jpg", "x", "image/jpeg");
  }

  const first = unwrap(h.get({ action: "photos", slug: event.slug, k: event.uploadKey, refresh: "1" }));
  assert.equal(first.photos.length, 400);

  const entry = h.state.cache.get("sa1:photos:" + event.slug);
  assert.equal(typeof entry.value, "string");
  assert.match(entry.value, /^#\d+$/, "payload > 90 KB harus disimpan sebagai chunk (" + entry.value + ")");
  assert.ok(Number(entry.value.slice(1)) >= 2);

  const second = unwrap(h.get({ action: "photos", slug: event.slug, k: event.uploadKey }));
  assert.equal(second.fromCache, true);
  assert.equal(second.photos.length, 400);
  assert.equal(second.photos[399].id, first.photos[399].id);
});

/* ── Hapus foto & jendela Undo ────────────────────────────────────────── */

test("deletePhoto: tamu boleh membatalkan fotonya dalam jendela Undo", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);
  const photo = unwrap(upload(h, event.slug, event.uploadKey)).photo;

  assert.equal(h.post({ action: "deletePhoto", slug: event.slug, photoId: photo.id }).json.status, 401);

  const removed = unwrap(h.post({ action: "deletePhoto", slug: event.slug, k: event.uploadKey, photoId: photo.id }));
  assert.equal(removed.ok, true);
  assert.equal(removed.photo.id, photo.id);
  assert.equal(h.state.helpers.files.get(photo.id).trashed, true, "foto ke Trash, bukan dihapus permanen");

  const count = unwrap(h.get({ action: "event", slug: event.slug, k: event.uploadKey })).event.count;
  assert.equal(count, 0, "count di event.json ikut turun");

  const hilang = h.post({ action: "deletePhoto", slug: event.slug, k: event.uploadKey, photoId: photo.id });
  assert.equal(hilang.json.status, 404);
});

test("deletePhoto: lewat jendela Undo ditolak 403, admin tetap boleh", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);
  h.state.rewindMs = 10 * 60 * 1000; /* foto dibuat 10 menit lalu */
  const photo = unwrap(upload(h, event.slug, event.uploadKey)).photo;
  h.state.rewindMs = 0;

  const kadaluarsa = h.post({ action: "deletePhoto", slug: event.slug, k: event.uploadKey, photoId: photo.id });
  assert.equal(kadaluarsa.json.status, 403);
  assert.equal(kadaluarsa.json.code, "undo-expired");
  assert.equal(h.state.helpers.files.get(photo.id).trashed, false);

  const admin = h.post({ action: "deletePhoto", adminToken: ADMIN, slug: event.slug, photoId: photo.id });
  assert.equal(admin.json.ok, true, "panitia boleh menghapus kapan saja");
});

test("deletePhoto menolak foto milik album lain (403 not-in-event)", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);
  const root = h.state.helpers.children(null)[0];
  const asing = h.state.helpers.addFile(root.id, "photo-luar.jpg", "bukan-milik-album", "image/jpeg");

  const response = h.post({ action: "deletePhoto", adminToken: ADMIN, slug: event.slug, photoId: asing.id });
  assert.equal(response.json.status, 403);
  assert.equal(response.json.code, "not-in-event");
  assert.equal(asing.trashed, false);
});

/* ── Ubah & hapus album ───────────────────────────────────────────────── */

test("updateEvent: ubah metadata & putar kunci tamu", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);
  unwrap(upload(h, event.slug, event.uploadKey));

  assert.equal(h.post({ action: "updateEvent", slug: event.slug, name: "Baru" }).json.status, 401);
  assert.equal(h.post({ action: "updateEvent", adminToken: ADMIN, slug: "tidak-ada", name: "Baru" }).json.status, 404);

  const updated = unwrap(
    h.post({ action: "updateEvent", adminToken: ADMIN, slug: event.slug, name: "Resepsi Baru", preset: "bw" })
  );
  assert.equal(updated.event.name, "Resepsi Baru");
  assert.equal(updated.event.preset, "bw");
  assert.equal(updated.event.uploadKey, event.uploadKey, "tanpa rotateUploadKey kunci tidak berubah");
  assert.equal(updated.event.count, 1, "count tetap terbaca dari folder");

  const rotated = unwrap(h.post({ action: "updateEvent", adminToken: ADMIN, slug: event.slug, rotateUploadKey: true }));
  assert.notEqual(rotated.event.uploadKey, event.uploadKey);

  /* Link lama mati, link baru hidup. */
  assert.equal(upload(h, event.slug, event.uploadKey).json.status, 401);
  assert.equal(upload(h, event.slug, rotated.event.uploadKey).json.ok, true);
});

test("deleteEvent memindahkan folder ke Trash & album hilang dari daftar", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);
  const folder = eventFolder(h, event.slug);

  assert.equal(h.post({ action: "deleteEvent", slug: event.slug }).json.status, 401);
  assert.equal(h.post({ action: "deleteEvent", adminToken: ADMIN, slug: "tidak-ada" }).json.status, 404);

  const removed = unwrap(h.post({ action: "deleteEvent", adminToken: ADMIN, slug: event.slug }));
  assert.equal(removed.ok, true);
  assert.equal(folder.trashed, true);
  assert.equal(h.state.helpers.foldersNamed("event-" + event.slug).filter((f) => !f.trashed).length, 0);
  assert.equal(h.get({ action: "event", slug: event.slug }).json.status, 404);
  assert.equal(unwrap(h.get({ action: "events", token: ADMIN })).events.length, 0);
});

/* ── Album dari versi Express (legacy) ────────────────────────────────── */

test("folder event-* tanpa event.json diadopsi sebagai album legacy", () => {
  const h = loadGas({ properties: props() });
  const root = h.call("driveRoot_");
  const folder = h.state.helpers.addFolder("event-pernikahan-lama", root.getId());

  const guest = unwrap(h.get({ action: "event", slug: "pernikahan-lama" }));
  assert.equal(guest.event.legacy, true);
  assert.equal(guest.event.name, "pernikahan-lama");
  assert.equal(guest.authorized, false);

  const meta = unwrap(h.get({ action: "events", token: ADMIN })).events[0];
  assert.equal(meta.slug, "pernikahan-lama");
  assert.equal(meta.legacy, true);
  assert.ok(meta.uploadKey, "kunci tamu dibuat otomatis agar album tetap bisa dipakai");

  /* event.json sudah ditulis supaya adopsi tidak diulang setiap kali dibaca. */
  const written = h.state.helpers.filesIn(folder.id).filter((f) => f.name === "event.json");
  assert.equal(written.length, 1);
  assert.equal(JSON.parse(written[0].bytes.toString("utf8")).legacy, true);

  /* Foto lama tetap terhitung dan tamu boleh menambah foto baru. */
  h.state.helpers.addFile(folder.id, "photo-lama.jpg", "x", "image/jpeg");
  assert.equal(upload(h, "pernikahan-lama", meta.uploadKey).json.ok, true);
  const daftar = unwrap(h.get({ action: "photos", slug: "pernikahan-lama", k: meta.uploadKey, refresh: "1" }));
  assert.equal(daftar.photos.length, 2, "foto lama + foto baru");
});

/* ── Ketahanan terhadap batas GAS ─────────────────────────────────────── */

test("gangguan Drive/GAS dipetakan ke 503 yang bisa dicoba ulang", () => {
  const h = loadGas({ properties: props() });
  makeAlbum(h);

  h.state.driveFailure = "Service invoked too many times: Service quota exceeded";
  const quota = h.get({ action: "events", token: ADMIN });
  assert.equal(quota.json.ok, false);
  assert.equal(quota.json.status, 503);
  assert.equal(quota.json.code, "gas-quota");

  h.state.driveFailure = "Too many simultaneous invocations";
  const busy = h.get({ action: "events", token: ADMIN });
  assert.equal(busy.json.status, 503);
  assert.equal(busy.json.code, "gas-busy");

  h.state.driveFailure = null;
  assert.equal(h.get({ action: "events", token: ADMIN }).json.ok, true, "pulih setelah gangguan hilang");

  /* Pemetaan langsung untuk pesan-pesan khas GAS. */
  assert.deepEqual(h.call("storageUnavailableStatus_", new Error("nope")), null);
  assert.equal(h.call("storageUnavailableStatus_", new Error("Service quota exceeded"))["code"], "gas-quota");
  assert.equal(h.call("storageUnavailableStatus_", new Error("Script exceeded maximum execution time"))["code"], "gas-busy");
});

test("sniffImageMime_ mengenali JPEG/PNG/WebP dan menolak HEIC", () => {
  const h = loadGas({ properties: props() });
  const jpeg = h.call("bytesFromBase64_", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64"));
  assert.equal(h.call("sniffImageMime_", jpeg), "image/jpeg");
  assert.equal(h.call("sniffImageMime_", h.call("bytesFromBase64_", PNG_1X1)), "image/png");

  const webp = h.call("bytesFromBase64_", Buffer.from("RIFF____WEBPVP8 ").toString("base64"));
  assert.equal(h.call("sniffImageMime_", webp), "image/webp");

  const heic = h.call("bytesFromBase64_", Buffer.from("____ftypheic____").toString("base64"));
  assert.equal(h.call("sniffImageMime_", heic), "image/heic");
  const heicCheck = h.call("validateImage_", heic, ["image/jpeg", "image/png", "image/webp"], "image/jpeg");
  assert.equal(heicCheck.ok, false);
  assert.match(heicCheck.error, /HEIC/);
});

/* ── Utilitas Setup.gs ────────────────────────────────────────────────── */

test("selfTest() berjalan end-to-end lalu membersihkan dirinya", () => {
  const h = loadGas({ properties: props() });
  const report = h.call("selfTest");
  assert.match(report, /validasi gambar\s+: ok \(image\/png, 70 byte\)/);
  assert.match(report, /hapus foto\s+: ok/);
  assert.match(report, /hapus album\s+: ok/);
  assert.equal(h.call("listEvents_", true).length, 0, "album uji sudah dibuang");
  const leftovers = [...h.state.helpers.folders.values()].filter(
    (f) => f.name.indexOf("event-uji-satu-album") === 0 && !f.trashed
  );
  assert.equal(leftovers.length, 0, "folder uji tidak tertinggal di root");
});

test("setupDrive(), showHealth(), showEvents(), syncAlbumMetadata() menghasilkan laporan", () => {
  const h = loadGas({ properties: props() });
  const event = makeAlbum(h);
  const folder = eventFolder(h, event.slug);
  for (let i = 0; i < 3; i += 1) h.state.helpers.addFile(folder.id, "photo-manual-" + i + ".jpg", "x", "image/jpeg");

  assert.match(h.call("setupDrive"), /root folder\s+: Satu-Album/);
  assert.match(h.call("showHealth"), /"mode": "drive"/);
  assert.match(h.call("showEvents"), new RegExp(event.uploadKey));

  const sync = h.call("syncAlbumMetadata");
  assert.match(sync, /pesta-ulang-tahun: 3 foto/);
  assert.equal(JSON.parse(h.state.helpers.filesIn(folder.id).find((f) => f.name === "event.json").bytes.toString("utf8")).count, 3);

  assert.equal(h.call("setAdminToken", "token-baru"), 1);
  assert.equal(h.state.properties.ADMIN_TOKEN, "token-baru");
});





