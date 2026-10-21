/* Sinkronisasi & audit isi Drive (sumber kebenaran metadata).

   Menjalankan:
     npm run sync              → cek semua folder event-* di Drive, tulis event.json
                                 yang belum ada (album versi lama), rapikan hitungan foto,
                                 lalu cetak ringkasan.
     npm run sync -- --json    → keluaran JSON (untuk pipeline/otomasi).
     npm run sync -- --help    → bantuan.

   Script ini AMAN dijalankan kapan saja: tidak menghapus foto, hanya menambah/memperbarui
   file metadata event.json. */
import { driveInfo } from "../drive.js";
import * as store from "../store.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log("Penggunaan: npm run sync [-- --json] [-- --help]");
  process.exit(0);
}

const asJson = args.includes("--json");

function humanBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return value.toFixed(unit === 0 ? 0 : 1) + " " + units[unit];
}

async function main() {
  const info = driveInfo();
  if (!info.ready) {
    console.error("Google Drive belum dikonfigurasi (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /");
    console.error("GOOGLE_REFRESH_TOKEN). Jalankan `npm run token` lebih dulu, lalu isi .env.");
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  const result = await store.rebuild();
  const { events } = await store.getEvents({ force: true, withKeys: true });

  const rows = [];
  for (const detail of result.details) {
    const listed = await store.getPhotos(detail.slug, { force: true });
    const bytes = listed.photos.reduce((sum, photo) => sum + (Number(photo.size) || 0), 0);
    const meta = events.find((event) => event.slug === detail.slug);
    rows.push({
      slug: detail.slug,
      name: meta ? meta.name : detail.slug,
      photos: listed.count,
      bytes,
      legacy: meta ? Boolean(meta.legacy) : false,
      error: detail.error || null,
    });
  }

  /* Simpan hitungan foto (dan event.json yang baru dibuat) ke Drive. */
  await store.flushAll();

  const totalPhotos = rows.reduce((sum, row) => sum + row.photos, 0);
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const failures = rows.filter((row) => row.error);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          mode: result.mode,
          rootFolder: info.rootFolderId || info.rootFolderName,
          events: rows.length,
          photos: totalPhotos,
          bytes: totalBytes,
          rows,
          durationMs: Date.now() - started,
        },
        null,
        2
      )
    );
  } else {
    console.log("mode      : " + result.mode + " (root: " + (info.rootFolderId || info.rootFolderName) + ")");
    console.log("acara     : " + rows.length);
    console.log("foto      : " + totalPhotos + " (" + humanBytes(totalBytes) + ")");
    console.log("");
    if (rows.length === 0) {
      console.log("(belum ada folder event-* di Drive)");
    } else {
      for (const row of rows) {
        const flag = row.error ? "GAGAL: " + row.error : row.legacy ? "album lama (event.json dibuat)" : "ok";
        console.log("- " + row.slug.padEnd(28) + String(row.photos).padStart(4) + " foto  " + humanBytes(row.bytes).padStart(9) + "  " + flag);
      }
    }
    console.log("");
    console.log("selesai dalam " + (Date.now() - started) + " ms" + (failures.length ? " (" + failures.length + " gagal)" : ""));
  }

  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("sync gagal: " + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
