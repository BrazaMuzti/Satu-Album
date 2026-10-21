# Cara Menjalankan Satu-Album

Panduan praktis menjalankan proyek ini di komputer sendiri: pasang, jalankan ketiga bagiannya, verifikasi hasilnya, sampai menyiapkan build produksi.

> Semua perintah dan keluaran di dokumen ini **sudah diuji langsung di repo ini** (Linux, Node v26.11.1, npm 12.2.1, Python 3.14.8). Angka/JSON yang dikutip adalah keluaran nyata, bukan contoh karangan.

Dokumen terkait: [README.md](../README.md) (ringkas) · [DEPLOYMENT.md](../DEPLOYMENT.md) (hosting online) · [ROADMAP.md](./ROADMAP.md) (fase berikutnya) · [API.md](./API.md) (kontrak endpoint).

## 0. Ringkasan cepat

Repo ini berisi **tiga bagian yang dijalankan terpisah**. Tidak ada `package.json` di root, jadi setiap perintah dijalankan **dari dalam folder paketnya**.

| # | Bagian | Folder | Cara jalankan | URL lokal |
| --- | --- | --- | --- | --- |
| 1 | API + penyimpanan foto | `server/` | `npm install` → `node --env-file-if-exists=.env index.js` | http://localhost:3001 |
| 2 | Aplikasi kamera & galeri (SPA React) | `client/` | `npm install` → `npm run dev` | http://localhost:5173 |
| 3 | Menu + undangan digital (statis) | `undangan/` | `python3 -m http.server 8090` | http://localhost:8090 |

Untuk mencoba fitur inti (memotret & melihat galeri): **jalankan #1 dan #2 di dua terminal**, lalu buka `http://localhost:5173`.

```text
Terminal 1: server  ← client memanggil /api & /uploads ke sini (proxy Vite)
Terminal 2: client  ← browser Anda membuka ini
Terminal 3: undangan (opsional, hanya HTML/CSS/JS statis)
```

## 1. Prasyarat

| Kebutuhan | Versi teruji | Catatan |
| --- | --- | --- |
| Node.js | v26.11.1 | Minimal Node 20.6 (agar flag `--env-file-if-exists` tersedia). Uji skema di §8 memakai modul `node:sqlite`; bila Node Anda menolaknya, tambahkan `--experimental-sqlite` atau pakai Node terbaru |
| npm | 12.2.1 | Ikut Node |
| Browser modern | Chrome/Edge/Firefox/Safari terbaru | Fitur kamera memakai `getUserMedia` + `canvas` |
| Python 3 | 3.14.8 | Hanya untuk menyajikan folder `undangan/`. Alternatif: ekstensi *Live Server* VS Code atau `npx serve` |
| Git | opsional | Hanya untuk menyimpan perubahan |

Cek cepat:

```bash
node -v     # v26.11.1
npm -v      # 12.2.1
python3 -V  # Python 3.14.8
```

Catatan versi lain: `server/` memakai ESM (`"type": "module"`) dan `googleapis@140`; `client/` memakai Vite 5 + React 18 + TypeScript 5.

## 2. Peta repo: apa yang dijalankan

