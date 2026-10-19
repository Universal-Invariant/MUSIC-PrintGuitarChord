// ---------- Persistence + defaults + export ----------

import type { ChordColor, ChordDoc, Settings } from './types';
import { BLACK, WHITE } from './types';
import { STANDARD_SHAPES } from './shapes';

export const DEFAULT_COLORS: ChordColor[] = [
  { hex: '#e6194b', alpha: 1 }, // red
  { hex: '#f58231', alpha: 1 }, // orange
  { hex: '#ffe119', alpha: 1 }, // yellow
  { hex: '#3cb44b', alpha: 1 }, // green
  { hex: '#4363d8', alpha: 1 }, // blue
  { hex: '#911eb4', alpha: 1 }, // purple
  { hex: '#000000', alpha: 1 }, // black
];

export const BASKET_COLORS: ChordColor[] = [
  ...DEFAULT_COLORS,
  { hex: '#ffffff', alpha: 1 },
  { hex: '#9a6324', alpha: 1 },
  { hex: '#808000', alpha: 1 },
  { hex: '#469990', alpha: 1 },
  { hex: '#f032f6', alpha: 1 },
  { hex: '#fabed4', alpha: 1 },
  { hex: '#dcbeff', alpha: 1 },
  { hex: '#aaffc3', alpha: 1 },
  { hex: '#ffd8b1', alpha: 1 },
  { hex: '#fffac8', alpha: 1 },
  { hex: '#800000', alpha: 1 },
  { hex: '#000075', alpha: 1 },
  { hex: '#000000', alpha: 0.5 },
];

export const DEFAULT_SETTINGS: Settings = {
  numFrets: 5,
  startFret: 1,
  orientation: 'vertical',
  boardWidth: 200,
  stringGap: 36,
  stringWidthMode: 'progressive',
  minStringWidth: 1.2,
  maxStringWidth: 3.6,
  showNut: true,
  nutWidth: 7,
  nutTaper: 'none',
  nutMin: 5,
  nutMax: 9,
  spacing: 'equal',
  firstFretSize: 52,
  lastFretSize: 30,
  showDots: true,
  dotMarkerColor: { hex: '#c8bcd0', alpha: 0.9 },
  bgFill: WHITE,
  fretColor: { hex: '#4a4a4a', alpha: 1 },
  stringColor: { hex: '#8d8d8d', alpha: 1 },

  baseDotSize: 26,
  colors: BASKET_COLORS.map(c => ({ ...c })),
  defaultColors: DEFAULT_COLORS.map(c => ({ ...c })),
  standardShapes: STANDARD_SHAPES.map(s => s.name),
  customShapes: [],
  defaultShapes: ['circle', 'square', 'diamond', 'triangle', 'pentagon', 'hexagon', 'star'],
  shapeDefaultColor: BLACK,
  shapeScale: 1,
  defaultTextFont: 'Arial',
  defaultTextColor: { hex: '#ffffff', alpha: 1 },
  defaultTextSize: 14,
  defaultTextRotation: 0,

  fingeringsLeft: true,
  exportScale: 2,
  exportQuality: 0.92,
};

export function emptyChord(): ChordDoc {
  return { name: 'Untitled', dots: [], texts: [], fingerings: [] };
}

// ---------- localStorage ----------

const LS_CHORDS = 'gchords.list.v1';
const LS_SETTINGS = 'gchords.settings.v1';
const LS_CUSTOM = 'gchords.customshapes.v1';

export function loadChordList(): ChordDoc[] {
  try {
    const raw = localStorage.getItem(LS_CHORDS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
export function saveChordList(list: ChordDoc[]) {
  localStorage.setItem(LS_CHORDS, JSON.stringify(list));
}
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return { ...structuredClone(DEFAULT_SETTINGS), ...JSON.parse(raw) };
  } catch { return structuredClone(DEFAULT_SETTINGS); }
}
export function saveSettings(s: Settings) {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
}
export function loadCustomShapes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_CUSTOM);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
export function saveCustomShapes(map: Record<string, string>) {
  localStorage.setItem(LS_CUSTOM, JSON.stringify(map));
}

// ---------- chord <-> doc conversion ----------

/** Build a ChordDoc from a library chord (shape array low-E..high-e; null=muted). */
export function chordFromLibrary(name: string, shape: (number | null)[], fingerings?: string[]): ChordDoc {
  const settings = DEFAULT_SETTINGS;
  const dots = [];
  for (let i = 0; i < 6; i++) {
    const abs = shape[i];
    if (abs == null) continue;
    const strIdx = 5 - i; // model index 0 = high e
    dots.push({
      id: `lib-${name}-${i}`,
      string: strIdx,
      fret: abs,
      colorIdx: 0,
      shapeIdx: 0,
      text: '',
      font: null, textColor: null, textSize: null, transparency: null, rotation: 0,
    });
  }
  const fing = (fingerings ?? []).map((t, i) => ({
    id: `libf-${name}-${i}`,
    string: 5 - i,
    text: t,
    font: settings.defaultTextFont,
    size: 15,
    color: { hex: '#333333', alpha: 1 } as ChordColor,
  })).filter(f => f.text !== '0');
  return { name, dots, texts: [], fingerings: fing };
}

// ---------- export ----------

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportSvg(svgMarkup: string, filename: string) {
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename.endsWith('.svg') ? filename : filename + '.svg');
}

export async function exportRaster(svgMarkup: string, filename: string, format: 'png' | 'jpg', scale: number, quality: number): Promise<void> {
  // parse intrinsic size
  const m = svgMarkup.match(/data-w="(\d+(?:\.\d+)?)" data-h="(\d+(?:\.\d+)?)"/);
  const w = m ? parseFloat(m[1]) : 600, h = m ? parseFloat(m[2]) : 600;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' }));
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('SVG load failed'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  if (format === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  await new Promise<void>(res => {
    canvas.toBlob(b => {
      if (b) downloadBlob(b, `${filename}.${format}`);
      res();
    }, mime, quality);
  });
}
