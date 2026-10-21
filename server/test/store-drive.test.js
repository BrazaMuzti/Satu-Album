/* Test Drive-as-truth: metadata & foto harus bisa dipulihkan setelah "restart".
   Memakai klien Drive palsu (server/test/helpers/fake-drive.js) supaya tidak
   memerlukan kredensial Google sungguhan.

   PENTING: helpers/drive-env.js harus di-import paling awal — modul ESM lain
   membaca env saat pertama kali dievaluasi (import statik di-hoist). */
import { ROOT_FOLDER_NAME } from "./helpers/drive-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createFakeDrive } from "./helpers/fake-drive.js";
import { __setDriveClient, __resetDriveState } from "../drive.js";
import * as store from "../store.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256), Buffer.from([0xff, 0xd9])]);

const fake = createFakeDrive();
__setDriveClient(fake.client);

function folder(slug) {
  return [...fake.state.files.values()].find((f) => f.name === "event-" + slug) || null;
}

function childNames(folderId) {
  return [...fake.state.files.values()]
    .filter((f) => (f.parents || []).includes(folderId) && !f.trashed)
    .map((f) => f.name);
}

function metaOf(slug) {
  const dir = folder(slug);
  const file = [...fake.state.files.values()].find((f) => f.name === "event.json" && (f.parents || []).includes(dir.id));
  return file ? JSON.parse(file.content) : null;
}

test("mode penyimpanan memakai backend Drive", () => {
  assert.equal(store.storageMode, "drive");
  assert.equal(store.usesDrive, true);
});

test("createEvent: membuat folder event-<slug> + event.json di Drive", async () => {
  const event = await store.createEvent({ name: "Pernikahan Rina & Budi", type: "pernikahan", preset: "funsaver" });
  assert.equal(event.slug, "pernikahan-rina-budi");
  assert.ok(event.uploadKey && event.uploadKey.length === 32, "uploadKey dibuat untuk link tamu");

  const dir = folder(event.slug);
  assert.ok(dir, "folder acara ada di Drive");
  assert.ok(childNames(dir.id).includes("event.json"), "event.json ikut tersimpan");

  const meta = metaOf(event.slug);
  assert.equal(meta.slug, event.slug);
  assert.equal(meta.name, "Pernikahan Rina & Budi");
  assert.equal(meta.uploadKey, event.uploadKey);
  assert.equal(meta.count, 0);
});

test("slug ganda: acara kedua dengan nama sama mendapat suffix", async () => {
  const first = await store.createEvent({ name: "Reuni Akbar" });
  const second = await store.createEvent({ name: "Reuni Akbar" });
  assert.equal(first.slug, "reuni-akbar");
  assert.equal(second.slug, "reuni-akbar-2");
});

test("addPhoto: menyimpan foto ke folder acara dan membagikannya publik", async () => {
  const event = await store.createEvent({ name: "Reuni SMP 1998" });
  const photo = await store.addPhoto({ slug: event.slug, buffer: JPEG, mime: "image/jpeg" });

  assert.match(photo.url, /^https:\/\/drive\.google\.com\/thumbnail\?id=/);
  assert.equal(photo.source, "drive");
  assert.ok(childNames(folder(event.slug).id).some((n) => n.startsWith("photo-") && n.endsWith(".jpg")));
  assert.ok(fake.state.permissions.length > 0, "file foto dibagikan ke anyone with link");

  const list = await store.getPhotos(event.slug, { force: true });
  assert.equal(list.count, 1);
  assert.equal(list.photos[0].id, photo.id);
});

test("getPhotos ?since= hanya mengembalikan foto baru, count tetap total", async () => {
  const event = await store.createEvent({ name: "Acara Kantor" });
  const first = await store.addPhoto({ slug: event.slug, buffer: JPEG, mime: "image/jpeg" });
  assert.equal((await store.getPhotos(event.slug, { force: true })).count, 1);

  const second = await store.addPhoto({ slug: event.slug, buffer: JPEG, mime: "image/jpeg" });
  const delta = await store.getPhotos(event.slug, { since: first.createdAt, force: true });
  assert.equal(delta.count, 2, "count selalu total album");
  assert.equal(delta.photos.length, 1);
  assert.equal(delta.photos[0].id, second.id);
});

