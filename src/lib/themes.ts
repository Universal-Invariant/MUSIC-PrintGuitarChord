// ---------- Note themes: color + shape + text per chromatic slot ----------
//
// A THEME assigns, for each of the 12 chromatic slots (0..11), a color (index
// into the global basket `settings.colors`), a shape (index into
// `allShapeNames(settings)`) and an optional display TEXT. Themes are reusable
// presets so users never have to restyle dots by hand chord-by-chord.
//
// Slot meaning depends on the theme MODE:
//   • absolute — slot = sounding PITCH CLASS (0 = C .. 11 = B). The theme's
//     root note anchors the letters: with root C, every C dot lands in slot 0.
//     Transposing a chord moves dots between slots (the look follows the note).
//   • relative — slot = semitones above the ROOT selected in the chord editor
//     (auto ⇒ lowest sounding note). Transposing keeps every dot in its slot
//     (the look follows the FUNCTION); letter-mode texts re-spell correctly
//     because dot labels stay derived from tuning+fret at render time, and any
//     baked pitch label is shifted by the transpose itself (shiftPitchLabel).
//
// Enharmonic spellings collapse onto one slot (C# = Db live in slot 1); the
// spelling SHOWN is handled by the note-label modes in music.ts, which already
// implement sharp/flat arithmetic: sharps raise the pitch one semitone while
// the letter moves contravariantly (B# = C, E# = F, C## = D; #1 = b2 …), and
// intervals carry no accidentals in canonical names (+4 = -5 = TT, a #2 IS an
// m3). Double/triple accidentals ('x' = double sharp, 'bb') are produced when
// the spelling demands them.

import type { ChordColor, ChordDoc, Dot, Settings } from './types';
import { uid } from './types';
import { allShapeNames } from './render';
import { shapeInner } from './shapes';
import { LETTER_PC, midiToName, parseKeyString, shapeRootPc } from './music';

/** Canonical sharp / flat names of the 12 pitch classes. */
export const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const PC_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** One theme slot: everything a themed dot needs. */
export interface ThemeSlot {
  /** index into settings.colors (the global basket) */
  colorIdx: number;
  /** index into allShapeNames(settings) (standard + custom shapes) */
  shapeIdx: number;
  /** Text template: '' ⇒ keep the dot's own text / auto note label.
   *  Non-empty ⇒ literal text written into matching dots on APPLY
   *  ('R', 'rEsol', '♮3', …). Relative-mode templates may contain '#' or
   *  'b' tokens that transpose together with the chord (see below). */
  text: string;
}

export type ThemeMode = 'absolute' | 'relative';

export interface NoteTheme {
  id: string;
  name: string;
  mode: ThemeMode;
  /** Absolute-mode reference pitch class (0 = C): the letter anchor. Ignored
   *  in relative mode where the chord's own root wins. */
  rootPc: number;
  /** true ⇒ suggested letter names prefer flats (Eb, not D#). */
  preferFlats: boolean;
  /** 12 slots. Indexed by pitch class (absolute) or semitones-above-root
   *  (relative). */
  slots: ThemeSlot[];
}

/** Default cycling assignment over the 7 default colors/shapes. */
export function defaultSlots(): ThemeSlot[] {
  return Array.from({ length: 12 }, (_, i) => ({
    colorIdx: i % 7,
    shapeIdx: i % 7,
    text: '',
  }));
}

export function makeTheme(name: string): NoteTheme {
  return { id: uid('theme'), name, mode: 'relative', rootPc: 0, preferFlats: false, slots: defaultSlots() };
}

/** Built-in starter themes (also offered as "add preset" buttons). */
export function builtinThemes(): NoteTheme[] {
  const rainbow = makeTheme('Rainbow (chromatic)');
  const diaChro = makeTheme('Diatonic vs Chromatic');
  diaChro.slots = diaChro.slots.map((s, pc) => {
    const natural = [0, 2, 4, 5, 7, 9, 11].includes(pc);
    return natural ? s : { ...s, colorIdx: 12, shapeIdx: 2 }; // faded diamond for accidentals
  });
  const funcTones = makeTheme('Function tones (R-3-5)');
  funcTones.slots = funcTones.slots.map((s, rel) => {
    if (rel === 0) return { ...s, colorIdx: 0, shapeIdx: 0 };             // R  red circle
    if (rel === 3 || rel === 4) return { ...s, colorIdx: 4, shapeIdx: 1 }; // 3rd blue square
    if (rel === 7) return { ...s, colorIdx: 3, shapeIdx: 3 };              // 5th green triangle
    return { ...s, colorIdx: 12, shapeIdx: 2 };                            // others muted diamond
  });
  return [rainbow, diaChro, funcTones];
}

