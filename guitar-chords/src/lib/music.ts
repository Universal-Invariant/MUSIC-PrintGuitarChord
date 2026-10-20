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
