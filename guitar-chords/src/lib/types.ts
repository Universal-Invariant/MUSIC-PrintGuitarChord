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

export interface Settings {
  // --- fretboard geometry ---
  numFrets: number;          // number of spaces displayed
  startFret: number;         // absolute fret of first space
  orientation: Orientation;
  fretSpacing: number;       // px between frets in 'equal' mode (board length = numFrets × this)
  stringGap: number;         // px between strings (board width = 5 × this)
  stringWidthMode: 'uniform' | 'progressive';
  minStringWidth: number;
  maxStringWidth: number;
  showNut: boolean;
  nutWidth: number;          // nut bar thickness (px), drawn centered on the 0-fret line
  boardTaper: number;        // 0..1 — fretboard side taper: 0 ⇒ 0-fret end same width as the
                             // hypothetical 12th-fret position; higher ⇒ narrower at the nut.
                             // Independent of startFret so chords feel consistent.
  spacing: SpacingMode;
  firstFretSize: number;     // px (used when logarithmic)
  lastFretSize: number;      // px (used when logarithmic)
  showDots: boolean;         // inlays
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
  fingeringsLeft: boolean;   // true = nut on left
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

/** Relative fret positions 0..numFrets-1 for an absolute fret, or -1 if hidden. */
export function relFret(settings: Settings, abs: number): number {
  return abs - settings.startFret;
}

export function isStandardShape(name: string, s: Settings): boolean {
  return s.standardShapes.includes(name);
}
