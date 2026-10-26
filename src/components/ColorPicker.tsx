import { useEffect, useRef, useState } from 'react';
import type { ChordColor } from '../lib/types';
// ---------- color utils ----------
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v * 255 * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

const SIZE = 150, SV_H = 104;

interface Props {
  value: ChordColor;
  onChange: (c: ChordColor) => void;
  label?: string;
  compact?: boolean;
}

/** Color wheel + saturation/value square + alpha slider + hex input. */
export default function ColorPicker({ value, onChange, label, compact }: Props) {
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const svRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(!compact);
  const [hex, setHex] = useState(value.hex);

  const init = rgbToHsv(...hexToRgb(value.hex));
  const hue = useRef(init[0]); const sat = useRef(init[1]); const val = useRef(init[2]);

  // Keep the HSV refs and hex box in sync with the incoming color so opening
  // the panel always shows the CURRENT color (previously they were initialized
  // once at mount and never re-synced after external changes such as typing a
  // hex value or picking from the color basket). Draw only when the panel is
  // open — the canvases don't exist otherwise.
  useEffect(() => {
    const t = rgbToHsv(...hexToRgb(value.hex));
    hue.current = t[0]; sat.current = t[1]; val.current = t[2];
    setHex(value.hex);
    if (open) { drawWheel(); drawSV(); }
    // eslint-disable-next-line
  }, [value.hex, open]);

  // The picker often sits inside a scrollable dialog; render the panel in
  // fixed viewport coordinates (measured from the swatch) and flip it above /
  // clamp it sideways when there isn't room below, so opening it can never
  // expand the dialog or push its own controls off-screen.
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open) { setPanelPos(null); return; }
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pw = SIZE + 34, ph = SIZE + SV_H + 110;
    let top = r.bottom + 6;
    // Flip above the swatch when there is no room below...
    if (top + ph > window.innerHeight - 8 && r.top - 6 - ph > 8) top = r.top - 6 - ph;
    // ...and if it would STILL fall off-screen (short viewports / near edges),
    // center the panel in the viewport instead of clipping it.
    if (top < 8 || top + ph > window.innerHeight - 8) {
      top = Math.max(8, (window.innerHeight - ph) / 2);
    }
    let left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - pw - 8));
    if (left + pw > window.innerWidth - 8) left = Math.max(8, (window.innerWidth - pw) / 2);
    setPanelPos({ top, left });
    // eslint-disable-next-line
  }, [open]);

  function drawWheel() {
    const c = wheelRef.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    const R = SIZE / 2;
    ctx.clearRect(0, 0, SIZE, SIZE);
    for (let a = 0; a < 360; a += 1) {
      const rad = (a * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(R, R);
      ctx.arc(R, R, R - 2, rad, rad + 0.02);
      ctx.closePath();
      const [r, g, b] = hsvToRgb(a / 360, 1, 1);
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
    // punch hole
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(R, R, R - 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // marker
    const [r2, g2, b2] = hsvToRgb(hue.current, 1, 1);
    ctx.fillStyle = `rgb(${r2},${g2},${b2})`;
    ctx.strokeStyle = '#fff';
    const mr = R - 11;
    const mx = R + mr * Math.cos(hue.current * Math.PI * 2);
    const my = R + mr * Math.sin(hue.current * Math.PI * 2);
    ctx.beginPath(); ctx.arc(mx, my, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  function drawSV() {
    const c = svRef.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    const W = SIZE, H = SV_H;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [r, g, b] = hsvToRgb(hue.current, x / W, 1 - y / H);
        const i = (y * W + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // marker
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(sat.current * W, (1 - val.current) * H, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.arc(sat.current * W, (1 - val.current) * H, 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  function emit() {
    const [r, g, b] = hsvToRgb(hue.current, sat.current, val.current);
    const hx = rgbToHex(r, g, b);
    setHex(hx);
    onChange({ hex: hx, alpha: value.alpha });
  }

  function wheelPointer(e: React.PointerEvent) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const cx = rect.left + SIZE / 2, cy = rect.top + SIZE / 2;
    const ang = Math.atan2(e.clientY - cy, e.clientX - cx);
    hue.current = ((ang / (Math.PI * 2)) + 1) % 1;
    drawWheel(); drawSV(); emit();
  }
  function svPointer(e: React.PointerEvent) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    sat.current = Math.max(0, Math.min(1, (e.clientX - rect.left) / SIZE));
    val.current = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / SV_H));
    drawSV(); emit();
  }

  const swatchStyle: React.CSSProperties = {
    background: `linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,#fff 25%,#fff 75%,#ccc 75%)`,
    backgroundSize: '8px 8px', backgroundPosition: '0 0,4px 4px',
    position: 'relative', width: 26, height: 26, borderRadius: 4, border: '1px solid #999', cursor: 'pointer', flexShrink: 0,
  };

  return (
    <div className="colorpicker" ref={rootRef}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {label && <span className="cp-label">{label}</span>}
        <div style={swatchStyle} onClick={() => setOpen(o => !o)} title="Pick color">
          <div style={{ position: 'absolute', inset: 1, borderRadius: 3, backgroundColor: value.hex, opacity: value.alpha }} />
        </div>
        <input
          className="txt txt-hex"
          value={hex}
          onChange={e => {
            const t = e.target.value;
            setHex(t);
            if (/^#[0-9a-fA-F]{6}$/.test(t)) onChange({ hex: t, alpha: value.alpha });
          }}
          size={7}
        />
        <span className="mini">{Math.round(value.alpha * 100)}%</span>
      </div>
      {open && (
        <div className="cp-panel" style={{ position: 'fixed', top: panelPos?.top ?? -9999, left: panelPos?.left ?? -9999 }}>
          <canvas ref={wheelRef} width={SIZE} height={SIZE}
            onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); wheelPointer(e); }}
            onPointerMove={e => { if (e.buttons) wheelPointer(e); }} />
          <canvas ref={svRef} width={SIZE} height={SV_H} style={{ borderRadius: 4, cursor: 'crosshair' }}
            onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); svPointer(e); }}
            onPointerMove={e => { if (e.buttons) svPointer(e); }} />
          <label className="row">
            <span>Transparency</span>
            <input type="range" min={0} max={100} value={Math.round(value.alpha * 100)}
              onChange={e => onChange({ hex: value.hex, alpha: Number(e.target.value) / 100 })} />
          </label>
          <button className="btn small" onClick={() => setOpen(false)}>Done</button>
        </div>
      )}
    </div>
  );
}
