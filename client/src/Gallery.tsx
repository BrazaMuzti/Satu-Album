/* Galeri tamu: menampilkan foto dari Drive (sumber kebenaran) dan menyegarkan
   dirinya sendiri — 20 detik sekali hanya mengambil foto BARU (`?since=`), jadi
   ringan untuk Render free dan kuota Drive API. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EventType, Photo, getEvent, getPhotos, readKeyFromUrl } from "./api";
import { presetById } from "./filmPresets";

const POLL_INTERVAL_MS = 20000;
/** Setiap 6 putaran (~2 menit) ambil daftar penuh untuk menangkap foto yang dihapus. */
const FULL_REFRESH_EVERY = 6;

type Status = "loading" | "ready" | "denied" | "error";

function mergePhotos(current: Photo[], incoming: Photo[]): Photo[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((p) => [p.id, p]));
  for (const photo of incoming) byId.set(photo.id, photo);
  return [...byId.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export default function Gallery() {
  const { slug } = useParams();
  const nav = useNavigate();
  const [event, setEvent] = useState<EventType | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  const [err, setErr] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [fresh, setFresh] = useState(0);

  const keyRef = useRef("");
  const photosRef = useRef<Photo[]>([]);
  photosRef.current = photos;

  useEffect(() => {
    if (!slug) return;
    const key = readKeyFromUrl(slug);
    keyRef.current = key;
    if (!key) {
      setStatus("denied");
      setErr("Link album tidak lengkap (kunci tamu tidak ada). Minta link terbaru dari panitia.");
      return;
    }
    getEvent(slug, key)
      .then((res) => {
        setEvent(res.event);
        if (res.authorized) {
          setStatus("ready");
        } else {
          setStatus("denied");
          setErr("Link album ini sudah tidak berlaku. Minta link terbaru dari panitia.");
        }
      })
      .catch((e: Error) => {
        setErr(e.message);
        setStatus("error");
      });

    getPhotos(slug, key)
      .then((res) => {
        setPhotos(res.photos);
        setCount(res.count);
        setStale(Boolean(res.stale));
      })
      .catch((e: Error) => setErr(e.message));
  }, [slug]);

  /* Polling foto baru. */
  const roundsRef = useRef(0);
  const poll = useCallback(async () => {
    if (!slug || document.visibilityState === "hidden") return;
    const list = photosRef.current;
    const since = list.length > 0 ? list[list.length - 1].createdAt : undefined;
    roundsRef.current += 1;
    const full = roundsRef.current % FULL_REFRESH_EVERY === 0;
    try {
      const res = await getPhotos(slug, keyRef.current, { since: full ? undefined : since, refresh: full });
      setStale(Boolean(res.stale));
      setCount(res.count);
      if (full) {
        setPhotos(res.photos);
      } else if (res.photos.length > 0) {
        setPhotos((current) => mergePhotos(current, res.photos));
        setFresh((n) => n + res.photos.length);
      }
    } catch {
      /* Jaringan putus: biarkan galeri menampilkan foto yang sudah termuat. */
    }
  }, [slug]);

  useEffect(() => {
    if (status !== "ready") return;
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    const onWake = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [poll, status]);

  useEffect(() => {
    if (fresh === 0) return;
    const timer = window.setTimeout(() => setFresh(0), 4000);
    return () => window.clearTimeout(timer);
  }, [fresh]);

  if (status === "loading") return <p className="page-note">Memuat galeri…</p>;

  if (status !== "ready") {
    return (
      <div className="page-note">
        <p>{err || "Galeri tidak bisa dibuka."}</p>
        <p>
          <Link className="btn ghost small" to="/">
            ← Kembali
          </Link>
        </p>
      </div>
    );
  }

  const preset = event ? presetById(event.preset) : null;
  const cameraPath = "/events/" + slug + "/camera" + (keyRef.current ? "?k=" + encodeURIComponent(keyRef.current) : "");

  return (
    <div className="gallery-page">
      <header className="topbar">
        <Link to="/" className="brand">
          satu-album
        </Link>
        {event && <div className="event-name">{event.name}</div>}
        <div className="count-badge">{count} foto</div>
        <button className="btn ghost small" onClick={() => nav(cameraPath)}>
          + Foto
        </button>
      </header>
      <main className="gallery-body">
        {preset && (
          <p className="preset-hint">
            Film: {preset.label} — {preset.tagline}
          </p>
        )}
        {stale && (
          <p className="queue-note">
            ⚠️ Server sedang lambat menyinkronkan Drive — galeri menampilkan data terakhir yang tersimpan.
          </p>
        )}
        {photos.length === 0 ? (
          <p className="empty">Belum ada foto. Buka kamera untuk mengambil yang pertama.</p>
        ) : (
          <div className="grid">
            {photos.map((p, i) => (
              <img
                key={p.id}
                src={p.thumb || p.url}
                alt={"foto " + (i + 1)}
                loading="lazy"
                onClick={() => setActive(i)}
              />
            ))}
          </div>
        )}
        {fresh > 0 && <div className="fresh-toast">+{fresh} foto baru</div>}
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
