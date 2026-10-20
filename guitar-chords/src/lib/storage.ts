// ---------- Persistence + defaults + export ----------

import type { ChordColor, ChordDoc, ChordPlacement, PageConfig, PageDoc, Settings } from './types';
import { BLACK, WHITE, uid } from './types';
import { STANDARD_SHAPES } from './shapes';
import { TUNING_HIGH_TO_LOW } from './music';

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
  flipAlong: false,
  flipAcross: false,
  fretSpacing: 46,
  stringGap: 36,
  stringWidthMode: 'progressive',
  minStringWidth: 1.2,
  maxStringWidth: 3.6,
  nutWidth: 7,
  fretThickness: 2.5,
  reverseStrings: false,
  taperMode: 'relative',
  fretLabels: 'all',
  fretLabelList: '',
  openSide: 'nut',
  margins: { top: 70, right: 70, bottom: 70, left: 70 },
  boardTaper: 0.35,
  spacing: 'equal',
  firstFretSize: 52,
  lastFretSize: 30,
  showDots: true,
  noteVisible: false,
  dotTextColor: { hex: '#ffffff', alpha: 1 },
  openNoteLabels: true,
  openNoteOffset: 14,
  fretWidthPct: 100,
  tuning: [...TUNING_HIGH_TO_LOW],
  preferFlats: false,
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

export function emptyChord(name = 'Untitled'): ChordDoc {
  return { id: uid('chord'), name, dots: [], texts: [], fingerings: [] };
}

// ---------- page (multi-chord canvas) model ----------

export const DEFAULT_PAGE_CONFIG: PageConfig = {
  size: 'letter',
  landscape: false,
  customW: 816,
  customH: 1056,
  showGrid: true,
  snap: true,
  gridSize: 20,
};

export function emptyPage(name = 'My page'): PageDoc {
  return { id: uid('page'), name, config: { ...DEFAULT_PAGE_CONFIG }, chords: [], placements: {}, selected: null };
}

/** Deep copy of a page with fresh ids (page + every chord) — "Duplicate page". */
export function duplicatePage(p: PageDoc, name?: string): PageDoc {
  const copy = structuredClone(p);
  copy.id = uid('page');
  copy.name = name ?? `${p.name} copy`;
  const remap: Record<string, string> = {};
  for (const c of copy.chords) {
    const old = c.id;
    c.id = uid('chord');
    remap[old] = c.id;
    for (const d of c.dots) d.id = uid('dot');
    for (const t of c.texts) t.id = uid('text');
    for (const f of c.fingerings) f.id = uid('fing');
  }
  const pl: PageDoc['placements'] = {};
  for (const [old, v] of Object.entries(copy.placements)) pl[remap[old] ?? old] = v;
  copy.placements = pl;
  copy.selected = p.selected ? (remap[p.selected] ?? null) : null;
  return copy;
}

// ---------- multi-page composition ----------

/** A page row used when printing/exporting several pages at once. */
export interface ComposeRow {
  w: number; h: number;
  chords: { id: string; x: number; y: number; scale: number; markup: string }[];
}

/** Pack chord entries into rows of width ≤ maxW (row height = tallest member). */
export function packRows(
  items: { entry: ChordDoc; pl: ChordPlacement; markup: string; iw: number; ih: number }[],
  maxW: number, margin: number, gap: number,
): { w: number; h: number; chords: ComposeRow['chords'] }[] {
  const rows: { w: number; h: number; chords: ComposeRow['chords'] }[] = [];
  let cur: typeof rows[number] = { w: 0, h: 0, chords: [] };
  let x = margin;
  const flush = () => { if (cur.chords.length) { rows.push(cur); } cur = { w: 0, h: 0, chords: [] }; x = margin; };
  for (const it of items) {
    const sw = it.iw * it.pl.scale, sh = it.ih * it.pl.scale;
    if (cur.chords.length && x + sw + margin > maxW) flush();
    cur.chords.push({ id: it.entry.id, x, y: 0, scale: it.pl.scale, markup: it.markup });
    cur.w = Math.max(cur.w, x + sw + margin);
    cur.h = Math.max(cur.h, sh);
    x += sw + gap;
  }
  flush();
  return rows;
}

/** Distribute packed rows onto pages of the given size; rows never split across pages. */
export function paginateRows(
  rows: { w: number; h: number; chords: ComposeRow['chords'] }[],
  pageSize: { w: number; h: number }, margin: number, gap: number,
): ComposeRow[] {
  const pages: ComposeRow[] = [];
  let current: ComposeRow['chords'] = [];
  let cy = margin;
  const newPage = () => {
    pages.push({ w: pageSize.w, h: pageSize.h, chords: current });
    current = [];
    cy = margin;
  };
  for (const row of rows) {
    // start a fresh page when this row no longer fits below the already-placed ones
    if (current.length && cy + row.h > pageSize.h - margin) newPage();
    for (const c of row.chords) current.push({ ...c, y: cy });
    cy += row.h + gap;
  }
  // always emit at least one page (even an empty one)
  pages.push({ w: pageSize.w, h: pageSize.h, chords: current });
  return pages;
}

