import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import CameraCapture from "./CameraCapture";
import { getEvent, uploadPhoto, EventType } from "./api";
import { presetById, PresetId } from "./filmPresets";

export default function Camera() {
  const { slug } = useParams();
  const [event, setEvent] = useState<EventType | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [shot, setShot] = useState(0);
  const [confirm, setConfirm] = useState<string | null>(null);
  const pending = useRef<{ blob: Blob; dataUrl: string } | null>(null);

  useEffect(() => {
    if (!slug) return;
    getEvent(slug).then((r) => setEvent(r.event)).catch((e) => setErr(e.message));
  }, [slug]);

  const handleCapture = (blob: Blob, dataUrl: string) => {
    setPending(blob, dataUrl);
  };

  const setPending = (blob: Blob, dataUrl: string) => {
    pending.current = { blob, dataUrl };
    setConfirm(dataUrl);
  };

  const save = async () => {
    if (!slug || !pending.current) return;
    setUploading(true);
    try {
      await uploadPhoto(slug, pending.current.blob);
      setShot((s) => s + 1);
      setConfirm(null);
      pending.current = null;
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (err && !event) return <p className="page-note">{err}</p>;
  const preset = presetById(event ? event.preset : "funsaver");

  return (
    <div className="camera-page">
      <header className="topbar">
        <Link to={"/"} className="brand">satu-album</Link>
        {event && <div className="event-name">{event.name}</div>}
      </header>
      <main className="camera-body">
        {!event ? <p>Loading…</p> : (
          <>
            <p className="shots">{shot} foto diambil</p>
            <CameraCapture preset={preset.id} onCapture={handleCapture} />
            {confirm && (
              <div className="confirm">
                <img src={confirm} alt="capture" />
                <div>
                  <button className="btn ghost" onClick={() => { setConfirm(null); pending.current = null; }}>Retake</button>
                  <button className="btn" onClick={save} disabled={uploading}>{uploading ? "Uploading…" : "Save & next"}</button>
                </div>
              </div>
            )}
            {err && <p className="page-note">{err}</p>}
            <p className="preset-hint">Film: {preset.label} — {preset.tagline}</p>
          </>
        )}
      </main>
    </div>
  );
}