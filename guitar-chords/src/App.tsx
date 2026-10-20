import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChordDoc, ChordPlacement, Dot, PageConfig, PageDoc, Settings } from './lib/types';
import {
  MIN_NUM_FRETS, chordPatchFrom, clampNumFrets, clampStartFret, fitsPage,
  mergeChordSettings, pageSizePx, placementsOverlap, snapVal, uid,
} from './lib/types';
import { cellCenter, composePage, hitTest, makeDot, renderSvg, svgInner } from './lib/render';
import { canvasSize, fingeringPos } from './lib/geometry';
import { cycleShapeIndices, cycleColorIndices } from './lib/render';
import {
  chordFromLibrary, duplicatePage, emptyChord, emptyPage, exportRaster, exportSvg,
  loadActivePageId, loadChordList, loadCustomShapes, loadPages, loadSettings, packRows,
  paginateRows, saveActivePageId, saveChordList, saveCustomShapes, savePages, saveSettings,
} from './lib/storage';
import { CHORD_LIBRARY, analyzeChord, chordMatchesQuery, suggestNoteNames } from './lib/music';
import { HistoryManager } from './lib/history';
import SettingsPanel from './components/SettingsPanel';
import ItemDialog, { newFingering, newText } from './components/ItemDialog';

type Tool = 'dot' | 'text' | 'fing' | 'select';
type Sel = { kind: 'dot' | 'text' | 'fing'; id: string } | null;

/** Intrinsic size of a chord SVG (renderSvg embeds data-w / data-h). */
function intrinsic(markup: string): { w: number; h: number } {
  const m = markup.match(/data-w="(\d+(?:\.\d+)?)" data-h="(\d+(?:\.\d+)?)"/);
  return m ? { w: parseFloat(m[1]), h: parseFloat(m[2]) } : { w: 320, h: 420 };
}

const jsonSnap = (v: unknown) => JSON.parse(JSON.stringify(v));

