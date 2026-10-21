# PRD — Satu-Album Invitation Platform

> Status: **draft v1.0** — spesifikasi produk disetujui sebelum implementasi.
> Dokumen terkait: [ARCHITECTURE.md](./ARCHITECTURE.md) · [DB-SCHEMA.sql](./DB-SCHEMA.sql) · [PERMISSIONS.md](./PERMISSIONS.md) · [BLOCKS.md](./BLOCKS.md) · [THEMES.md](./THEMES.md) · [API.md](./API.md) · [ROADMAP.md](./ROADMAP.md)

---

## 1. Ringkasan produk

**Visi.** Platform undangan digital multi-tenant untuk pasar Indonesia: pengantin membuat undangan, panitia mengelola tamu & check-in pada hari-H, admin platform mengelola katalog tema dan paket. Fitur kamera analog (`client/`, sudah ada) menjadi pembeda: tamu memotret langsung dari halaman undangan.

**Masalah yang dipecahkan.** Undangan cetak boros biaya dan tidak terukur; solusi undangan digital yang ada (a) mahal/tidak transparan, (b) tidak punya mode panitia untuk check-in, (c) tidak ada galeri foto tamu, (d) tidak bisa dikustomisasi. Satu-Album menggabungkan undangan + RSVP + buku tamu + amplop + check-in QR + galeri kamera analog dalam satu link.

### 1.1 Kondisi repo saat ini (hasil audit nyata)

| Area | Kondisi | Implikasi spec |
| --- | --- | --- |
| `undangan/` | Statik, konten **hardcoded** "Ani & Budi"; section: `#coverView`, `#pembuka`, `#countdown`, `#detail` (akad/resepsi + `.ics`), `#galeri`, `#amplop`, `#rsvp`, `#ucapan`, closing, `#musicBtn`/`#bgm` | Perlu data-driven + blok baru (`couple`, `story`, `maps`, `video`, `live`, `dresscode`, `protokol`, `e_ticket`, `faq`, `registry`) |
| RSVP & buku tamu | Via Google Apps Script (`undangan/js/main.js`), pola POST `text/plain` bebas preflight, render aman via `textContent` | Pola anti-XSS dipertahankan; GAS jadi opsional, backend utama API sendiri |
| `server/` | Express 4 ESM, `store.js` (JSON), `drive.js` (OAuth2 `drive.file`), endpoint `/api/health`, `/api/events*` | Data JSON → SQLite; endpoint lama **tidak berubah** (kompatibilitas kamera) |
| `client/` | React+Vite+TS; route `/`, `/create`, `/events/:slug/camera`, `/events/:slug` | Dashboard baru masuk sebagai route lazy, bukan app terpisah |
| Aset | `undangan/assets/img/` kosong, `assets/music/musik.mp3` 0 byte | Tema wajib membawa aset original sendiri |
| Auth & DB | **Belum ada** auth, belum ada DB | Fase 3 & Fase 0 |
| Runtime | Node **v26.11.1** → `node:sqlite` tersedia bawaan | DB tanpa dependensi native |
| Dependensi server | `express, cors, nanoid, googleapis` (tanpa `dotenv` → env dibaca via `node --env-file-if-exists=.env`, lihat `server/src/config.js`) | `multer` sudah dihapus: unggah foto kini biner mentah |

### 1.2 Tiga surface, satu backend

| Surface | Isi | Teknologi |
| --- | --- | --- |
| `undangan/` (guest) | Undangan publik `/u/<slug>`, buku tamu, RSVP, amplop, e-ticket | Vanilla ES modules + CSS token, **no-build** |
| `client/` (dashboard) | Couple, panitia, admin: editor konten, manajer tamu, check-in PWA, analitik | React + Vite + TS (existing) |
| `server/` | API, render `/u/:slug` + OG meta, auth, backup | Express ESM + `node:sqlite` |

### 1.3 Posisi vs fitur umum kompetitor

