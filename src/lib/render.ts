// ---------- SVG renderer: pure functions producing SVG markup ----------
// Used both for on-screen rendering (dangerouslySetInnerHTML) and for export.
//
// Everything is positioned through geometry.project(s, t, a): one logical
// "nut-first" frame shared with hit-testing, so orientation changes, flips and
// scaling are equivariant — dots, nut, taper and spacing stay consistent.

import type { ChordColor, ChordDoc, Dot, Settings } from './types';
import { col, uid } from './types';
import { isHiddenRel, nutShown } from './types';
import { pitchAtRel, midiToName, computeDotLabel, TUNING_HIGH_TO_LOW } from './music';
import type { LabelCtx } from './music';
import {
  boardAcross, canvasSize, cellCenter, farBand, fingeringPos,
  fretLength, fretPositions, halfWidthAlong, lengthScale, nutZoneDepth,
  project, showFretLabel, stringLabelAlong, stringLayout, widthScale,
  DOUBLE_INLAY_FRETS, INLAY_FRETS, NUM_STRINGS,
} from './geometry';

import { shapeInner } from './shapes';

// re-export geometry helpers for consumers
export {
  canvasSize, cellCenter, contentSize, fretPositions, stringLayout,
  fingeringPos, fretLength, nutZoneDepth, hitTest, alongCoord, dotAlongFret,
  project, unproject,
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

export interface RenderOpts { scale?: number; groupId?: string }

export function renderSvg(doc: ChordDoc, settings: Settings, opts: RenderOpts & { customs?: Record<string,string> } = {}): string {
  const s = settings;
  const customMap = opts.customs ?? {};
  const { w, h } = canvasSize(s);
  const sc = opts.scale ?? 1;
  const parts: string[] = [];

  const gid = opts.groupId ? ` id="${esc(opts.groupId)}"` : '';
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * sc)}" height="${Math.round(h * sc)}" viewBox="0 0 ${w} ${h}" data-w="${w}" data-h="${h}">`);
  parts.push('<style>text{user-select:none}</style>');
  if (opts.groupId) parts.push(`<g${gid}>`);
  // background
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${col(s.bgFill)}"/>`);

  const vertical = s.orientation === 'vertical';
  const positions = fretPositions(s);     // ordered nut-side first (logical frame)
  const flen = fretLength(s);
  const pad = boardAcross(s) * 0.06;      // board extends slightly past outer strings

  // Map logical (t = distance from nut line toward higher frets, a = across offset
  // from the center line) to canvas pixels — orientation + flips applied uniformly.
  const P = (t: number, a: number) => project(s, t, a);

  // ----- fretboard panel (tapered trapezoid) -----
  parts.push(renderBoardPanel(s, flen, pad, P));

  // ----- fret lines (including the 0-fret line which the nut sits on) -----
  // stroke width = user "fret thickness" setting (thin vintage vs jumbo frets)
  // Length: frets span the FULL board width — from one taper edge to the other.
  // `fretSpan` (settings.fretWidthPct, default 100%) lets the user dial it back.
  const fretW = Math.max(0.5, s.fretThickness ?? 2);
  const spanK = Math.max(0.5, Math.min(1.5, (s.fretWidthPct ?? 100) / 100));
  for (let i = 0; i <= s.numFrets; i++) {
    const t = positions[i];
    const hw = (halfWidthAlong(s, t) + pad * 0.4) * spanK;
    const p1 = P(t, -hw), p2 = P(t, hw);
    parts.push(`<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${col(s.fretColor)}" stroke-width="${fretW.toFixed(2)}" stroke-linecap="round"/>`);
  }

  // ----- nut: thick bar on the first fret line — shown ONLY when startFret === 1
  // (higher starting frets sit mid-neck: no nut there) -----
  if (nutShown(s)) parts.push(renderNut(s, P, positions[0], halfWidthAlong(s, positions[0])));

  // ----- strings — NEVER extend past the starting fret line (t=0) nor past the
  //       last fret line. When the nut is shown they stop right at its outer edge. -----
  const sl = stringLayout(s);
  const nutTh = Math.max(2, s.nutWidth);
  for (let i = 0; i < NUM_STRINGS; i++) {
    const off = sl[i].offset;
    const start = nutShown(s) ? -nutTh / 2 : 0;
    const end = flen;
    const p1 = P(start, off), p2 = P(end, off);
    parts.push(`<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${col(s.stringColor)}" stroke-width="${sl[i].width.toFixed(2)}"/>`);
  }

  // ----- inlay dots (center of the board, per real fretboards) -----
  if (s.showDots) parts.push(renderInlays(s, P, positions));

  // ----- fret numbers, just outside the board side (all / none / custom list) -----
  for (let i = 0; i < s.numFrets; i++) {
    const abs = s.startFret + i;
    if (!showFretLabel(s, abs)) continue;
    const t = (positions[i] + positions[i + 1]) / 2;
    const hw = halfWidthAlong(s, t) + pad;
    const p = P(t, hw + 18);
    const anchor = vertical ? 'start' : 'middle';
    const baseline = vertical ? 'central' : 'hanging';
    parts.push(`<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-family="${esc(s.defaultTextFont)}" font-size="13" fill="${col(withA(s.fretColor, 0.85))}" text-anchor="${anchor}" dominant-baseline="${baseline}">${abs}</text>`);
  }

  // ----- string open-pitches ring: shows the actual pitch NAMES computed from
  //       settings.tuning (changing a tuning preset updates them live), can be
  //       disabled via openNoteLabels, and is pushed away from the board by
  //       openNoteOffset so it never overlaps the open (rel -1) note dots. -----
  if (s.openNoteLabels !== false) {
    const tl = stringLabelAlong(s);
    for (let i = 0; i < NUM_STRINGS; i++) {
      const p = P(tl, sl[i].offset);
      const name = midiToName(s.tuning?.[i] ?? TUNING_HIGH_TO_LOW[i], !!s.preferFlats);
      parts.push(`<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-family="${esc(s.defaultTextFont)}" font-size="11" fill="${col(withA(s.fretColor, 0.7))}" text-anchor="middle" dominant-baseline="central">${esc(name)}</text>`);
    }
  }

  // ----- O / X markers in the floating zone before the first fret line — only when
  //       the nut is actually shown there (startFret === 1). Higher starting frets
  //       have no nut: open dots simply float "behind" the board. -----
  if (nutShown(s)) parts.push(renderOpenMarkers(doc, s, P));

  // ----- fingerings: at the END of the fretboard OPPOSITE the nut -----
  parts.push(renderFingerings(doc, s));

  // ----- note dots (skipping any outside the visible fret range) -----
  // When a NON-letter label mode is active, build the whole-shape context once
  // (root derivation needs every sounding dot of this chord).
  const labelCtx: LabelCtx | undefined = s.noteVisible && s.noteLabelMode !== 'letter'
    ? {
        mode: s.noteLabelMode,
        soundingAbs: doc.dots.map(d => ({ string: d.string, abs: d.fret })),
        tuning: s.tuning, startFret: s.startFret, preferFlats: !!s.preferFlats,
        rootPc: s.noteRootPc >= 0 ? s.noteRootPc : null,
        key: s.noteKey || null,
      }
    : undefined;
  for (const d of doc.dots) {
    const rel = d.fret - s.startFret;
    if (isHiddenRel(s, rel)) continue;
    parts.push(renderDot(d, s, customMap, labelCtx));
  }

  // ----- free text boxes -----
  // font / size / rotation are resolved AT DRAW TIME: an item without an
  // explicit value follows the GLOBAL text defaults, so changing those
  // settings updates every such box on EVERY chord — not just the selected one.
  for (const t of doc.texts) {
    const x = t.x * w, y = t.y * h;
    const rot = t.rotation ?? s.defaultTextRotation ?? 0;
    const size = t.size ?? s.defaultTextSize ?? 14;
    parts.push(`<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot})">`);
    parts.push(`<text font-family="${esc(t.font || s.defaultTextFont)}" font-size="${size}" fill="${col(t.color)}" text-anchor="${t.anchor}" dominant-baseline="central">${esc(t.text)}</text>`);
    parts.push('</g>');
  }

  if (opts.groupId) parts.push('</g>');
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
  const tStart = nutShown(s) ? -Math.max(2, s.nutWidth) / 2 : 0;
  const tEnd = flen; // the board ends at the last fret line — no wood beyond it
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
  const r = Math.min(7, s.stringGap * widthScale(s) * 0.16 + 3);
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

