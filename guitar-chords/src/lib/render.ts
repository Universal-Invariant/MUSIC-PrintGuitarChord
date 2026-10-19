// ---------- SVG renderer: pure functions producing SVG markup ----------
// Used both for on-screen rendering (dangerouslySetInnerHTML) and for export.

import type { ChordColor, ChordDoc, Dot, Settings } from './types';
import { col, uid } from './types';
import {
  boardAcross, boardOrigin, canvasSize, cellCenter, centerAcross, fingeringPos,
  fretLength, fretPositions, halfWidthAlong, nutFirst, nutZoneDepth, stringLayout,
  DOUBLE_INLAY_FRETS, INLAY_FRETS, NUM_STRINGS,
} from './geometry';
import { shapeInner } from './shapes';

// re-export geometry helpers for consumers
export {
  boardOrigin, canvasSize, cellCenter, fretPositions, stringLayout,
  fingeringPos, fretLength, nutZoneDepth, hitTest, alongCoord, dotAlongFret,
} from './geometry';

export const FONT_OPTIONS = [
  'Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Trebuchet MS',
  'Impact', 'Comic Sans MS', 'Palatino Linotype', 'Garamond', 'Tahoma',
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** All selectable shapes = standard + custom. */
export function allShapeNames(s: Settings): string[] {
  return [...s.standardShapes, ...s.customShapes];
}
/** Cycle list used by ctrl-click (names mapped to indices in allShapeNames). */
export function cycleShapeIndices(s: Settings): number[] {
  const all = allShapeNames(s);
  return s.defaultShapes.map(n => Math.max(0, all.indexOf(n)));
}
/** Cycle list for shift-click: colorIdx values into the basket. */
export function cycleColorIndices(s: Settings): number[] {
  return s.defaultColors.map(c => {
    const i = s.colors.findIndex(x => x.hex === c.hex && Math.abs(x.alpha - c.alpha) < 0.01);
    return i >= 0 ? i : 0;
  });
}
export function activeShapes(s: Settings): string[] {
  return allShapeNames(s);
}

const STRING_LABELS = ['e', 'B', 'G', 'D', 'A', 'E']; // index 0 = high e (top)
export function stringLabel(i: number): string { return STRING_LABELS[i] ?? ''; }

// ---------------- main render ----------------

export interface RenderOpts { scale?: number }

export function renderSvg(doc: ChordDoc, settings: Settings, opts: RenderOpts & { customs?: Record<string,string> } = {}): string {
  const s = settings;
  const customMap = opts.customs ?? {};
  const { w, h } = canvasSize(s);
  const sc = opts.scale ?? 1;
  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * sc)}" height="${Math.round(h * sc)}" viewBox="0 0 ${w} ${h}" data-w="${w}" data-h="${h}">`);
  parts.push('<style>text{user-select:none}</style>');
  // background
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${col(s.bgFill)}"/>`);

  const vertical = s.orientation === 'vertical';
  const nf = nutFirst(s);                 // true ⇒ nut at top/left
  const cx = centerAcross(s);             // board center line (canvas coord, across axis)
  const origin = boardOrigin(s);          // position of the 0-fret line in canvas coords
  const positions = fretPositions(s);     // ordered nut-side first
  const flen = fretLength(s);
  const pad = boardAcross(s) * 0.06;      // board extends slightly past outer strings

  // Map a "nut-first" along coordinate t (0 at nut line, grows toward higher frets)
  // and an across-board offset a (relative to the center line) to canvas coords.
  // The 0-fret line always maps to `origin`; with the nut on the other side the
  // whole layout is mirrored (higher frets run toward the top/left).
  const P = (t: number, a: number): { x: number; y: number } => {
    const along = nf ? t : -t;
    if (vertical) return { x: cx + a, y: origin.oy + along };
    return { x: origin.ox + along, y: origin.oy + a };
  };

  // ----- fretboard panel (tapered trapezoid) -----
  parts.push(renderBoardPanel(s, flen, pad, P));

  // ----- fret lines (including the 0-fret line which the nut sits on) -----
  for (let i = 0; i <= s.numFrets; i++) {
    const t = positions[i];
    const hw = halfWidthAlong(s, t) + pad * 0.4;
    const p1 = P(t, -hw), p2 = P(t, hw);
    const sw = i === 0 ? 2.2 : 2;
    parts.push(`<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${col(s.fretColor)}" stroke-width="${sw}" stroke-linecap="round"/>`);
  }

  // ----- nut: thick bar CENTERED on the 0-fret line, spanning the board width there -----
  if (s.showNut) parts.push(renderNut(s, P, positions[0], halfWidthAlong(s, positions[0])));

  // ----- strings (extend from the nut zone through the last fret) -----
  const sl = stringLayout(s);
  for (let i = 0; i < NUM_STRINGS; i++) {
    const off = sl[i].offset;
    const start = -nutZoneDepth(s) * (s.showNut ? 0.75 : 0.4);
    const end = flen + s.baseDotSize * 0.9;
    const p1 = P(start, off), p2 = P(end, off);
    parts.push(`<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${col(s.stringColor)}" stroke-width="${sl[i].width.toFixed(2)}"/>`);
  }

  // ----- inlay dots (center of the board, per real fretboards) -----
  if (s.showDots) parts.push(renderInlays(s, P, positions));

  // ----- fret numbers (on the side away from… kept right/bottom as before) -----
  for (let i = 0; i < s.numFrets; i++) {
    const abs = s.startFret + i;
    const t = (positions[i] + positions[i + 1]) / 2;
    const hw = halfWidthAlong(s, t) + pad;
    const p = P(t, hw + 18);
    const anchor = vertical ? 'start' : 'middle';
    const baseline = vertical ? 'middle' : 'hanging';
    parts.push(`<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-family="${esc(s.defaultTextFont)}" font-size="13" fill="${col(withA(s.fretColor, 0.85))}" text-anchor="${anchor}" dominant-baseline="${baseline}">${abs}</text>`);
  }

  // ----- string labels near the nut (e B G D A E) -----
  {
    const tl = nutZoneDepth(s) * (s.showNut ? 0.45 : 0.4);
    for (let i = 0; i < NUM_STRINGS; i++) {
      const p = P(-tl, sl[i].offset);
      parts.push(`<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-family="${esc(s.defaultTextFont)}" font-size="11" fill="${col(withA(s.fretColor, 0.7))}" text-anchor="middle" dominant-baseline="central">${STRING_LABELS[i]}</text>`);
    }
  }

  // ----- fingerings: at the END of the fretboard OPPOSITE the nut -----
  parts.push(renderFingerings(doc, s));

  // ----- note dots -----
  for (const d of doc.dots) parts.push(renderDot(d, s, customMap));

  // ----- free text boxes -----
  for (const t of doc.texts) {
    const x = t.x * w, y = t.y * h;
    parts.push(`<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${t.rotation})">`);
    parts.push(`<text font-family="${esc(t.font)}" font-size="${t.size}" fill="${col(t.color)}" text-anchor="${t.anchor}" dominant-baseline="middle">${esc(t.text)}</text>`);
    parts.push('</g>');
  }

  parts.push('</svg>');
  return parts.join('\n');
}

