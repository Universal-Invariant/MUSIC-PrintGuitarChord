// ---------- Global theme editor dialog ----------
//
// A single 12-dot row IS the grid (colors / shapes / text collapsed into one
// cell per chromatic slot), exactly like the on-board dots:
//   • Shift+click a dot  → cycle its COLOR   (same as shift-click on fretboard)
//   • Ctrl +click a dot  → cycle its SHAPE   (same as ctrl-click on fretboard)
//   • plain click        → edit the dot's TEXT inline
// The row is prefixed with an "R" tag showing which note the first slot maps
// to under the current mode/root settings.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChordColor, Settings } from '../lib/types';
import { col } from '../lib/types';
import { allShapeNames } from '../lib/render';
import { shapeInner } from '../lib/shapes';
import ColorPicker from './ColorPicker';
import type { NoteTheme } from '../lib/themes';
import { PC_NAMES, suggestSlotText } from '../lib/themes';

interface Props {
  theme: NoteTheme;               // working COPY — the dialog never mutates the store
  settings: Settings;
  customs: Record<string, string>;
  onSave: (t: NoteTheme) => void; // Save & close
  onApply: (t: NoteTheme) => void; // Apply to chords (scope chosen by caller) — keeps dialog open
  onClose: () => void;
}

const SLOT_TAG = (mode: NoteTheme['mode'], rootPc: number, i: number): string =>
  mode === 'absolute' ? PC_NAMES[i] : (i === 0 ? 'R' : `+${i}`);

