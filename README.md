# Satu-Album

Kamera sekali pakai digital. Buat sebuah album, bagikan link-nya, dan biarkan tamu memotret melalui browser dengan warna film analog (color grading di canvas). Hasil foto terkumpul di galeri bersama.

## Dokumentasi

Spesifikasi produk & teknis (ditulis sebelum implementasi):

| Dokumen | Isi |
| --- | --- |
| [docs/PRD.md](docs/PRD.md) | Visi, persona, user story, functional & non-functional requirement, risiko |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Prinsip, keputusan arsitektur (ADR), peta surface, lapisan server |
| [docs/DB-SCHEMA.sql](docs/DB-SCHEMA.sql) | Skema database lengkap (SQLite `node:sqlite`, portabel ke PostgreSQL) |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | Peran & matriks izin, mekanisme override, rencana uji |
| [docs/BLOCKS.md](docs/BLOCKS.md) | Katalog blok undangan + skema config + kontrak payload |
| [docs/THEMES.md](docs/THEMES.md) | Kontrak `theme.json`, 2 tema MVP, roadmap 18 tema, checklist |
| [docs/API.md](docs/API.md) | Kontrak endpoint per fase + contoh request/response |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Fase 0–10, definition of done, strategi uji, struktur file target |
| [docs/CARA-MENJALANKAN.md](docs/CARA-MENJALANKAN.md) | **Tutorial lengkap menjalankan**: prasyarat, instalasi, server/client/undangan, build produksi, env, troubleshooting |

## Fitur

- **Kamera live di browser** — `getUserMedia` + `canvas`, tanpa aplikasi tambahan.
- **6 preset warna film** — tone curve, warna, grain, vignette, dan light leak di-render langsung di canvas.
- **Potret sekali tekan, langsung terunggah** — foto dikecilkan ke 2048 px di HP (hemat kuota), lalu dikirim otomatis. Ada tombol **Undo** 10 detik.
- **Antrean offline** — sinyal hilang di tengah acara? Foto disimpan di HP (IndexedDB) dan dikirim otomatis saat jaringan kembali.
- **Galeri hidup** — menyegarkan sendiri tiap 20 detik tanpa mengunduh ulang seluruh daftar.
- **Google Drive sebagai sumber kebenaran** — metadata album (`event.json`) dan foto hidup di Drive, jadi album tetap utuh walau server gratis restart/tidur. Tanpa kredensial Drive, server otomatis memakai disk lokal (mode pengembangan).

## Arsitektur

```
Satu-Album/
├── server/                 # Express API (Node ESM)
│   ├── index.js            # routes + boot (sync Drive saat start)
│   ├── store.js            # fasad penyimpanan: cache TTL, pilih backend, flush metadata
│   ├── drive.js            # klien Google Drive (OAuth2, scope drive.file)
│   ├── src/
│   │   ├── config.js       # semua env dibaca & divalidasi di sini
│   │   ├── drive-store.js  # backend Drive: event.json + photo-*.jpg  ← sumber kebenaran
│   │   ├── local-store.js  # backend disk lokal (dev / tanpa Drive)
│   │   ├── middleware/admin.js  # token admin & kunci tamu (timing-safe)
│   │   └── lib/            # slug, validasi gambar (magic bytes), rate limit, error
│   ├── scripts/            # get-google-refresh-token.js, sync-drive.mjs
│   └── test/               # node:test — termasuk fake Google Drive
├── client/                 # Vite + React + TypeScript (SPA)
│   └── src/                # api, uploadQueue, filmPresets, Camera, Gallery, Create
├── .github/workflows/      # CI (test + build) & deploy Pages
├── render.yaml             # blueprint deploy server
└── DEPLOYMENT.md           # panduan deploy Render + Google Drive + Pages
```


## Menjalankan (Lokal & Online)

Panduan langkah-demi-langkah untuk lokal (server, client, undangan, build, troubleshooting) ada di **[*docs/CARA-MENJALANKAN.md*](docs/CARA-MENJALANKAN.md)**.

Untuk host di produksi (Render free + Google Drive + GitHub Pages), lihat **[DEPLOYMENT.md](DEPLOYMENT.md)**.

### 1. Server

```bash
cd server
npm install
cp ../.env.example .env   # lalu isi ADMIN_TOKEN (wajib) & kredensial Google
npm start                # Express di http://localhost:3001 (otomatis membaca server/.env)
npm test                 # 31 test (node:test) — tidak butuh kredensial Google
```

Kebutuhan env (lihat `.env.example`):