// ---------- localStorage ----------

const LS_CHORDS = 'gchords.list.v1';
const LS_SETTINGS = 'gchords.settings.v1';
const LS_CUSTOM = 'gchords.customshapes.v1';
const LS_PAGES = 'gchords.pages.v1';
const LS_ACTIVE = 'gchords.active.v1';

export function loadChordList(): ChordDoc[] {
  try {
    const raw = localStorage.getItem(LS_CHORDS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // migrate: every chord needs a stable id (older saves may lack it)
    for (const c of arr) if (!c || typeof c !== 'object') continue;
    return arr.filter(c => c && typeof c === 'object').map(c => normalizeChord(c));
  } catch { return []; }
}

/** Ensure a stored object is a well-formed ChordDoc (id, arrays). */
export function normalizeChord(c: Partial<ChordDoc> & Record<string, unknown>): ChordDoc {
  return {
    id: typeof c.id === 'string' && c.id ? c.id : uid('chord'),
    name: typeof c.name === 'string' ? c.name : 'Untitled',
    dots: Array.isArray(c.dots) ? c.dots : [],
    texts: Array.isArray(c.texts) ? c.texts : [],
    fingerings: Array.isArray(c.fingerings) ? c.fingerings : [],
    settings: (c.settings && typeof c.settings === 'object') ? c.settings as Partial<Settings> : undefined,
  };
}
export function saveChordList(list: ChordDoc[]) {
  localStorage.setItem(LS_CHORDS, JSON.stringify(list));
}
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings> & { boardWidth?: number; nutTaper?: string };
    // migrate old keys so saved layouts keep sensible sizes
    if (parsed.boardWidth != null && parsed.fretSpacing == null) {
      parsed.fretSpacing = Math.round(parsed.boardWidth / Math.max(1, parsed.numFrets ?? DEFAULT_SETTINGS.numFrets));
    }
    delete parsed.boardWidth;
    delete parsed.nutTaper;
    delete (parsed as Record<string, unknown>).showNut; // legacy toggle — nut now follows startFret === 1
    // legacy: the nut used to appear at startFret 0; frets are 1-based now.
    if (typeof parsed.startFret === 'number' && parsed.startFret < 1) parsed.startFret = 1;
    // legacy: fingeringsLeft used to mean "nut at top/left"; now flipAlong mirrors it.
    if (parsed.flipAlong == null && typeof parsed.fingeringsLeft === 'boolean') {
      parsed.flipAlong = !parsed.fingeringsLeft;
    }
    const merged = { ...structuredClone(DEFAULT_SETTINGS), ...parsed };
    if (typeof merged.flipAlong !== 'boolean') merged.flipAlong = false;
    if (typeof merged.flipAcross !== 'boolean') merged.flipAcross = false;
    if (typeof merged.reverseStrings !== 'boolean') merged.reverseStrings = false;
    if (merged.taperMode !== 'absolute' && merged.taperMode !== 'relative') merged.taperMode = DEFAULT_SETTINGS.taperMode;
    if (typeof merged.noteVisible !== 'boolean') merged.noteVisible = false;
    if (typeof merged.openNoteLabels !== 'boolean') merged.openNoteLabels = true;
    if (typeof merged.openNoteOffset !== 'number' || !Number.isFinite(merged.openNoteOffset)) merged.openNoteOffset = DEFAULT_SETTINGS.openNoteOffset;
    merged.openNoteOffset = Math.max(0, Math.min(160, merged.openNoteOffset));
    if (typeof merged.fretWidthPct !== 'number' || !Number.isFinite(merged.fretWidthPct)) merged.fretWidthPct = 100;
    merged.fretWidthPct = Math.max(50, Math.min(150, merged.fretWidthPct));
    if (typeof merged.preferFlats !== 'boolean') merged.preferFlats = false;
    // tuning: 6 MIDI numbers, dot-model order (index 0 = high e .. 5 = low E)
    if (!Array.isArray(merged.tuning) || merged.tuning.length !== 6 || merged.tuning.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
      merged.tuning = [...TUNING_HIGH_TO_LOW];
    } else {
      merged.tuning = merged.tuning.map(v => Math.max(12, Math.min(108, Math.round(v))));
    }
    if (!merged.dotTextColor || typeof merged.dotTextColor.hex !== 'string') merged.dotTextColor = { ...DEFAULT_SETTINGS.dotTextColor };
    // frets displayed is ALWAYS at least 3 — quick overrides and settings share this floor
    if (typeof merged.numFrets === 'number') merged.numFrets = Math.max(3, Math.min(27, Math.round(merged.numFrets)));
    if (typeof merged.fretThickness !== 'number' || !Number.isFinite(merged.fretThickness)) merged.fretThickness = DEFAULT_SETTINGS.fretThickness;
    merged.fretThickness = Math.max(0.5, Math.min(12, merged.fretThickness));
    // real guitar geometry: the last slot can never be wider than the first one
    if (typeof merged.lastFretSize === 'number' && typeof merged.firstFretSize === 'number') {
      merged.lastFretSize = Math.min(merged.lastFretSize, merged.firstFretSize);
    }
    if (merged.fretLabels !== 'all' && merged.fretLabels !== 'none' && merged.fretLabels !== 'custom') merged.fretLabels = 'all';
    if (typeof merged.fretLabelList !== 'string') merged.fretLabelList = '';
    if (merged.openSide !== 'nut' && merged.openSide !== 'far') merged.openSide = 'nut';
    const m = (merged.margins ?? {}) as unknown as Record<string, number>;
    const nz = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : d);
    merged.margins = { top: nz(m.top, 70), right: nz(m.right, 70), bottom: nz(m.bottom, 70), left: nz(m.left, 70) };
    return merged;
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

