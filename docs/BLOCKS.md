# BLOCKS — Katalog Blok Undangan (block registry)

> Dokumen terkait: [PRD.md](./PRD.md) · [THEMES.md](./THEMES.md) · [DB-SCHEMA.sql](./DB-SCHEMA.sql) · [API.md](./API.md)

## 1. Kontrak blok

Setiap blok adalah satu ES module di `undangan/blocks/<key>.js` tanpa dependensi:

```js
export default {
  key: 'rsvp',
  label: 'Konfirmasi Kehadiran',   // nama tampil di editor
  order: 90,                       // urutan default
  dataNeeded: ['event', 'guest', 'sections'],   // bagian payload yang dipakai
  configSchema: {                  // validasi config di editor & server
    attendance_options: { type: 'enum[]', default: ['hadir','berhalangan','ragu'] },
    deadline: { type: 'date', default: null },
    require_message: { type: 'boolean', default: false }
  },
  render(container, ctx) { /* buat DOM, TIDAK memanggil fetch (kecuali ajax:true) */ },
  init(el, ctx) { /* event listener, bersih-bersih lewat destroy() */ },
  destroy() { /* hapus listener/timer */ }
};
```

**Isi `ctx`:** `{ event, theme, tokens, guest, sections, config, api, i18n, reducedMotion, isPreview }`.
**Aturan:** data undangan dikirim sekali dalam payload `GET /api/v1/invitations/:slug` (blok tidak memicu fetch tambahan, kecuali blok bertanda `ajax` seperti `wish_wall`/`live`). Semua teks tampil dari config/DB, tidak ada hardcode. Semua interpolasi pengguna dirender dengan `textContent` (anti-XSS, mengikuti pola `undangan/js/main.js`).
**Blok nonaktif** tidak di-`import()` sama sekali → JS yang dikirim tamu hanya untuk blok yang dipakai.

## 2. Registry blok

`sumber` = tabel/kolom asal data. `ajax` = memicu request tambahan saat runtime.

| # | key | Nama | Isi | Sumber data | Fase | Config utama |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `cover` | Cover & sapaan tamu | Nama tamu personal, tombol "Buka Undangan", tanggal | `events`, `guests` | **1** | `bg_media_id`, `show_countdown`, `envelope_style` |
| 2 | `greeting` | Salam pembuka | Teks salam sesuai `greeting_style` | `events.greeting_style` | **1** | `custom_text` |
| 3 | `quote` | Ayat / kutipan | Kutipan + sumber + latar | `events.quote_text/source/media_id` | **1** | `align`, `bg_media_id` |
| 4 | `couple` | Mempelai | Foto, nama lengkap, orang tua, IG | `events.groom_*`, `bride_*`, `media` | **1** | `layout`, `show_parents`, `show_ig` |
| 5 | `countdown` | Hitung mundur | Hari/jam/menit/detik | `events.event_at`, `timezone` | **1** | `label`, `expired_text` |
| 6 | `agenda` | Acara (akad/resepsi) | Waktu, tempat, tombol `.ics` | `event_agenda` | **1** | `show_ics`, `date_format` |
| 7 | `maps` | Lokasi & rute | Peta embed + tombol Google Maps/Waze | `event_agenda.lat/lng/map_query` | **1** | `provider`, `height`, `show_nearby` |
| 8 | `gallery` | Galeri | Grid/slider foto, lightbox | `media(section=gallery)` | **1** | `layout`, `limit`, `lightbox`, `caption` |
| 9 | `rsvp` | Konfirmasi kehadiran | Hadir/berhalangan/ragu + pax | `rsvps`, `guests` | **1** | `attendance_options`, `deadline`, `require_message` |
| 10 | `guestbook` | Buku tamu & ucapan | Form + daftar, paginasi | `guestbook` | **1** | `moderate`, `page_size`, `show_attendance` |
| 11 | `gift` | Amplop digital | Rekening, e-wallet, QRIS, salin nomor | `gift_accounts` | **1** | `show_qris`, `confirm_wa` |
| 12 | `music` | Musik latar | BGM mulai setelah "Buka Undangan" | `media(section=music)` | **1** | `autoplay`, `loop`, `volume`, `show_button` |
| 13 | `closing` | Penutup | Ucapan terima kasih + nama tamu | `events` | **1** | `text`, `show_credit`, `show_share` |
| 14 | `story` | Love story | Timeline momen | `event_story` | 2 | `layout` (`timeline`/`cards`), `alternate` |
| 15 | `video` | Video | Embed YouTube/Vimeo/Drive | `event_sections.config` | 2 | `url`, `ratio`, `autoplay`, `muted` |
| 16 | `guestcam` | Kamera tamu | Unggah foto dari halaman undangan | `media(section=guestcam)` | 2 | `max_per_guest`, `moderate`, `filter_presets` |
| 17 | `dresscode` | Dresscode | Palet warna + aturan pakaian | `event_info_items` | 2 | `show_palette`, `notes` |
| 18 | `protokol` | Aturan / adab acara | Daftar aturan & protokol | `event_info_items` | 2 | `icon_set`, `columns` |
| 19 | `gift_address` | Kirim kado fisik | Alamat + konfirmasi WA | `gift_accounts(kind=address)` | 2 | `confirm_wa`, `show_recipient` |
| 20 | `faq` | Tanya jawab | Akordeon | `event_info_items` | 3 | `open_first` |
| 21 | `doa` | Doa / penutup religius | Teks doa sesuai `greeting_style` | `event_info_items` | 3 | `tone` |
| 22 | `wish_wall` | Dinding ucapan | Ucapan realtime (**ajax**) | `guestbook` | 3 | `interval_sec`, `theme` |
| 23 | `live` | Live streaming | Tautan YouTube/Zoom + jadwal | `event_sections.config` | 3 | `url`, `platform`, `notify_at` |
| 24 | `e_ticket` | E-ticket pribadi | QR check-in untuk tamu | `guests`, `checkins` | 7 | `show_qr`, `instructions` |
| 25 | `registry` | Daftar hadiah | Wishlist eksternal | `gift_accounts(kind=registry)` | 4 | `provider`, `url` |
| 26 | `voice_note` | Ucapan suara | Rekam/unggah voice note | `guestbook.media_id` | 6 | `max_duration_sec` |
| 27 | `custom_html` | Blok HTML kustom | Premium; HTML disanitasi whitelist | `event_sections.config.html` | 4 | `html`, `allow_scripts:false` |

