# satu-album

Kamera sekali pakai digital. Buat sebuah album, bagikan link-nya, dan biarkan tamu memotret melalui browser dengan warna film analog (color grading di canvas). Hasil foto terkumpul di galeri bersama.

## Fitur

- **Kamera live di browser** — `getUserMedia` + `canvas`, tanpa aplikasi tambahan.
- **6 preset warna film** — tone curve, warna, grain, vignette, dan light leak di-render langsung di canvas.
- **Galeri galeri berbasis link** — setiap acara punya slug unik untuk dibagikan ke tamu.
- **Upload dengan fallback penyimpanan** — Google Drive jika dikonfigurasi, lokal jika tidak.

## Arsitektur

```
satualbum/
├── server/   # Express API (Node ESM)
│   ├── index.js   # routes + app
│   ├── store.js   # penyimpanan event & foto (JSON on disk)
│   └── drive.js   # Google Drive upload (opsional)
├── client/   # Vite + React + TypeScript (SPA)
│   └── src/       # api, filmPresets, Camera, Gallery, Create, dll
└── .env.example
```

## Menjalankan

### 1. Server

```bash
cd server
npm install
cp ../.env.example .env   # lalu isi konfigurasi
npm start                # Express di http://localhost:3001
```

Kebutuhan env (lihat `.env.example`):

| Variabel | Wajib | Fungsi |
| --- | --- | --- |
| `PORT` | opsional | port server (default 3001) |
| `DATA_DIR` | opsional | folder penyimpanan JSON (default `data`) |
| `UPLOAD_DIR` | opsional | folder upload lokal (default `uploads`) |
| `GOOGLE_DRIVE_ENABLED` | opsional | `true` untuk aktifkan Drive |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | opsional | konten JSON service account |
| `GOOGLE_DRIVE_FOLDER_ID` | opsional | folder Drive tujuan foto |

Tanpa kredensial Drive, server otomatis menyimpan foto ke `UPLOAD_DIR` (fallback lokal).

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