/** Sanitize a stored theme (defensive against corrupt localStorage). */
export function normalizeTheme(t: unknown): NoteTheme | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  const slotsRaw = Array.isArray(o.slots) ? o.slots : [];
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d);
  const slots: ThemeSlot[] = Array.from({ length: 12 }, (_, i) => {
    const s = slotsRaw[i] as Record<string, unknown> | undefined;
    return {
      colorIdx: Math.max(0, num(s?.colorIdx, i % 7)),
      shapeIdx: Math.max(0, num(s?.shapeIdx, i % 7)),
      text: typeof s?.text === 'string' ? s.text : '',
    };
  });
  return {
    id: typeof o.id === 'string' && o.id ? o.id : uid('theme'),
    name: typeof o.name === 'string' ? o.name : 'Theme',
    mode: o.mode === 'absolute' ? 'absolute' : 'relative',
    rootPc: Math.max(0, Math.min(11, num(o.rootPc, 0))),
    preferFlats: !!o.preferFlats,
    slots,
  };
}

// ---------- localStorage ----------

const LS_THEMES = 'gchords.themes.v1';

export function loadThemes(): NoteTheme[] {
  try {
    const raw = localStorage.getItem(LS_THEMES);
    if (!raw) return builtinThemes();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return builtinThemes();
    const list = arr.map(normalizeTheme).filter((t): t is NoteTheme => !!t);
    return list.length ? list : builtinThemes();
  } catch { return builtinThemes(); }
}

export function saveThemes(list: NoteTheme[]) {
  try { localStorage.setItem(LS_THEMES, JSON.stringify(list)); } catch { /* ignore */ }
}

// ---------- slot resolution ----------

/** Semitone distance of pitch class `pc` above `rootPc` (0..11). */
export function relToRoot(pc: number, rootPc: number): number {
  return ((pc - rootPc) % 12 + 12) % 12;
}

/** Resolve the theme slot index for one sounding pitch class. */
export function slotForPc(theme: NoteTheme, pc: number, rootPc: number): number {
  return theme.mode === 'absolute'
    ? ((pc % 12) + 12) % 12
    : relToRoot(pc, rootPc);
}

/** Root pitch class used when applying a relative theme to a chord: explicit
 *  editor root (`noteRootPc >= 0`) else the lowest sounding note. */
export function chordRootPc(doc: ChordDoc, s: Settings, fallback = 0): number {
  if ((s.noteRootPc ?? -1) >= 0) return ((s.noteRootPc as number) % 12 + 12) % 12;
  return shapeRootPc(doc.dots.map(d => ({ string: d.string, fret: d.fret })), s.tuning) ?? fallback;
}

/** Sounding pitch class of a dot under the current settings. */
export function dotPc(d: Dot, s: Settings): number {
  const midi = (s.tuning[d.string] ?? 64) + Math.max(0, d.fret);
  return ((midi % 12) + 12) % 12;
}

/** Letter suggestion for a slot (used by the dialog's editable text row):
 *  absolute ⇒ the slot IS a pitch class anchored at the theme root;
 *  relative ⇒ spelled against the chosen root note with proper accidental
 *  math (sharp preferred unless the theme prefers flats). */
export function suggestSlotText(theme: NoteTheme, slot: number): string {
  if (theme.mode === 'absolute') {
    return (theme.preferFlats ? PC_NAMES_FLAT : PC_NAMES)[slot];
  }
  const pc = (((theme.rootPc + slot) % 12) + 12) % 12;
  return midiToName(pc + 60, theme.preferFlats);
}

/** Apply a theme to ONE dot: sets colorIdx / shapeIdx; writes the slot's
 *  literal text when non-empty (empty ⇒ the dot keeps its own text/auto
 *  label). Never touches position or stacking fields. */
export function applyThemeToDot(theme: NoteTheme, d: Dot, rootPc: number, s: Settings): Dot {
  const slot = theme.slots[slotForPc(theme, dotPc(d, s), rootPc)];
  if (!slot) return d;
  const nd: Dot = { ...d, colorIdx: slot.colorIdx, shapeIdx: slot.shapeIdx };
  if (slot.text !== '') nd.text = slot.text;
  return nd;
}

/** Themed copy of a whole chord doc (apply-to-page / apply-to-library). */
export function applyThemeToChord(theme: NoteTheme, doc: ChordDoc, s: Settings): ChordDoc {
  const rootPc = theme.mode === 'relative' ? chordRootPc(doc, s, theme.rootPc) : theme.rootPc;
  return { ...doc, dots: doc.dots.map(d => applyThemeToDot(theme, d, rootPc, s)) };
}

// ---------- transpose interaction ----------

