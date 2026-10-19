// ---------- Geometry: fret positions, tapered board layout, canvas sizing ----------
//
// Coordinate model (equivariant w.r.t. orientation & flips):
//  • Every element is placed in a logical "nut-first" frame:
//      t = along-axis distance from the 0-fret/nut line (grows toward higher frets)
//      a = across-axis offset from the board center line (string index order fixed)
//  • The single mapping project(s, t, a) converts that frame to canvas pixels and applies:
//      - orientation (vertical / horizontal),
//      - flipAlong (nut at near end vs far end — mirrors the whole fret axis),
//      - flipAcross (mirror the string order across the center line).
//  • All drawing AND all hit-testing go through project()/unproject(), so dots, nut,
//    taper, logarithmic spacing and fingerings stay consistent under any combination
//    of settings. Flipping never changes relative dot positions or the scale.
//  • The content bounding box (fretboard + nut zone + fingering band + side labels)
//    is always CENTERED inside the canvas with equal margins on every side, for both
//    orientations and both flip states — nothing gets clipped.
//  • Logarithmic spacing follows real guitar geometry: slot widths SHRINK geometrically
//    toward higher frets (firstFretSize ≥ lastFretSize).
//  • A single `boardTaper` factor (0..1) controls the trapezoidal sides: the nut end
//    is narrower; it depends only on ABSOLUTE fret positions so moving the starting
//    fret keeps the feel consistent across chords.

import type { Settings } from './types';

export const NUM_STRINGS = 6;
export const MARGIN = 70;
const TAPER_PAD = 30;      // extra length beyond the last fret (where sides converge a bit more)
export const FING_BAND = 46;   // reserved band for fingering labels (opposite the nut)
const OUT_LABEL_PAD = 26;  // room beside the board for fret numbers / string labels

/** true ⇒ nut drawn at the FAR end (bottom / right); fret numbers run backwards. */
export function flippedAlong(s: Settings): boolean { return s.flipAlong; }

/** Board width across strings (string span + small padding). */
export function boardAcross(s: Settings): number {
  return (NUM_STRINGS - 1) * s.stringGap + Math.max(14, s.stringGap * 0.5);
}

/**
 * Returns the coordinates of the numFrets+1 fret lines along the fret axis,
 * always ordered nut-side first (index 0 = the 0-fret/nut line, growing toward
 * higher frets). Canvas mirroring is applied later by project(), never here.
 *  - equal: uniform spacing = fretSpacing (canvas grows with it)
 *  - logarithmic: real-guitar law — slot widths shrink geometrically toward
 *    higher frets; firstFretSize / lastFretSize set the slot sizes at the
 *    low / high ends of the displayed range.
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
    // geometric progression ratio r such that w0 · r^(n-1) = wN  (r < 1 ⇒ shrinking)
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

/** String line offsets across the board relative to the CENTER line (−span/2 … +span/2).
 *  Index 0 = high e. flipAcross mirrors the whole string fan; gauges travel WITH each
 *  string, so flipping never reorders bass/treble relative to their dots. */
export function stringLayout(s: Settings): { offset: number; width: number }[] {
  const out: { offset: number; width: number }[] = [];
  const span = (NUM_STRINGS - 1) * s.stringGap;
  const sign = s.flipAcross ? -1 : 1;
  for (let i = 0; i < NUM_STRINGS; i++) {
    let w: number;
    if (s.stringWidthMode === 'uniform') w = s.minStringWidth;
    else w = s.minStringWidth + ((s.maxStringWidth - s.minStringWidth) * i) / (NUM_STRINGS - 1);
    out.push({ offset: sign * (i * s.stringGap - span / 2), width: w });
  }
  return out;
}

/** Nut zone depth reserved before the 0-fret line (for open-note O/X marks & string labels). */
export function nutZoneDepth(s: Settings): number {
  return s.showNut ? Math.max(30, s.nutWidth + 24) : 26;
}

/**
 * Content extents of the full drawing (along-axis length and across-axis width),
 * including nut zone, fingering band and side-label padding — but not the outer
 * margin. Identical formula for both orientations (axes just swap).
 */
export function contentSize(s: Settings): { along: number; across: number } {
  const flen = fretLength(s);
  const nut = nutZoneDepth(s);
  const pad = OUT_LABEL_PAD;
  return {
    along: nut + flen + FING_BAND,
    across: boardAcross(s) + pad * 2,
  };
}

/** Full canvas size for the drawing area. Content is centered within it. */
export function canvasSize(s: Settings): { w: number; h: number } {
  const c = contentSize(s);
  if (s.orientation === 'vertical') {
    return { w: c.across + MARGIN * 2, h: c.along + MARGIN * 2 };
  }
  return { w: c.along + MARGIN * 2, h: c.across + MARGIN * 2 };
}

