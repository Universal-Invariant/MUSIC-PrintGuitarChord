import { readFileSync } from 'fs';
// quick TS->JS strip via esbuild-less approach: use tsc to emit? simpler: run through vite's esbuild
import { build } from 'esbuild';
const res = await build({
  entryPoints: ['src/lib/render.ts'],
  bundle: true, format: 'esm', write: false,
});
const code = res.outputFiles[0].text;
const mod = await import('data:text/javascript,' + encodeURIComponent(code));
const { renderSvg } = mod;

function mkSettings(over={}) {
  return {
    numFrets:5, startFret:1, orientation:'vertical', flipAlong:false, flipAcross:false,
    fretSpacing:46, stringGap:36, stringWidthMode:'progressive', minStringWidth:1.2, maxStringWidth:3.6,
    nutWidth:7, boardTaper:0.35, fretLabels:'all', fretLabelList:'', openSide:'nut',
    margins:{top:70,right:70,bottom:70,left:70},
    spacing:'equal', firstFretSize:52, lastFretSize:30, showDots:true,
    dotMarkerColor:{hex:'#c8bcd0',alpha:0.9}, bgFill:{hex:'#ffffff',alpha:1},
    fretColor:{hex:'#4a4a4a',alpha:1}, stringColor:{hex:'#8d8d8d',alpha:1},
    baseDotSize:26, colors:[{hex:'#e6194b',alpha:1}], defaultColors:[{hex:'#e6194b',alpha:1}],
    standardShapes:['circle','square'], customShapes:[], defaultShapes:['circle'], shapeDefaultColor:{hex:'#000',alpha:1},
    shapeScale:1, defaultTextFont:'Arial', defaultTextColor:{hex:'#fff',alpha:1}, defaultTextSize:14, defaultTextRotation:0,
    fingeringsLeft:true, exportScale:2, exportQuality:0.92, ...over,
  };
}
const doc = { name:'Em', dots:[], texts:[], fingerings:[{id:'f',string:0,text:'0',font:'Arial',size:15,color:{hex:'#333',alpha:1}}] };

let fails = 0;
const ok = (cond,msg)=>{ console.log((cond?'PASS':'FAIL')+' '+msg); if(!cond) fails++; };

// ---- 1. Taper direction: wider at low frets/nut, narrower at high frets
{
  const s = mkSettings({boardTaper:0.6, startFret:0, numFrets:12, orientation:'horizontal'});
  const svg = renderSvg(doc, s, {});
  // parse polygon (first = board panel) points
  const poly = svg.match(/<polygon points="([^"]+)"/)[1].trim().split(/\s+/).map(p=>p.split(',').map(Number));
  // left side pts are first half ordered t increasing
  const n = poly.length/2;
  const first = poly[0], last = poly[n-1];
  // horizontal orientation: across axis = y; width at first vs last
  const wStart = Math.abs(poly[0][1]-poly[poly.length-1][1]);
  const wEnd = Math.abs(poly[n-1][1]-poly[n][1]);
  ok(wStart > wEnd+1, `taper: nut end wider (${wStart.toFixed(1)}) than high-fret end (${wEnd.toFixed(1)})`);
}

// ---- 2. Nut only when startFret===0. Detect nut by fill #f2ead8
{
  const withNut = renderSvg(doc, mkSettings({startFret:0}), {});
  const noNut = renderSvg(doc, mkSettings({startFret:1}), {});
  ok(withNut.includes('#f2ead8'), 'nut drawn when startFret=0');
  ok(!noNut.includes('#f2ead8'), 'no nut when startFret=1');
  ok(!renderSvg(doc, mkSettings({startFret:5}), {}).includes('#f2ead8'), 'no nut when startFret=5');
}

