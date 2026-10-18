import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getEvent, getPhotos, EventType, Photo } from "./api";
import { presetById } from "./filmPresets";

export default function Gallery() {
  const { slug } = useParams();
  const nav = useNavigate();
  const [event, setEvent] = useState<EventType | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    getEvent(slug).then((r) => setEvent(r.event)).catch((e) => setErr(e.message));
    getPhotos(slug).then((r) => setPhotos(r.photos)).catch((e) => setErr(e.message));
  }, [slug]);

  if (err && !event) return <p className="page-note">{err}</p>;
  const preset = event ? presetById(event.preset) : null;

  return (
    <div className="gallery-page">
      <header className="topbar">
        <Link to={"/"} className="brand">satu-album</Link>
        {event && <div className="event-name">{event.name}</div>}
        <button className="btn ghost small" onClick={() => nav("/events/" + slug + "/camera")}>+ Foto</button>
      </header>
      <main className="gallery-body">
        {preset && <p className="preset-hint">Film: {preset.label} — {preset.tagline}</p>}
        {photos.length === 0 ? (
          <p className="empty">Belum ada foto. Buka kamera untuk mengambil.</p>
        ) : (
          <div className="grid">
            {photos.map((p, i) => (
              <img key={p.id} src={p.url} alt={"foto " + (i + 1)} loading="lazy" onClick={() => setActive(i)} />
            ))}
          </div>
        )}
        {active !== null && photos[active] && (
          <div className="lightbox" onClick={() => setActive(null)}>
            <img src={photos[active].url} alt="foto besar" />
            <button className="lightbox-close">✕</button>
          </div>
        )}
      </main>
    </div>
  );
}