> Blok yang **belum ada** di `undangan/undangan.html` sekarang: `couple`, `story`, `maps` (terpisah), `video`, `live`, `dresscode`, `protokol`, `faq`, `doa`, `wish_wall`, `registry`, `voice_note`, `e_ticket`, `custom_html`, `gift_address`.


## 3. Contoh data tersimpan

`event_sections.config` (hasil editor) — contoh blok `gallery`:

```json
{
  "key": "gallery",
  "position": 8,
  "enabled": true,
  "preset_id": "gallery-masonry-4",
  "config": { "layout": "masonry", "limit": 12, "lightbox": true, "caption": true }
}
```

`events.settings` (fitur on/off per acara):

```json
{
  "guestbook": { "enabled": true, "moderate": false },
  "guestcam": { "enabled": true, "moderate": true, "max_per_guest": 5 },
  "gift": { "enabled": true, "show_qris": true },
  "live": { "enabled": false },
  "rsvp": { "enabled": true, "deadline": "2026-12-01T16:59:59.000Z" },
  "music": { "autoplay": true },
  "branding": { "hide_platform_credit": false }
}
```

## 4. Skema config lengkap blok MVP

| Blok | Field | Tipe | Default | Keterangan |
| --- | --- | --- | --- | --- |
| `cover` | `bg_media_id` | id media | `null` | Latar cover |
| | `show_countdown` | boolean | `false` | Tampilkan hitung mundur mini di cover |
| | `envelope_style` | enum (`none`,`wave`,`curtain`) | `none` | Animasi pembuka |
| `couple` | `layout` | enum (`stack`,`side`,`cards`) | `stack` | Tata letak dua mempelai |
| | `show_parents` | boolean | `true` | Tampilkan nama orang tua |
| | `show_ig` | boolean | `true` | Tampilkan tautan Instagram |
| `countdown` | `label` | string | `"Menuju Hari Bahagia"` | Judul blok |
| | `expired_text` | string | `"Acara telah berlangsung"` | Teks setelah tanggal lewat |
| `agenda` | `show_ics` | boolean | `true` | Tombol tambah ke kalender |
| | `date_format` | enum (`id-long`,`id-short`,`en-long`) | `id-long` | Format tanggal |
| `maps` | `provider` | enum (`embed`,`link`) | `embed` | Peta di dalam halaman atau tautan |
| | `height` | number (px) | `320` | Tinggi peta |
| `gallery` | `layout` | enum (`grid`,`masonry`,`slider`) | `grid` | Tata letak |
| | `limit` | number | `12` | Jumlah foto maksimum (`0` = semua) |
| | `lightbox` | boolean | `true` | Pembesaran foto |
| `rsvp` | `attendance_options` | enum[] | `["hadir","berhalangan","ragu"]` | Pilihan yang tampil |
| | `deadline` | ISO date | `null` | Batas waktu konfirmasi |
| | `require_message` | boolean | `false` | Pesan wajib diisi |
| `guestbook` | `moderate` | boolean | `false` | Ucapan menunggu persetujuan |
| | `page_size` | number | `10` | Ucapan per halaman |
| | `show_attendance` | boolean | `true` | Tampilkan status kehadiran |
| `gift` | `show_qris` | boolean | `true` | Tampilkan QRIS |
| | `confirm_wa` | string (nomor) | `null` | Nomor WA konfirmasi transfer |
| `music` | `autoplay` | boolean | `true` | Putar setelah "Buka Undangan" |
| | `volume` | number (0–1) | `0.6` | Volume awal |
| | `show_button` | boolean | `true` | Tombol musik mengapung |
| `closing` | `text` | string | `"Terima kasih"` | Kalimat penutup |
| | `show_credit` | boolean | `true` | Kredit platform |

