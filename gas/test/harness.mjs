/* Harness uji untuk kode Apps Script (gas/*.gs).

   Tidak ada dependensi eksternal: kode .gs dimuat ke satu konteks `node:vm`
   dengan tiruan DriveApp, CacheService, PropertiesService, Utilities,
   ContentService, dan Logger — cukup untuk menguji seluruh router `Code.gs`
   tanpa menyentuh kuota Google.

   Batasan yang sengaja ditiru dari GAS asli:
     - CacheService: nilai wajib String, maksimum ±100 KB per kunci.
     - Utilities.base64Decode: melempar error untuk base64 tidak valid.
     - File/Folder bersifat iteratif (hasNext/next); berkas di Trash tidak
       muncul di getFiles()/getFilesByName().
     - Folder.createFile menerima Blob maupun (nama, isi, mime). */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GAS_DIR = path.resolve(HERE, "..");

export function gasFiles() {
  return fs
    .readdirSync(GAS_DIR)
    .filter((name) => name.endsWith(".gs"))
    .sort();
}

function iterator(items) {
  let index = 0;
  return {
    hasNext: () => index < items.length,
    next: () => {
      if (index >= items.length) throw new Error("iterator sudah habis");
      index += 1;
      return items[index - 1];
    },
  };
}

function createFakeDrive(state) {
  const folders = new Map();
  const files = new Map();
  let seq = 0;
  const nextId = (prefix) => prefix + String((seq += 1)).padStart(4, "0");

  const stamp = () => Date.now() - state.rewindMs;
  const children = (parentId) => [...folders.values()].filter((f) => f.parentId === parentId && !f.trashed);
  const filesIn = (folderId) => [...files.values()].filter((f) => f.parentId === folderId && !f.trashed);

  function makeFile({ name, mimeType, bytes, parentId }) {
    const file = {
      kind: "file",
      id: nextId("file"),
      name,
      mimeType,
      bytes: Buffer.from(bytes || []),
      parentId: parentId ?? null,
      createdMs: stamp(),
      trashed: false,
      sharing: null,
      getId: () => file.id,
      getName: () => file.name,
      getMimeType: () => file.mimeType,
      getSize: () => file.bytes.length,
      getDateCreated: () => new Date(file.createdMs),
      isTrashed: () => file.trashed,
      setTrashed: (value) => {
        file.trashed = Boolean(value);
        return file;
      },
      setSharing: (access, permission) => {
        file.sharing = { access, permission };
        return file;
      },
      setContent: (content) => {
        file.bytes = Buffer.from(String(content), "utf8");
        return file;
      },
      getBlob: () => ({
        getName: () => file.name,
        getContentType: () => file.mimeType,
        getBytes: () => [...file.bytes],
        getDataAsString: () => file.bytes.toString("utf8"),
      }),
      getParents: () => iterator([...folders.values()].filter((f) => f.id === file.parentId)),
    };
    files.set(file.id, file);
    return file;
  }

  function makeFolder(name, parentId) {
    const folder = {
      kind: "folder",
      id: nextId("folder"),
      name,
      parentId: parentId ?? null,
      createdMs: stamp(),
      trashed: false,
      getId: () => folder.id,
      getName: () => folder.name,
      getDateCreated: () => new Date(folder.createdMs),
      isTrashed: () => folder.trashed,
      setTrashed: (value) => {
        folder.trashed = Boolean(value);
        return folder;
      },
      getFolders: () => iterator(children(folder.id)),
      getFoldersByName: (value) => iterator(children(folder.id).filter((f) => f.name === value)),
      getFiles: () => iterator(filesIn(folder.id)),
      getFilesByName: (value) => iterator(filesIn(folder.id).filter((f) => f.name === value)),
      createFolder: (value) => makeFolder(value, folder.id),
      createFile: (...args) => {
        const [first, second, third] = args;
        const blob =
          typeof first === "string"
            ? {
                getName: () => first,
                getContentType: () => third || "application/octet-stream",
                getBytes: () => [...Buffer.from(String(second ?? ""), "utf8")],
              }
            : first;
        return makeFile({
          name: blob.getName(),
          mimeType: blob.getContentType(),
          bytes: blob.getBytes(),
          parentId: folder.id,
        });
      },
    };
    folders.set(folder.id, folder);
    return folder;
  }

  const DriveApp = {
    Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK", ANYONE: "ANYONE", DOMAIN_WITH_LINK: "DOMAIN_WITH_LINK" },
    Permission: { VIEW: "VIEW", EDIT: "EDIT", COMMENT: "COMMENT" },
    createFolder: (name) => makeFolder(name, null),
    getFolderById: (id) => {
      const folder = folders.get(id);
      if (!folder || folder.trashed) throw new Error("Folder tidak ditemukan: " + id);
      return folder;
    },
    getFoldersByName: (name) =>
      iterator([...folders.values()].filter((f) => f.name === name && f.parentId === null && !f.trashed)),
    getFolders: () => iterator(children(null)),
    getFileById: (id) => {
      const file = files.get(id);
      if (!file) throw new Error("File tidak ditemukan: " + id);
      return file;
    },
    getFilesByName: (name) => iterator([...files.values()].filter((f) => f.name === name && !f.trashed)),
  };

  /* Setiap panggilan DriveApp tingkat atas bisa dipaksa gagal:
     `state.driveFailure = "Service invoked too many times"` → meniru error GAS. */
  const guardedDriveApp = {};
  for (const key of Object.keys(DriveApp)) {
    const value = DriveApp[key];
    guardedDriveApp[key] =
      typeof value === "function"
        ? (...args) => {
            if (state.driveFailure) throw new Error(state.driveFailure);
            return value(...args);
          }
        : value;
  }

  return {
    DriveApp: guardedDriveApp,
    helpers: {
      folders,
      files,
      /** Buat folder apa pun (fixture, mis. album dari versi Express lama). */
      addFolder: (name, parentId = null) => makeFolder(name, parentId),
      /** Buat file non-gambar (mis. event.json milik fixture). */
      addFile: (folderId, name, content, mimeType = "application/json") =>
        makeFile({ name, mimeType, bytes: Buffer.from(String(content), "utf8"), parentId: folderId }),
      filesIn,
      children,
      foldersNamed: (name) => [...folders.values()].filter((f) => f.name === name),
    },
  };
}

