/**
 * Satu-Album - Setup & Diagnostik (Google Apps Script)
 *
 * Semua fungsi di file ini dijalankan MANUAL dari editor Apps Script
 * (pilih fungsi -> Run). Tidak pernah dipanggil dari web app.
 */

/** Base URL frontend yang dipakai untuk membuat link QR. */
const SETUP_DEFAULT_BASE_URL = "https://brazamuzti.github.io/Satu-Album";

/**
 * Jalankan SEKALI setelah SHEET_ID, ADMIN_PIN, SESSION_SECRET diisi.
 * Menyiapkan 8 tab sheet + header, seed admin, dan root folder Drive.
 */
function initSheets() {
  const cfg = config_();
  const report = [];

  if (!cfg.sheetId) {
    throw new Error(
      "SHEET_ID belum diisi. Buka Project Settings > Script Properties, " +
        "tambahkan SHEET_ID = <ID spreadsheet>."
    );
  }

  try {
    const ss = spreadsheet_();
    report.push("Spreadsheet: " + ss.getName() + " (" + ss.getId() + ")");
  } catch (err) {
    throw new Error(
      "Tidak bisa membuka spreadsheet SHEET_ID=" + cfg.sheetId + ". " + (err && err.message)
    );
  }

  const created = ensureSchema_();
  report.push(created.length ? "Tab dibuat: " + created.join(", ") : "Semua tab sudah ada.");

  if (!cfg.adminPin) {
    /* Seed butuh PIN; pakai PIN sementara agar initSheets tidak gagal. */
    setConfigProperty_("ADMIN_PIN", "123456");
    report.push(
      "ADMIN_PIN kosong -> admin dibuat dengan PIN sementara '123456'. " +
        "Segera ganti PIN dari panel admin (action=login lalu ganti PIN)."
    );
  }
  const admin = seedAdminFromConfig_();
  report.push(admin ? "Admin: " + admin.admin_id + " (" + admin.nama + ")" : "Admin: sudah ada.");

  const root = driveRoot_();
  report.push("Root folder Drive: " + root.getName() + " (" + root.getId() + ")");

  if (!cfg.baseUrl) {
    report.push(
      "BASE_URL kosong -> link QR memakai default " + SETUP_DEFAULT_BASE_URL +
        ". Jalankan setBaseUrl() bila domain berbeda."
    );
  } else {
    report.push("Base URL frontend: " + cfg.baseUrl);
  }

  report.push("SELESAI. Langkah berikutnya:");
  report.push("1. Deploy > New deployment > Web app (Execute as: Me, Access: Anyone).");
  report.push("2. Salin URL /exec ke konstanta API_BASE di web/assets/app.js.");
  report.push("3. Upload web/ ke GitHub Pages.");

  const text = report.join("\n");
  Logger.log(text);
  return text;
}

/** Mengatur BASE_URL (dipakai untuk link QR / undangan). */
function setBaseUrl() {
  setConfigProperty_("BASE_URL", SETUP_DEFAULT_BASE_URL);
  Logger.log("BASE_URL = " + publicBaseUrl_());
  return publicBaseUrl_();
}

/** Ringkasan cepat isi spreadsheet + Drive. */
function showHealth() {
  const health = health_();
  Logger.log(JSON.stringify(health, null, 2));
  return health;
}

/** Daftar semua event beserta link publiknya. */
function showEvents() {
  const events = listEventsForAdmin_();
  events.forEach(function (ev) {
    Logger.log(
      [ev.slug, ev.nama, ev.jenis, ev.aktif ? "aktif" : "nonaktif", (ev.count || 0) + " foto"].join(" | ") +
        "\n  kamera   : " + ev.links.camera +
        "\n  galeri   : " + ev.links.galeri +
        "\n  undangan : " + ev.links.undangan +
        "\n  rsvp     : " + ev.links.rsvp
    );
  });
  Logger.log("Total event: " + events.length);
  return events;
}

/**
 * Sinkronisasi semua folder Drive (event-*) ke sheet Photos.
 * Cocok dijalankan manual maupun lewat trigger harian.
 */
function syncAllDrivePhotos() {
  const rows = listEventRows_(false);
  const summary = [];
  let totalAdded = 0;

  rows.forEach(function (row) {
    try {
      let added = 0;
      let guard = 0;
      let more = true;
      while (more && guard < 10) {
        const res = syncDrivePhotos_(row, {});
        added += res.added;
        more = res.hasMore;
        guard += 1;
      }
      totalAdded += added;
      summary.push(row.slug + ": +" + added);
    } catch (err) {
      summary.push(row.slug + ": ERROR " + (err && err.message));
    }
  });

  const text = summary.join("\n") + "\n\nTotal foto baru: " + totalAdded;
  Logger.log(text);
  return text;
}

/** Pasang trigger sinkronisasi Drive otomatis setiap 6 jam. */
function installDriveSyncTrigger() {
  const handler = "syncAllDrivePhotos";
  const existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === handler;
  });
  existing.forEach(function (t) {
    ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(handler).timeBased().everyHours(6).create();
  Logger.log("Trigger " + handler + " terpasang (setiap 6 jam).");
  return true;
}

/** Uji cepat seluruh komponen backend. */
function selfTest() {
  const steps = [];
  const check = function (label, fn) {
    try {
      const value = fn();
      steps.push("OK   " + label + (value === undefined ? "" : " -> " + value));
      return true;
    } catch (err) {
      steps.push("FAIL " + label + " -> " + (err && err.message ? err.message : err));
      return false;
    }
  };

  check("config_()", function () {
    const cfg = config_();
    return "version=" + cfg.version + ", sheetId=" + (cfg.sheetId ? "ada" : "KOSONG");
  });
  check("spreadsheet_()", function () {
    return spreadsheet_().getName();
  });
  check("ensureSchema_()", function () {
    return ensureSchema_();
  });
  check("driveRoot_()", function () {
    return driveRoot_().getName();
  });
  check("listEventRows_()", function () {
    return listEventRows_(false).length + " event";
  });
  check("cache round-trip", function () {
    const key = "selftest:" + Date.now();
    cachePutJson_(key, { ok: true });
    const got = cacheGetJson_(key);
    cacheRemove_(key);
    return got && got.ok ? "ok" : "GAGAL";
  });

  const text = steps.join("\n");
  Logger.log(text);
  return text;
}
