// ---------- Music theory helpers ----------

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