## 5. Payload data satu kali (kontrak dengan API)

`GET /api/v1/invitations/:slug` mengembalikan semua yang dibutuhkan blok:

```json
{
  "event": { "slug": "ani-budi", "title": "Pernikahan Ani & Budi", "kind": "wedding",
             "eventAt": "2026-12-12T03:00:00.000Z", "timezone": "Asia/Jakarta",
             "greetingStyle": "islamic", "quote": { "text": "...", "source": "QS. Ar-Rum: 21" },
             "couple": { "groom": { "name": "Budi", "full": "...", "parent": "..." },
                         "bride": { "name": "Ani",  "full": "...", "parent": "..." } } },
  "theme": { "id": "klasik-elegan", "tokens": { "--sa-primary": "#b08d57" } },
  "sections": [ { "key": "cover", "position": 0, "enabled": true, "config": {} } ],
  "agenda": [ { "name": "Akad Nikah", "startAt": "...", "venueName": "...", "lat": -6.2, "lng": 106.8 } ],
  "story": [ { "title": "Pertama bertemu", "dateLabel": "2019", "text": "..." } ],
  "media": { "gallery": [], "couple": {}, "music": {} },
  "gift": [ { "kind": "bank", "provider": "BCA", "number": "1234567890", "holder": "Ani" } ],
  "guest": { "name": "Bapak Hendra", "salutation": "Bapak", "paxQuota": 2,
             "rsvpStatus": "pending", "token": "..." },
  "settings": { "guestbook": { "enabled": true } },
  "i18n": { "locale": "id" }
}
```

Catatan: `guest` bernilai `null` bila tanpa token; endpoint ini **tidak pernah** mengembalikan nomor HP, email, atau daftar tamu.

## 6. Non-fungsional per blok

| Aspek | Aturan |
| --- | --- |
| Anti-XSS | Semua nilai pengguna dirender `textContent`; HTML kustom blok `custom_html` disanitasi whitelist (tanpa `<script>`, tanpa atribut `on*`) |
| A11y | Semua tombol/tautan punya label; kontras dari token tema ≥ 4.5:1; `prefers-reduced-motion` menonaktifkan animasi parralax/auto-scroll |
| Performa | Blok nonaktif tidak di-`import()`; gambar `loading="lazy"` (kecuali cover); maksimum 1 blok bertanda `ajax` aktif bersamaan |
| i18n | Semua teks UI dari `core/i18n.js`; teks konten dari DB. Bahasa acara = `events.lang` |
| PWA | Hanya blok `e_ticket` & halaman check-in yang di-cache offline |


