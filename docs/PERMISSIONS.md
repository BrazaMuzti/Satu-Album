# PERMISSIONS — Model Akses & Matriks Izin

> Dokumen terkait: [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [DB-SCHEMA.sql](./DB-SCHEMA.sql) · [API.md](./API.md)

## 1. Peran

| Peran | Kode | Login | Cakupan | Ringkas |
| --- | --- | --- | --- | --- |
| Tamu | `guest` | **Tidak** | Per acara via link | Lihat undangan, RSVP, buku tamu, unggah foto, amplop, e-ticket |
| Pengantin | `couple` | Ya | Acara milik/di-share | Pemilik acara: konten, tema, tamu, undangan, laporan, billing |
| Panitia | `committee` | Ya | Acara yang ditugaskan | Daftar tamu, check-in QR, meja, RSVP, ekspor; **tanpa** keuangan |
| Vendor | `vendor` | Ya | Terbatas + `expires_at` | Mis. fotografer: unggah/lihat media; akses berakhir otomatis |
| Admin platform | `superadmin` | Ya | Semua tenant | Katalog tema, pengguna, paket, audit, impersonate |

Catatan: **4 peran yang diminta sudah cukup untuk MVP.** Peran `vendor` tetap dibuat di skema sejak awal karena biayanya nol (satu nilai enum) dan mencegah migrasi di tengah jalan. Tamu tidak pernah dibuatkan akun — cukup baris di tabel `guests`.

## 2. Mekanisme

1. **Peta default role → permission tinggal di kode** (`server/src/lib/permissions.js`). Ini sumber kebenaran, versi-terkontrol, dan teruji.
2. **Override per acara** lewat `event_members.permissions` (JSON): `["+guest.import","-gift.update"]` — tanda `+` menambah, `-` mencabut.
3. **Izin tambahan berbatas waktu** lewat tabel `permission_grants` (`expires_at`, `reason`, `granted_by`).
4. **Fail-closed:** izin default DITOLAK; penambahan harus eksplisit.
5. **Audit:** setiap perubahan izin/peran, ekspor data, penghapusan, dan impersonate ditulis ke `audit_logs`.

### 2.1 Alur pengecekan (middleware)

```js
// server/src/middleware/auth.js  →  requireAuth()
// server/src/middleware/event.js →  requireEventAccess('slug'|'id', {roles})
// server/src/middleware/perm.js  →  requirePermission('guest.import')

router.post('/api/v1/events/:slug/guests/import',
  requireAuth(),
  requireEventAccess(),                 // set req.event + req.member + req.permissions
  requirePermission('guest.import'),    // 403 bila tidak ada
  handler
);
```

```js
// server/src/lib/permissions.js (bentuk data)
export const ROLE_PERMISSIONS = {
  couple:    ['event.read', 'event.update', 'event.publish', /* ... */],
  committee: ['event.read', 'guest.read', 'guest.create', /* ... */],
  vendor:    ['event.read', 'media.read', 'media.upload', /* ... */]
};

export function resolvePermissions(member) {           // member = baris event_members
  const base = new Set(ROLE_PERMISSIONS[member.role] ?? []);
  for (const token of JSON.parse(member.permissions || '[]')) {
    if (token.startsWith('+')) base.add(token.slice(1));
    else if (token.startsWith('-')) base.delete(token.slice(1));
  }
  return base;
}
```


## 3. Izin publik (tamu, tanpa akun)

| Permission | Deskripsi | Batas |
| --- | --- | --- |
| `public.invitation.read` | Lihat undangan berstatus `published` & masih aktif | Acara `private` butuh PIN; `unlisted` tidak terindeks |
| `public.rsvp.create` | Kirim RSVP | Rate limit 10/jam/IP + honeypot |
| `public.guestbook.create` | Kirim ucapan | Rate limit 10/jam/IP; moderasi bila `settings.moderate_wishes` |
| `public.guestcam.upload` | Unggah foto dari halaman undangan | Rate limit 30/jam/IP; moderasi bila diaktifkan |
| `public.checkin.self` | Lihat e-ticket sendiri | Hanya dengan token tamu valid (`?k=`) |

## 4. Matriks izin dashboard

Kolom: 👑 Pengantin · 🎪 Panitia · 📷 Vendor (time-boxed) · 🛡️ Admin platform.
`✓` diizinkan · `–` ditolak · `△` diizinkan dengan syarat (lihat catatan di bawah).

### 4.1 Acara, tema, konten, media

| Modul · Permission | 👑 | 🎪 | 📷 | 🛡️ |
| --- | --- | --- | --- | --- |
| `event.read` | ✓ | ✓ | ✓ | ✓ |
| `event.create` | ✓ | – | – | ✓ |
| `event.update` | ✓ | – | – | ✓ |
| `event.publish` | ✓ | – | – | ✓ |
| `event.delete` | ✓ (audit) | – | – | ✓ |
| `event.transfer` | ✓ | – | – | ✓ |
| `event.impersonate` | – | – | – | ✓ |
| `theme.read` | ✓ | ✓ | ✓ | ✓ |
| `theme.apply` | ✓ | – | – | ✓ |
| `theme.customize` | ✓ | – | – | ✓ |
| `section.read` | ✓ | ✓ | ✓ | ✓ |
| `section.reorder` | ✓ | – | – | ✓ |
| `content.update` | ✓ | – | – | ✓ |
| `media.read` | ✓ | ✓ | ✓ | ✓ |
| `media.upload` | ✓ | ✓ | ✓ | ✓ |
| `media.moderate` | ✓ | ✓ | – | ✓ |
| `media.delete` | ✓ | – | △ (miliknya sendiri) | ✓ |

### 4.2 Tamu, RSVP, buku tamu, amplop

| Modul · Permission | 👑 | 🎪 | 📷 | 🛡️ |
| --- | --- | --- | --- | --- |
| `guest.read` | ✓ | ✓ | △ (nama & meja saja) | ✓ |
| `guest.create` | ✓ | ✓ | – | ✓ |
| `guest.update` | ✓ | ✓ | – | ✓ |
| `guest.delete` | ✓ | – | – | ✓ |
| `guest.import` | ✓ | – | – | ✓ |
| `guest.export` | ✓ | △ (tanpa nomor HP) | – | ✓ |
| `guest.link.read` | ✓ | ✓ | – | ✓ |
| `guest.qr.generate` | ✓ | ✓ | – | ✓ |
| `rsvp.read` | ✓ | ✓ | – | ✓ |
| `rsvp.update` | ✓ | ✓ | – | ✓ |
| `rsvp.export` | ✓ | ✓ | – | ✓ |
| `guestbook.read` | ✓ | ✓ | ✓ | ✓ |
| `guestbook.moderate` | ✓ | ✓ | – | ✓ |
| `guestbook.reply` | ✓ | ✓ | – | ✓ |
| `guestbook.delete` | ✓ | – | – | ✓ |
| `gift.read` | ✓ | – | – | ✓ |
| `gift.update` | ✓ | – | – | ✓ |

### 4.3 Check-in, meja, statistik, tim, komunikasi, platform

| Modul · Permission | 👑 | 🎪 | 📷 | 🛡️ |
| --- | --- | --- | --- | --- |
| `checkin.read` | ✓ | ✓ | ✓ | ✓ |
| `checkin.scan` | ✓ | ✓ | ✓ | ✓ |
| `checkin.manual` | ✓ | ✓ | – | ✓ |
| `checkin.undo` | ✓ | ✓ | – | ✓ |
| `checkin.export` | ✓ | ✓ | – | ✓ |
| `table.read` | ✓ | ✓ | – | ✓ |
| `table.manage` | ✓ | ✓ | – | ✓ |
| `seat.assign` | ✓ | ✓ | – | ✓ |
| `stats.read` | ✓ | ✓ (tanpa data keuangan) | – | ✓ |
| `stats.export` | ✓ | – | – | ✓ |
| `member.read` | ✓ | △ (hanya dirinya) | – | ✓ |
| `member.invite` | ✓ | – | – | ✓ |
| `member.update_role` | ✓ | – | – | ✓ |
| `member.remove` | ✓ | – | – | ✓ |
| `permission.grant` | △ (hanya izin setara/di bawah pengantin) | – | – | ✓ |
| `blast.read` | ✓ | – | – | ✓ |
| `blast.create` | ✓ | – | – | ✓ |
| `blast.send` | ✓ | – | – | ✓ |
| `blast.cancel` | ✓ | – | – | ✓ |
| `template.manage` | ✓ | – | – | ✓ |
| `billing.read` | ✓ | – | – | ✓ |
| `billing.update` | ✓ | – | – | ✓ |
| `audit.read` | ✓ (acara sendiri) | – | – | ✓ (semua acara) |
| `platform.themes.manage` | – | – | – | ✓ |
| `platform.plans.manage` | – | – | – | ✓ |
| `platform.users.manage` | – | – | – | ✓ |
| `platform.events.read` | – | – | – | ✓ |
| `platform.flags.manage` | – | – | – | ✓ |
| `platform.audit.read` | – | – | – | ✓ |


## 5. Aturan yang wajib diuji (invariant)

1. Panitia **tidak pernah** mendapat `gift.*`, `billing.*`, `member.*`, `blast.*`, `event.delete`, `theme.apply`.
2. Vendor wajib punya `expires_at`; setelah lewat, `requireEventAccess` menolak (403) dan sesi terkait dicabut.
3. Minimal satu `couple` aktif per acara; owner terakhir tidak dapat `member.remove` atau `event.transfer`.
4. `guest.read` untuk vendor adalah **proyeksi terbatas** (nama, grup, meja) — endpoint `GET /api/v1/events/:slug/guests?view=minimal`; nomor HP/email tidak dikirim.
5. Semua izin default **deny** (fail-closed); penambahan harus eksplisit.
6. Admin platform wajib mengisi alasan saat impersonate; ditulis ke `audit_logs` (`action='event.impersonate'`).
7. Ekspor data (`guest.export`, `rsvp.export`, `stats.export`) selalu menulis `audit_logs`.
8. Tamu hanya dapat mengakses data miliknya sendiri (`?k=` token) — tidak ada endpoint publik yang mengembalikan daftar tamu.

## 6. Uji tabel-driven (rencana)

```js
// server/test/permissions.test.js  (node:test, tanpa dependensi baru)
const CASES = [
  // [role, method, path, body, expectedStatus]
  ['committee', 'POST', '/api/v1/events/demo/guests/import', { csv: '...' }, 403],
  ['couple',    'POST', '/api/v1/events/demo/guests/import', { csv: '...' }, 200],
  ['committee', 'GET',  '/api/v1/events/demo/gift',          null,           403],
  ['vendor',    'GET',  '/api/v1/events/demo/guests?view=minimal', null,      200],
  ['vendor',    'GET',  '/api/v1/events/demo/guests',        null,           403],
  ['committee', 'POST', '/api/v1/events/demo/checkin',       { client_uuid: 'c1' }, 200],
  ['couple',    'POST', '/api/v1/events/demo/members',       { email: 'x@y.z', role: 'committee' }, 200],
  ['committee', 'POST', '/api/v1/events/demo/members',       { email: 'x@y.z', role: 'committee' }, 403],
  ['superadmin','GET',  '/api/v1/admin/themes',              null,           200],
  ['couple',    'GET',  '/api/v1/admin/themes',              null,           403]
];
```

Setiap endpoint baru **wajib** menambahkan minimal satu baris kasus positif dan satu negatif, sehingga matriks di §4 tidak pernah menyimpang dari kode.

## 7. Pemetaan ke skema database

| Kebutuhan izin | Sumber data |
| --- | --- |
| Izin bawaan peran | kode: `server/src/lib/permissions.js` (`ROLE_PERMISSIONS`) |
| Pengecualian per acara | `event_members.permissions` (JSON `["+...","-..."]`) |
| Izin tambahan sementara | tabel `permission_grants` (`expires_at`, `reason`, `granted_by`) |
| Keanggotaan & peran | tabel `event_members` (`role`, `expires_at`) |
| Admin platform | `users.is_superadmin = 1` |
| Jejak audit | tabel `audit_logs` |



