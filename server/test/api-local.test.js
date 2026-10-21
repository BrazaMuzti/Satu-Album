/* Test API end-to-end memakai backend LOKAL (tanpa Google Drive) + HTTP sungguhan.
   Fokus pada kontrak: otorisasi token/kunci, kontrak upload biner, serta batas ukuran. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "satu-album-test-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
process.env.ADMIN_TOKEN = "admin-token-test";
process.env.PORT = "0";
process.env.MAX_UPLOAD_MB = "1";
process.env.SA_UNDO_WINDOW_MS = "150";
process.env.SA_META_FLUSH_MS = "10";
process.env.RATE_CREATE_PER_HOUR = "50";
process.env.RATE_UPLOAD_PER_HOUR = "50";
process.env.PUBLIC_BASE_URL = "";
/* Pastikan mode lokal: tanpa kredensial Google. */
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.GOOGLE_REFRESH_TOKEN;
delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;

import test, { after } from "node:test";
import assert from "node:assert/strict";

const { server } = await import("../index.js");
if (!server.listening) await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port;

const ADMIN = { "x-admin-token": "admin-token-test" };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512), Buffer.from([0xff, 0xd9])]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createEvent(name) {
  const res = await fetch(base + "/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", ...ADMIN },
    body: JSON.stringify({ name, type: "pernikahan", preset: "funsaver", revealAt: null }),
  });
  assert.equal(res.status, 201);
  return (await res.json()).event;
}

function upload(slug, key, body = JPEG, type = "image/jpeg") {
  return fetch(base + "/api/events/" + slug + "/photos", {
    method: "POST",
    headers: { "content-type": type, "x-upload-key": key || "" },
    body,
  });
}

after(async () => {
  const store = await import("../store.js");
  await store.flushAll(); /* hentikan timer metadata sebelum folder temp dihapus */
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("health: melaporkan mode penyimpanan lokal dengan jujur", async () => {
  const res = await fetch(base + "/api/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.storage.mode, "local");
  assert.equal(body.limits.maxUploadBytes, 1024 * 1024);
  assert.equal(body.limits.undoWindowMs, 150);
});

test("POST /api/events tanpa token admin → 401", async () => {
  const res = await fetch(base + "/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Tanpa Token" }),
  });
  assert.equal(res.status, 401);

  const bad = await fetch(base + "/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": "token-palsu" },
    body: JSON.stringify({ name: "Token Palsu" }),
  });
  assert.equal(bad.status, 401);
});

test("POST /api/events dengan token → 201 + uploadKey", async () => {
  const event = await createEvent("Pernikahan Uji Coba");
  assert.equal(event.slug, "pernikahan-uji-coba");
  assert.equal(event.name, "Pernikahan Uji Coba");
  assert.equal(event.count, 0);
  assert.ok(event.uploadKey && event.uploadKey.length === 32);
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, "events.json")), "metadata tersimpan di DATA_DIR");
});

test("GET /api/events/:slug: publik tanpa uploadKey, berisi uploadKey bila kunci benar", async () => {
  const event = await createEvent("Reuni Keluarga");
  const plain = await (await fetch(base + "/api/events/" + event.slug)).json();
  assert.equal(plain.event.name, "Reuni Keluarga");
  assert.equal(plain.event.uploadKey, undefined, "uploadKey tidak bocor ke pemanggil tanpa kunci");
  assert.equal(plain.authorized, false);

  const withKey = await (await fetch(base + "/api/events/" + event.slug + "?k=" + event.uploadKey)).json();
  assert.equal(withKey.authorized, true);
  assert.equal(withKey.event.uploadKey, event.uploadKey);

  assert.equal((await fetch(base + "/api/events/tidak-ada-acara")).status, 404);
});

test("POST foto: butuh kunci tamu, menerima biner image/jpeg", async () => {
  const event = await createEvent("Album Kamera");

  const noKey = await upload(event.slug, null);
  assert.equal(noKey.status, 401);
  assert.equal((await noKey.json()).code, "invalid-key");

  assert.equal((await upload(event.slug, "kunci-salah")).status, 401);

  const ok = await upload(event.slug, event.uploadKey);
  assert.equal(ok.status, 201);
  const body = await ok.json();
  assert.equal(body.photo.source, "local");
  assert.match(body.photo.url, /^\/uploads\/photo-\d+-\d+\.jpg$/);
  assert.equal(body.undoWindowMs, 150);
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, 1, "file foto tersimpan di UPLOAD_DIR");

  const list = await (await fetch(base + "/api/events/" + event.slug + "/photos?k=" + event.uploadKey)).json();
  assert.equal(list.count, 1);
  assert.equal(list.photos.length, 1);
});

