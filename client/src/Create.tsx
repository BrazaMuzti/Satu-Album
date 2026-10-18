import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createEvent } from "./api";
import { PRESETS, PresetId } from "./filmPresets";

const TYPES = ["pernikahan", "ulang tahun", "reuni", "acara kantor", "lainnya"];

export default function Create() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [type, setType] = useState(TYPES[0]);
  const [preset, setPreset] = useState<PresetId>("funsaver");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await createEvent({ name, type, preset, revealAt: null });
      nav("/events/" + r.event.slug + "/camera");
    } catch (err) {
      setErr((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="create-form" onSubmit={submit}>
      <h1>Buat kamera sekali pakai</h1>
      <label>Nama acara
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Contoh: Pernikahan Rina & Budi" />
      </label>
      <label>Jenis acara
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label>Film
        <div className="presets">
          {PRESETS.map((p) => (
            <button type="button" key={p.id} className={"preset-card" + (preset === p.id ? " selected" : "")} onClick={() => setPreset(p.id)}>
              <span className="swatch" style={{ background: p.swatch }} />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      </label>
      {err && <p className="page-note">{err}</p>}
      <button className="btn big" disabled={busy}>{busy ? "Membuat…" : "Buka kamera →"}</button>
    </form>
  );
}