/**
 * Traditional X/O markers in front of the nut for strings explicitly marked
 * open ('0') or muted ('x') via their fingering label (as loaded from the
 * chord library). Drawn on the opposite side of the string-label ring so the
 * three bands (markers | labels | nut) never collide.
 */
function renderOpenMarkers(doc: ChordDoc, s: Settings, P: (t: number, a: number) => { x: number; y: number }): string {
  const out: string[] = [];
  // just outside the first fret line, in the floating open zone (before the pitch ring)
  const tMark = -nutZoneDepth(s) * 0.92;
  const r = Math.min(9, Math.max(5, s.stringGap * widthScale(s) * 0.22));
  const color = col(withA(s.fretColor, 0.9));
  for (const f of doc.fingerings) {
    const txt = f.text.trim().toLowerCase();
    const isOpen = txt === '0' || txt === 'o';
    const isMute = txt === 'x';
    if (!isOpen && !isMute) continue;
    const off = stringLayout(s)[f.string]?.offset ?? 0;
    const p = P(tMark, off);
    if (isOpen) {
      out.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${color}" stroke-width="1.6"/>`);
    } else {
      const k = r * 0.72;
      out.push(
        `<line x1="${(p.x - k).toFixed(1)}" y1="${(p.y - k).toFixed(1)}" x2="${(p.x + k).toFixed(1)}" y2="${(p.y + k).toFixed(1)}" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>` +
        `<line x1="${(p.x - k).toFixed(1)}" y1="${(p.y + k).toFixed(1)}" x2="${(p.x + k).toFixed(1)}" y2="${(p.y - k).toFixed(1)}" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`,
      );
    }
  }
  return out.join('');
}

