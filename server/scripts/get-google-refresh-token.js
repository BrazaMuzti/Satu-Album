#!/usr/bin/env node
/* ============================================================
   Helper sekali pakai: menukar OAuth authorization code menjadi
   GOOGLE_REFRESH_TOKEN untuk server Satu-Album (mode OAuth2 akun pribadi).

   Prasyarat (Google Cloud Console):
     1. Aktifkan Google Drive API pada project.
     2. OAuth consent screen: User type "External", tambahkan scope
        https://www.googleapis.com/auth/drive.file (non-sensitive).
        Publish status -> "In production" (status "Testing" membuat refresh
        token kedaluwarsa dalam 7 hari).
     3. Credentials -> Create credentials -> OAuth client ID -> "Desktop app".
     4. Isi GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET di bawah / env / argumen.

   Pemakaian:
     GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/get-google-refresh-token.js
     node scripts/get-google-refresh-token.js <client_id> <client_secret>
     node scripts/get-google-refresh-token.js --manual   # salin-tempel code manual

   Hasil: mencetak GOOGLE_REFRESH_TOKEN=... untuk ditempel ke server/.env
   ============================================================ */
import http from "node:http";
import readline from "node:readline";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const MANUAL = process.argv.includes("--manual");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || args[0] || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || args[1] || "";
const PORT = Number(process.env.OAUTH_PORT || 53682);
const REDIRECT_URI = "http://localhost:" + PORT;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET wajib diisi.");
  console.error("Contoh: GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/get-google-refresh-token.js");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",   // minta refresh token, bukan hanya access token
  prompt: "consent",        // paksa Google mengirim refresh_token lagi
  scope: SCOPES,
  redirect_uri: REDIRECT_URI,
});

function cetakToken(tokens) {
  if (!tokens.refresh_token) {
    console.error("\n[!] Google tidak mengirim refresh_token.");
    console.error("    Cabut akses app di https://myaccount.google.com/permissions lalu ulangi.");
    process.exitCode = 1;
    return;
  }
  console.log("\n=== Salin ke server/.env (dan env var di Render) ===\n");
  console.log("GOOGLE_CLIENT_ID=" + CLIENT_ID);
  console.log("GOOGLE_CLIENT_SECRET=" + CLIENT_SECRET);
  console.log("GOOGLE_REFRESH_TOKEN=" + tokens.refresh_token);
  console.log("\nscope: " + tokens.scope);
  console.log("Catatan: refresh token tetap valid selama akses app tidak dicabut.");
}

async function tukarCode(code) {
  const { tokens } = await oauth2.getToken({ code, redirect_uri: REDIRECT_URI });
  cetakToken(tokens);
}

if (MANUAL) {
  console.log("1) Buka URL berikut di browser, lalu setujui akses:\n\n" + authUrl + "\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("2) Tempel kode (nilai code= dari URL callback): ", async (jawaban) => {
    rl.close();
    const match = jawaban.match(/code=([^&\s]+)/);
    const code = decodeURIComponent(match ? match[1] : jawaban.trim());
    try {
      await tukarCode(code);
    } catch (err) {
      console.error("Gagal menukar code: " + err.message);
      process.exitCode = 1;
    }
  });
} else {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, REDIRECT_URI);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (!code && !error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Menunggu callback OAuth...");
      return;
    }
    if (error) {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      res.end("<h2>Akses ditolak: " + error + "</h2>");
      console.error("Akses ditolak: " + error);
      process.exitCode = 1;
      server.close();
      return;
    }
    try {
      await tukarCode(code);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<h2>Berhasil! Refresh token dicetak di terminal.</h2><p>Tab ini boleh ditutup.</p>");
    } catch (err) {
      res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      res.end("<h2>Gagal: " + err.message + "</h2>");
      console.error("Gagal menukar code: " + err.message);
      process.exitCode = 1;
    } finally {
      server.close();
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log("1) Buka URL berikut di browser (login akun Google pemilik Drive):\n");
    console.log(authUrl + "\n");
    console.log("2) Setelah disetujui, browser diarahkan ke " + REDIRECT_URI + " dan token tercetak di sini.");
    console.log('   Kalau callback tidak jalan (port sibuk/diblokir), ulangi dengan opsi --manual');
  });
}
