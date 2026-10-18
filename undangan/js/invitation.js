/* ============================================================
   satu-album · undangan — invitation.js
   Logic interaktif bersama:
     · Dashboard: klik kartu menu -> modal aksi kontekstual
     · Invitation: cover-buka, musik, countdown, tambah kalender,
       salin rekening, scroll-reveal, baca parameter ?to=
   Tidak berkonflik dengan main.js (RSVP/ucapan).
   ============================================================ */
(function () {
  "use strict";

  var TANGGAL_WEDDING = new Date("2026-11-20T08:00:00").getTime();

  /* ---------- UTIL ---------- */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  /* ---------- Baca ?to=Nama Tamu ---------- */
  function bacaTamu() {
    try {
      var to = new URLSearchParams(window.location.search).get("to");
      if (to) return decodeURIComponent(to);
    } catch (e) {}
    return "";
  }

  /* =========================================================
     DASHBOARD — modal menu
     ========================================================= */
  function initDashboardModal() {
    var overlay = $("#modalOverlay");
    if (!overlay) return;

    var MENU = {
      kamera: {
        icon: "fa-solid fa-camera",
        accent: "var(--sage)",
        title: "Camera / Scan QR",
        body: "Buka mode kamera acara atau pindai QR dari undangan. Mode ini memerlukan izin akses kamera pada perangkat Anda.",
        actions: [
          { label: "Buka Kamera", cls: "btn", onclick: function () { alert("Membuka kamera… (integrasi client app)"); } },
          { label: "Scan QR", cls: "btn ghost", onclick: function () { alert("Memindai QR… (integrasi client app)"); } }
        ]
      },
      galeri: {
        icon: "fa-regular fa-images",
        accent: "var(--sky)",
        title: "Galeri",
        body: "Koleksi foto & video momen kebersamaan para tamu. Galeri terhubung ke aplikasi satu-album.",
        actions: [
          { label: "Lihat Galeri", cls: "btn", onclick: function () { alert("Membuka galeri… (client app)"); } }
        ]
      },
      undangan: {
        icon: "fa-solid fa-envelope-open-text",
        accent: "var(--lavender)",
        title: "Undangan",
        body: "Tampilan utama undangan digital pernikahan Ani & Budi.",
        actions: [ { label: "Buka Undangan", cls: "btn gold", href: "undangan.html" } ]
      },
      rsvp: {
        icon: "fa-solid fa-clipboard-check",
        accent: "var(--rose)",
        title: "Konfirmasi Kehadiran",
        body: "RSVP Hadir / Berhalangan pada undangan. Anda juga bisa mengisi langsung dari halaman undangan bagian Konfirmasi Kehadiran.",
        actions: [ { label: "Isi di Undangan", cls: "btn gold", href: "undangan.html#rsvp" } ]
      },
      bukutamu: {
        icon: "fa-solid fa-book",
        accent: "var(--rose)",
        title: "Buku Tamu & Ucapan",
        body: "Berikan ucapan & doa terbaik untuk kedua mempelai pada buku tamu.",
        actions: [ { label: "Tulis Ucapan", cls: "btn gold", href: "undangan.html#ucapan" } ]
      },
      amplop: {
        icon: "fa-solid fa-gift",
        accent: "var(--gold)",
        title: "Amplop Digital / Hadiah",
        body: "Kirim tanda kasih secara digital untuk mempelai. Detail rekening tersedia di halaman undangan bagian Amplop Digital.",
        actions: [ { label: "Lihat Amplop", cls: "btn gold", href: "undangan.html#amplop" } ]
      },
      pengaturan: {
        icon: "fa-solid fa-music",
        accent: "var(--peach)",
        title: "Pengaturan Tema & Musik",
        body: "Sesuaikan backsound dan nuansa tema undangan. Pengaturan ini akan tersimpan di perangkat Anda.",
        actions: [ { label: "Buka Pengaturan", cls: "btn", onclick: function () { alert("Pengaturan tema & musik (dalam pengembangan)."); } } ]
      },
      admin: {
        icon: "fa-solid fa-user-gear",
        accent: "var(--graphite)",
        title: "Admin",
        body: "Panel pengelola acara, RSVP, dan statistik. Hanya untuk penyelenggara.",
        actions: [ { label: "Buka Panel Admin", cls: "btn", onclick: function () { alert("Akses admin dilindungi. (integrasi server)"); } } ]
      }
    };

    var modalTitle = $("#modalTitle");
    var modalBody = $("#modalBody");
    var modalActions = $("#modalActions");
    var modalIcon = $("#modalIcon");
    var closeBtn = $("#modalClose");

    function openModal(key) {
      var m = MENU[key];
      if (!m) return;
      modalTitle.textContent = m.title;
      modalIcon.innerHTML = '<i class="' + m.icon + '"></i>';
      modalIcon.style.background = m.accent;

      modalBody.textContent = "";
      var p = document.createElement("p");
      p.textContent = m.body;
      modalBody.appendChild(p);

      modalActions.textContent = "";
      m.actions.forEach(function (a) {
        var b = document.createElement(a.href ? "a" : "button");
        b.className = a.cls || "btn";
        b.textContent = a.label;
        if (a.href) b.href = a.href;
        if (a.onclick) b.addEventListener("click", a.onclick);
        modalActions.appendChild(b);
      });

      overlay.hidden = false;
      requestAnimationFrame(function () { overlay.classList.add("show"); });
      document.body.style.overflow = "hidden";
    }

    function closeModal() {
      overlay.classList.remove("show");
      overlay.hidden = true;
      document.body.style.overflow = "";
    }

    $all(".dash-card").forEach(function (card) {
      card.addEventListener("click", function () {
        openModal(card.getAttribute("data-menu"));
      });
    });

    closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  }  /* -- akhir initDashboardModal -- */

  /* =========================================================
     INVITATION — cover
     ========================================================= */
  function initCover() {
    var cover = $("#coverView");
    var btn = $("#btnOpen");
    if (!cover || !btn) return;

    document.body.style.overflow = "hidden"; // kunci scroll
    btn.addEventListener("click", function () {
      cover.classList.add("cover-hide");
      document.body.style.overflow = "";
    });
  }

  /* =========================================================
     INVITATION — musik latar
     ========================================================= */
  function initMusic() {
    var playBtn = $("#musicBtn");
    var bgm = $("#bgm");
    var icon = $("#musicIcon");
    if (!playBtn || !bgm) return;

    var playing = false;
    bgm.volume = 0.6;

    function toggle() {
      if (playing) {
        bgm.pause();
        playBtn.classList.remove("playing");
        icon.className = "fa-solid fa-music";
      } else {
        bgm.play().then(function () {
          playBtn.classList.add("playing");
          icon.className = "fa-solid fa-volume-high";
        }).catch(function () {
          alert("Musik belum tersedia (isi assets/music/musik.mp3).");
        });
      }
      playing = !playing;
    }
    playBtn.addEventListener("click", toggle);
  }

  /* =========================================================
     INVITATION — countdown
     ========================================================= */
  function initCountdown() {
    var hariEl = $("#cdHari"), jamEl = $("#cdJam"), mntEl = $("#cdMenit"), dtkEl = $("#cdDetik");
    if (!hariEl) return;

    function tick() {
      var diff = TANGGAL_WEDDING - Date.now();
      if (diff < 0) diff = 0;
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      hariEl.textContent = isNaN(d) ? "--" : d;
      jamEl.textContent = isNaN(h) ? "--" : h;
      mntEl.textContent = isNaN(m) ? "--" : m;
      dtkEl.textContent = isNaN(s) ? "--" : s;
    }
    tick();
    setInterval(tick, 1000);
  }

  /* =========================================================
     INVITATION — tambah ke kalender (.ics)
     ========================================================= */
  function initAddCalendar() {
    $all("[data-add-cal]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var parts = (btn.getAttribute("data-add-cal") || "").split("|");
        if (parts.length < 3) return;
        var nama = parts[0], start = parts[1], end = parts[2];
        var ics = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//satu-album//undangan//ID",
          "BEGIN:VEVENT",
          "DTSTART:" + start.replace(/[-:]/g, ""),
          "DTEND:" + end.replace(/[-:]/g, ""),
          "SUMMARY:" + nama,
          "END:VEVENT",
          "END:VCALENDAR"
        ].join("\r\n");
        var blob = new Blob([ics], { type: "text/calendar" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = nama.replace(/\s+/g, "-") + ".ics";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    });
  }

  /* =========================================================
     INVITATION — salin rekening
     ========================================================= */
  function initCopyRek() {
    var btn = $("#copyRek");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var teks = "BNI — 1234 5678 9012 a.n. Ani & Budi";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(teks).then(function () {
          var i = btn.querySelector("i");
          i.className = "fa-solid fa-check";
          btn.childNodes[2].nodeValue = " Nomor berhasil disalin ✓";
          setTimeout(function () {
            i.className = "fa-solid fa-copy";
            btn.childNodes[2].nodeValue = " Salin Nomor Rekening";
          }, 2500);
        });
      } else {
        alert("Salin manual: " + teks);
      }
    });
  }

  /* =========================================================
     INVITATION — scroll reveal + isi nama tamu
     ========================================================= */
  function initScrollReveal() {
    var sections = $all(".inv-section");
    if (!sections.length) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) en.target.classList.add("visible");
      });
    }, { threshold: 0.12 });

    sections.forEach(function (s) { io.observe(s); });
  }

  function initGuestName() {
    var nama = bacaTamu();
    if (!nama) return;
    var input = $("#rsvp-nama");
    if (input && !input.value) input.value = nama;
    var form = $("#form-rsvp");
    if (form) {
      var hint = document.createElement("p");
      hint.className = "muted";
      hint.style.marginTop = "0.6rem";
      hint.textContent = "Dear " + nama + ", mohon konfirmasi kehadiran Anda.";
      form.insertBefore(hint, form.querySelector("button"));
    }
  }

  /* =========================================================
     INIT
     ========================================================= */
  document.addEventListener("DOMContentLoaded", function () {
    if ($("#menuGrid") || $("#modalOverlay")) initDashboardModal();
    if ($("#coverView")) initCover();
    if ($("#musicBtn")) initMusic();
    if ($("#cdHari")) initCountdown();
    if ($("[data-add-cal]")) initAddCalendar();
    if ($("#copyRek")) initCopyRek();
    initScrollReveal();
    initGuestName();
  });
})();