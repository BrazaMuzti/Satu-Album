# ROADMAP — Fase Implementasi & Definition of Done

> Dokumen terkait: [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [DB-SCHEMA.sql](./DB-SCHEMA.sql) · [PERMISSIONS.md](./PERMISSIONS.md) · [BLOCKS.md](./BLOCKS.md) · [THEMES.md](./THEMES.md) · [API.md](./API.md)

## 1. Urutan fase

| Fase | Nama | Deliverable utama | Bergantung pada | Estimasi (jam kerja) |
| --- | --- | --- | --- | --- |
| 0 | Fondasi data & server | `src/config.js`, `db/driver.js`, `db/migrate.js`, repo layer, `0001_init.sql` + `0002_seed.sql`, impor JSON lama, shim `store.js`, perbaikan pembacaan `.env` | – | 1–2 |
| 1 | Guest engine & 2 tema MVP | `u.html`, `core/*`, 13 blok MVP, tema `klasik-elegan` + `rustic-sage`, route `/u/:slug` + OG, API RSVP/ucapan/guestcam | 0 | 3–5 |
| 2 | Editor dashboard (pengantin) | Route SPA, editor blok & urutan, pratinjau iframe, manajer media, moderasi ucapan, editor token tema | 1 | 5–7 |
| 3 | Auth, tim & manajer tamu | Login magic-link, RBAC, undang anggota, CRUD/impor/ekspor tamu, link personal massal | 2 | 4–6 |
| 4 | Konten lanjutan & audit | Blok 14–19, config per preset, `audit_logs`, transfer kepemilikan | 3 | 4–6 |
| 5 | Komunikasi & template pesan | Template WA/email, job blast (`wa.me`), pengingat H-1, admin katalog tema | 4 | 4–5 |
| 6 | Analitik & i18n | `stats_daily`, dashboard statistik, ekspor CSV, bahasa kedua | 3 | 3–4 |
| 7 | Check-in & meja (PWA) | QR e-ticket, pemindai offline-first, undo, meja & kursi | 3 | 5–7 |
| 8 | Paket, pembayaran, blast resmi | `plans/orders/payments`, gerbang tema premium, WhatsApp Cloud API (opsional) | 5 | 6–8 |
| 9 | Domain & subdomain | `<slug>.satualbum.id`, custom domain, status SSL | 8 | 3–4 |
| 10 | Hardening & skala | Uji beban, observability, kebijakan privasi UU PDP, jalur migrasi ke Postgres | 7 | 5–8 |

## 2. Definition of Done per fase

### Fase 0 — Fondasi data & server
- [ ] `npm run migrate` idempoten: dijalankan 2× tidak error, `schema_migrations` mencatat `0001_init`, `0002_seed`.
- [ ] `npm run import-json` memindahkan `server/data/events.json` + `photos.json` ke tabel tanpa kehilangan baris; menulis `import_report.json`.
- [ ] `server/package.json`: skrip memakai `node --env-file-if-exists=.env` sehingga `server/.env` **benar-benar terbaca** (bug saat ini: `dotenv` tidak ada & tidak ada `--env-file`).
- [ ] Endpoint lama (`/api/health`, `/api/events*`, `/api/events/:slug/photos`) berperilaku identik (uji manual + uji otomatis).
- [ ] Simulasi restore: salin `data/*.db` ke `/tmp`, hapus DB aktif, restore, `GET /api/health` tetap `ok`.
- [ ] Tidak ada dependensi baru di `server/package.json` (kecuali `dotenv` bila tidak memakai `--env-file-if-exists`).

### Fase 1 — Guest engine & 2 tema
- [ ] `GET /u/ani-budi` mengembalikan HTML dengan `og:title` berisi "Ani & Budi", `og:image`, canonical, dan `window.__SA__`.
- [ ] 13 blok MVP merender data dari DB (tidak ada lagi teks "Ani & Budi" hardcode di HTML).
- [ ] `?k=` menampilkan nama tamu di cover & menyegarkan `guests.opened_at`; `?to=` tetap bekerja.
- [ ] RSVP & ucapan tersimpan ke DB (bukan GAS), aman dari XSS (uji payload `<script>`), rate limit menolak 429 saat melebihi batas.
- [ ] Dua tema dapat ditukar lewat query/`events.theme_id` tanpa mengubah konten.
- [ ] Anggaran: HTML+CSS+JS inti < 100 KB gzip, `scripts/check-size.mjs` lulus.
- [ ] `prefers-reduced-motion` menonaktifkan animasi; semua kontrol dapat diakses keyboard.

### Fase 2 — Editor dashboard
- [ ] Pengantin dapat menyelesaikan undangan siap-bagikan **tanpa bantuan** (dijalankan sebagai skenario ujung-ke-ujung).
- [ ] Mengubah urutan blok & config tersimpan di `event_sections` dan tampil di pratinjau iframe.
- [ ] Moderasi ucapan (setujui/sembunyikan/hapus) bekerja; foto guestcam bisa disetujui sebelum tampil.
- [ ] Unggahan tersimpan ke Drive bila dikonfigurasi, jika tidak ke `server/uploads/` (perilaku `drive.js` sekarang).

### Fase 3 — Auth, tim & tamu
- [ ] Login magic-link: token sekali pakai, masa berlaku 15 menit, sesi HttpOnly 30 hari.
- [ ] Uji tabel-driven matriks izin (§6 [PERMISSIONS.md](./PERMISSIONS.md)) lulus untuk semua baris.
- [ ] Impor CSV/XLSX 500 baris < 5 detik dengan laporan error per baris.
- [ ] Undangan anggota tim: `pending` → `accepted`; vendor kedaluwarsa otomatis ditolak 403.


### Fase 4 — Konten lanjutan & audit
- [ ] Blok 14–19 (`story`, `video`, `guestcam`, `dresscode`, `protokol`, `gift_address`) dapat diatur dari dashboard.
- [ ] Semua blok memiliki skema config tervalidasi; config tidak valid ditolak 422 dengan pesan per field.
- [ ] Aksi sensitif (hapus, ekspor, ubah izin, impersonate) tercatat di `audit_logs` dan tampil di dashboard.
- [ ] Transfer kepemilikan acara memerlukan konfirmasi dua langkah dan tercatat di audit.

### Fase 5 — Komunikasi & template pesan
- [ ] Mengirim 50 undangan tercatat di `blast_messages` dengan status yang berubah saat ditandai terkirim.
- [ ] Template mendukung variabel `{nama}`, `{sapaan}`, `{link}`, `{tanggal}`; pratinjau sebelum kirim.
- [ ] Pengingat H-1 hanya menjangkau tamu berstatus `pending`/`ragu`.
- [ ] Admin dapat menambah tema tanpa deploy ulang (baris `themes` + berkas tema).

### Fase 6 — Analitik & i18n
- [ ] Angka dashboard cocok dengan data mentah (`v_event_stats`) — diuji dengan data fixture.
- [ ] Ekspor CSV memuat seri harian dari `stats_daily`.
- [ ] Bahasa kedua (`en`) dapat dipilih per acara; teks UI guest dari `core/i18n.js`.

### Fase 7 — Check-in & meja (PWA)
- [ ] 100 scan dilakukan offline lalu disinkronkan: tidak ada duplikat (`client_uuid`) dan tidak ada data hilang.
- [ ] Check-in dapat dibatalkan (undo) dengan izin `checkin.undo`.
- [ ] Assignment meja tampil di e-ticket tamu dan di daftar panitia.

### Fase 8 — Paket, pembayaran, blast resmi
- [ ] Order uji sandbox berhasil → `events.plan` & `active_until` ter-update otomatis.
- [ ] Tema premium terkunci pada paket `free` (uji izin 403 + pesan upgrade).
- [ ] Kebijakan privasi & halaman hak subjek data tersedia.

### Fase 9–10 — Domain & hardening
- [ ] Dua acara berjalan di `<slug>.satualbum.id` dengan status SSL terpantau.
- [ ] Uji beban ringan (100 permintaan undangan paralel) tanpa error 5xx.
- [ ] Runbook: backup, restore, rotasi kredensial, prosedur naik ke Postgres.

## 3. Strategi pengujian (tanpa dependensi baru)

| Jenis | Alat | Cakupan |
| --- | --- | --- |
| Unit | `node:test` bawaan | `lib/*` (slug, HMAC token, validasi, permissions) |
| Integrasi | `node:test` + `fetch` ke server ephemeral (`createApp()` → `listen(0)`) | Semua rute API |
| Migrasi & data | `node:test` | Migrasi dari DB kosong, migrasi berulang, impor JSON idempoten |
| Matriks izin | `node:test` tabel-driven | Semua baris [PERMISSIONS.md §6](./PERMISSIONS.md) |
| Anggaran bundle | `scripts/check-size.mjs` | Total gzip CSS+JS guest < 100 KB |
| A11y & performa | Manual (axe, Lighthouse) | Halaman undangan & dashboard |

## 4. Struktur file target

```
Satu-Album/
├── docs/                      ← dokumen ini
├── undangan/                  u.html · index.html
│   ├── core/                  config.js · api.js · dom.js · theme.js · i18n.js · app.js
│   ├── blocks/                27 blok (cover … custom_html)
│   ├── themes/                klasik-elegan/ · rustic-sage/ (+ roadmap 18)
│   ├── css/                   base.css (+ style/dashboard/invitation.css lama)
│   ├── js/                    main.js · invitation.js (kompatibilitas)
│   └── assets/                img/ (baru, ornamen & foto contoh) · music/
├── client/                    SPA dashboard
│   └── src/routes/            Login · Dashboard · EventEditor · Guests · Checkin · Stats · Admin
└── server/
    ├── index.js
    ├── src/{config.js, lib/, middleware/, db/{driver,migrate,backup,repo/},
    │        services/, routes/}
    ├── migrations/            0001_init.sql … 0006_stats.sql
    └── scripts/               seed-demo.mjs · import-json.mjs · check-size.mjs
```

## 5. Prasyarat sebelum Fase 0 dimulai

1. Konfirmasi keputusan R1–R4 pada [PRD.md §3](./PRD.md) (penyimpanan, hosting guest, blok guestcam, tema premium/vendor).
2. Cadangkan `server/data/*.json` dan `server/credentials/*` sebelum migrasi pertama (data saat ini kosong `[]`, tetap dilakukan sebagai prosedur baku).
3. Pastikan `server/.env` berisi `PORT`, `GOOGLE_*`, `PUBLIC_BASE_URL`, dan variabel baru `SA_GUEST_SECRET` (kunci HMAC token tamu) + `SA_DB_PATH`.

## 6. Langkah berikutnya (Fase 0)

1. Buat `server/src/config.js` (baca env sekali, fail-fast) + perbaiki skrip agar memakai `node --env-file-if-exists=.env`.
2. Buat `server/src/db/driver.js` (`node:sqlite`, PRAGMA WAL, `foreign_keys=ON`) dan `migrate.js`.
3. Pindahkan `docs/DB-SCHEMA.sql` → `server/migrations/0001_init.sql`, tulis `0002_seed.sql`.
4. Tulis repo layer + shim `store.js` agar endpoint lama tetap identik, lalu `scripts/import-json.mjs`.
5. Verifikasi: `GET /api/health` hijau, uji kompatibilitas klien kamera, simulasi restore backup.


