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
  dotTextColor: ChordColor;  // color used for those automatic pitch labels
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
  name: string;
  dots: Dot[];
  texts: TextBox[];
  fingerings: Fingering[];
  settings?: Partial<Settings>; // optional per-chord layout override
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

export function isStandardShape(name: string, s: Settings): boolean {
  return s.standardShapes.includes(name);
}