test("POST foto: menolak body bukan gambar (415) dan terlalu besar (413)", async () => {
  const event = await createEvent("Album Batas");

  const notImage = await upload(event.slug, event.uploadKey, Buffer.from("halo saya teks"), "image/jpeg");
  assert.equal(notImage.status, 415);
  assert.match((await notImage.json()).error, /bukan gambar/);

  const multipart = await fetch(base + "/api/events/" + event.slug + "/photos", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=xyz", "x-upload-key": event.uploadKey },
    body: Buffer.from("--xyz--"),
  });
  assert.equal(multipart.status, 415, "kontrak lama (multipart) ditolak dengan pesan jelas");

  const tooBig = await upload(event.slug, event.uploadKey, Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]));
  assert.equal(tooBig.status, 413);
  assert.match((await tooBig.json()).error, /terlalu besar/);
});

test("GET /api/events/:slug/photos tanpa kunci → 401", async () => {
  const event = await createEvent("Album Privat");
  assert.equal((await fetch(base + "/api/events/" + event.slug + "/photos")).status, 401);
});

test("DELETE foto: tamu boleh selama jendela Undo, ditolak setelahnya", async () => {
  const event = await createEvent("Album Undo");
  const created = await (await upload(event.slug, event.uploadKey)).json();

  const undo = await fetch(base + "/api/events/" + event.slug + "/photos/" + created.photo.id + "?k=" + event.uploadKey, {
    method: "DELETE",
  });
  assert.equal(undo.status, 200);
  const afterUndo = await (await fetch(base + "/api/events/" + event.slug + "/photos?k=" + event.uploadKey)).json();
  assert.equal(afterUndo.count, 0);

  const older = await (await upload(event.slug, event.uploadKey)).json();
  await sleep(300); /* lewati jendela Undo 150 ms */
  const expired = await fetch(base + "/api/events/" + event.slug + "/photos/" + older.photo.id + "?k=" + event.uploadKey, {
    method: "DELETE",
  });
  assert.equal(expired.status, 403);
  assert.equal((await expired.json()).code, "undo-expired");

  /* Admin tetap boleh menghapus kapan saja (mis. menyingkirkan foto tidak sopan). */
  const asAdmin = await fetch(base + "/api/events/" + event.slug + "/photos/" + older.photo.id, {
    method: "DELETE",
    headers: ADMIN,
  });
  assert.equal(asAdmin.status, 200);
});

test("GET /api/events (admin) melaporkan jumlah foto & kunci", async () => {
  const event = await createEvent("Album Hitungan");
  await upload(event.slug, event.uploadKey);
  await upload(event.slug, event.uploadKey);

  const res = await fetch(base + "/api/events?refresh=1", { headers: ADMIN });
  assert.equal(res.status, 200);
  const { events } = await res.json();
  const found = events.find((e) => e.slug === event.slug);
  assert.equal(found.count, 2);
  assert.equal(found.uploadKey.length, 32);
});

test("rate limit upload: kelebihan permintaan → 429 + Retry-After", async () => {
  const event = await createEvent("Album Rate");
  let blocked = null;
  for (let i = 0; i < 60; i += 1) {
    const res = await upload(event.slug, event.uploadKey);
    if (res.status === 429) {
      blocked = res;
      break;
    }
    assert.equal(res.status, 201, "upload ke-" + (i + 1));
  }
  assert.ok(blocked, "upload ke-51 dan seterusnya harus ditolak (kuota 50/jam)");
  assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
});

test("endpoint tidak dikenal → 404 JSON", async () => {
  const res = await fetch(base + "/api/tidak-ada");
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("content-type").includes("application/json"), true);
});

test("PATCH & DELETE acara: hanya admin", async () => {
  const event = await createEvent("Album Ubah");
  assert.equal((await fetch(base + "/api/events/" + event.slug, { method: "DELETE" })).status, 401);

  const patched = await fetch(base + "/api/events/" + event.slug, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...ADMIN },
    body: JSON.stringify({ name: "Album Diubah", preset: "kodak" }),
  });
  assert.equal(patched.status, 200);
  const updated = (await patched.json()).event;
  assert.equal(updated.name, "Album Diubah");
  assert.equal(updated.preset, "kodak");

  const rotated = await fetch(base + "/api/events/" + event.slug, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...ADMIN },
    body: JSON.stringify({ rotateUploadKey: true }),
  });
  assert.notEqual((await rotated.json()).event.uploadKey, event.uploadKey, "kunci lama bisa dicabut");

  const deleted = await fetch(base + "/api/events/" + event.slug, { method: "DELETE", headers: ADMIN });
  assert.equal(deleted.status, 200);
  assert.equal((await fetch(base + "/api/events/" + event.slug)).status, 404);
});
