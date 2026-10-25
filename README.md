# Satu-Album

Kamera sekali pakai digital untuk acara. Buat satu album, bagikan link-nya, dan tamu memotret lewat browser (warna film analog di-render di canvas). Semua foto terkumpul di galeri bersama.

**Arsitektur: 100% Google Apps Script.** Tidak ada server Node, tidak ada `npm install`, tidak ada langkah build.

| Lapisan | Teknologi | Lokasi |
| --- | --- | --- |
| API & logika bisnis | Google Apps Script (runtime V8) | `gas/*.gs` |
| Database | Google Sheets — 1 spreadsheet, 8 tab | `Events`, `Photos`, `RSVP`, … |
| Penyimpanan foto | Google Drive — folder per acara | `Satu-Album/event-<slug>/` |
| Cache & rate limit | Apps Script `CacheService` | otomatis (kode di `gas/Lib.gs`) |
| Frontend statis | HTML/CSS/JS tanpa build (GitHub Pages) | `web/` — **belum ada di repo** |
| Test & CI | Node `node:test` + GitHub Actions | `gas/test/`, `.github/workflows/` |

> `web/` (frontend) belum ditulis. Karena itu workflow [deploy-pages.yml](.github/workflows/deploy-pages.yml) hanya menyala saat ada perubahan di `web/**` dan langsung gagal dengan pesan jelas bila `web/index.html` tidak ada.

## Alur singkat

```
Tamu  ──▶ web/camera.html#<slug>?k=<join_key>   ──┐
Tamu  ──▶ web/galeri.html#<slug>?k=<join_key>   ──┤  POST JSON (text/plain)
Tamu  ──▶ web/undangan.html · rsvp.html         ──┤  action=<nama>
Admin ──▶ halaman admin (mis. web/admin.html)   ──┘
                                                  │
                             Google Apps Script Web App (/exec)  ◀── gas/*.gs
                                                  │
                     ┌────────────────────────────┴────────────────────────────┐
                     │                                                        │
        Google Sheets (8 tab)                                  Google Drive (foto)
        Admin · Events · Photos · Templates                    Satu-Album/
        PrintOrders · PrintItems · RSVP · Guestbook               └── event-<slug>/photo-*.jpg
```

1. Admin login dengan PIN (`action=login`) → dapat token sesi HMAC (`sid`), lalu membuat acara (`action=createEvent`).
2. Setiap acara punya `join_key` 32 hex; link kamera/galeri/undangan/RSVP dibentuk dari `BASE_URL` + slug + kunci itu.
3. Tamu mengunggah foto (base64 di body JSON) → berkas masuk folder Drive acara dan dicatat di tab `Photos`; baris foto bisa dibatalkan tamu selama jendela Undo.
4. Galeri mengambil daftar dari tab `Photos` (di-cache singkat) dan menampilkan thumbnail Drive — tanpa menyentuh Drive saat baca.

## Isi repo

```
Satu-Album/
├── gas/                       # backend Apps Script (11 berkas .gs + manifest)
│   ├── Code.gs                # doGet/doPost, dispatcher action, tabel API_ROUTES
│   ├── Config.gs              # semua nilai dari Script Properties + default aman
│   ├── Auth.gs                # PIN admin, token sesi HMAC, logout & ganti PIN
│   ├── Sheets.gs              # satu-satunya lapisan yang menyentuh SpreadsheetApp
│   ├── DriveStore.gs          # folder acara, unggah/hapus/sinkron foto, health
│   ├── Events.gs              # CRUD acara, slug, join key, link publik per halaman
│   ├── Templates.gs           # template undangan (teks, warna, layout, musik)
│   ├── PrintOrders.gs         # daftar cetak: order + item, dedupe 5 menit
│   ├── Interactions.gs        # RSVP (upsert per kontak) & buku tamu
│   ├── Lib.gs                 # envelope respons, cache, rate limit, slug, MIME
│   ├── Setup.gs               # fungsi manual: initSheets, selfTest, trigger, dsb.
│   ├── appsscript.json        # manifest: zona waktu, scope OAuth, mode web app
│   └── test/                  # test lokal + CI (tanpa kredensial Google)
│       ├── harness.mjs        # tiruan SpreadsheetApp/DriveApp/CacheService/Properties
│       ├── api.test.mjs       # 36 test end-to-end router Code.gs
│       ├── syntax.mjs         # kompilasi semua .gs lewat vm.Script
│       └── refs.mjs           # deteksi helper yang dipanggil tapi tidak terdefinisi
├── .github/workflows/
│   ├── ci.yml                 # syntax + refs + node:test (Node 22, tanpa npm)
│   └── deploy-pages.yml       # deploy folder web/ ke GitHub Pages
└── docs/                      # dokumen produk/teknis (lihat bagian Dokumentasi)
```

