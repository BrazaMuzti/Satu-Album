# Cara Menjalankan Satu-Album

Panduan praktis memasang **Satu-Album** dari nol sampai bisa dipakai tamu: Apps Script sebagai API + Google Sheets sebagai database + Google Drive sebagai penyimpanan foto + GitHub Pages sebagai frontend.

Waktu pengerjaan ±20 menit dan tanpa biaya: hanya butuh akun Google dan browser. Tidak ada `npm install`, tidak ada server Node, tidak ada langkah build.

> Status saat ini: **backend (`gas/`) lengkap dan teruji**; frontend statis di folder `web/` **belum ada**. Anda tetap bisa menguji seluruh alur lewat `curl` (lihat langkah 7) sebelum halaman web ditulis.

## 0. Ringkasan cepat

| # | Langkah | Di mana |
| --- | --- | --- |
| 1 | Buat Spreadsheet, salin ID-nya | [sheets.new](https://sheets.new) |
| 2 | Buat project Apps Script, tempel 11 berkas `gas/*.gs` + `gas/appsscript.json` | [script.google.com](https://script.google.com) |
| 3 | Isi Script Properties: `SHEET_ID`, `ADMIN_PIN`, `SESSION_SECRET` | Project Settings → Script properties |
| 4 | Jalankan `initSheets` | Editor Apps Script (pilih fungsi → Run) |
| 5 | Deploy **Web app** (Execute as: *Me*, Access: *Anyone*) → salin URL `/exec` | Deploy → New deployment |
| 6 | Uji `?action=ping` dan `?action=health` | Browser / `curl` |
| 7 | (Opsional) Salin URL `/exec` ke `API_BASE` di `web/assets/app.js`, unggah `web/` ke GitHub Pages | Repo → Settings → Pages |

Perintah inti yang sering dipakai sesudahnya:

| Perintah | Fungsi |
| --- | --- |
| `initSheets()` | Sekali saja: membuat 8 tab, admin pertama, root folder Drive |
| `selfTest()` | Memastikan config, spreadsheet, skema, folder, dan cache sehat |
| `showHealth()` | Ringkasan jumlah baris tiap tab + batas unggah |
| `showEvents()` | Daftar acara + link kamera/galeri/undangan/RSVP |
| `syncAllDrivePhotos()` | Menarik berkas Drive yang belum tercatat di tab `Photos` |
| `installDriveSyncTrigger()` | Sinkronisasi Drive otomatis tiap 6 jam |
| `setBaseUrl()` | Mengisi `BASE_URL` dari konstanta `SETUP_DEFAULT_BASE_URL` |

## 1. Prasyarat

- **Akun Google** yang punya Google Drive & Google Sheets (akun gratis sudah cukup).
- **Browser modern** (Chrome/Edge/Safari/Firefox terbaru). Kamera membutuhkan **HTTPS**, jadi frontend tidak bisa diuji lewat `file://`.
- **Akun GitHub** — hanya bila Anda ingin memakai GitHub Pages untuk frontend.
- **Opsional, untuk menjalankan test lokal:** Node.js ≥ 20 (`node --version`); CI repo memakai **Node 22**. Test tidak butuh kredensial Google, jadi bisa dijalankan siapa pun tanpa akses ke spreadsheet Anda.

## 2. Peta repo

```
Satu-Album/
├── gas/                      # backend Apps Script — sumber kebenaran implementasi
│   ├── Code.gs               # doGet/doPost + router action (API_ROUTES)
│   ├── Config.gs             # semua setting dari Script Properties
│   ├── Auth.gs               # PIN admin, token sesi HMAC, logout
│   ├── Sheets.gs             # lapisan Google Sheets (SHEET_HEADERS)
│   ├── DriveStore.gs         # folder & berkas foto, health, sinkronisasi
│   ├── Events.gs             # CRUD acara, slug, join_key, link publik
│   ├── Templates.gs          # template undangan
│   ├── PrintOrders.gs        # daftar cetak
│   ├── Interactions.gs       # RSVP & buku tamu
│   ├── Lib.gs                # envelope respons, cache, rate limit, MIME
│   ├── Setup.gs              # fungsi manual (initSheets, selfTest, trigger)
│   ├── appsscript.json       # manifest: timezone, scope, mode web app
│   └── test/                 # syntax.mjs, refs.mjs, api.test.mjs, harness.mjs
├── .github/workflows/
│   ├── ci.yml                # test otomatis (Node 22, tanpa npm)
│   └── deploy-pages.yml      # deploy folder web/ ke GitHub Pages
├── docs/                     # dokumentasi produk & teknis
└── README.md
```

## 3. Siapkan database (Google Sheets)

1. Buka [sheets.new](https://sheets.new) → beri nama, mis. `Satu-Album DB`.
2. Salin **ID** dari URL: `https://docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`.
3. Tidak perlu mengubah apa pun secara manual: 8 tab + header dibuat oleh `initSheets`. Jangan mengganti nama tab/kolom, karena `gas/Sheets.gs` memetakan header langsung ke kunci JSON.
4. Tidak perlu membagikan spreadsheet ke siapa pun — Apps Script mengaksesnya sebagai akun Anda.

## 4. Pasang kode ke Apps Script

1. Buka [script.google.com](https://script.google.com) → **New project** → ganti nama menjadi `Satu-Album API`.
2. **Project Settings** (ikon gerigi) → centang **"Show `appsscript.json` manifest file in editor"**.
3. Buka `appsscript.json` di editor, timpa seluruh isinya dengan isi `gas/appsscript.json`:

```json
{
  "timeZone": "Asia/Jakarta",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.scriptapp"
  ],
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

`ANYONE_ANONYMOUS` penting: tamu tidak login Google, jadi mereka harus bisa memanggil `/exec` tanpa otorisasi.

4. Buat satu berkas skrip per berkas `.gs` berikut (ikon **+ → Script**, beri nama sama tanpa `.gs`), lalu tempel seluruh isinya:

   `Code`, `Config`, `Auth`, `Sheets`, `DriveStore`, `Events`, `Templates`, `PrintOrders`, `Interactions`, `Lib`, `Setup`.

   Urutan berkas tidak penting dan nama berkas hanya kosmetik — yang penting semua isinya ada di satu project.
5. Simpan (**Ctrl/Cmd + S**).
6. Opsional: ubah konstanta `SETUP_DEFAULT_BASE_URL` di `Setup.gs` bila URL GitHub Pages Anda berbeda dari `https://brazamuzti.github.io/Satu-Album`.

## 5. Isi Script Properties

**Project Settings → Script properties → Add script property**:

| Property | Contoh nilai | Catatan |
| --- | --- | --- |
| `SHEET_ID` | `1AbC...xyz` | ID spreadsheet dari langkah 3 (wajib) |
| `ADMIN_PIN` | `776655` | PIN login admin. Bila dikosongkan, `initSheets` memakai PIN sementara **`123456`** dan memperingatkan Anda |
| `SESSION_SECRET` | hasil `openssl rand -hex 32` | Kunci HMAC token sesi. Wajib ada, jangan dibagikan. Mengubahnya = semua sesi lama langsung tidak valid |

Nilai opsional (mis. `BASE_URL`, `MAX_UPLOAD_MB`) tidak perlu diisi karena punya default aman — daftar lengkapnya ada di README → *Batas & default*.

## 6. Jalankan `initSheets`

1. Di editor, pilih fungsi **`initSheets`** → **Run**.
2. Saat pertama kali, Google meminta otorisasi: **Review permissions → pilih akun → Advanced → Go to Satu-Album API (unsafe)** → **Allow**. Peringatan "unsafe" normal untuk project pribadi yang belum diverifikasi.
3. Buka **Execution log**. Hasil yang diharapkan:

```
Spreadsheet: Satu-Album DB (1AbC...xyz)
Tab dibuat: Admin, Events, Photos, Templates, PrintOrders, PrintItems, RSVP, Guestbook
Admin: adm_xxxxxxxxxxxx (Admin Utama)
Root folder Drive: Satu-Album (1YzZ...)
BASE_URL kosong -> link QR memakai default https://brazamuzti.github.io/Satu-Album. Jalankan setBaseUrl() bila domain berbeda.
SELESAI. Langkah berikutnya:
1. Deploy > New deployment > Web app (Execute as: Me, Access: Anyone).
2. Salin URL /exec ke konstanta API_BASE di web/assets/app.js.
3. Upload web/ ke GitHub Pages.
```

4. Jalankan **`selfTest`** — semua baris harus `OK` (tidak boleh ada `FAIL`).
5. Jalankan **`setBaseUrl()`** bila URL frontend Anda bukan default di atas.

## 7. Deploy Web App

1. **Deploy → New deployment**.
2. Klik ikon gerigi **Select type → Web app**.
3. Isi:
   - **Description**: `v1` (bebas)
   - **Execute as**: **Me** — agar Apps Script memakai izin Anda saat membaca Sheets & Drive
   - **Who has access**: **Anyone** — tamu tanpa akun Google harus bisa memanggil `?action=...`
4. **Deploy** → **Authorize access** → pilih akun → **Allow**.
5. Salin **Web app URL**, bentuknya:

```
https://script.google.com/macros/s/AKfycb.../exec
```

6. Uji di browser:

```
<URL>/exec?action=ping     → {"ok":true,"data":{"pong":true,"version":"3.0.0-sheets","actions":[...]}}
<URL>/exec?action=health   → mode "sheets+drive", counts 8 tab, "ready": true
```

`ready: true` berarti `SHEET_ID` + `SESSION_SECRET` sudah terisi dan tidak ada error saat membaca spreadsheet.

> **Penting:** URL deployment menunjuk ke *snapshot* versi kode. Setiap kali Anda mengubah kode di editor, buka **Deploy → Manage deployments → ikon pensil (Edit) → Version: New version → Deploy**. Tanpa itu, `/exec` masih menjalankan kode lama.

### Uji alur lengkap tanpa frontend

Simpan URL deployment di variabel, lalu jalankan (butuh `curl` dan `python3`):

```bash
API="https://script.google.com/macros/s/<DEPLOY_ID>/exec"

# 1. Login admin → token sesi
SID=$(curl -sL -X POST "$API" -H 'content-type: text/plain' \
  -d '{"action":"login","pin":"776655"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["sid"])')

# 2. Buat acara → perhatikan slug, joinKey, dan links
curl -sL -X POST "$API" -H 'content-type: text/plain' \
  -d "{\"action\":\"createEvent\",\"sid\":\"$SID\",\"nama\":\"Pernikahan Rina & Budi\",\"jenis\":\"pernikahan\"}"

# 3. Unggah satu foto (kecil saja saat uji, mis. hasil `curl` PNG 1x1)
curl -sL -X POST "$API" -H 'content-type: text/plain' \
  -d "{\"action\":\"uploadPhoto\",\"slug\":\"pernikahan-rina-budi\",\"k\":\"<joinKey>\",\"mime\":\"image/png\",\"data\":\"$(base64 -w0 uji.png)\"}"

# 4. Lihat galeri & jumlah foto
curl -sL "$API?action=photos&slug=pernikahan-rina-budi&k=<joinKey>"
```

Body JSON dikirim sebagai `content-type: text/plain` dengan sengaja: Apps Script tidak punya `doOptions`, sehingga `application/json` akan memicu preflight `OPTIONS` dan diblokir browser.

## 8. Frontend di GitHub Pages (`web/`)

Backend sudah membentuk link publik dengan pola hash (tanpa routing server):

```
<BASE_URL>/camera.html#<slug>?k=<join_key>     ← kamera sekali pakai (QR)
<BASE_URL>/galeri.html#<slug>?k=<join_key>     ← galeri bersama
<BASE_URL>/undangan.html#<slug>?k=<join_key>   ← undangan digital
<BASE_URL>/rsvp.html#<slug>?k=<join_key>       ← konfirmasi kehadiran
```

Halaman admin (daftar acara, QR, template, daftar cetak) tidak dibentuk backend — beri nama bebas, mis. `admin.html`, dan simpan token `sid` di `sessionStorage`.

Bila Anda menulis frontend sendiri:

1. Buat folder `web/` di repo berisi `index.html` (wajib), `admin.html`, `camera.html`, `galeri.html`, `undangan.html`, `rsvp.html`, dan `assets/`.
2. Isi konstanta `API_BASE` di `web/assets/app.js` (atau di mana pun Anda menyimpannya) dengan URL `/exec` dari langkah 7.
3. Selalu panggil API dengan `fetch(API_BASE, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({...}) })` dan baca `ok`/`status` dari body — bukan dari status HTTP.
4. Di repo GitHub: **Settings → Pages → Source: GitHub Actions** (Pages gratis hanya untuk repo publik).
5. Commit ke branch `master`/`main` dengan perubahan di `web/**` → workflow `.github/workflows/deploy-pages.yml` mengunggah folder `web/` ke Pages.

Tanpa frontend pun, seluruh data bisa diperiksa langsung di spreadsheet dan folder Drive.

## 9. Menggunakan aplikasi

**Alur admin**

1. Login dengan PIN → simpan token sesi di `sessionStorage`.
2. Buat acara: isi nama (wajib, maks. 120 karakter), jenis, tanggal, lokasi, `preset`, dan `revealAt` bila foto baru boleh tampil setelah waktu tertentu. Sistem otomatis membuat slug unik, `join_key` 32 hex, folder Drive `event-<slug>/`, dan template undangan default.
3. Bagikan **link kamera** (QR) ke tamu; simpan tautan galeri/undangan/RSVP.
4. Pantau foto di tab `Photos`, daftar cetak di `PrintOrders`/`PrintItems`, RSVP di tab `RSVP`, ucapan di `Guestbook`.
5. Cabut akses kapan pun: `updateEvent` dengan `{"rotateUploadKey": true}` membuat `join_key` baru (link lama langsung tidak valid), atau set `aktif = FALSE` untuk menutup acara (`event-inactive`).
6. Ubah template undangan lewat `saveTemplate` (tema warna, teks hero/couple/acara/penutup, musik, layout).

**Alur tamu**

1. Buka link kamera → ambil foto (atau pilih dari galeri ponsel) → foto dikecilkan di klien lalu dikirim base64.
2. Tamu bisa membatalkan foto terakhir selama **2 menit** (`undoWindowMs`).
3. Buka galeri untuk melihat semua foto; kirim RSVP dan ucapan dari halaman undangan.

**Mengambil hasil acara**

- Foto asli: Google Drive → `Satu-Album/event-<slug>/` → *Download* (folder tetap privat untuk Anda).
- Daftar/data: buka spreadsheet → **File → Download → Excel/CSV** untuk tab `Photos`, `RSVP`, `Guestbook`, `PrintOrders`.
- Unduhan manual ke Drive (unggah lewat aplikasi Drive) bisa masuk album dengan `syncAllDrivePhotos()` atau `action=syncPhotos`.

## 10. Menjalankan test lokal & di CI

Dari akar repo:

```bash
node gas/test/syntax.mjs            # semua .gs bisa dikompilasi
node gas/test/refs.mjs              # tidak ada fungsi dipanggil tapi tidak didefinisikan
node --test "gas/test/*.test.mjs"   # 36 test fungsional router
```

Tes berjalan tanpa kredensial Google: `gas/test/harness.mjs` menyediakan tiruan `SpreadsheetApp`, `DriveApp`, `CacheService`, `PropertiesService`, `Utilities`, `ScriptApp`, dan `UrlFetchApp`; seluruh `gas/*.gs` dimuat dengan `vm`, lalu `doGet`/`doPost` dipanggil seperti request asli.

> **Catatan Node:** bentuk `node --test gas/test` (argumen folder) hanya bekerja di Node ≥ 24; di Node 22 muncul `MODULE_NOT_FOUND`. Selalu pakai glob `"gas/test/*.test.mjs"` — itu yang dipakai CI (`.github/workflows/ci.yml`, Node 22) dan berjalan di Node 22 maupun 26.

CI berjalan untuk setiap push/PR ke `master`; workflow `deploy-pages.yml` hanya berjalan bila ada perubahan di `web/**` atau dipicu manual, dan sengaja gagal cepat dengan pesan jelas selama `web/index.html` belum ada.

## 11. Troubleshooting

| Gejala | Sebab | Solusi |
| --- | --- | --- |
| `SHEET_ID belum diisi…` (`sheet-not-configured`) | Property `SHEET_ID` kosong | Isi Script Property `SHEET_ID`, lalu jalankan `initSheets` |
| `Spreadsheet tidak terbuka…` (`sheet-open-failed`) | ID salah, atau spreadsheet milik akun lain | Pastikan ID disalin utuh dan akun Apps Script punya akses |
| `SESSION_SECRET belum diisi…` (`auth-not-configured`) | Property `SESSION_SECRET` kosong | Isi dengan string acak panjang, lalu login ulang |
| `ADMIN_PIN belum diisi…` (`admin-not-configured`) | PIN tidak pernah diisi/di-seed | Isi `ADMIN_PIN` atau jalankan `initSheets` (memakai `123456` sementara) |
| Login gagal `invalid-pin` | PIN salah | Login membandingkan `pin_hash` di tab `Admin`, bukan property `ADMIN_PIN` |
| Login gagal `admin-inactive` | Kolom `aktif` baris Admin bernilai FALSE | Set `aktif = TRUE` di tab `Admin` |
| Login gagal `rate-limited` (429) | Lebih dari 8 percobaan/jam | Tunggu satu jam atau naikkan `LOGIN_MAX_ATTEMPTS` |
| Tamu dapat `invalid-key` (401) | Link salah/slug berbeda, atau kunci sudah dirotasi | Kirim ulang link terbaru (`showEvents()` menampilkan link aktif) |
| Tamu dapat `event-inactive` (410) | `aktif` acara = FALSE | Aktifkan kembali acara tersebut atau buat acara baru |
| Unggah gagal `too-large` (413) | Foto > `MAX_UPLOAD_MB` (default 8 MB) | Kecilkan foto di klien (mis. maks. 1600 px), atau naikkan `MAX_UPLOAD_MB` |
| Unggah gagal `unsupported` (415) | Format HEIC (iPhone) atau MIME tidak diizinkan | Kirim JPEG/PNG/WebP; set kamera iPhone ke "Most Compatible" |
| Unggah gagal `photo-limit` (409) | Album mencapai `MAX_PHOTOS_PER_EVENT` (800) | Naikkan batas atau buat acara baru |
| Undo gagal `undo-expired` | Lebih dari `UNDO_WINDOW_MS` (2 menit) | Hapus dari sisi admin (`deletePhoto` dengan sesi) |
| Galeri kosong padahal ada foto di Drive | Berkas belum tercatat di tab `Photos` | Jalankan `syncAllDrivePhotos()` atau `action=syncPhotos` |
| Thumbnail tidak muncul | Berkas Drive belum berbagi "anyone with link" | Saat unggah, Apps Script mengatur ini otomatis; untuk berkas hasil sinkron, set izin *Anyone with the link → Viewer* |
| Foto baru tidak langsung terlihat | Cache daftar foto (default 10 detik) | Tunggu, atau paksa `?refresh=1` |
| Kamera tidak muncul di HP | Halaman bukan HTTPS atau izin kamera ditolak | Pakai https (GitHub Pages), izinkan kamera, cek privasi browser |
| Browser menolak request (CORS/preflight) | Body dikirim sebagai `application/json` | Kirim `content-type: text/plain` berisi JSON |
| Kode lama masih dipakai di `/exec` | Deployment belum diperbarui | Deploy → Manage deployments → Edit → **New version** |
| `gas-busy` / `gas-quota` | Kuota Apps Script habis atau eksekusi > ±6 menit | Tunggu beberapa menit; proses bertahap (`hasMore`, `syncPhotos`), atau kecilkan `DRIVE_SYNC_MAX_FILES` |
| `Authorization required` saat Run di editor | Otorisasi belum diberikan | Ulangi Run → Review permissions → Advanced → Allow |
| Tanggal/waktu bergeser | Zona waktu project | Pastikan `appsscript.json` memakai `"timeZone": "Asia/Jakarta"` |
| Spreadsheet makin lambat | Ribuan baris di `Photos`/`PrintItems` | Arsipkan baris lama ke spreadsheet lain (simpan header) |
| Halaman Pages 404 | Pages belum diaktifkan / repo privat | Settings → Pages → Source: GitHub Actions; repo harus publik |

### Mengganti PIN admin

`changeAdminPin_()` ada di `Auth.gs`, tetapi **belum diekspos sebagai action API**, jadi pakai salah satu cara berikut.

**Cara 1 — lewat editor (disarankan).** Tempel fungsi sementara di `Setup.gs`, jalankan sekali, lalu hapus lagi:

```js
/* SEMENTARA: jalankan dari editor, lalu hapus. */
function gantiPin() {
  var admin = readRows_("Admin")[0];
  Logger.log(changeAdminPin_(admin, "123456", "PinBaruSaya123"));
}
```

PIN baru minimal 6 karakter (maks. 64). Fungsi ini juga memperbarui property `ADMIN_PIN` agar seed berikutnya konsisten.

**Cara 2 — lewat spreadsheet.** Hapus semua baris data di tab `Admin`, ubah property `ADMIN_PIN` ke PIN baru, lalu login; baris admin dibuat ulang otomatis dari `ADMIN_PIN` (lihat `loginWithPin_` di `Auth.gs`).

Mengganti `SESSION_SECRET` juga langsung mematikan semua token sesi yang beredar.

## 12. Checklist verifikasi (±10 menit)

- [ ] `?action=ping` membalas `{"ok":true,...}` dengan 23 action
- [ ] `?action=health` menampilkan `"ready": true`, `counts` 8 tab, dan `errors` kosong
- [ ] `initSheets` selesai tanpa error dan `selfTest` semua baris `OK`
- [ ] `login` berhasil dan menghasilkan `sid`, `expiresAt`, `ttlSec`
- [ ] `createEvent` menghasilkan `slug`, `joinKey`, `links` (kamera/galeri/undangan/rsvp), dan folder Drive `event-<slug>/`
- [ ] `uploadPhoto` menambah baris di tab `Photos` dan berkas di folder Drive
- [ ] `photos` mengembalikan foto tersebut; `deletePhoto` berhasil selama jendela Undo
- [ ] `rsvp` dan `guestbook` menambah baris di tab masing-masing (tanpa duplikat saat dikirim ulang)
- [ ] (Jika frontend siap) GitHub Pages menyajikan `web/index.html` dan halaman kamera bisa memotret dari HP

## 13. Catatan & langkah berikutnya

- Aktifkan sinkronisasi Drive otomatis bila tamu sering mengunggah lewat aplikasi Drive: jalankan `installDriveSyncTrigger()`.
- Setiap kali kode diubah: buat **New version** di deployment (langkah 7), lalu jalankan ulang `selfTest`.
- Backend di `gas/` adalah sumber kebenaran. `docs/PRD.md`, `ARCHITECTURE.md`, `API.md`, dan `DB-SCHEMA.sql` sebagian masih berisi rencana lama (Express + SQLite + React/Vite) yang **tidak** dipakai.
- Frontend `web/` belum ada — langkah 8 menjadi acuan struktur folder dan kontrak pemanggilan API.
