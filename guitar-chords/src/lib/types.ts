// ---------- Core data model ----------

export interface RGB { r: number; g: number; b: number }

/** Color stored as hex + alpha (0..1). */
export interface ChordColor {
  hex: string;   // "#rrggbb"
  alpha: number; // 0..1
}

export const WHITE: ChordColor = { hex: '#ffffff', alpha: 1 };
export const BLACK: ChordColor = { hex: '#000000', alpha: 1 };

export function col(c: ChordColor): string {
  return c.hex + alphaHex(c.alpha);
}
export function alphaHex(a: number): string {
  const v = Math.round(Math.max(0, Math.min(1, a)) * 255);
  return v.toString(16).padStart(2, '0');
}
export function withAlpha(c: ChordColor, alpha: number): ChordColor {
  return { hex: c.hex, alpha };
}

/** A note dot placed on the fretboard grid. */
export interface Dot {
  id: string;
  string: number;    // 0 = highest pitch (top line), 5 = lowest (bottom)
  fret: number;      // absolute fret; 0 = nut position
  colorIdx: number;  // index into settings.colors
  shapeIdx: number;  // index into active shapes list
  text: string;
  font: string | null;      // overrides default font
  textColor: ChordColor | null;
  textSize: number | null;  // multiplier of baseDotSize
  transparency: number | null; // 0..1 extra alpha multiplier
  rotation: number;         // degrees
}

/** Free-floating text box (normalized coordinates 0..1 over whole board). */
export interface TextBox {
  id: string;
  x: number; y: number;
  text: string;
  font: string;
  size: number;        // px at scale 1
  color: ChordColor;
  rotation: number;
  anchor: 'start' | 'middle' | 'end';
}

/** Fingering label drawn beside the nut, for one string. */
export interface Fingering {
  id: string;
  string: number;
  text: string;
  font: string;
  size: number;
  color: ChordColor;
}

export type SpacingMode = 'equal' | 'logarithmic';
export type Orientation = 'vertical' | 'horizontal';

/** Canvas padding around the drawing, one value per side. */
export interface Margins { top: number; right: number; bottom: number; left: number }

/** Which fret numbers are drawn beside the board. */
export type FretLabelMode = 'all' | 'none' | 'custom';

