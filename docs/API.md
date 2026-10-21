# API — Kontrak Endpoint

> Dokumen terkait: [PRD.md](./PRD.md) · [PERMISSIONS.md](./PERMISSIONS.md) · [BLOCKS.md](./BLOCKS.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)

## 1. Konvensi umum

| Aspek | Aturan |
| --- | --- |
| Base | `/api/v1/*` (versi baru). Endpoint lama `/api/health`, `/api/events*` dipertahankan **tanpa perubahan** agar klien kamera tetap jalan |
| Sukses | `{ "ok": true, "data": ..., "meta": {...} }` |
| Error | `{ "ok": false, "error": { "code": "FORBIDDEN", "message": "...", "details": [...] } }` |
| Kode error | `BAD_REQUEST`(400), `UNAUTHORIZED`(401), `FORBIDDEN`(403), `NOT_FOUND`(404), `CONFLICT`(409), `UNPROCESSABLE`(422), `RATE_LIMITED`(429), `INTERNAL`(500) |
| Paginasi | `?limit=` (default 20, maks 100) + `?cursor=`; `meta.next_cursor` |
| Auth | Cookie sesi `sa_session` (HttpOnly, SameSite=Lax) atau header `Authorization: Bearer <token>` |
| Token tamu | Query `?k=<hmac>` (link personal) atau `?to=<nama>` (kompatibilitas lama) |
| Rate limit | Header `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; publik 60/menit/IP, RSVP 10/jam/IP, ucapan 10/jam/IP, guestcam 30/jam/IP |
| Validasi | Semua body JSON divalidasi di lapisan service; multipart memakai `multer` (sudah ada) |
| Idempotensi | `POST checkin` dan `POST rsvp` menerima `client_uuid`; duplikat mengembalikan data yang sudah ada (200) |
| Caching | Payload undangan publik memakai `ETag` + `Cache-Control: public, max-age=60`; data dashboard `no-store` |

## 2. Fase 0 — fondasi & kompatibilitas

| Method · Path | Akses | Fungsi |
| --- | --- | --- |
| `GET /api/health` | publik | `{ ok, db:{ready,migrations}, drive:{configured}, themes:{count} }` (menambah field, tidak menghapus yang lama) |
| `POST /api/events` | publik | Buat acara kamera (perilaku lama: `{name, type, preset, revealAt}`) |
| `GET /api/events/:slug` | publik | Detail acara kamera (perilaku lama) |
| `POST /api/events/:slug/photos` | publik | Unggah foto kamera (multipart, perilaku lama) |
| `GET /api/events/:slug/photos` | publik | Daftar foto kamera (perilaku lama) |

## 3. Fase 1 — undangan publik (guest)

| Method · Path | Akses | Fungsi |
| --- | --- | --- |
| `GET /u/:slug` | publik | Kirim `u.html` + `og:*` + `window.__SA__ = { slug, apiBase, token, preview, themeId }` |
| `GET /api/v1/invitations/:slug` | publik | Payload penuh undangan (§5 [BLOCKS.md](./BLOCKS.md)) |
| `GET /api/v1/invitations/:slug/guest?k=` | token tamu | Data personal tamu + catat `pageviews` (increment `guests.opened_count`) |
| `POST /api/v1/invitations/:slug/rsvp` | publik | Body: `{ name, attendance, pax, message?, honeypot?, client_uuid?, k? }` → 201 |
| `GET /api/v1/invitations/:slug/guestbook?limit=&cursor=` | publik | Ucapan yang disetujui |
| `POST /api/v1/invitations/:slug/guestbook` | publik | Body: `{ name, message, attendance?, honeypot? }` → 201 |
| `POST /api/v1/invitations/:slug/guestcam` | publik | Multipart foto tamu (`file`, `caption?`, `k?`) |
| `GET /api/v1/invitations/:slug/ics` | publik | Berkas `.ics` untuk agenda |
| `GET /api/v1/themes` | publik | Katalog tema aktif (metadata + token) untuk pratinjau |

Contoh respons RSVP:

```json
{ "ok": true,
  "data": { "id": "rS1vQ2kP", "name": "Bapak Hendra", "attendance": "hadir", "pax": 2,
            "created_at": "2026-10-22T03:15:00.000Z" } }
