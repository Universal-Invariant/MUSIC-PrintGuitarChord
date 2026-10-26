// ---------- Music theory helpers ----------

import type { Settings } from './types';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Open-string MIDI numbers for standard tuning (index 0 = low E .. 5 = high e). */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

/** Same list in DOT-model order (index 0 = high e .. 5 = low E) — what Settings.tuning stores. */
export const TUNING_HIGH_TO_LOW = [...STANDARD_TUNING].reverse();

/** Common tunings, stored in dot-model order (high e → low E), with display names. */
export const TUNING_PRESETS: { name: string; values: number[] }[] = [
  { name: 'Standard EADGBE', values: TUNING_HIGH_TO_LOW },
  { name: 'Drop D', values: [64, 59, 55, 50, 45, 38] },
  { name: 'Half step down (Eb)', values: [63, 58, 54, 49, 44, 39] },
  { name: 'Whole step down (D)', values: [62, 57, 53, 48, 43, 38] },
  { name: 'Open G (DGDGBD)', values: [62, 55, 50, 55, 50, 55] },
  { name: 'DADGAD', values: [62, 57, 50, 55, 45, 38] },
  { name: 'Open D (FADFAD)', values: [65, 57, 50, 57, 53, 50] },
];

export function midiToName(midi: number, preferFlat = false): string {
  const pc = ((midi % 12) + 12) % 12;
  return (preferFlat ? FLATS : NOTE_NAMES)[pc];
}

export interface ChordDef {
  name: string;
  /** per string low-E..high-e: fret or null (muted). -1 handled by caller for open. */
  shape: (number | null)[];
  fingerings?: string[]; // optional, same order
}

// shape arrays are ordered LOW E -> HIGH e; value = absolute fret, null = muted
export const CHORD_LIBRARY: ChordDef[] = [
  { name: 'Em', shape: [0, 2, 2, 0, 0, 0], fingerings: ['0', '2', '3', '0', '0', '0'] },
  { name: 'Am', shape: [null, 0, 2, 2, 1, 0], fingerings: ['x', '0', '2', '3', '1', '0'] },
  { name: 'E', shape: [0, 2, 2, 1, 0, 0], fingerings: ['0', '3', '4', '1', '0', '0'] },
  { name: 'A', shape: [null, 0, 2, 2, 2, 0], fingerings: ['x', '0', '1', '2', '3', '0'] },
  { name: 'D', shape: [null, null, 0, 2, 3, 2], fingerings: ['x', 'x', '0', '1', '3', '2'] },
  { name: 'C', shape: [null, 3, 2, 0, 1, 0], fingerings: ['x', '3', '2', '0', '1', '0'] },
  { name: 'G', shape: [3, 2, 0, 0, 0, 3], fingerings: ['2', '1', '0', '0', '0', '3'] },
  { name: 'F', shape: [1, 1, 2, 3, 3, 1], fingerings: ['1', '1', '2', '3', '4', '1'] },
  { name: 'Dm', shape: [null, null, 0, 2, 3, 1], fingerings: ['x', 'x', '0', '2', '3', '1'] },
  { name: 'B7', shape: [null, 2, 1, 2, 0, 2], fingerings: ['x', '2', '1', '3', '0', '4'] },
  { name: 'A7', shape: [null, 0, 2, 0, 2, 0], fingerings: ['x', '0', '2', '0', '3', '0'] },
  { name: 'D7', shape: [null, null, 0, 2, 1, 2], fingerings: ['x', 'x', '0', '2', '1', '3'] },
  { name: 'G7', shape: [3, 2, 0, 0, 0, 1], fingerings: ['3', '2', '0', '0', '0', '1'] },
  { name: 'Cmaj7', shape: [null, 3, 2, 0, 0, 0], fingerings: ['x', '3', '2', '0', '0', '0'] },
  { name: 'Am7', shape: [null, 0, 2, 0, 1, 0], fingerings: ['x', '0', '2', '0', '1', '0'] },
  { name: 'Em7', shape: [0, 2, 2, 0, 0, 2], fingerings: ['0', '2', '3', '0', '0', '4'] },
  { name: 'Fmaj7', shape: [null, 3, 2, 1, 0, 0], fingerings: ['x', '3', '2', '1', '0', '0'] },
  { name: 'Bm', shape: [null, 2, 4, 4, 3, 2], fingerings: ['x', '1', '3', '4', '2', '1'] },
  { name: 'Csus2', shape: [null, 3, 5, 5, 6, 3], fingerings: ['x', '1', '2', '3', '4', '1'] },
  { name: 'Dsus4', shape: [null, null, 0, 2, 3, 3], fingerings: ['x', 'x', '0', '1', '2', '3'] },
];

