import { build } from 'esbuild';
const res = await build({
  entryPoints: ['src/lib/render.ts'],
  bundle: true, format: 'esm', write: false,
});
const code = res.outputFiles[0].text;
const mod = await import('data:text/javascript,' + encodeURIComponent(code));
const { renderSvg } = mod;

function mkSettings(over = {}) {
  return {
    numFrets: 5, startFret: 1, orientation: 'vertical', flipAlong: false, flipAcross: false,
    reverseStrings: false, fretThickness: 2.5,
    fretSpacing: 46, stringGap: 36, stringWidthMode: 'progressive', minStringWidth: 1.2, maxStringWidth: 3.6,
    nutWidth: 7, boardTaper: 0.35, fretLabels: 'all', fretLabelList: '', openSide: 'nut',
    margins: { top: 70, right: 70, bottom: 70, left: 70 },
    spacing: 'equal', firstFretSize: 52, lastFretSize: 30, showDots: true,
    dotMarkerColor: { hex: '#c8bcd0', alpha: 0.9 }, bgFill: { hex: '#ffffff', alpha: 1 },
    fretColor: { hex: '#4a4a4a', alpha: 1 }, stringColor: { hex: '#8d8d8d', alpha: 1 },
    baseDotSize: 26, colors: [{ hex: '#e6194b', alpha: 1 }], defaultColors: [{ hex: '#e6194b', alpha: 1 }],
    standardShapes: ['circle', 'square'], customShapes: [], defaultShapes: ['circle'], shapeDefaultColor: { hex: '#000', alpha: 1 },
    shapeScale: 1, defaultTextFont: 'Arial', defaultTextColor: { hex: '#fff', alpha: 1 }, defaultTextSize: 14, defaultTextRotation: 0,
    fingeringsLeft: true, exportScale: 2, exportQuality: 0.92, ...over,
  };
}
const doc = { name: 'Em', dots: [], texts: [], fingerings: [] };

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + msg); if (!cond) fails++; };

// ---- 1. Taper direction FIXED: narrow at nut end, WIDER toward higher frets
{
  const s = mkSettings({ boardTaper: 0.6, startFret: 1, numFrets: 12, orientation: 'horizontal' });
  const svg = renderSvg(doc, s, {});
  const poly = svg.match(/<polygon points="([^"]+)"/)[1].trim().split(/\s+/).map(p => p.split(',').map(Number));
  const n = poly.length / 2; // horizontal: across axis = y
  const wStart = Math.abs(poly[0][1] - poly[poly.length - 1][1]);
  const wEnd = Math.abs(poly[n - 1][1] - poly[n][1]);
  ok(wEnd > wStart + 1, `taper grows toward high frets (nut end ${wStart.toFixed(1)} < far end ${wEnd.toFixed(1)})`);
  // taper 0 ⇒ constant width
  const s0 = mkSettings({ boardTaper: 0, startFret: 1, numFrets: 12, orientation: 'horizontal' });
  const poly0 = renderSvg(doc, s0, {}).match(/<polygon points="([^"]+)"/)[1].trim().split(/\s+/).map(p => p.split(',').map(Number));
  const n0 = poly0.length / 2;
  const w0a = Math.abs(poly0[0][1] - poly0[poly0.length - 1][1]);
  const w0b = Math.abs(poly0[n0 - 1][1] - poly0[n0][1]);
  ok(Math.abs(w0a - w0b) < 0.5, `taper 0% ⇒ constant width (${w0a.toFixed(1)} ≈ ${w0b.toFixed(1)})`);
}

// ---- 2. Nut only when startFret === 1
{
  const withNut = renderSvg(doc, mkSettings({ startFret: 1 }), {});
  ok(withNut.includes('#f2ead8'), 'nut drawn when startFret=1');
  for (const sf of [2, 5, 12]) {
    ok(!renderSvg(doc, mkSettings({ startFret: sf })).includes('#f2ead8'), `no nut when startFret=${sf}`);
  }
}

