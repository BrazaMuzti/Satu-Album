/* Test unit murni (tanpa server/Drive/env): slug, validasi gambar, rate limit, error. */
import test from "node:test";
import assert from "node:assert/strict";
import { slugify, uniqueSlug, makeUploadKey } from "../src/lib/slug.js";
import { sniffImageMime, validateImage } from "../src/lib/image.js";
import { createRateLimiter } from "../src/lib/ratelimit.js";
import { StoreError, StorageUnavailableError, isStorageUnavailable } from "../src/lib/errors.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]);
const TEXT = Buffer.from("ini bukan gambar sama sekali");
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

test("slugify: huruf besar, spasi, aksen, dan karakter aneh", () => {
  assert.equal(slugify("Pernikahan Rina & Budi"), "pernikahan-rina-budi");
  assert.equal(slugify("  Ulang Tahun  Rani!!  "), "ulang-tahun-rani");
  assert.equal(slugify("Café Résumé"), "cafe-resume");
  assert.match(slugify("✨✨"), /^[A-Za-z0-9_-]{8}$/); /* fallback acak bila tidak ada huruf latin */
});

test("uniqueSlug: menambah suffix angka bila slug terpakai", () => {
  const taken = new Set(["reuni-1998"]);
  assert.equal(uniqueSlug("reuni-1998", taken), "reuni-1998-2");
  taken.add("reuni-1998-2");
  assert.equal(uniqueSlug("reuni-1998", taken), "reuni-1998-3");
  assert.equal(uniqueSlug("acara-baru", taken), "acara-baru");
});

test("makeUploadKey: panjang 32 dan tidak berulang", () => {
  const a = makeUploadKey();
  assert.equal(a.length, 32);
  assert.notEqual(a, makeUploadKey());
});

test("sniffImageMime: mengenali JPEG, PNG, WebP dari magic bytes", () => {
  assert.equal(sniffImageMime(JPEG), "image/jpeg");
  assert.equal(sniffImageMime(PNG), "image/png");
  assert.equal(sniffImageMime(WEBP), "image/webp");
  assert.equal(sniffImageMime(TEXT), null);
  assert.equal(sniffImageMime(Buffer.alloc(2)), null);
});

test("sniffImageMime: HEIC dikenali (supaya bisa ditolak dengan pesan jelas)", () => {
  const heic = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(8)]);
  assert.equal(sniffImageMime(heic), "image/heic");
});

test("validateImage: menerima gambar valid walau MIME dari klien salah", () => {
  const result = validateImage(JPEG, ALLOWED, "application/octet-stream");
  assert.equal(result.ok, true);
  assert.equal(result.mime, "image/jpeg");
});

test("validateImage: menolak body kosong, teks, dan HEIC", () => {
  assert.deepEqual(
    { status: validateImage(null, ALLOWED).status, error: validateImage(null, ALLOWED).error },
    { status: 400, error: "photo is required" }
  );
  const text = validateImage(TEXT, ALLOWED, "image/jpeg");
  assert.equal(text.ok, false);
  assert.equal(text.status, 415);
  const heic = validateImage(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(8)]), ALLOWED, "image/heic");
  assert.equal(heic.status, 415);
  assert.match(heic.error, /HEIC/);
});

test("rate limiter: blokir setelah batas, dan menyediakan Retry-After", () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 2, label: "test" });
  assert.equal(limiter.check("ip-1").ok, true);
  assert.equal(limiter.check("ip-1").ok, true); /* kuota 2: panggilan kedua masih boleh */
  const third = limiter.check("ip-1");
  assert.equal(third.ok, false);
  assert.ok(third.retryAfterSec >= 1);
  assert.equal(limiter.check("ip-2").ok, true, "IP lain tidak terpengaruh");
});

test("error: StorageUnavailableError dikenali sebagai gangguan sementara", () => {
  assert.equal(isStorageUnavailable(new StorageUnavailableError("drive down")), true);
  assert.equal(isStorageUnavailable(new StoreError("user salah", 400, "bad")), false);
  assert.equal(isStorageUnavailable(new StoreError("kuota", 403, "quota")), true);
  assert.equal(isStorageUnavailable({ message: "socket hang up" }), true);
});