```

Contoh error validasi:

```json
{ "ok": false,
  "error": { "code": "UNPROCESSABLE", "message": "Data RSVP tidak valid",
             "details": [{ "field": "pax", "issue": "harus 1–10" }] } }
```


## 4. Fase 3–4 — dashboard pengantin, tim, tamu, konten

| Method · Path | Izin | Fungsi |
| --- | --- | --- |
| `POST /api/v1/auth/login` | – | Minta magic-link (`{ email }`) |
| `POST /api/v1/auth/verify` | – | Verifikasi token (`{ token }`) → set cookie sesi |
| `GET /api/v1/auth/me` | login | Profil + daftar acara + izin efektif |
| `POST /api/v1/auth/logout` | login | Cabut sesi |
| `GET /api/v1/me/events` | login | Acara yang dimiliki/diikuti (termasuk role) |
| `POST /api/v1/me/events` | login | Buat acara (`{ title, kind, slug? }`) |
| `GET /api/v1/events/:slug` | `event.read` | Detail lengkap acara (dashboard) |
| `PATCH /api/v1/events/:slug` | `event.update` | Ubah data acara, mempelai, quote, settings, SEO |
| `POST /api/v1/events/:slug/publish` | `event.publish` | Publish / ubah status |
| `DELETE /api/v1/events/:slug` | `event.delete` | Arsipkan (soft delete) |
| `PATCH /api/v1/events/:slug/theme` | `theme.apply` | Ganti tema |
| `PATCH /api/v1/events/:slug/theme/tokens` | `theme.customize` | Override token (`theme_overrides`) |
| `GET /api/v1/events/:slug/sections` | `section.read` | Daftar blok + config |
| `PATCH /api/v1/events/:slug/sections/:key` | `section.reorder`/`content.update` | Ubah config blok |
| `PUT /api/v1/events/:slug/sections/order` | `section.reorder` | Simpan urutan & aktif/nonaktif |
| `GET|POST|PATCH|DELETE /api/v1/events/:slug/agenda[/:id]` | `content.update` | Agenda (akad/resepsi) |
| `GET|POST|PATCH|DELETE /api/v1/events/:slug/story[/:id]` | `content.update` | Love story |
| `GET|POST|PATCH|DELETE /api/v1/events/:slug/gift[/:id]` | `gift.read`/`gift.update` | Amplop & kado fisik |
| `GET|POST|PATCH|DELETE /api/v1/events/:slug/guests[/:id]` | `guest.*` | CRUD tamu (`?view=minimal` untuk vendor) |
| `POST /api/v1/events/:slug/guests/import` | `guest.import` | Impor CSV/XLSX (multipart) → laporan per baris |
| `GET /api/v1/events/:slug/guests/export?format=csv` | `guest.export` | Ekspor (dicatat ke audit) |
| `GET /api/v1/events/:slug/guests/:id/link` | `guest.link.read` | Link personal `/u/<slug>?k=<token>` |
| `POST /api/v1/events/:slug/guests/links/bulk` | `guest.link.read` | Buat link massal (hasil CSV) |
| `GET /api/v1/events/:slug/guests/groups` · `POST` · `PATCH /:id` | `guest.*` | Grup tamu |
| `GET|POST|PATCH|DELETE /api/v1/events/:slug/members[/:id]` | `member.*` | Tim & peran |
| `POST /api/v1/events/:slug/members/accept` | – | Terima undangan via `invite_token` |
| `GET|POST /api/v1/events/:slug/media` · `PATCH /:id/approve` · `DELETE /:id` | `media.*` | Galeri & moderasi |
| `GET /api/v1/events/:slug/guestbook?status=all` | `guestbook.read` | Daftar ucapan termasuk yang disembunyikan |
| `PATCH /api/v1/events/:slug/guestbook/:id` | `guestbook.moderate`/`reply` | Setujui / sembunyikan / pin / balas |
| `DELETE /api/v1/events/:slug/guestbook/:id` | `guestbook.delete` | Hapus ucapan |
| `GET /api/v1/events/:slug/rsvps` · `PATCH /:id` | `rsvp.read`/`rsvp.update` | Daftar & perubahan status RSVP |
| `GET /api/v1/events/:slug/audit` | `audit.read` | Riwayat aksi sensitif |

## 5. Fase 5–8 — komunikasi, analitik, check-in, komersial

| Method · Path | Izin | Fungsi |
| --- | --- | --- |
| `GET|POST|PATCH /api/v1/events/:slug/templates[/:id]` | `template.manage` | Template pesan WA/email |
| `POST /api/v1/events/:slug/blast` | `blast.create` | Buat job blast (filter + template) |
| `POST /api/v1/events/:slug/blast/:id/queue` | `blast.send` | Tandai siap kirim |
| `GET /api/v1/events/:slug/blast/:id/messages` | `blast.read` | Daftar pesan + tautan `wa.me` |
| `PATCH /api/v1/events/:slug/blast/:id/messages/:mid` | `blast.send` | Tandai terkirim (klik manual) |
| `POST /api/v1/events/:slug/blast/:id/cancel` | `blast.cancel` | Batalkan |
| `GET /api/v1/events/:slug/stats?range=30d` | `stats.read` | Ringkasan + seri harian |
| `GET /api/v1/events/:slug/stats/export.csv` | `stats.export` | Ekspor statistik |
| `POST /api/v1/events/:slug/checkin` | `checkin.scan` | `{ guest_id?, token?, client_uuid, pax, method }` |
| `DELETE /api/v1/events/:slug/checkin/:id` | `checkin.undo` | Batalkan check-in |
| `GET /api/v1/events/:slug/checkins` | `checkin.read` | Daftar kehadiran |
| `GET|POST /api/v1/events/:slug/guests/:id/ticket` | `guest.qr.generate` | QR e-ticket (PNG/PDF) |
| `GET|POST|PATCH|DELETE /api/v1/events/:slug/tables[/:id]` | `table.*` | Meja & kapasitas |
| `PATCH /api/v1/events/:slug/guests/:id/seat` | `seat.assign` | Assign tamu ke meja |
| `GET /api/v1/plans` | publik | Daftar paket |
| `POST /api/v1/events/:slug/orders` | `billing.update` | Buat order upgrade |
| `POST /api/v1/payments/webhook` | (tanda tangan provider) | Callback pembayaran |
| `GET /api/v1/events/:slug/billing` | `billing.read` | Riwayat order & masa aktif |
| `GET|POST|PATCH|DELETE /api/v1/admin/themes[/:id]` | `platform.themes.manage` | Katalog tema platform |
| `GET /api/v1/admin/events` · `POST /:id/suspend` | `platform.events.read` | Pengawasan acara |
| `GET|PATCH /api/v1/admin/users[/:id]` | `platform.users.manage` | Pengguna |
| `GET /api/v1/admin/audit` | `platform.audit.read` | Audit lintas tenant |
| `POST /api/v1/admin/events/:slug/impersonate` | `event.impersonate` | Akses sebagai pengantin (wajib `reason`) |

## 6. Contoh request penting

**Check-in offline-first (idempoten):**

```http
POST /api/v1/events/ani-budi/checkin
{ "client_uuid": "5f1c...9a", "token": "<token tamu>", "pax": 2, "method": "qr" }
```

```json
{ "ok": true, "data": { "id": "cK9d...", "guest": { "id": "g1...", "name": "Bapak Hendra" },
  "pax": 2, "method": "qr", "created_at": "..." }, "meta": { "already_checked_in": false } }
```

**Impor tamu (respons laporan):**

```json
{ "ok": true,
  "data": { "imported": 148, "skipped": 2, "errors": [
    { "row": 17, "issue": "nama kosong" },
    { "row": 93, "issue": "nomor HP duplikat dengan baris 42 (peringatan)" } ] } }
```


