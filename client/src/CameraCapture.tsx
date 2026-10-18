import { useCallback, useEffect, useRef, useState } from "react";
import { applyPreset, PresetId, presetById } from "./filmPresets";

interface Props {
  preset: PresetId;
  onCapture: (blob: Blob, dataUrl: string) => void;
}

export default function CameraCapture({ preset, onCapture }: Props) {
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
        video: { facingMode: facing },
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
    } catch (e) {
      setError((e as Error).message || "Camera unavailable");
    }
  }, [facing]);

  useEffect(() => { start(); return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }; }, [start]);

  const capture = useCallback(() => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (video.videoWidth === 0) { setError("No frame yet"); return; }
    setBusy(true);
    const w = video.videoWidth, h = video.videoHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    if (facing === "user") { ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, w, h); }
    const img = ctx.getImageData(0, 0, w, h);
    applyPreset(img, preset, Math.floor(Math.random() * 65535));
    ctx.putImageData(img, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) onCapture(blob, canvas.toDataURL("image/jpeg", 0.92));
      setBusy(false);
    }, "image/jpeg", 0.92);
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
        <button className="btn ghost" onClick={flip}>⇄ Flip</button>
        <button className="btn shutter" onClick={capture} disabled={busy}>{busy ? "Saving…" : "Capture"}</button>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}