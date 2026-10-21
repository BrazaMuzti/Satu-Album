import { useCallback, useEffect, useRef, useState } from "react";
import { applyPreset, PresetId, presetById } from "./filmPresets";

interface Props {
  preset: PresetId;
  /** Dipanggil dengan JPEG yang sudah dikecilkan + diberi warna film. */
  onCapture: (blob: Blob) => void;
  /** Nonaktifkan shutter saat unggahan sedang padat. */
  disabled?: boolean;
}

/* Sisi terpanjang gambar yang dikirim. 2048px ~150-400 KB per foto: cukup tajam
   untuk cetak 4R, tapi hemat kuota Drive dan cepat diunggah dari sinyal acara. */
const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.85;

export default function CameraCapture({ preset, onCapture, disabled }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState("environment");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = useCallback(async () => {
    setError(null);
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 2560 } },
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
    } catch (e) {
      setError((e as Error).message || "Kamera tidak tersedia. Izinkan akses kamera lalu muat ulang.");
    }
  }, [facing]);

  useEffect(() => {
    start();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [start]);

  /* Ambil frame → kecilkan → beri warna film → JPEG.
     Preset dijalankan pada gambar yang SUDAH dikecilkan supaya hemat CPU HP. */
  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (video.videoWidth === 0) {
      setError("Frame kamera belum siap, coba lagi sebentar.");
      return;
    }
    setBusy(true);
    setError(null);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBusy(false);
      return;
    }
    if (facing === "user") {
      /* Cermin untuk kamera depan supaya hasilnya sesuai yang dilihat tamu. */
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    applyPreset(img, preset, Math.floor(Math.random() * 65535));
    ctx.putImageData(img, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
        else setError("Gagal memproses foto, coba sekali lagi.");
        setBusy(false);
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  }, [facing, preset, onCapture]);

  const flip = () => setFacing((f) => (f === "environment" ? "user" : "environment"));

  return (
    <div className="cam">
      <div className="viewfinder">
        {error && <p className="cam-error">{error}</p>}
        <video ref={videoRef} playsInline muted className={facing === "user" ? "flip-x" : ""} />
        <span className="preset-tag">{presetById(preset).label}</span>
      </div>
      <div className="cam-controls">
        <button className="btn ghost" onClick={flip} disabled={busy}>
          ⇄ Flip
        </button>
        <button className="btn shutter" onClick={capture} disabled={busy || disabled}>
          {busy ? "Memproses…" : "Potret"}
        </button>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
