// Cek referensi fungsi/variabel antar file .gs (statis, tanpa menjalankan kode).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "..");

/* Global & method bawaan GAS/JS yang boleh muncul tanpa definisi. */
const BUILTINS = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "in", "of", "do", "else",
  "Logger", "SpreadsheetApp", "DriveApp", "CacheService", "Utilities", "ContentService", "ScriptApp",
  "PropertiesService", "Session", "JSON", "Math", "Date", "String", "Number", "Array", "Object", "Boolean",
  "RegExp", "Error", "Set", "Map", "WeakMap", "Promise", "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURIComponent", "decodeURIComponent", "atob", "btoa", "URL", "console", "require",
  "constructor", "super",
]);

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".gs"));
const sources = {};
for (const f of files) sources[f] = fs.readFileSync(path.join(dir, f), "utf8");

/** Buang komentar dan literal string/template agar isinya tidak ikut dipindai. */
function stripNoise(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const defined = new Set();
const definedIn = new Map();
const mark = (name, file) => {
  defined.add(name);
  if (!definedIn.has(name)) definedIn.set(name, file);
};

/* Nama lokal (variabel & parameter) — boleh dipanggil tanpa definisi global. */
const locals = new Set();
function scanLocals(code) {
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) locals.add(m[1]);
  for (const m of code.matchAll(/function\s+([A-Za-z0-9_$]+)/g)) locals.add(m[1]);
  for (const m of code.matchAll(/function\s*[A-Za-z0-9_$]*\s*\(([^)]*)\)/g)) addParams(m[1]);
  for (const m of code.matchAll(/\(([^)]*)\)\s*=>/g)) addParams(m[1]);
  for (const m of code.matchAll(/([A-Za-z0-9_$]+)\s*=>/g)) locals.add(m[1]);
}
function addParams(list) {
  for (const part of String(list).split(",")) {
    const name = part.split("=")[0].trim();
    if (/^[A-Za-z0-9_$]+$/.test(name)) locals.add(name);
  }
}

const clean = {};
for (const f of files) {
  clean[f] = stripNoise(sources[f]);
  scanLocals(clean[f]);
  for (const m of clean[f].matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)) mark(m[1], f);
  for (const m of clean[f].matchAll(/^class\s+([A-Za-z0-9_]+)\s*(?:extends|\{)/gm)) mark(m[1], f);
  for (const m of clean[f].matchAll(/^(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=/gm)) mark(m[1], f);
}

const used = new Map();
/* Hanya pemanggilan fungsi bebas: bukan `obj.method(`, bukan nama lokal. */
const CALL = /(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
for (const f of files) {
  for (const m of clean[f].matchAll(CALL)) {
    const name = m[1];
    if (BUILTINS.has(name) || (locals.has(name) && !defined.has(name))) continue;
    if (!used.has(name)) used.set(name, new Set());
    used.get(name).add(f);
  }
}

const missing = [...used.keys()].filter((n) => !defined.has(n)).sort();
const unused = [...defined.keys()]
  .filter((n) => !used.has(n) && !/^(apiResponse_|doGet|doPost|initSheets|setBaseUrl|showHealth|showEvents|syncAllDrivePhotos|installDriveSyncTrigger|selfTest)$/.test(n))
  .sort();

console.log("File .gs:", files.length, "| definisi:", defined.size, "| dipakai:", used.size);
if (missing.length) {
  console.log("\n-- TIDAK DITEMUKAN --");
  for (const n of missing) console.log("  " + n + "  <- " + [...used.get(n)].join(", "));
} else {
  console.log("\nSemua referensi helper ditemukan.");
}
if (unused.length) console.log("\n-- definisi tanpa pemakaian (info saja) --\n  " + unused.join(", "));
process.exit(missing.length ? 1 : 0);
