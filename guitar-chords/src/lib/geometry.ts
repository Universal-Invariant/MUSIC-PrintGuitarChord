// ---------- Geometry: fret positions, string layout, canvas sizing ----------

import type { Settings } from './types';

export const NUM_STRINGS = 6;

/**
 * Returns the x (or y) coordinates of the numFrets+1 fret lines,
 * starting after the nut band. Positions are in "board units" along the fret axis.
 * - equal: uniform spacing = fretLen each
 * - logarithmic: widths w_i interpolate linearly between firstFretSize and lastFretSize
 */
export function fretPositions(s: Settings): number[] {
  const pos: number[] = [0];
  if (s.spacing === 'equal') {
    const len = s.boardWidth / s.numFrets; // keep total width constant
    for (let i = 1; i <= s.numFrets; i++) pos.push(pos[i - 1] + len);
  } else {
    // widths shrink from firstFretSize to lastFretSize
    const n = s.numFrets;
    const w0 = Math.max(2, s.firstFretSize);
    const wN = Math.max(1, s.lastFretSize);
    // scale so total fits boardWidth? No — user-specified sizes define the board length.
    void n;
    for (let i = 0; i < s.numFrets; i++) {
      const t = s.numFrets === 1 ? 0 : i / (s.numFrets - 1);
      const w = w0 + (wN - w0) * t;
      pos.push(pos[i] + w);
    }
  }
  return pos;
}

/** Total length along the fret axis. */
export function fretLength(s: Settings): number {
  const p = fretPositions(s);
  return p[p.length - 1];
}

/** String line offsets across the board (from top edge), plus widths. Index 0 = high e (top). */
export function stringLayout(s: Settings): { offset: number; width: number }[] {
  const out: { offset: number; width: number }[] = [];
  const total = (NUM_STRINGS - 1) * s.stringGap;
  for (let i = 0; i < NUM_STRINGS; i++) {
    let w: number;
    if (s.stringWidthMode === 'uniform') w = s.minStringWidth;
    else w = s.minStringWidth + ((s.maxStringWidth - s.minStringWidth) * i) / (NUM_STRINGS - 1);
    out.push({ offset: i * (total / (NUM_STRINGS - 1)), width: w });
  }
  return out;
}

/** Center position (along fret axis) of a relative fret slot. rel=-1 means open/nut position. */
export function dotAlongFret(s: Settings, rel: number, positions: number[]): number {
  if (rel < 0) return -nutZoneDepth(s) * 0.55; // sits in front of the nut
  if (rel >= positions.length - 1) return positions[positions.length - 1] + s.baseDotSize * 0.7;
  return (positions[rel] + positions[rel + 1]) / 2;
}

export function nutZoneDepth(s: Settings): number {
  return s.showNut ? Math.max(s.nutWidth, s.nutMax) + 8 : 24;
}

/** Full canvas size for the drawing area (includes margins for fingerings/text). */
export function canvasSize(s: Settings): { w: number; h: number } {
  const flen = fretLength(s);
  const across = s.boardWidth;
  const margin = 70;
  const nut = nutZoneDepth(s);
  if (s.orientation === 'vertical') {
    return { w: across + margin * 2, h: flen + nut + margin * 2 };
  }
  return { w: flen + nut + margin * 2, h: across + margin * 2 };
}

/** Origin (top-left of board region) inside the canvas. */
export function boardOrigin(s: Settings): { ox: number; oy: number; fx: 'x' | 'y' } {
  const margin = 70;
  const nut = nutZoneDepth(s);
  if (s.orientation === 'vertical') {
    return { ox: margin, oy: margin + nut, fx: 'y' }; // fret axis = y
  }
  // horizontal: nut side depends on fingeringsLeft
  const nutLeft = s.fingeringsLeft;
  return { ox: margin + (nutLeft ? nut : 0), oy: margin, fx: 'x' };
}

/** Convert a point in canvas coords to (stringIndex, relFret) or null. */
export function hitTest(s: Settings, cx: number, cy: number): { string: number; rel: number } | null {
  const { ox, oy, fx } = boardOrigin(s);
  const positions = fretPositions(s);
  const strings = stringLayout(s);
  // along-fret coordinate and across-board coordinate
  let along: number, across: number;
  if (s.orientation === 'vertical') { along = cy - oy; across = cx - ox; }
  else { along = fx === 'x' ? cx - ox : cy - oy; across = cy - oy; }
  if (across < -strings[NUM_STRINGS - 1].offset || across > strings[NUM_STRINGS - 1].offset + 1) return null;
  // find nearest string
  let strIdx = 0, best = Infinity;
  for (let i = 0; i < NUM_STRINGS; i++) {
    const d = Math.abs(across - strings[i].offset);
    if (d < best) { best = d; strIdx = i; }
  }
  if (best > s.stringGap * 0.62) return null;
  // find fret slot
  let rel: number;
  if (along < 0) {
    if (along < -nutZoneDepth(s)) return null;
    rel = -1;
  } else {
    let slot = -1;
    for (let i = 0; i < positions.length - 1; i++) {
      if (along >= positions[i] && along <= positions[i + 1]) { slot = i; break; }
    }
    if (slot === -1) {
      if (along > positions[positions.length - 1] && along < positions[positions.length - 1] + s.baseDotSize) slot = positions.length - 1;
      else return null;
    }
    rel = slot;
  }
  return { string: strIdx, rel };
}

/** Pixel center of a (string, relFret) cell in canvas coords. */
export function cellCenter(s: Settings, string: number, rel: number): { x: number; y: number } {
  const { ox, oy } = boardOrigin(s);
  const positions = fretPositions(s);
  const strings = stringLayout(s);
  const along = dotAlongFret(s, rel, positions);
  const across = strings[string].offset;
  if (s.orientation === 'vertical') return { x: ox + across, y: oy + along };
  return { x: ox + along, y: oy + across };
}

export const INLAY_FRETS = [3, 5, 7, 9];
export const DOUBLE_INLAY_FRETS = [12, 24];
