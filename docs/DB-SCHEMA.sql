-- ============================================================================
-- Satu-Album Invitation Platform — SKEMA DATABASE (SQL)
-- Target utama: SQLite lewat `node:sqlite` (Node >= 22, tersedia di v26.11.1)
-- Portabilitas: seluruh DDL kompatibel PostgreSQL kecuali PRAGMA + CHECK-nya
--               (lihat catatan "PG-DIFF" di bagian akhir file).
--
-- KONVENSI
--   id            TEXT  nanoid(10-21), bukan autoincrement (aman untuk sinkron)
--   waktu         TEXT  ISO-8601 UTC, contoh 2026-10-22T03:15:00.000Z
--   boolean       INTEGER 0/1
--   objek bebas   TEXT  berisi JSON (validasi di lapisan service, bukan DB)
--   nominal uang  INTEGER rupiah (tanpa desimal)
--   FK            ON DELETE CASCADE, PRAGMA foreign_keys = ON
--   updated_at    diisi oleh lapisan repo (bukan trigger)
--
-- PEMBAGIAN FILE MIGRASI
--   0001_init.sql       tabel [A]..[F] + view  (Fase 0)
--   0002_seed.sql       seed 2 tema + preset blok (Fase 1)
--   0003_checkin.sql    event_tables, checkins   (Fase 7)
--   0004_comms.sql      message_templates, blast_jobs, blast_messages (Fase 5)
--   0005_commercial.sql plans, orders, payments, subscriptions, coupons, domains (Fase 8)
--   0006_stats.sql      stats_daily (Fase 6)
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- ─── [A] AKUN, SESI & ANTISPAM ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  phone         TEXT,                                -- E.164, opsional
  name          TEXT NOT NULL,
  password_hash TEXT,                                -- NULL bila login via magic-link
  avatar_url    TEXT,
  locale        TEXT NOT NULL DEFAULT 'id',
  is_superadmin INTEGER NOT NULL DEFAULT 0,          -- admin platform (cross-tenant)
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended','deleted')),
  last_login_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,                   -- token sesi disimpan sebagai hash
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  ip_hash    TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_tokens (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  purpose    TEXT NOT NULL
             CHECK (purpose IN ('login','reset','verify_email','accept_invite')),
  meta       TEXT,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens(email, purpose);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     TEXT PRIMARY KEY,                       -- "rsvp:<slug>:<ip_hash>"
  hits       INTEGER NOT NULL DEFAULT 0,
  window_end TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_id      TEXT,
  action        TEXT NOT NULL,                       -- "guest.export", "member.grant"
  target_type   TEXT,
  target_id     TEXT,
  meta          TEXT,
  ip_hash       TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event_id, created_at);