/** Rewrite a theme slot's literal text for a +n transpose. Relative-mode
 *  letter templates must follow the chord (a themed "C" becomes "D" after
 *  +2); tonal/degree templates like "#4" or "b3" shift their accidental
 *  prefix mod 12 the same way App.shiftPitchLabel does. Anything else
 *  (plain words, numbers without accidental context) survives untouched.
 *  Absolute-mode slots never change text — transposing MOVES dots between
 *  slots there, and each slot keeps its own identity. */
export function shiftThemeSlotText(theme: NoteTheme, txt: string, n: number): string {
  if (!txt || theme.mode !== 'relative') return txt;
  const t = txt.trim();
  if (!t) return txt;
  // accidental-only token ('#' / 'bb' …)
  if (/^[#+♯b♭]+$/.test(t)) {
    let d = 0;
    for (const ch of t) d += (ch === '#' || ch === '♯') ? 1 : -1;
    const nd = (((d + n) % 12) + 12) % 12;
    if (nd === 0) return '';
    return nd <= 6 ? '#'.repeat(nd) : 'b'.repeat(12 - nd);
  }
  // letter(+accidentals) optionally followed by digits/rest: 'C', 'Bb', 'F#m'…
  const m = t.match(/^([A-Ga-g])((?:[#b♯♭]*)(.*))$/);
  if (m) {
    const base = LETTER_PC[m[1].toUpperCase()];
    let pc = base;
    for (const ch of m[2]) pc += (ch === '#' || ch === '♯') ? 1 : (ch === 'b' || ch === '♭' ? -1 : 0);
    pc = ((pc + n) % 12 + 12) % 12;
    const preferFlat = /[b♭]/.test(m[2]) || theme.preferFlats;
    return midiToName(pc + 60, preferFlat) + (m[3] ?? '');
  }
  // tonal degree with accidental prefix: '#4', 'b7', '##1'
  const dm = t.match(/^([#+♯b♭]+)(\d+)(.*)$/);
  if (dm) {
    let d = 0;
    for (const ch of dm[1]) d += (ch === '#' || ch === '♯') ? 1 : -1;
    const deg = Number(dm[2]);
    // degree value ≡ semitones-above-root + 1 (mod 12 wrap for >7 kept simple:
    // only single-digit diatonic degrees get altered)
    const semis = ((deg - 1 + d) % 12 + 12) % 12;
    const ns = ((semis + n) % 12 + 12) % 12;
    const baseDeg = (ns % 7) + 1;
    const alter = ns < 7 ? 0 : ns - 7 > 3 ? ns - 12 : ns - 7;
    const pre = alter > 0 ? '#'.repeat(alter) : alter < 0 ? 'b'.repeat(-alter) : '';
    return `${pre}${baseDeg}${dm[3] ?? ''}`;
  }
  return txt;
}

/** Map every slot text of a theme through a transpose (used when transposing
 *  with "🌐 All chords" so themed literal labels follow the chord). */
export function shiftThemeTexts(theme: NoteTheme, n: number): NoteTheme {
  if (theme.mode !== 'relative') return theme;
  return { ...theme, slots: theme.slots.map(s => ({ ...s, text: shiftThemeSlotText(theme, s.text, n) })) };
}

// ---------- preview strip ----------

/** Small themed-dot SVG for the theme list rows ("what does this theme look
 *  like"): 12 glyphs, one per slot, tinted with the basket colors. */
export function themeStripSvg(theme: NoteTheme, s: Settings, customs: Record<string, string>, size = 18): string {
  const gap = size * 1.12;
  const w = gap * 12;
  const h = size;
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(1)}" height="${h}" viewBox="0 0 ${w.toFixed(1)} ${h}">`];
  const all = allShapeNames(s);
  for (let i = 0; i < 12; i++) {
    const slot = theme.slots[i];
    const c: ChordColor = s.colors[slot.colorIdx % Math.max(1, s.colors.length)] ?? { hex: '#000000', alpha: 1 };
    const shapeName = all[Math.min(slot.shapeIdx, all.length - 1)] ?? 'circle';
    const cx = gap * i + size / 2, cy = h / 2;
    const sc = (size * 0.46) / 50;
    parts.push(
      `<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) scale(${sc.toFixed(4)}) translate(-50,-50)" style="color:${c.hex}${Math.round(Math.max(0, Math.min(1, c.alpha)) * 255).toString(16).padStart(2, '0')}">` +
      shapeInner(shapeName, customs) + '</g>',
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

/** Key sanity helper reused by the dialog (tonal text templates need a key
 *  context only at render time; here we just validate user input). */
export function validThemeKeyName(str: string): boolean {
  if (!str.trim()) return true;
  return parseKeyString(str) != null;
}