/**
 * Origin used by project(): the CANVAS position of the point (t=0, a=0) — the
 * center of the 0-fret/nut line — as if the nut sat at the NEAR end.
 * project() then shifts to the far edge when flipAlong is set; because the
 * content bbox spans exactly [-nutZone, flen+FING_BAND] × [-across/2, +across/2]
 * around this frame, it is perfectly centered between the margins for every
 * orientation/flip combination.
 */
export function boardOrigin(s: Settings): { ox: number; oy: number } {
  const { w, h } = canvasSize(s);
  if (s.orientation === 'vertical') {
    return { ox: w / 2, oy: MARGIN + nutZoneDepth(s) };
  }
  return { ox: MARGIN + nutZoneDepth(s), oy: h / 2 };
}

/** THE coordinate mapping. t = nut-first along distance, a = across offset.
 *  Applies orientation + flipAlong + flipAcross uniformly to everything.
 *  When flipped, the frame is mirrored about the CONTENT center (not the raw
 *  canvas center), so every element — nut, dots, taper, labels — keeps its
 *  relative position and the whole drawing stays centered in the canvas. */
export function project(s: Settings, t: number, a: number): { x: number; y: number } {
  const o = boardOrigin(s);
  const c = contentSize(s);
  const tc = (c.along - nutZoneDepth(s) * 2) / 2; // logical coord of content center along the fret axis
  const fa = flippedAlong(s) ? -1 : 1;
  const fc = s.flipAcross ? -1 : 1;
  if (s.orientation === 'vertical') {
    return { x: o.ox + fc * a, y: o.oy + fa * (t - tc) + tc };
  }
  return { x: o.ox + fa * (t - tc) + tc, y: o.oy + fc * a };
}

/** Inverse of project(): canvas coords → (t, a) in the nut-first logical frame. */
export function unproject(s: Settings, cx: number, cy: number): { t: number; a: number } {
  const o = boardOrigin(s);
  const c = contentSize(s);
  const tc = (c.along - nutZoneDepth(s) * 2) / 2;
  const fa = flippedAlong(s) ? -1 : 1;
  const fc = s.flipAcross ? -1 : 1;
  if (s.orientation === 'vertical') {
    return { t: fa * (cy - o.oy - tc) + tc, a: fc * (cx - o.ox) };
  }
  return { t: fa * (cx - o.ox - tc) + tc, a: fc * (cy - o.oy) };
}

/** Along-axis logical coordinate of a canvas point (distance from nut line toward higher frets). */
export function alongCoord(s: Settings, cx: number, cy: number): number {
  return unproject(s, cx, cy).t;
}

/** Across-axis logical coordinate of a canvas point, relative to the board center line. */
export function acrossCoord(s: Settings, cx: number, cy: number): number {
  return unproject(s, cx, cy).a;
}

/** Center-line coordinate across the board (canvas space) — constant regardless of taper/flips. */
export function centerAcross(s: Settings): number {
  return boardOrigin(s).ox; // vertical orientation: x of the center line (horizontal: use .oy)
}

/** Convert a point in canvas coords to (stringIndex, relFret) or null. Works under all flips. */
export function hitTest(s: Settings, cx: number, cy: number): { string: number; rel: number } | null {
  const positions = fretPositions(s);
  const strings = stringLayout(s);
  const { t: along, a: across } = unproject(s, cx, cy);
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

/**
 * Center position along the fret axis of a relative fret slot, in the LOGICAL
 * nut-first frame (rel=-1 means open/nut zone). Pass through project() for canvas coords.
 */
export function dotAlongFret(s: Settings, rel: number, positions: number[]): number {
  if (rel < 0) return -nutZoneDepth(s) * 0.45;
  if (rel >= positions.length - 1) return positions[positions.length - 1] + s.baseDotSize * 0.7;
  return (positions[rel] + positions[rel + 1]) / 2;
}

/** Pixel center of a (string, relFret) cell in canvas coords (all flips applied via project). */
export function cellCenter(s: Settings, string: number, rel: number): { x: number; y: number } {
  const positions = fretPositions(s);
  const strings = stringLayout(s);
  const along = dotAlongFret(s, rel, positions);
  return project(s, along, strings[string].offset);
}

/** Canvas position of a fingering label for one string (band opposite the nut, mirrored with the board). */
export function fingeringPos(s: Settings, string: number): { x: number; y: number; anchor: 'start' | 'end' | 'middle' } {
  const strings = stringLayout(s);
  const t = fretLength(s) + 24; // inside the reserved FING_BAND past the last fret
  const p = project(s, t, strings[string].offset);
  const vertical = s.orientation === 'vertical';
  return { x: p.x, y: p.y, anchor: vertical ? 'middle' : (flippedAlong(s) ? 'end' : 'start') };
}

/** Where the string-name labels (e B G D A E) sit in the nut zone (logical frame). */
export function stringLabelAlong(s: Settings): number {
  return -nutZoneDepth(s) * 0.8;
}

export const INLAY_FRETS = [3, 5, 7, 9];
export const DOUBLE_INLAY_FRETS = [12, 24];
