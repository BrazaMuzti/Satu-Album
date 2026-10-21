/* Error yang bisa diterjemahkan langsung jadi respons HTTP oleh index.js. */
export class StoreError extends Error {
  constructor(message, status = 500, code = "store-error") {
    super(message);
    this.name = "StoreError";
    this.status = status;
    this.code = code;
  }
}

/** Kegagalan sementara penyimpanan (kuota Drive, jaringan, token) → layani cache lama. */
export class StorageUnavailableError extends StoreError {
  constructor(message, cause) {
    super(message, 503, "storage-unavailable");
    this.name = "StorageUnavailableError";
    if (cause) this.cause = cause;
  }
}

export function isStorageUnavailable(err) {
  if (err instanceof StorageUnavailableError) return true;
  if (!err) return false;
  const status = err.status || err.code || err.response?.status;
  if (status === 401 || status === 403 || status === 429 || status === 500 || status === 503) return true;
  return /quota|rate ?limit|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket hang up|network/i.test(String(err.message || ""));
}