export default function App() {
  // ---------- persisted state ----------
  const [settings, setSettings] = useState<Settings>(() => loadSettings());          // global defaults
  const [customs, setCustoms] = useState<Record<string, string>>(() => loadCustomShapes());
  const [chords, setChords] = useState<ChordDoc[]>(() => loadChordList());           // saved library
  const [pages, setPages] = useState<PageDoc[]>(() => {
    const ps = loadPages();
    if (ps.length) return ps;
    // first run — migrate the legacy single-board document into one page
    const p = emptyPage('My page');
    const c = emptyChord('Untitled');
    p.chords = [c];
    p.selected = c.id;
    return [p];
  });
  const [pageIdx, setPageIdx] = useState<number>(() => {
    const id = loadActivePageId();
    const i = pages.findIndex(p => p.id === id);
    return i >= 0 ? i : 0;
  });

  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { saveCustomShapes(customs); }, [customs]);
  useEffect(() => { saveChordList(chords); }, [chords]);
  useEffect(() => { savePages(pages); }, [pages]);
  useEffect(() => { saveActivePageId(pages[pageIdx]?.id ?? null); }, [pages, pageIdx]);

  const page = pages[pageIdx];
  const setPage = useCallback((fn: (p: PageDoc) => PageDoc) => {
    setPages(list => list.map((p, i) => (i === pageIdx ? fn(structuredClone(p)) : p)));
  }, [pageIdx]);

  const selectedId = page?.selected ?? null;
  const selIdx = page?.chords.findIndex(c => c.id === selectedId) ?? -1;
  const entry: ChordDoc | null = selIdx >= 0 ? page.chords[selIdx] : null;

  // effective settings of the SELECTED chord = global defaults ⊕ its patch
  const eff: Settings = useMemo(
    () => (entry ? mergeChordSettings(settings, entry.settings) : settings),
    [settings, entry],
  );

  // ---------- editing state ----------
  const [tool, setTool] = useState<Tool>('dot');
  const [sel, setSel] = useState<Sel>(null);
  const [editing, setEditing] = useState<Sel>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLib, setShowLib] = useState(false);
  const [dragging, setDragging] = useState(false);       // text-box drag inside a chord
  const [pageDrag, setPageDrag] = useState(false);       // chord box drag on the page
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const pageDragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const lastClickRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [patchClip, setPatchClip] = useState<ReturnType<typeof chordPatchFrom> | null>(null);

  // ---------- undo / redo (HistoryManager over `pages` + `chords` slices) ----------
  const pagesRef = useRef(pages); useEffect(() => { pagesRef.current = pages; }, [pages]);
  const chordsRef = useRef(chords); useEffect(() => { chordsRef.current = chords; }, [chords]);
  const pageIdxRef = useRef(pageIdx); useEffect(() => { pageIdxRef.current = pageIdx; }, [pageIdx]);

  const histRef = useRef<HistoryManager | null>(null);
  if (!histRef.current) histRef.current = new HistoryManager();
  const hist = histRef.current;
  // keep fresh accessors (they close over the latest state setters)
  hist.register('pages', {
    serialize: () => jsonSnap(pagesRef.current),
    restore: snap => {
      const list = snap as PageDoc[];
      setPages(list);
      const i = Math.max(0, Math.min(list.length - 1, pageIdxRef.current));
      setPageIdx(i);
      const id = list[i]?.id;
      if (id) saveActivePageId(id);
    },
  });
  hist.register('chords', {
    serialize: () => jsonSnap(chordsRef.current),
    restore: snap => setChords(snap as ChordDoc[]),
  });

  const [histTick, setHistTick] = useState(0);
  useEffect(() => { hist.onChange(() => setHistTick(t => t + 1)); }, [hist]);
  void histTick; // button disabled states re-render on every history change

  /** Record the CURRENT page-list state before a mutation (clears redo).
   *  Suppressed while a continuous drag gesture is in progress so an entire
   *  drag coalesces into the single snapshot taken at gesture start. */
  const pushHistory = useCallback(() => {
    if (histPausedRef.current) return;
    hist.commit('pages', jsonSnap(pagesRef.current));
  }, [hist]);

  /** Record the CURRENT library state before a mutation. */
  const pushLibHistory = useCallback(() => {
    hist.commit('chords', jsonSnap(chordsRef.current));
  }, [hist]);

  /** Mutate the selected chord doc (history-aware). */
  const mutate = useCallback((fn: (d: ChordDoc) => ChordDoc) => {
    if (!selectedId) return;
    pushHistory();
    setPage(p => {
      const i = p.chords.findIndex(c => c.id === selectedId);
      if (i < 0) return p;
      p.chords[i] = fn(structuredClone(p.chords[i]));
      return p;
    });
  }, [selectedId, setPage, pushHistory]);

  /** Mutate the selected chord's per-chord settings patch (history-aware). */
  const setEff = useCallback((next: Settings) => {
    if (!selectedId) return;
    pushHistory();
    setPage(p => {
      const i = p.chords.findIndex(c => c.id === selectedId);
      if (i < 0) return p;
      p.chords[i].settings = chordPatchFrom(next);
      return p;
    });
  }, [selectedId, setPage, pushHistory]);

  // ---------- coalesced snapshots for continuous drags ----------
  // A drag records ONE snapshot when it starts; intermediate moves must not
  // push more history.  `histPaused` suppresses pushHistory until the gesture
  // ends (pointer up / next discrete action).
  const histPausedRef = useRef(false);
  const beginDragHistory = useCallback(() => {
    if (!histPausedRef.current) hist.commit('pages', jsonSnap(pagesRef.current));
    histPausedRef.current = true;
  }, [hist]);
  const endDragHistory = useCallback(() => { histPausedRef.current = false; }, []);

  /** Mutate the page list WITHOUT recording history (continuous drag moves). */
  const setPageNoHist = useCallback((fn: (p: PageDoc) => PageDoc) => {
    setPages(list => list.map((p, i) => (i === pageIdxRef.current ? fn(structuredClone(p)) : p)));
  }, []);

  const undo = useCallback(() => { hist.undoAll(); }, [hist]);
  const redo = useCallback(() => { hist.redoAll(); }, [hist]);
  const canUndo = hist.canUndo();
  const canRedo = hist.canRedo();

  // ---------- rendering ----------
  const size = useMemo(() => canvasSize(eff), [eff]);
  const boardMarkup = useMemo(
    () => (entry ? renderSvg(entry, eff, { customs }) : ''),
    [entry, eff, customs],
  );

  // Render EVERY page once (chord thumbnails included) — used for the on-screen
  // stack and reused by export/print so all pages stay identical.
  const renderedPages = useMemo(() => {
    return pages.map(p => {
      const ps = pageSizePx(p.config);
      const chords = p.chords.map(c => {
        const es = mergeChordSettings(settings, c.settings);
        const markup = renderSvg(c, es, { customs });
        const nat = intrinsic(markup);
        const pl = p.placements[c.id] ?? { x: 40, y: 40, w: nat.w, h: nat.h, scale: 1 };
        return { id: c.id, name: c.name, x: pl.x, y: pl.y, scale: pl.scale, nw: nat.w, nh: nat.h, inner: svgInner(markup) };
      });
      return { id: p.id, name: p.name, config: p.config, ps, chords };
    });
  }, [pages, settings, customs]);

  const pageView = renderedPages[pageIdx] ?? null;

  // ---------- coordinate helpers ----------
  const toBoardCoords = (e: { clientX: number; clientY: number }) => {
    const el = boardWrapRef.current?.querySelector('svg');
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const scale = rect.width / size.w;
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };
  const toPageCoords = (e: { clientX: number; clientY: number }) => {
    const host = printRef.current?.querySelector('.page-svg-host') ?? printRef.current;
    if (!host || !pageView) return { x: 0, y: 0 };
    const rect = host.getBoundingClientRect();
    const scale = rect.width / pageView.ps.w;
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const findDotAt = (string: number, rel: number): Dot | undefined =>
    entry?.dots.find(d => d.string === string && d.fret - eff.startFret === rel);

  // ---------- click on the selected chord board ----------
  const onBoardClick = (e: React.MouseEvent) => {
    if (!entry || dragging || pageDrag) return;
    e.stopPropagation();
    // Some browsers suppress dblclick when the second click's default is prevented
    // anywhere in its path — implement double-click manually (400 ms / 8 px window).
    const now = performance.now();
    const prev = lastClickRef.current;
    if (prev && now - prev.t < 400 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 8) {
      lastClickRef.current = null;
      openEditAt(e);            // double-click → open the edit dialog
      return;
    }
    lastClickRef.current = { x: e.clientX, y: e.clientY, t: now };
    const { x, y } = toBoardCoords(e);
    const hit = hitTest(eff, x, y);

    if (tool === 'dot' && hit) {
      const existing = findDotAt(hit.string, hit.rel);
      if (e.shiftKey && existing) {
        mutate(d => {
          const dot = d.dots.find(dd => dd.id === existing.id)!;
          const cycle = cycleColorIndices(eff);
          const pos = cycle.indexOf(dot.colorIdx);
          dot.colorIdx = cycle[(pos + 1) % cycle.length] ?? 0;
          return d;
        });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && existing) {
        mutate(d => {
          const dot = d.dots.find(dd => dd.id === existing.id)!;
          const cycle = cycleShapeIndices(eff);
          const pos = cycle.indexOf(dot.shapeIdx);
          dot.shapeIdx = cycle[(pos + 1) % cycle.length] ?? 0;
          return d;
        });
        return;
      }
      if (existing) {
        mutate(d => ({ ...d, dots: d.dots.filter(dd => dd.id !== existing.id) }));
      } else {
        mutate(d => { d.dots.push(makeDot(eff, hit.string, hit.rel)); return d; });
      }
      return;
    }

    if (tool === 'text') {
      const t = newText(eff, x / size.w, y / size.h);
      mutate(d => { d.texts.push(t); return d; });
      setSel({ kind: 'text', id: t.id });
      setEditing({ kind: 'text', id: t.id });
      return;
    }

    if (tool === 'fing' && hit) {
      const existing = entry.fingerings.find(f => f.string === hit.string);
      if (existing) {
        setSel({ kind: 'fing', id: existing.id });
        setEditing({ kind: 'fing', id: existing.id });
      } else {
        const f = newFingering(eff, hit.string);
        mutate(d => { d.fingerings.push(f); return d; });
        setSel({ kind: 'fing', id: f.id });
        setEditing({ kind: 'fing', id: f.id });
      }
      return;
    }

    setSel(pickItem(x, y));
  };

  const pickItem = (x: number, y: number): Sel => {
    if (!entry) return null;
    let best: { d: number; sel: Sel } = { d: 26, sel: null };
    for (const d of entry.dots) {
      const c = cellCenter(eff, d.string, d.fret - eff.startFret);
      const dist = Math.hypot(c.x - x, c.y - y);
      if (dist < best.d) best = { d: dist, sel: { kind: 'dot', id: d.id } };
    }
    for (const t of entry.texts) {
      const dist = Math.hypot(t.x * size.w - x, t.y * size.h - y);
      if (dist < best.d) best = { d: dist, sel: { kind: 'text', id: t.id } };
    }
    for (const f of entry.fingerings) {
      const p = fingeringPos(eff, f.string);
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < best.d) best = { d: dist, sel: { kind: 'fing', id: f.id } };
    }
    return best.sel;
  };

  // edit dialog opens via double-click, Alt+click or right-click
  const openEditAt = (e: React.MouseEvent) => {
    if (!entry) return;
    e.preventDefault();
    e.stopPropagation();
    lastClickRef.current = null;
    const { x, y } = toBoardCoords(e);
    const s = pickItem(x, y);
    if (s) { setSel(s); setEditing(s); }
  };

  // ---------- text-box dragging inside the selected chord ----------
  const onBoardPointerDown = (e: React.MouseEvent) => {
    if (tool !== 'select' || !entry) return;
    const { x, y } = toBoardCoords(e);
    const s = pickItem(x, y);
    if (s && s.kind === 'text') {
      const t = entry.texts.find(tt => tt.id === s.id)!;
      dragRef.current = { dx: x - t.x * size.w, dy: y - t.y * size.h };
      beginDragHistory();          // ONE snapshot for the whole drag gesture
      setDragging(true);
      setSel(s);
    }
  };
  const onBoardPointerMove = (e: React.MouseEvent) => {
    if (!dragging || !dragRef.current || !sel || !entry) return;
    const { x, y } = toBoardCoords(e);
    const nx = (x - dragRef.current.dx) / size.w;
    const ny = (y - dragRef.current.dy) / size.h;
    setPageNoHist(p => {           // intermediate moves never touch history
      const i = p.chords.findIndex(c => c.id === selectedId);
      if (i < 0) return p;
      p.chords[i].texts = p.chords[i].texts.map(t => (t.id === sel.id ? { ...t, x: nx, y: ny } : t));
      return p;
    });
  };
  const onBoardPointerUp = () => {
    if (dragging) {
      endDragHistory();            // re-arm history after the gesture
      setTimeout(() => setDragging(false), 0);
    }
    dragRef.current = null;
  };

  // ---------- page-level interactions (select / move chords) ----------
  // Selection changes are UI state, not document content — they must not be
  // undoable and must not clear the redo branch. `setPage` clones deeply, so
  // a pure selection change leaves the serialized snapshot identical and the
  // history dedup in HistoryManager.commit ignores it automatically.
  const selectChord = (id: string | null) => setPage(p => { p.selected = id; return p; });

  /** Page-space rect of a chord's placement box (accounts for scale). */
  const chordRect = (pl: ChordPlacement): ChordPlacement => ({
    x: pl.x, y: pl.y, w: pl.w * pl.scale, h: pl.h * pl.scale, scale: pl.scale,
  });

  /** Find a free top-left position for a nat-sized box on the page (grid-stepped scan). */
  function findFreeSpot(p: PageDoc, nat: { w: number; h: number }): { x: number; y: number } {
    const cfg = p.config;
    const ps = pageSizePx(cfg);
    const bw = Math.min(nat.w, ps.w), bh = Math.min(nat.h, ps.h);
    const taken = Object.values(p.placements).map(chordRect);
    const overlaps = (px: number, py: number) =>
      taken.some(t => px < t.x + t.w && px + bw > t.x && py < t.y + t.h && py + bh > t.y);
    const step = Math.max(20, cfg.gridSize);
    for (let ty = 20; ty + bh <= ps.h; ty += step) {
      for (let tx = 20; tx + bw <= ps.w; tx += step) {
        if (!overlaps(tx, ty)) return { x: snapVal(tx, cfg), y: snapVal(ty, cfg) };
      }
    }
    // page is full — cascade diagonally so the new chord is at least visibly offset
    const off = ((p.chords.length % 8) + 1) * step;
    return {
      x: Math.max(0, Math.min(ps.w - bw, 20 + off)),
      y: Math.max(0, Math.min(ps.h - bh, 20 + off)),
    };
  }

  const onPageBackgroundDown = (e: React.MouseEvent) => {
    // clicking the empty page deselects the current chord
    selectChord(null);
    setSel(null);
    void e;
  };

  const onChordBoxDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;               // left button only
    selectChord(id);
    if (!page) return;
    const { x, y } = toPageCoords(e);
    const pl = page.placements[id];
    if (!pl) return;
    // grab offset INSIDE the (scaled) box so the chord doesn't jump on first move
    pageDragRef.current = { id, sx: x - pl.x, sy: y - pl.y, ox: pl.x, oy: pl.y };
    beginDragHistory();                        // ONE snapshot per drag gesture
    setPageDrag(true);
  };
  const onChordBoxMove = (e: React.MouseEvent) => {
    const ref = pageDragRef.current;
    if (!ref || !pageDrag || !page) return;
    const { x, y } = toPageCoords(e);
    const cfg = page.config;
    const ps = pageSizePx(cfg);
    const cur = page.placements[ref.id];
    if (!cur) return;
    let nx = snapVal(ref.ox + (x - ref.sx), cfg);
    let ny = snapVal(ref.oy + (y - ref.sy), cfg);
    nx = Math.max(0, Math.min(ps.w - cur.w * cur.scale, nx));
    ny = Math.max(0, Math.min(ps.h - cur.h * cur.scale, ny));
    setPageNoHist(p => { p.placements[ref.id] = { ...p.placements[ref.id], x: nx, y: ny }; return p; });
  };
  const onChordBoxUp = () => {
    const ref = pageDragRef.current;
    if (pageDrag && ref && page) {
      endDragHistory();
      // Chords should never sit on top of each other: if the drop position
      // overlaps another box, nudge this one to the nearest free spot.
      // This happens AFTER the gesture ended, so it records its own snapshot.
      setPage(p => {
        const self = p.placements[ref.id];
        if (!self) return p;
        const others = Object.entries(p.placements)
          .filter(([k]) => k !== ref.id)
          .map(([, v]) => chordRect(v));
        const collides = (r: ChordPlacement) => others.some(o => placementsOverlap(r, o));
        if (collides(self)) {
          const step = Math.max(10, p.config.gridSize || 10);
          const inside = (r: ChordPlacement) => fitsPage(r, pageSizePx(p.config));
          let best: ChordPlacement | null = null;
          outer: for (let radius = 1; radius <= 40; radius++) {
            for (let dy = -radius; dy <= radius; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                const cand: ChordPlacement = {
                  ...self,
                  x: Math.max(0, Math.min(pageSizePx(p.config).w - self.w * self.scale, self.x + dx * step)),
                  y: Math.max(0, Math.min(pageSizePx(p.config).h - self.h * self.scale, self.y + dy * step)),
                };
                if (inside(cand) && !collides(cand)) { best = cand; break outer; }
              }
            }
          }
          if (best) p.placements[ref.id] = best;
          else flash('No free spot found — chords overlap');
        }
        return p;
      });
      setTimeout(() => setPageDrag(false), 0);
    }
    pageDragRef.current = null;
  };

  // ---------- dialog apply ----------
  const applyEdit = (kind: 'dot' | 'text' | 'fing', item: any) => {
    mutate(d => {
      if (kind === 'dot') d.dots = d.dots.map(x => x.id === item.id ? item : x);
      if (kind === 'text') d.texts = d.texts.map(x => x.id === item.id ? item : x);
      if (kind === 'fing') d.fingerings = d.fingerings.map(x => x.id === item.id ? item : x);
      return d;
    });
    setEditing(null);
  };
  const deleteEdit = () => {
    if (!editing) return;
    mutate(d => {
      if (editing.kind === 'dot') d.dots = d.dots.filter(x => x.id !== editing.id);
      if (editing.kind === 'text') d.texts = d.texts.filter(x => x.id !== editing.id);
      if (editing.kind === 'fing') d.fingerings = d.fingerings.filter(x => x.id !== editing.id);
      return d;
    });
    setEditing(null); setSel(null);
  };

  const editItem = editing && entry
    ? (editing.kind === 'dot' ? entry.dots.find(x => x.id === editing.id)
      : editing.kind === 'text' ? entry.texts.find(x => x.id === editing.id)
      : entry.fingerings.find(x => x.id === editing.id))
    : null;

  // ---------- keyboard ----------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel) {
          mutate(d => {
            if (sel.kind === 'dot') d.dots = d.dots.filter(x => x.id !== sel.id);
            if (sel.kind === 'text') d.texts = d.texts.filter(x => x.id !== sel.id);
            if (sel.kind === 'fing') d.fingerings = d.fingerings.filter(x => x.id !== sel.id);
            return d;
          });
          setSel(null);
        } else if (selectedId) {
          // nothing inside a chord selected → remove the whole chord box from the page
          pushHistory();
          setPage(p => {
            p.chords = p.chords.filter(c => c.id !== selectedId);
            delete p.placements[selectedId];
            if (p.selected === selectedId) p.selected = p.chords[0]?.id ?? null;
            return p;
          });
          flash('Chord removed from page');
        }
      }
      if (e.key === '1') setTool('dot');
      if (e.key === '2') setTool('text');
      if (e.key === '3') setTool('fing');
      if (e.key === '4') setTool('select');
      if (e.key === 'Escape') { setSel(null); setEditing(null); selectChord(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, selectedId, undo, redo, mutate]);

  // ---------- selection semantics ----------
  // Editing tools always act on the selected chord; clicking a board with an editing
  // tool also makes sure a chord IS selected (auto-select the only / first chord).
  useEffect(() => {
    if (!page) return;
    if (!page.selected && page.chords.length) selectChord(page.chords[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id]);

  // ---------- chord ops ----------
  const addChordToPage = (src: ChordDoc, opts: { patch?: boolean } = {}) => {
    if (!page) return;
    pushHistory();
    const c: ChordDoc = structuredClone(src);
    c.id = uid('chord');
    for (const d of c.dots) d.id = uid('dot');
    for (const t of c.texts) t.id = uid('text');
    for (const f of c.fingerings) f.id = uid('fing');
    if (!opts.patch) c.settings = undefined; // inherit current global defaults
    setPage(p => {
      const es = mergeChordSettings(settings, c.settings);
      const nat = intrinsic(renderSvg(c, es, { customs }));
      // find a free spot so new chords never land on top of existing ones
      const { x, y } = findFreeSpot(p, nat);
      p.chords.push(c);
      p.placements[c.id] = { x, y, w: nat.w, h: nat.h, scale: 1 };
      p.selected = c.id;
      return p;
    });
    flash(`Added "${c.name}" to page`);
  };

  const duplicateSelected = () => {
    if (!entry) { flash('Select a chord first'); return; }
    addChordToPage(entry, { patch: true }); // keep the same per-chord settings
  };

  const copyPatch = () => {
    if (!entry) { flash('Select a chord first'); return; }
    setPatchClip(chordPatchFrom(eff));
    flash('Chord settings copied');
  };
  const pastePatchAll = () => {
    if (!patchClip) { flash('Nothing copied yet'); return; }
    pushHistory();
    setPage(p => { for (const c of p.chords) c.settings = structuredClone(patchClip); return p; });
    flash('Settings applied to ALL chords on this page');
  };
  const pastePatchSelected = () => {
    if (!patchClip || !selectedId) { flash('Nothing copied or no chord selected'); return; }
    pushHistory();
    setPage(p => {
      const i = p.chords.findIndex(c => c.id === selectedId);
      if (i >= 0) p.chords[i].settings = structuredClone(patchClip);
      return p;
    });
    flash('Settings pasted onto selected chord');
  };

  const renameSelected = (name: string) => {
    if (!selectedId) return;
    pushHistory();
    setPage(p => {
      const i = p.chords.findIndex(c => c.id === selectedId);
      if (i >= 0) p.chords[i].name = name;
      return p;
    });
  };

  // ---------- My chords library (undoable via the 'chords' history slice) ----------
  const saveSelectedToLibrary = () => {
    if (!entry) { flash('Select a chord first'); return; }
    const name = entry.name.trim() || 'Untitled';
    const rec: ChordDoc = { ...structuredClone(entry), name, settings: chordPatchFrom(eff) };
    pushLibHistory();
    setChords(list => {
      const i = list.findIndex(c => c.name === name);
      if (i >= 0) { const cp = [...list]; cp[i] = rec; return cp; }
      return [...list, rec];
    });
    flash(`Saved "${name}" to My chords`);
  };
  const deleteEntry = (i: number) => {
    pushLibHistory();
    setChords(list => list.filter((_, j) => j !== i));
  };
  const renameEntry = (i: number, name: string) => {
    pushLibHistory();
    setChords(list => list.map((c, j) => (j === i ? { ...c, name } : c)));
  };

  /** Save the current page's chord list into the library as a named set. */
  const savePageAsSet = () => {
    if (!page || !page.chords.length) { flash('No chords on this page'); return; }
    const base = (page.name || 'Chord set').trim();
    let name = base, n = 2;
    while (chords.some(c => c.name === name)) name = `${base} (${n++})`;
    pushLibHistory();
    for (const c of page.chords) {
      const rec: ChordDoc = { ...structuredClone(c), name: `${name} · ${c.name}`, settings: c.settings ?? chordPatchFrom(mergeChordSettings(settings, c.settings)) };
      setChords(list => [...list, rec]);
    }
    flash(`Saved ${page.chords.length} chords as “${name}” set`);
  };

  const loadFromLibrary = (c: ChordDoc) => {
    // put the FULL chord (its own layout patch included) onto the current page
    addChordToPage(c, { patch: true });
  };

  const [toast, setToastMsg] = useState('');
  const flash = (m: string) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 2200); };

  // ---------- page config ops ----------
  const setConfig = (patch: Partial<PageConfig>) => {
    pushHistory();
    setPage(p => { p.config = { ...p.config, ...patch }; return p; });
  };

  /** Re-measure every chord box and pull back-inside ones that no longer fit. */
  const refitChords = () => {
    if (!page) return;
    const ps = pageSizePx(page.config);
    setPage(p => {
      for (const c of p.chords) {
        const es = mergeChordSettings(settings, c.settings);
        const nat = canvasSize(es);
        const pl = p.placements[c.id] ?? { x: 20, y: 20, w: nat.w, h: nat.h, scale: 1 };
        pl.w = Math.round(nat.w * pl.scale);
        pl.h = Math.round(nat.h * pl.scale);
        if (!fitsPage(pl, ps)) {
          pl.x = Math.max(0, Math.min(ps.w - pl.w, pl.x));
          pl.y = Math.max(0, Math.min(ps.h - pl.h, pl.y));
          if (pl.w > ps.w || pl.h > ps.h) {
            const k = Math.min(ps.w / pl.w, ps.h / pl.h);
            pl.scale = Math.max(0.2, +(pl.scale * k).toFixed(3));
            pl.w = Math.round(nat.w * pl.scale);
            pl.h = Math.round(nat.h * pl.scale);
          }
        }
        p.placements[c.id] = pl;
      }
      return p;
    });
    flash('Chord boxes re-measured & fitted');
  };

  const scaleAll = (k: number) => {
    if (!page) return;
    pushHistory();
    const ps = pageSizePx(page.config);
    setPage(p => {
      for (const c of p.chords) {
        const es = mergeChordSettings(settings, c.settings);
        const nat = canvasSize(es);
        const pl = p.placements[c.id];
        if (!pl) continue;
        pl.scale = Math.max(0.2, Math.min(3, +(pl.scale * k).toFixed(3)));
        pl.w = Math.round(nat.w * pl.scale);
        pl.h = Math.round(nat.h * pl.scale);
        pl.x = Math.max(0, Math.min(ps.w - pl.w, pl.x));
        pl.y = Math.max(0, Math.min(ps.h - pl.h, pl.y));
      }
      return p;
    });
  };

  // ---------- auto-layout (pack all chords into rows/pages) ----------
  const buildAutoLayout = (): PageDoc[] => {
    if (!page) return [];
    const ps = pageSizePx(page.config);
    const margin = 24, gap = 18;
    const items = page.chords.map(c => {
      const es = mergeChordSettings(settings, c.settings);
      const markup = renderSvg(c, es, { customs });
      const nat = intrinsic(markup);
      return { entry: c, pl: page.placements[c.id] ?? { x: 0, y: 0, w: nat.w, h: nat.h, scale: 1 }, markup, iw: nat.w, ih: nat.h };
    });
    const rows = packRows(items, ps.w, margin, gap);
    const paginated = paginateRows(rows, ps, margin, gap);
    return paginated.map((pg, i) => {
      const np = emptyPage(`${page.name}${paginated.length > 1 ? ` ${i + 1}` : ''}`);
      np.config = { ...page.config };
      np.chords = pg.chords.map(c => structuredClone(items.find(it => it.entry.id === c.id)!.entry));
      for (const ch of np.chords) if (!ch.settings && ch.id) ch.settings = undefined;
      np.placements = {};
      pg.chords.forEach((c, j) => {
        const ch = np.chords[j];
        np.placements[ch.id] = { x: c.x, y: c.y, w: c.markup ? 0 : 0, h: 0, scale: c.scale };
        const it = items.find(t => t.entry.id === ch.id)!;
        np.placements[ch.id].w = Math.round(it.iw * c.scale);
        np.placements[ch.id].h = Math.round(it.ih * c.scale);
      });
      np.selected = np.chords[0]?.id ?? null;
      return np;
    });
  };

  const doAutoLayout = () => {
    if (!page || !page.chords.length) { flash('No chords on this page'); return; }
    pushHistory();
    const laid = buildAutoLayout();
    setPages(list => {
      const cp = [...list];
      cp.splice(pageIdx, 1, ...laid);
      return cp;
    });
    setPageIdx(pageIdx);
    flash(`Auto-laid out ${page.chords.length} chords onto ${laid.length} page${laid.length > 1 ? 's' : ''}`);
  };

  // ---------- export / print ----------
  const composeCurrent = (sc: number): string => {
    if (!page) return '';
    const ps = pageSizePx(page.config);
    return composePage(ps, page.chords.map(c => {
      const es = mergeChordSettings(settings, c.settings);
      const markup = renderSvg(c, es, { customs });
      const pl = page.placements[c.id] ?? { x: 40, y: 40, w: 0, h: 0, scale: 1 };
      return { id: c.id, x: pl.x, y: pl.y, scale: pl.scale, markup };
    }), { scale: sc });
  };

  const doExport = async (fmt: 'svg' | 'png' | 'jpg') => {
    if (!page) return;
    const fname = (page.name || 'page').replace(/[^a-z0-9\-_ ]/gi, '');
    try {
      const markup = composeCurrent(settings.exportScale);
      if (fmt === 'svg') exportSvg(markup, fname);
      else await exportRaster(markup, fname, fmt, settings.exportScale, settings.exportQuality);
      flash(`Exported ${fname}.${fmt}`);
    } catch { flash('Export failed'); }
  };

  const doPrint = () => {
    // Clone every page sheet into a hidden container so ONLY the pages print
    // (the enlarged chord editor and all app chrome stay off-screen).
    const nodes = printRef.current?.querySelectorAll('.print-page');
    if (!nodes || !nodes.length) return;
    const host = document.createElement('div');
    host.id = 'print-pages-host';
    nodes.forEach(n => host.appendChild(n.cloneNode(true)));
    const style = document.createElement('style');
    style.textContent = `
      #print-pages-host { display: none; }
      @media print {
        body * { visibility: hidden !important; }
        #print-pages-host { display: block !important; position: absolute; left: 0; top: 0; }
        #print-pages-host, #print-pages-host * { visibility: visible !important; }
        #print-pages-host .print-page { position: relative; width: 100%; page-break-after: always; box-shadow: none !important; outline: none !important; }
        #print-pages-host .print-page:last-child { page-break-after: auto; }
        #print-pages-host .page-label { display: none !important; }
      }`;
    document.head.appendChild(style);
    document.body.appendChild(host);
    window.print();
    setTimeout(() => { style.remove(); host.remove(); }, 500);
  };

  const suggestNames = () => {
    if (!entry) { flash('Select a chord first'); return; }
    const map = suggestNoteNames(entry.dots.map(d => ({ string: d.string, fret: d.fret })));
    mutate(d => {
      for (const dot of d.dots) {
        if (!dot.text) {
          const n = map.get(`${dot.string}:${dot.fret}`);
          if (n) dot.text = n;
        }
      }
      return d;
    });
    flash('Note names filled in');
  };

  // ---------- page ops (history-aware — the manager tracks the WHOLE list) ----------
  const newPage = () => {
    pushHistory();
    setPages(list => {
      const lp = list[list.length - 1];
      const np = emptyPage(`Page ${list.length + 1}`);
      if (lp) np.config = structuredClone(lp.config);
      return [...list, np];
    });
    setPageIdx(pages.length);
    flash('New page added');
  };
  const dupPage = () => {
    if (!page) return;
    pushHistory();
    setPages(list => {
      const copy = duplicatePage(page);
      const cp = [...list];
      cp.splice(pageIdx + 1, 0, copy);
      return cp;
    });
    setPageIdx(pageIdx + 1);
    flash('Page duplicated');
  };
  const delPage = () => {
    if (!page) return;
    pushHistory();
    if (pages.length === 1) { setPages([emptyPage('My page')]); setPageIdx(0); flash('Page cleared'); return; }
    setPages(list => list.filter((_, i) => i !== pageIdx));
    setPageIdx(i => Math.max(0, Math.min(pages.length - 2, i - (pageIdx === 0 ? 0 : 1))));
    flash('Page deleted');
  };

  // ---------- library browser dialog state ----------
  const [libTab, setLibTab] = useState<'builtin' | 'mine'>('builtin');
  const [libQuery, setLibQuery] = useState('');
  const [libQuality, setLibQuality] = useState<string>('all');
  const [libRoot, setLibRoot] = useState<number | null>(null);   // pitch class filter
  const [libPos, setLibPos] = useState<'all' | 'open' | 'barre'>('all');
  const [renamingIdx, setRenamingIdx] = useState(-1);

  const ROOT_LABELS = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];

  /** Built-in chords with derived searchable tags. */
  const builtinItems = useMemo(() => CHORD_LIBRARY.map(c => ({
    def: c, tags: analyzeChord(c.name, c.shape),
  })), []);

  /** My saved chords: tags from dots (absolute frets → low-E..high-e shape). */
  const mineItems = useMemo(() => chords.map(c => {
    const shape: (number | null)[] = [null, null, null, null, null, null];
    for (const d of c.dots) shape[5 - d.string] = d.fret;
    return { chord: c, tags: analyzeChord(c.name, shape) };
  }), [chords]);

  const QUALITY_FILTERS = ['all', 'major', 'minor', 'seventh', 'maj7', 'sus', 'dim', 'aug', 'open', 'barre'];

  function passesFilters(tags: string[], name: string): boolean {
    if (!chordMatchesQuery(name, [], tags, libQuery)) return false;
    if (libQuality !== 'all' && !tags.includes(libQuality)) return false;
    if (libRoot != null && !tags.includes(`root:${libRoot}`)) return false;
    if (libPos !== 'all' && !tags.includes(libPos)) return false;
    return true;
  }
  const filteredBuiltin = builtinItems.filter(it => passesFilters(it.tags, it.def.name));
  const filteredMine = mineItems.filter(it => passesFilters(it.tags, it.chord.name));

  const resetLibFilters = () => { setLibQuery(''); setLibQuality('all'); setLibRoot(null); setLibPos('all'); };

  if (!page || !pageView) return <div className="app">Loading…</div>;

  const hasSel = !!entry;

  return (
    <div className="app">
      <header className="topbar">
        <h1>🎸 Guitar Chord Designer</h1>
        <input className="txt name-input" value={page.name} onChange={e => setPage(p => { p.name = e.target.value; return p; })} placeholder="Page name" title="Page name" />
        <div className="toolbar">
          <button className={`btn tool ${tool === 'dot' ? 'active' : ''}`} onClick={() => setTool('dot')} title="Add/remove note dots on the SELECTED chord. Shift-click cycles colors, Ctrl-click cycles shapes, double-click / Alt+click / right-click edits. [1]">● Dots</button>
          <button className={`btn tool ${tool === 'text' ? 'active' : ''}`} onClick={() => setTool('text')} title="Click anywhere to add a free text box [2]">T Text</button>
          <button className={`btn tool ${tool === 'fing' ? 'active' : ''}`} onClick={() => setTool('fing')} title="Click a string at the far end of the fretboard (opposite the nut) to add a fingering label [3]">① Fingering</button>
          <button className={`btn tool ${tool === 'select' ? 'active' : ''}`} onClick={() => setTool('select')} title="Select & drag text boxes, Alt+click / right-click to edit [4]">⇗ Select</button>
        </div>
        <div className="toolbar right">
          <button className="btn" onClick={undo} disabled={!canUndo} title={`Undo (Ctrl+Z) — ${hist.undoCount()} step(s)`}>↩ Undo</button>
          <button className="btn" onClick={redo} disabled={!canRedo} title={`Redo (Ctrl+Shift+Z / Ctrl+Y) — ${hist.redoCount()} step(s)`}>↪ Redo</button>
          <button className={`btn ${settings.noteVisible ? 'active' : ''}`} onClick={() => setSettings(prev => ({ ...prev, noteVisible: !prev.noteVisible }))}
            title="Note visible mode for the GLOBAL defaults (new chords inherit it). Per-chord toggle lives in Settings → Note pitches.">♪ Notes</button>
          <span className="quick-ovr" title="Quick override of the starting fret — applies to the SELECTED chord">
            <label>Fret {hasSel ? eff.startFret : settings.startFret}<input type="range" min={1} max={24} step={1}
              disabled={!hasSel}
              value={clampStartFret(hasSel ? eff.startFret : settings.startFret)}
              onChange={e => {
                const v = clampStartFret(Number(e.target.value));
                if (hasSel) setEff({ ...eff, startFret: v }); else setSettings(s => ({ ...s, startFret: v }));
              }} /></label>
          </span>
          <span className="quick-ovr" title={`Quick override of the number of frets displayed (min ${MIN_NUM_FRETS}) — applies to the SELECTED chord`}>
            <label>Show {hasSel ? eff.numFrets : settings.numFrets}<input type="range" min={MIN_NUM_FRETS} max={15} step={1}
              disabled={!hasSel}
              value={Math.min(15, Math.max(MIN_NUM_FRETS, hasSel ? eff.numFrets : settings.numFrets))}
              onChange={e => {
                const v = clampNumFrets(Number(e.target.value));
                if (hasSel) setEff({ ...eff, numFrets: v }); else setSettings(s => ({ ...s, numFrets: v }));
              }} /></label>
          </span>
          <button className="btn" onClick={() => setShowLib(v => !v)}>📚 Library</button>
          <button className="btn" onClick={() => setShowSettings(v => !v)}>⚙ Settings</button>
        </div>
      </header>

      <div className="main">
        <aside className="left-panel">
          <div className="panel-card">
            <h3>Pages</h3>
            <div className="page-tabs">
              {pages.map((p, i) => (
                <button key={p.id} className={`page-tab ${i === pageIdx ? 'cur' : ''}`} onClick={() => { setPageIdx(i); setSel(null); }}>{p.name}</button>
              ))}
            </div>
            <div className="page-ops">
              <button className="btn small" onClick={newPage}>＋ New</button>
              <button className="btn small" onClick={dupPage} title="Copy this page (fresh ids)">⧉ Duplicate</button>
              <button className="btn small danger" onClick={delPage}>🗑 Delete</button>
            </div>
            <details className="page-config" open>
              <summary className="mini">Page setup</summary>
              <label className="row"><span>Size</span>
                <select value={page.config.size} onChange={e => { setConfig({ size: e.target.value as PageConfig['size'] }); }}>
                  <option value="letter">Letter 8.5×11″</option>
                  <option value="legal">Legal 8.5×14″</option>
                  <option value="a4">A4 210×297mm</option>
                  <option value="a3">A3 297×420mm</option>
                  <option value="custom">Custom…</option>
                </select></label>
              {page.config.size === 'custom' && <>
                <label className="row"><span>Width px</span><input type="number" min={200} max={4000} value={page.config.customW}
                  onChange={e => setConfig({ customW: Math.max(200, Math.min(4000, Number(e.target.value) || 816)) })} /></label>
                <label className="row"><span>Height px</span><input type="number" min={200} max={4000} value={page.config.customH}
                  onChange={e => setConfig({ customH: Math.max(200, Math.min(4000, Number(e.target.value) || 1056)) })} /></label>
              </>}
              <label className="row check"><input type="checkbox" checked={page.config.landscape} onChange={e => setConfig({ landscape: e.target.checked })} /><span>Landscape</span></label>
              <label className="row check"><input type="checkbox" checked={page.config.showGrid} onChange={e => setConfig({ showGrid: e.target.checked })} /><span>Show grid</span></label>
              <label className="row check"><input type="checkbox" checked={page.config.snap} onChange={e => setConfig({ snap: e.target.checked })} /><span>Snap to grid</span></label>
              <label className="row"><span>Grid (px)</span><input type="number" min={5} max={100} value={page.config.gridSize}
                onChange={e => setConfig({ gridSize: Math.max(5, Math.min(100, Number(e.target.value) || 20)) })} /></label>
              <div className="page-ops">
                <button className="btn small" onClick={doAutoLayout} title="Pack all chords neatly into rows across pages">▦ Auto-layout</button>
                <button className="btn small" onClick={refitChords} title="Re-measure chord boxes and pull them back inside the page">⇲ Refit boxes</button>
              </div>
              <div className="page-ops">
                <button className="btn small" onClick={() => scaleAll(0.9)} title="Scale ALL chords down 10%">− Scale</button>
                <button className="btn small" onClick={() => scaleAll(1.1)} title="Scale ALL chords up 10%">＋ Scale</button>
              </div>
            </details>
          </div>

          <div className="panel-card">
            <h3>Chords on page</h3>
            <div className="chord-list">
              {page.chords.length === 0 && <div className="mini-note">Empty page — add chords from “My chords” or the library below.</div>}
              {page.chords.map((c, i) => (
                <div key={c.id} className={`chord-item ${c.id === selectedId ? 'cur' : ''}`}>
                  <button className="load" onClick={() => selectChord(c.id)} title="Select this chord">{i + 1}. {c.name}</button>
                  <span className="cnt">{c.dots.length}</span>
                  <button className="del" title="Remove from page (keeps it in My chords when saved)"
                    onClick={() => { pushHistory(); setPage(p => { p.chords = p.chords.filter(x => x.id !== c.id); delete p.placements[c.id]; if (p.selected === c.id) p.selected = p.chords[0]?.id ?? null; return p; }); }}>×</button>
                </div>
              ))}
            </div>
            <div className="page-ops">
              <button className="btn small" onClick={() => addChordToPage(emptyChord('New chord'))}>＋ Empty chord</button>
              <button className="btn small" onClick={duplicateSelected} disabled={!hasSel} title="Copy the selected chord (same settings) beside it">⧉ Duplicate</button>
            </div>
            <div className="page-ops">
              <button className="btn small" onClick={copyPatch} disabled={!hasSel} title="Copy the selected chord's layout settings">📋 Copy settings</button>
              <button className="btn small" onClick={pastePatchSelected} disabled={!patchClip || !hasSel} title="Paste copied settings onto the selected chord">📥 Paste to selected</button>
              <button className="btn small" onClick={pastePatchAll} disabled={!patchClip} title="Apply copied settings to EVERY chord on this page">📥 Apply to all</button>
            </div>
            {patchClip && <div className="mini-note">Copied preset: fret {patchClip.startFret ?? settings.startFret}, {patchClip.numFrets ?? settings.numFrets} shown.</div>}
          </div>

          <div className="panel-card">
            <h3>My chords <span className="mini">({chords.length}) — press 📚 Library to browse &amp; search</span></h3>
            <div className="chord-list">
              {chords.length === 0 && <div className="mini-note">No saved chords yet. Design one and press Save.</div>}
              {chords.map((c, i) => (
                <div key={c.id ?? i} className={`chord-item ${i === renamingIdx ? 'renaming' : ''}`}>
                  {i === renamingIdx ? (
                    <input className="txt rename-input" autoFocus defaultValue={c.name}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { renameEntry(i, (e.target as HTMLInputElement).value.trim() || c.name); setRenamingIdx(-1); }
                        if (e.key === 'Escape') setRenamingIdx(-1);
                      }}
                      onBlur={e => { const v = e.target.value.trim(); if (v && v !== c.name) renameEntry(i, v); setRenamingIdx(-1); }} />
                  ) : (
                    <button className="load" onClick={() => loadFromLibrary(c)} title="Add to page (double-click to rename)">{c.name}</button>
                  )}
                  <span className="cnt">{c.dots.length}</span>
                  <button className="del" onClick={() => setRenamingIdx(i)} title="Rename">✎</button>
                  <button className="del" onClick={() => deleteEntry(i)} title="Delete from library (undoable with Ctrl+Z)">×</button>
                </div>
              ))}
            </div>
            <div className="page-ops">
              <button className="btn primary wide" onClick={saveSelectedToLibrary} disabled={!hasSel}>💾 Save selected chord</button>
            </div>
            <div className="page-ops">
              <button className="btn small" onClick={savePageAsSet} disabled={!page.chords.length} title="Save ALL chords of this page into the library as a named set">📦 Save page as set</button>
              <button className="btn small" onClick={() => { setLibTab('mine'); setShowLib(true); }}>🔎 Browse / search</button>
            </div>
          </div>

          <div className="panel-card">
            <h3>Export / Print</h3>
            <div className="export-row">
              <button className="btn" onClick={() => doExport('svg')}>SVG</button>
              <button className="btn" onClick={() => doExport('png')}>PNG</button>
              <button className="btn" onClick={() => doExport('jpg')}>JPG</button>
            </div>
            <div className="export-row">
              <button className="btn" onClick={doPrint} title="Print every page in order">🖨 Print all pages</button>
            </div>
            <div className="mini-note">Exports the WHOLE page ({pageView.ps.w}×{pageView.ps.h}px @ {settings.exportScale}×). Quality/scale in Settings.</div>
          </div>

          <div className="panel-card help">
            <h3>How to use</h3>
            <ul>
              <li><b>Click / drag any chord box</b> on the page to select &amp; reposition it (whole box is a handle; snaps to grid, auto-avoids overlaps)</li>
              <li><b>Edit in the ✏️ board below the sheets</b> — click to add/remove dots and do everything as before</li>
              <li><b>Double-click / Alt+click / right-click</b> a dot/text → edit properties</li>
              <li><b>Click empty page</b> to deselect; Del removes the selected chord box</li>
              <li>Shift/Ctrl-click dots → cycle colors/shapes</li>
              <li>Each chord keeps its OWN layout — Copy/Paste settings to transfer</li>
              <li><b>↩ Undo / ↪ Redo</b> (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y) covers page edits AND library changes; a whole drag counts as one step</li>
              <li><b>📚 Library browser</b> — search ("Am7", "barre"), filter by quality/root, add chords with one click</li>
            </ul>
          </div>
        </aside>

        <section className="canvas-area page-canvas" onMouseMove={onChordBoxMove} onMouseUp={onChordBoxUp} onMouseLeave={onChordBoxUp}>
          <div ref={printRef} className="print-root">
            {/* one printed sheet per page in the document (renderedPages is
                pre-computed — identical markup feeds export & print) */}
            {renderedPages.map((pv, pi) => {
              const ps = pv.ps;
              const chords = pv.chords;
              return (
                <div key={pv.id} className={`print-page page-sheet ${pi === pageIdx ? 'cur' : ''}`}
                  style={{ width: ps.w, height: ps.h } as React.CSSProperties}
                  data-page={pv.name}>
                  <div className="page-label">{pv.name}{pi === pageIdx ? ' — editing' : ''}</div>
                  <div className="page-svg-host">
                    <svg xmlns="http://www.w3.org/2000/svg" width={ps.w} height={ps.h} viewBox={`0 0 ${ps.w} ${ps.h}`}
                      className="page-svg" style={{ display: 'block' }}
                      onMouseDown={pi === pageIdx ? onPageBackgroundDown : undefined}>
                      {pv.config.showGrid && (
                        <>
                          <defs>
                            <pattern id={`grid-${pv.id}`} width={pv.config.gridSize} height={pv.config.gridSize} patternUnits="userSpaceOnUse">
                              <path d={`M ${pv.config.gridSize} 0 L 0 0 0 ${pv.config.gridSize}`} fill="none" stroke="#e2e8f0" strokeWidth="1" />
                            </pattern>
                          </defs>
                          <rect x="0" y="0" width={ps.w} height={ps.h} fill="#ffffff" />
                          <rect x="0" y="0" width={ps.w} height={ps.h} fill={`url(#grid-${pv.id})`} />
                        </>
                      )}
                      {!pv.config.showGrid && <rect x="0" y="0" width={ps.w} height={ps.h} fill="#ffffff" />}
                      {chords.map(c => {
                        const cur = pi === pageIdx && c.id === selectedId;
                        return (
                          <g key={c.id} transform={`translate(${c.x},${c.y}) scale(${c.scale})`}
                            className={`page-chord ${cur ? 'sel' : ''}`}
                            style={{ cursor: pi === pageIdx ? 'move' : 'default' }}
                            onMouseDown={pi === pageIdx ? (e) => onChordBoxDown(e, c.id) : undefined}>
                            <rect x="-6" y="-6" width={c.nw + 12} height={c.nh + 12} rx="6"
                              fill="rgba(255,255,255,0.6)" stroke={cur ? '#1f6feb' : 'transparent'} strokeWidth={cur ? 2 / c.scale : 0} strokeDasharray={cur ? `${6 / c.scale} ${4 / c.scale}` : undefined} />
                            <rect x="0" y="0" width={c.nw} height={c.nh} fill="#ffffff" stroke="#e3e7ec" strokeWidth={1 / c.scale} />
                            <g className="chord-content" dangerouslySetInnerHTML={{ __html: c.inner }} />
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>
              );
            })}

            {/* the enlarged, interactive editor for the selected chord */}
            <div className="board-editor">
              <div className="board-editor-head">
                <b>✏️ Editing:</b>
                <input className="txt chord-name" value={entry?.name ?? '(no chord selected)'} disabled={!hasSel}
                  onChange={e => renameSelected(e.target.value)} placeholder="Chord name" />
                <button className="btn small" onClick={suggestNames} disabled={!hasSel} title="Fill dot labels with guessed note names">🎵 Names</button>
                <button className="btn small danger" onClick={() => { pushHistory(); setPage(p => { const i = p.chords.findIndex(c => c.id === selectedId); if (i >= 0) { p.chords.splice(i, 1); delete p.placements[selectedId!]; p.selected = p.chords[0]?.id ?? null; } return p; }); }}
                  disabled={!hasSel}>🗑 Remove chord</button>
                <span className="mini">{hasSel ? `${eff.startFret}–${eff.startFret + eff.numFrets - 1} · ${eff.orientation}` : 'Click a chord box above to select it'}</span>
              </div>
              <div className="board-editor-body" ref={boardWrapRef} onDoubleClick={e => e.preventDefault()}
                onMouseDown={onBoardPointerDown} onMouseMove={onBoardPointerMove} onMouseUp={onBoardPointerUp}
                onClick={onBoardClick} onContextMenu={openEditAt}
                dangerouslySetInnerHTML={{ __html: boardMarkup }} />
            </div>
          </div>
        </section>

        {showSettings && (
          <aside className="right-panel">
            <div className="panel-head"><h3>{hasSel ? 'Settings — selected chord' : 'Settings — global defaults'}</h3><button className="btn small" onClick={() => setShowSettings(false)}>✕</button></div>
            <SettingsPanel
              settings={hasSel ? eff : settings}
              onChange={(next) => { if (hasSel) setEff(next); else setSettings(next); }}
              customs={customs} onCustomsChange={setCustoms}
              chordMode={hasSel}
              extraActions={hasSel ? (
                <>
                  <button className="btn small" onClick={() => { setSettings(structuredClone(eff)); flash('Copied this chord’s layout as the GLOBAL defaults'); }}>⇒ Make global defaults</button>
                  <button className="btn small" onClick={copyPatch}>📋 Copy settings</button>
                  <button className="btn small" onClick={pastePatchAll}>📥 Apply to all chords</button>
                </>
              ) : undefined}
            />
          </aside>
        )}
      </div>

      {showLib && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowLib(false); }}>
          <div className="dialog lib">
            <div className="dlg-head"><h3>📚 Chord library</h3><button className="btn small" onClick={() => setShowLib(false)}>✕</button></div>

            <div className="lib-tabs">
              <button className={`btn small tab ${libTab === 'builtin' ? 'active' : ''}`} onClick={() => setLibTab('builtin')}>Built-in ({filteredBuiltin.length}/{builtinItems.length})</button>
              <button className={`btn small tab ${libTab === 'mine' ? 'active' : ''}`} onClick={() => setLibTab('mine')}>My chords ({filteredMine.length}/{mineItems.length})</button>
            </div>

            <div className="lib-filters">
              <input
                className="txt lib-search"
                value={libQuery}
                onChange={e => setLibQuery(e.target.value)}
                placeholder='Search — "Am7", "barre", "maj7", root name…'
                autoFocus
              />
              <select className="sel" value={libQuality} onChange={e => setLibQuality(e.target.value)} title="Quality filter">
                {QUALITY_FILTERS.map(q => <option key={q} value={q}>{q === 'all' ? 'All qualities' : q}</option>)}
              </select>
              <select className="sel" value={libRoot == null ? 'all' : String(libRoot)} onChange={e => setLibRoot(e.target.value === 'all' ? null : Number(e.target.value))} title="Root filter">
                <option value="all">All roots</option>
                {ROOT_LABELS.map((r, i) => <option key={i} value={i}>{r}</option>)}
              </select>
              <select className="sel" value={libPos} onChange={e => setLibPos(e.target.value as 'all' | 'open' | 'barre')} title="Position filter">
                <option value="all">Any position</option>
                <option value="open">Open</option>
                <option value="barre">Barre</option>
              </select>
              <button className="btn small" onClick={resetLibFilters} title="Clear all filters">✕ Clear</button>
            </div>

            <div className="lib-list">
              {libTab === 'builtin' && (filteredBuiltin.length === 0
                ? <div className="mini-note empty">No built-in chords match. Try clearing filters.</div>
                : filteredBuiltin.map(({ def, tags }) => (
                  <div key={def.name} className="lib-row" title={tags.filter(t => !t.startsWith('root:')).join(', ')}>
                    <span className="lib-name">{def.name}</span>
                    <span className="lib-tags">{tags.filter(t => t !== 'open' && t !== 'barre').map(t => <em key={t}>{t}</em>)}</span>
                    <button className="btn small load" onClick={() => { addChordToPage(chordFromLibrary(def.name, def.shape, def.fingerings), { patch: true }); setShowLib(false); flash(`Added ${def.name} to page`); }}>＋ Add</button>
                  </div>
                )))}
              {libTab === 'mine' && (filteredMine.length === 0
                ? <div className="mini-note empty">{mineItems.length ? 'No saved chords match.' : 'Nothing saved yet — use "💾 Save selected chord" in the My chords panel.'}</div>
                : filteredMine.map(({ chord: c, tags }, idx) => {
                  const realIdx = chords.findIndex(x => x.id === c.id);
                  return (
                    <div key={c.id} className="lib-row" title={tags.filter(t => !t.startsWith('root:')).join(', ')}>
                      {renamingIdx === idx
                        ? <input className="txt lib-rename" defaultValue={c.name} autoFocus
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setRenamingIdx(-1); }}
                            onBlur={e => { renameEntry(realIdx, e.target.value); setRenamingIdx(-1); }} />
                        : <span className="lib-name" onDoubleClick={() => setRenamingIdx(idx)} title="Double-click to rename">{c.name}</span>}
                      <span className="lib-tags">{tags.filter(t => t !== 'open' && t !== 'barre').slice(0, 4).map(t => <em key={t}>{t}</em>)}</span>
                      <button className="btn small load" onClick={() => { loadFromLibrary(c); setShowLib(false); }}>＋ Add</button>
                      <button className="btn small del" onClick={() => { deleteEntry(realIdx); }} title="Delete from library (undoable)">×</button>
                    </div>
                  );
                }))}
            </div>

            <div className="mini-note">Click ＋ Add to drop the chord as a NEW box on the current page (placed clear of existing chords; undoable with Ctrl+Z).</div>
          </div>
        </div>
      )}

      {editing && editItem && (
        <ItemDialog
          kind={editing.kind}
          item={editItem}
          settings={eff}
          customs={customs}
          onApply={applyEdit}
          onDelete={deleteEdit}
          onClose={() => setEditing(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
