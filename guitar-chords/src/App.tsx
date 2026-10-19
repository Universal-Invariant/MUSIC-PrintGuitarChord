import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChordDoc, Dot, Settings } from './lib/types';
import { uid } from './lib/types';
import { cellCenter, hitTest, makeDot, renderSvg } from './lib/render';
import { canvasSize } from './lib/geometry';
import { cycleShapeIndices, cycleColorIndices } from './lib/render';
import {
  chordFromLibrary, emptyChord, exportRaster, exportSvg, loadChordList, loadCustomShapes,
  loadSettings, saveChordList, saveCustomShapes, saveSettings,
} from './lib/storage';
import { CHORD_LIBRARY, suggestNoteNames } from './lib/music';
import SettingsPanel from './components/SettingsPanel';
import ItemDialog, { newFingering, newText } from './components/ItemDialog';

type Tool = 'dot' | 'text' | 'fing' | 'select';
type Sel = { kind: 'dot' | 'text' | 'fing'; id: string } | null;

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [customs, setCustoms] = useState<Record<string, string>>(() => loadCustomShapes());
  const [doc, setDoc] = useState<ChordDoc>(() => emptyChord());
  const [chords, setChords] = useState<ChordDoc[]>(() => loadChordList());
  const [tool, setTool] = useState<Tool>('dot');
  const [sel, setSel] = useState<Sel>(null);
  const [editing, setEditing] = useState<Sel>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLib, setShowLib] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const [undoStack, setUndoStack] = useState<ChordDoc[]>([]);
  const [redoStack, setRedoStack] = useState<ChordDoc[]>([]);

  // persist
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { saveCustomShapes(customs); }, [customs]);
  useEffect(() => { saveChordList(chords); }, [chords]);

  const size = useMemo(() => canvasSize(settings), [settings]);
  const svgMarkup = useMemo(
    () => renderSvg(doc, settings, { customs }),
    [doc, settings, customs],
  );

  const pushHistory = useCallback((d: ChordDoc) => {
    setUndoStack(u => [...u.slice(-49), structuredClone(d)]);
    setRedoStack([]);
  }, []);

  const mutate = useCallback((fn: (d: ChordDoc) => ChordDoc) => {
    setDoc(prev => { pushHistory(prev); return fn(structuredClone(prev)); });
  }, [pushHistory]);

  const undo = useCallback(() => {
    setUndoStack(u => {
      if (!u.length) return u;
      const last = u[u.length - 1];
      setRedoStack(r => [structuredClone(docRef.current), ...r]);
      setDoc(last);
      return u.slice(0, -1);
    });
  }, []);
  const docRef = useRef(doc); useEffect(() => { docRef.current = doc; }, [doc]);
  const redo = useCallback(() => {
    setRedoStack(r => {
      if (!r.length) return r;
      const next = r[0];
      setUndoStack(u => [...u, structuredClone(docRef.current)]);
      setDoc(next);
      return r.slice(1);
    });
  }, []);

  // ---------- coordinate helpers ----------
  const toCanvasCoords = (e: { clientX: number; clientY: number }) => {
    const el = svgWrapRef.current?.querySelector('svg');
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const scale = rect.width / size.w;
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const findDotAt = (string: number, rel: number): Dot | undefined =>
    doc.dots.find(d => d.string === string && d.fret - settings.startFret === rel);

  // ---------- click on board ----------
  const onBoardClick = (e: React.MouseEvent) => {
    if (dragging) return;
    const { x, y } = toCanvasCoords(e);
    const hit = hitTest(settings, x, y);

    if (tool === 'dot' && hit) {
      const existing = findDotAt(hit.string, hit.rel);
      if (e.shiftKey && existing) {
        mutate(d => {
          const dot = d.dots.find(dd => dd.id === existing.id)!;
          const cycle = cycleColorIndices(settings);
          const pos = cycle.indexOf(dot.colorIdx);
          dot.colorIdx = cycle[(pos + 1) % cycle.length] ?? 0;
          return d;
        });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && existing) {
        mutate(d => {
          const dot = d.dots.find(dd => dd.id === existing.id)!;
          const cycle = cycleShapeIndices(settings);
          const pos = cycle.indexOf(dot.shapeIdx);
          dot.shapeIdx = cycle[(pos + 1) % cycle.length] ?? 0;
          return d;
        });
        return;
      }
      if (existing) {
        mutate(d => ({ ...d, dots: d.dots.filter(dd => dd.id !== existing.id) }));
      } else {
        mutate(d => { d.dots.push(makeDot(settings, hit.string, hit.rel)); return d; });
      }
      return;
    }

    if (tool === 'text') {
      const t = newText(settings, x / size.w, y / size.h);
      mutate(d => { d.texts.push(t); return d; });
      setSel({ kind: 'text', id: t.id });
      setEditing({ kind: 'text', id: t.id });
      return;
    }

    if (tool === 'fing' && hit) {
      const existing = doc.fingerings.find(f => f.string === hit.string);
      if (existing) {
        setSel({ kind: 'fing', id: existing.id });
        setEditing({ kind: 'fing', id: existing.id });
      } else {
        const f = newFingering(settings, hit.string);
        mutate(d => { d.fingerings.push(f); return d; });
        setSel({ kind: 'fing', id: f.id });
        setEditing({ kind: 'fing', id: f.id });
      }
      return;
    }

    // select tool or misc: pick nearest item for editing
    const picked = pickItem(x, y);
    setSel(picked);
  };

  const pickItem = (x: number, y: number): Sel => {
    let best: { d: number; sel: Sel } = { d: 26, sel: null };
    for (const d of doc.dots) {
      const c = cellCenter(settings, d.string, d.fret - settings.startFret);
      const dist = Math.hypot(c.x - x, c.y - y);
      if (dist < best.d) best = { d: dist, sel: { kind: 'dot', id: d.id } };
    }
    for (const t of doc.texts) {
      const dist = Math.hypot(t.x * size.w - x, t.y * size.h - y);
      if (dist < best.d) best = { d: dist, sel: { kind: 'text', id: t.id } };
    }
    for (const f of doc.fingerings) {
      const c = cellCenter(settings, f.string, -1);
      const off = settings.orientation === 'vertical' ? { x: c.x, y: c.y - 34 } : { x: c.x + (settings.fingeringsLeft ? -40 : 40), y: c.y };
      const dist = Math.hypot(off.x - x, off.y - y);
      if (dist < best.d) best = { d: dist, sel: { kind: 'fing', id: f.id } };
    }
    return best.sel;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = toCanvasCoords(e);
    const s = pickItem(x, y);
    if (s) setEditing(s);
  };

  // ---------- dragging text boxes ----------
  const onPointerDown = (e: React.MouseEvent) => {
    if (tool !== 'select') return;
    const { x, y } = toCanvasCoords(e);
    const s = pickItem(x, y);
    if (s && s.kind === 'text') {
      const t = doc.texts.find(tt => tt.id === s.id)!;
      dragRef.current = { dx: x - t.x * size.w, dy: y - t.y * size.h };
      setDragging(true);
      setSel(s);
    }
  };
  const onPointerMove = (e: React.MouseEvent) => {
    if (!dragging || !dragRef.current || !sel) return;
    const { x, y } = toCanvasCoords(e);
    const nx = (x - dragRef.current.dx) / size.w;
    const ny = (y - dragRef.current.dy) / size.h;
    setDoc(d => ({ ...d, texts: d.texts.map(t => t.id === sel.id ? { ...t, x: nx, y: ny } : t) }));
  };
  const onPointerUp = () => {
    if (dragging) {
      setTimeout(() => setDragging(false), 0);
      setUndoStack(u => [...u.slice(-49)]); // keep simple; history pushed on drop below
    }
    dragRef.current = null;
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

  const editItem = editing
    ? (editing.kind === 'dot' ? doc.dots.find(x => x.id === editing.id)
      : editing.kind === 'text' ? doc.texts.find(x => x.id === editing.id)
      : doc.fingerings.find(x => x.id === editing.id))
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
        }
      }
      if (e.key === '1') setTool('dot');
      if (e.key === '2') setTool('text');
      if (e.key === '3') setTool('fing');
      if (e.key === '4') setTool('select');
      if (e.key === 'Escape') { setSel(null); setEditing(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [sel, undo, redo, mutate]);

  // ---------- chord list ops ----------
  const saveToChordList = () => {
    const name = doc.name.trim() || 'Untitled';
    const entry: ChordDoc = { ...structuredClone(doc), name };
    setChords(list => {
      const i = list.findIndex(c => c.name === name);
      if (i >= 0) { const cp = [...list]; cp[i] = entry; return cp; }
      return [...list, entry];
    });
    flash(`Saved "${name}" to chord list`);
  };
  const loadEntry = (c: ChordDoc, i: number) => {
    setDoc(structuredClone(c));
    setSel(null);
    flash(`Loaded "${c.name}"`);
    void i;
  };
  const deleteEntry = (i: number) => setChords(list => list.filter((_, j) => j !== i));

  const [toast, setToastMsg] = useState('');
  const flash = (m: string) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 2200); };

  const doExport = async (fmt: 'svg' | 'png' | 'jpg') => {
    const markup = renderSvg(doc, settings, { customs, scale: settings.exportScale });
    const fname = (doc.name || 'chord').replace(/[^a-z0-9\-_ ]/gi, '');
    try {
      if (fmt === 'svg') exportSvg(markup, fname);
      else await exportRaster(markup, fname, fmt, settings.exportScale, settings.exportQuality);
      flash(`Exported ${fname}.${fmt}`);
    } catch { flash('Export failed'); }
  };

  const suggestNames = () => {
    // auto-fill note names into dots without text
    const map = suggestNoteNames(doc.dots.map(d => ({ string: d.string, fret: d.fret })));
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

  return (
    <div className="app">
      <header className="topbar">
        <h1>🎸 Guitar Chord Designer</h1>
        <input className="txt name-input" value={doc.name} onChange={e => setDoc(d => ({ ...d, name: e.target.value }))} placeholder="Chord name" />
        <div className="toolbar">
          <button className={`btn tool ${tool === 'dot' ? 'active' : ''}`} onClick={() => setTool('dot')} title="Add/remove note dots. Shift-click cycles colors, Ctrl-click cycles shapes, double-click edits. [1]">● Dots</button>
          <button className={`btn tool ${tool === 'text' ? 'active' : ''}`} onClick={() => setTool('text')} title="Click anywhere to add a free text box [2]">T Text</button>
          <button className={`btn tool ${tool === 'fing' ? 'active' : ''}`} onClick={() => setTool('fing')} title="Click a string near the nut to add a fingering label [3]">① Fingering</button>
          <button className={`btn tool ${tool === 'select' ? 'active' : ''}`} onClick={() => setTool('select')} title="Select & drag text boxes, double-click to edit [4]">⇗ Select</button>
        </div>
        <div className="toolbar right">
          <button className="btn" onClick={undo} title="Undo (Ctrl+Z)">↩</button>
          <button className="btn" onClick={redo} title="Redo (Ctrl+Shift+Z)">↪</button>
          <button className="btn" onClick={() => mutate(d => ({ ...emptyChord(), name: d.name }))} title="Clear board">🗑 Clear</button>
          <button className="btn" onClick={suggestNames} title="Fill dots with suggested note names">♪ Note names</button>
          <button className="btn" onClick={() => setShowLib(v => !v)}>📚 Library</button>
          <button className="btn" onClick={() => setShowSettings(v => !v)}>⚙ Settings</button>
        </div>
      </header>

      <div className="main">
        <aside className="left-panel">
          <div className="panel-card">
            <h3>My chords</h3>
            <div className="chord-list">
              {chords.length === 0 && <div className="mini-note">No saved chords yet. Design one and press Save.</div>}
              {chords.map((c, i) => (
                <div key={i} className={`chord-item ${c.name === doc.name ? 'cur' : ''}`}>
                  <button className="load" onClick={() => loadEntry(c, i)}>{c.name}</button>
                  <span className="cnt">{c.dots.length}</span>
                  <button className="del" onClick={() => deleteEntry(i)} title="Delete">×</button>
                </div>
              ))}
            </div>
            <button className="btn primary wide" onClick={saveToChordList}>💾 Save chord</button>
          </div>

          <div className="panel-card">
            <h3>Export</h3>
            <div className="export-row">
              <button className="btn" onClick={() => doExport('svg')}>SVG</button>
              <button className="btn" onClick={() => doExport('png')}>PNG</button>
              <button className="btn" onClick={() => doExport('jpg')}>JPG</button>
            </div>
            <div className="mini-note">Size {size.w * settings.exportScale}×{size.h * settings.exportScale}px · quality {Math.round(settings.exportQuality * 100)}% — change in Settings.</div>
          </div>

          <div className="panel-card help">
            <h3>How to use</h3>
            <ul>
              <li><b>Click</b> between frets → add/remove dot</li>
              <li><b>Shift+click</b> dot → cycle 7 colors</li>
              <li><b>Ctrl+click</b> dot → cycle 7 shapes</li>
              <li><b>Double-click</b> anything → edit properties</li>
              <li>Text/Fingering tools → click to place</li>
              <li>Select tool: drag text, Del removes</li>
            </ul>
          </div>
        </aside>

        <section className="canvas-area" ref={svgWrapRef}>
          <div
            className="svg-host"
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={onPointerUp}
            onMouseLeave={onPointerUp}
            onClick={onBoardClick}
            onDoubleClick={onDoubleClick}
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        </section>

        {showSettings && (
          <aside className="right-panel">
            <div className="panel-head"><h3>Settings</h3><button className="btn small" onClick={() => setShowSettings(false)}>✕</button></div>
            <SettingsPanel settings={settings} onChange={setSettings} customs={customs} onCustomsChange={setCustoms} />
          </aside>
        )}
      </div>

      {showLib && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowLib(false); }}>
          <div className="dialog lib">
            <div className="dlg-head"><h3>Chord library</h3><button className="btn small" onClick={() => setShowLib(false)}>✕</button></div>
            <div className="lib-grid">
              {CHORD_LIBRARY.map(c => (
                <button key={c.name} className="lib-btn" onClick={() => { setDoc(chordFromLibrary(c.name, c.shape, c.fingerings)); setShowLib(false); flash(`Loaded ${c.name} — adjust freely`); }}>{c.name}</button>
              ))}
            </div>
            <div className="mini-note">Loads dots + fingerings onto the board. You can then recolor, reshape and rename them.</div>
          </div>
        </div>
      )}

      {editing && editItem && (
        <ItemDialog
          kind={editing.kind}
          item={editItem}
          settings={settings}
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