-- ─── [B] TEMA & PRESET BLOK (katalog tingkat platform) ──────────────────────
CREATE TABLE IF NOT EXISTS themes (
  id               TEXT PRIMARY KEY,                 -- 'klasik-elegan'
  name             TEXT NOT NULL,
  category         TEXT NOT NULL,                    -- floral|rustic|islami|modern|...
  version          TEXT NOT NULL DEFAULT '1.0.0',
  css_path         TEXT NOT NULL,                    -- themes/klasik-elegan/theme.css
  config_path      TEXT NOT NULL,                    -- themes/klasik-elegan/theme.json
  preview_url      TEXT,
  tokens           TEXT NOT NULL,                    -- JSON design tokens
  default_sections TEXT NOT NULL,                    -- JSON array urutan blok default
  is_premium       INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_themes_catalog ON themes(is_active, category, sort_order);

CREATE TABLE IF NOT EXISTS block_presets (           -- variasi tampilan per blok
  id          TEXT PRIMARY KEY,
  block_key   TEXT NOT NULL,                         -- 'gallery','cover',...
  name        TEXT NOT NULL,
  category    TEXT,
  config      TEXT NOT NULL DEFAULT '{}',            -- JSON default config
  preview_url TEXT,
  is_premium  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_block_presets ON block_presets(block_key, is_active, sort_order);

-- ─── [C] ACARA (tenant), ANGGOTA & SECTION ─────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,              -- /u/<slug>
  subdomain       TEXT UNIQUE,                       -- <slug>.satualbum.id (Fase 9)
  owner_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL DEFAULT 'wedding'
                  CHECK (kind IN ('wedding','engagement','birthday','aqiqah',
                                  'khitan','corporate','other')),
  title           TEXT NOT NULL,                     -- "Pernikahan Ani & Budi"
  couple_label    TEXT,                              -- "Ani & Budi"
  groom_name      TEXT, groom_full TEXT, groom_parent TEXT,
  groom_photo_id  TEXT, groom_ig TEXT,
  bride_name      TEXT, bride_full TEXT, bride_parent TEXT,
  bride_photo_id  TEXT, bride_ig TEXT,
  event_at        TEXT,                              -- ISO UTC tanggal utama
  timezone        TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  theme_id        TEXT REFERENCES themes(id) ON DELETE SET NULL,
  theme_overrides TEXT,                              -- JSON token override per acara
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','published','expired','archived')),
  visibility      TEXT NOT NULL DEFAULT 'public'
                  CHECK (visibility IN ('public','unlisted','private')),
  passcode_hash   TEXT,                              -- undangan ber-PIN
  plan            TEXT NOT NULL DEFAULT 'free'
                  CHECK (plan IN ('free','basic','premium')),
  active_until    TEXT,                              -- masa aktif paket
  lang            TEXT NOT NULL DEFAULT 'id',
  greeting_style  TEXT NOT NULL DEFAULT 'islamic'
                  CHECK (greeting_style IN ('islamic','christian','hindu',
                                            'buddhist','universal','neutral')),
  quote_text      TEXT,
  quote_source    TEXT,
  quote_media_id  TEXT,
  settings        TEXT NOT NULL DEFAULT '{}',        -- JSON fitur on/off
  seo             TEXT NOT NULL DEFAULT '{}',        -- JSON og_title/og_description/og_image_id
  view_count      INTEGER NOT NULL DEFAULT 0,
  published_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT                               -- soft delete (arsip)
);
CREATE INDEX IF NOT EXISTS idx_events_owner  ON events(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status, active_until);

CREATE TABLE IF NOT EXISTS event_members (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  invited_email TEXT,
  invited_phone TEXT,
  role          TEXT NOT NULL CHECK (role IN ('couple','committee','vendor')),
  permissions   TEXT,                                -- JSON: ["+guest.import","-gift.update"]
  label         TEXT,                                -- "Koordinator Parkir"
  invite_token  TEXT UNIQUE,
  invited_at    TEXT,
  accepted_at   TEXT,
  expires_at    TEXT,                                -- khusus vendor (time-boxed)
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_event ON event_members(event_id, role);
CREATE INDEX IF NOT EXISTS idx_members_user  ON event_members(user_id);


CREATE TABLE IF NOT EXISTS permission_grants (        -- izin tambahan berbatas waktu
  id         TEXT PRIMARY KEY,
  event_id   TEXT REFERENCES events(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason     TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (event_id, user_id, permission)
);

CREATE TABLE IF NOT EXISTS event_sections (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,                          -- 'cover','couple','rsvp',...
  position   INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  preset_id  TEXT REFERENCES block_presets(id) ON DELETE SET NULL,
  config     TEXT NOT NULL DEFAULT '{}',             -- JSON khas blok
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id, key)
);
CREATE INDEX IF NOT EXISTS idx_sections_event ON event_sections(event_id, position);

CREATE TABLE IF NOT EXISTS event_info_items (          -- dresscode, protokol, FAQ, parkir
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,                          -- 'dresscode','protokol','faq'
  position    INTEGER NOT NULL DEFAULT 0,
  label       TEXT,
  value       TEXT,
  icon        TEXT,
  media_id    TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_info_event ON event_info_items(event_id, section_key, position);

-- ─── [D] KONTEN UNDANGAN ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_story (               -- love story timeline
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  title      TEXT,
  date_label TEXT,                                    -- "2019 — Pertama bertemu"
  text       TEXT,
  media_id   TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_story_event ON event_story(event_id, position);

CREATE TABLE IF NOT EXISTS event_agenda (              -- akad, resepsi, unduh .ics
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  name          TEXT NOT NULL,                        -- "Akad Nikah"
  start_at      TEXT,
  end_at        TEXT,
  timezone      TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  venue_name    TEXT,
  venue_address TEXT,
  map_query     TEXT,                                 -- query embed/rute
  map_url       TEXT,
  lat           REAL,
  lng           REAL,
  note          TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agenda_event ON event_agenda(event_id, position);

CREATE TABLE IF NOT EXISTS gift_accounts (             -- amplop digital & kado fisik
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL
              CHECK (kind IN ('bank','ewallet','qris','address','registry')),
  provider    TEXT,                                   -- "BCA","OVO","Shopee"
  number      TEXT,                                   -- nomor rekening / e-wallet
  holder      TEXT,                                   -- atas nama
  qr_media_id TEXT,                                   -- gambar QRIS
  address     TEXT,                                   -- kado fisik
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gift_event ON gift_accounts(event_id, position);


-- ─── [E] TAMU ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guest_groups (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                          -- "Keluarga Mempelai Wanita"
  color      TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (event_id, name)
);

CREATE TABLE IF NOT EXISTS guests (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  group_id      TEXT REFERENCES guest_groups(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  full_name     TEXT,
  salutation    TEXT,                                -- "Bapak","Ibu","Saudara/i"
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  pax_quota     INTEGER NOT NULL DEFAULT 1,
  seat_table_id TEXT,                                -- FK ke event_tables (migrasi 0003)
  token         TEXT NOT NULL,                       -- HMAC untuk link personal (?k=)
  link_sent_at  TEXT,
  link_channel  TEXT,                                -- 'wa','email','manual'
  opened_at     TEXT,
  opened_count  INTEGER NOT NULL DEFAULT 0,
  rsvp_status   TEXT NOT NULL DEFAULT 'pending'
                CHECK (rsvp_status IN ('pending','hadir','berhalangan','ragu')),
  rsvp_pax      INTEGER,
  notes         TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_token ON guests(token);
CREATE INDEX IF NOT EXISTS idx_guests_event ON guests(event_id, rsvp_status);
CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests(event_id, phone);

-- ─── [F] INTERAKSI TAMU ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rsvps (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id    TEXT REFERENCES guests(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  attendance  TEXT NOT NULL
              CHECK (attendance IN ('hadir','berhalangan','ragu')),
  pax         INTEGER NOT NULL DEFAULT 1,
  message     TEXT,
  source      TEXT NOT NULL DEFAULT 'invitation',    -- 'invitation','manual','wa'
  client_uuid TEXT,                                  -- idempotensi kiriman ganda
  ip_hash     TEXT,
  user_agent  TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rsvps_event ON rsvps(event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rsvps_guest ON rsvps(guest_id);

CREATE TABLE IF NOT EXISTS guestbook (               -- buku tamu & ucapan
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id    TEXT REFERENCES guests(id) ON DELETE SET NULL,
  parent_id   TEXT REFERENCES guestbook(id) ON DELETE CASCADE,   -- balasan
  name        TEXT NOT NULL,
  message     TEXT NOT NULL,
  attendance  TEXT CHECK (attendance IN ('hadir','berhalangan','ragu')),
  media_id    TEXT,                                  -- foto / voice note
  is_approved INTEGER NOT NULL DEFAULT 1,
  is_pinned   INTEGER NOT NULL DEFAULT 0,
  is_hidden   INTEGER NOT NULL DEFAULT 0,
  liked_count INTEGER NOT NULL DEFAULT 0,
  client_uuid TEXT,
  ip_hash     TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guestbook_event
  ON guestbook(event_id, is_approved, is_pinned, created_at);


CREATE TABLE IF NOT EXISTS media (
  id                   TEXT PRIMARY KEY,
  event_id             TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL
                       CHECK (kind IN ('photo','video','music','document','qr')),
  section              TEXT NOT NULL DEFAULT 'gallery'
                       CHECK (section IN ('gallery','guestcam','cover','story',
                                          'couple','quote','gift','music','other')),
  provider             TEXT NOT NULL DEFAULT 'local'
                       CHECK (provider IN ('local','drive')),
  drive_id             TEXT,
  url                  TEXT NOT NULL,
  thumb                TEXT,
  mime_type            TEXT,
  byte_size            INTEGER,
  width                INTEGER,
  height               INTEGER,
  duration_sec         INTEGER,
  caption              TEXT,
  is_approved          INTEGER NOT NULL DEFAULT 1,
  uploaded_by_guest_id TEXT REFERENCES guests(id) ON DELETE SET NULL,
  uploaded_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  position             INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_event ON media(event_id, section, is_approved, position);

CREATE TABLE IF NOT EXISTS pageviews (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id   TEXT REFERENCES guests(id) ON DELETE SET NULL,
  source     TEXT,                                   -- 'wa','ig','direct','qr'
  referrer   TEXT,
  ip_hash    TEXT,
  user_agent TEXT,
  device     TEXT,                                   -- 'mobile','desktop','tablet'
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pageviews_event ON pageviews(event_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   TEXT REFERENCES events(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                          -- 'rsvp.new','guestbook.new','guestcam.new'
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at, created_at);

-- ─── [G] VIEW BANTU DASHBOARD ──────────────────────────────────────────────
CREATE VIEW IF NOT EXISTS v_event_stats AS
SELECT
  e.id AS event_id,
  e.slug,
  (SELECT COUNT(*) FROM guests g WHERE g.event_id = e.id)                                  AS total_guests,
  (SELECT COUNT(*) FROM guests g WHERE g.event_id = e.id AND g.opened_at IS NOT NULL)      AS guests_opened,
  (SELECT COUNT(*) FROM guests g WHERE g.event_id = e.id AND g.rsvp_status = 'hadir')      AS guests_hadir,
  -- pax dihitung dari kiriman RSVP (termasuk yang diubah manual oleh panitia,
  -- source='manual'); bukan dari guests.rsvp_pax yang mungkin belum tersinkron.
  (SELECT COALESCE(SUM(r.pax), 0) FROM rsvps r
     WHERE r.event_id = e.id AND r.attendance = 'hadir')                                    AS pax_hadir,
  (SELECT COUNT(*) FROM guests g WHERE g.event_id = e.id AND g.rsvp_status = 'berhalangan') AS guests_berhalangan,
  (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id)                                   AS rsvp_total,
  (SELECT COUNT(*) FROM guestbook b WHERE b.event_id = e.id AND b.is_approved = 1)         AS wishes_total,
  (SELECT COUNT(*) FROM media m WHERE m.event_id = e.id AND m.section = 'guestcam')        AS guestcam_total,
  (SELECT COUNT(*) FROM pageviews p WHERE p.event_id = e.id)                               AS views_total
FROM events e;


-- ============================================================================
-- MIGRASI LANJUTAN (isi lengkap; jalankan setelah 0001/0002 siap)
-- ============================================================================

-- ─── 0003_checkin.sql (Fase 7) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_tables (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                          -- "Meja 1"
  zone       TEXT,                                   -- "VIP","Keluarga","Umum"
  capacity   INTEGER NOT NULL DEFAULT 10,
  note       TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (event_id, name)
);

CREATE TABLE IF NOT EXISTS checkins (
  id                 TEXT PRIMARY KEY,
  event_id           TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id           TEXT REFERENCES guests(id) ON DELETE SET NULL,
  agenda_id          TEXT REFERENCES event_agenda(id) ON DELETE SET NULL,
  scanned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  pax                INTEGER NOT NULL DEFAULT 1,
  method             TEXT NOT NULL DEFAULT 'qr'
                     CHECK (method IN ('qr','manual','import')),
  device             TEXT,
  client_uuid        TEXT UNIQUE,                    -- idempotensi sinkron offline
  revoked_at         TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkins_event ON checkins(event_id, created_at);
-- Catatan: kolom guests.seat_table_id sudah dibuat pada 0001. SQLite tidak
-- mendukung ALTER TABLE ADD CONSTRAINT, sehingga integritas relasinya dijaga
-- lapisan service (bukan FK) agar skema tetap ringan.

-- ─── 0004_comms.sql (Fase 5) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_templates (
  id         TEXT PRIMARY KEY,
  event_id   TEXT REFERENCES events(id) ON DELETE CASCADE,   -- NULL = template sistem
  channel    TEXT NOT NULL CHECK (channel IN ('wa','email','sms')),
  key        TEXT NOT NULL,                          -- 'invitation','reminder_h1','thank_you'
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,                          -- {nama},{sapaan},{link},{tanggal}
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id, channel, key)
);

CREATE TABLE IF NOT EXISTS blast_jobs (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL DEFAULT 'wa' CHECK (channel IN ('wa','email','sms')),
  template_id  TEXT REFERENCES message_templates(id) ON DELETE SET NULL,
  filter       TEXT NOT NULL DEFAULT '{}',           -- JSON: {group_id, rsvp_status}
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','queued','running','done','failed','cancelled')),
  total        INTEGER NOT NULL DEFAULT 0,
  sent         INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT, started_at TEXT, finished_at TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blast_jobs_event ON blast_jobs(event_id, status);

CREATE TABLE IF NOT EXISTS blast_messages (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES blast_jobs(id) ON DELETE CASCADE,
  guest_id      TEXT REFERENCES guests(id) ON DELETE SET NULL,
  to_addr       TEXT,
  rendered_body TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','sent','delivered','read','failed','skipped')),
  provider_id   TEXT,
  error         TEXT,
  opened_at     TEXT,
  sent_at       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blast_msg ON blast_messages(job_id, status);


-- ─── 0005_commercial.sql (Fase 8) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id               TEXT PRIMARY KEY,                 -- 'free','basic','premium'
  name             TEXT NOT NULL,
  price_idr        INTEGER NOT NULL DEFAULT 0,
  duration_days    INTEGER NOT NULL DEFAULT 365,
  max_guests       INTEGER,                          -- NULL = tanpa batas
  premium_themes   INTEGER NOT NULL DEFAULT 0,
  features         TEXT NOT NULL DEFAULT '{}',       -- JSON daftar fitur
  is_active        INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,
  event_id     TEXT REFERENCES events(id) ON DELETE SET NULL,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  plan_id      TEXT REFERENCES plans(id),
  amount_idr   INTEGER NOT NULL,
  discount_idr INTEGER NOT NULL DEFAULT 0,
  total_idr    INTEGER NOT NULL,
  coupon_id    TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','paid','expired','cancelled','refunded')),
  provider     TEXT,                                 -- 'midtrans','xendit','manual'
  provider_ref TEXT,
  paid_at      TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, status);

CREATE TABLE IF NOT EXISTS payments (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider     TEXT,
  method       TEXT,                                 -- 'qris','va','ewallet'
  amount_idr   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','settled','failed','refunded')),
  raw_response TEXT,
  paid_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id, status);

CREATE TABLE IF NOT EXISTS subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   TEXT REFERENCES events(id) ON DELETE CASCADE,
  plan_id    TEXT REFERENCES plans(id),
  started_at TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  auto_renew INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','expired','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_subs_event ON subscriptions(event_id, status);

CREATE TABLE IF NOT EXISTS coupons (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value INTEGER NOT NULL,
  max_uses       INTEGER,
  used_count     INTEGER NOT NULL DEFAULT 0,
  valid_from     TEXT,
  valid_until    TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS domains (
  id          TEXT PRIMARY KEY,
  event_id    TEXT REFERENCES events(id) ON DELETE CASCADE,
  host        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL DEFAULT 'subdomain'
              CHECK (kind IN ('subdomain','custom')),
  verified_at TEXT,
  ssl_status  TEXT,
  created_at  TEXT NOT NULL
);

-- ─── 0006_stats.sql (Fase 6) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stats_daily (
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,                        -- 'YYYY-MM-DD' (zona acara)
  views        INTEGER NOT NULL DEFAULT 0,
  unique_guests INTEGER NOT NULL DEFAULT 0,
  rsvp_yes     INTEGER NOT NULL DEFAULT 0,
  rsvp_no      INTEGER NOT NULL DEFAULT 0,
  wishes       INTEGER NOT NULL DEFAULT 0,
  guestcam     INTEGER NOT NULL DEFAULT 0,
  checkins     INTEGER NOT NULL DEFAULT 0,
  pax_checkin  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, date)
);


-- ============================================================================
-- LAMPIRAN A — RINGKASAN RELASI (ERD teks)
-- ============================================================================
--   users ─┬─< sessions
--          ├─< login_tokens
--          ├─< event_members >─ events          (peran couple|committee|vendor)
--          ├─< permission_grants >─ events
--          ├─< notifications
--          └─< audit_logs
--   themes ─< events >─ plans (logis, lewat orders/subscriptions)
--   themes ─< block_presets ─< event_sections >─ events
--   events ─┬─< event_info_items      (dresscode/protokol/faq)
--           ├─< event_story           (love story)
--           ├─< event_agenda ─< checkins
--           ├─< gift_accounts
--           ├─< guest_groups ─< guests ─┬─< rsvps
--           │                           ├─< guestbook (parent_id = balasan)
--           │                           ├─< media (uploaded_by_guest_id)
--           │                           ├─< checkins
--           │                           └─< blast_messages
--           ├─< media ─< guestbook.media_id / gift_accounts.qr_media_id
--           ├─< pageviews (guest_id opsional)
--           ├─< blast_jobs ─< blast_messages
--           ├─< message_templates
--           ├─< event_tables (guests.seat_table_id, integritas di service)
--           ├─< stats_daily   (PK gabungan event_id + date)
--           ├─< orders ─< payments
--           └─< domains
--   coupons ─< orders ;  plans ─< orders, subscriptions

-- ============================================================================
-- LAMPIRAN B — IMPOR DATA LAMA (server/data/*.json → tabel)
-- ============================================================================
-- Data lama berbentuk JSON di disk (server/store.js). Pemetaan:
--
--   events.json   { id, slug, name, type, preset, revealAt, createdAt, count }
--     → events(id, slug, title=name, kind,
--              kind = 'pernikahan' → 'wedding', selain itu → 'other',
--              settings.legacy_preset = preset,
--              active_until = revealAt, created_at = createdAt,
--              status = 'published' bila revealAt terlewati)
--
--   photos.json   { id, eventSlug, url, thumb, source, createdAt }
--     → media(id, event_id=lookup(eventSlug), kind='photo', section='guestcam',
--              provider = source ('drive' bila URL Drive, selain itu 'local'),
--              url, thumb, created_at = createdAt)
--
--   undangan/undangan.html (hardcoded "Ani & Budi")
--     → baris demo pada 0002_seed.sql (acara slug 'ani-budi') untuk pengujian.
--
-- Prosedur: migrate → import-json (idempoten: lewati id yang sudah ada, tulis
-- import_report.json) → verifikasi jumlah baris setara → baru store.js pensiun.

-- ============================================================================
-- LAMPIRAN C — CATATAN PORTABILITAS POSTGRESQL (Plan B)
-- ============================================================================
-- 1. Hapus "PRAGMA journal_mode = WAL;" dan "PRAGMA foreign_keys = ON;".
-- 2. "INTEGER" untuk boolean → "BOOLEAN" (nilai 0/1 tetap dapat dibaca).
-- 3. "TEXT" untuk JSON → "JSONB" (unggul untuk kueri JSON).
-- 4. CHECK (...) tetap valid; PK gabungan & UNIQUE juga identik.
-- 5. Ganti "CREATE VIEW IF NOT EXISTS" → "CREATE OR REPLACE VIEW".
-- 6. Waktu tetap TEXT ISO-8601 → ubah ke "TIMESTAMPTZ" bila ingin tipe asli.
-- 7. nomor urut: hindari AUTOINCREMENT (skema ini memakai nanoid, jadi tidak ada).
-- 8. Pencarian teks: tambahkan indeks GIN/pg_trgm untuk pencarian nama tamu.
-- Skema ini sengaja memakai subset SQL yang sama agar pemindahan hanya
-- menyentuh driver + DDL (bukan kueri repository).