export interface Settings {
  // --- fretboard geometry ---
  numFrets: number;          // number of spaces displayed
  startFret: number;         // absolute fret of first space (0 ⇒ nut is shown)
  orientation: Orientation;
  flipAlong: boolean;        // true ⇒ nut at the far end (bottom / right); fret numbers run backwards
  flipAcross: boolean;       // true ⇒ strings mirrored across the board center line
  fretSpacing: number;       // px between frets in 'equal' mode (board length = numFrets × this)
  stringGap: number;         // px between strings (board width = 5 × this)
  boardLengthScale: number;  // 0.2..3 — multiplies the along-fret-axis extent of the board
                             // rectangle (squash / stretch the LENGTH). Applied to logical
                             // coordinates BEFORE rendering, so fonts, dot glyphs and stroke
                             // widths never distort — only positions rescale.
  boardWidthScale: number;   // 0.2..3 — multiplies the across-string extent (the WIDTH) of
                             // the board rectangle. Same coordinate-space rule as above.
  stringWidthMode: 'uniform' | 'progressive';
  minStringWidth: number;
  maxStringWidth: number;
  nutWidth: number;          // nut bar thickness (px), drawn centered on the 0-fret line
  fretThickness: number;     // fret wire thickness (px) used to stroke every fret line
                             // (thin/narrow = vintage frets, larger = jumbo frets)
  reverseStrings: boolean;   // true ⇒ string order flipped (6 5 4 3 2 1 — left- vs right-handed)
  boardTaper: number;        // 0..1 — REAL guitar fretboard fan: the NUT end is the
                             // NARROWEST point of the board and the width GROWS toward
                             // the higher frets (it never shrinks). 0 ⇒ constant width;
                             // higher ⇒ wider at the high-fret end.
  taperMode: 'absolute' | 'relative';
                             // 'absolute' ⇒ taper follows real fret numbers (fret 12 is
                             // always widest) and changes with startFret;
                             // 'relative' ⇒ taper spans exactly the displayed slots, so
                             // the shape stays IDENTICAL no matter which starting fret
                             // is chosen.
  fretLabels: FretLabelMode; // show all / none / a custom set of fret numbers
  fretLabelList: string;     // comma/range list e.g. "3-5, 8, 12" (used when fretLabels='custom')
  openSide: 'nut' | 'far';   // which END the string open-pitches (e B G D A E) sit at
  margins: Margins;          // configurable padding of the board canvas (top/right/bottom/left)
  spacing: SpacingMode;
  firstFretSize: number;     // px (used when logarithmic)
  lastFretSize: number;      // px (used when logarithmic)
  showDots: boolean;         // inlays
  noteVisible: boolean;      // true ⇒ every note dot automatically shows its pitch
                             // (computed from the string tuning + absolute fret);
                             // a manually typed dot text still wins over the pitch.
  noteLabelMode: 'letter' | 'interval' | 'tonal' | 'degree';
                             // WHICH label note-visible mode draws:
                             //  letter   = actual pitch names (A, Bb, F# …)
                             //  interval = distance from the root (R, m3, P5 …)
                             //  tonal    = scale degrees of the key (1, b3, #4 …)
                             //  degree   = chromatic numbering, root = 1 .. 12
  noteRootPc: number;        // -1 ⇒ auto (lowest sounding note of the shape),
                             // otherwise an explicit reference pitch class 0..11
  noteKey: string;           // '' ⇒ auto (root major); e.g. "F", "Dm", "Bb min"
  octaveMode: boolean;       // true ⇒ adding a note also adds EVERY octave of it
                             // that falls inside the visible fret range
  dotTextColor: ChordColor;  // color used for those automatic pitch labels
  openNoteLabels: boolean;   // true ⇒ the open-string pitch ring (e B G D A E) is shown
  openNoteOffset: number;    // px — extra distance of that ring away from the board,
                             // so it never overlaps the open (rel −1) note dots.
  fretWidthPct: number;      // 50..150 — fret-line length as % of the full taper width
                             // (100% ⇒ every fret spans the board edge to edge)
  tuning: number[];          // open-string MIDI numbers, model order: index 0 = high e .. 5 = low E
  preferFlats: boolean;      // spell auto pitches with flats instead of sharps
  dotMarkerColor: ChordColor;
  bgFill: ChordColor;
  fretColor: ChordColor;
  stringColor: ChordColor;

  // --- note dots ---
  baseDotSize: number;       // diameter px
  colors: ChordColor[];      // basket
  defaultColors: ChordColor[]; // the 7 cycling colors
  standardShapes: string[];  // names (not removable)
  customShapes: string[];    // names (svg defined)
  defaultShapes: string[];   // the 7 cycling shape names
  shapeDefaultColor: ChordColor; // fill used when dot has no color entry
  shapeScale: number;        // global scale for shape glyphs
  defaultTextFont: string;
  defaultTextColor: ChordColor;
  defaultTextSize: number;   // px
  defaultTextRotation: number;

  // --- misc ---
  fingeringsLeft: boolean;   // legacy alias of flipAlong (kept for old saved data)
  exportScale: number;
  exportQuality: number;     // 0..1 for jpg/png
}

export interface ChordDoc {
  id: string;                   // stable identity (survives renames)
  name: string;
  dots: Dot[];
  texts: TextBox[];
  fingerings: Fingering[];
  settings?: Partial<Settings>; // PER-CHORD layout override — each chord keeps its own
                                // starting fret, frets displayed, taper, spacing etc.
                                // The effective settings = global defaults ⊕ this patch.
}

// ---------- helpers ----------