| Variabel | Wajib | Fungsi |
| --- | --- | --- |
| `ADMIN_TOKEN` | **ya** (produksi) | token panitia untuk membuat/mengubah/menghapus acara (`x-admin-token`) |
| `PUBLIC_BASE_URL` | produksi | URL publik API, agar URL foto fallback lokal menjadi absolut |
| `ALLOWED_ORIGIN` | produksi | allowlist CORS domain client (pisahkan dengan koma; kosong = izinkan semua) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | produksi | OAuth2 akun Google untuk Drive (sumber kebenaran) |
| `GOOGLE_DRIVE_ROOT_FOLDER_NAME` | opsional | nama folder Drive tujuan (default `Satu-Album`, dibuat otomatis oleh server) |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | opsional | ID folder Drive tujuan (hanya bila folder dibuat oleh app) |
| `PORT` / `HOST` | opsional | port (default 3001) & bind address (default `0.0.0.0`) |
| `MAX_UPLOAD_MB` / `MAX_PHOTOS_PER_EVENT` | opsional | batas 8 MB/foto & 800 foto/album |
| `RATE_CREATE_PER_HOUR` / `RATE_UPLOAD_PER_HOUR` | opsional | rate limit per IP (10 & 300 per jam) |
| `SA_UNDO_WINDOW_MS` / `SA_CACHE_TTL_MS` / `SA_META_FLUSH_MS` | opsional | jendela Undo 2 menit, cache 10 detik, debounce metadata 3 detik |
| `DATA_DIR` / `UPLOAD_DIR` | opsional | folder JSON & upload lokal (default `data` / `uploads`) |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | opsional (legacy) | service account; kuota storage 0 byte sehingga umumnya gagal |


Tanpa kredensial Drive, server otomatis menyimpan foto ke `UPLOAD_DIR` (fallback lokal).

#### Mengaktifkan Google Drive (OAuth2 akun pribadi)

Service account punya kuota penyimpanan **0 byte**, jadi upload ke My Drive hampir selalu gagal (`storageQuotaExceeded`). OAuth2 akun pribadi membuat foto masuk ke kuota Drive Anda sendiri.

1. Google Cloud Console → aktifkan **Google Drive API**.
2. **OAuth consent screen**: User type *External*, tambahkan scope `https://www.googleapis.com/auth/drive.file` (non-sensitive, tanpa proses verifikasi), lalu **Publish app → In production**. Selama status masih *Testing*, refresh token otomatis kedaluwarsa dalam **7 hari**.
3. **Credentials → Create credentials → OAuth client ID → Desktop app** → salin Client ID & Client Secret.
4. Ambil refresh token dengan helper yang disertakan:

```bash
cd server
GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run token
# buka URL yang dicetak → setujui → salin GOOGLE_REFRESH_TOKEN ke .env
```

5. Isi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` di `.env` lalu restart. Cek `GET /api/health` → `{"ok":true,"storage":{"mode":"drive"},"drive":{"ready":true,"mode":"oauth"}}`.

> ⚠️ Scope `drive.file` hanya memberi akses ke file yang **dibuat oleh app ini**. Karena itu folder root (`GOOGLE_DRIVE_ROOT_FOLDER_NAME`, default `Satu-Album`) dibuat otomatis oleh server — folder yang dibuat manual lewat web Drive tidak akan terlihat. URL foto memakai `https://drive.google.com/thumbnail?id=<fileId>&sz=w1600` (dan `w400` untuk thumbnail), bukan `uc?export=view` yang sering gagal render.

### Layout di Google Drive

```
Satu-Album/                      ← GOOGLE_DRIVE_ROOT_FOLDER_NAME (dibuat otomatis)
└── event-<slug>/
    ├── event.json               ← metadata album: nama, film, revealAt, kunci tamu, jumlah foto
    └── photo-<timestamp>.jpg    ← foto asli
```

`event.json` inilah yang membuat galeri tetap hidup setelah Render restart. Untuk memeriksa atau merapikan isinya:

```bash
cd server && npm run sync        # daftar album + jumlah foto + ukuran (memperbaiki event.json bila perlu)
cd server && npm run sync -- --json   # keluaran JSON
```

### 2. Client

```bash
cd client
npm install
npm run dev             # Vite di http://localhost:5173
```

Vite memproxy `/api` dan `/uploads` ke `localhost:3001`, jadi jalankan server dan client bersamaan.

Cara memakai: buka `/create` → isi **token admin** (nilai `ADMIN_TOKEN` di server) → buat album → salin **link kamera** ke tamu. Token admin hanya disimpan di browser panitia (`localStorage`), tidak pernah dikirim ke tamu.