function createSandbox(state, properties) {
  const cache = new Map();
  const logs = [];
  state.cache = cache;
  state.logs = logs;
  state.properties = { ...properties };

  const scriptProperties = {
    getProperties: () => ({ ...state.properties }),
    getProperty: (key) => (key in state.properties ? state.properties[key] : null),
    setProperty: (key, value) => {
      state.properties[key] = String(value);
      return scriptProperties;
    },
    setProperties: (values, deleteAllOthers) => {
      if (deleteAllOthers) state.properties = {};
      for (const [key, value] of Object.entries(values || {})) {
        if (value === null || value === undefined) delete state.properties[key];
        else state.properties[key] = String(value);
      }
      return scriptProperties;
    },
    deleteProperty: (key) => {
      delete state.properties[key];
      return scriptProperties;
    },
  };

  const scriptCache = {
    get: (key) => {
      const entry = cache.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
      }
      return entry.value;
    },
    put: (key, value, seconds) => {
      if (typeof value !== "string") throw new Error("CacheService: nilai harus String");
      if (key.length > 250) throw new Error("CacheService: kunci melebihi 250 byte");
      if (value.length > 100000) throw new Error("CacheService: nilai melebihi 100 KB (harus dipecah)");
      const ttl = Number(seconds);
      if (!Number.isFinite(ttl) || ttl < 1) throw new Error("CacheService: expiration harus >= 1 detik");
      cache.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
    },
    remove: (key) => cache.delete(key),
  };

  /* ── Tiruan SpreadsheetApp (database) ──────────────────────────────── */

  const sheets = new Map();
  state.sheets = sheets;
  state.spreadsheetId = state.properties.SHEET_ID || "sheet_test";

  function makeSheet(name) {
    const rows = [];
    const sheet = {
      getName: () => name,
      getLastRow: () => rows.length,
      getLastColumn: () => rows.reduce((max, row) => Math.max(max, row.length), 0),
      appendRow: (values) => {
        rows.push([...values]);
        return sheet;
      },
      getRange: (row, col, numRows = 1, numCols = 1) => ({
        getValues: () => {
          const out = [];
          for (let r = 0; r < numRows; r += 1) {
            const source = rows[row - 1 + r] || [];
            const line = [];
            for (let c = 0; c < numCols; c += 1) {
              const value = source[col - 1 + c];
              line.push(value === undefined || value === null ? "" : value);
            }
            out.push(line);
          }
          return out;
        },
        setValues: (values) => {
          for (let r = 0; r < values.length; r += 1) {
            const target = row - 1 + r;
            while (rows.length <= target) rows.push([]);
            for (let c = 0; c < values[r].length; c += 1) {
              rows[target][col - 1 + c] = values[r][c];
            }
          }
          return this;
        },
        setNumberFormat: () => ({ setNumberFormat: () => null }),
      }),
      deleteRow: (index) => {
        rows.splice(index - 1, 1);
        return sheet;
      },
      setFrozenRows: () => sheet,
      getDataRange: () => sheet.getRange(1, 1, Math.max(rows.length, 1), Math.max(sheet.getLastColumn(), 1)),
      getSheetValues: (row, col, numRows, numCols) =>
        sheet.getRange(row, col, numRows, numCols).getValues(),
      clear: () => {
        rows.length = 0;
        return sheet;
      },
    };
    sheets.set(name, sheet);
    return sheet;
  }

  const spreadsheet = {
    getId: () => state.spreadsheetId,
    getName: () => "Fake Spreadsheet",
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => makeSheet(name),
    getSheets: () => [...sheets.values()],
  };

  const SpreadsheetApp = {
    openById: (id) => {
      if (state.sheetFailure) throw new Error(state.sheetFailure);
      if (String(id) !== String(state.spreadsheetId)) throw new Error("Spreadsheet tidak ditemukan: " + id);
      return spreadsheet;
    },
    flush: () => undefined,
  };

  const sandbox = {
    console,
    PropertiesService: { getScriptProperties: () => scriptProperties },
    CacheService: { getScriptCache: () => scriptCache },
    SpreadsheetApp,

    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF-8", US_ASCII: "US-ASCII" },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (_algorithm, value) => [...crypto.createHash("sha256").update(String(value)).digest()],
      computeHmacSha256Signature: (value, key) =>
        [...crypto.createHmac("sha256", String(key)).update(String(value)).digest()],
      formatDate: (date, timeZone, format) => {
        /* Hanya format yang dipakai backend: "yyyy-MM-dd" pada zona GMT+7. */
        const d = date instanceof Date ? date : new Date(date);
        const zone = /^GMT([+-])(\d{1,2})$/.exec(String(timeZone || ""));
        const offsetMs = zone ? (zone[1] === "-" ? -1 : 1) * Number(zone[2]) * 3600000 : 0;
        const shifted = new Date(d.getTime() + offsetMs);
        const iso = shifted.toISOString();
        if (format === "yyyy-MM-dd") return iso.slice(0, 10);
        if (format === "yyyy-MM-dd'T'HH:mm:ss") return iso.slice(0, 19);
        return iso;
      },

      base64Decode: (encoded) => {
        const text = String(encoded).replace(/\s+/g, "");
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error("base64 tidak valid");
        return [...Buffer.from(text, "base64")];
      },
      newBlob: (data, contentType, name) => {
        const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data || []);
        return {
          getName: () => name,
          getContentType: () => contentType,
          getBytes: () => [...bytes],
          getDataAsString: () => bytes.toString("utf8"),
        };
      },
    },
    ContentService: {
      MimeType: { JSON: "application/json", JAVASCRIPT: "application/javascript" },
      createTextOutput: (content) => {
        const output = {
          content,
          mimeType: null,
          setMimeType(value) {
            output.mimeType = value;
            return output;
          },
        };
        return output;
      },
    },
    Logger: { log: (...args) => logs.push(args.map((value) => String(value)).join(" ")) },
  };

  const drive = createFakeDrive(state);
  sandbox.DriveApp = drive.DriveApp;
  state.helpers = {
    ...drive.helpers,
    sheets,
    /** Buat tab kosong (tanpa header) untuk fixture. */
    addSheet: (name) => makeSheet(name),
    /** Isi baris mentah (termasuk header) ke tab; tab dibuat bila perlu. */
    seedSheet: (name, rows) => {
      const sheet = sheets.get(name) || makeSheet(name);
      for (const row of rows) sheet.appendRow(row);
      return sheet;
    },
  };
  return sandbox;
}

