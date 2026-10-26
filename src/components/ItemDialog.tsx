import { useState } from 'react';
import type { ChordColor, Dot, Fingering, Settings, TextBox } from '../lib/types';
import { uid } from '../lib/types';
import { FONT_OPTIONS } from '../lib/render';
import { STANDARD_SHAPES } from '../lib/shapes';
import ColorPicker from './ColorPicker';

type Kind = 'dot' | 'text' | 'fing';

interface Props {
  kind: Kind;
  item: Dot | TextBox | Fingering;
  settings: Settings;
  customs: Record<string, string>;
  onApply: (kind: Kind, item: any) => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function ItemDialog({ kind, item, settings, customs, onApply, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState<any>(() => structuredClone(item));
  const s = settings;

  const patch = (p: any) => setDraft((d: any) => ({ ...d, ...p }));

  const colorBasketIdx = kind === 'dot'
    ? ((draft.colorIdx % s.colors.length) + s.colors.length) % s.colors.length
    : -1;
  const shapeList = [...s.standardShapes, ...s.customShapes];
  const shapeIdx = kind === 'dot' ? ((draft.shapeIdx % shapeList.length) + shapeList.length) % shapeList.length : 0;

  const previewShape = (name: string) => (
    <svg viewBox="0 0 100 100" width="24" height="24"><g style={{ color: '#555' }} dangerouslySetInnerHTML={{ __html: STANDARD_SHAPES.find(x => x.name === name)?.inner ?? customs[name] ?? '' }} /></svg>
  );

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog">
        <div className="dlg-head">
          <h3>{kind === 'dot' ? 'Note dot properties' : kind === 'text' ? 'Text box properties' : 'Fingering properties'}</h3>
          <button className="btn small" onClick={onClose}>✕</button>
        </div>

        {kind === 'dot' && <>
          <label className="row"><span>Text in dot</span>
            <input className="txt" value={draft.text ?? ''} onChange={e => patch({ text: e.target.value })} placeholder="e.g. root, 3rd, note name…" autoFocus /></label>
          <div className="two-col">
            <label className="row"><span>Dot color</span>
              <select value={colorBasketIdx} onChange={e => patch({ colorIdx: Number(e.target.value) })}>
                {s.colors.map((c, i) => <option key={i} value={i}>{c.hex} ({Math.round(c.alpha * 100)}%)</option>)}
              </select></label>
            <label className="row"><span>Shape</span>
              <select value={shapeIdx} onChange={e => patch({ shapeIdx: Number(e.target.value) })}>
                {shapeList.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </select></label>
          </div>
          <div className="shape-preview">{previewShape(shapeList[shapeIdx])}<span>{shapeList[shapeIdx]}</span></div>
          <label className="row"><span>Text font <em style={{ fontWeight: 400, fontSize: 10 }}>(blank = follow global default)</em></span>
            <select value={draft.font ?? ''} onChange={e => patch({ font: e.target.value === '' ? null : e.target.value })}>
              <option value="">(global default)</option>
              {FONT_OPTIONS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select></label>
          <div className="two-col">
            <ColorPicker label="Text color" compact value={draft.textColor ?? s.defaultTextColor} onChange={(c: ChordColor) => patch({ textColor: c })} />
            <label className="row"><span>Size ×</span>
              <input type="range" min={0.5} max={2} step={0.05} value={draft.textSize ?? 1} onChange={e => patch({ textSize: Number(e.target.value) })} /></label>
          </div>
          <div className="two-col">
            <label className="row"><span>Transparency</span>
              <input type="range" min={5} max={100} value={Math.round((draft.transparency ?? 1) * 100)} onChange={e => patch({ transparency: Number(e.target.value) / 100 })} /></label>
            <label className="row"><span>Rotation</span>
              <select value={draft.rotation ?? 0} onChange={e => patch({ rotation: Number(e.target.value) })}>
                {[0, 90, 180, 270].map(r => <option key={r} value={r}>{r}°</option>)}
              </select></label>
          </div>
        </>}

        {kind === 'text' && <>
          <label className="row"><span>Text</span>
            <input className="txt" value={draft.text ?? ''} onChange={e => patch({ text: e.target.value })} autoFocus /></label>
          <label className="row"><span>Font <em style={{ fontWeight: 400, fontSize: 10 }}>(blank = follow global default)</em></span>
            <select value={draft.font ?? ''} onChange={e => patch({ font: e.target.value === '' ? null : e.target.value })}>
              <option value="">(global default)</option>
              {FONT_OPTIONS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select></label>
          <div className="two-col">
            <ColorPicker label="Color" compact value={draft.color ?? s.defaultTextColor} onChange={(c: ChordColor) => patch({ color: c })} />
            <label className="row"><span>Size</span>
              <input type="number" min={6} max={120} value={draft.size ?? s.defaultTextSize} onChange={e => patch({ size: Number(e.target.value) })} /></label>
          </div>
          <div className="two-col">
            <label className="row"><span>Rotation</span>
              <select value={draft.rotation ?? ''} onChange={e => patch({ rotation: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">(global default)</option>
                {[0, 90, 180, 270].map(r => <option key={r} value={r}>{r}°</option>)}
              </select></label>
            <label className="row"><span>Align</span>
              <select value={draft.anchor ?? 'middle'} onChange={e => patch({ anchor: e.target.value })}>
                <option value="start">Left</option><option value="middle">Center</option><option value="end">Right</option>
              </select></label>
          </div>
        </>}

        {kind === 'fing' && <>
          <label className="row"><span>Fingering</span>
            <input className="txt" value={draft.text ?? ''} onChange={e => patch({ text: e.target.value })} autoFocus maxLength={3} /></label>
          <div className="quick-btns">
            {['1', '2', '3', '4', 'T', 'x', '0'].map(t => <button key={t} className="btn small" onClick={() => patch({ text: t })}>{t}</button>)}
          </div>
          <label className="row"><span>Font <em style={{ fontWeight: 400, fontSize: 10 }}>(blank = follow global default)</em></span>
            <select value={draft.font ?? ''} onChange={e => patch({ font: e.target.value === '' ? null : e.target.value })}>
              <option value="">(global default)</option>
              {FONT_OPTIONS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select></label>
          <div className="two-col">
            <ColorPicker label="Color" compact value={draft.color ?? { hex: '#333333', alpha: 1 }} onChange={(c: ChordColor) => patch({ color: c })} />
            <label className="row"><span>Size</span>
              <input type="number" min={6} max={60} value={draft.size ?? 15} onChange={e => patch({ size: Number(e.target.value) })} /></label>
          </div>
        </>}

        <div className="dlg-foot">
          <button className="btn danger" onClick={onDelete}>Delete</button>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onApply(kind, draft)}>Apply</button>
        </div>
      </div>
    </div>
  );
}

export function newText(settings: Settings, x: number, y: number): TextBox {
  // font / size / rotation are LEFT UNSET ⇒ the box follows the GLOBAL text
  // defaults live (changing them in Settings updates every such box on every
  // chord). Color still snapshots the default at creation time.
  return {
    id: uid('txt'), x, y, text: 'Text',
    color: { ...settings.defaultTextColor },
    anchor: 'middle',
  };
}
export function newFingering(settings: Settings, string: number): Fingering {
  // font unset ⇒ follows the GLOBAL default font live.
  return { id: uid('fing'), string, text: '1', size: 15, color: { hex: '#333333', alpha: 1 } };
}
