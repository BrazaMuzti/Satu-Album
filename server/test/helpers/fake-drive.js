/* Klien Google Drive palsu (in-memory) untuk test.
   Mendukung hanya query yang benar-benar dipakai app di src/drive-store.js:
     name='X' | mimeType='X' | mimeType contains 'image/' | 'ID' in parents | trashed=false */
let seq = 0;
let clock = Date.parse("2026-01-01T00:00:00.000Z");

function nextId(prefix) {
  seq += 1;
  return prefix + "-" + seq;
}

function nextTime() {
  clock += 1000;
  return new Date(clock).toISOString();
}

export function createFakeDrive() {
  /* `files` = state "di Drive"; disimpan di luar klien supaya bisa "restart":
     bikin klien baru dengan state yang sama (simulasi Render spin-down). */
  const state = { files: new Map(), permissions: [] };

  function matches(file, query) {
    const parts = String(query || "").split(" and ").map((p) => p.trim()).filter(Boolean);
    return parts.every((part) => {
      let m = part.match(/^name='(.*)'$/);
      if (m) return file.name === m[1];
      m = part.match(/^name contains '(.*)'$/);
      if (m) return file.name.includes(m[1]);
      m = part.match(/^mimeType='(.*)'$/);
      if (m) return file.mimeType === m[1];
      m = part.match(/^mimeType contains '(.*)'$/);
      if (m) return String(file.mimeType || "").includes(m[1]);
      m = part.match(/^'(.*)' in parents$/);
      if (m) return (file.parents || []).includes(m[1]);
      if (part === "trashed=false") return !file.trashed;
      if (part === "trashed=true") return Boolean(file.trashed);
      /* Query yang tidak didukung: lebih baik gagal terang-terangan daripada lolos diam-diam. */
      throw new Error("fake-drive: query tidak didukung → " + part);
    });
  }

  function createClient() {
    return {
      files: {
        async list(params = {}) {
          const all = [...state.files.values()].filter((f) => matches(f, params.q));
          if (params.orderBy === "createdTime") all.sort((a, b) => a.createdTime.localeCompare(b.createdTime));
          const size = params.pageSize || 100;
          const fields = String(params.fields || "");
          const out = all.slice(0, size).map((f) => {
            const item = { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, createdTime: f.createdTime };
            if (fields.includes("size")) item.size = String(f.content ? f.content.length : 0);
            return item;
          });
          return { data: { files: out } };
        },

        async get(params = {}, options = {}) {
          const file = state.files.get(params.fileId);
          if (!file) {
            const err = new Error("File not found: " + params.fileId);
            err.status = 404;
            throw err;
          }
          if (params.alt === "media") return { data: file.content };
          return { data: { id: file.id, name: file.name, mimeType: file.mimeType, parents: file.parents, trashed: Boolean(file.trashed) } };
        },

        async create(params = {}) {
          const body = params.requestBody || {};
          const file = {
            id: nextId("file"),
            name: body.name,
            mimeType: body.mimeType || (params.media && params.media.mimeType) || "application/octet-stream",
            parents: body.parents || [],
            createdTime: nextTime(),
            content: params.media ? params.media.body : undefined,
            trashed: false,
          };
          state.files.set(file.id, file);
          return { data: { id: file.id, name: file.name, createdTime: file.createdTime, size: file.content ? String(file.content.length) : undefined } };
        },

        async update(params = {}) {
          const file = state.files.get(params.fileId);
          if (!file) {
            const err = new Error("File not found: " + params.fileId);
            err.status = 404;
            throw err;
          }
          if (params.media) file.content = params.media.body;
          if (params.requestBody && typeof params.requestBody.trashed === "boolean") file.trashed = params.requestBody.trashed;
          if (params.requestBody && params.requestBody.name) file.name = params.requestBody.name;
          return { data: { id: file.id, name: file.name } };
        },

        async delete(params = {}) {
          if (!state.files.has(params.fileId)) {
            const err = new Error("File not found: " + params.fileId);
            err.status = 404;
            throw err;
          }
          state.files.delete(params.fileId);
          return { data: {} };
        },
      },

      permissions: {
        async create(params = {}) {
          state.permissions.push(params);
          return { data: { id: nextId("perm"), ...params.requestBody } };
        },
      },
    };
  }

  return {
    state,
    /** Klien pertama (proses "sekarang"). */
    client: createClient(),
    /** Klien baru atas state yang sama = simulasi proses restart. */
    restart: () => createClient(),
    /** Isi folder: daftar nama file + jumlah foto. */
    inspect(folderName) {
      const folder = [...state.files.values()].find((f) => f.name === folderName);
      if (!folder) return { folder: null, files: [] };
      const files = [...state.files.values()].filter((f) => (f.parents || []).includes(folder.id) && !f.trashed);
      return { folder, files: files.map((f) => f.name) };
    },
    countPhotos(folderName) {
      return this.inspect(folderName).files.filter((n) => n.startsWith("photo-")).length;
    },
  };
}
