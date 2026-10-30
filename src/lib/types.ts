// ---------- Core data model ----------

/** Fretboard-scale bounds shared by the settings UI, persistence and geometry. */
export const BOARD_SCALE_MIN = 0.2;
export const BOARD_SCALE_MAX = 3;

/** Slider ranges for the global dot/text sizing controls (shared with the UI). */
export const DOT_SIZE_MIN = 12;
export const DOT_SIZE_MAX = 48;
export const DEFAULT_BASE_DOT_SIZE = 26;
export const SHAPE_SCALE_MIN = 0.4;
export const SHAPE_SCALE_MAX = 1.6;
export const TEXT_SIZE_MIN = 6;
export const TEXT_SIZE_MAX = 60;
export const DEFAULT_TEXT_SIZE = 14;

/** Clamp a fretboard scale factor (NaN / missing values fall back to `dflt`). */
export function clampBoardScale(v: unknown, dflt = 1): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(BOARD_SCALE_MIN, Math.min(BOARD_SCALE_MAX, v))
    : dflt;
}

/** Round a slider value to 2 decimals without float noise (0.1 + 0.2 ⇒ 0.3). */
export function roundStep(v: number, step = 0.01): number {
  const q = Math.round(v / step);
  return +(q * step).toFixed(6);
}

/** Generic numeric clamp used by the fine-control sliders. */
export function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  return Math.max(min, Math.min(max, v));
}

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
  font?: string | null;      // overrides default font (null/missing ⇒ follow the GLOBAL default font)
  textColor?: ChordColor | null;
  textSize?: number | null;  // multiplier of baseDotSize
  transparency?: number | null; // 0..1 extra alpha multiplier
  rotation?: number;         // degrees
}

/** Free-floating text box (normalized coordinates 0..1 over whole board).
 *  font / size / rotation are OPTIONAL: when missing, the item follows the
 *  GLOBAL text defaults live (changing "Default font / size / rotation" in the
 *  settings updates every such item on EVERY chord — not just the selected
 *  one). An explicit value is a per-item override set from the item dialog. */
export interface TextBox {
  id: string;
  x: number; y: number;
  text: string;
  font?: string | null;
  size?: number | null;      // px at scale 1
  color: ChordColor;
  rotation?: number | null;
  anchor: 'start' | 'middle' | 'end';
  /** Per-item text styling. Missing ⇒ normal / not underlined, so every
   *  legacy document renders exactly as before. */
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Stacking level WITHIN this chord (dots are always drawn above every text
   *  box). Higher ⇒ painted later ⇒ on top of other text boxes of the same
   *  chord. Never affects stacking against OTHER chords — a text box always
   *  stays inside its own chord's layer, so another chord with a higher page
   *  z-order still covers it. Missing ⇒ 0 (legacy documents render as before). */
  zIndex?: number;
}

/** A closed spline region drawn on top of the fretboard (panel, frets and
 *  strings) but BELOW the dots / text / fingerings — used to circle groups of
 *  notes. Coordinates are normalized (0..1) over the chord canvas: they ride
 *  along with the board when orientation / flips / scale change, exactly like
 *  TextBox positions.
 *
 *  Geometry: a CYCLE of control points rendered as a Catmull-Rom spline closed
 *  through all of them (a smooth "lasso" around whatever is inside). The user
 *  drags any control point to reshape it, or grabs the fill to move the whole
 *  region. Double-clicking a segment inserts a new control point there. */
export interface Region {
  id: string;
  /** ≥3 control points, normalized to the chord canvas (x, y in 0..1). */
  pts: { x: number; y: number }[];
  /** Fill color; alpha ≈ 0.75 transparency by default ("beige wash"). */
  color: ChordColor;
  /** Outline stroke color. */
  borderColor: ChordColor;
  /** Outline thickness in px at scale 1. */
  borderWidth: number;
  /** Spline tension for THIS region's curve, 0..1 (higher ⇒ rounder).
   *  Missing ⇒ the global default (settings.regionSmoothing). Applied when
   *  rendering and hit-testing the closed Catmull-Rom outline. */
  smoothing?: number;
}