export default function ThemeDialog({ theme, settings, customs, onSave, onApply, onClose }: Props) {
  const [t, setT] = useState<NoteTheme>(() => structuredClone(theme));
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const textRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editingSlot != null) textRef.current?.focus(); }, [editingSlot]);

  const shapes = useMemo(() => allShapeNames(settings), [settings]);
  const basket = settings.colors;

  const patch = (fn: (x: NoteTheme) => void) => {
    setT(prev => { const n = structuredClone(prev); fn(n); return n; });
  };
  const patchSlot = (i: number, fn: (s: NoteTheme['slots'][number]) => void) => {
    patch(x => { fn(x.slots[i]); });
  };

  /** Shift+click ⇒ next color in the DEFAULT-color cycle (mirrors the board's
   *  shift-click behavior of cycling through the cycling palette). */
  const cycleColorOf = (cur: number): number => {
    const cycle = settings.defaultColors
      .map(c => basket.findIndex(x => x.hex === c.hex && Math.abs(x.alpha - c.alpha) < 0.01))
      .filter(i => i >= 0);
    if (!cycle.length) return (cur + 1) % Math.max(1, basket.length);
    const pos = cycle.indexOf(cur);
    return cycle[(pos + 1) % cycle.length];
  };
  const cycleShapeOf = (cur: number): number => {
    const cycle = settings.defaultShapes.map(n => Math.max(0, shapes.indexOf(n)));
    if (!cycle.length) return (cur + 1) % Math.max(1, shapes.length);
    const pos = cycle.indexOf(cur);
    return cycle[(pos + 1) % cycle.length];
  };

  const onDotClick = (e: React.MouseEvent, i: number) => {
    if (e.shiftKey) { e.preventDefault(); patchSlot(i, s => { s.colorIdx = cycleColorOf(s.colorIdx); }); return; }
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); patchSlot(i, s => { s.shapeIdx = cycleShapeOf(s.shapeIdx); }); return; }
    // plain click ⇒ inline text edit for this slot
    setEditingSlot(i);
    setTextDraft(t.slots[i].text);
  };

  const commitText = () => {
    if (editingSlot != null) patchSlot(editingSlot, s => { s.text = textDraft; });
    setEditingSlot(null);
  };

  const slotColor = (idx: number): ChordColor => basket[idx % Math.max(1, basket.length)] ?? { hex: '#000000', alpha: 1 };

  const previewSvg = useMemo(() => {
    const size = 46, gap = size * 1.18;
    const w = gap * 12, h = size + 14;
    const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(1)}" height="${h}" viewBox="0 0 ${w.toFixed(1)} ${h}">`];
    t.slots.forEach((slot, i) => {
      const c = slotColor(slot.colorIdx);
      const name = shapes[Math.min(slot.shapeIdx, shapes.length - 1)] ?? 'circle';
      const cx = gap * i + size / 2;
      const sc = (size * 0.46) / 50;
      parts.push(`<g transform="translate(${cx.toFixed(1)},${(size / 2 + 2).toFixed(1)}) scale(${sc.toFixed(4)}) translate(-50,-50)" style="color:${col(c)}">${shapeInner(name, customs)}</g>`);
      const label = slot.text !== '' ? slot.text : '';
      if (label) parts.push(`<text x="${cx.toFixed(1)}" y="${(size / 2 + 2).toFixed(1)}" font-size="${(size * 0.4).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-weight="bold" fill="#ffffff" stroke="#00000022">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);
      parts.push(`<text x="${cx.toFixed(1)}" y="${(h - 2).toFixed(1)}" font-size="9" text-anchor="middle" fill="#8b93a7">${SLOT_TAG(t.mode, t.rootPc, i)}</text>`);
    });
    parts.push('</svg>');
    return parts.join('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, basket, shapes, customs]);

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog theme-dlg">
        <div className="dlg-head">
          <h3>🎨 Theme editor</h3>
          <button className="btn small" onClick={onClose}>✕</button>
        </div>

        <div className="row">
          <label>Name</label>
          <input className="txt" value={t.name} onChange={e => patch(x => { x.name = e.target.value; })} />
        </div>

        <div className="row">
          <label>Mode</label>
          <select className="sel" value={t.mode} onChange={e => patch(x => { x.mode = e.target.value as NoteTheme['mode']; })}
            title={'relative — slot = distance above the ROOT selected in the chord editor.\nLook follows the FUNCTION: transposing keeps every dot in its slot.\n\nabsolute — slot = the sounding pitch class itself (root note anchors the letters).\nLook follows the NOTE: with root C, all C dots share slot 1; transposing moves dots between slots.'}>
            <option value="relative">Relative (to chord root)</option>
            <option value="absolute">Absolute (pitch class)</option>
          </select>
          <label title="Reference note: absolute-mode letter anchor / relative-mode spelling base for the text suggestions">{t.mode === 'absolute' ? 'Root note' : 'Spelling root'}</label>
          <select className="sel" value={String(t.rootPc)} onChange={e => patch(x => { x.rootPc = Number(e.target.value); })}>
            {PC_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
          <label className="chk"><input type="checkbox" checked={t.preferFlats} onChange={e => patch(x => { x.preferFlats = e.target.checked; })} /> ♭ flats</label>
        </div>

        {/* ---- the single 12-dot row (the whole grid) ---- */}
        <div className="theme-row-wrap">
          <span className="theme-r-tag" title={`First slot maps to ${SLOT_TAG(t.mode, t.rootPc, 0)}${t.mode === 'relative' ? ' (the chord root)' : ` (pitch class ${PC_NAMES[t.rootPc]} = slot 1)`}`}>R</span>
          <div className="theme-dots" role="group" aria-label="Theme slots">
            {t.slots.map((slot, i) => {
              const c = slotColor(slot.colorIdx);
              const name = shapes[Math.min(slot.shapeIdx, shapes.length - 1)] ?? 'circle';
              const active = editingSlot === i;
              return (
                <button key={i}
                  className={`theme-dot${active ? ' active' : ''}`}
                  style={{ ['--tdot' as never]: col(c) }}
                  title={`Slot ${i + 1} (${SLOT_TAG(t.mode, t.rootPc, i)})\nShift+click: cycle color\nCtrl+click: cycle shape\nClick: edit text`}
                  onClick={e => onDotClick(e, i)}>
                  <svg width="34" height="34" viewBox="0 0 100 100" style={{ color: col(c) }}>
                    <g dangerouslySetInnerHTML={{ __html: shapeInner(name, customs) }} />
                  </svg>
                  <span className="theme-dot-text">{slot.text !== '' ? slot.text : ''}</span>
                </button>
              );
            })}
          </div>
        </div>

        {editingSlot != null && (
          <div className="row theme-text-edit">
            <label>Text · slot {editingSlot + 1} ({SLOT_TAG(t.mode, t.rootPc, editingSlot)})</label>
            <input ref={textRef} className="txt" value={textDraft}
              onChange={e => setTextDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setEditingSlot(null); }}
              placeholder="(empty = keep auto note labels)" />
            <button className="btn small" onClick={() => { setTextDraft(suggestSlotText(t, editingSlot)); textRef.current?.focus(); }}
              title="Fill in the suggested note name for this slot (honors mode / root / flats)">Suggest</button>
            <button className="btn small" onClick={commitText}>OK</button>
          </div>
        )}

        <details className="theme-palette" open={paletteOpen}>
          <summary onClick={() => setPaletteOpen(o => !o)}>🎯 Pick exact color / shape for a slot</summary>
          <div className="row">
            <label>Slot</label>
            <select className="sel" value={pickerSlot == null ? '' : String(pickerSlot)}
              onChange={e => setPickerSlot(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">choose…</option>
              {t.slots.map((_, i) => <option key={i} value={i}>{i + 1} · {SLOT_TAG(t.mode, t.rootPc, i)}</option>)}
            </select>
          </div>
          {pickerSlot != null && (
            <>
              <div className="row">
                <label>Color</label>
                <ColorPicker compact value={slotColor(t.slots[pickerSlot].colorIdx)} label="Slot color"
                  onChange={(c) => {
                    // themes reference EXISTING basket indices only; an unseen
                    // color is clamped to the nearest match / first entry
                    const idx = basket.findIndex(x => x.hex.toLowerCase() === c.hex.toLowerCase());
                    patch(x => { x.slots[pickerSlot].colorIdx = idx >= 0 ? idx : 0; });
                  }} />
              </div>
              <div className="row">
                <label>Shape</label>
                <select className="sel" value={Math.min(t.slots[pickerSlot].shapeIdx, shapes.length - 1)}
                  onChange={e => patch(x => { x.slots[pickerSlot].shapeIdx = Number(e.target.value); })}>
                  {shapes.map((n, i) => <option key={n} value={i}>{n}</option>)}
                </select>
              </div>
            </>
          )}
          <p className="mini-note">Tip: Shift/Ctrl-click the dots directly is faster — this panel is for exact picks.</p>
        </details>

        <div className="theme-preview" dangerouslySetInnerHTML={{ __html: previewSvg }} />

        <div className="dlg-foot">
          <button className="btn" onClick={() => onApply(structuredClone(t))} title="Apply this theme to the selected chord (or ALL chords / library when 🌐 All chords is ON)">✔ Apply</button>
          <button className="btn primary" onClick={() => onSave(structuredClone(t))}>💾 Save theme</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
