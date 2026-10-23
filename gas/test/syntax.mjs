/* Pemeriksa sintaks berkas .gs.

   `node --check gas/Code.gs` gagal di Node modern (ERR_UNKNOWN_FILE_EXTENSION),
   jadi berkas dikompilasi langsung dengan `vm.Script`. Jalankan:

     node gas/test/syntax.mjs

   Keluar dengan kode 1 bila ada berkas yang gagal dikompilasi. */

import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { GAS_DIR, gasFiles } from "./harness.mjs";

const files = gasFiles();
let failed = 0;

for (const file of files) {
  const code = readFileSync(path.join(GAS_DIR, file), "utf8");
  try {
    new vm.Script(code, { filename: file });
    console.log("ok    " + file);
  } catch (err) {
    failed += 1;
    console.error("GAGAL " + file + " → " + err.message);
  }
}

console.log(files.length + " berkas diperiksa, " + failed + " gagal.");
process.exit(failed === 0 ? 0 : 1);