Status = kondisi repo saat ini. Daftar fitur disusun dari sampling situs undangan digital Indonesia (Sabda Cinta, Janiva, Invique, Satu Momen, Nikahnya, Nauhin, Kalief, Viding, Galeri Undangan, Indoinvite, Chara, Mer) — **hanya pola fitur yang disetarakan, tanpa menyalin kode/aset apa pun.**

| Fitur | Status sekarang | Target fase |
| --- | --- | --- |
| Link personalisasi tamu | `?to=` di klien saja, tanpa asosiasi data | 1 (`?k=` token HMAC) |
| Countdown, musik, galeri, amplop, RSVP, buku tamu | Ada tapi statik & hardcoded | 1 (data-driven dari DB) |
| Tema/template dapat dipilih | Belum ada (1 desain) | 1 (2 tema) → katalog |
| Editor konten per blok & urutan blok | Belum ada | 2 |
| Manajemen tamu (import, grup, link massal, QR) | Belum ada | 3–4 |
| Check-in QR + meja panitia | Belum ada | 7 |
| Blast WhatsApp | Belum ada | 5 (`wa.me`) → 8 (Cloud API resmi) |
| Analitik (view, RSVP, kehadiran) | Belum ada | 6 |
| Multi-user per acara (pengantin/panitia/vendor) | Belum ada | 3–4 |
| Galeri kamera analog tamu | **Ada (unggulan)** | dipertahankan + integrasi undangan |
| Kustom domain / subdomain | Belum ada | 9 |
| Paket & pembayaran | Belum ada | 8 |


---

## 2. PRD

### 2.1 Peran & akun

| Peran | Login | Cakupan | Ringkas |
| --- | --- | --- | --- |
| **Tamu** (`guest`) | Tidak | Per acara, via link | Lihat undangan, RSVP, buku tamu, unggah foto guestcam, amplop, e-ticket |
| **Pengantin** (`couple`) | Ya | Acara yang dimiliki / di-share | Pemilik acara: konten, tema, tamu, undangan, laporan, billing |
| **Panitia** (`committee`) | Ya | Acara yang ditugaskan | Daftar tamu, check-in QR, meja, RSVP, ekspor; tanpa keuangan |
| **Vendor** (opsional, time-boxed) | Ya | Tugas terbatas + `expires_at` | Mis. fotografer: unggah media, lihat galeri; akses berakhir otomatis |
| **Admin platform** (`superadmin`) | Ya | Semua tenant | Katalog tema, pengguna, paket, audit; cross-tenant |

> Empat peran yang diminta sudah cukup untuk MVP; peran `vendor` tetap dibuat di skema sejak awal (biaya nol, mencegah migrasi di tengah jalan). Detail izin: [PERMISSIONS.md](./PERMISSIONS.md).

### 2.2 User story utama (MoSCoW)

