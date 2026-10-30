import { useEffect, useRef, useState } from 'react';
import type { ChordColor, Margins, Settings } from '../lib/types';
import { BOARD_SCALE_MIN, BOARD_SCALE_MAX, DOT_SIZE_MIN, DOT_SIZE_MAX, SHAPE_SCALE_MIN, SHAPE_SCALE_MAX, MIN_NUM_FRETS, clampNumFrets, nutShown } from '../lib/types';
import { BASKET_COLORS, DEFAULT_COLORS, DEFAULT_SETTINGS } from '../lib/storage';
import { STANDARD_SHAPES, sanitizeSvgInput } from '../lib/shapes';
import { FONT_OPTIONS } from '../lib/render';
import { midiToName, TUNING_PRESETS } from '../lib/music';
import ColorPicker from './ColorPicker';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  customs: Record<string, string>;
  onCustomsChange: (c: Record<string, string>) => void;
  /** When set, the panel edits ONE chord's layout patch (multi-chord page mode). */
  chordMode?: boolean;
  /** Extra actions rendered at the top of the per-chord panel (copy/paste settings). */
  extraActions?: React.ReactNode;
  /** Global (non-per-chord) settings — the fretboard scale lives here so it
   *  applies to EVERY chord on every page. Provided together with
   *  onGlobalChange when the app is in per-chord editing mode. */
  globalSettings?: Settings;
  onGlobalChange?: (s: Settings) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <details className="section"><summary>{title}</summary><div className="sec-body">{children}</div></details>;
}

/**
 * Range slider with fine control + commit-on-Enter number field.
 * - Dragging the slider uses `step` (coarse). Holding Shift while dragging or
 *   pressing arrow keys uses `fineStep` (e.g. 0.1% of a scale value); holding
 *   Ctrl/Cmd uses `finestStep` (0.01). Keyboard arrows always move by the
 *   active step instead of the browser default.
 * - The numeric readout is an editable text box: typing does NOT apply live —
 *   the parsed value is clamped and committed on Enter/blur only (Esc cancels).
 */
function SliderRow({ label, min, max, step = 1, fineStep, finestStep, value, format, onChange }: {
  label: React.ReactNode;
  min: number; max: number; step?: number; fineStep?: number; finestStep?: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const fs = fineStep ?? step / 10;
  const ffs = finestStep ?? step / 100;
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  // Decimal-clean quantize (avoids 0.30000000000000004 artifacts) keeping at
  // most 4 decimals so fine values like 0.735 survive round-trips.
  const q = (v: number) => Math.round(v * 1e4) / 1e4;
  const snap = (v: number, s: number) => q(clamp(Math.round(v / s) * s));
  // keep float precision tidy (0.1+0.2 artifacts)
  const fix = (v: number) => Number(v.toFixed(6));
  // Live mirror of the modifier state while dragging. Native range inputs
  // ignore Shift/Ctrl during mouse drags, so we track the keys globally and
  // re-quantize every drag value to the active fine step ourselves.
  const modRef = useRef<{ shift: boolean; ctrl: boolean }>({ shift: false, ctrl: false });
  useEffect(() => {
    const read = (e: KeyboardEvent | MouseEvent) => { modRef.current = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }; };
    const clear = () => { modRef.current = { shift: false, ctrl: false }; };
    window.addEventListener('keydown', read);
    window.addEventListener('keyup', read);
    window.addEventListener('mousedown', read);
    window.addEventListener('mousemove', read);   // modifiers can toggle mid-drag
    window.addEventListener('mouseup', clear);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', read);
      window.removeEventListener('keyup', read);
      window.removeEventListener('mousedown', read);
      window.removeEventListener('mousemove', read);
      window.removeEventListener('mouseup', clear);
      window.removeEventListener('blur', clear);
    };
  }, []);
  // The committed value is authoritative — display it verbatim even when it
  // does not sit on the coarse slider step, so typed/fine values visibly
  // "stick" instead of snapping back to the nearest whole percent.
  const disp = (v: number) => String(q(v)).replace(/\.0$/, '');
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? disp(value);
  const commitText = () => {
    if (text === null) return;
    let t = text.trim().replace(',', '.');
    const pct = t.endsWith('%');
    if (pct) t = t.slice(0, -1).trim();
    const n = Number(t);
    setText(null);
    if (!Number.isFinite(n)) return;
    // A "%" suffix always means percent of the full scale regardless of how
    // the readout is formatted: typing "85%" into a 0..1 scale box stores 0.85.
    if (pct && max <= 3) { onChange(fix(clamp(n / 100))); return; }
    onChange(fix(clamp(n)));
  };
  const keyAdjust = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Override the native range-key behavior so Shift/Ctrl give sub-step resolution.
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const dir = (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 1 : -1;
    const s = e.ctrlKey || e.metaKey ? ffs : e.shiftKey ? fs : step;
    onChange(fix(snap(value + dir * s, s)));
  };
  return <div className="row"><span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onKeyDown={keyAdjust}
      onChange={e => {
        const raw = Number(e.target.value);
        const m = modRef.current;
        const s = m.shift ? fs : m.ctrl ? ffs : step;
        onChange(fix(snap(raw, s)));
      }} />
    <input type="text" className="num-edit" style={{ width: 56, fontSize: 11, flexShrink: 0 }} value={shown}
      onFocus={() => setText(disp(value))}
      onChange={e => setText(e.target.value)}
      onBlur={commitText}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commitText(); }
        else if (e.key === 'Escape') setText(null);
      }}
      title="Click to edit: type an exact value (or 85%) and press Enter to apply. Slider: hold Shift for fine steps, Ctrl for the finest." />
  </div>;
}

