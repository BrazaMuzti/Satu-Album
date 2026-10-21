/* Env khusus test Drive. HARUS di-import sebagai baris import PERTAMA di file test,
   karena import statik lain (store.js/drive.js) membaca env saat modul dievaluasi. */
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_REFRESH_TOKEN = "test-refresh-token";
process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME = "Satu-Album-Test";
process.env.SA_META_FLUSH_MS = "20";
process.env.SA_CACHE_TTL_MS = "1";

export const ROOT_FOLDER_NAME = process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME;