function withA(c: ChordColor, a: number): ChordColor { return { hex: c.hex, alpha: c.alpha * a }; }

/** The wooden fretboard panel: an isosceles trapezoid whose side edges follow the taper. */
function renderBoardPanel(
  s: Settings, flen: number, pad: number,
  P: (t: number, a: number) => { x: number; y: number },
): string {
  const steps = 24;
  const leftPts: string[] = [];
  const rightPts: string[] = [];
  const tStart = -(s.showNut ? nutZoneDepth(s) * 0.25 : 4);
  const tEnd = flen + s.baseDotSize * 0.9;
  for (let i = 0; i <= steps; i++) {
    const t = tStart + ((tEnd - tStart) * i) / steps;
    const hw = halfWidthAlong(s, Math.max(0, t)) + pad;
    const pl = P(t, -hw), pr = P(t, hw);
    leftPts.push(`${pl.x.toFixed(1)},${pl.y.toFixed(1)}`);
    rightPts.push(`${pr.x.toFixed(1)},${pr.y.toFixed(1)}`);
  }
  const pts = [...leftPts, ...rightPts.reverse()].join(' ');
  return `<polygon points="${pts}" fill="${col(withA(s.fretColor, 0.08))}" stroke="${col(withA(s.fretColor, 0.25))}" stroke-width="1"/>`;
}

