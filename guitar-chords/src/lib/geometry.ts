// ---------- Geometry: fret positions, tapered board layout, canvas sizing ----------
//
// Model (fixes previous issues):
//  • The nut is drawn CENTERED on the 0-fret line (aligned with the board), not offset.
//  • Canvas size GROWS when spacing/stringGap grow — it never shrinks the other way.
//  • "Nut side" (mirror) affects every mirrored element: nut, string gauges and
//    fingerings, so switching sides visibly mirrors the layout.
//  • Fingerings are drawn at the END of the fretboard OPPOSITE the nut.
//  • A single `boardTaper` factor (0..1) controls the trapezoidal fretboard sides:
//    taper = 0 ⇒ the 0-fret end has the same width as the hypothetical 12th-fret
//    position; larger values narrow the nut end. It depends only on absolute fret
//    positions (not startFret-relative scaling), so moving the starting fret keeps
//    the feel consistent across chords.

import type { Settings } from './types';

export const NUM_STRINGS = 6;
export const MARGIN = 70;
const SCALE_REF = 12;      // reference fret for the taper formula
const TAPER_PAD = 30;      // extra length beyond the last fret (where sides converge a bit more)

void SCALE_REF;

/** true ⇒ nut on top/left; false ⇒ nut on bottom/right (mirrored layout). */
export function nutFirst(s: Settings): boolean { return s.fingeringsLeft; }

/** Board width across strings (string span + small padding). */
export function boardAcross(s: Settings): number {
  return (NUM_STRINGS - 1) * s.stringGap + Math.max(14, s.stringGap * 0.5);
}

/**
 * Returns the coordinates of the numFrets+1 fret lines along the fret axis,
 * always ordered nut-side first (index 0 = the 0-fret/nut line).
 *  - equal: uniform spacing = fretSpacing (canvas grows with it)
 *  - logarithmic: real-guitar law — slot widths shrink geometrically toward higher
 *    frets; firstFretSize / lastFretSize set the slot sizes at the displayed ends.
 */
export function fretPositions(s: Settings): number[] {
  const pos: number[] = [0];
  if (s.spacing === 'equal') {
    const len = Math.max(8, s.fretSpacing);
    for (let i = 1; i <= s.numFrets; i++) pos.push(pos[i - 1] + len);
  } else {
    const n = Math.max(1, s.numFrets);
    const w0 = Math.max(4, s.firstFretSize);
    const wN = Math.max(2, s.lastFretSize);
    // geometric progression ratio r such that w0 · r^(n-1) = wN
    const r = n === 1 ? 1 : Math.pow(wN / w0, 1 / (n - 1));
    let w = w0;
    for (let i = 0; i < n; i++) {
      pos.push(pos[i] + w);
      w *= r;
    }
  }
  return pos;
}

/** Total length along the fret axis (between the 0-fret line and the last fret line). */
export function fretLength(s: Settings): number {
  const p = fretPositions(s);
  return p[p.length - 1];
}

/**
 * Half-width of the fretboard at an ABSOLUTE fret position.
 * taper 0 ⇒ constant width W12 everywhere up to fret 12 (and beyond).
 * With taper t, the width at fret f is  W(f) = W12 · (1 − t·(1 − 2^(-f/12))).
 */
export function halfWidthAtFret(s: Settings, absFret: number): number {
  const hwMax = boardAcross(s) / 2;
  const hw12 = hwMax / (1 + s.boardTaper * (Math.SQRT2 - 1));
  const factor = 1 - s.boardTaper * (1 - Math.pow(2, -absFret / 12));
  return hw12 * factor;
}

/** Half-width at a point along the fret axis (t is 0 at the nut line, grows toward high frets). */
export function halfWidthAlong(s: Settings, t: number): number {
  const flen = fretLength(s);
  const L = flen + TAPER_PAD;
  const tc = Math.max(0, Math.min(L, t));
  const fStart = Math.max(0, s.startFret);
  const fEnd = fStart + s.numFrets + (TAPER_PAD / Math.max(1, flen)) * s.numFrets;
  const hw0 = halfWidthAtFret(s, fStart);
  const hwE = halfWidthAtFret(s, fEnd);
  return hw0 + (hwE - hw0) * (tc / L);
}

/** Center-line coordinate across the board (canvas space) — constant regardless of taper. */
export function centerAcross(s: Settings): number {
  return MARGIN + boardAcross(s) / 2;
}

/** String line offsets across the board relative to the CENTER line (−span/2 … +span/2).
 *  Index 0 = high e. Mirrored by nut side so the bass strings sit on the thick side. */
