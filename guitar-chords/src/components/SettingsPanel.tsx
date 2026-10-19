import { useState } from 'react';
import type { ChordColor, Settings } from '../lib/types';
import { BASKET_COLORS, DEFAULT_COLORS, DEFAULT_SETTINGS } from '../lib/storage';
import { STANDARD_SHAPES, sanitizeSvgInput } from '../lib/shapes';
import { FONT_OPTIONS } from '../lib/render';
import ColorPicker from './ColorPicker';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  customs: Record<string, string>;
  onCustomsChange: (c: Record<string, string>) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <details className="section"><summary>{title}</summary><div className="sec-body">{children}</div></details>;
}

export default function SettingsPanel({ settings, onChange, customs, onCustomsChange }: Props) {
  const s = settings;
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });
  const setColor = (key: keyof Settings, c: ChordColor) => set({ [key]: c } as Partial<Settings>);

  // --- color basket helpers ---
  const basketIdxOf = (c: ChordColor) =>
    s.colors.findIndex(x => x.hex === c.hex && Math.abs(x.alpha - c.alpha) < 0.01);
  const toggleBasket = (c: ChordColor) => {
    const i = basketIdxOf(c);
    if (i >= 0) {
      const colors = s.colors.filter((_, j) => j !== i);
      // fix defaultColors references
      const dc = s.defaultColors.map(d => {
        const di = basketIdxOf(d);
        if (di < i) return d;
        if (di === i) return colors[0] ?? d;
        return colors[di - 1] ?? d;
      });
      set({ colors, defaultColors: dc });
    } else set({ colors: [...s.colors, c] });
  };
  const setDefaultColor = (slot: number, c: ChordColor) => {
    let i = basketIdxOf(c);
    let colors = s.colors;
    if (i < 0) { colors = [...s.colors, c]; i = colors.length - 1; }
    const dc = [...s.defaultColors]; dc[slot] = c;
    set({ colors, defaultColors: dc });
  };

  // --- shape helpers ---
  const allShapes = [...s.standardShapes, ...s.customShapes];
  const toggleShapeSelected = (name: string) => {
    const i = s.defaultShapes.indexOf(name);
    const ds = [...s.defaultShapes];
    if (i >= 0) ds.splice(i, 1);
    else { if (ds.length >= 7) ds.shift(); ds.push(name); }
    set({ defaultShapes: ds });
  };
  const removeCustom = (name: string) => {
    const c2 = { ...customs }; delete c2[name];
    onCustomsChange(c2);
    set({
      customShapes: s.customShapes.filter(n => n !== name),
      defaultShapes: s.defaultShapes.filter(n => n !== name),
    });
  };

  const [svgName, setSvgName] = useState('');
  const [svgSrc, setSvgSrc] = useState('');
  const [svgErr, setSvgErr] = useState('');
  const addCustomShape = () => {
    const inner = sanitizeSvgInput(svgSrc);
    if (!inner) { setSvgErr('Invalid SVG — must contain path/circle/rect/polygon elements.'); return; }
    let name = svgName.trim().toLowerCase().replace(/[^a-z0-9]/g, '-') || `custom-${Date.now()}`;
    if (allShapes.includes(name)) name = `${name}-2`;
    onCustomsChange({ ...customs, [name]: inner });
    set({ customShapes: [...s.customShapes, name] });
    setSvgName(''); setSvgSrc(''); setSvgErr('');
  };

  return (
    <div className="settings">
      <Section title="Fretboard geometry">
        <label className="row"><span>Frets displayed</span>
          <input type="number" min={1} max={27} value={s.numFrets} onChange={e => set({ numFrets: Math.max(1, Math.min(27, Number(e.target.value))) })} /></label>
        <label className="row"><span>Starting fret</span>
          <input type="number" min={0} max={24} value={s.startFret} onChange={e => set({ startFret: Math.max(0, Number(e.target.value)) })} /></label>
        <label className="row"><span>Orientation</span>
          <select value={s.orientation} onChange={e => set({ orientation: e.target.value as Settings['orientation'] })}>
            <option value="vertical">Vertical (classic chord box)</option>
            <option value="horizontal">Horizontal (fretboard)</option>
          </select></label>
        <label className="row"><span>Flip fretboard (along)</span>
          <select value={s.flipAlong ? 'far' : 'near'} onChange={e => set({ flipAlong: e.target.value === 'far', fingeringsLeft: e.target.value !== 'far' })}>
            <option value="near">Nut at top / left (frets grow down / right)</option>
            <option value="far">Nut at bottom / right (mirrored, frets grow up / left)</option>
          </select></label>
        <label className="row check"><input type="checkbox" checked={s.flipAcross} onChange={e => set({ flipAcross: e.target.checked })} /><span>Flip strings (across) — mirror bass/treble order</span></label>
        <div className="mini-note">Both flips mirror the whole drawing (nut, taper, spacing, dots and labels together); the board stays centered in the canvas.</div>
        <label className="row"><span>String spacing (px)</span>
          <input type="range" min={16} max={80} value={s.stringGap} onChange={e => set({ stringGap: Number(e.target.value) })} /><b style={{ fontSize: 11 }}>{s.stringGap}</b></label>
        <label className="row"><span>String widths</span>
          <select value={s.stringWidthMode} onChange={e => set({ stringWidthMode: e.target.value as Settings['stringWidthMode'] })}>
            <option value="uniform">Same size</option>
            <option value="progressive">Progressive (thicker for bass)</option>
          </select></label>
        {s.stringWidthMode === 'progressive' && <>
          <label className="row"><span>Min string width</span>
            <input type="number" step={0.2} min={0.2} max={10} value={s.minStringWidth} onChange={e => set({ minStringWidth: Number(e.target.value) })} /></label>
          <label className="row"><span>Max string width</span>
            <input type="number" step={0.2} min={0.2} max={12} value={s.maxStringWidth} onChange={e => set({ maxStringWidth: Number(e.target.value) })} /></label>
        </>}
      </Section>

      <Section title="Nut, taper & fret spacing">
        <label className="row check"><input type="checkbox" checked={s.showNut} onChange={e => set({ showNut: e.target.checked })} /><span>Show nut (off ⇒ first line is a plain fret)</span></label>
        <label className="row"><span>Nut width (px)</span>
          <input type="range" min={2} max={20} value={s.nutWidth} onChange={e => set({ nutWidth: Number(e.target.value) })} disabled={!s.showNut} /><b style={{ fontSize: 11 }}>{s.nutWidth}</b></label>
        <label className="row"><span>Fretboard taper</span>
          <input type="range" min={0} max={100} value={Math.round(s.boardTaper * 100)} onChange={e => set({ boardTaper: Number(e.target.value) / 100 })} /><b style={{ fontSize: 11 }}>{Math.round(s.boardTaper * 100)}%</b></label>
        <div className="mini-note">Taper narrows the fretboard toward the nut. 0% ⇒ the 0-fret end is as wide as the hypothetical 12th fret; higher ⇒ wider trapezoid. It follows real guitar geometry, so it stays consistent when you change the starting fret.</div>
        <label className="row"><span>Fret spacing mode</span>
          <select value={s.spacing} onChange={e => set({ spacing: e.target.value as Settings['spacing'] })}>
            <option value="equal">Equal</option>
            <option value="logarithmic">Logarithmic (real guitar)</option>
          </select></label>
        {s.spacing === 'logarithmic' && <>
          <label className="row"><span>First fret size (px)</span>
            <input type="number" min={8} max={200} value={s.firstFretSize} onChange={e => set({ firstFretSize: Number(e.target.value) })} /></label>
          <label className="row"><span>Last fret size (px)</span>
            <input type="number" min={4} max={200} value={s.lastFretSize} onChange={e => set({ lastFretSize: Number(e.target.value) })} /></label>
          <div className="mini-note">Slot widths shrink geometrically from the first to the last displayed fret.</div>
        </>}
        <label className="row check"><input type="checkbox" checked={s.showDots} onChange={e => set({ showDots: e.target.checked })} /><span>Fret dot markers (3,5,7,9 / double 12)</span></label>
        <ColorPicker label="Inlay color" compact value={s.dotMarkerColor} onChange={c => setColor('dotMarkerColor', c)} />
      </Section>

      <Section title="Board appearance">
        <ColorPicker label="Background" compact value={s.bgFill} onChange={c => setColor('bgFill', c)} />
        <ColorPicker label="Frets" compact value={s.fretColor} onChange={c => setColor('fretColor', c)} />
        <ColorPicker label="Strings" compact value={s.stringColor} onChange={c => setColor('stringColor', c)} />
      </Section>

      <Section title="Note dots — colors">
        <div className="basket">
          {BASKET_COLORS.map((c, i) => {
            const inBasket = basketIdxOf(c) >= 0;
            return (
              <button key={i} className={`swatch ${inBasket ? 'on' : ''}`} onClick={() => toggleBasket(c)} title="Toggle in color basket">
                <span style={{ backgroundColor: c.hex, opacity: c.alpha }} />
              </button>
            );
          })}
        </div>
        <div className="mini-note">Basket colors are available for dots. The 7 cycling colors below (shift-click order) reference the basket.</div>
        <div className="cycle-list">
          {s.defaultColors.map((c, i) => (
            <div key={i} className="cycle-slot">
              <ColorPicker value={c} compact onChange={nc => setDefaultColor(i, nc)} label={`Cycle #${i + 1}`} />
            </div>
          ))}
        </div>
        <button className="btn small" onClick={() => set({ defaultColors: DEFAULT_COLORS.map(x => ({ ...x })) })}>Reset to defaults</button>
      </Section>

      <Section title="Note dots — shapes">
        <div className="shape-grid">
          {STANDARD_SHAPES.map(sh => {
            const selected = s.defaultShapes.includes(sh.name);
            return (
              <button key={sh.name} className={`shape-btn ${selected ? 'on' : ''}`} onClick={() => toggleShapeSelected(sh.name)} title={`${sh.name}${selected ? ' ✓ in cycle' : ''}`}>
                <svg viewBox="0 0 100 100" width="26" height="26"><g style={{ color: '#333' }} dangerouslySetInnerHTML={{ __html: sh.inner }} /></svg>
                <span>{sh.name}</span>
              </button>
            );
          })}
          {s.customShapes.map(name => {
            const selected = s.defaultShapes.includes(name);
            return (
              <div key={name} className={`shape-btn custom ${selected ? 'on' : ''}`}>
                <button className="pick" onClick={() => toggleShapeSelected(name)} title={name}>
                  <svg viewBox="0 0 100 100" width="26" height="26"><g style={{ color: '#333' }} dangerouslySetInnerHTML={{ __html: customs[name] ?? '' }} /></svg>
                  <span>{name}</span>
                </button>
                <button className="rm" onClick={() => removeCustom(name)} title="Remove custom shape">×</button>
              </div>
            );
          })}
        </div>
        <div className="mini-note">Select up to 7 shapes for the ctrl-click cycle (order = click order).</div>
        <fieldset className="add-shape">
          <legend>Add custom shape (paste SVG)</legend>
          <input className="txt" placeholder="shape name (e.g. arrow)" value={svgName} onChange={e => setSvgName(e.target.value)} />
          <textarea className="txt svgbox" rows={3} placeholder='<svg viewBox="0 0 100 100"><path d="..."/></svg>' value={svgSrc} onChange={e => setSvgSrc(e.target.value)} />
          {svgErr && <div className="err">{svgErr}</div>}
          <button className="btn small" onClick={addCustomShape}>Add shape</button>
        </fieldset>
        <label className="row"><span>Dot base size (px)</span>
          <input type="range" min={12} max={48} value={s.baseDotSize} onChange={e => set({ baseDotSize: Number(e.target.value) })} /></label>
        <label className="row"><span>Shape scale</span>
          <input type="range" min={0.4} max={1.6} step={0.05} value={s.shapeScale} onChange={e => set({ shapeScale: Number(e.target.value) })} /></label>
        <ColorPicker label="Shape default color" compact value={s.shapeDefaultColor} onChange={c => setColor('shapeDefaultColor', c)} />
      </Section>

      <Section title="Text">
        <label className="row"><span>Default font</span>
          <select value={s.defaultTextFont} onChange={e => set({ defaultTextFont: e.target.value })}>
            {FONT_OPTIONS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
          </select></label>
        <label className="row"><span>Default text size (px)</span>
          <input type="number" min={6} max={60} value={s.defaultTextSize} onChange={e => set({ defaultTextSize: Number(e.target.value) })} /></label>
        <ColorPicker label="Default text color" compact value={s.defaultTextColor} onChange={c => setColor('defaultTextColor', c)} />
        <label className="row"><span>Default text rotation</span>
          <select value={s.defaultTextRotation} onChange={e => set({ defaultTextRotation: Number(e.target.value) })}>
            {[0, 90, 180, 270].map(r => <option key={r} value={r}>{r}°</option>)}
          </select></label>
      </Section>

      <Section title="Export">
        <label className="row"><span>Scale / size multiplier</span>
          <select value={String(s.exportScale)} onChange={e => set({ exportScale: Number(e.target.value) })}>
            {[1, 2, 3, 4].map(v => <option key={v} value={v}>{v}×</option>)}
          </select></label>
        <label className="row"><span>JPG/PNG quality</span>
          <input type="range" min={30} max={100} value={Math.round(s.exportQuality * 100)} onChange={e => set({ exportQuality: Number(e.target.value) / 100 })} /></label>
      </Section>

      <button className="btn" onClick={() => onChange(structuredClone(DEFAULT_SETTINGS))}>Reset all settings</button>
    </div>
  );
}