| ID | Sebagai | Ingin | Prioritas |
| --- | --- | --- | --- |
| US-01 | Pengantin | Membuat acara, mengisi data mempelai, lalu publish | **M** |
| US-02 | Pengantin | Memilih tema & menyesuaikan warna/font | **M** |
| US-03 | Pengantin | Mengimpor daftar tamu dari Excel/CSV/Kontak | **M** |
| US-04 | Pengantin | Mendapat satu link unik per tamu dengan namanya tampil otomatis | **M** |
| US-05 | Pengantin | Melihat preview undangan tanpa mempublikasikan | **M** |
| US-06 | Tamu | Membuka undangan dan melihat nama sendiri di cover | **M** |
| US-07 | Tamu | Konfirmasi hadir/berhalangan + jumlah orang | **M** |
| US-08 | Tamu | Menulis ucapan & melihat ucapan tamu lain | **M** |
| US-09 | Tamu | Melihat rekening/QRIS & menyalin nomor untuk kirim hadiah | **M** |
| US-10 | Pengantin | Memoderasi ucapan (setujui/sembunyikan/balas) | **S** |
| US-11 | Pengantin | Melihat ringkasan RSVP & kehadiran realtime | **S** |
| US-12 | Panitia | Memindai QR e-ticket & menandai kehadiran (toleran offline) | **S** |
| US-13 | Panitia | Mencari tamu manual & menandai hadir tanpa QR | **S** |
| US-14 | Pengantin | Mengirim pesan WA ke tamu terpilih (buka WhatsApp pra-terisi) | **S** |
| US-15 | Tamu | Mengunggah foto ke guestcam dari halaman undangan | **S** |
| US-16 | Pengantin | Menambahkan pasangan/pihak kedua sebagai pengelola (co-owner) | **S** |
| US-17 | Pengantin | Menugaskan panitia dengan batas akses | **S** |
| US-18 | Tamu | Menambahkan acara ke kalender (`.ics` / Google Calendar) | **C** |
| US-19 | Tamu | Melihat lokasi + tombol rute (Google Maps) | **C** |
| US-20 | Pengantin | Menyisipkan video prewedding & tautan live streaming | **C** |
| US-21 | Admin | Mengelola katalog & status premium tema | **C** |
| US-22 | Tamu | Mendengarkan musik latar (mulai setelah "Buka Undangan") | **C** |
| US-23 | Pengantin | Undangan ber-PIN untuk acara privat | **W** |
| US-24 | Pengantin | Mendapat e-ticket/QR cetak untuk undangan fisik | **W** |
| US-25 | Admin | Melihat audit log akses sensitif | **W** |


### 2.3 Functional requirements

