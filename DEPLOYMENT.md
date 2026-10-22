# Deploy Satu-Album Online

Panduan menaikkan Satu-Album ke internet. Sistem ini dirancang untuk **gratis**:

| Komponen | Teknologi | Host | Biaya |
| --- | --- | --- | --- |
| `server/` | Express API (Node ESM) | **Render free** | Rp 0 |
| `client/` | Vite + React SPA | **GitHub Pages** (atau Vercel/Cloudflare Pages) | Rp 0 |
| Foto & metadata | **Google Drive** (kuota akun Google Anda) | Google | Rp 0 (15 GB) |

> ⚠️ **HTTPS wajib**: kamera browser (`getUserMedia`) hanya berjalan di `localhost` atau HTTPS. Render, Pages, dan Vercel semuanya otomatis HTTPS.

## 1. Ide pokok: Google Drive = sumber kebenaran

Render free memakai **disk ephemeral** — isi `server/data/*.json` dan `server/uploads/` **hilang setiap restart/redeploy**. Karena itu metadata album tidak disimpan di disk Render, melainkan di Drive:

```
Satu-Album/                      ← GOOGLE_DRIVE_ROOT_FOLDER_NAME (dibuat otomatis)
├── event-pernikahan-rina-budi/  ← satu folder per album
│   ├── event.json               ← metadata album (nama, film, kunci tamu, jumlah foto)
│   └── photo-<timestamp>.jpg    ← foto asli (kuota Drive Anda)
└── event-reuni-smp-1998/
```

Konsekuensinya:

* Galeri **tetap hidup** setelah Render tidur/restart — server membaca ulang isi Drive saat boot (`[store] sync dari Drive: N acara, M foto` di log).
* Tamu **tidak perlu login**: mereka memakai link dengan kunci album (`?k=...`).
* Anda bisa membuka folder Drive kapan saja; mengunduh file `.jpg` langsung berfungsi tanpa aplikasi ini.

## 2. Prasyarat

1. Akun **Google** (Drive 15 GB gratis). Foto 2048 px ≈ 0,3 MB → sekitar 40.000 foto.
2. Akun **GitHub** + repo berisi proyek ini (Pages gratis hanya untuk repo publik).
3. Akun **Render** (gratis, tanpa kartu kredit).
4. Node.js 20.12+ di komputer lokal (untuk mengambil refresh token; repo ini diuji di Node 26).

## 3. Langkah 1 — Kredensial Google Drive (sekali, di lokal)

Service account **tidak dipakai** (kuota storage-nya 0 byte → upload selalu gagal). Kita memakai OAuth2 akun Google pribadi dengan scope non-sensitive `drive.file`.