function renderFingerings(doc: ChordDoc, s: Settings): string {
  const out: string[] = [];
  for (const f of doc.fingerings) {
    // font/size resolved at draw time — missing ⇒ follow the GLOBAL text defaults
    const p = fingeringPos(s, f.string);
    const size = f.size ?? s.defaultTextSize ?? 14;
    out.push(`<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-family="${esc(f.font || s.defaultTextFont)}" font-size="${size}" fill="${col(f.color)}" text-anchor="${p.anchor}" dominant-baseline="central">${esc(f.text)}</text>`);
  }
  return out.join('');
}

export function renderDot(d: Dot, s: Settings, customs: Record<string,string> = {}, ctx?: LabelCtx): string {
  const rel = relOf(s, d.fret);
  const c = cellCenter(s, d.string, rel);
  const size = s.baseDotSize * (d.textSize != null ? Math.max(0.3, d.textSize) : 1);
  const colorIdx = ((d.colorIdx % s.colors.length) + s.colors.length) % s.colors.length;
  const base = s.colors[colorIdx] ?? s.shapeDefaultColor;
  const alpha = d.transparency != null ? Math.max(0.05, Math.min(1, d.transparency)) : base.alpha;
  const fillColor: ChordColor = { hex: base.hex, alpha };
  const shapes = activeShapes(s);
  const shapeName = shapes[((d.shapeIdx % shapes.length) + shapes.length) % shapes.length] ?? 'circle';
  const glyphScale = (size * s.shapeScale) / 100;
  const rot = d.rotation || 0;

  // NOTE-VISIBLE mode: automatically label the dot. The label follows the
  // note-label MODE (letter pitch / interval from root / tonal degrees of a
  // key / chromatic degree with root = 1), computed from the string tuning and
  // the absolute fret. A manually typed text always wins over the auto label.
  const autoLabel = !s.noteVisible ? ''
    : (ctx && ctx.mode !== 'letter'
        ? computeDotLabel(d.string, d.fret, ctx)
        : pitchAtRel(s.tuning, d.string, rel, !!s.preferFlats, s.startFret));
  const label = d.text.trim() ? d.text : autoLabel;

  const out: string[] = [];
  out.push(`<g transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${rot})">`);
  out.push(`<g transform="scale(${glyphScale.toFixed(4)}) translate(-50,-50)" style="color:${col(fillColor)}">`);
  out.push(shapeInner(shapeName, customs));
  out.push('</g>');
  if (label) {
    const tc = d.textColor ?? s.dotTextColor ?? { hex: '#ffffff', alpha: 1 };
    const fs = size * 0.55;
    out.push(`<text font-family="${esc(d.font ?? s.defaultTextFont)}" font-size="${fs.toFixed(1)}" fill="${col(tc)}" text-anchor="middle" dominant-baseline="central" font-weight="bold">${esc(label)}</text>`);
  }
  out.push('</g>');
  return out.join('');
}

