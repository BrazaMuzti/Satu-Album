# Deploy Satu-Album Online

Dokumentasi ini menjelaskan bagaimana host Satu-Album secara online, bukan hanya di localhost:

| Komponent | Teknologi | Opsion host |
| --- | --- | --- |
| `server/` | Express API (Node ESM) | Render, Railway, Fly.io, VPS |
| `client/` | Vite + React SPA | Vercel, GitHub Pages, Netlify |
| `undangan/` | Site statik | Vercel / GitHub Pages |

> ⚠️ **Wajib HTTPS**: Kamera browser (`getUserMedia`) hanya berkerja pada `localhost` atau **HTTPS**. Semua host di bawah ini memberikan HTTPS secara otomatis.

---

## 1. Server → Render (recommend)

### 1a. Push code ke GitHub

```bash
cd /home/indranm/Proyek/Satu-Album
git add -A
git commit -m "Siap deploy: env produksi, CORS, public URL"
git push origin master
```

### 1b. Buat service di Render

1. Login ke [render.com](https://render.com) → **New** → **Web Service**.
2. Connect repo `Satu-Album`.
3. Setting:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Add **Environment Variables**:

| Variabel | Value contoh |
| --- | --- |
| `NODE_VERSION` | `22` |
| `PORT` | `3001` |
| `PUBLIC_BASE_URL` | `https://<nama-service>.onrender.com` |
| `ALLOWED_ORIGIN` | `https://<proyek-client>.vercel.app` |
| `DATA_DIR` | path volume/disk permanen (opsional, kat bawah) |
| `UPLOAD_DIR` | path volume/disk permanen atau kosong (deafult `uploads`) |
| `GOOGLE_CLIENT_ID` | OAuth client ID (tipe Desktop app) — opsional |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret — opsional |
| `GOOGLE_REFRESH_TOKEN` | hasil `npm run token` — opsional |
| `GOOGLE_DRIVE_ROOT_FOLDER_NAME` | nama folder Drive tujuan (default `Satu-Album`) |

5. **Deploy** → server online di `https://<nama>.onrender.com`.

Verifica: buka `https://<nama>.onrender.com/api/health` → expect `{"ok":true,"drive":false,"driveMode":"none"}` (lokal fallback) atau `"drive":true,"driveMode":"oauth"` bila kredensial Drive sudah diisi.

> 💡 **Blueprint alternatif**: repo ini kasungan `render.yaml` di root. Render **New → Blueprint** akan pre-konfiguri servicani (env vars tetap harus diisi manual).

### ⚠️ Penyimpanan data di paas serverless/service

Render free tier **ephemeral disk** — file `data/*.json` e `uploads/` **reset setiap restart/redeploy**.

- **Opsion A (recommended): Google Drive pakai OAuth2 akun pribadi**
  Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (cara lengkap di bagian 4) → semua foto langsung ke Drive akun Anda, aman dari reset disk. Metadata event/foto di `data/*.json` masih bisa hilang saat redeploy → pakai opsi B bila metadata harus awet.
  Jangan pakai service account untuk kasus ini: kuota storage-nya 0 byte sehingga upload selalu gagal.
- **Opsion B (proyek serius): persistent disk / DB**
  Render **Paid plan** → **Disks** → attach disk (ex: `/data`), lalu set:
  ```
  DATA_DIR=/data
  UPLOAD_DIR=/data/uploads
  ```
  Untuk skala production, migrate `store.js` (JSON) ke PostgreSQL/MongoDB.

---

## 2. Client → Vercel

### 2a. Buat proyek

1. Import the repo to [vercel.com](https://vercel.com) → **Add New → Project**.
2. Pick repo `Satu-Album`.
3. Setting:
   - **Root Directory**: `client`
   - **Framework Preset**: `Vite` (Vercel detect otomatis)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. **Environment Variable**:
   | Variabel | Value |
   | --- | --- |
   | `VITE_API_BASE` | `https://<nama-service>.onrender.com` |
5. **Deploy**.

Client online di `https://<proyek>.vercel.app`. Percurso `/api/...` kini proxsi ke server Render de automatik (VITE_API_BASE), dan `/events/<slug>` deep-link berkerja via `vercel.json` rewrite.

> 💡 `client/vercel.json` di repo ini pre-set rewrite SPA + output directory.

---

## 3. Alternatif host

### Railway (server)
Select repo, root `server`, Platform node, start `npm start`. Railway auto-detect port via `PORT`. Ephemeral disk juga — better use Drive or persistent volume.

### GitHub Pages (client)
Repo ini sudah siap untuk Pages (base path, router basename, dan fallback SPA sudah dikonfigurasi):

1. Settings → Pages → Source: **GitHub Actions** (atau branch `gh-pages` folder `/`).
2. Build dengan base path repo, lalu publish folder `dist/`:
   ```bash
   cd client
   VITE_BASE=/Satu-Album/ npm run build
   ```
   (Kalau memakai Actions: set env `VITE_BASE=/Satu-Album/` pada step build.)
3. Deep-link `.../events/<slug>` ditangani `client/public/404.html` (tersalin ke `dist/404.html`) + skrip pemulihan path di `client/index.html`. `pathSegmentsToKeep` di `404.html` = `1` untuk project site (`/<repo>/`); ubah ke `0` bila pakai custom domain / user page.
4. Set `VITE_API_BASE=https://<nama-service>.onrender.com` saat build, dan di server set `ALLOWED_ORIGIN=https://<user>.github.io` (origin saja, tanpa path). Wildcard `*` tidak berlaku untuk Pages karena Pages selalu mengirim header Origin.

### undangan/ (site statik)
Folder `undangan/` dapat host separato:
- **Vercel**: Add project → Root Directory `undangan` → deploy.
- **GitHub Pages**: push, enable Pages dari folder `/undangan`.

---

## 4. Kredensial Google Drive (opsional) — OAuth2 akun pribadi

> Model kredensial di dokumen ini adalah **OAuth2 akun Google pribadi**. Service account tidak dipakai lagi karena kuota penyimpanan-nya 0 byte (`storageQuotaExceeded`).

1. Google Cloud Console → aktifkan **Google Drive API**.
2. **OAuth consent screen**: User type *External* → tambahkan scope `https://www.googleapis.com/auth/drive.file` (non-sensitive, tanpa proses review) → **Publish app → In production**.
   ⚠️ Selama statusnya masih *Testing*, refresh token akan kedaluwarsa dalam **7 hari** dan upload akan gagal dengan `invalid_grant`.
3. **Credentials → Create credentials → OAuth client ID → Desktop app** → salin **Client ID** & **Client Secret**.
4. Ambil refresh token di local (butuh browser untuk login sekali):
   ```bash
   cd server
   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run token
   ```
   Buka URL yang dicetak → setujui → salin nilai `GOOGLE_REFRESH_TOKEN` yang muncul.
5. Set env di Render: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (+ opsional `GOOGLE_DRIVE_ROOT_FOLDER_NAME`, default `Satu-Album`).
6. Restart service → `/api/health` harus return `{"ok":true,"drive":true,"driveMode":"oauth"}`. Saat upload pertama, server otomatis membuat folder `Satu-Album` di Drive akun Anda.

> ⚠️ Scope `drive.file` hanya melihat file yang **dibuat app ini**. Jangan membuat folder tujuan secara manual di web Drive — server akan membuatnya sendiri (folder manual tidak terlihat oleh app).
>
> ℹ️ URL foto memakai `https://drive.google.com/thumbnail?id=<fileId>&sz=w1600` (`w400` untuk thumbnail). Bisa diubah via `GOOGLE_DRIVE_IMAGE_WIDTH` / `GOOGLE_DRIVE_THUMB_WIDTH`.
>
> 🧯 Kalau upload gagal: cek log server. `invalid_grant` = refresh token mati/consent masih Testing; `storageQuotaExceeded` = yang dipakai masih service account (atau kuota Drive penuh).

---

## Dev lokal (tidak berubah)

```bash
cd server && npm install && npm start   # localhost:3001
cd client && npm install && npm run dev # localhost:5173 (proxy /api → 3001)
```