export default function SettingsPanel({ settings, onChange, customs, onCustomsChange, chordMode, extraActions, globalSettings, onGlobalChange }: Props) {
  const s = settings;
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });
  // Fretboard scale is GLOBAL — even while editing one chord's patch, these
  // sliders write to the app-wide settings so all boards resize together.
  const gs = globalSettings ?? s;
  const setGlobal = (patch: Partial<Settings>) => (onGlobalChange ?? onChange)({ ...gs, ...patch });
  // Read a GLOBAL-only value from the true global settings even while the
  // panel shows a chord's merged view (those keys are force-overridden by the
  // globals anyway — see applyGlobalSettings).
  const gOf = <K extends keyof Settings>(k: K): Settings[K] => (gs[k] ?? s[k]) as Settings[K];
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
      {chordMode && <div className="mini-note chord-mode-note">Editing layout of the <b>selected chord</b>. Every chord keeps its own settings — use Copy/Paste below to transfer them.</div>}
      {extraActions && <div className="chord-actions">{extraActions}</div>}
      <Section title="Fretboard geometry">
        <label className="row"><span>Frets displayed</span>
          <input type="number" min={MIN_NUM_FRETS} max={27} value={s.numFrets} onChange={e => set({ numFrets: clampNumFrets(Number(e.target.value)) })} /></label>
        <div className="mini-note">At least {MIN_NUM_FRETS} frets are always displayed.</div>
        <label className="row"><span>Starting fret</span>
          <input type="number" min={1} max={24} value={s.startFret} onChange={e => set({ startFret: Math.max(1, Math.min(24, Math.round(Number(e.target.value) || 1))) })} /></label>
        <div className="mini-note">The nut is shown only when the starting fret is 1; higher starting frets hide it automatically.</div>
        <label className="row"><span>Orientation</span>
          <select value={s.orientation} onChange={e => set({ orientation: e.target.value as Settings['orientation'] })}>
            <option value="vertical">Vertical (classic chord box)</option>
            <option value="horizontal">Horizontal (fretboard)</option>
          </select></label>
        <label className="row"><span>Flip fretboard along (nut side)</span>
          <select value={s.flipAlong ? 'far' : 'near'} onChange={e => set({ flipAlong: e.target.value === 'far', fingeringsLeft: e.target.value !== 'far' })}>
            <option value="near">Nut at top / left (frets grow down / right)</option>
            <option value="far">Nut at bottom / right (mirrored, frets grow up / left)</option>
          </select></label>
        <label className="row check"><input type="checkbox" checked={s.flipAcross} onChange={e => set({ flipAcross: e.target.checked })} /><span>Flip fret numbers across — mirror bass/treble order</span></label>
        <label className="row check"><input type="checkbox" checked={s.reverseStrings} onChange={e => set({ reverseStrings: e.target.checked })} /><span>Reverse string order (6 5 4 3 2 1) — left-handed layout</span></label>
        <div className="mini-note">Both flips mirror the whole drawing (nut, taper, spacing, dots and labels together); the board stays centered in the canvas. Reversing string order swaps the physical positions of the strings (low E ↔ high e); gauges, pitch labels, fingering labels, note dots and click hit-testing all follow the same layout.</div>
        <div className="row"><span>Canvas padding (px)</span></div>
        <div className="margins-grid">
          {(['top', 'right', 'bottom', 'left'] as const).map(side => (
            <label key={side} className="row compact"><span>{side}</span>
              <input type="number" min={0} max={240} value={s.margins[side]}
                onChange={e => set({ margins: { ...s.margins, [side]: Math.max(0, Math.min(240, Number(e.target.value) || 0)) } as Margins })} /></label>
          ))}
        </div>
        <button className="btn small" onClick={() => {
          const v = s.margins.top;
          set({ margins: { top: v, right: v, bottom: v, left: v } });
        }}>Apply top value to all sides</button>
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
        <div className="row"><span>Fretboard scale <em style={{ fontWeight: 400, fontSize: 10 }}>(global — all chords)</em></span></div>
        <SliderRow label="Board length (along frets)" min={BOARD_SCALE_MIN} max={BOARD_SCALE_MAX} step={0.01} fineStep={0.001} finestStep={0.0005}
          value={gs.boardLengthScale} format={v => `${Math.round(v * 10000) / 100}%`}
          onChange={v => setGlobal({ boardLengthScale: v })} />
        <SliderRow label="Board width (across strings)" min={BOARD_SCALE_MIN} max={BOARD_SCALE_MAX} step={0.01} fineStep={0.001} finestStep={0.0005}
          value={gs.boardWidthScale} format={v => `${Math.round(v * 10000) / 100}%`}
          onChange={v => setGlobal({ boardWidthScale: v })} />
        <div className="mini-note">Stretches or squashes the fretboard rectangle along each axis (respects orientation). This is a GLOBAL setting applied before drawing — every chord on every page resizes together; dots, frets, nut and labels keep their relative positions and text stays undistorted. Hold Shift while dragging/arrowing for 1% steps, Ctrl for 0.1%; type an exact % in the box and press Enter to apply.</div>
        <button className="btn small" onClick={() => setGlobal({ boardLengthScale: 1, boardWidthScale: 1 })}>⟲ Reset fretboard scale</button>
      </Section>

      <Section title="Regions (lassos)">
        <div className="mini-note">Closed spline regions drawn around groups of dots. Hold <b>Ctrl+Shift</b> and click to start a curve, keep the keys held and click again to add more points — release the keys (or press Enter) to close it smoothly and pick its colors. The <b>◌ Region</b> tool (key 5) also freehand-draws with click-drag.</div>
        <SliderRow label={<span>Default smoothing <em style={{ fontWeight: 400, fontSize: 10 }}>(global — new curves)</em></span>} min={0} max={1} step={0.01} fineStep={0.05} finestStep={0.01}
          value={gOf('regionSmoothing')} format={v => `${Math.round(v * 100)}%`}
          onChange={v => setGlobal({ regionSmoothing: v })} />
        <div className="mini-note">Spline tension applied to NEWLY created curves (0 = angular polyline, 1 = maximally round). Each region keeps its own value once set — tweak it later via the style dialog or by selecting the region.</div>
        <label className="row"><span>New-region fill alpha</span>
          <input type="range" min={0.05} max={1} step={0.05} value={gs.regionFillAlpha ?? 0.75} onChange={e => setGlobal({ regionFillAlpha: Number(e.target.value) })} /><b style={{ fontSize: 11 }}>{Math.round((gs.regionFillAlpha ?? 0.75) * 100)}%</b></label>
        <label className="row"><span>Border follows fill color</span>
          <input type="checkbox" checked={!!gs.regionBorderColorFollows} onChange={e => setGlobal({ regionBorderColorFollows: e.target.checked })} /></label>
        <div className="mini-note">When ON, a new region's border uses the fill's hue at full opacity (the boundary is always opaque so edges read distinctly from the wash inside).</div>
      </Section>

      <Section title="Nut, taper & fret spacing">
        <div className="mini-note">The nut shows automatically when the starting fret is 1 — higher starting frets sit mid-neck and hide it. Open-string dots float before the first fret line; strings never extend past the starting fret or the last fret.</div>
        <label className="row"><span>Show nut{nutShown(s) ? '' : ' (hidden — start at fret 1 to show)'}</span>
          <input type="checkbox" checked={nutShown(s)} disabled title="The nut follows the starting fret automatically: shown only when the starting fret is 1" /></label>
        <label className="row"><span>Nut width (px)</span>
          <input type="range" min={2} max={20} value={s.nutWidth} onChange={e => set({ nutWidth: Number(e.target.value) })} disabled={!nutShown(s)} /><b style={{ fontSize: 11 }}>{s.nutWidth}</b></label>
        <label className="row"><span>Fret thickness (px)</span>
          <input type="range" min={0.5} max={10} step={0.5} value={s.fretThickness} onChange={e => set({ fretThickness: Number(e.target.value) })} /><b style={{ fontSize: 11 }}>{s.fretThickness}</b></label>
        <div className="mini-note">Fret-wire stroke used for every fret line — small values look like thin/vintage frets, larger ones like medium/jumbo frets.</div>
        <label className="row"><span>Fretboard taper</span>
          <input type="range" min={0} max={100} value={Math.round(s.boardTaper * 100)} onChange={e => set({ boardTaper: Number(e.target.value) / 100 })} /><b style={{ fontSize: 11 }}>{Math.round(s.boardTaper * 100)}%</b></label>
        <div className="mini-note">Taper follows real guitar geometry: the nut end is the NARROWEST point of the board and it gets WIDER toward the higher frets (never narrower). 0% ⇒ constant width; higher ⇒ wider trapezoid at the high-fret end.</div>
        <label className="row"><span>Taper reference</span>
          <select value={s.taperMode} onChange={e => set({ taperMode: e.target.value as Settings['taperMode'] })}>
            <option value="relative">Relative — same shape for any starting fret</option>
            <option value="absolute">Absolute — follows real fret numbers</option>
          </select></label>
        <div className="mini-note">Relative mode maps the taper across exactly the displayed slots, so changing the starting fret keeps the trapezoid IDENTICAL. Absolute mode uses the real fret positions (fret 12 is always the widest), so the shape changes with the starting fret — like looking at different parts of a real neck.</div>
        <label className="row"><span>Fret numbers</span>
          <select value={s.fretLabels} onChange={e => set({ fretLabels: e.target.value as Settings['fretLabels'] })}>
            <option value="all">Show all</option>
            <option value="none">Hide (none)</option>
            <option value="custom">Custom range…</option>
          </select></label>
        {s.fretLabels === 'custom' && <>
          <label className="row"><span>Which frets</span>
            <input className="txt" placeholder="e.g. 3-5, 8, 12  (or: all)" value={s.fretLabelList} onChange={e => set({ fretLabelList: e.target.value })} /></label>
          <div className="mini-note">Page-style list: single numbers, ranges with “-“, or “all”. Only frets inside the displayed range appear.</div>
        </>}
        <label className="row check"><input type="checkbox" checked={s.openNoteLabels !== false} onChange={e => set({ openNoteLabels: e.target.checked })} /><span>Show open-string note labels (pitch names beside the strings)</span></label>
        <label className="row"><span>Open string pitches side</span>
          <select value={s.openSide} onChange={e => set({ openSide: e.target.value as Settings['openSide'] })} disabled={!s.openNoteLabels}>
            <option value="nut">At the nut end</option>
            <option value="far">At the opposite end</option>
          </select></label>
        <label className="row"><span>Open label offset (px)</span>
          <input type="range" min={0} max={160} value={s.openNoteOffset ?? 0} disabled={!s.openNoteLabels}
            onChange={e => set({ openNoteOffset: Number(e.target.value) })} /><b style={{ fontSize: 11 }}>{s.openNoteOffset ?? 0}</b></label>
        <div className="mini-note">The ring shows the actual pitch names computed from the tuning (they update live when you change a tuning preset). Increase the offset if the labels overlap the open-position note dots.</div>
        <label className="row"><span>Fret line length (%)</span>
          <input type="range" min={50} max={150} value={s.fretWidthPct ?? 100}
            onChange={e => set({ fretWidthPct: Number(e.target.value) })} /><b style={{ fontSize: 11 }}>{s.fretWidthPct ?? 100}%</b></label>
        <div className="mini-note">Length of every fret line across the board. 100% ⇒ frets span the full taper width, edge to edge (this also scales with the taper).</div>
        <label className="row"><span>Fret spacing mode</span>
          <select value={s.spacing} onChange={e => set({ spacing: e.target.value as Settings['spacing'] })}>
            <option value="equal">Equal</option>
            <option value="logarithmic">Logarithmic (real guitar)</option>
          </select></label>
        {s.spacing === 'logarithmic' && <>
          <label className="row"><span>First fret size (px)</span>
            <input type="number" min={8} max={200} value={s.firstFretSize} onChange={e => {
              const v = Math.max(8, Number(e.target.value) || 8);
              set({ firstFretSize: v, lastFretSize: Math.min(s.lastFretSize, v) });
            }} /></label>
          <label className="row"><span>Last fret size (px)</span>
            <input type="number" min={4} max={Math.min(200, s.firstFretSize)} value={s.lastFretSize} onChange={e => {
              const v = Math.max(4, Math.min(s.firstFretSize, Number(e.target.value) || 4));
              set({ lastFretSize: v });
            }} /></label>
          <div className="mini-note">Slot widths shrink geometrically from the first to the last displayed fret — like a real guitar. The last fret size can never exceed the first one.</div>
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

      <Section title="Note pitches & tuning">
        <label className="row check"><input type="checkbox" checked={s.noteVisible} onChange={e => set({ noteVisible: e.target.checked })} /><span>Note visible mode — auto-label every dot with its pitch</span></label>
        <div className="mini-note">When enabled, each note dot automatically shows the pitch computed from the string tuning and its offset into the string (relative fret, based on the starting fret) — no manual typing needed. A manually typed dot text always overrides the automatic pitch.</div>
        <label className="row check"><input type="checkbox" checked={s.mirrorOctaves === true} onChange={e => set({ mirrorOctaves: e.target.checked })} /><span>Mirror across octaves on same string — extend every dot to fret ±12·k (k = -5..5)</span></label>
        <div className="mini-note">Per-chord switch, exactly like 8va: it follows the “All Chords / Selected” scope toggle — with 🌐 All chords ON, flipping it here applies the mirroring behaviour to EVERY chord on every page and the library. It is ALWAYS enableable — even while 8va is on (the flag simply stays redundant until 8va is switched off). Mirror mode also survives transposes: an octave-WRAPPED transpose re-extends the ±12·k copies instead of dropping everything past the first octave. {s.octaveMode
          ? 'While 8va (octave mode) is ON it changes nothing visible — octave mode already spreads every pitch across all octave positions.'
          : 'Fine-grained octave extension: whatever you place between frets 0–11 also appears at +12·k on the SAME string (and vice versa). Adding, removing, or editing any dot property (color, shape, text…) applies to every mirrored twin too, so high-fret layouts need half the work.'}</div>
        <label className="row"><span>Tuning preset</span>
          <select value="" onChange={e => {
            const p = TUNING_PRESETS.find(x => x.name === e.target.value);
            if (p) set({ tuning: [...p.values] });
          }}>
            <option value="">Choose a preset…</option>
            {TUNING_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select></label>
        <div className="margins-grid">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <label key={i} className="row compact"><span>{['1-e', '2-B', '3-G', '4-D', '5-A', '6-E'][i]} · {midiToName(s.tuning[i] ?? 60, s.preferFlats)}</span>
              <input type="number" min={24} max={96} value={s.tuning[i] ?? 60}
                onChange={e => {
                  const t = [...s.tuning];
                  t[i] = Math.max(24, Math.min(96, Math.round(Number(e.target.value) || t[i] || 60)));
                  set({ tuning: t });
                }} /></label>
          ))}
        </div>
        <div className="mini-note">Open-string pitches as MIDI numbers (E2 = 40 … e4 = 64 for standard tuning), listed high e → low E.</div>
        <label className="row check"><input type="checkbox" checked={s.preferFlats} onChange={e => set({ preferFlats: e.target.checked })} /><span>Spell pitches with flats (Bb) instead of sharps (A#)</span></label>
        <ColorPicker label="Pitch label color" compact value={s.dotTextColor} onChange={c => setColor('dotTextColor', c)} />
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
        <SliderRow label={<span>Dot base size (px) <em style={{ fontWeight: 400, fontSize: 10 }}>(global — all chords)</em></span>}
          min={DOT_SIZE_MIN} max={DOT_SIZE_MAX} step={1} fineStep={0.5} finestStep={0.1}
          value={gOf('baseDotSize')} format={v => `${v}`}
          onChange={v => setGlobal({ baseDotSize: v })} />
        <SliderRow label={<span>Shape scale <em style={{ fontWeight: 400, fontSize: 10 }}>(global — all chords)</em></span>}
          min={SHAPE_SCALE_MIN} max={SHAPE_SCALE_MAX} step={0.01} fineStep={0.001} finestStep={0.0005}
          value={gOf('shapeScale')} format={v => `${Math.round(v * 10000) / 100}%`}
          onChange={v => setGlobal({ shapeScale: v })} />
        <div className="mini-note">These two are GLOBAL: every note dot on EVERY chord resizes together — the change is pushed to all created chords immediately. Hold Shift for 1% steps, Ctrl for 0.1%; type an exact value and press Enter.</div>
        <ColorPicker label="Shape default color" compact value={s.shapeDefaultColor} onChange={c => setColor('shapeDefaultColor', c)} />
      </Section>

      <Section title="Text">
        <div className="mini-note">Font, size and rotation are GLOBAL defaults: items that don't carry their own override follow them live on EVERY chord (the change is pushed to all created chords). Color stays a default for newly added text.</div>
        <label className="row"><span>Default font <em style={{ fontWeight: 400, fontSize: 10 }}>(global — all chords)</em></span>
          <select value={gOf('defaultTextFont')} onChange={e => setGlobal({ defaultTextFont: e.target.value })}>
            {FONT_OPTIONS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
          </select></label>
        <label className="row"><span>Default text size (px) <em style={{ fontWeight: 400, fontSize: 10 }}>(global — all chords)</em></span>
          <input type="number" min={6} max={60} value={gOf('defaultTextSize')} onChange={e => setGlobal({ defaultTextSize: Math.max(6, Math.min(60, Math.round(Number(e.target.value) || 6))) })} /></label>
        <ColorPicker label="Default text color" compact value={gs.defaultTextColor ?? s.defaultTextColor} onChange={c => setGlobal({ defaultTextColor: c })} />
        <label className="row"><span>Default text rotation <em style={{ fontWeight: 400, fontSize: 10 }}>(global — all chords)</em></span>
          <select value={gOf('defaultTextRotation')} onChange={e => setGlobal({ defaultTextRotation: Number(e.target.value) })}>
            {[0, 90, 180, 270].map(r => <option key={r} value={r}>{r}°</option>)}
          </select></label>
      </Section>

      {chordMode ? null : <Section title="Export">
        <label className="row"><span>Scale / size multiplier</span>
          <select value={String(s.exportScale)} onChange={e => set({ exportScale: Number(e.target.value) })}>
            {[1, 2, 3, 4].map(v => <option key={v} value={v}>{v}×</option>)}
          </select></label>
        <label className="row"><span>JPG/PNG quality</span>
          <input type="range" min={30} max={100} value={Math.round(s.exportQuality * 100)} onChange={e => set({ exportQuality: Number(e.target.value) / 100 })} /></label>
      </Section>}

      {!chordMode && <button className="btn" onClick={() => onChange(structuredClone(DEFAULT_SETTINGS))}>Reset all settings</button>}
    </div>
  );
}
