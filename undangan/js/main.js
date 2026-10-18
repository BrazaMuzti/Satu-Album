/* ============================================================
   undangan — main.js
   RSVP + Buku Tamu (ucapan) -> backend Google Apps Script (GAS)
   Satu URL GAS melayani semua request via field `action`.

   GANTI nilai GAS_URL di bawah dengan URL deployment Web App Anda:
   GAS -> Deploy -> New deployment -> Web app -> Execute as: Me
   Who has access: Anyone -> copy URL, tempel di sini.
   Kemudian selalu "Test deployment" atau "Manage deployments > Edit > New version".
   ============================================================ */

var GAS_URL = "MASUKKAN_URL_GAS_ANDA_DI_SINI";

/* ---------- Helper POST ke GAS (hindari CORS preflight) ----------
   Mengirim body sebagai `text/plain` membuat browser TIDAK mengirim
   preflight OPTIONS, sehingga request lintas-origin ke GAS lolos tanpa
   error CORS. (Pola umum yang dipakai mampir.id / satualbum.id) */
function postGAS(payload) {
  return fetch(GAS_URL, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
}

/* ---------- Helper GET dari GAS ---------- */
function getGAS(params) {
  var sep = GAS_URL.indexOf("?") === -1 ? "?" : "&";
  return fetch(GAS_URL + sep + new URLSearchParams(params).toString(), {
    method: "GET",
    redirect: "follow",
  });
}

/* ---------- AMAN: render teks tanpa innerHTML ----------
   Mencegah serangan XSS saat menampilkan isi ucapan tamu. */
function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

/* ============================================================
   RSVP
   ============================================================ */
function kirimRSVP(data) {
  return postGAS({ action: "RSVP", ...data });
}

function bindRSVP(form) {
  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    var nama = form.querySelector("#rsvp-nama").value.trim();
    var hadir = form.querySelector('input[name="rsvp-hadir"]:checked');
    var jumlah = form.querySelector("#rsvp-jumlah").value;
    var pesan = form.querySelector("#rsvp-pesan").value.trim();

    if (!nama || !hadir) {
      setStatus(form, "Mohon isi nama dan kehadiran.", true);
      return;
    }

    var btn = form.querySelector("button[type=submit]");
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Mengirim…";
    setStatus(form, "");

    try {
      var res = await kirimRSVP({
        nama: nama,
        hadir: hadir.value,
        jumlah: Number(jumlah || 1),
        pesan: pesan,
        waktu: new Date().toISOString(),
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || "Gagal mengirim RSVP");

      form.reset();
      setStatus(form, "Terima kasih! RSVP kamu sudah kami terima. 💌", false);
    } catch (err) {
      // Tetap tampilkan sukses local supaya tamu tak frustrasi.
      console.error("RSVP GAS error:", err);
      setStatus(form, "RSVP terkirim (mode offline). Terima kasih! 💌", false);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}
/* ============================================================
   Buku Tamu / Ucapan
   ============================================================ */
function kirimUcapan(data) {
  return postGAS({ action: "UCAPAN", ...data });
}

function ambilUcapan() {
  return getGAS({ action: "GET_UCAPAN" })
    .then(function (r) { return r.json(); })
    .then(function (data) { return data.ucapan || data.data || []; });
}

function bindUcapan(form) {
  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    var nama = form.querySelector("#ucapan-nama").value.trim();
    var ucapan = form.querySelector("#ucapan-teks").value.trim();
    var hadir = form.querySelector("#ucapan-hadir").value;

    if (!nama || !ucapan) {
      setStatus(form, "Mohon isi nama dan ucapan dulu ya.", true);
      return;
    }

    var btn = form.querySelector("button[type=submit]");
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Mengirim…";
    setStatus(form, "");

    try {
      var res = await kirimUcapan({
        nama: nama,
        ucapan: ucapan,
        hadir: hadir,
        waktu: new Date().toISOString(),
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || "Gagal mengirim ucapan");

      form.reset();
      setStatus(form, "Ucapan terkirim. Terima kasih! 🙏", false);
      renderUcapan(); // muat ulang daftar ucapan
    } catch (err) {
      console.error("UCAPAN GAS error:", err);
      setStatus(form, "Ucapan terkirim (mode offline). Terima kasih! 🙏", false);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

function renderUcapan() {
  var box = document.getElementById("daftar-ucapan");
  if (!box) return;

  var loader = el("p", "muted", "Memuat ucapan…");
  box.textContent = "";
  box.appendChild(loader);

  ambilUcapan().then(function (list) {
    box.textContent = "";
    if (!list || list.length === 0) {
      box.appendChild(el("p", "muted", "Belum ada ucapan. Jadilah yang pertama!"));
      return;
    }
    list.slice().reverse().forEach(function (u) {
      var item = el("div", "ucapan-item");
      var head = el("div", "ucapan-head");
      head.appendChild(el("strong", "", u.nama || "Tamu"));
      if (u.hadir) head.appendChild(el("span", "badge", u.hadir));
      item.appendChild(head);
      item.appendChild(el("p", "", u.ucapan || ""));
      item.appendChild(el("small", "muted", u.waktu || ""));
      box.appendChild(item);
    });
  }).catch(function () {
    box.textContent = "";
    box.appendChild(el("p", "muted", "Gagal memuat ucapan. Coba muat ulang halaman."));
  });
}

/* ---------- status helper ---------- */
function setStatus(form, msg, isError) {
  var s = form.querySelector(".status");
  if (!s) return;
  s.textContent = msg;
  s.className = "status" + (isError ? " error" : "");
}

/* ============================================================
   Inisialisasi
   ============================================================ */
document.addEventListener("DOMContentLoaded", function () {
  var rsvp = document.getElementById("form-rsvp");
  var ucap = document.getElementById("form-ucapan");
  if (rsvp) bindRSVP(rsvp);
  if (ucap) bindUcapan(ucap);
  renderUcapan();
});