export type PresetId = 'funsaver' | 'quicksnap' | 'portra400' | 'ektar100' | 'hp5plus' | 'cinestill800t';
export interface Preset { id: PresetId; label: string; tagline: string; swatch: string; }

interface PresetCfg {
  r: number[][]; g: number[][]; b: number[][];
  castR: number; castG: number; castB: number;
  grain: number; vignette: number; leak: number;
  gray?: boolean; halation?: number;
}

function curve(lut: Uint8Array, pts: number[][]) {
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let v = x;
    for (let k = 0; k < pts.length - 1; k++) {
      const px = pts[k][0], py = pts[k][1];
      const nx = pts[k + 1][0], ny = pts[k + 1][1];
      if (x >= px && x <= nx) {
        const t = (x - px) / (nx - px || 1);
        const s = t * t * (3 - 2 * t);
        v = py + (ny - py) * s;
        break;
      }
    }
    lut[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
}


const C = {
  funsaver: { r: [[0,0.02],[0.45,0.46],[0.75,0.78],[1,0.99]], g: [[0,0.03],[0.5,0.51],[0.8,0.8],[1,1]], b: [[0,0.06],[0.55,0.5],[0.85,0.82],[1,0.95]], castR: 1.08, castG: 1.0, castB: 0.92, grain: 0.018, vignette: 0.18, leak: 0.12 },
  quicksnap: { r: [[0,0.02],[0.5,0.5],[0.8,0.79],[1,0.99]], g: [[0,0.02],[0.5,0.51],[0.8,0.81],[1,1.01]], b: [[0,0.0],[0.5,0.49],[0.8,0.78],[1,0.97]], castR: 0.96, castG: 1.0, castB: 1.06, grain: 0.014, vignette: 0.15, leak: 0.0 },
  portra400: { r: [[0,0.03],[0.5,0.48],[0.8,0.8],[1,1]], g: [[0,0.04],[0.5,0.5],[0.8,0.8],[1,1]], b: [[0,0.06],[0.5,0.5],[0.8,0.76],[1,0.93]], castR: 1.04, castG: 1.0, castB: 0.9, grain: 0.012, vignette: 0.12, leak: 0.06 },
  ektar100: { r: [[0,0.0],[0.5,0.5],[0.8,0.82],[1,1.02]], g: [[0,0.0],[0.5,0.5],[0.8,0.79],[1,0.99]], b: [[0,0.01],[0.5,0.5],[0.8,0.81],[1,1.01]], castR: 1.1, castG: 1.0, castB: 1.12, grain: 0.008, vignette: 0.1, leak: 0.0 },
  hp5plus: { r: [[0,0.0],[0.35,0.28],[0.65,0.72],[1,1]], g: [[0,0.0],[0.35,0.28],[0.65,0.72],[1,1]], b: [[0,0.0],[0.35,0.28],[0.65,0.72],[1,1]], castR: 1.0, castG: 1.0, castB: 1.0, grain: 0.05, vignette: 0.22, leak: 0.0, gray: true },
  cinestill800t: { r: [[0,0.02],[0.5,0.52],[0.8,0.8],[1,1.02]], g: [[0,0.04],[0.5,0.5],[0.8,0.79],[1,0.98]], b: [[0,0.01],[0.5,0.46],[0.75,0.76],[1,0.98]], castR: 1.12, castG: 0.97, castB: 1.0, grain: 0.02, vignette: 0.18, leak: 0.2, halation: 0.1 },
};

export function applyPreset(d: ImageData, id: PresetId, seed: number) {
  const cfg = C[id] as PresetCfg;
  const rLut = new Uint8Array(256), gLut = new Uint8Array(256), bLut = new Uint8Array(256);
  curve(rLut, cfg.r); curve(gLut, cfg.g); curve(bLut, cfg.b);
  const P = d.data, w = d.width, h = d.height;
  let n = seed * 65536;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = P[i], g = P[i + 1], b = P[i + 2];
      if (cfg.gray) { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = g = b = l; }
      r = rLut[r]; g = gLut[g]; b = bLut[b];
      r *= cfg.castR; g *= cfg.castG; b *= cfg.castB;
      const dx = x / w - 0.5, dy = y / h - 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy) * 1.6;
      const vig = 1 - cfg.vignette * Math.max(0, dist - 0.4);
      r *= vig; g *= vig; b *= vig;
      if (cfg.leak) {
        const lk = cfg.leak * Math.max(0, 1 - Math.sqrt((x * x + (y - h * 0.2) * (y - h * 0.2)) / (w * w + h * h)) * 2);
        r = Math.min(255, r + 90 * lk); g = Math.min(255, g + 38 * lk);
      }
      if (cfg.halation) {
        const ha = cfg.halation * Math.max(0, 1 - dist * 1.3);
        r = Math.min(255, r + 120 * ha);
      }
      n = (n * 1664525 + 1013904223) & 0xffffffff;
      const gr = (cfg.grain * 155) * (((n >>> 24) / 255) - 0.5);
      r = Math.min(255, Math.max(0, r + gr)); g = Math.min(255, Math.max(0, g + gr)); b = Math.min(255, Math.max(0, b + gr));
      P[i] = r; P[i + 1] = g; P[i + 2] = b;
    }
  }
}

export const PRESETS: Preset[] = [
  { id: "funsaver", label: "Kodak FunSaver", tagline: "Vibrant, warm, effortless", swatch: "#e8b177" },
  { id: "quicksnap", label: "Fujifilm QuickSnap", tagline: "Cool, crisp daylight", swatch: "#8fb8c9" },
  { id: "portra400", label: "Kodak Portra 400", tagline: "Soft, creamy skin tones", swatch: "#d9a58c" },
  { id: "ektar100", label: "Kodak Ektar 100", tagline: "Punchy, saturated colors", swatch: "#c44c4c" },
  { id: "hp5plus", label: "Ilford HP5 Plus", tagline: "Grainy monochrome", swatch: "#3a3a3a" },
  { id: "cinestill800t", label: "CineStill 800T", tagline: "Tungsten with halation", swatch: "#3f7d9e" },
];

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}