/** Default region style: beige fill at 75% opacity, warm brown outline. */
export function defaultRegionColor(): ChordColor { return { hex: '#f5deb3', alpha: 0.75 }; }
export function defaultRegionBorder(): ChordColor { return { hex: '#b3925a', alpha: 0.9 }; }

/** Fingering label drawn beside the nut, for one string. Same inheritance
 *  rules as TextBox for `font` and `size`. */
export interface Fingering {
  id: string;
  string: number;
  text: string;
  font?: string | null;
  size?: number | null;
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
  mirrorOctaves: boolean;    // true ⇒ every dot edit (add/remove/property) is
                             // mirrored to ±12-fret twins ON THE SAME STRING —
                             // the same pitch class one octave up/down at the
                             // identical string position. Fine-grained sibling
                             // of octaveMode; irrelevant while octaveMode is on.
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

  // --- regions (lassos) ---
  regionSmoothing: number;   // 0..1 — spline tension applied to NEWLY drawn
                             // regions (0 = angular polyline, 1 = maximally
                             // round). Existing regions keep their own stored
                             // value; the completion dialog can override it.
  regionFillAlpha: number;   // default fill alpha for new regions (0..1)
  regionBorderColorFollows: boolean; // border hex mirrors fill hex (alpha 1)

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
  /** Closed spline regions circling groups of notes. Drawn ABOVE the fretboard
   *  panel / frets / strings but BELOW the dots and text. Missing ⇒ [] so
   *  legacy documents render exactly as before. */
  regions?: Region[];
  settings?: Partial<Settings>; // PER-CHORD layout override — each chord keeps its own
                                // starting fret, frets displayed, taper, spacing etc.
                                // The effective settings = global defaults ⊕ this patch.
  /** Page stacking level: chords are painted in ascending z-order, so a higher
   *  value draws ON TOP of overlapping chords. Missing ⇒ 0 (legacy documents
   *  keep their original paint order). Controlled from the "Page setup" panel
   *  (⟲/↑/↓ buttons and the list badge) for the selected chord. */
  zOrder?: number;
}

/** Paint order for page chords: ascending zOrder, ties broken by insertion
 *  order (stable sort keeps legacy behaviour for equal levels). Pure — returns
 *  new arrays only when an actual reorder is needed. */
