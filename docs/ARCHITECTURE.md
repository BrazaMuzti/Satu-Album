# ARCHITECTURE — Satu-Album Invitation Platform

> Dokumen terkait: [PRD.md](./PRD.md) · [DB-SCHEMA.sql](./DB-SCHEMA.sql) · [PERMISSIONS.md](./PERMISSIONS.md) · [BLOCKS.md](./BLOCKS.md) · [THEMES.md](./THEMES.md) · [API.md](./API.md) · [ROADMAP.md](./ROADMAP.md)

## 1. Prinsip arsitektur

| # | Prinsip | Konsekuensi desain |
| --- | --- | --- |
| P1 | **Original, bukan kloning** | Tidak ada pengambilan kode/aset kompetitor. Hanya pola fitur yang disetarakan. |
| P2 | Satu sumber render undangan | Guest runtime `undangan/` satu-satunya renderer; dashboard mem-preview via **iframe** ke `u.html` |
| P3 | Guest runtime tanpa framework | Vanilla ES modules, nol dependensi, anggaran < 100 KB gzip |
| P4 | Dashboard = satu SPA | `client/` melayani couple/panitia/admin via lazy route; bukan tiga aplikasi |
| P5 | Tamu tidak pernah login | Personalisasi lewat token HMAC di URL |
| P6 | Otorisasi terpusat | Semua cek izin lewat satu peta permission (fail-closed) |
| P7 | Data transaksional harus persisten | RSVP/ucapan/check-in tidak boleh hilang → backup berkala (Plan A) atau Postgres (Plan B) |
| P8 | Ramah kuota gratis | Foto ke Google Drive (sudah ada), DB kecil, JS tipis |

## 2. Peta surface & alur

```
                 ┌────────────────────────────┐
   Tamu  ───────▶│ undangan/u.html  (vanilla) │◀── iframe preview ──┐
   (tanpa login) │ core/* + blocks/* + tema   │                     │
                 └──────────────┬─────────────┘                     │
                                │ fetch /api/v1/invitations/:slug    │
                 ┌──────────────▼─────────────┐   ┌──────────────────┴───────────┐
   Pengantin ───▶│ server/ Express ESM        │◀──│ client/ React SPA (dashboard)│◀── Panitia / Admin
   Panitia       │  routes · services · repo  │   │  /login /app /app/events/*   │
   Admin         │  node:sqlite (Plan A)      │   │  /admin/*                    │
                 └──────┬───────────┬─────────┘   └──────────────────────────────┘
                        │           │
             ┌──────────▼───┐  ┌────▼──────────────────┐
             │ data/*.db    │  │ Google Drive (foto)   │
             │ (+backup ────┼─▶│ Satu-Album/_backups/  │
             └──────────────┘  └───────────────────────┘
```

**Alur render undangan:** request `GET /u/:slug` → Express membaca `events` + tema + section → menyuntik `<meta og:*>` + `window.__SA__ = {slug, apiBase, token, preview}` → mengirim `u.html` → `core/app.js` mengambil payload JSON → merender blok sesuai `event_sections` (urutan & `enabled`) → blok di-`import()` dinamis hanya bila aktif.

## 3. Keputusan arsitektur (ADR)

| ADR | Keputusan | Alternatif ditolak | Alasan |
| --- | --- | --- | --- |
| A1 | Guest = statik no-build | Next.js/SSR React | Bundle ~10× lebih kecil; bisa di-host di mana saja |
| A2 | DB = `node:sqlite` + backup Drive | Postgres Neon | Nol dependensi baru, dev instan, cukup 1 instance; swap mudah karena lapisan repo |
| A3 | Dashboard = 1 SPA + lazy route | 3 app terpisah | Satu build, satu auth, satu design system |
| A4 | Preview = iframe ke `u.html` | Render ulang di React | Satu sumber kebenaran visual, tidak ada drift tema |
| A5 | OG meta dirender server | GitHub Pages statik | GH Pages tak bisa render meta per tamu ("Dear Bapak X") |
| A6 | Token tamu = HMAC (`node:crypto`) | id tamu mentah | Tidak bisa ditebak, tidak membocorkan ID |
| A7 | Izin terpusat di kode + override DB | cek role tersebar di route | Mudah diuji tabel-driven & diaudit |
| A8 | `?to=` tetap didukung | hapus langsung | Kompatibilitas link undangan yang sudah dibagikan |
| A9 | GAS dipertahankan opsional | buang | Rilis bertahap tanpa downtime |
| A10 | Blast WA bertahap (`wa.me`) | API tidak resmi | Risiko blokir nomor & pelanggaran ToS WhatsApp |
| A11 | Migrasi SQL bernomor + `schema_migrations` | sinkron otomatis ORM | Idempoten, mudah diaudit, tanpa dependensi ORM |
| A12 | Backup DB ke Drive memakai kredensial yang sudah ada | layanan backup pihak ketiga | Nol biaya, satu kredensial |