function relOf(s: Settings, absFret: number): number {
  return absFret - s.startFret;
}

// ---------------- page composer (multi-chord layout) ----------------

/** Extract the inner markup of a chord SVG produced by renderSvg (drops the <svg> wrapper). */
export function svgInner(markup: string): string {
  const open = markup.indexOf('>');            // end of the <svg ...> open tag
  const close = markup.lastIndexOf('</svg>');
  if (open < 0 || close < 0) return '';
  let inner = markup.slice(open + 1, close);
  // drop the shared <style> element — it is emitted once at page level instead
  inner = inner.replace('<style>text{user-select:none}</style>', '');
  return inner.trim();
}

export interface PageChordEntry {
  id: string;              // stable chord id (used for the <g id>)
  x: number; y: number;    // page coords of the chord box top-left
  scale: number;           // uniform scale factor applied to the chord canvas
  markup: string;          // full chord SVG from renderSvg(doc, effSettings)
}

/** Compose several chord SVGs onto one page-sized SVG (print/export friendly). */
export function composePage(page: { w: number; h: number }, chords: PageChordEntry[], opts: { scale?: number; grid?: { size: number } | null } = {}): string {
  const sc = opts.scale ?? 1;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(page.w * sc)}" height="${Math.round(page.h * sc)}" viewBox="0 0 ${page.w} ${page.h}" data-w="${page.w}" data-h="${page.h}">`);
  parts.push('<style>text{user-select:none}</style>');
  parts.push(`<rect x="0" y="0" width="${page.w}" height="${page.h}" fill="#ffffff"/>`);
  if (opts.grid) {
    const g = Math.max(4, opts.grid.size);
    parts.push(`<defs><pattern id="pagegrid" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><path d="M ${g} 0 L 0 0 0 ${g}" fill="none" stroke="#dfe4ea" stroke-width="1"/></pattern></defs>`);
    parts.push(`<rect x="0" y="0" width="${page.w}" height="${page.h}" fill="url(#pagegrid)"/>`);
  }
  for (const c of chords) {
    const m = c.markup.match(/data-w="(\d+(?:\.\d+)?)" data-h="(\d+(?:\.\d+)?)"/);
    const iw = m ? parseFloat(m[1]) : 320, ih = m ? parseFloat(m[2]) : 420;
    parts.push(`<g transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) scale(${c.scale.toFixed(4)})">`);
    parts.push(`<rect x="0" y="0" width="${iw}" height="${ih}" fill="#ffffff" stroke="#e3e7ec" stroke-width="1"/>`);
    parts.push(svgInner(c.markup));
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('\n');
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
    font: null,        // null ⇒ follow the GLOBAL default font live
    textColor: null,   // null ⇒ follow the dot pitch-label color live
    textSize: null,    // null ⇒ exactly `baseDotSize` (GLOBAL "Dot base size")
    transparency: null,
    rotation: 0, // shape glyphs start upright; defaultTextRotation applies to TEXT items only
  };
}

/** true ⇒ a stored item carries NO explicit text styling — it should follow the
 *  GLOBAL text defaults (font / size / rotation) live. Used by the load-time
 *  migration to drop baked-in values from legacy saves so the global settings
 *  can reach every existing chord. An item that was explicitly customized in
 *  its dialog keeps its own values (per-item override). */
export function itemFollowsGlobalFont(it: { font?: string | null }): boolean {
  return it.font == null || it.font === '';
}