## Endpoint API

Otorisasi: panitia memakai header `x-admin-token: <ADMIN_TOKEN>`, tamu memakai kunci album `?k=<uploadKey>` (atau header `x-upload-key`).

| Method | Path | Akses | Deskripsi |
| --- | --- | --- | --- |
| GET | `/api/health` | publik | status penyimpanan (Drive/lokal), versi, batas |
| POST | `/api/events` | admin | buat acara `{ name, type, preset, revealAt }` → menyertakan `uploadKey` |
| GET | `/api/events` | admin | daftar acara + jumlah foto + kunci tamu |
| GET | `/api/events/:slug` | publik (detail) / kunci tamu (`uploadKey`) | detail acara; `authorized` menunjukkan kunci tamu valid |
| PATCH | `/api/events/:slug` | admin | ubah nama/preset, atau `{ "rotateUploadKey": true }` untuk mencabut link lama |
| DELETE | `/api/events/:slug` | admin | hapus acara (folder Drive dipindah ke Trash) |
| POST | `/api/events/:slug/photos` | kunci tamu | unggah foto — **biner mentah** (`content-type: image/jpeg`), bukan multipart |
| GET | `/api/events/:slug/photos` | kunci tamu | daftar foto; `?since=<iso>` untuk hanya foto baru, `?refresh=1` untuk abaikan cache |
| DELETE | `/api/events/:slug/photos/:photoId` | kunci tamu (≤ jendela Undo) / admin | hapus foto |

Contoh:

```bash
# Buat album
curl -X POST https://<api>/api/events \
  -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"name":"Pernikahan Rina & Budi","type":"pernikahan","preset":"funsaver"}'

# Unggah foto (biner mentah)
curl -X POST "https://<api>/api/events/<slug>/photos" \
  -H "content-type: image/jpeg" -H "x-upload-key: <uploadKey>" --data-binary @foto.jpg
```

Kode error penting: `401 invalid-key` (kunci tamu salah/kosong), `403 undo-expired` (lewat jendela Undo), `409 photo-limit` (album penuh), `413 too-large`, `415` (bukan JPEG/PNG/WebP), `429` (rate limit, lihat header `Retry-After`).


## Preset Film

| ID | Nama | Karakter |
| --- | --- | --- |
| `funsaver` | Kodak FunSaver | hangat, jenuh, effortless |
| `quicksnap` | Fujifilm QuickSnap | dingin, tajam di siang hari |
| `portra400` | Kodak Portra 400 | lembut, warna kulit krem |
| `ektar100` | Kodak Ektar 100 | warna mencolok, jenuh |
| `hp5plus` | Ilford HP5 Plus | monokrom, grain tebal |
| `cinestill800t` | CineStill 800T | tungsten + halation |

Grading diterapkan per-pixel: tone curve per kanal (LUT), color cast, vignette, grain seeded, dan light leak. Sumber di `client/src/filmPresets.ts`.

## Alur

1. Panitia membuka `/create`, mengisi token admin + nama acara + film → mendapat **link kamera** dan **link galeri** (berisi kunci album `?k=`).
2. Tamu membuka link kamera, memotret dengan preset terpilih. Foto **langsung terunggah** (dikecilkan ke 2048 px di HP); ada tombol Undo 10 detik. Bila sinyal hilang, foto antre di perangkat dan terkirim otomatis.
3. Foto muncul di galeri `/events/<slug>` — galeri menyegarkan dirinya sendiri tiap 20 detik.
4. Server menyimpan `event.json` + foto ke Google Drive, jadi album tetap ada walau instance Render restart/tidur.

## Test

```bash
cd server && npm test     # 31 test: unit (slug/gambar/rate limit), backend Drive, dan API end-to-end
```

Test backend Drive memakai klien Drive palsu (`server/test/helpers/fake-drive.js`) sehingga **tidak butuh kredensial Google**. Termasuk uji “restart”: cache & klien dibuang, lalu galeri harus terbaca kembali dari `event.json` di Drive.

## Catatan

- Kamera memerlukan HTTPS atau `localhost` (persyaratan `getUserMedia`).
- Latar belakang gelap agar hasil terasa seperti cetakan foto.
- Foto disimpan 2048 px / kualitas 0,85 (±0,3 MB) — cukup untuk cetak 4R, dan hemat kuota Drive.
- Render free **tidur** setelah ±15 menit tanpa trafik: permintaan pertama bisa memakan ~1 menit, tapi data tetap aman karena dibaca ulang dari Drive.
- Project dibangun khusus untuk skenario acara nikah: galeri berkembang seiring acara berlangsung.