/**
 * Muat semua gas/*.gs ke satu konteks lalu kembalikan API pemanggilnya.
 * Setiap pemanggilan menghasilkan instance baru (Drive & cache bersih),
 * meniru eksekusi GAS yang selalu mulai dari nol.
 */
export function loadGas(options = {}) {
  const state = { properties: {}, rewindMs: 0, logs: [] };
  const context = vm.createContext(createSandbox(state, options.properties || {}));
  state.fileNames = gasFiles();
  for (const file of state.fileNames) {
    const code = fs.readFileSync(path.join(GAS_DIR, file), "utf8");
    new vm.Script(code, { filename: file }).runInContext(context);
  }

  const asEnvelope = (output) => {
    /* Respons JSONP (mimeType javascript) bukan JSON — simpan mentah saja. */
    const isJson = !output.mimeType || output.mimeType === "application/json";
    return { mimeType: output.mimeType, raw: output.content, json: isJson ? JSON.parse(output.content) : null };
  };

  return {
    state,
    /** GET dengan query parameter (tanpa body). */
    get(params = {}) {
      return asEnvelope(context.doGet({ parameter: { ...params } }));
    },
    /** POST dengan body JSON dalam text/plain (persis seperti klien React). */
    post(body) {
      const contents = typeof body === "string" ? body : JSON.stringify(body === undefined ? {} : body);
      return asEnvelope(context.doPost({ parameter: {}, postData: { contents, type: "text/plain" } }));
    },
    /** Panggil fungsi internal .gs langsung (untuk uji tingkat store). */
    call(name, ...args) {
      return context[name](...args);
    },
  };
}

/** Isi `data` dari envelope sukses; melempar bila `ok:false`. */
export function unwrap(response) {
  const body = response.json;
  if (!body.ok) {
    throw new Error("respons gagal: " + body.status + " " + body.code + " — " + body.error);
  }
  return body.data;
}