export function stringLayout(s: Settings): { offset: number; width: number }[] {
  const out: { offset: number; width: number }[] = [];
  const span = (NUM_STRINGS - 1) * s.stringGap;
  const sign = nutFirst(s) ? 1 : -1;
  for (let i = 0; i < NUM_STRINGS; i++) {
    let w: number;
    if (s.stringWidthMode === 'uniform') w = s.minStringWidth;
    else w = s.minStringWidth + ((s.maxStringWidth - s.minStringWidth) * i) / (NUM_STRINGS - 1);
    out.push({ offset: sign * (i * s.stringGap - span / 2), width: w });
  }
  return out;
}

/** Nut zone depth reserved before the 0-fret line (for open-note X/O marks & labels). */
export function nutZoneDepth(s: Settings): number {
  return s.showNut ? Math.max(30, s.nutWidth + 24) : 26;
}

/** Full canvas size for the drawing area (includes margins for fingerings/text). */
export function canvasSize(s: Settings): { w: number; h: number } {
  const flen = fretLength(s);
  const across = boardAcross(s);
  const nut = nutZoneDepth(s);
  const fing = 46; // extra room on the far (fingerings) side
  if (s.orientation === 'vertical') {
    const top = nutFirst(s) ? nut : fing;
    const bottom = nutFirst(s) ? fing : nut;
    return { w: across + MARGIN * 2, h: flen + top + bottom + MARGIN * 2 };
  }
  const left = nutFirst(s) ? nut : fing;
  const right = nutFirst(s) ? fing : nut;
  return { w: flen + left + right + MARGIN * 2, h: across + MARGIN * 2 };
}

/** Origin (position of the 0-fret line) inside the canvas. */
export function boardOrigin(s: Settings): { ox: number; oy: number } {
  const nut = nutZoneDepth(s);
  if (s.orientation === 'vertical') {
    // fret axis = y; nut-first ⇒ 0-fret near the top
    return { ox: MARGIN, oy: nutFirst(s) ? MARGIN + nut : MARGIN };
  }
  // fret axis = x
  return { ox: nutFirst(s) ? MARGIN + nut : MARGIN, oy: MARGIN };
}

/** Along-axis canvas coordinate of a point, measured from the 0-fret line toward higher frets. */
export function alongCoord(s: Settings, cx: number, cy: number): number {
  const { ox, oy } = boardOrigin(s);
  return s.orientation === 'vertical' ? cy - oy : cx - ox;
}

/** Across-axis canvas coordinate relative to the board center line. */
export function acrossCoord(s: Settings, cx: number, cy: number): number {
  const { ox, oy } = boardOrigin(s);
  return s.orientation === 'vertical' ? cx - (ox + boardAcross(s) / 2) : cy - (oy + boardAcross(s) / 2);
}

/** Convert a point in canvas coords to (stringIndex, relFret) or null. */
export function hitTest(s: Settings, cx: number, cy: number): { string: number; rel: number } | null {
  const positions = fretPositions(s);
  const strings = stringLayout(s);
  const along = alongCoord(s, cx, cy);
  const across = acrossCoord(s, cx, cy);
  const half = boardAcross(s) / 2;
  if (across < -half || across > half) return null;
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
    rel = -1; // open position (in front of the nut)
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

/** Center position along the fret axis of a relative fret slot. rel=-1 means open/nut zone. */
export function dotAlongFret(s: Settings, rel: number, positions: number[]): number {
  if (rel < 0) return -nutZoneDepth(s) * 0.45;
  if (rel >= positions.length - 1) return positions[positions.length - 1] + s.baseDotSize * 0.7;
  return (positions[rel] + positions[rel + 1]) / 2;
}

/** Pixel center of a (string, relFret) cell in canvas coords. */
export function cellCenter(s: Settings, string: number, rel: number): { x: number; y: number } {
  const { ox, oy } = boardOrigin(s);
  const positions = fretPositions(s);
  const strings = stringLayout(s);
  const along = dotAlongFret(s, rel, positions);
  const mid = boardAcross(s) / 2;
  const across = mid + strings[string].offset;
  if (s.orientation === 'vertical') return { x: ox + across, y: oy + along };
  return { x: ox + along, y: oy + across };
}

/** Canvas position of a fingering label for one string (far end of the board, opposite the nut). */
export function fingeringPos(s: Settings, string: number): { x: number; y: number; anchor: 'start' | 'end' | 'middle' } {
  const { ox, oy } = boardOrigin(s);
  const strings = stringLayout(s);
  const mid = boardAcross(s) / 2;
  const across = mid + strings[string].offset;
  const nf = nutFirst(s);
  if (s.orientation === 'vertical') {
    // fingerings at the bottom (nut-top) or top (nut-bottom)
    const y = nf ? oy + fretLength(s) + 34 : oy - 30;
    return { x: ox + across, y, anchor: 'middle' };
  }
  const x = nf ? ox + fretLength(s) + 26 : ox - 26;
  return { x, y: oy + across, anchor: nf ? 'start' : 'end' };
}

export const INLAY_FRETS = [3, 5, 7, 9];
export const DOUBLE_INLAY_FRETS = [12, 24];