// ---------- note-name suggestions for dots ----------

/**
 * Given the current dots, suggest a note name for each dot.
 * Uses the set of sounding notes to guess a key (sharp vs flat spelling).
 */
export function suggestNoteNames(
  dots: { string: number; fret: number }[],
  tuning: number[] = STANDARD_TUNING,
): Map<string, string> {
  // strings here: 0 = high e .. 5 = low E (dot model). Convert to tuning index.
  const midis = dots.map(d => tuning[5 - d.string] + d.fret);
  const pcSet = new Set(midis.map(m => ((m % 12) + 12) % 12));
  // heuristic: count sharp pcs (1,3,6,8,10) vs natural
  let sharps = 0;
  pcSet.forEach(pc => { if ([1, 3, 6, 8, 10].includes(pc)) sharps++; });
  const useFlats = sharps > pcSet.size / 2;
  const out = new Map<string, string>();
  dots.forEach((d, i) => {
    out.set(`${d.string}:${d.fret}`, midiToName(midis[i], useFlats));
  });
  return out;
}

/**
 * Pitch of a dot computed from the tuning and its REAL position on the string.
 * The sounding pitch depends on the ABSOLUTE fret (the physical offset into the
 * string from the nut), NOT on the relative slot index: with startFret = 5 a
 * dot in the first visible slot sits on fret 5 → five semitones above open.
 *   rel    = dot.fret − startFret   (slot shown on screen)
 *   absFret = rel + startFret       (real fret on the neck)
 * A dot in the floating open zone (rel < 0, i.e. absFret ≤ 0) sounds at the
 * open pitch. `tuning` is in DOT-model order (index 0 = high e .. 5 = low E).
 */
export function pitchAtRel(
  tuning: number[], string: number, rel: number, preferFlats = false, startFret = 1,
): string {
  const open = tuning[string] ?? tuning[0] ?? 64;
  const absFret = rel + startFret;      // real fret number on the neck
  const fret = Math.max(0, absFret);    // open dots (absFret ≤ 0) sound open
  return midiToName(open + fret, preferFlats);
}

/** Absolute-fret spelling (identical result — kept for clarity/older call sites). */
export function pitchAtFret(tuning: number[], string: number, absFret: number, preferFlats = false): string {
  return midiToName((tuning[string] ?? tuning[0] ?? 64) + Math.max(0, absFret), preferFlats);
}

// ---------- note-label modes: letter / interval / tonal / degree ----------
//
// Every sounding dot position can be displayed as:
//  • 'letter'   — the actual pitch name (A, Bb, F# …)
//  • 'interval' — semitone distance from the root (R, m2, M2, … M7)
//  • 'tonal'    — scale degrees of the chosen key; diatonic tones are plain
//                 numbers (1..7), chromatic tones are spelled as an altered
//                 degree (#4, b6, b7 …).  Flat-leaning keys spell with flats,
//                 sharp-leaning keys with sharps — and special cases like the
//                 raised leading tone of D minor appear as #1 rather than b2.
//  • 'degree'   — chromatic numbering where the ROOT is 1: R = 1, +1 semitone
//                 = 2 … the octave above the root = 8 … up to 12.
//
// The root defaults to the LOWEST sounding note of the shape (chord root);
// the key defaults to the root's own major scale but can be set explicitly.

export type NoteLabelMode = 'letter' | 'interval' | 'tonal' | 'degree';

