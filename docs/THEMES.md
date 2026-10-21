# THEMES — Kontrak & Katalog Tema

> Dokumen terkait: [BLOCKS.md](./BLOCKS.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [DB-SCHEMA.sql](./DB-SCHEMA.sql)

## 1. Prinsip produksi tema

1. **Murni presentasi** — tema hanya berisi CSS + aset; **tanpa JavaScript**.
2. **Token-only** — tidak ada warna, radius, spasi, atau bayangan hardcode di `theme.css`; semuanya memakai variabel `--sa-*` dari `theme.json`.
3. **Satu file CSS** — `theme.css` di atas `undangan/css/base.css` (mengikuti pola `style.css` + `invitation.css` yang sudah ada), ukuran < 12 KB.
4. **Aset original** — semua ornamen SVG/latar dibuat sendiri; font dari Google Fonts (maksimal 3 keluarga, dengan `display=swap`). Tidak ada aset dari kompetitor.
5. **Aksesibel** — kontras teks ≥ 4.5:1, target sentuh ≥ 44 px, hormati `prefers-reduced-motion`.
6. **Terukur gratis** — setiap tema wajib punya `preview.jpg` (800×1200) untuk katalog.

## 2. Struktur folder

```
undangan/themes/<id>/
├── theme.json          # metadata + token + urutan section default
├── theme.css           # gaya spesifik tema (token-only)
├── preview.jpg         # pratinjau katalog 800×1200
└── ornaments/          # SVG original: frame.svg, divider.svg, leaf.svg, ...
```

Registrasi tema di katalog: baris pada tabel `themes` (lihat [DB-SCHEMA.sql](./DB-SCHEMA.sql)) diisi saat migrasi `0002_seed.sql`.

## 3. Kontrak `theme.json`

```json
{
  "id": "klasik-elegan",
  "name": "Klasik Elegan",
  "category": "floral",
  "version": "1.0.0",
  "author": "Satu-Album",
  "preview": "preview.jpg",
  "fonts": {
    "title": "Cormorant Garamond",
    "accent": "Great Vibes",
    "body": "Nunito Sans"
  },
  "tokens": {
    "--sa-bg": "#f8f4ec",
    "--sa-surface": "#ffffff",
    "--sa-text": "#3c342b",
    "--sa-text-muted": "#6f6255",
    "--sa-primary": "#b08d57",
    "--sa-primary-contrast": "#ffffff",
    "--sa-accent": "#8a6a3b",
    "--sa-border": "#e2d5c0",
    "--sa-radius": "14px",
    "--sa-radius-sm": "8px",
    "--sa-shadow": "0 10px 30px rgba(60,52,43,.10)",
    "--sa-space": "clamp(16px, 4vw, 28px)",
    "--sa-title-size": "clamp(2rem, 6vw, 3.2rem)",
    "--sa-body-size": "clamp(0.95rem, 3.6vw, 1.05rem)",
    "--sa-font-title": "'Cormorant Garamond', serif",
    "--sa-font-accent": "'Great Vibes', cursive",
    "--sa-font-body": "'Nunito Sans', system-ui, sans-serif",
    "--sa-ornament": "ornaments/gold-frame.svg",
    "--sa-divider": "ornaments/floral-divider.svg"
  },
  "sections": [
    "cover", "greeting", "quote", "couple", "countdown", "agenda",
    "maps", "story", "gallery", "video", "rsvp", "guestbook", "gift", "closing"
  ],
  "modes": ["light"],
  "blocks": {
    "cover": { "envelope_style": "wave" },
    "gallery": { "layout": "masonry" }
  }
}
```

**Aturan token:**

| Kelompok | Token wajib | Wajib? |
| --- | --- | --- |
| Warna | `--sa-bg`, `--sa-surface`, `--sa-text`, `--sa-primary`, `--sa-primary-contrast`, `--sa-accent`, `--sa-border` | Ya |
| Tipografi | `--sa-font-title`, `--sa-font-accent`, `--sa-font-body`, `--sa-title-size`, `--sa-body-size` | Ya |
| Bentuk | `--sa-radius`, `--sa-radius-sm`, `--sa-shadow` | Ya |
| Ornamen | `--sa-ornament`, `--sa-divider` | Opsional |
| Lain | `--sa-space`, `--sa-text-muted` | Opsional |

Override per acara dari `events.theme_overrides` (JSON) hanya boleh memakai token di atas — editor dashboard menampilkan pemilih warna untuk `--sa-primary`, `--sa-accent`, `--sa-bg`, dan pemilih font dari daftar `fonts`.


## 4. Katalog tema MVP (Fase 1)

| id | Nama | Kategori | Font (judul / aksen / body) | Palet inti | Karakter layout |
| --- | --- | --- | --- | --- | --- |
| `klasik-elegan` | Klasik Elegan | floral | Cormorant Garamond / Great Vibes / Nunito Sans | ivory `#f8f4ec`, emas `#b08d57`, cokelat `#3c342b` | Simetris tengah, bingkai emas tipis, divider floral |
| `rustic-sage` | Rustic Sage | rustic | Cormorant / Sacramento / Inter | sage `#7c8f70`, beige `#efe7da`, arang `#3a3a34` | Asimetris, foto besar, ornamen daun/ranting |

### 4.1 Token `rustic-sage` (contoh lengkap)

```json
{
  "id": "rustic-sage",
  "name": "Rustic Sage",
  "category": "rustic",
  "version": "1.0.0",
  "preview": "preview.jpg",
  "fonts": { "title": "Cormorant", "accent": "Sacramento", "body": "Inter" },
  "tokens": {
    "--sa-bg": "#efe7da",
    "--sa-surface": "#fbf7f0",
    "--sa-text": "#3a3a34",
    "--sa-text-muted": "#6d6a5f",
    "--sa-primary": "#7c8f70",
    "--sa-primary-contrast": "#ffffff",
    "--sa-accent": "#5f7156",
    "--sa-border": "#d8ccb8",
    "--sa-radius": "10px",
    "--sa-radius-sm": "6px",
    "--sa-shadow": "0 8px 24px rgba(58,58,52,.08)",
    "--sa-space": "clamp(16px, 4vw, 26px)",
    "--sa-title-size": "clamp(1.9rem, 5.6vw, 3rem)",
    "--sa-body-size": "clamp(0.95rem, 3.5vw, 1.05rem)",
    "--sa-font-title": "'Cormorant', serif",
    "--sa-font-accent": "'Sacramento', cursive",
    "--sa-font-body": "'Inter', system-ui, sans-serif",
    "--sa-ornament": "ornaments/leaf-frame.svg",
    "--sa-divider": "ornaments/branch-divider.svg"
  },
  "sections": [
    "cover", "greeting", "couple", "countdown", "agenda", "maps",
    "story", "gallery", "rsvp", "guestbook", "gift", "closing"
  ],
  "modes": ["light"],
  "blocks": { "cover": { "envelope_style": "curtain" }, "gallery": { "layout": "slider" } }
}
```

## 5. Roadmap tema (18 tema tambahan)

| Kategori | id | Palet arah | Catatan ornamen |
| --- | --- | --- | --- |
| Islami | `islami-madinah` | hijau tua `#1f4d3f`, emas, krem | Geometris arabesque (garis) |
| Islami | `islami-nur` | putih, mint, silver | Minimalis, kaligrafi ringan |
| Tradisional Jawa | `jawa-klasik` | sogan `#7b4a24`, krem | Gunungan, batik parang versi sendiri |
| Tradisional | `sundanese-hejo` | hijau daun, putih | Anyaman bambu |
| Bali | `balinese-ukir` | emas, batu alam | Ukiran geometris original |
| Modern | `modern-mono` | hitam/putih/grafit | Tanpa ornamen, tipografi besar |
| Modern | `glass-soft` | gradasi lembut + blur | Kartu kaca (tanpa JS) |
| Modern | `minimal-sand` | sand `#e6d8c3`, cokelat muda | Sangat bersih, spasi lapang |
| Floral | `floral-rose` | dusty rose `#c98f74` | Lukisan bunga SVG original |
| Floral | `tropical-bali` | hijau tropis, korall | Monstera/palem original |
| Elegan | `gold-luxe` | hitam + emas foil | Premium |
| Elegan | `vintage-film` | sephia + grain | Sinergi identitas kamera analog |
| Elegan | `celestial-night` | navy, bintang | Animasi CSS, hormati `reduced-motion` |
| Soft | `korean-soft` | peach, krem, putih | Sudut membulat, tipografi ringan |
| Soft | `kids-ceria` | warna ceria | Untuk aqiqah/ulang tahun |
| Destination | `destination-santorini` | biru laut, putih | Foto laut dominan |
| Rustic | `rustic-burlap` | kraft, cokelat goni | Tekstur kertas |
| Batik | `batik-parang` | navy, sogan | Motif batik SVG original |

Tema premium (mis. `gold-luxe`, `celestial-night`, `balinese-ukir`) digerbang oleh `themes.is_premium` + `events.plan`.

## 6. Checklist tema baru (wajib lulus sebelum masuk katalog)

- [ ] `theme.json` valid terhadap kontrak §3, `id` unik & belum terpakai.
- [ ] Semua token wajib terisi; **tidak ada** warna/nilai hardcode di `theme.css`.
- [ ] Kontras teks terhadap latar ≥ 4.5:1 (uji otomatis sederhana dari token).
- [ ] Uji visual 6 blok kunci: `cover`, `couple`, `agenda`, `gallery`, `rsvp`, `closing`.
- [ ] Ukuran `theme.css` < 12 KB; total aset tema < 150 KB (tanpa font).
- [ ] `preview.jpg` 800×1200 tersedia.
- [ ] Tampil benar pada lebar 360 px dan 414 px.
- [ ] Animasi tunduk pada `prefers-reduced-motion`.
- [ ] Seluruh ornamen SVG adalah karya sendiri (dokumentasikan di `ornaments/README.md`).