export function orderByZ<T extends ChordDoc>(list: T[]): T[] {
  if (!list.some(c => (c.zOrder ?? 0) !== 0)) return list; // all default ⇒ original order
  return list.map((c, i) => ({ c, i })).sort((a, b) =>
    (a.c.zOrder ?? 0) - (b.c.zOrder ?? 0) || a.i - b.i
  ).map(x => x.c);
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
 *  NOTE: the GLOBAL_ONLY_SETTING_KEYS below are intentionally EXCLUDED —
 *  those settings apply to every chord and must never be shadowed by a
 *  per-chord patch. */
export const CHORD_SETTING_KEYS: (keyof Settings)[] = [
  'numFrets', 'startFret', 'orientation', 'flipAlong', 'flipAcross',
  'fretSpacing', 'stringGap',
  'stringWidthMode', 'minStringWidth', 'maxStringWidth',
  'nutWidth', 'fretThickness', 'reverseStrings', 'boardTaper', 'taperMode',
  'fretLabels', 'fretLabelList', 'openSide', 'margins', 'spacing',
  'firstFretSize', 'lastFretSize', 'showDots', 'noteVisible', 'dotTextColor',
  'noteLabelMode', 'noteRootPc', 'noteKey', 'octaveMode',
  // 'mirrorOctaves' IS a per-chord patch key (like its sibling 'octaveMode'):
  // every chord carries its own value so the switch works in EVERY UI scope —
  // the toolbar quick bar, the Settings panel with a chord selected, and the
  // global defaults. The app-wide default lives in `settings`; chords without
  // an explicit patch value simply inherit it. An "All chords" broadcast copies
  // the edited value into every chord's patch (see App.setEff /
  // commitGlobalSettings).
  'mirrorOctaves',
  'openNoteLabels', 'openNoteOffset', 'tuning', 'preferFlats',
  'dotMarkerColor', 'bgFill', 'fretColor', 'stringColor',
  'fretWidthPct',
];

/** Settings that are GLOBAL by design: changing one of them must affect EVERY
 *  chord on EVERY page (and the saved library), not only the selected chord.
 *  - fretboard scale (boardLengthScale / boardWidthScale)
 *  - dot sizing ("Dot base size", "Shape scale")
 *  - text defaults (font / color / size / rotation)
 * They are excluded from the per-chord patch, force-overridden at render time
 * (see applyGlobalSettings) and stripped from legacy stored patches (see
 * stripGlobalKeysFromChordDocs). */
export const GLOBAL_ONLY_SETTING_KEYS: (keyof Settings)[] = [
  'boardLengthScale', 'boardWidthScale',
  'baseDotSize', 'shapeScale',
  'defaultTextFont', 'defaultTextColor', 'defaultTextSize', 'defaultTextRotation',
];

type GlobalOnlyKey = typeof GLOBAL_ONLY_SETTING_KEYS[number];

/** Sanitize one global value (clamped to its UI range; invalid ⇒ app default).
 *  Fractional values keep full precision (board scale snapped to 0.001, shape
 *  scale to 0.01) so the fine-control sliders can reach 0.1% / 1% increments
 *  exactly and typed values like "73.5%" survive round-trips. */
export function sanitizeGlobalValue<K extends GlobalOnlyKey>(k: K, v: unknown): Settings[K] {
  switch (k) {
    case 'boardLengthScale':
    case 'boardWidthScale':
      // 4 decimals: the slider's Ctrl step goes to 0.0005 (0.05%) — anything
      // coarser here would silently snap typed/fine values back.
      return Number(clampBoardScale(v, 1).toFixed(4)) as Settings[K];
    case 'baseDotSize':
      // integer px range — dot radius is computed from this in whole pixels
      return Math.round(clampNum(v, DOT_SIZE_MIN, DOT_SIZE_MAX, DEFAULT_BASE_DOT_SIZE)) as Settings[K];
    case 'shapeScale':
      // Keep full fine precision (4 decimals) so Shift/Ctrl slider steps and
      // typed values like 0.735 are NOT re-rounded by this sanitizer.
      return (typeof v === 'number' && Number.isFinite(v)
        ? Number(clampNum(v, SHAPE_SCALE_MIN, SHAPE_SCALE_MAX, 1).toFixed(4)) : 1) as Settings[K];
    case 'defaultTextSize':
      return clampNum(v, TEXT_SIZE_MIN, TEXT_SIZE_MAX, DEFAULT_TEXT_SIZE) as Settings[K];
    case 'defaultTextRotation':
      return ([0, 90, 180, 270].includes(Number(v)) ? Math.round(Number(v)) : 0) as Settings[K];
    case 'defaultTextFont':
      return (typeof v === 'string' && v ? v : 'Arial') as Settings[K];
    case 'defaultTextColor':
      return (v && typeof v === 'object' && typeof (v as ChordColor).hex === 'string'
        ? { ...v } : { hex: '#ffffff', alpha: 1 }) as Settings[K];
    default:
      return v as Settings[K];
  }
}

/** The GLOBAL values that must win over any per-chord patch, sanitized. */
function globalOverrideObject(global: Settings): Partial<Settings> {
  const o: Record<string, unknown> = {};
  for (const k of GLOBAL_ONLY_SETTING_KEYS) o[k] = sanitizeGlobalValue(k, global[k]);
  return o as Partial<Settings>;
}

export type ChordSettingsPatch = Partial<Pick<Settings, typeof CHORD_SETTING_KEYS[number]>>;

/** Extract a full per-chord patch snapshot from a merged Settings object.
 *  Only CHORD_SETTING_KEYS are stored; global-only keys never enter a patch. */
export function chordPatchFrom(s: Settings): ChordSettingsPatch {
  const out: Record<string, unknown> = {};
  for (const k of CHORD_SETTING_KEYS) out[k] = structuredClone(s[k]);
  return out as ChordSettingsPatch;
}

/** Merge order: defaults first, patch last (patch wins) — but GLOBAL-only keys
 *  are then force-overridden from `global`, so they can never be shadowed. */
export function mergeChordSettings(base: Settings, patch?: Partial<Settings>): Settings {
  if (!patch) return base;
  return { ...base, ...structuredClone(patch) };
}

/** The global settings (fretboard scale, dot sizing, text defaults) ALWAYS come
 *  from the user's global settings and override any per-chord patch value, so
 *  changing one of them once affects every chord on every page.
 *  Pure — never mutates its arguments; returns the SAME object when nothing
 *  has to be overridden (cheap to call inside memos / effects). */
export function applyGlobalSettings(eff: Settings, global: Settings): Settings {
  const ov = globalOverrideObject(global);
  let changed = false;
  for (const k of GLOBAL_ONLY_SETTING_KEYS) {
    if (eff[k] !== ov[k]) { changed = true; break; }
  }
  return changed ? { ...eff, ...ov } : eff;
}

/** @deprecated Renamed to applyGlobalSettings (the mechanism now covers more
 *  than the fretboard scale). Kept as an alias for existing call sites. */
export const applyGlobalBoardScale = applyGlobalSettings;

/** true ⇒ a chord doc stores stale GLOBAL-only values in its per-chord patch
 *  (legacy data from before these settings became app-wide). */
export function chordPatchHasGlobalKeys(c: ChordDoc): boolean {
  const p = c.settings as Partial<Settings> | undefined;
  if (!p) return false;
  return GLOBAL_ONLY_SETTING_KEYS.some(k => k in p);
}

/** @deprecated Renamed to chordPatchHasGlobalKeys. */
export const chordPatchHasBoardScale = chordPatchHasGlobalKeys;

/** Strip every GLOBAL-only key out of each chord's per-chord settings patch
 *  (pages AND the saved library). Iterates over ALL chords, not just the
 *  selected one, so no chord can keep a stale override that would shadow the
 *  global sliders. Returns the SAME array instance when nothing needs fixing
 *  (safe to call from an effect without looping renders). */
export function stripGlobalKeysFromChordDocs<T extends ChordDoc>(list: T[]): T[] {
  let changed = false;
  const out = list.map(c => {
    if (!chordPatchHasGlobalKeys(c)) return c;
    changed = true;
    const p: Record<string, unknown> = { ...(c.settings as Record<string, unknown>) };
    for (const k of GLOBAL_ONLY_SETTING_KEYS) delete p[k];
    return { ...c, settings: p as Partial<Settings> };
  });
  return changed ? out : list;
}

/** @deprecated Renamed to stripGlobalKeysFromChordDocs. */
export const stripBoardScaleFromChordDocs = stripGlobalKeysFromChordDocs;

/** Batch-apply the GLOBAL settings to EVERY chord doc — the "these settings
 *  effect all created chords" rule. Used when the user changes a global-only
 *  slider (fretboard scale, dot base size, shape scale) or a text default
 *  (font / size / rotation): we iterate over all chords and write the new
 *  values into each chord's own patch, so even chords whose patch previously
 *  shadowed the key follow the change everywhere (editor, pages, exports,
 *  print composer and library thumbnails).
 *  Per-chord items that explicitly override the same property (e.g. a text box
 *  with its own font/size) keep their override — the batch only syncs the
 *  chord-level settings.
 *  Pure per-doc: untouched chords keep their identity; returns the SAME array
 *  instance when nothing changed (safe inside useEffect dependency loops). */
export function applyGlobalSettingsToAllChords(list: ChordDoc[], global: Settings): ChordDoc[] {
  const ov = globalOverrideObject(global);
  let changed = false;
  const out = list.map(c => {
    const prev = c.settings as Partial<Settings> | undefined;
    let differs = false;
    for (const k of GLOBAL_ONLY_SETTING_KEYS) {
      if (!prev || prev[k] !== ov[k]) { differs = true; break; }
    }
    if (!differs) return c; // already carries the current global values
    changed = true;
    return { ...c, settings: { ...prev, ...ov } as ChordSettingsPatch };
  });
  return changed ? out : list;
}

/** @deprecated Renamed to applyGlobalSettingsToAllChords (covers more keys
 *  than the fretboard scale now). */
export const applyBoardScaleToAllChords = applyGlobalSettingsToAllChords;

/** Subset of GLOBAL_ONLY_SETTING_KEYS that are ACTUAL PER-CHORD settings —
 *  every chord carries them in its patch so exports / print composer /
 *  library thumbnails render with the current global values even when the
 *  consumer merges only the chord's own patch. */
export const SYNCED_GLOBAL_KEYS: GlobalOnlyKey[] = [
  'boardLengthScale', 'boardWidthScale',
  'baseDotSize', 'shapeScale',
  'defaultTextFont', 'defaultTextColor', 'defaultTextSize', 'defaultTextRotation',
];

/** Which per-chord patch keys a "apply-to-all" edit should propagate.
 *  - always: the synced global keys above (every chord must carry them)
 *  - plus:   the edited key itself, IF it is a real per-chord setting
 *            (numFrets, startFret, orientation, margins, …)
 *  Keys that are neither (e.g. color basket / shape cycle lists, which live
 *  globally by design) return [] ⇒ nothing to propagate. Pure. */
export function allChordPatchKeysFor(edited: string): (keyof Settings)[] {
  if ((SYNCED_GLOBAL_KEYS as readonly string[]).includes(edited)) return [...SYNCED_GLOBAL_KEYS];
  if ((CHORD_SETTING_KEYS as readonly string[]).includes(edited)) return [...SYNCED_GLOBAL_KEYS, edited as keyof Settings];
  return [];
}

/** Sync ONLY the given keys from the global settings into EVERY chord doc's
 *  patch (the toolbar "Apply to all chords" mode). `global` may be either the
 *  app-wide settings or the selected chord's effective settings — the caller
 *  decides what value each chord receives. Never stores undefined values.
 *  Returns the SAME array instance when no chord actually changes. */
export function syncKeysToAllChords<T extends ChordDoc>(list: T[], global: Settings, keys: readonly (keyof Settings)[]): T[] {
  let changed = false;
  const out = list.map(c => {
    const prev = (c.settings ?? {}) as Partial<Settings>;
    let differs = false;
    for (const k of keys) {
      const nv = global[k];
      if (nv === undefined) continue; // never write undefined into a patch
      const ov = prev[k] as unknown, nvv = nv as unknown;
      if (typeof nvv === 'object' ? JSON.stringify(ov) !== JSON.stringify(nvv) : ov !== nvv) { differs = true; break; }
    }
    if (!differs) return c;
    changed = true;
    const np: Record<string, unknown> = { ...prev };
    for (const k of keys) { const v = global[k]; if (v !== undefined) np[k] = structuredClone(v); }
    return { ...c, settings: np as ChordSettingsPatch };
  });
  return changed ? out : list;
}

/** True ⇒ the chord patch carries stale GLOBAL-only values (legacy data). */
function patchHasGlobalKeys(patch: Partial<Settings> | undefined): boolean {
  return !!patch && GLOBAL_ONLY_SETTING_KEYS.some(k => k in patch);
}

/** Keys a "synced" chord still needs copied from the source settings. A chord
 *  counts as synced when its patch carries ALL global-only keys with EXACTLY
 *  the source's values (JSON-compared, so color objects compare by content).
 *  Pure helper shared by the load-time migration and the apply-to-all sync. */
function missingSyncKeys(patch: Partial<Settings> | undefined, src: Settings, keys: readonly (keyof Settings)[]): (keyof Settings)[] {
  const out: (keyof Settings)[] = [];
  for (const k of keys) {
    const nv = src[k];
    if (nv === undefined) continue; // never write undefined into a patch
    const ov = patch?.[k] as unknown, nvv = nv as unknown;
    if (typeof nvv === 'object' ? JSON.stringify(ov) !== JSON.stringify(nvv) : ov !== nv) out.push(k);
  }
  return out;
}

/** One-time normalization of a loaded chord doc against the CURRENT global
 *  settings (runs inside normalizeChord, i.e. before React state exists):
 *  - legacy patches that shadow a GLOBAL-only key are stripped first;
 *  - then every chord is brought up to date so each patch carries the current
 *    global values (exports / print composer render correctly even when they
 *    merge only the chord's own patch);
 *  - finally, text items that were created to FOLLOW the global defaults
 *    (font/size/rotation unset ⇒ live inheritance) get those defaults baked
 *    in, so future explicit "apply to all chords" edits can reach them too.
 *  Returns the SAME object when nothing needs fixing. */
export function normalizeChordGlobals(c: ChordDoc, global: Settings): ChordDoc {
  let changed = false;
  let patch = c.settings as Partial<Settings> | undefined;
  if (patchHasGlobalKeys(patch)) {
    const p: Record<string, unknown> = { ...patch };
    for (const k of GLOBAL_ONLY_SETTING_KEYS) delete p[k];
    patch = p as Partial<Settings>;
    changed = true;
  }
  const missing = missingSyncKeys(patch, global, SYNCED_GLOBAL_KEYS);
  if (missing.length) {
    const np: Record<string, unknown> = { ...patch };
    for (const k of missing) np[k] = structuredClone(global[k]);
    patch = np as ChordSettingsPatch;
    changed = true;
  }
  let dots = c.dots, texts = c.texts, fingerings = c.fingerings;
  const mapItems = <T extends Dot | TextBox | Fingering>(list: T[]): T[] => {
    let any = false;
    const out = list.map(it => {
      const nb = bakeItemDefaults(it, global);
      if (nb !== it) any = true;
      return nb;
    });
    return any ? out : list;
  };
  dots = mapItems(c.dots); texts = mapItems(c.texts); fingerings = mapItems(c.fingerings);
  if (dots !== c.dots || texts !== c.texts || fingerings !== c.fingerings) changed = true;
  if (!changed) return c;
  return { ...c, settings: patch, dots, texts, fingerings };
}

/** Batch-normalize an entire chord list (pages / library) — identity-preserving
 *  like stripGlobalKeysFromChordDocs, safe inside effects. */
export function normalizeAllChordGlobals<T extends ChordDoc>(list: T[], global: Settings): T[] {
  let changed = false;
  const out = list.map(c => {
    const n = normalizeChordGlobals(c, global);
    if (n !== c) changed = true;
    return n as T;
  });
  return changed ? out : list;
}

/** Bake the CURRENT global text defaults into one drawable item, but only on
 *  properties it does not explicitly override yet (a non-null / present per-item
 *  value is a deliberate override and stays untouched). This makes items
 *  created via newText()/newFingering() (which store NO font/size/rotation so
 *  they follow the globals live) reachable by a later "apply to all chords"
 *  edit: they receive the value active at bake time instead of silently
 *  inheriting some other older default. Idempotent — returns the SAME object
 *  when nothing needs baking. */
export function bakeItemDefaults<T extends Dot | TextBox | Fingering>(it: T, s: Settings): T {
  const p: Record<string, unknown> = {};
  const inheritable = (v: unknown) => v === undefined || v === null;
  // font: shared by dots / text boxes / fingerings — inheritable when nullish
  if (inheritable((it as { font?: string | null }).font)) p.font = s.defaultTextFont ?? 'Arial';
  // size: text boxes & fingerings only (Dot has no `size`; dot glyphs use the
  // global baseDotSize/shapeScale directly, and dot label scale is `textSize`)
  if ('size' in it && inheritable((it as { size?: number | null }).size)) p.size = s.defaultTextSize ?? 14;
  // rotation: text boxes only (Dot.rotation is the SHAPE glyph rotation and is
  // always stored — makeDot initializes it — so it must never be baked)
  if ('rotation' in it && inheritable((it as { rotation?: number | null }).rotation)) p.rotation = s.defaultTextRotation ?? 0;
  // text-inside-dot color follows the global text color while un-overridden
  if ('textColor' in it && inheritable((it as { textColor?: ChordColor | null }).textColor)) p.textColor = { ...(s.defaultTextColor ?? { hex: '#ffffff', alpha: 1 }) };
  if (Object.keys(p).length === 0) return it;
  return { ...it, ...p } as T;
}

/** Bake the global text defaults into EVERY inherited item of a batch of
 *  chord docs (used by the apply-to-all propagation when a text default was
 *  part of the change). Identity-preserving: returns the SAME array instance
 *  when no item needed baking. */
export function bakeInheritedItemsToAllChords<T extends ChordDoc>(list: T[], src: Settings): T[] {
  let changed = false;
  const out = list.map(c => {
    const dots = c.dots.map(d => bakeItemDefaults(d, src));
    const texts = c.texts.map(t => bakeItemDefaults(t, src));
    const fing = c.fingerings.map(f => bakeItemDefaults(f, src));
    if (dots === c.dots && texts === c.texts && fing === c.fingerings) return c;
    changed = true;
    return { ...c, dots, texts, fingerings: fing };
  });
  return changed ? out : list;
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
  /** true ⇒ chords may be positioned freely, even on top of each other.
   *  false (default) ⇒ collision detection keeps chord boxes from overlapping.
   *  Chords always stay inside the page bounds regardless of this flag. */
  allowOverlap: boolean;
  /** true ⇒ "− Scale / ＋ Scale" work in ABSOLUTE mode: every chord is first
   *  reset to the default scale (100%) and then scaled by the button factor,
   *  so chords that started at the same size end up at the same size again.
   *  false (default) ⇒ relative mode: each chord's own scale is multiplied. */
  absoluteScale: boolean;
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
 *  the page is full). Pure — does not mutate its arguments.
 *  opts.collide = false ⇒ collision detection is DISABLED ("Allow overlap" in
 *  Page setup): chords may sit freely on top of each other; only the page-bound
 *  clamp still applies (chords must stay on the page). */
export function resolveCollision(
  pl: ChordPlacement,
  others: ChordPlacement[],
  page: { w: number; h: number },
  stepOrOpts: number | { step?: number; collide?: boolean } = 10,
): ChordPlacement {
  const opts = typeof stepOrOpts === 'number' ? { step: stepOrOpts } : stepOrOpts;
  const step = opts.step ?? 10;
  const collide = opts.collide !== false;
  const rectAt = (x: number, y: number): ChordPlacement => ({
    ...pl,
    x: Math.max(0, Math.min(Math.max(0, page.w - pl.w * pl.scale), x)),
    y: Math.max(0, Math.min(Math.max(0, page.h - pl.h * pl.scale), y)),
  });
  const collides = (r: ChordPlacement) => collide && others.some(o => placementsOverlap(r, o));
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