// ---- 3. Strings never extend past the starting fret NOR past the last fret line
for (const startFret of [1, 5]) {
  for (const orientation of ['vertical', 'horizontal']) {
    for (const flipAlong of [false, true]) {
      const s = mkSettings({ orientation, flipAlong, startFret, numFrets: 5, fretSpacing: 46, fretThickness: 2 });
      const svg = renderSvg(doc, s, {});
      const fretLines = [...svg.matchAll(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)" stroke="#4a4a4aff" stroke-width="2.00"/g)];
      const strLines = [...svg.matchAll(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)" stroke="#8d8d8dff"/g)];
      ok(fretLines.length === 6 && strLines.length === 6, `${orientation}/flip${flipAlong}/sf${startFret}: found ${fretLines.length} fret & ${strLines.length} string lines`);
      // along-axis coordinate of a segment's endpoints (vertical board: y grows toward higher frets)
      const alongOf = m => {
        const a = orientation === 'vertical' ? +m[2] : +m[1];
        const b = orientation === 'vertical' ? +m[4] : +m[3];
        return [Math.min(a, b), Math.max(a, b)];
      };
      const fretSegs = fretLines.map(alongOf);
      const strSegs = strLines.map(alongOf);
      const fretMin = Math.min(...fretSegs.map(sg => sg[0]));
      const fretMax = Math.max(...fretSegs.map(sg => sg[1]));
      const strMin = Math.min(...strSegs.map(sg => sg[0]));
      const strMax = Math.max(...strSegs.map(sg => sg[1]));
      const tol = 0.35 + (startFret === 1 ? s.nutWidth / 2 + 0.1 : 0);
      ok(strMax <= fretMax + tol && strMin >= fretMin - tol,
        `${orientation}/flip${flipAlong}/sf${startFret}: strings within fret range (strings ${strMin.toFixed(1)}..${strMax.toFixed(1)}, frets ${fretMin.toFixed(1)}..${fretMax.toFixed(1)})`);
    }
  }
}

// ---- 4. Fret thickness setting applies to fret lines
{
  const svgThin = renderSvg(doc, mkSettings({ fretThickness: 1 }), {});
  const svgJumbo = renderSvg(doc, mkSettings({ fretThickness: 6 }), {});
  ok(svgThin.includes(`stroke="#4a4a4aff" stroke-width="1.00`), 'fret thickness 1px applied');
  ok(svgJumbo.includes(`stroke="#4a4a4aff" stroke-width="6.00`), 'fret thickness 6px (jumbo) applied');
}

// ---- 5. Reverse string order consistency (string layout mirrored, widths travel with strings)
{
  const { stringLayout, project, hitTest, cellCenter } = mod;
  const s = mkSettings({});
  const r = mkSettings({ reverseStrings: true });
  const lay = stringLayout(s), layR = stringLayout(r);
  let good = true;
  for (let i = 0; i < 6; i++) {
    const j = 5 - i;
    if (Math.abs(lay[i].offset + lay[j].offset) > 1e-9) good = false;       // mirrored positions
    if (Math.abs(layR[i].offset + lay[j].offset) > 1e-9) good = false;      // reversed: string i sits where old string j sat
    if (Math.abs(layR[i].width - lay[i].width) > 1e-9) good = false;         // gauge travels with its string
  }
  ok(good, 'reverseStrings mirrors positions and keeps gauges with their strings');
  // the rendered string lines must swap across the center line when reversed
  const svgN = renderSvg(doc, s, {});
  const svgR2 = renderSvg(doc, r, {});
  const xs = re => [...svgN.matchAll(re)].map(m => +m[1]);
  const xsR = [...svgR2.matchAll(/<line x1="([\d.]+)" y1="[\d.]+" x2="[\d.]+" y2="[\d.]+" stroke="#8d8d8dff"/g)].map(m => +m[1]);
  const cx = mod.canvasSize(s).w / 2;
  const swapped = xsR.every((x, i) => Math.abs(x - (2 * cx - xs()[i])) < 0.01);
  ok(swapped, 'rendered vertical strings mirror across the center line when reversed');
  // dots follow: cell center of string i under normal == cell center of string 5-i under reversed? no —
  // check that a click where a dot was placed round-trips in BOTH modes
  for (const st of [s, r]) {
    let rt = true;
    for (let i = 0; i < 6; i++) {
      const c = cellCenter(st, i, 2);
      const h = hitTest(st, c.x, c.y);
      if (!h || h.string !== i || h.rel !== 2) rt = false;
    }
    ok(rt, 'hit-test round-trip consistent (reverse=' + (st === r) + ')');
  }
  // combined with flipAcross still consistent
  const rc = mkSettings({ reverseStrings: true, flipAcross: true });
  const layC = stringLayout(rc);
  let both = true;
  for (let i = 0; i < 6; i++) {
    const j = 5 - i;
    if (Math.abs(layC[i].offset - layR[i].offset * -1) > 1e-9) both = false;
  }
  ok(both, 'reverseStrings + flipAcross compose correctly');
  // rendered pitch labels swap sides between normal/reversed
  const svgN = renderSvg(doc, s, {});
  const svgR = renderSvg(doc, r, {});
  ok(svgN !== svgR, 'reversed layout changes the rendering');
}

// ---- 6. Logarithmic spacing sanity: shrinking geometric progression preserved
{
  const { fretPositions } = mod;
  const s = mkSettings({ spacing: 'logarithmic', numFrets: 5, firstFretSize: 52, lastFretSize: 30 });
  const p = fretPositions(s);
  const slots = p.slice(1).map((v, i) => v - p[i]);
  ok(slots.every((w, i) => i === 0 || w < slots[i - 1]), 'log slots shrink toward higher frets');
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