## 4. Lapisan server

```
server/
├── index.js                 # tipis: createApp() + listen()
├── src/
│   ├── config.js            # baca & validasi env sekali (fail-fast)
│   ├── lib/                 # slug, guestToken (HMAC), validate, permissions, i18n, dates
│   ├── middleware/          # security headers, cors, rateLimit, auth, requirePermission, error
│   ├── db/
│   │   ├── driver.js        # DatabaseSync + PRAGMA WAL + foreign_keys
│   │   ├── migrate.js       # runner migrasi (transaksional)
│   │   ├── backup.js        # upload/restore .db ke Drive
│   │   └── repo/            # events, guests, rsvp, guestbook, media, themes, sections, members
│   ├── services/            # logika domain: invitation, guestImport, blast, checkin, stats
│   └── routes/              # health, events(legacy), photos(legacy), invitations, rsvp,
│                            # guestbook, auth, guests, members, media, checkin, stats, admin
├── migrations/              # 0001_init.sql, 0002_seed.sql, ...
└── scripts/                 # seed-demo, import-json, check-size, get-google-refresh-token
```

Aturan: **route tipis** (validasi + panggil service), **service berisi logika**, **repo satu-satunya yang menyentuh SQL**. Semua akses data `async` agar penggantian ke Postgres hanya menyentuh `db/repo/*` + `db/driver.js`.

## 5. Keputusan yang masih terbuka

| Kode | Pertanyaan | Rekomendasi |
| --- | --- | --- |
| R1 | Penyimpanan: SQLite+backup Drive (Plan A) atau Postgres/Neon (Plan B) | **Plan A** untuk MVP; jalur Plan B disiapkan di lapisan repo |
| R2 | Hosting `/u/:slug` | Ikut server Express (wajib untuk OG meta) |
| R3 | Blok `guestcam` di undangan | Fase 2 (setelah editor stabil) |
| R4 | Tema premium & peran `vendor` di MVP | Skema disiapkan, gerbang diaktifkan Fase 8 |

## 6. Topologi deployment

```
                 Render (web service)                    Vercel / static
        ┌──────────────────────────────────────┐      ┌────────────────────┐
        │ server/ Express ESM                  │      │ client/ dist       │
        │  /api/*  /api/v1/*                   │◀────▶│ dashboard SPA      │
        │  /u/:slug  (HTML + OG meta)          │ CORS │ (ALLOWED_ORIGIN)   │
        │  /uploads/* (fallback foto lokal)    │      └────────────────────┘
        │  data/undangan.db  (SQLite, WAL)     │
        └───────┬──────────────────┬───────────┘
                │                  │ backup tiap 15 menit / saat shutdown
      Google Drive (foto)   Google Drive (backup/undangan-<timestamp>.db)
```

- **Disk Render bersifat ephemeral** → `data/undangan.db` dipulihkan dari backup Drive saat boot (`db/backup.js: restoreIfEmpty()`).
- **Kompatibilitas**: `undangan/` tetap dapat di-host statis (GitHub Pages) untuk mode *tanpa* OG personalisasi; mode penuh memakai `GET /u/:slug` dari Express.
- **Rencana Plan B (Postgres)**: hanya `db/driver.js` + `db/repo/*` yang berubah; `services/` dan `routes/` tidak.

## 7. Keamanan

