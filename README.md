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
- **Galeri galeri berbasis link** — setiap acara punya slug unik untuk dibagikan ke tamu.
- **Upload dengan fallback penyimpanan** — Google Drive jika dikonfigurasi, lokal jika tidak.

## Arsitektur

```
Satu-Album/
├── server/   # Express API (Node ESM)
│   ├── index.js   # routes + app
│   ├── store.js   # penyimpanan event & foto (JSON on disk)
│   ├── drive.js   # Google Drive upload (OAuth2 / service account, opsional)
│   └── scripts/   # get-google-refresh-token.js (helper OAuth)
├── client/   # Vite + React + TypeScript (SPA)
│   └── src/       # api, filmPresets, Camera, Gallery, Create, dll
└── .env.example
```

## Menjalankan (Lokal & Online)

Panduan langkah-demi-langkah untuk lokal (server, client, undangan, build, troubleshooting) ada di **[*docs/CARA-MENJALANKAN.md*](docs/CARA-MENJALANKAN.md)**.

Untuk host di produksi (server → Render, client → Vercel, dll), handa *[DEPLOYMENT.md](DEPLOYMENT.md)*.

### 1. Server

```bash
cd server
npm install
cp ../.env.example .env   # lalu isi konfigurasi
npm start                # Express di http://localhost:3001
```

> ⚠️ `npm start` **belum** membaca `server/.env` (proyek belum memakai `dotenv`). Untuk memakai isi `.env`, jalankan `node --env-file-if-exists=.env index.js`. Rinciannya di [docs/CARA-MENJALANKAN.md](docs/CARA-MENJALANKAN.md) §4.

Kebutuhan env (lihat `.env.example`):

| Variabel | Wajib | Fungsi |
| --- | --- | --- |
| `PORT` | opsional | port server (default 3001) |
| `HOST` | opsional | bind address (default `0.0.0.0`, dibutuhkan host cloud) |
| `PUBLIC_BASE_URL` | opsional | URL publik API, agar URL foto fallback lokal menjadi absolut |
| `ALLOWED_ORIGIN` | opsional | allowlist CORS domain client (pisahkan dengan koma; kosong = izinkan semua) |
| `DATA_DIR` | opsional | folder penyimpanan JSON (default `data`) |
| `UPLOAD_DIR` | opsional | folder upload lokal (default `uploads`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | opsional | kredensial OAuth2 akun Google untuk upload ke Drive |
| `GOOGLE_DRIVE_ROOT_FOLDER_NAME` | opsional | nama folder Drive tujuan (default `Satu-Album`, dibuat otomatis oleh server) |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | opsional | ID folder Drive tujuan (hanya bila folder dibuat oleh app) |
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

5. Isi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` di `.env` lalu restart. Cek `GET /api/health` → `{"ok":true,"drive":true,"driveMode":"oauth"}`.

> ⚠️ Scope `drive.file` hanya memberi akses ke file yang **dibuat oleh app ini**. Karena itu folder root (`GOOGLE_DRIVE_ROOT_FOLDER_NAME`, default `Satu-Album`) dibuat otomatis oleh server — folder yang dibuat manual lewat web Drive tidak akan terlihat. URL foto memakai `https://drive.google.com/thumbnail?id=<fileId>&sz=w1600` (dan `w400` untuk thumbnail), bukan `uc?export=view` yang sering gagal render.

### 2. Client

```bash
cd client
npm install
npm run dev             # Vite di http://localhost:5173
```

Vite memproxy `/api` dan `/uploads` ke `localhost:3001`, jadi jalankan server dan client bersamaan.

## Endpoint API

| Method | Path | Deskripsi |
| --- | --- | --- |
| GET | `/api/health` | status server |
| POST | `/api/events` | buat acara `{ name, type, preset, revealAt }` |
| GET | `/api/events/:slug` | detail acara |
| POST | `/api/events/:slug/photos` | upload foto (multipart) |
| GET | `/api/events/:slug/photos` | daftar foto |

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

1. Host membuat album (nama, jenis, film) → dapat slug (`/create`).
2. Hosti dan tamu membuka `/events/<slug>/camera`, memotret dengan preset terpilih.
3. Foto ter-upload dan muncul di galeri `/events/<slug>`.

## Catatan

- Kamera memerlukan HTTPS atau `localhost` (persyaratan `getUserMedia`).
- Latar belakang gelap agar hasil terasa seperti cetakan foto.
- Project dibangun khusus untuk skenario acara nikah: galeri berkembang seiring acara berlangsung.