1. [Google Cloud Console](https://console.cloud.google.com/) → buat project → **APIs & Services → Library** → aktifkan **Google Drive API**.
2. **OAuth consent screen**: User type *External* → isi nama app & email → pada *Scopes* tambahkan `https://www.googleapis.com/auth/drive.file` → **Publish app → In production**.
   > ⚠️ Selama status masih *Testing*, refresh token otomatis mati dalam **7 hari** (`invalid_grant`) dan upload berhenti. Pastikan statusnya *In production* (tidak perlu verifikasi Google untuk scope ini).
3. **Credentials → Create credentials → OAuth client ID → Desktop app** → salin **Client ID** dan **Client Secret**.
4. Ambil refresh token (sekali saja, butuh browser untuk menyetujui):

```bash
cd server
cp ../.env.example .env      # isi GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET
npm run token                # buka URL yang dicetak → setujui → salin refresh token
```
5. Simpan ketiga nilai (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) — dipakai pada langkah berikutnya.

> 🔐 File `.env` **jangan** di-commit (sudah ada di `.gitignore`). Kredensial ini hanya dipegang panitia; tamu tidak pernah melihatnya.

## 4. Langkah 2 — Deploy server ke Render

1. Push repo ke GitHub (branch `master`).
2. Render → **New → Blueprint** → pilih repo ini → Render membaca `render.yaml`.
   *(Alternatif: **New → Web Service** dengan Root Directory `server`, Build `npm install`, Start `npm start`, Health Check Path `/api/health`.)*
3. Isi **Environment Variables** yang bertanda `sync: false`:

| Variabel | Nilai | Wajib |
| --- | --- | --- |
| `ADMIN_TOKEN` | token acak: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` | ✅ |
| `PUBLIC_BASE_URL` | `https://<service>.onrender.com` | ✅ |
| `ALLOWED_ORIGIN` | origin client, mis. `https://<user>.github.io` (pisah koma untuk beberapa domain) | ✅ |
| `GOOGLE_CLIENT_ID` | dari langkah 3 | ✅ |
| `GOOGLE_CLIENT_SECRET` | dari langkah 3 | ✅ |
| `GOOGLE_REFRESH_TOKEN` | dari langkah 3 | ✅ |
| `GOOGLE_DRIVE_ROOT_FOLDER_NAME` | `Satu-Album` (default) | opsional |

   `PORT` **tidak perlu** diisi — Render menyuntikkannya sendiri.
4. **Deploy**. Verifikasi:

```bash
curl -s https://<service>.onrender.com/api/health | head -40
```

Yang diharapkan:

```json
{ "ok": true, "version": "1.1.0", "storage": { "mode": "drive", ... },
  "drive": { "ready": true, "mode": "oauth" }, "limits": { "maxUploadBytes": 8388608 } }
```

> ℹ️ **Cold start**: instance gratis tidur setelah ±15 menit tanpa trafik; permintaan pertama bisa ~1 menit (server sedang boot + sync Drive). Data tidak hilang. Bila tidak ingin tamu menunggu, kirim `curl` ke `/api/health` beberapa menit sebelum acara, atau naik ke plan berbayar (lihat §8).
>
> ❌ Jika `storage.mode` bernilai `local`, berarti kredensial Drive belum terbaca — foto akan hilang saat restart. Perbaiki env lalu deploy ulang.


## 5. Langkah 3 — Deploy client (SPA) ke GitHub Pages

SPA sudah siap untuk Pages: `client/vite.config.ts` memakai `VITE_BASE`, router memakai `basename` yang sama, dan deep-link `.../events/<slug>` ditangani `client/public/404.html` + skrip pemulihan di `client/index.html`.

1. Repo → **Settings → Pages → Source: GitHub Actions**.
2. Repo → **Settings → Secrets and variables → Actions → Variables → New variable**:

| Variable | Nilai |
| --- | --- |
| `VITE_API_BASE` | `https://<service>.onrender.com` (tanpa garis miring di akhir) |

> 🔁 `VITE_API_BASE` disuntikkan **saat build** (bukan saat runtime). Setelah mengubah variabelnya, jalankan ulang workflow: **Actions → Deploy client ke GitHub Pages → Run workflow** (atau `git commit --allow-empty -m "redeploy"`).

3. Push ke branch `master` (atau jalankan workflow **Deploy client ke GitHub Pages** manual). Workflow `.github/workflows/deploy-client-pages.yml` akan build dengan `VITE_BASE=/<nama-repo>/`.
4. Buka `https://<user>.github.io/<repo>/` → halaman beranda muncul.
5. Kembali ke Render: pastikan `ALLOWED_ORIGIN` memuat `https://<user>.github.io` (origin saja, **tanpa** path repo). Pages selalu mengirim header `Origin`, jadi allowlist harus spesifik.

> 🧩 Kalau memakai **custom domain**, ubah dua hal: `VITE_BASE` menjadi `/` (di workflow) dan `pathSegmentsToKeep` menjadi `0` di `client/public/404.html`.

### Alternatif: Vercel / Cloudflare Pages (repo privat, tanpa Pages publik)

Repo ini tetap punya konfigurasi Vercel (`client/vercel.json` dengan rewrite SPA):

1. Vercel → **Add New → Project** → Root Directory `client`, Framework *Vite*, Build `npm run build`, Output `dist`.
2. Environment Variable: `VITE_API_BASE=https://<service>.onrender.com` (biarkan `VITE_BASE` kosong → `/`).
3. Deploy → tambahkan domain Vercel ke `ALLOWED_ORIGIN` di Render.

**Cloudflare Pages** juga bisa: build command `npm run build`, output `client/dist`, env `VITE_API_BASE` sama, dan tambahkan aturan `/* /index.html 200` bila deep-link ingin aman.


## 6. Verifikasi menyeluruh (checklist sebelum acara)

1. **Kunci masih benar** — `curl -s https://<api>/api/health` → `storage.mode = "drive"`.
2. **Buat album** — buka `https://<client>/create`, isi token admin (kolom pertama), nama acara, film → tekan *Buat album*.
3. **Salin link kamera** dari kotak yang muncul → buka di HP → izinkan kamera → tekan *Potret*.
4. **Cek Drive** — folder `Satu-Album/event-<slug>/` berisi `event.json` + `photo-*.jpg`. Foto bisa dipratinjau langsung di web Drive.
5. **Undo** — tekan *Undo* dalam 10 detik → foto hilang dari galeri dan dari Drive.
6. **Galeri otomatis** — buka link galeri di HP lain; foto baru muncul sendiri (maks ±20 detik).
7. **Uji restart (paling penting)** — Render → *Manual Deploy → Restart*, tunggu boot, lalu buka galeri lagi: **foto masih ada** meski disk server sudah bersih. Ini yang membedakan setup Drive-as-truth dari setup lama.
8. **Uji offline** — di HP aktifkan mode pesawat, potret 2–3 foto → muncul pesan “N foto tersimpan di HP ini”. Matikan mode pesawat → foto terkirim otomatis dalam ≤15 detik.
9. **Uji link salah** — buka `https://<client>/events/<slug>` tanpa `?k=` → muncul pesan “Link album tidak lengkap”.

## 7. Operasional harian

```bash
cd server
npm run sync                 # audit Drive: daftar album, jumlah foto, ukuran, perbaiki event.json
npm run sync -- --json       # keluaran JSON (untuk otomasi/monitoring)
```

`npm run sync` aman dijalankan kapan saja: ia tidak menghapus foto, hanya menambah/memperbarui `event.json` dan merapikan jumlah foto.

| Kebutuhan | Cara |
| --- | --- |
| Mencabut link yang tersebar | `curl -X PATCH -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" -d '{"rotateUploadKey":true}' https://<api>/api/events/<slug>` → kunci lama berhenti bekerja; lihat kunci baru lewat `GET /api/events` |
| Menghapus album | `curl -X DELETE -H "x-admin-token: $ADMIN_TOKEN" https://<api>/api/events/<slug>` (folder dipindah ke Trash Drive — masih bisa dipulihkan ±30 hari) |
| Menghapus satu foto | `curl -X DELETE -H "x-admin-token: $ADMIN_TOKEN" https://<api>/api/events/<slug>/photos/<fileId>` |
| Melihat semua album + kunci | `curl -H "x-admin-token: $ADMIN_TOKEN" https://<api>/api/events` |
| Backup | Salin folder Drive dengan Google Drive for Desktop — server tidak perlu di-backup sama sekali |

### Batas bawaan (bisa diubah via env)

| Batas | Default | Env |
| --- | --- | --- |
| Ukuran 1 foto | 8 MB (klien mengirim ±0,3 MB) | `MAX_UPLOAD_MB` |
| Foto per album | 800 | `MAX_PHOTOS_PER_EVENT` |
| Album baru per IP | 10/jam | `RATE_CREATE_PER_HOUR` |
| Unggahan per IP+album | 300/jam | `RATE_UPLOAD_PER_HOUR` |
| Jendela Undo | 2 menit | `SA_UNDO_WINDOW_MS` |



## 8. Troubleshooting

| Gejala | Penyebab & solusi |
| --- | --- |
| `storage.mode: "local"` | Kredensial Drive kosong. Isi `GOOGLE_*` di Render lalu deploy ulang. Selama mode lokal, foto **hilang saat restart**. |
| Permintaan pertama lambat (±1 menit) | Cold start Render free. Normal. Kirim `/api/health` beberapa menit sebelum acara, atau naikkan plan. |
| `401 invalid-key` di kamera/galeri | Link tanpa `?k=` atau kunci sudah dirotasi. Bagikan link terbaru dari halaman `/create`. |
| Upload gagal `413` | Foto melebihi `MAX_UPLOAD_MB`. Jarang terjadi karena klien mengecilkan ke 2048 px; naikkan batasnya bila perlu. |
| Upload gagal `415` | Isi file bukan JPEG/PNG/WebP (mis. HEIC dari iPhone yang tidak dikonversi) atau klien lama masih mengirim `multipart/form-data`. Muat ulang halaman agar memakai klien terbaru. |
| Upload gagal `429` | Rate limit. Tunggu sesuai header `Retry-After`, atau naikkan `RATE_UPLOAD_PER_HOUR`. |
| `invalid_grant` di log | Refresh token mati (consent masih *Testing*, atau akses dicabut). Ulangi langkah 3.4. |
| `storageQuotaExceeded` | Kuota Drive penuh, atau yang terpakai masih service account. Pastikan `GOOGLE_REFRESH_TOKEN` terisi. |
| CORS error di browser | `ALLOWED_ORIGIN` di Render harus sama persis dengan origin client (origin saja, tanpa `/` di akhir). |
| Foto lama tidak ditemukan (404) | Foto dihapus langsung lewat web Drive. Galeri memperbarui daftar dalam ≤2 menit. |
| Album lama tidak muncul | Folder Drive yang dibuat **manual** tidak terlihat oleh scope `drive.file`. Hanya folder `event-*` buatan app yang dibaca. |

## 9. Dev lokal

```bash
cd server && npm install && npm start      # http://localhost:3001 (membaca server/.env)
cd client && npm install && npm run dev    # http://localhost:5173 (proxy /api → 3001)
cd server && npm test                      # 31 test, tanpa kredensial Drive (pakai fake Drive)
```

Tanpa kredensial Drive, server otomatis berjalan dalam **mode lokal** (foto ke `server/uploads/`) dan mencetak peringatan di log — praktis untuk mengembangkan UI, tetapi jangan dipakai untuk acara sungguhan.

## 10. Kalau nanti butuh lebih cepat (opsi 2)

Arsitektur ini sudah disiapkan untuk pindah tanpa mengubah klien:

- Kontrak unggah sudah berupa **biner mentah** (`POST` + `content-type: image/jpeg`), bukan `multipart` → mudah dipindah ke Cloudflare Worker.
- Semua keputusan penyimpanan terpusat di `server/src/drive-store.js` (Drive) dan diakses lewat fasad `server/store.js`. Pindah host = ganti backend, bukan ganti API.

Pilihan: Cloudflare Workers + D1/R2 (±$5–7/bln, tanpa cold start), atau Render plan berbayar ($7/bln) agar instance tidak tidur — kode tidak perlu diubah sama sekali.