| Path | Isi | Dipakai saat |
| --- | --- | --- |
| `server/index.js` | Express API: `/api/health`, `/api/events`, `/api/events/:slug/photos`; menyajikan `/uploads` | Selalu (bagian #1) |
| `server/store.js` | Penyimpanan JSON: `data/events.json`, `data/photos.json` | Selalu |
| `server/drive.js` | Upload ke Google Drive (OAuth2 akun pribadi; service account = legacy) | Opsional |
| `server/scripts/get-google-refresh-token.js` | Helper OAuth sekali pakai (`npm run token`) | Opsional |
| `client/` | SPA: beranda, `/create`, `/events/:slug`, `/events/:slug/camera` | Bagian #2 |
| `undangan/` | Menu utama (`index.html`) + undangan (`undangan.html`), CSS/JS statis | Bagian #3 |
| `docs/` | Spesifikasi (PRD, arsitektur, skema DB, API, dll.) | Referensi, tidak dijalankan |
| `server/data/*.json`, `server/uploads/` | Data nyata (di-*ignore* Git) | Dibuat otomatis saat dipakai |

## 3. Instalasi dependensi (sekali saja)

```bash
cd ~/Proyek/Satu-Album/server
npm install          # express, cors, multer, nanoid, googleapis

cd ../client
npm install          # react, react-dom, react-router-dom + vite, typescript
```

`undangan/` **tidak butuh** instalasi apa pun (murni HTML/CSS/JS, memuat font & Font Awesome dari CDN).

Kalau `node_modules/` sudah ada di kedua folder (seperti kondisi repo ini), Anda boleh langsung melompat ke langkah berikutnya. Untuk memasang ulang dari nol: `rm -rf server/node_modules client/node_modules` lalu ulangi perintah di atas.

## 4. Menjalankan server API

```bash
cd ~/Proyek/Satu-Album/server
cp ../.env.example .env            # hanya jika server/.env belum ada
node --env-file-if-exists=.env index.js
```

Keluaran yang benar (terverifikasi):

```text
satualbum api on http://0.0.0.0:3001
drive: nonaktif, foto disimpan lokal
```

Uji dari terminal lain:

```bash
curl -s http://localhost:3001/api/health
# {"ok":true,"drive":false,"driveMode":"none","driveRootFolderId":null}
```

`drive:false` + `driveMode:"none"` artinya foto akan disimpan lokal ke `server/uploads/` — ini kondisi normal untuk pemakaian lokal.

### ⚠️ Penting: `npm start` tidak membaca `.env`

`server/package.json` saat ini berisi `"start": "node index.js"` / `"dev": "node --watch index.js"`, dan proyek **belum memakai `dotenv`**. Artinya variabel di `server/.env` **diabaikan** oleh `npm start`/`npm run dev`. Perbaikannya sudah dijadwalkan di [ROADMAP.md](./ROADMAP.md) Fase 0 menjadi `node --env-file-if-exists=.env index.js`.

Selama belum diperbaiki, pakai salah satu dari ini:

```bash
# a) cara yang dipakai di dokumen ini
node --env-file-if-exists=.env index.js

# b) atau ekspor manual di shell
export PUBLIC_BASE_URL=http://localhost:3001
node index.js

# c) atau npm start + env yang sudah ada di lingkungan proses
npm start          # .env diabaikan, tetapi env dari shell ikut terbaca
```

Cara membuktikan sendiri (aman, hanya mengubah `.env` Anda): ubah `PORT` di `server/.env` menjadi `3456`, lalu:

```bash
npm start                                 # tetap "on http://0.0.0.0:3001"  → .env diabaikan
node --env-file-if-exists=.env index.js   # "on http://0.0.0.0:3456"        → .env terbaca
```

### Variabel lingkungan yang dikenali server

| Variabel | Default | Fungsi |
| --- | --- | --- |
| `PORT` | `3001` | Port HTTP |
| `HOST` | `0.0.0.0` | Bind address (dibutuhkan host cloud) |
| `PUBLIC_BASE_URL` | *(kosong)* | Awalan absolut URL foto lokal |
| `ALLOWED_ORIGIN` | *(kosong = semua diizinkan)* | Allowlist CORS, pisahkan dengan koma |
| `DATA_DIR` | `data` | Folder `events.json` & `photos.json` |
| `UPLOAD_DIR` (atau `LOCAL_UPLOAD_DIR`) | `uploads` | Folder foto fallback lokal |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | *(kosong)* | Aktifkan mode Drive (lihat §7) |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | `credentials/google-service-account.json` | Legacy; biarkan kosong/tidak ada |
| `GOOGLE_DRIVE_ROOT_FOLDER_NAME` / `_ROOT_FOLDER_ID` | `Satu-Album` / kosong | Folder tujuan di Drive |
| `GOOGLE_DRIVE_IMAGE_WIDTH` / `_THUMB_WIDTH` | `1600` / `400` | Ukuran gambar dari endpoint thumbnail Drive |

### Di mana data disimpan?

| Berkas/folder | Isi | Sifat |
| --- | --- | --- |
| `server/data/events.json` | Daftar acara (id, slug, nama, preset, `count`) | JSON, ditulis ulang tiap perubahan |
| `server/data/photos.json` | Metadata foto (`url`, `thumb`, `source`) | JSON |
| `server/uploads/` | Berkas foto (hanya bila Drive nonaktif) | Nama `photo-<epoch>-<rand>.jpg` |

Ketiganya di-*ignore* Git, jadi aman untuk eksperimen. **Untuk uji coba terisolasi** (tanpa mengganggu data asli), arahkan ke `/tmp`:

```bash
cd ~/Proyek/Satu-Album/server
DATA_DIR=/tmp/sa-demo/data UPLOAD_DIR=/tmp/sa-demo/uploads PORT=3999 \
  node --env-file-if-exists=.env index.js
```

Contoh alur lengkap yang terverifikasi (buat acara → unggah foto → daftar foto):

```bash
curl -s -X POST http://localhost:3999/api/events \
  -H 'content-type: application/json' \
  -d '{"name":"Demo Tutorial","type":"pernikahan","preset":"portra400","revealAt":null}'
# {"event":{"id":"UXkz1O0fZ7","slug":"demo-tutorial","name":"Demo Tutorial",...,"count":0}}

curl -s -F "photo=@server/uploads/photo-1792355230619-39083.jpg" \
  http://localhost:3999/api/events/demo-tutorial/photos
# {"photo":{"id":"gxAm043iUh","eventSlug":"demo-tutorial",
#           "url":"/uploads/photo-1792615870356-3144.jpg","source":"local",...}}

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3999/api/events/tidak-ada   # 404
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3999/uploads/<nama-berkas>  # 200
```

Perhatikan `"url":"/uploads/..."` — URL **relatif** karena `PUBLIC_BASE_URL` kosong. Itu benar untuk dev (proxy Vite meneruskan `/uploads` ke server). Untuk produksi lintas domain, isi `PUBLIC_BASE_URL` (lihat §12).

## 5. Menjalankan aplikasi kamera & galeri (client)

Buka **terminal kedua** (biarkan server tetap jalan):

```bash
cd ~/Proyek/Satu-Album/client
npm run dev
```

Keluaran yang benar (terverifikasi):

```text
  VITE v5.4.21  ready in 142 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Buka **http://localhost:5173** di browser.

### Rute yang tersedia

| Rute | Halaman | Fungsi |
| --- | --- | --- |
| `/` | Beranda | Tombol "Buat album →" |
| `/create` | Form pembuatan | Nama acara, jenis, preset film, `revealAt` → dapat `slug` |
| `/events/:slug/camera` | Kamera live | `getUserMedia` + render 6 preset film di `canvas`, lalu unggah |
| `/events/:slug` | Galeri | Menampilkan semua foto acara tersebut |

### Bagaimana client terhubung ke server

`client/vite.config.ts` sudah mem-*proxy* dua path ke `localhost:3001`:

```text
/api     → http://localhost:3001   (data acara & foto)
/uploads → http://localhost:3001   (berkas foto lokal)
```

Karena itu, **selama pakai `npm run dev` Anda tidak perlu mengatur `VITE_API_BASE`**. Kalau server belum jalan, konsol Vite menampilkan galat seperti ini (terlihat saat pengujian, dan berarti proxy bekerja namun targetnya mati):

```text
[vite] http proxy error: /api/health
AggregateError [ECONNREFUSED]
```

### Uji manual 60 detik

1. Pastikan Terminal 1 (server) sudah jalan dan `curl http://localhost:3001/api/health` mengembalikan `{"ok":true,...}`.
2. Buka `http://localhost:5173` → klik **Buat album →**.
3. Isi nama (mis. `Pernikahan Ani & Budi`), pilih jenis & preset film → **Create**. Anda akan diarahkan ke halaman dengan `slug` (mis. `pernikahan-ani-budi`).
4. Buka `/events/<slug>/camera`, izinkan akses kamera, ambil beberapa foto.
5. Foto akan tersimpan di `server/uploads/` (mode lokal) dan muncul di `/events/<slug>`.

Verifikasi dari sisi server:

```bash
curl -s http://localhost:3001/api/events/pernikahan-ani-budi/photos
# {"photos":[{"id":"...","eventSlug":"pernikahan-ani-budi","url":"/uploads/photo-...jpg","source":"local",...}]}
```

### 📷 Syarat kamera (sering bikin bingung)

- `getUserMedia` hanya berjalan di **`http://localhost`** atau **HTTPS**. Membuka dev server lewat `http://192.168.x.x:5173` akan **memblokir kamera** (bukan *secure context*), walau galeri tetap bisa dilihat.
- Bila muncul `NotAllowedError`, izinkan kamera di ikon 🔒 pada address bar → *Site settings* → **Camera: Allow**, lalu muat ulang.
- Bila `NotFoundError`/tidak ada perangkat kamera (PC tanpa webcam), uji dari ponsel melalui HTTPS, misal dengan tunnel: `npx cloudflared tunnel --url http://localhost:5173` (atau `ngrok http 5173`), lalu buka URL HTTPS yang diberikan dari ponsel.
- Untuk membuka dari perangkat lain di jaringan lokal (hanya untuk melihat galeri): `npm run dev -- --host`.

### Build produksi & pratinjau lokal

```bash
cd ~/Proyek/Satu-Album/client
npm run build     # tsc -b && vite build  → folder dist/
npm run preview   # menyajikan dist/ secara lokal
```

Keluaran nyata saat pengujian (`npm run build`, exit code 0):

```text
✓ 40 modules transformed.
dist/index.html                   0.92 kB │ gzip:  0.55 kB
dist/assets/index-CA9e6GFe.css    4.58 kB │ gzip:  1.48 kB
dist/assets/index-DQCgFT4X.js   173.65 kB │ gzip: 57.65 kB
✓ built in 645ms
```

`client/public/404.html` otomatis tersalin ke `dist/404.html` (dipakai GitHub Pages untuk *deep-link* `/events/<slug>`).

Dua variabel build yang penting:

```bash
# API di host lain (mis. Render) — dipakai saat SPA tidak di-proxy
VITE_API_BASE=https://satu-album-api.onrender.com npm run build

# GitHub Pages *project site* (https://<user>.github.io/Satu-Album/)
VITE_BASE=/Satu-Album/ VITE_API_BASE=https://satu-album-api.onrender.com npm run build
```

## 6. Menjalankan menu & undangan digital (statis)

Bagian ini tidak butuh Node maupun `npm install` — cukup server berkas statis:

```bash
cd ~/Proyek/Satu-Album/undangan
python3 -m http.server 8090
```

Lalu buka di browser (keduanya terverifikasi mengembalikan HTTP 200):

| URL | Isi |
| --- | --- |
| http://localhost:8090/index.html | **Menu Utama** — 8 kartu (Camera/Scan QR, Galeri, Undangan, RSVP, Buku Tamu, Amplop, Pengaturan Tema & Musik, Admin) dengan modal aksi |
| http://localhost:8090/undangan.html | Undangan lengkap: cover "Buka Undangan", countdown, jadwal, galeri, amplop digital, RSVP, buku tamu, penutup |
| http://localhost:8090/undangan.html?to=Bapak%20Andi | Sama, tetapi nama tamu otomatis terisi di form RSVP + muncul sapaan "Dear Bapak Andi" |

Alternatif tanpa Python: ekstensi **Live Server** (VS Code) → klik kanan `index.html` → *Open with Live Server*.

### Apa yang jalan & apa yang belum

| Fitur | Status sekarang | Catatan |
| --- | --- | --- |
| Cover "Buka Undangan", scroll reveal, countdown, tombol musik, tambah ke kalender (`.ics`), salin nomor rekening | ✅ jalan | Murni JS/CSS (`js/invitation.js`) |
| Nama tamu via `?to=` | ✅ jalan | Terisi otomatis bila server dijalankan (bukan `file://`) |
| Musik latar | ⚠️ belum | `undangan/assets/music/musik.mp3` masih **0 byte** — ganti dengan MP3 asli |
| RSVP & Buku Tamu | ⚠️ target GAS belum diisi | `js/main.js` masih `GAS_URL = "MASUKKAN_URL_GAS_ANDA_DI_SINI"`. Bila gagal, halaman sengaja menampilkan "RSVP terkirim (mode offline)" agar tamu tidak bingung |
| Kartu "Camera / Scan QR" & "Galeri" di Menu Utama | ⚠️ masih placeholder | Klik-nya memunculkan dialog "integrasi client app" — integrasi ke SPA dijadwalkan pada fase berikutnya ([ROADMAP.md](./ROADMAP.md)) |
| Font & ikon | ✅ via CDN | Butuh internet (Google Fonts + Font Awesome 6) |

Kalau ingin RSVP/buku tamu benar-benar mengirim data **sekarang**, isi `GAS_URL` di `undangan/js/main.js` dengan URL Google Apps Script milik Anda (pola yang sama seperti proyek undangan sebelumnya). Untuk ke depannya, [API.md](./API.md) Fase 2 menggantikan GAS dengan endpoint `POST /api/v1/public/:slug/rsvp` di server sendiri.

> Tips: buka `index.html` langsung dengan `file://` juga bisa untuk sekilas melihat tampilan, tetapi clipboard (salin rekening) dan audio lebih andal lewat `http://localhost`.

## 7. Mengaktifkan Google Drive (opsional)

Tanpa kredensial, foto disimpan ke `server/uploads/` (`driveMode:"none"` — kondisi repo saat ini). Untuk menyimpan ke Drive akun Anda sendiri:

1. Google Cloud Console → aktifkan **Google Drive API**.
2. **OAuth consent screen**: User type *External*, tambahkan scope `https://www.googleapis.com/auth/drive.file`, lalu **Publish app → In production**.
3. **Credentials → Create credentials → OAuth client ID → Desktop app** → salin Client ID & Secret.
4. Ambil refresh token (butuh browser untuk login sekali):

   ```bash
   cd ~/Proyek/Satu-Album/server
   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run token
   ```

   Helper akan mencetak URL, membuka callback di `http://localhost:53682`, lalu mencetak `GOOGLE_REFRESH_TOKEN=...`. Kalau port callback bermasalah: `npm run token -- --manual` (salin-tempel kode).
5. Isi ketiga nilai tersebut di `server/.env`, lalu **jalankan server dengan `--env-file-if-exists`** (ingat §4) dan cek:

   ```bash
   curl -s http://localhost:3001/api/health
   # {"ok":true,"drive":true,"driveMode":"oauth",...}
   ```

Cek perilaku helper tanpa kredensial (terverifikasi, keluar dengan kode 1 — aman, tidak menggantung):

```text
GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET wajib diisi.
Contoh: GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/get-google-refresh-token.js
```

⚠️ Catatan penting:

- `server/.env` saat ini masih memuat baris legacy `GOOGLE_SERVICE_ACCOUNT_FILE=credentials/google-service-account.json`; folder `server/credentials/` belum ada, jadi mode Drive tetap `none` (terverifikasi). Biarkan atau hapus barisnya.
- **Jangan** pakai service account: kuotanya 0 byte → `storageQuotaExceeded`. Pakai OAuth2 akun pribadi.
- Jangan membuat folder tujuan manual di web Drive; scope `drive.file` hanya melihat berkas buatan app, sehingga server membuat folder `Satu-Album` sendiri.
- Selama consent masih *Testing*, refresh token kedaluwarsa dalam **7 hari** (`invalid_grant`).

## 8. Memverifikasi skema database (tanpa menyentuh data asli)

`docs/DB-SCHEMA.sql` **belum dipakai** oleh aplikasi (pemakaiannya dimulai Fase 0–1 di [ROADMAP.md](./ROADMAP.md)). Anda tetap bisa mengujinya sekarang dengan `node:sqlite` bawaan Node — di database **in-memory**, sehingga tidak ada berkas yang dibuat. Bila modul itu belum tersedia di Node Anda (mis. Node 20), jalankan perintahnya dengan `node --experimental-sqlite`.

Simpan berkas berikut sebagai `/tmp/cek-skema.mjs`:

```js
/* cek-skema.mjs — menguji docs/DB-SCHEMA.sql di database sementara.
   Argumen:  [berkas-sql] [berkas-db]   (default: docs/DB-SCHEMA.sql, ":memory:") */
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const file = process.argv[2] || "docs/DB-SCHEMA.sql";
const dbfile = process.argv[3] || ":memory:";
const sql = fs.readFileSync(file, "utf8");
const db = new DatabaseSync(dbfile);

db.exec(sql);
const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
const v = db.prepare("SELECT name FROM sqlite_master WHERE type='view'").all();
console.log(`OK: ${t.length} tabel, ${v.length} view  (db: ${dbfile})`);

db.exec(sql);
console.log("OK: idempoten (aman dijalankan dua kali)");

const fk = db.prepare("PRAGMA foreign_keys").get();
console.log("foreign_keys pragma:", JSON.stringify(fk));
db.close();
```

Jalankan dari **root repo**:

```bash
cd ~/Proyek/Satu-Album
node /tmp/cek-skema.mjs docs/DB-SCHEMA.sql
```

Keluaran nyata (terverifikasi):

```text
OK: 35 tabel, 1 view  (db: :memory:)
OK: idempoten (aman dijalankan dua kali)
foreign_keys pragma: {"foreign_keys":1}
```

Ingin membuat **berkas** DB nyata untuk eksperimen (mis. membuka dengan `sqlite3`)? Beri argumen kedua berupa path di `/tmp` — jangan di `server/data/`:

```bash
node /tmp/cek-skema.mjs docs/DB-SCHEMA.sql /tmp/sa-coba.db   # terverifikasi, 35 tabel
sqlite3 /tmp/sa-coba.db '.tables'                            # opsional, jika sqlite3 terpasang
rm -f /tmp/sa-coba.db*                                       # bersihkan bila sudah selesai
```

Skrip aman dijalankan berulang pada berkas yang sama (`CREATE ... IF NOT EXISTS` + migrasi bernomor), yang sudah diuji lintas proses tanpa galat.

## 9. Ringkasan port, perintah, dan variabel

**Port**

| Port | Dipakai oleh | Bisa diubah via |
| --- | --- | --- |
| `3001` | Server API | `PORT` |
| `5173` | Vite dev server (client) | `client/vite.config.ts` → `server.port` |
| `8090` | Server statis `undangan/` (contoh) | argumen `python3 -m http.server <port>` |
| `53682` | Callback OAuth saat `npm run token` | `OAUTH_PORT` |

**Perintah harian**

| Perintah | Dijalankan di | Kegunaan |
| --- | --- | --- |
| `node --env-file-if-exists=.env index.js` | `server/` | Menjalankan API **dengan** `.env` (disarankan) |
| `npm start` | `server/` | Menjalankan API tanpa membaca `.env` |
| `npm run dev` | `server/` | Sama seperti `npm start` + auto-restart saat berkas berubah |
| `npm run token` | `server/` | Mengambil `GOOGLE_REFRESH_TOKEN` (butuh kredensial OAuth) |
| `npm run dev` | `client/` | Vite dev server + HMR |
| `npm run build` | `client/` | Type-check (`tsc`) + build produksi ke `dist/` |
| `npm run preview` | `client/` | Menyajikan `dist/` untuk uji akhir |
| `python3 -m http.server 8090` | `undangan/` | Menyajikan undangan & menu statis |
| `node /tmp/cek-skema.mjs docs/DB-SCHEMA.sql` | root repo | Menguji skema DB di in-memory |

**Variabel lingkungan server**

| Variabel | Perlu sekarang? | Untuk apa |
| --- | --- | --- |
| `PORT`, `HOST` | opsional | Port & bind address |
| `PUBLIC_BASE_URL` | produksi | Membuat URL foto lokal menjadi absolut |
| `ALLOWED_ORIGIN` | produksi | Allowlist CORS untuk domain client |
| `DATA_DIR`, `UPLOAD_DIR` | opsional | Lokasi data JSON & foto |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` | opsional | Mode Drive OAuth2 |
| `SA_DB_PATH`, `SA_GUEST_SECRET`, `SA_SESSION_DAYS`, `SA_BACKUP_*` | **belum ada** | Akan diperkenalkan pada Fase 0 ([ARCHITECTURE.md](./ARCHITECTURE.md) §9). Mengisinya sekarang tidak berpengaruh |

**Variabel build client**

| Variabel | Fungsi |
| --- | --- |
| `VITE_API_BASE` | Basis URL API saat SPA tidak memakai proxy Vite (mis. di Vercel) |
| `VITE_BASE` | Base path aset & router (khusus GitHub Pages *project site*) |

## 10. Troubleshooting (gejala → sebab → solusi)

| Gejala | Sebab | Solusi |
| --- | --- | --- |
| `ECONNREFUSED` / HTTP 500 di konsol Vite saat memanggil `/api/...` | Server API belum jalan (proxy aktif, target mati — persis yang terlihat saat pengujian) | Jalankan Terminal 1 (§4) lebih dulu |
| `Error: listen EADDRINUSE: address already in use :::3001` | Port 3001 dipakai proses lain | `fuser -k 3001/tcp` **atau** jalankan server di port lain: `PORT=3002 node index.js` **dan** ubah proxy di `client/vite.config.ts` ke `3002` |
| Halaman client kosong / 404 saat *deep-link* `/events/<slug>` | Dev server perlu memuat ulang (Vite selalu melayani SPA) | Muat ulang dari `/`; untuk produksi, pastikan *rewrite* SPA aktif (`client/vercel.json` / `client/public/404.html`) |
| Kamera tidak muncul, `NotAllowedError` | Izin ditolak, atau bukan *secure context* | Akses lewat `http://localhost` atau HTTPS; aktifkan izin Camera pada ikon 🔒 |
| `NotFoundError`/`OverconstrainedError` saat buka kamera | Tidak ada kamera (PC tanpa webcam) | Uji dari ponsel via HTTPS (tunnel) |
| Foto tidak muncul di galeri | Foto tersimpan lokal (`/uploads/...`) tetapi `UPLOAD_DIR`/`PUBLIC_BASE_URL` salah untuk domain yang dipakai | Cek `curl -I http://localhost:3001/uploads/<berkas>`; isi `PUBLIC_BASE_URL` untuk akses lintas domain |
| Perubahan di `server/.env` tidak berefek | `npm start` tidak membaca `.env` (§4) | Pakai `node --env-file-if-exists=.env index.js` |
| Upload gagal: `storageQuotaExceeded` | Masih memakai service account | Pindah ke OAuth2 akun pribadi (§7) |
| Upload gagal: `invalid_grant` | Consent masih *Testing* (>7 hari) atau akses app dicabut | Publish app ke *In production*, lalu `npm run token` ulang |
| `npm install` gagal (`EBADENGINE`, galat sintaks ESM) | Node terlalu tua | Pakai Node ≥ 20 (`node -v`); proyek ini diuji di Node v26.11.1 |
| Data acara & foto hilang tiap deploy di Render | Disk Render *ephemeral* | Ikuti opsi di [DEPLOYMENT.md](../DEPLOYMENT.md) (Drive OAuth2 atau disk permanen) |
| Musik undangan tidak berbunyi | `undangan/assets/music/musik.mp3` masih 0 byte (terverifikasi) | Ganti dengan berkas MP3 asli |
| Form RSVP menjawab "mode offline" | `GAS_URL` di `undangan/js/main.js` belum diisi | Isi `GAS_URL` atau tunggu Fase 2 (endpoint backend sendiri) |
| `undangan/` tampil tanpa font/ikon | CDN Google Fonts / Font Awesome tidak terjangkau | Sambungkan ke internet atau ganti dengan berkas lokal |
| Port 8090 dipakai proses lain | Proses `python3 -m http.server` sebelumnya masih hidup | Hentikan prosesnya atau pakai port lain, mis. `python3 -m http.server 8091` |

Cek port yang sedang dipakai:

```bash
ss -ltnp | grep -E '3001|5173|8090|53682'
```

## 11. Checklist verifikasi (10 menit)

Jalankan berurutan; semuanya sudah terbukti bekerja pada repo ini.

| # | Langkah | Ekspektasi |
| --- | --- | --- |
| 1 | `node -v && npm -v` | v20+ / npm terpasang |
| 2 | `cd server && npm install` | Selesai tanpa galat |
| 3 | `node --env-file-if-exists=.env index.js` | `satualbum api on http://0.0.0.0:3001` |
| 4 | `curl -s localhost:3001/api/health` | `{"ok":true,"drive":false,"driveMode":"none",...}` |
| 5 | `curl -s -X POST localhost:3001/api/events -H 'content-type: application/json' -d '{"name":"Tes Cepat"}'` | `{"event":{"slug":"tes-cepat",...}}` |
| 6 | `cd ../client && npm install && npm run dev` | `VITE v5.4.21 ready` di `http://localhost:5173` |
| 7 | Buka `http://localhost:5173/create`, buat album, lalu `/events/<slug>/camera` | Kamera tampil & bisa memotret |
| 8 | `curl -s localhost:3001/api/events/<slug>/photos` | `{"photos":[...]}` (foto dari langkah 7) |
| 9 | `cd ../undangan && python3 -m http.server 8090` → buka `http://localhost:8090/undangan.html?to=Bapak%20Andi` | Cover + nama tamu terisi |
| 10 | `cd .. && node /tmp/cek-skema.mjs docs/DB-SCHEMA.sql` | `OK: 35 tabel, 1 view  (db: :memory:)` |

## 12. Menjalankan di produksi (ringkas)

Panduan langkah-demi-langkah ada di [DEPLOYMENT.md](../DEPLOYMENT.md); ini ringkasan alur beserta nilai yang wajib diisi.

| Bagian | Host | Root Directory | Build | Start/Output | Env wajib |
| --- | --- | --- | --- | --- | --- |
| `server/` | Render (atau Railway/Fly.io/VPS) | `server` | `npm install` | `npm start` | `NODE_VERSION=22`, `PUBLIC_BASE_URL`, `ALLOWED_ORIGIN` |
| `client/` | Vercel | `client` | `npm run build` | `dist` | `VITE_API_BASE=https://<api>.onrender.com` |
| `undangan/` | Vercel / GitHub Pages | `undangan` | — | folder statis | — |

- Repo sudah menyertakan `render.yaml` (blueprint Render) dan `client/vercel.json` (*rewrite* SPA + output `dist`); tetap isi env var manual karena `sync: false`.
- **HTTPS wajib** untuk fitur kamera; semua host di atas menyediakannya otomatis.
- Untuk lingkungan produksi, isi `PUBLIC_BASE_URL` agar URL foto lokal menjadi absolut, dan `ALLOWED_ORIGIN` dengan domain client (tanpa *trailing slash*, pisahkan dengan koma).
- Disk Render *ephemeral*: pakai OAuth2 Drive (§7) dan/atau disk permanen (`DATA_DIR=/data`, `UPLOAD_DIR=/data/uploads`) supaya data tidak hilang saat redeploy.

```bash
# contoh: push lalu deploy lewat dashboard Render & Vercel
cd ~/Proyek/Satu-Album
git add -A && git commit -m "Update" && git push origin master
```

## 13. Status saat ini & langkah berikutnya

Yang **sudah bisa dijalankan hari ini** (terverifikasi di dokumen ini):

- API Express + penyimpanan JSON/foto lokal, termasuk fallback lokal tanpa Drive.
- SPA kamera: buat album, 6 preset film, kamera live, galeri per `slug`.
- Undangan statis (cover, countdown, kalender, amplop, RSVP/buku tamu ke GAS).
- Skema database lengkap (`docs/DB-SCHEMA.sql`) yang bisa diuji tanpa mengganggu data.

Yang **belum tersambung**:

| Item | Kondisi | Rencana |
| --- | --- | --- |
| Skema SQL → aplikasi | `docs/DB-SCHEMA.sql` masih dokumen; aplikasi memakai JSON | Fase 0–1: `server/migrations/0001_init.sql` + repositori SQLite (`node:sqlite`) |
| `.env` server | Tidak dibaca `npm start` | Fase 0: perbaiki skrip npm (§4) |
| RSVP/buku tamu backend | Masih mengarah ke Google Apps Script | Fase 2 per [API.md](./API.md) |
| Undangan per acara | `undangan/undangan.html` masih menampilkan pasangan contoh "Ani & Budi" | Fase 3–4: render dari data acara |
| Blok undangan lengkap | 15 dari 27 blok belum dibuat | [BLOCKS.md](./BLOCKS.md) + [ROADMAP.md](./ROADMAP.md) |
| Tema premium, kamera tamu (guestcam), peran vendor | Belum ada | Fase 8 dst. (keputusan R3/R4) |

Urutan kerja yang disarankan ada di [ROADMAP.md](./ROADMAP.md) — mulai dari Fase 0 (fondasi server, migrasi, seed, impor JSON lama) sebelum menulis fitur baru.