| Area | Keputusan |
| --- | --- |
| Auth | Sesi cookie `HttpOnly` + `SameSite=Lax`, token disimpan sebagai hash (`sessions.token_hash`), magic-link sekali pakai 15 menit |
| Otorisasi | Satu peta permission, middleware fail-closed, uji tabel-driven (lihat [PERMISSIONS.md](./PERMISSIONS.md)) |
| Token tamu | HMAC-SHA256(`guest.id` + `event.id`, `SA_GUEST_SECRET`) → `?k=`; tidak dapat ditebak & tidak membocorkan ID |
| XSS | Render `textContent`; `custom_html` disanitasi whitelist; CSP dasar (`default-src 'self'`, `img-src` Google Drive) |
| CSRF | Cookie `SameSite=Lax` + header `Origin` diperiksa pada semua permintaan pengubah data |
| Rate limit | Tabel `rate_limits` (tanpa dependensi baru) untuk endpoint publik |
| Unggahan | Whitelist MIME (`image/*`, `video/mp4`), batas ukuran, nama file di-*slug* + nanoid |
| Privasi | `ip_hash` (bukan IP mentah), payload publik tanpa kontak tamu, endpoint hapus data tamu |
| Rahasia | Semua kredensial hanya di `server/.env` (kini benar-benar dibaca via `--env-file-if-exists`) |

## 8. Observability & operasional

- **Log**: satu baris JSON per request → `{ ts, method, path, status, ms, eventId, userId }`; tanpa mencatat body.
- **Health**: `GET /api/health` → `{ ok, db:{ ready, migrations }, drive:{ configured }, themes:{ count }, version }`.
- **Backup**: `db/backup.js` mengunggah `undangan.db` (via `VACUUM INTO` untuk snapshot konsisten) ke folder Drive `Satu-Album/_backups/`, menahan 14 berkas terakhir.
- **Restore drill**: hapus DB → restart → verifikasi jumlah `events`, `guests`, `rsvps` sama seperti sebelum drill.
- **Tanpa dependensi baru**: observability memakai `console` + tabel `audit_logs`; tidak menambah APM pada fase awal.

## 9. Variabel lingkungan

| Variabel | Wajib | Fungsi |
| --- | --- | --- |
| `PORT`, `HOST`, `PUBLIC_BASE_URL`, `ALLOWED_ORIGIN` | tidak | sudah ada |
| `DATA_DIR`, `UPLOAD_DIR` | tidak | sudah ada |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_NAME` | tidak | Drive (foto + backup) |
| `SA_DB_PATH` | tidak | lokasi berkas SQLite (default `data/undangan.db`) |
| `SA_GUEST_SECRET` | **ya (produksi)** | kunci HMAC token tamu |
| `SA_SESSION_DAYS` | tidak | masa berlaku sesi (default 30) |
| `SA_BACKUP_INTERVAL_MIN` | tidak | interval backup (default 15; `0` = nonaktif) |
| `SA_BACKUP_KEEP` | tidak | jumlah berkas backup yang ditahan (default 14) |

## 10. Dampak pada kode yang sudah ada

| Berkas | Perubahan | Jaminan kompatibilitas |
| --- | --- | --- |
| `server/index.js` | Dipecah menjadi `createApp()` + `listen()` | Rute & respons sama; hanya struktur berkas berubah |
| `server/store.js` | Menjadi *shim* di atas repo SQLite | Tanda tangan fungsi (`listEvents`, `createEvent`, `addPhoto`, …) dipertahankan |
| `server/drive.js` | **Tidak diubah**; ditambah pemakaian oleh `db/backup.js` | Fungsi `uploadBuffer`, `getPublicUrl` tetap |
| `server/package.json` | Skrip memakai `node --env-file-if-exists=.env`; tambah `migrate`, `seed`, `import-json`, `test`, `check-size` | `npm start` tetap perintah utama |
| `client/src/api.ts` | Ditambah fungsi API v1; fungsi lama tidak dihapus | Halaman kamera (`/create`, `/events/:slug/camera`) tetap berfungsi |
| `client/vite.config.ts` | Tidak berubah (proxy `/api` + `/uploads` sudah cukup) | – |
| `undangan/undangan.html` | Dipertahankan sebagai arsip; render baru memakai `u.html` | Link lama tetap dapat dibuka |
| `undangan/js/main.js` | GAS dipertahankan sebagai opsi (flag `USE_GAS`) | Buku tamu lama tetap jalan sampai dinyatakan pensiun |

Kontrak data lintas surface: **`server/data/*.json` tidak diubah formatnya** sampai `scripts/import-json.mjs` dijalankan dan diverifikasi (lihat Lampiran B [DB-SCHEMA.sql](./DB-SCHEMA.sql)).