`web/` akan berisi halaman statis: `index.html`, `admin.html`, `camera.html`, `galeri.html`, `undangan.html`, `rsvp.html`, plus `assets/` (lihat [gas/Events.gs](gas/Events.gs) `eventLinks_` dan langkah 2 di [gas/Setup.gs](gas/Setup.gs) `initSheets`).

## Mulai cepat

1. **Spreadsheet database** — buat Google Sheets baru, salin ID dari URL (`.../spreadsheets/d/<SHEET_ID>/edit`).
2. **Project Apps Script** — buka [script.google.com](https://script.google.com) → *New project* → salin seluruh isi `gas/Code.gs`, `Config.gs`, `Auth.gs`, `Sheets.gs`, `DriveStore.gs`, `Events.gs`, `Templates.gs`, `PrintOrders.gs`, `Interactions.gs`, `Lib.gs`, `Setup.gs`, lalu timpa `appsscript.json` (Project Settings → *Show "appsscript.json"*).
3. **Script Properties** — Project Settings → *Script properties*: `SHEET_ID`, `ADMIN_PIN`, `SESSION_SECRET`.
4. **Jalankan `initSheets`** dari editor — membuat 8 tab + header, baris Admin pertama, dan root folder Drive.
5. **Deploy** — *Deploy → New deployment → Web app* (Execute as: **Me**, Who has access: **Anyone**) → salin URL `/exec` ke konstanta `API_BASE` di `web/assets/app.js`.

Langkah rinci (termasuk GitHub Pages, troubleshooting, dan checklist 10 menit) ada di **[docs/CARA-MENJALANKAN.md](docs/CARA-MENJALANKAN.md)**.

## Fungsi manual di editor Apps Script (`gas/Setup.gs`)

Semua fungsi ini dijalankan manual dari editor (*pilih fungsi → Run*), tidak pernah dipanggil dari web app.

| Fungsi | Kegunaan |
| --- | --- |
| `initSheets()` | Sekali saja: buat 8 tab + header, seed baris Admin dari `ADMIN_PIN`, buat root folder Drive. Idempoten. |
| `setBaseUrl()` | Set `BASE_URL` (dipakai membuat link QR/undangan) dari konstanta `SETUP_DEFAULT_BASE_URL`. |
| `showHealth()` | Ringkasan: mode `sheets+drive`, versi config, jumlah baris per tab, batas unggah, error yang muncul. |
| `showEvents()` | Daftar acara + link kamera/galeri/undangan/RSVP-nya. |
| `syncAllDrivePhotos()` | Pindai semua folder `event-*` dan catat berkas yang belum ada di tab `Photos` (mis. unggahan manual lewat aplikasi Drive). |
| `installDriveSyncTrigger()` | Pasang trigger time-based setiap 6 jam untuk `syncAllDrivePhotos`. |
| `selfTest()` | Uji cepat config, spreadsheet, skema, root folder, daftar acara, dan cache round-trip. |

## API (RPC)

Apps Script hanya punya `doGet`/`doPost` dan tidak bisa mengatur status code/header, jadi seluruh API berbentuk RPC dengan envelope JSON:

```
GET  <URL>/exec?action=<nama>&<param>=...
POST <URL>/exec     body JSON (content-type: text/plain) — action boleh di body atau query
```

| Envelope | Isi |
| --- | --- |
| Sukses | `{ "ok": true, "data": {...}, "serverTime": "2026-01-01T00:00:00.000Z" }` |
| Gagal | `{ "ok": false, "status": 401, "code": "invalid-key", "error": "...", "serverTime": "..." }` |

Selalu HTTP 200 dari Apps Script; `status` di dalam body adalah status HTTP yang "seharusnya". Body dikirim sebagai `text/plain` supaya tidak memicu preflight `OPTIONS` (Apps Script tidak punya `doOptions`), dan Apps Script sendiri mengirim `Access-Control-Allow-Origin: *`. `GET ...&callback=fn` menghasilkan JSONP.

**Otorisasi:** admin memakai token sesi `sid` (HMAC-SHA256, 8 jam) yang dikirim di body/query; tamu memakai `slug` + kunci `k` (32 hex) dari link. Action admin (`events`, `createEvent`, `updateEvent`, `deleteEvent`, `syncPhotos`, `saveTemplate`, `listPrintOrders`, `updatePrintOrderStatus`, `listRsvp`, `deleteGuestbook`, `me`, `logout`) menolak permintaan tanpa sesi valid.

| Action | Akses | Fungsi |
| --- | --- | --- |
| `ping` | publik | Handshake: `{ pong, version, actions[] }` |
| `health` | publik | Mode `sheets+drive`, versi, jumlah baris tiap tab, batas unggah/foto/undo |
| `login` | publik | `{ pin }` → `{ sid, admin, expiresAt, ttlSec }` |
| `logout` | admin | Cabut sesi (tombstone di cache) |
| `me` | admin | Data admin dari sesi |
| `events` | admin | Daftar acara + jumlah foto + `joinKey` + `links` |
| `createEvent` | admin | `{ nama, jenis, tanggal, lokasi, preset, revealAt }` → acara + `join_key` + `links` + template default |
| `event` | publik / kunci tamu | Detail acara; `authorized` menandakan kunci tamu cocok. `joinKey` & `links` hanya bila berwenang |
| `updateEvent` | admin | Ubah `nama`/`jenis`/`tanggal`/`lokasi`/`preset`/`revealAt`/`aktif`, atau `{ rotateUploadKey: true }` untuk mencabut link lama |
| `deleteEvent` | admin | Hapus acara + folder Drive-nya (ke Trash) |
| `uploadPhoto` | kunci tamu | `{ data: "<base64>", mime }` → foto ke Drive + baris `Photos`; balas `undoWindowMs` |
| `photos` | kunci tamu | Daftar foto; `?since=<iso>` hanya yang baru, `?refresh=1` abaikan cache |
| `deletePhoto` | kunci tamu (≤ jendela Undo) / admin | Hapus foto (Undo) |
| `syncPhotos` | admin | `{ slug?, force? }` → tarik berkas Drive yang belum tercatat |
| `template` | kunci tamu | Template undangan sebuah acara |
| `saveTemplate` | admin | Simpan teks/warna/layout/musik undangan |
| `createPrintOrder` | kunci tamu | `{ photoIds[], namaPemesan, kontak, alamat, catatan }` → daftar cetak |
| `listPrintOrders` | admin | Daftar order + item + hitungan status |
| `updatePrintOrderStatus` | admin | Ubah status order (`baru`/`diproses`/`selesai`/`dibatalkan`) |
| `rsvp` | kunci tamu | Kirim/perbarui RSVP (upsert per kontak) + ringkasan kehadiran |
| `listRsvp` | admin | Daftar RSVP + ringkasan |
| `guestbook` | kunci tamu | Tanpa `pesan` = daftar ucapan; dengan `pesan` = tambah ucapan |
| `deleteGuestbook` | admin | Hapus ucapan berdasarkan `entryId` |

Contoh:

```bash
API="https://script.google.com/macros/s/<DEPLOY_ID>/exec"

# Handshake & kesehatan
curl -sL "$API?action=ping"
curl -sL "$API?action=health"

# Login admin → ambil token sesi
SID=$(curl -sL -X POST "$API" -H 'content-type: text/plain' \
  -d '{"action":"login","pin":"123456"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["sid"])')

# Buat acara
curl -sL -X POST "$API" -H 'content-type: text/plain' \
  -d "{\"action\":\"createEvent\",\"sid\":\"$SID\",\"nama\":\"Pernikahan Rina & Budi\",\"jenis\":\"pernikahan\",\"preset\":\"funsaver\"}"

# Unggah foto (base64) memakai kunci tamu
curl -sL -X POST "$API" -H 'content-type: text/plain' \
  -d "{\"action\":\"uploadPhoto\",\"slug\":\"pernikahan-rina-budi\",\"k\":\"<join_key>\",\"mime\":\"image/jpeg\",\"data\":\"$(base64 -w0 foto.jpg)\"}"

# Daftar foto
curl -sL "$API?action=photos&slug=pernikahan-rina-budi&k=<join_key>"
```

Kode error yang dipakai di body: `bad-action`, `bad-json`, `bad-request`, `bad-table`, `no-session`, `bad-session`, `session-expired`, `session-revoked`, `admin-inactive`, `invalid-pin`, `weak-pin`, `invalid-key`, `rate-limited` (429), `event-not-found`, `event-inactive` (410), `not-found` (404), `undo-expired`, `not-in-event`, `photo-not-found`, `photo-limit` / `too-many-photos` (409), `too-large` (413), `unsupported` (415), `bad-photo-ids`, `order-not-found`, `missing-order-id`, `missing-event-id`, `bad-status`, `bad-music-url`, `text-too-long`, `drive-error` (502), `sheet-not-configured` / `sheet-open-failed` / `auth-not-configured` / `admin-not-configured` / `storage-unavailable` / `gas-busy` / `gas-quota` (503).

## Model data (1 Spreadsheet, 8 tab)

Header dibuat otomatis oleh `gas/Sheets.gs` (`ensureSchema_`); nama kolom tidak boleh diubah karena dipetakan langsung ke kunci JSON.

| Tab | Kolom |
| --- | --- |
| `Admin` | `admin_id`, `pin_hash` (SHA-256 + salt), `nama`, `role`, `aktif`, `dibuat_pada` |
| `Events` | `event_id`, `slug`, `nama`, `jenis`, `tanggal`, `lokasi`, `join_key`, `drive_folder_id`, `preset`, `reveal_at`, `aktif`, `dibuat_pada` |
| `Photos` | `photo_id` (= ID berkas Drive), `event_id`, `nama_file`, `url`, `thumb`, `ukuran`, `mime`, `sumber`, `diunggah_pada` |
| `Templates` | `template_id`, `event_id`, `nama_template`, `tema_warna`, `teks_hero`, `teks_couple`, `teks_acara`, `teks_penutup`, `musik_url`, `tata_letak`, `diperbarui_pada` |
| `PrintOrders` | `order_id`, `event_id`, `nama_pemesan`, `kontak`, `alamat`, `catatan`, `status`, `total_foto`, `dibuat_pada` |
| `PrintItems` | `item_id`, `order_id`, `photo_id`, `url`, `jumlah`, `ukuran_cetak` |
| `RSVP` | `rsvp_id`, `event_id`, `nama`, `kontak`, `hadir`, `jumlah_tamu`, `pesan`, `dibuat_pada`, `ip_hash` |
| `Guestbook` | `entry_id`, `event_id`, `nama`, `pesan`, `dibuat_pada` |

Struktur Drive: `Satu-Album/` (root; ID disimpan di property `DRIVE_ROOT_FOLDER_ID`) → `event-<slug>/` per acara. Berkas foto diberi nama `photo-<timestamp>-<acak>.<ext>`. Folder acara **tidak** dibagikan publik; hanya berkas fotonya (anyone with link) agar thumbnail Drive tampil di galeri.

## Batas & default (Script Properties)

Semua diatur di *Project Settings → Script properties*; default ada di `CONFIG_DEFAULTS` (`gas/Config.gs`).

| Property | Default | Arti |
| --- | --- | --- |
| `SHEET_ID` | — (wajib) | ID Spreadsheet database |
| `ADMIN_PIN` | — (wajib; seed `123456` bila kosong) | PIN awal admin, di-seed `initSheets`, lalu diganti dari panel admin |
| `SESSION_SECRET` | — (wajib) | Kunci HMAC token sesi; harus panjang & acak |
| `BASE_URL` | kosong | URL frontend (GitHub Pages) untuk membentuk link QR/undangan; kosong = link dibentuk relatif (mis. `/camera.html#slug?k=…`) |
| `DRIVE_ROOT_FOLDER_NAME` | `Satu-Album` | Nama root folder Drive |
| `DRIVE_ROOT_FOLDER_ID` | — (diisi otomatis) | Cache ID root folder |
| `SESSION_TTL_SEC` | `28800` (8 jam) | Umur token sesi admin |
| `LOGIN_MAX_ATTEMPTS` | `8` | Batas percobaan login per jam |
| `MAX_PHOTOS_PER_EVENT` | `800` | Batas foto per acara (`photo-limit`) |
| `MAX_UPLOAD_MB` | `8` | Batas ukuran satu berkas (`too-large`) |
| `UNDO_WINDOW_MS` | `120000` (2 menit) | Jendela Undo hapus foto oleh tamu |
| `CACHE_TTL_MS` | `10000` (10 detik) | Umur cache daftar foto/acara (maks. 6 jam) |
| `IMAGE_WIDTH` / `THUMB_WIDTH` | `1600` / `400` | Lebar gambar & thumbnail pada URL Drive |
| `RATE_UPLOAD_PER_HOUR` | `300` | Batas unggahan per jam per acara |
| `RATE_CREATE_PER_HOUR` | `10` | Batas pembuatan acara per jam |
| `ALLOWED_MIME` | `image/jpeg,image/png,image/webp` | Tipe gambar yang diterima |

Batas lain di dalam kode: dedupe order cetak 5 menit & 15 order/jam, maks. 50 foto per order, teks template maks. 2000 karakter, layout `klasik`/`elegan`/`floral`/`minimalis`/`modern`.

## Test & CI

```bash
# 1. Semua .gs bisa dikompilasi (lewat node:vm)
node gas/test/syntax.mjs

# 2. Tidak ada helper yang dipanggil tapi belum didefinisikan
node gas/test/refs.mjs

# 3. 36 test fungsional router (SpreadsheetApp/DriveApp/CacheService tiruan)
node --test "gas/test/*.test.mjs"
```

Tidak butuh kredensial Google, tidak butuh `npm install`, tidak butuh `node_modules`. `gas/test/harness.mjs` menyediakan tiruan `SpreadsheetApp`, `DriveApp`, `CacheService`, `PropertiesService`, `Utilities`, `ScriptApp`, dan `UrlFetchApp`; berkas `gas/*.gs` dimuat dengan `vm` lalu `doGet`/`doPost` dipanggil seperti request sungguhan. Yang diuji: login/HMAC/sesi kedaluwarsa, CRUD acara, unggah foto (MIME, batas ukuran, batas album), cache & `since`, Undo, RSVP, buku tamu, template, order cetak, rate limit, dan JSONP.

CI (`.github/workflows/ci.yml`) menjalankan ketiga perintah tersebut di Node 22 untuk setiap push/PR ke `master`.

> **Catatan Node:** `node --test gas/test` (argumen folder) hanya jalan di Node ≥ 24; di Node 22 gagal `MODULE_NOT_FOUND`. Karena itu CI dan dokumentasi memakai glob `"gas/test/*.test.mjs"` yang jalan di kedua versi.

## Dokumentasi

| Berkas | Isi |
| --- | --- |
| `docs/CARA-MENJALANKAN.md` | Panduan praktis: setup Apps Script, deploy Web App, GitHub Pages, troubleshooting |
| `docs/PRD.md` | Kebutuhan produk & lingkup fitur |
| `docs/ARCHITECTURE.md` | Arsitektur, alur data, keputusan desain |
| `docs/API.md` | Kontrak API (request/response, kode error) |
| `docs/PERMISSIONS.md` | Peran & matriks izin |
| `docs/BLOCKS.md`, `docs/THEMES.md` | Blok undangan & tema warna/tata letak |
| `docs/DB-SCHEMA.sql`, `docs/ROADMAP.md` | Skema relasional & rencana jangka panjang |

> Sebagian `docs/PRD.md`, `ARCHITECTURE.md`, `API.md`, dan `DB-SCHEMA.sql` masih menggambarkan **rencana lama** (Express + SQLite + React/Vite di `server/`, `client/`, `undangan/`) yang tidak dipakai. **Sumber kebenaran implementasi saat ini adalah `gas/`**; berkas-berkas itu disimpan sebagai spesifikasi produk jangka panjang.

## Catatan & batasan

- **Kamera butuh HTTPS** — `getUserMedia` tidak jalan di `file://` atau HTTP biasa; GitHub Pages sudah HTTPS.
- **Foto dikirim base64** di body JSON (`text/plain`), jadi ±33% lebih besar dari berkas aslinya. Server **tidak** mengompresi; pengecilan dilakukan klien sebelum kirim, sedangkan `IMAGE_WIDTH`/`THUMB_WIDTH` hanya mengatur ukuran yang diminta dari Drive.
- **HEIC/HEIF ditolak** (`415 unsupported`) — iPhone perlu mengirim JPEG.
- **Semua respons HTTP 200**; klien harus membaca `ok`/`status` di body.
- **Rate limit & cache non-atomik** (berbasis `CacheService`/`PropertiesService`) — cukup untuk satu acara, bukan pengganti infrastruktur server sungguhan.
- **Kuota Google**: satu eksekusi Apps Script dibatasi ±6 menit, sehingga `syncPhotos` memproses bertahap dan mengembalikan `hasMore`; `syncAllDrivePhotos` mengulang maksimal 10 putaran per acara.
- **Setiap perubahan kode harus di-deploy ulang** (Deploy → Manage deployments → Edit → Version: **New version**) agar `/exec` memakai kode terbaru.
- **Auto-sync Drive opsional**: tanpa `installDriveSyncTrigger()`, unggahan lewat aplikasi Drive baru terlihat setelah `syncAllDrivePhotos()` dijalankan atau `action=syncPhotos`.
- **Frontend `web/` belum ada**, sehingga `deploy-pages.yml` gagal dengan pesan jelas sampai `web/index.html` dibuat.