function renderNut(s: Settings, P: (t: number, a: number) => { x: number; y: number }, t0: number, hw: number): string {
  // Bar centered on the 0-fret line, thickness = nutWidth along the fret axis,
  // spanning the full board width at that position (trapezoid ends follow the taper).
  const th = Math.max(2, s.nutWidth);
  const a = P(t0 - th / 2, -hw), b = P(t0 - th / 2, hw), c = P(t0 + th / 2, hw), d = P(t0 + th / 2, -hw);
  const pts = `${a.x.toFixed(1)},${a.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)} ${d.x.toFixed(1)},${d.y.toFixed(1)}`;
  return `<polygon points="${pts}" fill="#f2ead8" stroke="#c9bfa4" stroke-width="1"/>`;
}

function renderInlays(s: Settings, P: (t: number, a: number) => { x: number; y: number }, positions: number[]): string {
  const out: string[] = [];
  const r = Math.min(7, s.stringGap * 0.16 + 3);
  for (let i = 0; i < s.numFrets; i++) {
    const abs = s.startFret + i;
    const isDouble = DOUBLE_INLAY_FRETS.includes(abs);
    const isSingle = INLAY_FRETS.includes(abs);
    if (!isDouble && !isSingle) continue;
    const t = (positions[i] + positions[i + 1]) / 2;
    if (isSingle) {
      const p = P(t, 0);
      out.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${col(s.dotMarkerColor)}"/>`);
    } else {
      const off = r * 2.4;
      const p1 = P(t, -off), p2 = P(t, off);
      out.push(`<circle cx="${p1.x.toFixed(1)}" cy="${p1.y.toFixed(1)}" r="${r}" fill="${col(s.dotMarkerColor)}"/>`);
      out.push(`<circle cx="${p2.x.toFixed(1)}" cy="${p2.y.toFixed(1)}" r="${r}" fill="${col(s.dotMarkerColor)}"/>`);
    }
  }
  return out.join('');
}

function renderFingerings(doc: ChordDoc, s: Settings): string {
  const out: string[] = [];
  for (const f of doc.fingerings) {
    const p = fingeringPos(s, f.string);
    out.push(`<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-family="${esc(f.font)}" font-size="${f.size}" fill="${col(f.color)}" text-anchor="${p.anchor}" dominant-baseline="middle">${esc(f.text)}</text>`);
  }
  return out.join('');
}

export function renderDot(d: Dot, s: Settings, customs: Record<string,string> = {}): string {
  const c = cellCenter(s, d.string, relOf(s, d.fret));
  const size = s.baseDotSize * (d.textSize != null ? Math.max(0.3, d.textSize) : 1);
  const colorIdx = ((d.colorIdx % s.colors.length) + s.colors.length) % s.colors.length;
  const base = s.colors[colorIdx] ?? s.shapeDefaultColor;
  const alpha = d.transparency != null ? Math.max(0.05, Math.min(1, d.transparency)) : base.alpha;
  const fillColor: ChordColor = { hex: base.hex, alpha };
  const shapeName = activeShapes(s)[((d.shapeIdx % activeShapes(s).length) + activeShapes(s).length) % activeShapes(s).length] ?? 'circle';
  const glyphScale = (size * s.shapeScale) / 100;
  const rot = d.rotation || 0;

  const out: string[] = [];
  out.push(`<g transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${rot})">`);
  out.push(`<g transform="scale(${glyphScale.toFixed(4)}) translate(-50,-50)" style="color:${col(fillColor)}">`);
  out.push(shapeInner(shapeName, customs));
  out.push('</g>');
  if (d.text) {
    const tc = d.textColor ?? { hex: '#ffffff', alpha: 1 };
    const fs = size * 0.55;
    out.push(`<text font-family="${esc(d.font ?? s.defaultTextFont)}" font-size="${fs.toFixed(1)}" fill="${col(tc)}" text-anchor="middle" dominant-baseline="central" font-weight="bold">${esc(d.text)}</text>`);
  }
  out.push('</g>');
  return out.join('');
}

function relOf(s: Settings, absFret: number): number {
  return absFret - s.startFret;
}

// ---------------- interaction helpers shared with App ----------------

export function makeDot(s: Settings, string: number, rel: number): Dot {
  return {
    id: uid('dot'),
    string,
    fret: rel + s.startFret,
    colorIdx: 0,
    shapeIdx: 0,
    text: '',
    font: null,
    textColor: null,
    textSize: null,
    transparency: null,
    rotation: s.defaultTextRotation,
  };
}
