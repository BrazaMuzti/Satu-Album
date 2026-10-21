/* Buat album (khusus panitia): butuh token admin, lalu menampilkan link untuk dibagikan.
   Link kamera memuat kunci tamu (`?k=`) sehingga tamu bisa memotret tanpa akun. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { EventType, createEvent, getAdminToken, setAdminToken, shareLinks } from "./api";
import { PRESETS, PresetId } from "./filmPresets";

const TYPES = ["pernikahan", "ulang tahun", "reuni", "acara kantor", "lainnya"];

export default function Create() {
  const [name, setName] = useState("");
  const [type, setType] = useState(TYPES[0]);
  const [preset, setPreset] = useState<PresetId>("funsaver");
  const [token, setToken] = useState(getAdminToken());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<EventType | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setErr("Isi token admin dulu (dari ADMIN_TOKEN di server).");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      setAdminToken(token.trim());
      const result = await createEvent({ name, type, preset, revealAt: null }, token.trim());
      setCreated(result.event);
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setErr("Tidak bisa menyalin otomatis — salin manual dari kotak di atas.");
    }
  };

  if (created) {
    const links = shareLinks(created.slug, created.uploadKey || "");
    return (
      <div className="create-form">
        <h1>Album siap 🎉</h1>
        <p className="page-note small">
          {created.name} — bagikan link kamera ke tamu. Link galeri untuk yang hanya ingin melihat.
        </p>

        <label>
          Link kamera (tamu boleh memotret)
          <input readOnly value={links.camera} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <div className="link-row">
          <button className="btn small" onClick={() => copy("camera", links.camera)}>
            {copied === "camera" ? "Tersalin ✓" : "Salin link kamera"}
          </button>
          <Link className="btn ghost small" to={"/events/" + created.slug + "/camera?k=" + (created.uploadKey || "")}>
            Buka kamera →
          </Link>
        </div>

        <label>
          Link galeri (hanya melihat)
          <input readOnly value={links.gallery} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <div className="link-row">
          <button className="btn small" onClick={() => copy("gallery", links.gallery)}>
            {copied === "gallery" ? "Tersalin ✓" : "Salin link galeri"}
          </button>
          <Link className="btn ghost small" to={"/events/" + created.slug + "?k=" + (created.uploadKey || "")}>
            Buka galeri →
          </Link>
        </div>

        {err && <p className="page-note small">{err}</p>}
        <button
          className="btn ghost"
          onClick={() => {
            setCreated(null);
            setName("");
            setErr(null);
          }}
        >
          Buat album lain
        </button>
      </div>
    );
  }

  return (
    <form className="create-form" onSubmit={submit}>
      <h1>Buat kamera sekali pakai</h1>
      <label>
        Token admin
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ADMIN_TOKEN dari server"
          autoComplete="off"
        />
      </label>
      <label>
        Nama acara
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Contoh: Pernikahan Rina & Budi" />
      </label>
      <label>
        Jenis acara
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label>
        Film
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              className={"preset-card" + (preset === p.id ? " selected" : "")}
              onClick={() => setPreset(p.id)}
            >
              <span className="swatch" style={{ background: p.swatch }} />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      </label>
      {err && <p className="page-note small">{err}</p>}
      <button className="btn big" disabled={busy}>
        {busy ? "Membuat…" : "Buat album →"}
      </button>
      <p className="preset-hint">Token hanya disimpan di browser ini, tidak pernah dikirim ke tamu.</p>
    </form>
  );
}