let _seq = 0;
export function uid(prefix = 'id'): string {
  _seq++;
  return `${prefix}-${Date.now().toString(36)}-${_seq.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function fretsFor(settings: Settings): number[] {
  const arr: number[] = [];
  for (let i = 0; i < settings.numFrets; i++) arr.push(settings.startFret + i);
  return arr;
}

/** Relative fret slot 0..numFrets-1 for an absolute fret (-1 = open/nut position). */
export function relFret(settings: Settings, abs: number): number {
  return abs - settings.startFret;
}

/** true ⇒ a dot sits in the floating open-string zone just before the nut. */
export function isOpenRel(rel: number): boolean {
  return rel < 0 && rel >= -1;
}

/** true ⇒ the dot falls outside the visible fret range and should not be drawn. */
export function isHiddenRel(s: Settings, rel: number): boolean {
  return !isOpenRel(rel) && (rel < 0 || rel > s.numFrets - 1);
}

/** true ⇒ the nut bar is drawn. The nut exists ONLY when the view starts at fret 1 —
 *  higher starting frets sit mid-neck, where a real guitar has no nut. */
export function nutShown(s: Settings): boolean {
  return s.startFret === 1;
}

/** Clamp helpers for the quick-override controls (frets displayed ≥ 3 always). */
export const MIN_NUM_FRETS = 3;
export function clampNumFrets(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_NUM_FRETS_CLAMP;
  return Math.max(MIN_NUM_FRETS, Math.min(27, Math.round(v)));
}
const DEFAULT_NUM_FRETS_CLAMP = 5;

export function clampStartFret(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(24, Math.round(v)));
}

// ---------- multi-chord document model ----------
//
// A Page holds several ChordDocs. Each chord carries its OWN layout patch
// (`chord.settings`); the effective settings of a chord are
//   globalDefaults ⊕ chordPatch
// so every chord can have its own starting fret / frets displayed / taper /
// spacing etc., while shared data (color basket, shape list) stays global.

/** The keys that make up the per-chord geometry/appearance patch.
 *  NOTE: boardLengthScale / boardWidthScale are intentionally EXCLUDED —
 *  the fretboard scale is a GLOBAL setting that applies to every chord. */
export const CHORD_SETTING_KEYS: (keyof Settings)[] = [
  'numFrets', 'startFret', 'orientation', 'flipAlong', 'flipAcross',
  'fretSpacing', 'stringGap',
  'stringWidthMode', 'minStringWidth', 'maxStringWidth',
  'nutWidth', 'fretThickness', 'reverseStrings', 'boardTaper', 'taperMode',
  'fretLabels', 'fretLabelList', 'openSide', 'margins', 'spacing',
  'firstFretSize', 'lastFretSize', 'showDots', 'noteVisible', 'dotTextColor',
  'noteLabelMode', 'noteRootPc', 'noteKey', 'octaveMode',
  'openNoteLabels', 'openNoteOffset', 'tuning', 'preferFlats',
  'dotMarkerColor', 'bgFill', 'fretColor', 'stringColor',
  'baseDotSize', 'shapeScale', 'fretWidthPct', 'defaultTextFont', 'defaultTextColor',
  'defaultTextSize', 'defaultTextRotation',
];

export type ChordSettingsPatch = Partial<Pick<Settings, typeof CHORD_SETTING_KEYS[number]>>;

/** Extract a full per-chord patch snapshot from a merged Settings object. */
export function chordPatchFrom(s: Settings): ChordSettingsPatch {
  const out: Record<string, unknown> = {};
  for (const k of CHORD_SETTING_KEYS) out[k] = structuredClone(s[k]);
  return out as ChordSettingsPatch;
}

/** Merge order: defaults first, patch last (patch wins). */
export function mergeChordSettings(base: Settings, patch?: Partial<Settings>): Settings {
  if (!patch) return base;
  return { ...base, ...structuredClone(patch) };
}

/** The fretboard scale is GLOBAL: it always comes from the user's global
 *  settings and overrides any per-chord patch value, so changing it once
 *  affects every chord on every page. */
export function applyGlobalBoardScale(eff: Settings, global: Settings): Settings {
  eff.boardLengthScale = global.boardLengthScale;
  eff.boardWidthScale = global.boardWidthScale;
  return eff;
}

/** Normalized chord id accessor — old saved data may lack `id`. */
export function chordId(c: ChordDoc): string {
  if (!c.id) c.id = uid('chord');
  return c.id;
}

/** Canvas position + size of one chord on the page (page coords, unscaled units). */
export interface ChordPlacement { x: number; y: number; w: number; h: number; scale: number }

/** Placement boxes overlap? (used to keep chords from stacking on top of each other) */
export function placementsOverlap(a: ChordPlacement, b: ChordPlacement): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export type PageSizeName = 'letter' | 'legal' | 'a4' | 'a3' | 'custom';

export interface PageConfig {
  size: PageSizeName;
  landscape: boolean;
  customW: number;   // px (used when size === 'custom')
  customH: number;
  showGrid: boolean;
  snap: boolean;
  gridSize: number;  // px
}

/** A page is a document too — it needs its own stable id (multi-page support). */
export interface PageDoc {
  id: string;                                 // stable page identity
  name: string;
  config: PageConfig;
  chords: ChordDoc[];
  placements: Record<string, ChordPlacement>; // keyed by chord id
  selected: string | null;                    // currently selected chord id
}

/** true ⇒ the placement box sits fully inside the page bounds. */
/** Resolve a placement's position so it neither leaves the page nor overlaps
 *  any of `others`. Searches outward from the original spot on a step grid and
 *  returns the closest free position (falls back to the clamped original when
 *  the page is full). Pure — does not mutate its arguments. */
export function resolveCollision(
  pl: ChordPlacement,
  others: ChordPlacement[],
  page: { w: number; h: number },
  step = 10,
): ChordPlacement {
  const rectAt = (x: number, y: number): ChordPlacement => ({
    ...pl,
    x: Math.max(0, Math.min(Math.max(0, page.w - pl.w * pl.scale), x)),
    y: Math.max(0, Math.min(Math.max(0, page.h - pl.h * pl.scale), y)),
  });
  const collides = (r: ChordPlacement) => others.some(o => placementsOverlap(r, o));
  if (!collides(pl)) return pl;
  for (let radius = 1; radius <= 60; radius++) {
    let best: ChordPlacement | null = null;
    let bestD = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const cand = rectAt(pl.x + dx * step, pl.y + dy * step);
        if (collides(cand)) continue;
        const d = Math.hypot(cand.x - pl.x, cand.y - pl.y);
        if (d < bestD) { bestD = d; best = cand; }
      }
    }
    if (best) return best;
  }
  return rectAt(pl.x, pl.y); // page is full — keep it at least inside the page
}

export function fitsPage(pl: ChordPlacement, page: { w: number; h: number }): boolean {
  return pl.x >= 0 && pl.y >= 0 && pl.x + pl.w <= page.w && pl.y + pl.h <= page.h;
}

export const PAGE_SIZES: Record<Exclude<PageSizeName, 'custom'>, { label: string; w: number; h: number }> = {
  letter: { label: 'Letter 8.5\u00d711"', w: 816, h: 1056 },
  legal: { label: 'Legal 8.5\u00d714"', w: 816, h: 1344 },
  a4: { label: 'A4 210\u00d7297mm', w: 794, h: 1123 },
  a3: { label: 'A3 297\u00d7420mm', w: 1123, h: 1587 },
};

export function pageSizePx(cfg: PageConfig): { w: number; h: number } {
  const base = cfg.size === 'custom'
    ? { w: Math.max(200, Math.round(cfg.customW)), h: Math.max(200, Math.round(cfg.customH)) }
    : (() => { const p = PAGE_SIZES[cfg.size]; return { w: p.w, h: p.h }; })();
  return cfg.landscape ? { w: base.h, h: base.w } : base;
}

/** Default placement box for a chord (its natural canvas size, or a fallback). */
export function defaultPlacement(natural: { w: number; h: number } | null): ChordPlacement {
  const w = natural?.w ?? 320, h = natural?.h ?? 420;
  return { x: 60, y: 60, w, h, scale: 1 };
}

/** Snap a value to the grid when snapping is enabled. */
export function snapVal(v: number, cfg: PageConfig): number {
  if (!cfg.snap || !Number.isFinite(v)) return v;
  const g = Math.max(2, cfg.gridSize || 10);
  return Math.round(v / g) * g;
}

export function isStandardShape(name: string, s: Settings): boolean {
  return s.standardShapes.includes(name);
}
