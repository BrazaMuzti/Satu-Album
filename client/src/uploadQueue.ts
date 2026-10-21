/* Antrean unggah offline.

   Tujuan: tamu yang kehilangan sinyal di tengah acara TIDAK kehilangan foto.
   Foto disimpan sebagai Blob di IndexedDB (tahan tutup tab / reload), lalu dikirim
   otomatis begitu jaringan kembali. Bila IndexedDB tidak tersedia (mode private
   tertentu), otomatis turun ke antrean memori (hilang saat tab ditutup). */
export interface QueuedPhoto {
  id: string;
  slug: string;
  key: string;
  blob: Blob;
  createdAt: string;
  /** info kecil untuk UI, mis. "2048px" */
  label?: string;
}

const DB_NAME = "satu-album-queue";
const DB_VERSION = 1;
const STORE = "uploads";

const memory = new Map<string, QueuedPhoto>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest
): Promise<{ ok: boolean; value?: T }> {
  const db = await openDb();
  if (!db) return { ok: false };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      request.onsuccess = () => resolve({ ok: true, value: request.result as T });
      request.onerror = () => resolve({ ok: false });
      tx.onabort = () => resolve({ ok: false });
    } catch {
      resolve({ ok: false });
    }
  });
}

export function newQueueId(): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "";
  return uuid || String(Date.now()) + "-" + Math.random().toString(36).slice(2, 10);
}

export async function enqueue(photo: QueuedPhoto): Promise<void> {
  /* Salinan di memori selalu dibuat: jadi cadangan bila IndexedDB diblokir/gagal. */
  await withStore("readwrite", (store) => store.put(photo));
  memory.set(photo.id, photo);
}

export async function removeFromQueue(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
  memory.delete(id);
}

export async function listQueue(slug?: string): Promise<QueuedPhoto[]> {
  const result = await withStore<QueuedPhoto[]>("readonly", (store) => store.getAll());
  const rows = result.ok && Array.isArray(result.value) ? result.value : [...memory.values()];
  const filtered = slug ? rows.filter((row) => row.slug === slug) : rows;
  return filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function queueSize(slug?: string): Promise<number> {
  return (await listQueue(slug)).length;
}

export async function clearQueue(slug?: string): Promise<void> {
  for (const row of await listQueue(slug)) await removeFromQueue(row.id);
}

/** Storage lokal tersedia? Dipakai untuk memberi tahu tamu bila foto tidak bisa disimpan. */
export function hasPersistentQueue(): boolean {
  return typeof indexedDB !== "undefined";
}
