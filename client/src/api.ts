/* Klien API satu-album — langsung ke Web App Google Apps Script.

   Tidak ada server sendiri lagi: SPA React berbicara **langsung** dengan Web App
   GAS (lihat gas/Code.gs), yang menyimpan foto & metadata album di Google Drive.

   Model akses (tanpa akun):
     - Panitia: token admin `adminToken` (localStorage) → buat/ubah/hapus album.
     - Tamu   : kunci album dari link yang dibagikan (`?k=...`) → lihat & unggah foto.
   Kunci album disimpan di localStorage per slug supaya tamu tidak perlu menempel
   ulang link saat berpindah antara kamera dan galeri.

   Kontrak transport:
     - GET  `<VITE_GAS_URL>?action=<nama>&...`  → baca
     - POST `<VITE_GAS_URL>`                    → tulis (body JSON)
     - Body POST dikirim sebagai `text/plain` supaya browser memperlakukannya
       sebagai *simple request* → tanpa preflight OPTIONS (GAS tidak punya doOptions).
     - GAS selalu membalas HTTP 200, jadi status asli ikut di dalam envelope
       `{ ok, status, code, error, data }` → di sini dipetakan balik ke ApiError
       sehingga pemanggil tetap memakai `err.status`/`err.code` seperti sebelumnya. */
export interface EventType {
  id: string;
  slug: string;
  name: string;
  type: string;
  preset: string;
  revealAt: string | null;
  createdAt: string;
  count?: number;
  uploadKey?: string;
  legacy?: boolean;
}

export interface Photo {
  id: string;
  eventSlug: string;
  name?: string;
  url: string;
  thumb: string;
  source: string;
  createdAt: string;
  size?: number | null;
}

export interface PhotoListResult {
  photos: Photo[];
  count: number;
  stale?: boolean;
  fromCache?: boolean;
  serverTime?: string;
}

export interface UploadResult {
  photo: Photo;
  undoWindowMs: number;
  serverTime: string;
}

/** Error API yang membawa status & kode mesin (mis. "undo-expired", "invalid-key"). */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** true = gangguan jaringan/server, aman untuk dicoba lagi (masuk antrean offline). */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0 || err.status === 429 || err.status >= 500;
  return true; /* TypeError dari fetch = jaringan mati */
}

/* @@APPEND@@ */