// ---- 3. Strings never extend beyond the last fret line
{
  const s = mkSettings({orientation:'horizontal', startFret:0, numFrets:5, fretSpacing:46});
  const svg = renderSvg(doc, s, {});
  // last fret line x: fret lines are stroke fretColor lines; find max x of line elements with fret color
  const lines=[...svg.matchAll(/<line x1="([\d.]+)" y1="[\d.-]+" x2="([\d.]+)" y2="[\d.-]+" stroke="#4a4a4a" stroke-width="2[^"]*\/>/g)];
  const strLines=[...svg.matchAll(/<line x1="([\d.]+)" y1="[\d.-]+" x2="([\d.]+)" y2="[\d.-]+" stroke="#8d8d8a/g)];
  const fretMaxX = Math.max(...lines.map(m=>Math.max(+m[1],+m[2])));
  const strMaxX = Math.max(...strLines.map(m=>Math.max(+m[1],+m[2])));
  ok(Math.abs(strMaxX - fretMaxX) < 0.6, `strings stop at last fret line (str ${strMaxX} vs fret ${fretMaxX})`);
}

// ---- 4. Centering & equivariance under flips: content bbox centered within configured margins
{
  const { canvasSize, project, contentSize } = mod;
  for (const orientation of ['vertical','horizontal']) {
    for (const flipAlong of [false,true]) {
      for (const flipAcross of [false,true]) {
        for (const startFret of [0,1,5]) {
          for (const spacing of ['equal','logarithmic']) {
            const s = mkSettings({orientation, flipAlong, flipAcross, startFret, spacing, margins:{top:40,right:90,bottom:55,left:25}});
            const cs = canvasSize(s), cont = contentSize(s);
            // extreme logical points of content bbox
            const corners = [
              [-cont.along+ (cont.along - (spacing==='equal'?5*46: (52*(1-Math.pow(30/52,1/4))/(1-30/52)) ) ), -(cont.across/2)],
            ];
            // simpler: sample many t values in [-nutZone, flen+farBand] and a extremes
            const nutZone = mod.nutZoneDepth ? mod.nutZoneDepth(s) : 30;
            const flen = mod.fretLength(s);
            const fb = cont.along - nutZone - flen;
            let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
            for (const t of [-nutZone, 0, flen/2, flen, flen+fb]) {
              for (const a of [-cont.across/2, 0, cont.across/2]) {
                const p = project(s,t,a);
                minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
                minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
              }
            }
            const alongLen = orientation==='vertical' ? (maxY-minY) : (maxX-minX);
            const acrossLen = orientation==='vertical' ? (maxX-minX) : (maxY-minY);
            ok(Math.abs(alongLen - cont.along)<0.01 && Math.abs(acrossLen-cont.across)<0.01,
              `bbox size matches content (${orientation},${flipAlong?'F':'-'},${flipAcross?'f':'-'},sf${startFret},${spacing})`);
            // centered between margins: vertical pad pair equal, horizontal pad pair equal
            const vPadTop = minY - 0, vPadBottom = cs.h - maxY;
            const hPadL = minX, hPadR = cs.w - maxX;
            const sumOk = orientation==='vertical'
              ? Math.abs((vPadTop+vPadBottom)-(s.margins.top+s.margins.bottom))<0.01 && Math.abs((hPadL+hPadR)-(s.margins.left+s.margins.right))<0.01
              : Math.abs((vPadTop+vPadBottom)-(s.margins.top+s.margins.bottom))<0.01 && Math.abs((hPadL+hPadR)-(s.margins.left+s.margins.right))<0.01;
            const centerOk = orientation==='vertical'
              ? Math.abs(vPadTop-vPadBottom)<0.01 && Math.abs(hPadL-hPadR)<0.01
              : Math.abs(vPadTop-vPadBottom)<0.01 && Math.abs(hPadL-hPadR)<0.01;
            ok(sumOk, `padding sums match configured margins (${orientation},${flipAlong?'F':'-'},sf${startFret},${spacing})`);
            ok(centerOk, `content centered (${orientation},${flipAlong?'F':'-'},${flipAcross?'f':'-'},sf${startFret},${spacing})`);
          }
        }
      }
    }
  }
}

// ---- 5. hitTest round-trip under all flips (dots positions correct relative)
{
  const { cellCenter, hitTest } = mod;
  for (const orientation of ['vertical','horizontal'])
  for (const flipAlong of [false,true])
  for (const flipAcross of [false,true])
  for (const startFret of [0,3]) {
    const s = mkSettings({orientation, flipAlong, flipAcross, startFret});
    let bad = 0;
    for (let str=0; str<6; str++) for (let rel=-1; rel<s.numFrets; rel++) {
      const c = cellCenter(s,str,rel);
      const h = hitTest(s,c.x,c.y);
      if (!h || h.string!==str || h.rel!==rel) bad++;
    }
    ok(bad===0, `hitTest round-trip (${orientation},${flipAlong?'F':'-'},${flipAcross?'f':'-'},sf${startFret}) bad=${bad}`);
  }
}

// ---- 6. Equivariance: flipping mirrors positions but preserves distances/relative layout
{
  const { cellCenter } = mod;
  const base = mkSettings({flipAlong:false});
  const flip = mkSettings({flipAlong:true});
  const pts = b => { const o=[]; for(let s=0;s<6;s++)for(let r=0;r<5;r++)o.push(cellCenter(b,s,r)); return o; };
  const P=pts(base), Q=pts(flip);
  // distance between two cells should be preserved
  const d1=Math.hypot(P[3].x-P[10].x,P[3].y-P[10].y), d2=Math.hypot(Q[3].x-Q[10].x,Q[3].y-Q[10].y);
  ok(Math.abs(d1-d2)<0.01, `flipAlong is an isometry (d ${d1.toFixed(2)} vs ${d2.toFixed(2)})`);
  // order along fret axis reverses
  ok((P[0].y<P[1].y) !== (Q[0].y<Q[1].y), 'flipAlong reverses fret axis direction');
}

// ---- 7. Fret labels: none / custom list
{
  const sNone = mkSettings({fretLabels:'none', startFret:1});
  const svgNone = renderSvg(doc, sNone, {});
  const textNums = [...svgNone.matchAll(/font-size="13"[^>]*>(\d+)<\/text>/g)].map(m=>m[1]);
  ok(textNums.length===0, `fretLabels none hides numbers (found ${textNums.length})`);
  const sCust = mkSettings({fretLabels:'custom', fretLabelList:'2-3, 5', startFret:1, numFrets:5});
  const nums = [...renderSvg(doc,sCust,{}).matchAll(/font-size="13"[^>]*>(\d+)<\/text>/g)].map(m=>+m[1]);
  ok(JSON.stringify(nums.sort())==='[2,3,5]', `custom list "2-3, 5" → ${JSON.stringify(nums)}`);
}

// ---- 8. openSide far places pitch labels past the last fret
{
  const { project, fretLength, nutZoneDepth, contentSize } = mod;
  const sN = mkSettings({openSide:'nut', orientation:'horizontal'});
  const sF = mkSettings({openSide:'far', orientation:'horizontal'});
  const lN = mod.stringLabelAlong(sN), lF = mod.stringLabelAlong(sF);
  ok(lN < 0, 'pitch labels before first fret line on nut side');
  ok(lF > fretLength(sF), 'pitch labels past last fret line on far side');
  // still inside content bbox
  const c = contentSize(sF);
  ok(-nutZoneDepth(sF) <= lF && lF <= c.along - nutZoneDepth(sF), 'far-side labels within reserved band (centered canvas keeps them visible)');
}

// ---- 9. log spacing shrinks toward higher frets
{
  const s = mkSettings({spacing:'logarithmic', numFrets:6, firstFretSize:60, lastFretSize:20});
  const pos = mod.fretPositions(s);
  const slots = pos.slice(1).map((v,i)=>v-pos[i]);
  ok(slots.every((v,i)=>i===0||v<slots[i-1]), `log slots shrink: ${slots.map(v=>v.toFixed(1)).join(', ')}`);
}

console.log(fails===0?'\nALL CHECKS PASSED':`\n${fails} CHECKS FAILED`);
process.exit(fails?1:0);