| ID | Requirement | Fase |
| --- | --- | --- |
| FR-EV-01 | Buat/ubah/hapus acara; slug unik otomatis dari nama, dapat diubah 1× per 30 hari | 1 |
| FR-EV-02 | Status acara `draft/published/expired/archived`; publik hanya melihat `published` dan `now <= active_until` | 1 |
| FR-EV-03 | Setiap acara punya `settings` JSON untuk fitur on/off (guestbook, gift, guestcam, live, dll.) | 1 |
| FR-EV-04 | Kepemilikan acara dapat dipindahkan dengan konfirmasi dua langkah | 4 |
| FR-TH-01 | Katalog tema berisi metadata + token yang dapat dioverride per acara | 1 |
| FR-TH-02 | Mengganti tema tidak mengubah konten (tema murni presentasi) | 1 |
| FR-TH-03 | Preview tema tanpa publish (iframe ke `u.html`) | 1 |
| FR-SE-01 | Section (blok) dapat diaktifkan/nonaktifkan per acara | 1 |
| FR-SE-02 | Urutan blok dapat diatur (drag & save) | 2 |
| FR-SE-03 | Setiap blok punya `config` JSON yang divalidasi terhadap skema blok | 2 |
| FR-CT-01 | Konten mempelai, ayat/quote, love story, agenda, info tambahan (dresscode/protokol/FAQ) | 1–2 |
| FR-GU-01 | CRUD tamu, grup tamu, kuota pax | 3 |
| FR-GU-02 | Impor CSV/XLSX dengan pemetaan kolom + laporan error per baris | 3 |
| FR-GU-03 | Setiap tamu punya token HMAC untuk link personal | 1 |
| FR-GU-04 | Ekspor daftar tamu + link ke CSV/XLSX/PDF | 4 |
| FR-GU-05 | Generate QR e-ticket per tamu (PNG / PDF multi-halaman) | 7 |
| FR-GU-06 | Peringatan (bukan blokir) untuk nomor HP duplikat dalam satu acara | 3 |
| FR-IN-01 | Link pendek `/u/<slug>`, opsional `?k=<token>` atau `?to=<nama>` | 1 |
| FR-IN-02 | OG meta server-render: judul + nama acara + gambar (pratinjau WA benar) | 1 |
| FR-IN-03 | Template pesan undangan per kanal (WA/email) dengan variabel `{nama}`, `{link}`, `{tanggal}` | 5 |
| FR-RS-01 | Tamu mengirim RSVP (hadir/berhalangan/ragu) + jumlah pax + pesan | 1 |
| FR-RS-02 | RSVP dari link personal otomatis mengaitkan ke baris `guests` | 1 |
| FR-RS-03 | Anti-spam: rate limit per IP + honeypot + validasi server | 1 |
| FR-RS-04 | Pengantin/panitia dapat mengubah status RSVP (konfirmasi via telepon) | 4 |
| FR-GB-01 | Ucapan masuk dengan moderasi opsional (default langsung tampil) | 1 |
| FR-GB-02 | Balas, sematkan (pin), sembunyikan, hapus ucapan | 4 |
| FR-GB-03 | Anti-XSS: semua render lewat `textContent`, sanitasi whitelist | 1 |
| FR-GB-04 | Voice note ucapan (opsional) | 6 |
| FR-GF-01 | Rekening bank, e-wallet, QRIS (unggah gambar) dalam satu blok amplop | 1 |
| FR-GF-02 | Tombol salin nomor + template "konfirmasi transfer" ke WA | 2 |
| FR-GF-03 | Alamat pengiriman kado fisik | 2 |
| FR-ME-01 | Unggah foto/video, tersimpan ke Google Drive bila dikonfigurasi | 1 |
| FR-ME-02 | Foto guestcam dapat dimoderasi sebelum tampil di galeri | 2 |
| FR-ME-03 | Thumbnail otomatis (Drive `=s400` / transform lokal) | 1 |
| FR-AN-01 | Statistik: view unik, tamu membuka link, RSVP hadir/berhalangan, ucapan, check-in | 6 |
| FR-AN-02 | Rollup harian `stats_daily` + ekspor CSV | 6 |
| FR-CK-01 | Scan QR e-ticket → tandai hadir (idempoten via `client_uuid`, bisa di-undo) | 7 |
| FR-CK-02 | Mode offline: antrean lokal lalu sinkron (PWA) | 7 |
| FR-CK-03 | Cek kehadiran tanpa QR (cari nama) | 7 |
| FR-TB-01 | Kelola meja (nama, kapasitas, zona) & assign tamu ke meja | 7 |
| FR-BL-01 | Buat job blast: filter (grup/status RSVP), template, pratinjau | 5 |
| FR-BL-02 | Eksekusi via `wa.me` click-to-send per batch (aman ToS) | 5 |
| FR-BL-03 | (Opsional) Integrasi WhatsApp Cloud API resmi Meta | 8 |
| FR-TM-01 | Undang anggota tim via email/WA; status `pending` → `accepted` | 3 |
| FR-TM-02 | Role preset + pengecualian izin berbatas waktu | 3 |
| FR-AU-01 | Audit log untuk aksi sensitif (hapus, ekspor, ubah izin, impersonate) | 4 |
| FR-PL-01 | Paket `free/basic/premium` menentukan tema premium, batas tamu, masa aktif | 8 |
| FR-PL-02 | Order & pembayaran (Midtrans/Xendit) — skema disiapkan sejak awal | 8 |
| FR-AD-01 | Admin: CRUD tema, aktif/nonaktif, tandai premium | 5 |
| FR-AD-02 | Admin: lihat semua acara, suspend, impersonate dengan audit | 5 |
| FR-AC-01 | A11y: kontras ≥ 4.5:1, navigasi keyboard, `prefers-reduced-motion` | 1 |
| FR-AC-02 | Multi-bahasa guest (`id` dulu; struktur siap `en`) | 6 |
| FR-PR-01 | Kepatuhan UU PDP: halaman privasi, dasar pemrosesan, penghapusan data tamu | 8 |


### 2.4 Non-functional requirements