test("G1: setelah restart (proses baru), galeri tetap terbaca dari Drive", async () => {
  const event = await store.createEvent({ name: "Ulang Tahun Sari" });
  await store.addPhoto({ slug: event.slug, buffer: JPEG, mime: "image/jpeg" });
  await store.addPhoto({ slug: event.slug, buffer: JPEG, mime: "image/jpeg" });
  await store.flushAll();
  assert.equal(metaOf(event.slug).count, 2, "jumlah foto tersinkron ke event.json");

  /* Simulasi Render restart: isi Drive sama, tetapi cache & klien proses dibuang. */
  __resetDriveState();
  __setDriveClient(fake.restart());
  store.resetCache();

  const events = await store.getEvents({ force: true, withKeys: true });
  const found = events.events.find((e) => e.slug === event.slug);
  assert.ok(found, "acara kembali muncul dari event.json di Drive");
  assert.equal(found.uploadKey, event.uploadKey, "uploadKey lama tetap berlaku (link tamu tidak mati)");

  const photos = await store.getPhotos(event.slug, { force: true });
  assert.equal(photos.count, 2, "foto tetap ada walau disk server kosong");
  assert.ok(photos.photos.every((p) => p.url.includes("drive.google.com/thumbnail")));
});

test("folder lama tanpa event.json: metadata disintesis dan file meta dibuat", async () => {
  const root = [...fake.state.files.values()].find((f) => f.name === ROOT_FOLDER_NAME);
  fake.state.files.set("legacy-folder", {
    id: "legacy-folder",
    name: "event-pernikahan-lama",
    mimeType: "application/vnd.google-apps.folder",
    parents: [root.id],
    createdTime: "2025-05-05T05:05:05.000Z",
    trashed: false,
  });
  store.resetCache();
  const { events } = await store.getEvents({ force: true, withKeys: true });
  const legacy = events.find((e) => e.slug === "pernikahan-lama");
  assert.ok(legacy, "acara lama tetap tampil");
  assert.equal(legacy.legacy, true);
  assert.ok(legacy.uploadKey, "uploadKey baru dibuat untuk album lama");
  assert.ok(childNames("legacy-folder").includes("event.json"), "event.json ditulis agar tidak diulang setiap sync");
});

test("deletePhoto: menghapus file di Drive dan memperbarui hitungan", async () => {
  const event = await store.createEvent({ name: "Hapus Foto" });
  const a = await store.addPhoto({ slug: event.slug, buffer: JPEG, mime: "image/jpeg" });
  const b = await store.addPhoto({ slug: event.slug, buffer: JPEG, mime: "image/jpeg" });

  const removed = await store.deletePhoto(event.slug, a.id);
  assert.equal(removed.id, a.id);
  assert.equal(fake.state.files.has(a.id), false, "file benar-benar dihapus dari Drive");

  const list = await store.getPhotos(event.slug, { force: true });
  assert.equal(list.count, 1);
  assert.equal(list.photos[0].id, b.id);
  assert.equal(await store.deletePhoto(event.slug, "tidak-ada"), null);
});

test("deleteEvent: folder acara dipindah ke trash", async () => {
  const event = await store.createEvent({ name: "Acara Selesai" });
  assert.equal(await store.deleteEvent(event.slug), true);
  assert.equal(folder(event.slug).trashed, true);
  const { events } = await store.getEvents({ force: true });
  assert.equal(events.find((e) => e.slug === event.slug), undefined);
});

test("health(): melaporkan mode drive dan statistik cache", async () => {
  const health = await store.health();
  assert.equal(health.mode, "drive");
  assert.equal(health.ready, true);
  assert.equal(typeof health.events, "number");
  assert.ok(health.limits.maxPhotosPerEvent > 0);
});
