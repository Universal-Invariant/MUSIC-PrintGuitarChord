// ---------- Music theory helpers ----------

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Open-string MIDI numbers for standard tuning (index 0 = low E .. 5 = high e). */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

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