| Kategori | Target terukur | Cara verifikasi |
| --- | --- | --- |
| Performa guest | HTML+CSS+JS inti **< 100 KB gzip**; LCP < 2,5 s di 4G; Lighthouse mobile performa ≥ 90 | `scripts/check-size.mjs` + Lighthouse |
| Performa dashboard | Route chunk ≤ 150 KB gzip; dashboard interaktif < 3 s | laporan `vite build` |
| SEO/OG | Setiap `/u/<slug>` punya `og:*`, `twitter:card`, canonical, JSON-LD `Event` | curl + validator |
| Keamanan | Tanpa password polos; token sesi disimpan sebagai hash; rate limit publik; security header; tidak ada secret di klien | review + uji otomatis |
| Privasi | Nomor HP/email tamu tidak pernah muncul di payload publik; disimpan `ip_hash`, bukan IP mentah | uji API |
| Reliabilitas | RTO ≤ 15 menit, RPO ≤ 15 menit (backup Drive berkala); migrasi idempoten | simulasi restore |
| Skalabilitas | 1 instance cukup untuk 200 acara aktif / ±50 ribu tamu; jalur naik ke Postgres terdokumentasi | uji beban ringan |
| Observability | Log JSON per request (method, path, status, durasi, event_id); `/api/health` informatif | log server |
| Biaya | Fase 0–5: Rp 0 (Render free + Drive pribadi) | catatan operasional |

### 2.5 Out of scope v1

Aplikasi native (Play Store/App Store), transmisi live streaming sendiri, sistem pembayaran otomatis penuh (Fase 8), integrasi POS vendor, dan **kloning aset/desain kompetitor**.

### 2.6 Metrik keberhasilan MVP

1. Pengantin dapat menyelesaikan undangan siap-bagikan dalam **< 30 menit** tanpa bantuan.
2. ≥ 60 % tamu membuka link personal; tingkat RSVP ≥ 25 %.
3. Waktu render undangan < 1 s di 4G.
4. Nol kehilangan data RSVP/buku tamu selama 30 hari uji.

---

## 3. Risiko & keputusan terbuka

| # | Risiko / keputusan | Dampak | Mitigasi / opsi |
| --- | --- | --- | --- |
| R1 | Render free = disk *ephemeral* → SQLite bisa hilang | Kehilangan RSVP (maks 15 menit) | **Plan A**: backup ke Drive tiap 15 menit + restore saat boot. **Plan B**: Postgres/Neon (nol kehilangan, tambah dependensi `pg`) |
| R2 | OG meta tak bisa dari GitHub Pages | Pratinjau WA jelek | `/u/:slug` disajikan Express (Render) |
| R3 | Blast WA via API tidak resmi | Nomor diblokir, langgar ToS | Mulai `wa.me` (Fase 5); Cloud API resmi (Fase 8) |
| R4 | Kuota Drive 15 GB terisi video | Unggahan gagal | Batas ukuran video, kompresi, pembersihan otomatis, opsi R2/Backblaze |
| R5 | Data pribadi tamu (UU PDP) | Risiko hukum | Dasar pemrosesan, kebijakan retensi, endpoint hapus, `ip_hash`, halaman privasi |
| R6 | SQLite single-writer | Konflik tulis saat traffic tinggi | WAL + antre tulis; naik Postgres bila > 1 instance |
| R7 | Orisinalitas aset tema | Sengketa hak cipta | 100 % dibuat sendiri; dokumentasi lisensi font/aset |
| R8 | Cakupan fitur kompetitor luas | Scope creep | Kunci MVP pada FR bertanda **M/S**; sisanya bertahap |

**Keputusan yang perlu dikonfirmasi pemilik produk:**

1. **Penyimpanan:** Plan A SQLite + backup Drive (rekomendasi) vs Plan B Postgres/Neon.
2. **Hosting guest:** menempel di server Express (wajib untuk OG meta) vs statik terpisah.
3. **Blok `guestcam`** aktif di halaman undangan sejak Fase 1 atau Fase 2.
4. **Tema premium & peran `vendor`** masuk MVP atau ditunda ke Fase 8.




