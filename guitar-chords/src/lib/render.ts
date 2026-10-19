// ---------- SVG renderer: pure functions producing SVG markup ----------
// Used both for on-screen rendering (dangerouslySetInnerHTML) and for export.

import type { ChordColor, ChordDoc, Dot, Settings } from './types';
import { col, uid } from './types';
import {
  DOUBLE_INLAY_FRETS, fretLength, INLAY_FRETS, nutZoneDepth, NUM_STRINGS,
} from './geometry';
import * as G from './geometry';
import { shapeInner, STANDARD_SHAPES } from './shapes';

// re-export geometry helpers for consumers
export const boardOrigin = G.boardOrigin;
export const canvasSize = G.canvasSize;
export const cellCenter = G.cellCenter;
export const fretPositions = G.fretPositions;
export const stringLayout = G.stringLayout;
export const hitTest = G.hitTest;

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

  const { ox, oy } = boardOrigin(s);
  const positions = fretPositions(s);
  const flen = fretLength(s);
  const across = (NUM_STRINGS - 1) * s.stringGap;
  const vertical = s.orientation === 'vertical';

  // ----- board background panel -----
  const bx = vertical ? ox - 14 : ox - nutZoneDepth(s) * 0.15;
  const by = vertical ? oy - nutZoneDepth(s) * 0.15 : oy - 14;
  const bw = vertical ? across + 28 : flen + nutZoneDepth(s) * 0.15 + 6;
  const bh = vertical ? flen + nutZoneDepth(s) * 0.15 + 6 : across + 28;
  parts.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="6" fill="${col(withA(s.fretColor, 0.06))}"/>`);

  // ----- fret lines -----
  for (let i = 0; i <= s.numFrets; i++) {
    const p = positions[i];
    if (vertical) {
      parts.push(`<line x1="${ox - 14}" y1="${(oy + p).toFixed(1)}" x2="${ox + across + 14}" y2="${(oy + p).toFixed(1)}" stroke="${col(s.fretColor)}" stroke-width="${i === 0 ? 3 : 2.2}" stroke-linecap="round"/>`);
    } else {
      parts.push(`<line x1="${(ox + p).toFixed(1)}" y1="${oy - 14}" x2="${(ox + p).toFixed(1)}" y2="${oy + across + 14}" stroke="${col(s.fretColor)}" stroke-width="${i === 0 ? 3 : 2.2}" stroke-linecap="round"/>`);
    }
  }

  // ----- nut -----
  if (s.showNut) parts.push(renderNut(s, ox, oy, across));

  // ----- strings -----
  const sl = stringLayout(s);
  for (let i = 0; i < NUM_STRINGS; i++) {
    const off = sl[i].offset;
    const start = -nutZoneDepth(s) * (s.showNut ? 0.9 : 0.5);
    const end = flen + s.baseDotSize * 0.9;
    if (vertical) {
      parts.push(`<line x1="${(ox + off).toFixed(1)}" y1="${(oy + start).toFixed(1)}" x2="${(ox + off).toFixed(1)}" y2="${(oy + end).toFixed(1)}" stroke="${col(s.stringColor)}" stroke-width="${sl[i].width.toFixed(2)}"/>`);
    } else {
      parts.push(`<line x1="${(ox + start).toFixed(1)}" y1="${(oy + off).toFixed(1)}" x2="${(ox + end).toFixed(1)}" y2="${(oy + off).toFixed(1)}" stroke="${col(s.stringColor)}" stroke-width="${sl[i].width.toFixed(2)}"/>`);
    }
  }

  // ----- inlay dots -----
  if (s.showDots) parts.push(renderInlays(s, ox, oy, positions, across, flen, vertical));

  // ----- fret numbers -----
  for (let i = 0; i < s.numFrets; i++) {
    const abs = s.startFret + i;
    const c = (positions[i] + positions[i + 1]) / 2;
    const label = `${abs}`;
    if (vertical) {
      parts.push(`<text x="${(ox + across + 26).toFixed(1)}" y="${(oy + c).toFixed(1)}" font-family="${esc(s.defaultTextFont)}" font-size="13" fill="${col(withA(s.fretColor, 0.85))}" text-anchor="start" dominant-baseline="middle">${label}</text>`);
    } else {
      parts.push(`<text x="${(ox + c).toFixed(1)}" y="${(oy + across + 26).toFixed(1)}" font-family="${esc(s.defaultTextFont)}" font-size="13" fill="${col(withA(s.fretColor, 0.85))}" text-anchor="middle" dominant-baseline="hanging">${label}</text>`);
    }
  }

  // ----- fingerings (beside nut) -----
  parts.push(renderFingerings(doc, s, ox, oy, vertical));

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

function renderNut(s: Settings, ox: number, oy: number, across: number): string {
  const vertical = s.orientation === 'vertical';
  const taper = s.nutTaper === 'custom';
  let nMin = taper ? s.nutMin : s.nutWidth;
  let nMax = taper ? s.nutMax : s.nutWidth;
  if (!s.fingeringsLeft) { const t = nMin; nMin = nMax; nMax = t; }
  let pts: string;
  if (vertical) {
    // nut spans horizontally across strings; thickness varies per side (taper along x)
    const yTop = oy, half = across / 2;
    // left side (high e) gets nMin, right side (low E) gets nMax
    pts = [
      `${(ox - half).toFixed(1)},${(yTop - nMin / 2).toFixed(1)}`,
      `${(ox + half).toFixed(1)},${(yTop - nMax / 2).toFixed(1)}`,
      `${(ox + half).toFixed(1)},${(yTop + nMax / 2).toFixed(1)}`,
      `${(ox - half).toFixed(1)},${(yTop + nMin / 2).toFixed(1)}`,
    ].join(' ');
  } else {
    const xLeft = ox, half = across / 2;
    // top (high e) thin, bottom thick when tapering
    pts = [
      `${(xLeft - nMin / 2).toFixed(1)},${(oy - half).toFixed(1)}`,
      `${(xLeft + nMin / 2).toFixed(1)},${(oy - half).toFixed(1)}`,
      `${(xLeft + nMax / 2).toFixed(1)},${(oy + half).toFixed(1)}`,
      `${(xLeft - nMax / 2).toFixed(1)},${(oy + half).toFixed(1)}`,
    ].join(' ');
  }
  return `<polygon points="${pts}" fill="#f2ead8" stroke="#c9bfa4" stroke-width="1"/>`;
}

function renderInlays(s: Settings, ox: number, oy: number, positions: number[], across: number, flen: number, vertical: boolean): string {
  const out: string[] = [];
  const r = Math.min(7, s.stringGap * 0.16 + 3);
  const mid = across / 2;
  for (let i = 0; i < s.numFrets; i++) {
    const abs = s.startFret + i;
    const c = (positions[i] + positions[i + 1]) / 2;
    const isDouble = DOUBLE_INLAY_FRETS.includes(abs);
    const isSingle = INLAY_FRETS.includes(abs);
    if (!isDouble && !isSingle) continue;
    if (isSingle || isDouble) {
      if (vertical) {
        if (isDouble) {
          out.push(`<circle cx="${ox + mid - r * 2.4}" cy="${oy + c}" r="${r}" fill="${col(s.dotMarkerColor)}"/>`);
          out.push(`<circle cx="${ox + mid + r * 2.4}" cy="${oy + c}" r="${r}" fill="${col(s.dotMarkerColor)}"/>`);
        } else {
          out.push(`<circle cx="${ox + mid}" cy="${oy + c}" r="${r}" fill="${col(s.dotMarkerColor)}"/>`);
        }
      } else {
        if (isDouble) {
          out.push(`<circle cx="${ox + c}" cy="${oy + mid - r * 2.4}" r="${r}" fill="${col(s.dotMarkerColor)}"/>`);
          out.push(`<circle cx="${ox + c}" cy="${oy + mid + r * 2.4}" r="${r}" fill="${col(s.dotMarkerColor)}"/>`);
        } else {
          out.push(`<circle cx="${ox + c}" cy="${oy + mid}" r="${r}" fill="${col(s.dotMarkerColor)}"/>`);
        }
      }
    }
  }
  void flen;
  return out.join('');
}

function renderFingerings(doc: ChordDoc, s: Settings, ox: number, oy: number, vertical: boolean): string {
  const out: string[] = [];
  const sl = stringLayout(s);
  const nut = nutZoneDepth(s);
  for (const f of doc.fingerings) {
    const off = sl[f.string]?.offset ?? 0;
    if (vertical) {
      const x = ox + off;
      const y = oy - nut - 10;
      out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${esc(f.font)}" font-size="${f.size}" fill="${col(f.color)}" text-anchor="middle" dominant-baseline="auto">${esc(f.text)}</text>`);
    } else {
      const left = s.fingeringsLeft;
      const y = oy + off;
      const x = left ? ox - nut - 10 : ox + fretLength(s) + nut + 10;
      out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${esc(f.font)}" font-size="${f.size}" fill="${col(f.color)}" text-anchor="${left ? 'end' : 'start'}" dominant-baseline="middle">${esc(f.text)}</text>`);
    }
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


