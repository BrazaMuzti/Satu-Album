/* Kamera tamu: sekali potret → foto LANGSUNG terunggah (tanpa tombol simpan),
   dengan tombol Undo 10 detik dan antrean offline bila sinyal hilang. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CameraCapture from "./CameraCapture";
import {
  EventType,
  Photo,
  deletePhoto,
  getEvent,
  isRetryable,
  readKeyFromUrl,
  uploadPhoto,
} from "./api";
import { presetById } from "./filmPresets";
import * as queue from "./uploadQueue";

/** Lama tombol Undo tampil (server masih mengizinkan sampai SA_UNDO_WINDOW_MS). */
const UNDO_SECONDS = 10;
/** Jeda percobaan ulang antrean offline. */
const RETRY_INTERVAL_MS = 15000;
/** Maksimum unggahan paralel; lebih dari ini masuk antrean agar sinyal tidak tersedot. */
const MAX_PARALLEL_UPLOADS = 3;

type Status = "loading" | "ready" | "denied" | "error";

export default function Camera() {
  const { slug } = useParams();
  const [event, setEvent] = useState<EventType | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);
  const [shots, setShots] = useState(0);
  const [count, setCount] = useState(0);
  const [pending, setPending] = useState(0);
  const [last, setLast] = useState<{ photo: Photo; left: number } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const keyRef = useRef("");
  const busyRef = useRef(0);
  const flashRef = useRef<string | null>(null);

  const galleryPath = "/events/" + slug + (keyRef.current ? "?k=" + encodeURIComponent(keyRef.current) : "");

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
        setCount(res.event.count || 0);
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
    queue.queueSize(slug).then(setPending);
  }, [slug]);

  /** Kilatan pratinjau hasil potret (~0,7 detik) lalu object URL dibebaskan. */
  const showFlash = useCallback((blob: Blob) => {
    if (flashRef.current) URL.revokeObjectURL(flashRef.current);
    flashRef.current = URL.createObjectURL(blob);
    setFlash(flashRef.current);
    window.setTimeout(() => {
      if (flashRef.current) {
        URL.revokeObjectURL(flashRef.current);
        flashRef.current = null;
      }
      setFlash(null);
    }, 700);
  }, []);

  useEffect(() => () => {
    if (flashRef.current) URL.revokeObjectURL(flashRef.current);
  }, []);

  /* Hitung mundur tombol Undo. */
  useEffect(() => {
    if (!last) return;
    if (last.left <= 0) {
      setLast(null);
      return;
    }
    const timer = setTimeout(() => setLast((cur) => (cur ? { ...cur, left: cur.left - 1 } : cur)), 1000);
    return () => clearTimeout(timer);
  }, [last]);

  /** Kirim isi antrean offline satu per satu (berhenti saat masih offline). */
  const flushQueue = useCallback(async () => {
    if (!slug) return;
    const items = await queue.listQueue(slug);
    if (items.length === 0) {
      setPending(0);
      return;
    }
    setPending(items.length);
    for (const item of items) {
      try {
        await uploadPhoto(item.slug, item.key || keyRef.current, item.blob);
        await queue.removeFromQueue(item.id);
        setShots((s) => s + 1);
        setCount((c) => c + 1);
      } catch (e) {
        if (isRetryable(e)) break; /* masih tanpa sinyal → coba lagi nanti */
        /* 4xx permanen: jangan menahan antrean selamanya. */
        await queue.removeFromQueue(item.id);
        setErr("1 foto gagal dikirim: " + (e as Error).message);
      }
    }
    setPending((await queue.listQueue(slug)).length);
  }, [slug]);

  /* Percobaan ulang: berkala, saat jaringan kembali, dan saat tab kembali aktif. */
  useEffect(() => {
    const tick = () => void flushQueue();
    const timer = window.setInterval(tick, RETRY_INTERVAL_MS);
    window.addEventListener("online", tick);
    document.addEventListener("visibilitychange", tick);
    tick();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [flushQueue]);

  /** Foto selesai dipotret → unggah langsung; gagal karena sinyal → masuk antrean. */
  const submit = useCallback(
    async (blob: Blob) => {
      if (!slug) return;
      const key = keyRef.current;
      showFlash(blob);

      if (busyRef.current >= MAX_PARALLEL_UPLOADS) {
        await queue.enqueue({
          id: queue.newQueueId(),
          slug,
          key,
          blob,
          createdAt: new Date().toISOString(),
          label: "menunggu giliran",
        });
        setPending((await queue.listQueue(slug)).length);
        return;
      }

      busyRef.current += 1;
      setBusy(busyRef.current);
      setErr(null);
      try {
        const result = await uploadPhoto(slug, key, blob);
        setShots((s) => s + 1);
        setCount((c) => c + 1);
        setLast({ photo: result.photo, left: UNDO_SECONDS });
      } catch (e) {
        if (isRetryable(e)) {
          await queue.enqueue({
            id: queue.newQueueId(),
            slug,
            key,
            blob,
            createdAt: new Date().toISOString(),
            label: "menunggu sinyal",
          });
          setPending((await queue.listQueue(slug)).length);
        } else {
          /* Mis. album penuh atau format ditolak — beri tahu tamu dengan jelas. */
          setErr((e as Error).message);
        }
      } finally {
        busyRef.current = Math.max(0, busyRef.current - 1);
        setBusy(busyRef.current);
      }
    },
    [slug, showFlash]
  );

  const undo = useCallback(async () => {
    if (!slug || !last) return;
    const id = last.photo.id;
    setLast(null);
    try {
      await deletePhoto(slug, keyRef.current, id);
      setShots((s) => Math.max(0, s - 1));
      setCount((c) => Math.max(0, c - 1));
      setErr(null);
    } catch (e) {
      setErr("Undo gagal: " + (e as Error).message);
    }
  }, [slug, last]);

  if (status === "loading") return <p className="page-note">Memuat album…</p>;

  if (status !== "ready") {
    return (
      <div className="page-note">
        <p>{err || "Album tidak bisa dibuka."}</p>
        <p>
          <Link className="btn ghost small" to="/">
            ← Kembali
          </Link>
        </p>
      </div>
    );
  }

  const preset = presetById(event ? event.preset : "funsaver");

  return (
    <div className="camera-page">
      <header className="topbar">
        <Link to="/" className="brand">
          satu-album
        </Link>
        {event && <div className="event-name">{event.name}</div>}
        <Link className="btn ghost small" to={galleryPath}>
          Galeri →
        </Link>
      </header>
      <main className="camera-body">
        <p className="shots">
          {count} foto di album
          {shots > 0 ? " • " + shots + " dari sesi ini" : ""}
        </p>
        <CameraCapture preset={preset.id} onCapture={submit} />
        {busy > 0 && <p className="page-note small">Mengunggah {busy} foto…</p>}
        {pending > 0 && (
          <p className="queue-note">
            📶 {pending} foto tersimpan di HP ini dan akan terkirim otomatis saat sinyal kembali.
          </p>
        )}
        {err && <p className="page-note small">{err}</p>}
        <p className="preset-hint">
          Film: {preset.label} — {preset.tagline}
        </p>
      </main>
      {flash && (
        <div className="cam-flash">
          <img src={flash} alt="hasil potret" />
        </div>
      )}
      {last && (
        <div className="undo-toast">
          <span>Foto masuk album ✓</span>
          <button className="btn small" onClick={undo}>
            Undo ({last.left})
          </button>
        </div>
      )}
    </div>
  );
}
