// ---------- Shape library (SVG paths on a 0..100 box, centered at 50,50) ----------

export interface ShapeDef {
  name: string;
  /** svg inner markup drawn inside a viewBox="0 0 100 100" */
  inner: string; // uses fill="currentColor" so we can tint it
}

function poly(points: [number, number][]): string {
  return `<polygon points="${points.map(p => p.join(',')).join(' ')}" fill="currentColor"/>`;
}
function polar(n: number, r: number, rotDeg = -90): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = ((rotDeg + (360 / n) * i) * Math.PI) / 180;
    pts.push([+(50 + r * Math.cos(a)).toFixed(2), +(50 + r * Math.sin(a)).toFixed(2)]);
  }
  return pts;
}
function starPts(outer: number, inner: number, n: number, rotDeg = -90): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((rotDeg + (180 / n) * i) * Math.PI) / 180;
    pts.push([+(50 + r * Math.cos(a)).toFixed(2), +(50 + r * Math.sin(a)).toFixed(2)]);
  }
  return pts;
}

export const STANDARD_SHAPES: ShapeDef[] = [
  { name: 'circle', inner: '<circle cx="50" cy="50" r="48" fill="currentColor"/>' },
  { name: 'square', inner: '<rect x="4" y="4" width="92" height="92" fill="currentColor"/>' },
  { name: 'diamond', inner: '<polygon points="50,2 98,50 50,98 2,50" fill="currentColor"/>' },
  { name: 'triangle', inner: '<polygon points="50,4 96,90 4,90" fill="currentColor"/>' },
  { name: 'pentagon', inner: poly(polar(5, 48)) },
  { name: 'hexagon', inner: poly(polar(6, 48, -90)) },
  { name: 'octagon', inner: poly(polar(8, 48, -22.5)) },
  { name: 'star', inner: poly(starPts(48, 20, 5)) },
  { name: 'oval', inner: '<ellipse cx="50" cy="50" rx="48" ry="32" fill="currentColor"/>' },
  { name: 'heart', inner: '<path d="M50 88 C 20 62 4 42 12 24 C 19 9 38 10 50 26 C 62 10 81 9 88 24 C 96 42 80 62 50 88 Z" fill="currentColor"/>' },
  { name: 'cross', inner: '<path d="M38 4 H62 V38 H96 V62 H62 V96 H38 V62 H4 V38 H38 Z" fill="currentColor"/>' },
  { name: 'flag', inner: '<path d="M14 4 V96 H22 V60 H86 L72 40 L86 20 H14 Z" fill="currentColor"/>' },
];

/** Validate user SVG input and extract drawable content. Returns sanitized inner markup or null. */
export function sanitizeSvgInput(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  // strip wrapping <svg ...> tags
  const m = s.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
  if (m) s = m[1];
  // must contain at least one drawable element
  if (!/<(path|circle|rect|ellipse|polygon|polyline|line)\b/i.test(s)) return null;
  // no scripts / event handlers
  if (/<script|on\w+\s*=/i.test(s)) return null;
  // normalize colors to currentColor so shape follows dot color
  s = s.replace(/(fill|stroke)\s*=\s*"(?!none)[^"]*"/gi, '$1="currentColor"');
  s = s.replace(/(fill|stroke)\s*=\s*'(?!none)[^']*'/gi, "$1='currentColor'");
  return s;
}

export function shapeInner(name: string, customs: Record<string, string>): string {
  const std = STANDARD_SHAPES.find(x => x.name === name);
  if (std) return std.inner;
  return customs[name] ?? STANDARD_SHAPES[0].inner;
}