/** Canonical short names for the 12 intervals above a root. */
export const INTERVAL_NAMES = ['R', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7'];

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export interface ScaleInfo {
  pcs: number[];      // 7 pitch classes
  degOfPc: Map<number, number>;
  tonicLetter: string;
  flatLean: boolean;
}

/** Build a major or natural-minor scale rooted at `rootPc`. */
export function buildScale(rootPc: number, minor: boolean): ScaleInfo {
  const steps = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const pcs = steps.map(s => (((rootPc + s) % 12) + 12) % 12);
  const degOfPc = new Map<number, number>();
  pcs.forEach((pc, i) => degOfPc.set(pc, i + 1));
  // spell the tonic: minor keys conventionally use flats when available
  const preferFlat = minor || [1, 3, 5, 8, 10].includes(rootPc);
  let tonicLetter = midiToName(rootPc, false).replace(/[#]/g, '');
  if (preferFlat) tonicLetter = midiToName(rootPc, true).replace(/b/g, '');
  return { pcs, degOfPc, tonicLetter, flatLean: preferFlat };
}

/** Pick the best enharmonic spelling of `pc` inside a scale context.
 *  Prefers letters that exist in the scale (diatonic letters) so altered
 *  tones read naturally (Eb in C major → b3, not D#), then accidental style. */
export function spellPitchClass(pc: number, scale: ScaleInfo): { letter: string; alter: number } {
  const options: { letter: string; alter: number }[] = [];
  for (const [L, base] of Object.entries(LETTER_PC)) {
    const d = ((((pc - base) % 12) + 12) % 12);
    if (d <= 1) options.push({ letter: L, alter: d });            // natural & sharp
    const df = ((((base - pc) % 12) + 12) % 12);
    if (df === 1) options.push({ letter: L, alter: -1 });         // flat
  }
  const diatonic = new Set(scale.pcs.map(p => {
    for (const [L, base] of Object.entries(LETTER_PC)) if (base === p) return L;
    return '';
  }).filter(Boolean));
  let best = options[0];
  let bestScore = -Infinity;
  for (const o of options) {
    let score = 0;
    if (o.alter === 0) score += 3;
    if (diatonic.has(o.letter)) score += 2;
    if (scale.flatLean && o.alter < 0) score += 1;
    if (!scale.flatLean && o.alter > 0) score += 1;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/** Tonal label of a pitch class within a key: '1'..'7' or '#4', 'b6', '#1' … */
export function tonalLabel(pc: number, scale: ScaleInfo): string {
  const norm = ((pc % 12) + 12) % 12;
  const exact = scale.degOfPc.get(norm);
  if (exact != null) return String(exact);
  // choose among the two neighbouring diatonic degrees by smallest alteration
  const cand: { txt: string; dist: number }[] = [];
  for (let d = 1; d <= 7; d++) {
    const scp = scale.pcs[d - 1];
    const up = (((norm - scp) % 12) + 12) % 12;     // raise the degree by `up`
    const dn = (((scp - norm) % 12) + 12) % 12;     // lower it by `dn`
    if (up === 1) cand.push({ txt: `#${d}`, dist: 1 });
    if (dn === 1) cand.push({ txt: `b${d}`, dist: 1 });
    if (up === 2) cand.push({ txt: `##${d}`, dist: 2 });
    if (dn === 2) cand.push({ txt: `bb${d}`, dist: 2 });
  }
  cand.sort((a, b) => a.dist - b.dist);
  return cand[0]?.txt ?? '?';
}

/** Parse "F maj", "f#", "Dm", "Bb min", "F# minor" → root pc + quality. */
export function parseKeyString(str: string): { rootPc: number; minor: boolean } | null {
  const s = str.trim().replace(/[♯♭]/g, c => (c === '♯' ? '#' : 'b'));
  const m = s.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  if (pc == null) return null;
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  pc = ((pc % 12) + 12) % 12;
  const rest = m[3].toLowerCase();
  const minor = /m(in(or)?)?/.test(rest) && !/maj/.test(rest);
  return { rootPc: pc, minor };
}

export interface SoundingFret { string: number; abs: number }

export interface LabelCtx {
  mode: NoteLabelMode;
  /** absolute frets that sound (open dots included) — used to derive the root */
  soundingAbs: SoundingFret[];
  tuning: number[];        // dot-model order (index 0 = high e .. 5 = low E)
  startFret: number;
  preferFlats: boolean;
  /** explicit overrides (from quick settings); derived from the shape when null */
  rootPc?: number | null;
  key?: string | null;
}

/** Compute the display label for one dot given the whole-shape context. */
export function computeDotLabel(string: number, absFret: number, ctx: LabelCtx): string {
  const open = ctx.tuning[string] ?? ctx.tuning[0] ?? 64;
  const midi = open + Math.max(0, absFret);
  if (ctx.mode === 'letter') return midiToName(midi, ctx.preferFlats);
  // --- determine the reference root ---
  let rootPc: number;
  if (ctx.rootPc != null) rootPc = ((ctx.rootPc % 12) + 12) % 12;
  else if (ctx.soundingAbs.length) {
    let loMidi = Infinity;
    for (const f of ctx.soundingAbs) {
      const m = (ctx.tuning[f.string] ?? 64) + Math.max(0, f.abs);
      if (m < loMidi) loMidi = m;
    }
    rootPc = ((loMidi % 12) + 12) % 12;
  } else rootPc = 0;
  const pc = ((midi % 12) + 12) % 12;
  if (ctx.mode === 'interval') return INTERVAL_NAMES[(((pc - rootPc) % 12) + 12) % 12];
  if (ctx.mode === 'degree') {
    const n = (((pc - rootPc) % 12) + 12) % 12;
    return n === 0 ? '1' : String(n + 1);   // root=1, chromatic, octave=8, max 12
  }
  // --- tonal: needs a key (default = root's major scale) ---
  let key = ctx.key ? parseKeyString(ctx.key) : null;
  if (!key) key = { rootPc, minor: false };
  const scale = buildScale(key.rootPc, key.minor);
  return tonalLabel(pc, scale);
}

/** Pitch-class of the lowest sounding note of a shape (its conventional root). */
export function shapeRootPc(
  dots: { string: number; fret: number }[], tuning: number[],
): number | null {
  let loMidi = Infinity;
  for (const d of dots) {
    const m = (tuning[d.string] ?? 64) + Math.max(0, d.fret);
    if (m < loMidi) loMidi = m;
  }
  return Number.isFinite(loMidi) ? ((loMidi % 12) + 12) % 12 : null;
}

/** All pitch classes present in a shape (for octave-mode duplicate checks). */
export function shapePitchClasses(
  dots: { string: number; fret: number }[], tuning: number[],
): Set<number> {
  const out = new Set<number>();
  for (const d of dots) out.add((((tuning[d.string] ?? 64) + Math.max(0, d.fret)) % 12 + 12) % 12);
  return out;
}

/** Enumerate every position on the visible board that sounds a note whose
 *  pitch class is in `pcs`, EXCLUDING positions already occupied by `existing`
 *  dots. This is what octave mode uses to auto-fill all octaves of a note —
 *  positions outside the visible fret range are never produced (clipping). */
export function enumerateOctavePositions(
  pcs: Set<number>,
  existing: { string: number; fret: number }[],
  s: Settings,
): { string: number; fret: number }[] {
  const out: { string: number; fret: number }[] = [];
  const taken = new Set(existing.map(d => `${d.string}:${d.fret}`));
  const lastFret = s.startFret + s.numFrets - 1;
  for (let str = 0; str < 6; str++) {
    const open = s.tuning[str] ?? 64;
    for (let f = s.startFret; f <= lastFret; f++) {   // clip: visible slots only
      if (taken.has(`${str}:${f}`)) continue;
      if (pcs.has(((open + f) % 12 + 12) % 12)) out.push({ string: str, fret: f });
    }
  }
  return out;
}

// ---------- chord-name analysis (library browser search / tags) ----------

const MAJOR_TRIAD = [0, 4, 7];
const MINOR_TRIAD = [0, 3, 7];

/** Root candidates whose triad (maj or min) is fully present in the pitch set. */
function triadRoots(pcs: Set<number>): number[] {
  const roots: number[] = [];
  for (let r = 0; r < 12; r++) {
    if (!pcs.has(r)) continue;
    if (MAJOR_TRIAD.every(i => pcs.has((r + i) % 12)) || MINOR_TRIAD.every(i => pcs.has((r + i) % 12))) roots.push(r);
  }
  return roots;
}

/**
 * Derive searchable tags from a chord name using music theory:
 *  • root note(s) — C, C#/Db, D … (shared enharmonic roots match each other)
 *  • quality      — major / minor / seventh / maj7 / sus / dim / aug
 *  • open position vs barre (first fret > 0 on every sounding string ⇒ barre-ish)
 * Falls back gracefully for exotic names (e.g. "Csus2" → root C + 'sus').
 */
export function analyzeChord(name: string, shape: (number | null)[]): string[] {
  const tags: string[] = [];
  const lower = name.toLowerCase();
  // --- root extraction: leading letter (+ optional accidental) ---
  const m = name.match(/^([A-G])([#b♯♭]?)/i);
  if (m) {
    const letter = m[1].toUpperCase();
    const acc = (m[2] ?? '').replace('♯', '#').replace('♭', 'b');
    const basePc: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    let pc = basePc[letter] ?? 0;
    if (acc === '#' || acc === '♯') pc += 1;
    if (acc === 'b' || acc === '♭') pc -= 1;
    pc = ((pc % 12) + 12) % 12;
    tags.push(`root:${pc}`, `note:${NOTE_NAMES[pc]}`, `note:${FLATS[pc]}`);
  }
  // --- quality suffixes ---
  if (/dim|°/.test(lower)) tags.push('dim');
  else if (/aug|\+#/.test(lower)) tags.push('aug');
  else if (/sus/.test(lower)) tags.push('sus');
  else if (/(?:^|[^a-z])m[a-z]*7|m7(?!aj)/.test(lower) && !/maj/i.test(lower)) tags.push('minor', 'seventh');
  else if (/maj7|Δ/.test(lower)) tags.push('major', 'seventh', 'maj7');
  else if (/7/.test(lower)) tags.push('dominant', 'seventh');
  else if (/min|m(?!aj)/.test(lower)) tags.push('minor');
  else if (/maj/.test(lower)) tags.push('major');
  else tags.push('major'); // bare letter name ⇒ major triad convention
  // --- position: open vs barre ---
  const sounded = shape.filter(v => v != null) as number[];
  if (sounded.length && sounded.every(f => f > 0)) tags.push('barre');
  else tags.push('open');
  // --- verify with actual pitch content when possible ---
  const pcs = new Set<number>();
  shape.forEach((v, i) => { if (v != null) pcs.add(((STANDARD_TUNING[i] + v) % 12 + 12) % 12); });
  if (pcs.size >= 3) {
    const roots = triadRoots(pcs);
    for (const r of roots) tags.push(`contains-root:${r}`);
  }
  return [...new Set(tags)];
}

/** Normalize free-text search into comparable tokens ("C#m7" → c#, m7, cm7 …). */
export function searchTokens(q: string): string[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const words = s.split(/\s+/).filter(Boolean);
  const out = new Set<string>(words);
  for (const w of words) {
    // split a word into root + quality: "am7" → a + m7, "f#maj7" → f# + maj7
    const m = w.match(/^([a-g][#b♯♭]?)(.*)$/);
    if (m) {
      const root = m[1].replace('♯', '#').replace('♭', 'b');
      out.add(root);                                   // "a" from "am7"
      if (root.endsWith('#')) out.add(root.slice(0, -1) + 'b');
      if (root.length === 1 && root !== 'c' && root !== 'f') {
        // natural-root enharmonics: D ↔ C#/Eb style spellings users type loosely
        const flatOf: Record<string, string> = { d: 'c#', e: 'd#', g: 'f#', a: 'g#', b: 'a#' };
        if (flatOf[root]) out.add(flatOf[root]);
      }
      if (m[2]) out.add(m[2]);                         // "m7" from "am7"
    }
  }
  return [...out];
}

/** Does a library chord match the query?  A chord matches when EVERY query
 *  WORD can be accounted for by some substring of the chord name or one of
 *  its tags — this lets "minor a", "a minor 7" and "am7" all find Am7. */
export function chordMatchesQuery(
  name: string, shape: (number | null)[], tags: string[], q: string,
): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = name.toLowerCase();
  const tagHay = tags.join(' ');                       // "root:9 note:A minor seventh open"
  const words = s.split(/\s+/).filter(Boolean);
  return words.every(w => wordMatched(w, hay, tagHay));
}

function wordMatched(w: string, hay: string, tagHay: string): boolean {
  // direct substring of the name ("am7" ⊂ "am7", "a" ⊂ "am7")
  if (hay.includes(w)) return true;
  // exact / prefixed tag match ("minor" ≡ tag "minor", "9" ≡ "root:9")
  const norm = w.replace('♯', '#').replace('♭', 'b');
  for (const tag of tagHay.split(' ')) {
    const core = tag.includes(':') ? tag.split(':')[1] : tag;
    if (tag === w || core === w || tag === `root:${norm}`) return true;
  }
  // word that splits into root+quality, both found somewhere ("maj7" → "maj" + "7")
  const m = w.match(/^([a-g][#b♯♭])(.*)$/);
  if (m && (hay.includes(m[1]) || tagHay.includes('note:' + m[1].toUpperCase())) && m[2] && (hay.includes(m[2]) || tagHay.includes(m[2]))) return true;
  // quality synonyms
  const SYN: Record<string, string[]> = {
    min: ['minor'], maj: ['major'], dim: ['diminished'], aug: ['augmented'], dom: ['dominant'],
  };
  for (const [pre, alts] of Object.entries(SYN)) {
    if (w.startsWith(pre)) {
      const rest = w.slice(pre.length);
      for (const alt of alts) {
        if (hay.includes(alt + rest) || tagHay.includes(alt)) {
          if (!rest || hay.includes(rest) || tagHay.includes(rest)) return true;
        }
      }
    }
  }
  return false;
}
