import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChordDoc, Dot, PageConfig, PageDoc, Settings } from './lib/types';
import {
  MIN_NUM_FRETS, chordPatchFrom, clampNumFrets, clampStartFret, fitsPage,
  mergeChordSettings, pageSizePx, snapVal, uid,
} from './lib/types';
import { cellCenter, composePage, hitTest, makeDot, renderSvg, svgInner } from './lib/render';
import { canvasSize, fingeringPos } from './lib/geometry';
import { cycleShapeIndices, cycleColorIndices } from './lib/render';
import {
  chordFromLibrary, duplicatePage, emptyChord, emptyPage, exportRaster, exportSvg,
  loadActivePageId, loadChordList, loadCustomShapes, loadPages, loadSettings, packRows,
  paginateRows, saveActivePageId, saveChordList, saveCustomShapes, savePages, saveSettings,
} from './lib/storage';
import { CHORD_LIBRARY, suggestNoteNames } from './lib/music';
import SettingsPanel from './components/SettingsPanel';
import ItemDialog, { newFingering, newText } from './components/ItemDialog';

type Tool = 'dot' | 'text' | 'fing' | 'select';
type Sel = { kind: 'dot' | 'text' | 'fing'; id: string } | null;

/** Intrinsic size of a chord SVG (renderSvg embeds data-w / data-h). */
function intrinsic(markup: string): { w: number; h: number } {
  const m = markup.match(/data-w="(\d+(?:\.\d+)?)" data-h="(\d+(?:\.\d+)?)"/);
  return m ? { w: parseFloat(m[1]), h: parseFloat(m[2]) } : { w: 320, h: 420 };
}

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
  const [patchClip, setPatchClip] = useState<ReturnType<typeof chordPatchFrom> | null>(null);
  const [undoStack, setUndoStack] = useState<PageDoc[]>([]);
  const [redoStack, setRedoStack] = useState<PageDoc[]>([]);
  const pagesRef = useRef(pages); useEffect(() => { pagesRef.current = pages; }, [pages]);
  const pageIdxRef = useRef(pageIdx); useEffect(() => { pageIdxRef.current = pageIdx; }, [pageIdx]);

  const pushHistory = useCallback(() => {
    const cur = pagesRef.current[pageIdxRef.current];
    if (!cur) return;
    setUndoStack(u => [...u.slice(-49), structuredClone(cur)]);
    setRedoStack([]);
  }, []);

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

  /** Mutate the selected chord's per-chord settings patch. */
  const setEff = useCallback((next: Settings) => {
    if (!selectedId) return;
    setPage(p => {
      const i = p.chords.findIndex(c => c.id === selectedId);
      if (i < 0) return p;
      p.chords[i].settings = chordPatchFrom(next);
      return p;
    });
  }, [selectedId, setPage]);

  const undo = useCallback(() => {
    setUndoStack(u => {
      if (!u.length) return u;
      const last = u[u.length - 1];
      const i = pageIdxRef.current;
      setRedoStack(r => [structuredClone(pagesRef.current[i]), ...r]);
      setPages(list => list.map((q, j) => (j === i ? structuredClone(last) : q)));
      return u.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setRedoStack(r => {
      if (!r.length) return r;
      const next = r[0];
      const i = pageIdxRef.current;
      setUndoStack(u => [...u, structuredClone(pagesRef.current[i])]);
      setPages(list => list.map((q, j) => (j === i ? structuredClone(next) : q)));
      return r.slice(1);
    });
  }, []);

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

  // edit dialog opens via Alt+click or right-click (double-click is unreliable)
  const openEditAt = (e: React.MouseEvent) => {
    if (!entry) return;
    e.preventDefault();
    e.stopPropagation();
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
      setDragging(true);
      setSel(s);
    }
  };
  const onBoardPointerMove = (e: React.MouseEvent) => {
    if (!dragging || !dragRef.current || !sel || !entry) return;
    const { x, y } = toBoardCoords(e);
    const nx = (x - dragRef.current.dx) / size.w;
    const ny = (y - dragRef.current.dy) / size.h;
    setPage(p => {
      const i = p.chords.findIndex(c => c.id === selectedId);
      if (i < 0) return p;
      p.chords[i].texts = p.chords[i].texts.map(t => (t.id === sel.id ? { ...t, x: nx, y: ny } : t));
      return p;
    });
  };
  const onBoardPointerUp = () => {
    if (dragging) {
      pushHistory();
      setTimeout(() => setDragging(false), 0);
    }
    dragRef.current = null;
  };

  // ---------- page-level interactions (select / move chords) ----------
  const selectChord = (id: string | null) => setPage(p => { p.selected = id; return p; });

  const onPageBackgroundDown = (e: React.MouseEvent) => {
    // clicking the empty page deselects the current chord
    selectChord(null);
    setSel(null);
    void e;
  };

  const onChordBoxDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    selectChord(id);
    if (!page) return;
    const { x, y } = toPageCoords(e);
    const pl = page.placements[id];
    if (!pl) return;
    pageDragRef.current = { id, sx: x, sy: y, ox: pl.x, oy: pl.y };
    setPageDrag(true);
  };
  const onChordBoxMove = (e: React.MouseEvent) => {
    const ref = pageDragRef.current;
    if (!ref || !pageDrag || !page) return;
    const { x, y } = toPageCoords(e);
    const cfg = page.config;
    const ps = pageSizePx(cfg);
    const pl = page.placements[ref.id];
    if (!pl) return;
    let nx = snapVal(ref.ox + (x - ref.sx), cfg);
    let ny = snapVal(ref.oy + (y - ref.sy), cfg);
    nx = Math.max(0, Math.min(ps.w - pl.w, nx));
    ny = Math.max(0, Math.min(ps.h - pl.h, ny));
    setPage(p => { p.placements[ref.id] = { ...p.placements[ref.id], x: nx, y: ny }; return p; });
  };
  const onChordBoxUp = () => {
    if (pageDrag) {
      pushHistory();
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
      const cfg = p.config;
      const ps = pageSizePx(cfg);
      // find a free spot (grid-stepped scan)
      let x = snapVal(40, cfg), y = snapVal(40, cfg);
      const taken = Object.values(p.placements);
      const overlaps = (px: number, py: number) =>
        taken.some(t => px < t.x + t.w && px + nat.w > t.x && py < t.y + t.h && py + nat.h > t.y);
      outer: for (let ty = y; ty + nat.h <= ps.h; ty += Math.max(20, cfg.gridSize)) {
        for (let tx = x; tx + nat.w <= ps.w; tx += Math.max(20, cfg.gridSize)) {
          if (!overlaps(tx, ty)) { x = tx; y = ty; break outer; }
        }
      }
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
    setPage(p => {
      const i = p.chords.findIndex(c => c.id === selectedId);
      if (i >= 0) p.chords[i].name = name;
      return p;
    });
  };

  const saveSelectedToLibrary = () => {
    if (!entry) { flash('Select a chord first'); return; }
    const name = entry.name.trim() || 'Untitled';
    const rec: ChordDoc = { ...structuredClone(entry), name, settings: chordPatchFrom(eff) };
    setChords(list => {
      const i = list.findIndex(c => c.name === name);
      if (i >= 0) { const cp = [...list]; cp[i] = rec; return cp; }
      return [...list, rec];
    });
    flash(`Saved "${name}" to My chords`);
  };
  const deleteEntry = (i: number) => setChords(list => list.filter((_, j) => j !== i));

  const loadFromLibrary = (c: ChordDoc) => {
    // put the FULL chord (its own layout patch included) onto the current page
    addChordToPage(c, { patch: true });
    setShowLib(false);
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
    if (!page) return;
    const nodes = printRef.current?.querySelectorAll('.print-page');
    if (!nodes || !nodes.length) return;
    const style = document.createElement('style');
    style.textContent = '@media print { body * { visibility: hidden; } .print-page, .print-page * { visibility: visible; } .print-page { position: absolute; left: 0; top: 0; width: 100%; page-break-after: always; } .print-page:last-child { page-break-after: auto; } }';
    document.head.appendChild(style);
    window.print();
    setTimeout(() => style.remove(), 500);
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

  // ---------- page ops ----------
  const newPage = () => {
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
    if (pages.length === 1) { setPages([emptyPage('My page')]); setPageIdx(0); flash('Page cleared'); return; }
    setPages(list => list.filter((_, i) => i !== pageIdx));
    setPageIdx(i => Math.max(0, Math.min(list_len(pages.length - 2), i - (pageIdx === 0 ? 0 : 1))));
    flash('Page deleted');
  };
  const list_len = (n: number) => Math.max(0, n);

  if (!page || !pageView) return <div className="app">Loading…</div>;

  const hasSel = !!entry;

  return (
    <div className="app">
      <header className="topbar">
        <h1>🎸 Guitar Chord Designer</h1>
        <input className="txt name-input" value={page.name} onChange={e => setPage(p => { p.name = e.target.value; return p; })} placeholder="Page name" title="Page name" />
        <div className="toolbar">
          <button className={`btn tool ${tool === 'dot' ? 'active' : ''}`} onClick={() => setTool('dot')} title="Add/remove note dots on the SELECTED chord. Shift-click cycles colors, Ctrl-click cycles shapes, Alt+click / right-click edits. [1]">● Dots</button>
          <button className={`btn tool ${tool === 'text' ? 'active' : ''}`} onClick={() => setTool('text')} title="Click anywhere to add a free text box [2]">T Text</button>
          <button className={`btn tool ${tool === 'fing' ? 'active' : ''}`} onClick={() => setTool('fing')} title="Click a string at the far end of the fretboard (opposite the nut) to add a fingering label [3]">① Fingering</button>
          <button className={`btn tool ${tool === 'select' ? 'active' : ''}`} onClick={() => setTool('select')} title="Select & drag text boxes, Alt+click / right-click to edit [4]">⇗ Select</button>
        </div>
        <div className="toolbar right">
          <button className="btn" onClick={undo} title="Undo (Ctrl+Z)">↩</button>
          <button className="btn" onClick={redo} title="Redo (Ctrl+Shift+Z)">↪</button>
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
            <h3>My chords</h3>
            <div className="chord-list">
              {chords.length === 0 && <div className="mini-note">No saved chords yet. Design one and press Save.</div>}
              {chords.map((c, i) => (
                <div key={c.id ?? i} className="chord-item">
                  <button className="load" onClick={() => loadFromLibrary(c)} title="Add to page">{c.name}</button>
                  <span className="cnt">{c.dots.length}</span>
                  <button className="del" onClick={() => deleteEntry(i)} title="Delete">×</button>
                </div>
              ))}
            </div>
            <div className="page-ops">
              <button className="btn primary wide" onClick={saveSelectedToLibrary} disabled={!hasSel}>💾 Save selected chord</button>
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
              <li><b>Click a chord box</b> on the page to select it — then edit it normally</li>
              <li><b>Drag a chord box</b> (Select tool, grab its border/margin) to reposition; snaps to grid</li>
              <li><b>Click empty page</b> to deselect; Del removes the selected chord box</li>
              <li><b>Alt+click / right-click</b> a dot/text → edit properties</li>
              <li>Shift/Ctrl-click dots → cycle colors/shapes</li>
              <li>Each chord keeps its OWN layout — Copy/Paste settings to transfer</li>
            </ul>
          </div>
        </aside>

        <section className="canvas-area page-canvas" onMouseMove={onChordBoxMove} onMouseUp={onChordBoxUp} onMouseLeave={onChordBoxUp}>
          <div ref={printRef} className="print-root">
            {/* one printed sheet per page in the document */}
            {pages.map((p, pi) => {
              const ps = pageSizePx(p.config);
              const chords = p.chords.map(c => {
                const es = mergeChordSettings(settings, c.settings);
                const markup = renderSvg(c, es, { customs });
                const nat = intrinsic(markup);
                const pl = p.placements[c.id] ?? { x: 40, y: 40, w: nat.w, h: nat.h, scale: 1 };
                return { id: c.id, x: pl.x, y: pl.y, scale: pl.scale, nw: nat.w, nh: nat.h, inner: svgInner(markup) };
              });
              const grid = p.config.showGrid
                ? `background-image: linear-gradient(#e8edf3 1px, transparent 1px), linear-gradient(90deg, #e8edf3 1px, transparent 1px); background-size: ${p.config.gridSize}px ${p.config.gridSize}px;`
                : '';
              return (
                <div key={p.id} className={`print-page page-sheet ${pi === pageIdx ? 'cur' : ''}`}
                  style={{ width: ps.w, height: ps.h, cssText: grid } as React.CSSProperties}
                  data-page={p.name}>
                  <div className="page-label">{p.name}{pi === pageIdx ? ' — editing' : ''}</div>
                  <div className="page-svg-host" style={{ backgroundImage: p.config.showGrid ? undefined : undefined }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width={ps.w} height={ps.h} viewBox={`0 0 ${ps.w} ${ps.h}`}
                      className="page-svg" style={{ display: 'block' }}
                      onMouseDown={pi === pageIdx ? onPageBackgroundDown : undefined}>
                      {p.config.showGrid && (
                        <>
                          <defs>
                            <pattern id={`grid-${p.id}`} width={p.config.gridSize} height={p.config.gridSize} patternUnits="userSpaceOnUse">
                              <path d={`M ${p.config.gridSize} 0 L 0 0 0 ${p.config.gridSize}`} fill="none" stroke="#e2e8f0" strokeWidth="1" />
                            </pattern>
                          </defs>
                          <rect x="0" y="0" width={ps.w} height={ps.h} fill="#ffffff" />
                          <rect x="0" y="0" width={ps.w} height={ps.h} fill={`url(#grid-${p.id})`} />
                        </>
                      )}
                      {!p.config.showGrid && <rect x="0" y="0" width={ps.w} height={ps.h} fill="#ffffff" />}
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
                            <g dangerouslySetInnerHTML={{ __html: c.inner }} />
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
              <div className="board-editor-body" ref={boardWrapRef}
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
            <div className="dlg-head"><h3>Chord library</h3><button className="btn small" onClick={() => setShowLib(false)}>✕</button></div>
            <div className="lib-grid">
              {CHORD_LIBRARY.map(c => (
                <button key={c.name} className="lib-btn" onClick={() => { addChordToPage(chordFromLibrary(c.name, c.shape, c.fingerings)); setShowLib(false); }}>{c.name}</button>
              ))}
            </div>
            <div className="mini-note">Adds the chord as a NEW box on the current page (the previously selected chord stays untouched).</div>
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
