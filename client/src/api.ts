/* Klien API satu-album.

   Model akses (tanpa akun):
     - Panitia: token admin (`x-admin-token`, disimpan di localStorage) → buat/ubah acara.
     - Tamu  : kunci album dari link yang dibagikan (`?k=...`) → lihat & unggah foto.
   Kunci album disimpan di localStorage per slug supaya tamu tidak perlu menempel ulang
   link saat berpindah antara kamera dan galeri.

   Kontrak unggah: biner mentah (`image/jpeg`), BUKAN multipart/form-data. */
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

const API_BASE: string = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
const api = (p: string) => API_BASE + p;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(api(path), init);
  } catch {
    /* fetch melempar hanya saat jaringan bermasalah (offline, DNS, CORS). */
    throw new ApiError("Tidak bisa menghubungi server. Foto akan dikirim ulang otomatis.", 0, "network");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string; code?: string }));
    throw new ApiError(body.error || "HTTP " + res.status, res.status, body.code);
  }
  return (await res.json()) as T;
}

/* ── Token admin ────────────────────────────────────────────────────── */

const ADMIN_KEY = "sa:admin-token";

export function getAdminToken(): string {
  try {
    return localStorage.getItem(ADMIN_KEY) || "";
  } catch {
    return "";
  }
}

export function setAdminToken(token: string) {
  try {
    if (token) localStorage.setItem(ADMIN_KEY, token);
    else localStorage.removeItem(ADMIN_KEY);
  } catch {
    /* localStorage bisa diblokir (mode private) — token hanya berlaku sesi ini */
  }
}

/* ── Kunci album (tamu) ─────────────────────────────────────────────── */

const keyStore = (slug: string) => "sa:key:" + slug;

/** Ambil kunci album dari query `?k=` bila ada (lalu disimpan untuk kunjungan berikutnya). */
export function readKeyFromUrl(slug: string | undefined): string {
  if (!slug || typeof window === "undefined") return "";
  const fromUrl = new URLSearchParams(window.location.search).get("k") || "";
  if (fromUrl) {
    saveKey(slug, fromUrl);
    return fromUrl;
  }
  return getStoredKey(slug);
}

export function getStoredKey(slug: string | undefined): string {
  if (!slug) return "";
  try {
    return localStorage.getItem(keyStore(slug)) || "";
  } catch {
    return "";
  }
}

export function saveKey(slug: string, key: string) {
  try {
    localStorage.setItem(keyStore(slug), key);
  } catch {
    /* abaikan */
  }
}

/** URL yang dibagikan ke tamu (kamera = boleh unggah, galeri = hanya melihat). */
export function shareLinks(slug: string, key: string) {
  const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "");
  const suffix = key ? "?k=" + encodeURIComponent(key) : "";
  return {
    camera: base + "/events/" + slug + "/camera" + suffix,
    gallery: base + "/events/" + slug + suffix,
  };
}

/* ── Endpoint ───────────────────────────────────────────────────────── */

export function createEvent(
  data: { name: string; type: string; preset: string; revealAt: string | null },
  adminToken = getAdminToken()
): Promise<{ event: EventType }> {
  return request("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": adminToken },
    body: JSON.stringify(data),
  });
}

export function getEvent(slug: string, key = ""): Promise<{ event: EventType; authorized: boolean }> {
  const suffix = key ? "?k=" + encodeURIComponent(key) : "";
  return request("/api/events/" + slug + suffix);
}

export function getPhotos(
  slug: string,
  key: string,
  options: { since?: string; refresh?: boolean; signal?: AbortSignal } = {}
): Promise<PhotoListResult> {
  const params = new URLSearchParams();
  if (key) params.set("k", key);
  if (options.since) params.set("since", options.since);
  if (options.refresh) params.set("refresh", "1");
  const query = params.toString();
  return request("/api/events/" + slug + "/photos" + (query ? "?" + query : ""), { signal: options.signal });
}

/** Unggah foto sebagai biner mentah — hemat CPU/RAM dibanding multipart. */
export function uploadPhoto(slug: string, key: string, blob: Blob): Promise<UploadResult> {
  return request("/api/events/" + slug + "/photos", {
    method: "POST",
    headers: { "content-type": "image/jpeg", "x-upload-key": key },
    body: blob,
  });
}

export function deletePhoto(slug: string, key: string, photoId: string): Promise<{ ok: boolean }> {
  return request("/api/events/" + slug + "/photos/" + encodeURIComponent(photoId), {
    method: "DELETE",
    headers: { "x-upload-key": key },
  });
}

export function listEvents(adminToken = getAdminToken()): Promise<{ events: EventType[] }> {
  return request("/api/events?refresh=1", { headers: { "x-admin-token": adminToken } });
}