// ---------- pages ----------

export function loadPages(): PageDoc[] {
  try {
    const raw = localStorage.getItem(LS_PAGES);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(p => p && typeof p === 'object').map(normalizePage);
  } catch { return []; }
}
export function savePages(list: PageDoc[]) {
  localStorage.setItem(LS_PAGES, JSON.stringify(list));
}
export function loadActivePageId(): string | null {
  try { return localStorage.getItem(LS_ACTIVE); } catch { return null; }
}
export function saveActivePageId(id: string | null) {
  try {
    if (id) localStorage.setItem(LS_ACTIVE, id);
    else localStorage.removeItem(LS_ACTIVE);
  } catch { /* ignore */ }
}

/** Ensure a stored object is a well-formed PageDoc. */
export function normalizePage(p: Partial<PageDoc> & Record<string, unknown>): PageDoc {
  const cfgIn = (p.config && typeof p.config === 'object') ? p.config as Partial<PageConfig> : {};
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const sizeOk = ['letter', 'legal', 'a4', 'a3', 'custom'].includes(String(cfgIn.size)) ? cfgIn.size as PageConfig['size'] : DEFAULT_PAGE_CONFIG.size;
  const cfg: PageConfig = {
    size: sizeOk,
    landscape: !!cfgIn.landscape,
    customW: Math.max(200, Math.min(4000, Math.round(num(cfgIn.customW, DEFAULT_PAGE_CONFIG.customW)))),
    customH: Math.max(200, Math.min(4000, Math.round(num(cfgIn.customH, DEFAULT_PAGE_CONFIG.customH)))),
    showGrid: cfgIn.showGrid !== false,
    snap: cfgIn.snap !== false,
    gridSize: Math.max(5, Math.min(100, Math.round(num(cfgIn.gridSize, DEFAULT_PAGE_CONFIG.gridSize)))),
  };
  const chords = Array.isArray(p.chords)
    ? p.chords.filter((c: unknown) => c && typeof c === 'object').map((c: unknown) => normalizeChord(c as Record<string, unknown>))
    : [];
  const placements: PageDoc['placements'] = {};
  const pin = (p.placements && typeof p.placements === 'object') ? p.placements as Record<string, unknown> : {};
  for (const c of chords) {
    const raw = pin[c.id];
    if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;
      const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
      placements[c.id] = {
        x: n(r.x, 60), y: n(r.y, 60), w: n(r.w, 320), h: n(r.h, 420),
        scale: Math.max(0.2, Math.min(3, n(r.scale, 1))),
      };
    }
  }
  const sel = typeof p.selected === 'string' && chords.some(c => c.id === p.selected) ? p.selected : (chords[0]?.id ?? null);
  return {
    id: typeof p.id === 'string' && p.id ? p.id : uid('page'),
    name: typeof p.name === 'string' ? p.name : 'My page',
    config: cfg, chords, placements, selected: sel,
  };
}

// ---------- chord <-> doc conversion ----------

/** Build a ChordDoc from a library chord (shape array low-E..high-e; null=muted). */
export function chordFromLibrary(name: string, shape: (number | null)[], fingerings?: string[]): ChordDoc {
  const settings = DEFAULT_SETTINGS;
  const dots = [];
  for (let i = 0; i < 6; i++) {
    const abs = shape[i];
    if (abs == null) continue; // muted — shown as an X marker via the fingering label
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
  // Keep ALL fingering labels ('1'..'4', '0' and 'x') — the renderer draws O/X
  // markers in front of the nut for the '0'/'x' entries.
  const fing = (fingerings ?? []).map((t, i) => ({
    id: `libf-${name}-${i}`,
    string: 5 - i,
    text: t,
    font: settings.defaultTextFont,
    size: 15,
    color: { hex: '#333333', alpha: 1 } as ChordColor,
  }));
  return { id: uid('chord'), name, dots, texts: [], fingerings: fing };
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
