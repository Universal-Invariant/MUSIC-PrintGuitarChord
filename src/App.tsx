import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from 'react';
import type { ChordDoc, ChordPlacement, Dot, PageConfig, PageDoc, Settings, TextBox } from './lib/types';
import {
  CHORD_SETTING_KEYS, GLOBAL_ONLY_SETTING_KEYS, MIN_NUM_FRETS, applyGlobalBoardScale, applyGlobalSettingsToAllChords,
  bakeInheritedItemsToAllChords, chordPatchFrom, clampNumFrets, clampStartFret, fitsPage,
  sanitizeGlobalValue,
  mergeChordSettings, pageSizePx, placementsOverlap, resolveCollision, snapVal, stripGlobalKeysFromChordDocs,
  syncKeysToAllChords, uid,
} from './lib/types';
import { composePage, cycleColorIndices, cycleShapeIndices, makeDot, renderSvg, svgInner } from './lib/render';
import {
  NUM_STRINGS, canvasSize, cellCenter, dotAlongFret, fingeringPos, fretPositions, hitTest,
  lengthScale, nutZoneDepth, project, stringLayout, unproject, widthScale,
} from './lib/geometry';
import {
  chordFromLibrary, duplicatePage, emptyChord, emptyPage, exportRaster, exportSvg,
  loadActivePageId, loadChordList, loadCustomShapes, loadPages, loadSettings, packRows,
  paginateRows, saveActivePageId, saveChordList, saveCustomShapes, savePages, saveSettings,
} from './lib/storage';
import { CHORD_LIBRARY, analyzeChord, chordMatchesQuery, computeDotLabel, enumerateOctavePositions, midiToName, parseKeyString, shapePitchClasses, shapeRootPc, suggestNoteNames } from './lib/music';
import type { LabelCtx, NoteLabelMode } from './lib/music';
import { HistoryManager } from './lib/history';
import SettingsPanel from './components/SettingsPanel';
import ItemDialog, { newFingering, newText } from './components/ItemDialog';

type Tool = 'dot' | 'text' | 'fing' | 'select';
type Sel = { kind: 'dot' | 'text' | 'fing'; id: string } | null;

/** Approximate on-canvas width of a rendered text box (SVG has no layout API;
 *  average glyph advance ≈ 0.56 × font size is close enough for hit-testing). */
const TEXT_AVG_CHAR_W = 0.56;

/** Distance from a canvas-space point to a text box's rendered extent, using a
 *  generous rectangular hit area that follows the same font/size/anchor rules
 *  as the renderer (inheritable fields resolve against the global defaults).
 *  Returns Infinity-safe value comparable against the pick radius. */
function textHitDist(t: TextBox, s: Settings, w: number, h: number, x: number, y: number): number {
  const cx = t.x * w, cy = t.y * h;
  const size = t.size ?? s.defaultTextSize ?? 14;
  const tw = Math.max(size, (t.text?.length ?? 0) * size * TEXT_AVG_CHAR_W);
  const th = size * 1.3;
  const anchor = t.anchor ?? 'middle';
  const left = anchor === 'start' ? cx - tw * 0.1 : anchor === 'end' ? cx - tw * 0.9 : cx - tw / 2;
  const dx = x < left ? left - x : x > left + tw ? x - (left + tw) : 0;
  // Vertically centered (dominant-baseline: central). Bold/italic widen the
  // glyphs a bit; an underline adds a stroke ~0.62*size below the center, so
  // extend the hit box downward to keep it clickable.
  const halfH = th / 2 + (t.underline && t.text ? size * 0.62 : 0);
  const dy = y < cy - halfH ? (cy - halfH) - y : y > cy + halfH ? y - (cy + halfH) : 0;
  const padX = (t.bold ? size * 0.05 : 0) + (t.italic ? size * 0.1 : 0);
  const ddx = dx === 0 ? 0 : dx + padX;
  return Math.hypot(ddx, dy);
}

/** Intrinsic size of a chord SVG (renderSvg embeds data-w / data-h). */
function intrinsic(markup: string): { w: number; h: number } {
  const m = markup.match(/data-w="(\d+(?:\.\d+)?)" data-h="(\d+(?:\.\d+)?)"/);
  return m ? { w: parseFloat(m[1]), h: parseFloat(m[2]) } : { w: 320, h: 420 };
}

const jsonSnap = (v: unknown) => JSON.parse(JSON.stringify(v));

/** Snapshot of the GLOBAL-only settings (fretboard scale, dot sizing, text
 *  defaults) used as an effect key — fires only when one of THOSE values
 *  actually changes, not on every unrelated settings edit. */
function globalOnlyKey(s: Settings): string {
  return GLOBAL_ONLY_SETTING_KEYS.map(k => JSON.stringify(s[k])).join('|');
}

/** Text-default keys — when one of these changes, chord items that INHERIT
 *  the default (font/size/color left null) must be re-baked so exports and
 *  the print composer render with the current values. */
const TEXT_DEFAULT_KEYS = [
  'defaultTextFont', 'defaultTextColor', 'defaultTextSize', 'defaultTextRotation',
] as const;

/** Global-only keys that are ALWAYS synced into every chord patch whenever
 *  the propagation pass runs (exports/print rely on patches being complete). */
const SYNCED_GLOBAL_KEYS: readonly (keyof Settings)[] = GLOBAL_ONLY_SETTING_KEYS;

/** Keys of `b` whose value differs from `a` (JSON-compared for objects). */
function changedKeysOf(a: Settings, b: Settings): Set<keyof Settings> {
  const out = new Set<keyof Settings>();
  for (const k of Object.keys(b) as (keyof Settings)[]) {
    const av = a[k] as unknown, bv = b[k] as unknown;
    if ((typeof bv === 'object' ? JSON.stringify(av) !== JSON.stringify(bv) : av !== bv)) out.add(k);
  }
  return out;
}

export default function App() {
  // ---------- persisted state ----------
  const [settings, setSettings] = useState<Settings>(() => {
    const s = loadSettings();
    // normalize the GLOBAL-only keys exactly like the load-time patch sanitizer
    // does — otherwise a legacy/corrupt localStorage value (e.g. baseDotSize 4)
    // would render and export with an out-of-range size that no slider can
    // produce, until the user happens to touch that control.
    for (const k of GLOBAL_ONLY_SETTING_KEYS) {
      (s as unknown as Record<string, unknown>)[k] = sanitizeGlobalValue(k, s[k]);
    }
    return s;
  });                                                       // global defaults (sanitized)
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
  const settingsRef = useRef(settings); useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { saveCustomShapes(customs); }, [customs]);
  useEffect(() => { saveChordList(chords); }, [chords]);
  useEffect(() => { savePages(pages); }, [pages]);
  useEffect(() => { saveActivePageId(pages[pageIdx]?.id ?? null); }, [pages, pageIdx]);

  const page = pages[pageIdx];
  // NOTE: read the live index from pageIdxRef (not a captured `pageIdx`) so
  // callbacks created before a page switch still target the CURRENT page.
  const setPage = useCallback((fn: (p: PageDoc) => PageDoc) => {
    setPages(list => list.map((p, i) => (i === pageIdxRef.current ? fn(structuredClone(p)) : p)));
  }, []);

  /** Post-process a page so NO chord box overlaps another. Chords that do are
   *  nudged to the nearest free spot by resolveCollision(). Applied after every
   *  structural mutation (add / scale / refit / auto-layout / import).
   *  Honors the per-page "Allow overlap" flag: when it is checked, collision
   *  detection is skipped entirely and only page-bound clamping remains. */
  const ensureNoOverlaps = (p: PageDoc): PageDoc => {
    if (p.config.allowOverlap) return p;
    const ps = pageSizePx(p.config);
    for (const id of Object.keys(p.placements)) {
      const others = Object.entries(p.placements)
        .filter(([k]) => k !== id)
        .map(([, v]) => v);
      p.placements[id] = resolveCollision(p.placements[id], others, ps);
    }
    return p;
  };

  const selectedId = page?.selected ?? null;
  const selIdx = page?.chords.findIndex(c => c.id === selectedId) ?? -1;
  const entry: ChordDoc | null = selIdx >= 0 ? page.chords[selIdx] : null;

  // effective settings of the SELECTED chord = global defaults ⊕ its patch
  const eff: Settings = useMemo(
    () => (entry ? applyGlobalBoardScale(mergeChordSettings(settings, entry.settings), settings) : settings),
    [settings, entry],
  );

  // ---------- GLOBAL settings propagate to EVERY chord (opt-in toggle) ----------
  // The toolbar "Apply changes to all chords" switch decides the mode:
  //   ON  ⇒ every edit made through the Settings panel is applied as if it were
  //         a global one — we iterate over ALL chords (every page AND the saved
  //         library) and sync the edited values into each chord's own patch:
  //           foreach (chord in chords) chord.apply(change)
  //   OFF ⇒ only the currently SELECTED chord receives per-chord edits (the
  //         app-wide GLOBAL-only sliders/text defaults still affect every
  //         chord automatically, exactly as before).
  // Keyed on a snapshot of ONLY the relevant keys so unrelated state edits
  // never trigger it; the helpers return the SAME array instance when nothing
  // changed, so this can never loop renders.
  const [applyAllChords, setApplyAllChords] = useState<boolean>(() => {
    try { return localStorage.getItem('gc_apply_all_chords') === '1'; } catch { return false; }
  });
  const applyAllRef = useRef(applyAllChords); useEffect(() => { applyAllRef.current = applyAllChords; }, [applyAllChords]);
  const toggleApplyAll = () => setApplyAllChords(v => { const nv = !v; try { localStorage.setItem('gc_apply_all_chords', nv ? '1' : '0'); } catch { /* ignore */ } return nv; });

  /** Snapshot of the keys whose change should fire the propagation pass:
   *  always the GLOBAL-only keys; plus ALL per-chord setting keys while the
   *  apply-to-all toggle is active. */
  function propagationKey(s: Settings): string {
    const keys: (keyof Settings)[] = applyAllRef.current
      ? [...new Set<(keyof Settings)>([...GLOBAL_ONLY_SETTING_KEYS, ...CHORD_SETTING_KEYS])]
      : GLOBAL_ONLY_SETTING_KEYS;
    return keys.map(k => JSON.stringify(s[k])).join('|');
  }
  // Baseline snapshot of the settings used to diff WHICH keys changed since
  // the last propagation pass (kept in a ref so it never triggers renders).
  const prevSnapRef = useRef<Settings | null>(null);
  const prevPropKeyRef = useRef<string>('');
  // Live mirror of the selected chord's effective settings — in apply-to-all
  // mode, edits made on a chord broadcast THAT chord's value to every chord
  // ("make all chords look like this one"), not the app-wide default.
  const effRef = useRef<Settings>(settings); useEffect(() => { effRef.current = eff; }, [eff]);
  const propKeyStr = propagationKey(settings);
  useEffect(() => {
    // First run after mount / toggle flip: just record the baseline — no
    // retroactive broadcast (the toggle must not flood history with an undo
    // step for edits that happened before it was turned on).
    if (!prevSnapRef.current || !prevPropKeyRef.current) {
      prevSnapRef.current = jsonSnap(settings);
      prevPropKeyRef.current = propKeyStr;
      return;
    }
    const first = prevPropKeyRef.current !== propKeyStr && !applyAllRef.current;
    prevPropKeyRef.current = propKeyStr;
    if (!applyAllRef.current && !first) { prevSnapRef.current = jsonSnap(settings); return; } // selected-only mode: nothing to do
    pushHistory();
    const src = settingsRef.current;
    // Which patch keys each chord receives:
    //  • global-only keys are ALWAYS synced (they must live in every patch so
    //    exports / print composer render with the current values);
    //  • in apply-to-all mode, every per-chord key edited since the last pass
    //    is synced too — from the GLOBAL defaults when editing globally, or
    //    from the selected chord's effective settings when editing a chord
    //    ("make all chords look like this one").
    const gChanged = GLOBAL_ONLY_SETTING_KEYS.filter(k => first || changedKeysOf(prevSnapRef.current!, src).has(k));
    let keys: (keyof Settings)[] = [...new Set<(keyof Settings)>([...SYNCED_GLOBAL_KEYS, ...gChanged])];
    let valueSrc: Settings = src;
    if (!first && applyAllRef.current) {
      // Apply-to-ALL is ON: broadcast whatever just changed. If a chord is
      // selected we take its LIVE effective values ("make every chord look
      // like this one"); otherwise the global defaults win. Reading from
      // refs keeps this correct even when React batches several edits.
      const live: Settings = (selectedId && entry) ? effRef.current : src;
      const edited = changedKeysOf(prevSnapRef.current!, src);
      const ch = CHORD_SETTING_KEYS.filter(k => edited.has(k));
      if (ch.length) {
        keys = [...keys, ...ch];
        valueSrc = live;
      }
      // Also re-sync the always-global keys from the same live source so a
      // selected chord's inherited global values propagate consistently.
      for (const k of SYNCED_GLOBAL_KEYS) if (edited.has(k)) valueSrc = live;
    }
    prevSnapRef.current = jsonSnap(settings);
    const textDefaultEdited = keys.some(k => (TEXT_DEFAULT_KEYS as readonly string[]).includes(k as string));
    const applyTo = (list: ChordDoc[]): ChordDoc[] => {
      let out = syncKeysToAllChords(list, valueSrc, keys);
      if (textDefaultEdited) out = bakeInheritedItemsToAllChords(out, valueSrc);
      return out;
    };
    setPages(list => {
      let changed = false;
      const out = list.map(p => {
        const nextChords = applyTo(p.chords);
        if (nextChords === p.chords) return p;
        changed = true;
        return { ...p, chords: nextChords };
      });
      return changed ? out : list;
    });
    setChords(list => applyTo(list));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propKeyStr]);

  // ---------- editing state ----------
  const [tool, setTool] = useState<Tool>('dot');
  const [sel, setSel] = useState<Sel>(null);
  const [editing, setEditing] = useState<Sel>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLib, setShowLib] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<boolean>(() => localStorage.getItem('gcd.inlineEdit') === '1');
  useEffect(() => { localStorage.setItem('gcd.inlineEdit', inlineEdit ? '1' : '0'); }, [inlineEdit]);
  /** Synchronous drag state. Mouse handlers run in DOM order and the mousedown
   *  that ARMS a gesture must immediately suppress the click/dblclick follow-ups
   *  — waiting for a state commit would let those stale events re-toggle the
   *  gesture or open dialogs mid-drag. */
  const draggingRef = useRef(false);
  const [pageDrag, setPageDrag] = useState(false);       // chord box drag on the page
  const dragRef = useRef<{ id: string; kind: 'dot' | 'text'; itemId: string; dx: number; dy: number } | null>(null);
  const pageDragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const lastClickRef = useRef<{ x: number; y: number; t: number; id?: string } | null>(null);
  /** Press origin (client px) + moved flag for an item drag started via
   *  beginItemDrag - lets the release tell a plain CLICK (open dialog) apart
   *  from a DRAG (reposition silently). */
  const itemDragPressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  /** True right after beginItemDrag: the next applyItemDrag re-measures the
   *  grab offset against the freshly rendered doc (see beginItemDrag). */
  const pendingReanchorRef = useRef(false);
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

  /** After an undo/restore, drop stale selection so a brand-new chord can be
   *  added immediately (a dangling `selected` id used to make addChordToPage
   *  silently do nothing — "the new chord never appears"). */
  useEffect(() => {
    if (!page) return;
    if (page.selected && !page.chords.some(c => c.id === page.selected)) {
      setPages(list => list.map((p, i) => (i === pageIdx ? { ...p, selected: null } : p)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  /** Record the CURRENT page-list state before a mutation (clears redo).
   *  Suppressed while a continuous drag gesture is in progress so an entire
   *  drag coalesces into the single snapshot taken at gesture start. */
  const pushHistory = useCallback(() => {
    if (histPausedRef.current) return;
    hist.commit('pages', jsonSnap(pagesRef.current));
    // library changes ride along with the page snapshot so a single Ctrl+Z
    // reverts BOTH sides of e.g. "save chord to library" in one step
    if (libDirtyRef.current) {
      libDirtyRef.current = false;
      hist.commit('chords', jsonSnap(chordsRef.current));
    }
  }, [hist]);

  /** Record the CURRENT library state before a mutation. Deferred into the
   *  next pushHistory() call so page + library mutate as ONE undo step. */
  const libDirtyRef = useRef(false);
  const pushLibHistory = useCallback(() => { libDirtyRef.current = true; }, []);

  // ---------- global TRANSPOSE (one-shot pitch edit, NOT a persistent setting) ----------
  const NOTE_NAME_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const TR_SKIP_WORDS = new Set(['x', 'o', 'open', 'muted']);
  /** Rewrite one pitch-bearing label by shifting its semitone value by n.
   *  Handles plain names ('A#', 'Bb'), names with octave digits ('E2') and
   *  accidental-only labels ('#', 'bb' ⇒ +1/-2). Returns null when the string
   *  is not a pitch label (fingering numbers, R/m3/P5, degrees, 'x'…) so those
   *  survive a transpose untouched. */
  const shiftPitchLabel = (raw: string, n: number): string | null => {
    const t = raw.trim();
    if (!t || TR_SKIP_WORDS.has(t.toLowerCase())) return null;
    // accidental-only label: '#' / '♯' / '+' per sharp, 'b' / '♭' per flat
    if (/^[#+♯b♭s]+$/.test(t)) {
      let d = 0;
      for (const ch of t) d += (ch === '#' || ch === '♯' || ch === '+') ? 1 : -1;
      const nd = (((d + n) % 12) + 12) % 12;
      if (nd === 0) return '';                       // cancelled back to natural
      return nd <= 6 ? '#'.repeat(nd) : 'b'.repeat(12 - nd);
    }
    const m = t.match(/^([A-Ga-g])((?:[#b♯♭][#b♯♭]*)?)(.*)$/);
    if (!m) return null;
    const base = NOTE_NAME_PC[m[1].toUpperCase()];
    if (base == null) return null;
    let pc = base;
    for (const ch of m[2]) pc += (ch === '#' || ch === '♯') ? 1 : -1;
    pc = ((pc + n) % 12 + 12) % 12;
    const rest = m[3] ?? '';
    const preferFlat = /[b♭]/.test(m[2]) || /^(b|#b)/.test(rest); // keep the chord's spelling bias
    return midiToName(pc + 60, preferFlat) + rest;
  };
  /** Global "wrap octave" toggle (toolbar, next to Transpose): when ON, a
   *  transpose keeps every dot inside its own octave band — a fret f in band
   *  B = floor(f/12) lands at B·12 + ((f − B·12 + n) mod 12), so dots pushed
   *  past the top of their octave wrap back to its bottom instead of leaving a
   *  gap. One-shot edit flag: it only affects the NEXT transpose, then resets. */
  const [transposeWrap, setTransposeWrap] = useState(false);
  const transposeWrapRef = useRef(transposeWrap);
  useEffect(() => { transposeWrapRef.current = transposeWrap; }, [transposeWrap]);
  /** Transpose EVERY sounding pitch of one chord up by n semitones — purely by
   *  modifying values in place (per-chord tuning, dot frets, explicit root/key,
   *  custom dot texts and auto note labels), never as a stored/render-time
   *  "transpose" setting. Open-string pitch names and letter-mode dot labels
   *  are DERIVED from `tuning` at draw time, so shifting the tuning array
   *  shifts them automatically — nothing to bake there. When `wrap` is true
   *  each dot's new fret wraps WITHIN ITS OWN OCTAVE BAND (see above). */
  const transposeChordDoc = (src: ChordDoc, n: number, gdef: Settings, wrap = false): ChordDoc => {
    const c = structuredClone(src);
    const s = mergeChordSettings(gdef, c.settings);
    // 1) Tuning patch: shifting every open string shifts ALL pitches equally —
    //    including the derived open-note ring and letter-mode labels. Only
    //    touch it when the chord actually carries its own tuning override.
    //    (Wrap mode leaves the tuning untouched: dots move within their octave
    //    bands, so open-string pitches must not shift.)
    if (!wrap && c.settings && Array.isArray(c.settings.tuning)) {
      c.settings.tuning = (c.settings.tuning as number[]).map(m => (typeof m === 'number' ? m + n : m));
    }
    // 2) Dot frets: absFret + n keeps each dot's actual pitch in sync with the
    //    shifted tuning (relative slot stays identical ⇒ shape does not move).
    //    WRAP mode: keep the dot inside its octave band — the pitch class
    //    still shifts by n, but high frets fold back down into the same octave
    //    (e.g. fret 11 +5 → 4, fret 17 +5 → 16) so transposed runs stay dense.
    for (const d of c.dots) {
      if (wrap) {
        const band = Math.floor(d.fret / 12) * 12;
        d.fret = band + (((d.fret - band + n) % 12) + 12) % 12;
      } else {
        d.fret += n;
      }
      if (d.text) { const r = shiftPitchLabel(d.text, n); if (r !== null) d.text = r; }
    }
    // 3) Explicit root pitch class (-1 ⇒ auto/lowest note — stays correct via
    //    the shifted tuning+frets) and explicit key string ("F", "Dm"…).
    if (c.settings && typeof c.settings.noteRootPc === 'number' && c.settings.noteRootPc >= 0) {
      c.settings.noteRootPc = (c.settings.noteRootPc + n) % 12;
    }
    if (c.settings && typeof c.settings.noteKey === 'string' && c.settings.noteKey.trim()) {
      const k = parseKeyString(c.settings.noteKey);
      if (k) {
        const nk = midiToName(((k.rootPc + n) % 12 + 12) % 12, !!s.preferFlats);
        c.settings.noteKey = nk + (k.minor ? 'm' : '');
      }
    }
    // 4) Auto note labels: letter-mode labels are derived from tuning+fret at
    //    render time (already shifted above). When labels were auto-filled in
    //    a non-letter mode they live in dot.text — recompute them against the
    //    NEW transposed board so they stay truthful.
    const anyAuto = c.dots.some(d => !d.text && s.noteVisible && s.noteLabelMode !== 'letter');
    if (anyAuto) {
      const ctx: LabelCtx = {
        mode: s.noteLabelMode,
        soundingAbs: c.dots.map(d => ({ string: d.string, abs: d.fret })),
        tuning: s.tuning, startFret: s.startFret, preferFlats: !!s.preferFlats,
        rootPc: (s.noteRootPc ?? -1) >= 0 ? s.noteRootPc : shapeRootPc(c.dots, s.tuning),
        key: s.noteKey || null,
      };
      for (const d of c.dots) if (!d.text) d.text = computeDotLabel(d.string, d.fret, ctx);
    }
    return c;
  };
  /** Toolbar handler: +0..+11 semitones. Scope follows the apply-to-all toggle:
   *  ON ⇒ every chord on every page AND the saved library; OFF ⇒ only the
   *  currently selected chord. Recorded as ONE undo step (pages + library). */
  const onTranspose = (n: number) => {
    if (!Number.isFinite(n) || n === 0) return;
    const scopeAll = applyAllRef.current;
    if (!scopeAll && !selectedId) { flash('Select a chord first, or switch to 🌐 All chords'); return; }
    // Consume the wrap toggle: it applies to THIS transpose only, then resets.
    const wrap = transposeWrapRef.current;
    if (wrap) setTransposeWrap(false);
    pushHistory();
    pushLibHistory();
    const gdef = settingsRef.current;
    setPages(list => list.map(p => ({
      ...p,
      chords: p.chords.map(c => (scopeAll || c.id === selectedId) ? transposeChordDoc(c, n, gdef, wrap) : c),
    })));
    if (scopeAll) setChords(list => list.map(c => transposeChordDoc(c, n, gdef, wrap)));
    flash(`${wrap ? '⟲ Wrapped ' : 'Transposed '}${scopeAll ? 'ALL chords' : `"${entry?.name ?? 'chord'}"`} up ${n} semitone${n === 1 ? '' : 's'} (${n} → +${n})${wrap ? ' — octave-wrapped' : ''}`);
  };

  /** Page-level ops that MUST create a new page object: React bails out of a
   *  state update when the updater returns the SAME reference it was given, so
   *  in-place mutation + `return p` used to leave the UI stale until some other
   *  action forced a re-render (e.g. "Paste settings" appeared to do nothing). */
  const setPageObj = useCallback((fn: (p: PageDoc) => PageDoc) => {
    setPages(list => list.map((p, i) => (i === pageIdxRef.current ? fn(structuredClone(p)) : p)));
  }, []);

  /** Mutate the selected chord doc (history-aware). */
  const mutate = useCallback((fn: (d: ChordDoc) => ChordDoc) => {
    if (!selectedId) return;
    pushHistory();
    setPage(p => {
      const i = p.chords.findIndex(c => c.id === selectedId);
      if (i < 0) return p;
      // Return a NEW page object (shallow copy with the replaced chord) instead
      // of mutating-and-returning the same reference: React bails out when a
      // state updater returns identity, so in-place mutation used to leave the
      // UI showing stale data until some *other* action re-rendered.
      const next = [...p.chords];
      next[i] = fn(structuredClone(next[i]));
      return { ...p, chords: next };
    });
  }, [selectedId, setPage, pushHistory]);

  /** Mutate ANY chord doc by id (history-aware) — used by inline page editing
   *  where the clicked chord may not be the selected one yet. */
  const mutateOn = useCallback((id: string, fn: (d: ChordDoc) => ChordDoc) => {
    pushHistory();
    setPage(p => {
      const i = p.chords.findIndex(c => c.id === id);
      if (i < 0) return p;
      const next = [...p.chords];
      next[i] = fn(structuredClone(next[i]));
      return { ...p, chords: next };
    });
  }, [setPage, pushHistory]);

  /** Mutate the selected chord's per-chord settings patch (history-aware). */
  const setEff = useCallback((next: Settings) => {
    if (!selectedId) return;
    pushHistory();
    setPage(p => {
      const i = p.chords.findIndex(c => c.id === selectedId);
      if (i < 0) return p;
      const nc = structuredClone(p.chords[i]);
      nc.settings = chordPatchFrom(next);
      const arr = [...p.chords];
      arr[i] = nc;
      return { ...p, chords: arr };
    });
  }, [selectedId, setPage, pushHistory]);

  /** Quick-settings variant: patch ONLY the given fields of the selected
   *  chord's effective settings (everything else stays untouched). */
  const setEffPatch = useCallback((patch: Partial<Settings>) => {
    setEff({ ...eff, ...patch });
  }, [setEff, eff]);

  // ---------- quick note-label helpers (toolbar in the chord editor) ----------
  /** Add every octave of EVERY pitch class currently sounding on the board
   *  that fits inside the visible fret range (positions outside are clipped). */
  const fillAllOctaves = () => {
    if (!entry) return;
    pushHistory();
    mutate(d => {
      const pcs = shapePitchClasses(d.dots, eff.tuning);
      for (const pos of enumerateOctavePositions(pcs, d.dots, eff)) {
        d.dots.push(makeDot(eff, pos.string, pos.fret - eff.startFret));
      }
      return d;
    });
  };

  /** Remove every dot whose pitch-class octave twin already exists elsewhere,
   *  keeping the lowest-fret representative of each pitch class. This is the
   *  inverse of octave-fill (safe to run even when nothing needs removing). */
  const dedupeOctaves = () => {
    if (!entry) return;
    pushHistory();
    mutate(d => {
      const byPc = new Map<number, typeof d.dots>();
      for (const dot of d.dots) {
        const m = (eff.tuning[dot.string] ?? 64) + Math.max(0, dot.fret);
        const pc = ((m % 12) + 12) % 12;
        const arr = byPc.get(pc) ?? [];
        arr.push(dot);
        byPc.set(pc, arr);
      }
      const keep = new Set<string>();
      for (const arr of byPc.values()) {
        arr.sort((a, b) => a.fret - b.fret || a.string - b.string);
        keep.add(arr[0].id);           // always keep the lowest representative
      }
      d.dots = d.dots.filter(dot => keep.has(dot.id));
      return d;
    });
  };

  /** Cycle the tonal/interval reference key: auto → F → Bb → Eb → Ab → Db → G → C. */
  const KEY_CYCLE = ['', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'C', 'G'];
  const cycleKey = () => {
    const cur = eff.noteKey.trim();
    let i = KEY_CYCLE.indexOf(cur);
    if (i < 0) i = 0;
    const next = KEY_CYCLE[(i + 1) % KEY_CYCLE.length];
    setEffPatch({ noteKey: next });
    flash(next ? `Key: ${next}` : 'Key: auto (root of shape)');
  };

  /** Cycle the tonal spelling preference: sharps → flats. */
  const cycleAccidental = () => {
    setEffPatch({ preferFlats: !eff.preferFlats });
    flash(eff.preferFlats ? 'Spelling: ♯ sharps' : 'Spelling: ♭ flats');
  };

  /** Cycle the explicit root pitch class: auto → C → C#/Db → … → B → auto. */
  const QUICK_ROOTS = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];
  const cycleRoot = () => {
    const cur = eff.noteRootPc;
    const next = cur == null || cur < 0 ? 0 : cur >= 11 ? -1 : cur + 1;
    setEffPatch({ noteRootPc: next });
    flash(next < 0 ? 'Root: auto (lowest note)' : `Root: ${QUICK_ROOTS[next]}`);
  };

  // ---------- quick-settings toolbar (chord editor) ----------
  const NOTE_MODE_META: Record<NoteLabelMode, { icon: string; name: string; hint: string }> = {
    letter:   { icon: '♪', name: 'Letter', hint: 'Notes mode — label every dot with its actual pitch name (A, Bb, F#…) computed from tuning + fret.' },
    interval: { icon: '↔', name: 'Interval', hint: 'Intervals mode — label dots by distance from the root (R, m2, M3, P5, TT…).' },
    tonal:    { icon: '𝄟', name: 'Tonal', hint: 'Tonal mode — scale degrees of the key (1, b3, #4…); non-diatonic notes get accidental prefixes.' },
    degree:   { icon: '#', name: 'Degree', hint: 'Degree mode — chromatic numbering with root = 1 (1..12, octave = 8/1+).' },
  };
  const MODE_ORDER: NoteLabelMode[] = ['letter', 'interval', 'tonal', 'degree'];
  const cycleNoteMode = () => {
    const i = MODE_ORDER.indexOf(eff.noteLabelMode);
    const next = MODE_ORDER[(i + 1) % MODE_ORDER.length];
    setEffPatch({ noteLabelMode: next });
    flash(`Labels: ${NOTE_MODE_META[next].name}`);
  };
  const keyLabel = eff.noteKey.trim() === '' ? 'auto' : eff.noteKey.trim();
  const rootLabel = eff.noteRootPc == null || eff.noteRootPc < 0 ? 'auto' : QUICK_ROOTS[eff.noteRootPc];

  // delayed tooltip (500 ms hover) for the quick-settings toolbar
  const qbarRef = useRef<HTMLDivElement>(null);
  const qtipTimer = useRef<number | undefined>(undefined);
  const showQTip = useCallback((e: RMouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest?.('.qbtn') as HTMLElement | null;
    if (!btn || !qbarRef.current) return;
    window.clearTimeout(qtipTimer.current);
    qtipTimer.current = window.setTimeout(() => {
      const tipEl = qbarRef.current?.querySelector('.qtip') as HTMLElement | null;
      if (!tipEl) return;
      tipEl.textContent = btn.dataset.tip ?? '';
      tipEl.style.left = `${btn.offsetLeft + btn.offsetWidth / 2}px`;
      tipEl.classList.add('show');
    }, 500);
  }, []);
  const hideQTip = useCallback(() => {
    window.clearTimeout(qtipTimer.current);
    const tipEl = qbarRef.current?.querySelector('.qtip') as HTMLElement | null;
    tipEl?.classList.remove('show');
  }, []);

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
  // live ref so drag handlers (created once per render) always measure
  // against the CURRENT board, never a stale closure value
  const sizeRef = useRef(size);
  useEffect(() => { sizeRef.current = size; }, [size]);
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
        const es = applyGlobalBoardScale(mergeChordSettings(settings, c.settings), settings);
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
  // ---------- per-element coordinate mapping (SVG screen CTMs) ----------
  // Each chord box registers its <g> element and each page its <svg>. All
  // pointer math goes through the CURRENT PAGE's single screen CTM plus the
  // clicked chord's OWN placement (x, y, scale) — never another chord's data.
  // (The historical bug: lookups keyed off the wrong entry returned the FIRST
  // chord's coordinates, so every other chord jumped by ~one chord width.)
  const gRefs = useRef(new Map<string, SVGGElement>());
  const svgRefs = useRef(new Map<number, SVGSVGElement>());

  /** Current page's <svg> element (live, from the ref registry). */
  const currentPageSvg = (): SVGSVGElement | null => {
    const el = svgRefs.current.get(pageIdx);
    if (el) return el;
    const q = printRef.current?.querySelector(`.page-sheet[data-page-idx="${pageIdx}"] .page-svg`);
    return q instanceof SVGSVGElement ? q : null;
  };

  /** Client px -> page-space coords of page `pi` (via that sheet's screen CTM). */
  const toPageCoordsAt = (clientX: number, clientY: number, piOverride?: number): { x: number; y: number } => {
    const pi = piOverride ?? pageIdx;
    let svg: SVGSVGElement | null = null;
    if (pi === pageIdx) svg = currentPageSvg();
    else {
      const q = printRef.current?.querySelector(`.page-sheet[data-page-idx="${pi}"] .page-svg`);
      svg = q instanceof SVGSVGElement ? q : null;
    }
    if (!svg) return { x: NaN, y: NaN };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: NaN, y: NaN };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const toPageCoords = (e: { clientX: number; clientY: number }) => toPageCoordsAt(e.clientX, e.clientY);

  /** Page index whose sheet contains the given client point (-1 = none). */
  const pageAtClient = (clientX: number, clientY: number): number => {
    for (const [pi, el] of svgRefs.current) {
      try {
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return pi;
      } catch { /* detached */ }
    }
    return -1;
  };

  /** Client px -> local coords inside chord `id`'s canvas space, derived from
   *  the shared page matrix + THAT chord's placement (x, y, scale). */
  const toChordLocalById = (id: string, clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!page) return null;
    const pl = page.placements[id];
    if (!pl) return null;
    const pt = toPageCoords({ clientX, clientY });
    if (!Number.isFinite(pt.x)) return null;
    return { x: (pt.x - pl.x) / pl.scale, y: (pt.y - pl.y) / pl.scale };
  };

  /** Which chord box contains the given client point? Uses each registered
   *  <g>'s bounding box in SCREEN space — always fresh, never stale. The
   *  smallest containing box wins so nested/overlapping boxes resolve to the
   *  most specific chord. */
  const chordAtClient = (clientX: number, clientY: number): string | null => {
    let best: string | null = null;
    let bestArea = Infinity;
    for (const [cid, el] of gRefs.current) {
      let r: DOMRect;
      try { r = el.getBoundingClientRect(); } catch { continue; }
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        const area = r.width * r.height;
        if (area < bestArea) { bestArea = area; best = cid; }
      }
    }
    return best;
  };

  const findDotAt = (string: number, rel: number): Dot | undefined =>
    entry?.dots.find(d => d.string === string && d.fret - eff.startFret === rel);

  // ---------- chord-board interactions (shared by the external editor AND
  //            inline editing on the page). `local` is a point in the chord's
  //            own canvas coordinate space. When `id` is omitted, acts on the
  //            selected chord (external-editor path). ----------

  /** Same-string octave twins of a dot: fret ± 12·k (k = -5..5), i.e. the SAME
   *  pitch class played at the same string position one or more octaves away.
   *  Used by the "Mirror across octaves on same string" setting — the
   *  fine-grained sibling of 8va (octaveMode), which mirrors across strings. */
  const MIRROR_KS = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5];
  const sameStringTwins = (dots: Dot[], anchor: Dot): Dot[] =>
    dots.filter(dd => dd.id !== anchor.id && dd.string === anchor.string
      && Math.abs(dd.fret - anchor.fret) % 12 === 0);
  /** Mirror an ADD: clone the new dot to every ±12-fret twin slot that is free
   *  (never duplicates an existing dot; negative frets are skipped). */
  const mirrorAdd = (d: ChordDoc, nd: Dot, es: Settings): Dot[] => {
    if (!es.mirrorOctaves || es.octaveMode) return [];
    const out: Dot[] = [];
    for (const k of MIRROR_KS) {
      const f = nd.fret + 12 * k;
      if (f < 0) continue;
      if (d.dots.some(x => x.string === nd.string && x.fret === f)) continue;
      out.push({ ...structuredClone(nd), id: uid(), fret: f });
    }
    return out;
  };
  /** Mirror a REMOVE: drop the anchor dot plus its same-string octave twins. */
  const mirrorRemove = (dots: Dot[], anchor: Dot, es: Settings): Dot[] =>
    es.mirrorOctaves && !es.octaveMode
      ? dots.filter(dd => dd.id !== anchor.id && !(dd.string === anchor.string && Math.abs(dd.fret - anchor.fret) % 12 === 0))
      : dots.filter(dd => dd.id !== anchor.id);
  /** Mirror a PROPERTY EDIT: copy every changed visual/text field from the
   *  edited dot onto its same-string octave twins (twins keep their own id
   *  and fret). */
  const mirrorPropEdit = (dots: Dot[], edited: Dot, es: Settings): Dot[] => {
    if (!es.mirrorOctaves || es.octaveMode) return dots;
    const twins = sameStringTwins(dots, edited);
    if (!twins.length) return dots;
    const tw = new Set(twins.map(t => t.id));
    return dots.map(dd => tw.has(dd.id) ? {
      ...dd,
      colorIdx: edited.colorIdx, shapeIdx: edited.shapeIdx, text: edited.text,
      font: edited.font, textColor: structuredClone(edited.textColor ?? null),
      textSize: edited.textSize, transparency: edited.transparency, rotation: edited.rotation,
    } : dd);
  };

  const toggleDotAt = (hit: { string: number; rel: number }, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, id?: string) => {
    const cid = id ?? selectedId;
    if (!cid || !page) return;
    const doc = page.chords.find(c => c.id === cid);
    if (!doc) return;
    const es = id && id !== selectedId ? applyGlobalBoardScale(mergeChordSettings(settings, doc.settings), settings) : eff;
    const existing = doc.dots.find(d => d.string === hit.string && d.fret - es.startFret === hit.rel);
    const cycleColor = cycleColorIndices(es);
    const cycleShape = cycleShapeIndices(es);
    mutateOn(cid, d => {
      if (e.shiftKey && existing) {
        // OCTAVE MODE: cycle the colour of every octave twin too, so one
        // shift-click restyles all copies of the pitch class at once.
        const pcOf = (dot: Dot) => {
          const m = (es.tuning[dot.string] ?? 64) + Math.max(0, dot.fret);
          return ((m % 12) + 12) % 12;
        };
        const targetPc = pcOf(existing);
        for (const dd of d.dots) {
          if (!es.octaveMode || dd.id === existing.id || pcOf(dd) === targetPc) {
            const pos = cycleColor.indexOf(dd.colorIdx);
            dd.colorIdx = cycleColor[(pos + 1) % cycleColor.length] ?? 0;
          }
        }
        // MIRROR mode: the cycled dot's same-string octave twins get the SAME
        // resulting color (one click restyles every ±12-fret copy).
        if (es.mirrorOctaves && !es.octaveMode) {
          const anchor = d.dots.find(x => x.id === existing.id)!;
          for (const t of sameStringTwins(d.dots, anchor)) t.colorIdx = anchor.colorIdx;
        }
        return d;
      }
      if ((e.ctrlKey || e.metaKey) && existing) {
        // Same idea for shapes: ctrl-click cycles every octave twin's shape.
        const pcOf = (dot: Dot) => {
          const m = (es.tuning[dot.string] ?? 64) + Math.max(0, dot.fret);
          return ((m % 12) + 12) % 12;
        };
        const targetPc = pcOf(existing);
        for (const dd of d.dots) {
          if (!es.octaveMode || dd.id === existing.id || pcOf(dd) === targetPc) {
            const pos = cycleShape.indexOf(dd.shapeIdx);
            dd.shapeIdx = cycleShape[(pos + 1) % cycleShape.length] ?? 0;
          }
        }
        if (es.mirrorOctaves && !es.octaveMode) {
          const anchor = d.dots.find(x => x.id === existing.id)!;
          for (const t of sameStringTwins(d.dots, anchor)) t.shapeIdx = anchor.shapeIdx;
        }
        return d;
      }
      if (existing) {
        // OCTAVE MODE: removing a note also removes every octave twin of its
        // pitch class — the exact inverse of octave-aware dot placement above.
        if (es.octaveMode) {
          const pcOf = (dot: Dot) => {
            const m = (es.tuning[dot.string] ?? 64) + Math.max(0, dot.fret);
            return ((m % 12) + 12) % 12;
          };
          const targetPc = pcOf(existing);
          return { ...d, dots: d.dots.filter(dd => dd.id !== existing.id && pcOf(dd) !== targetPc) };
        }
        // MIRROR mode: removing a note also removes its ±12-fret twins on the
        // same string (the fine-grained equivalent of the 8va removal above).
        return { ...d, dots: mirrorRemove(d.dots, existing, es) };
      }
      const nd = makeDot(es, hit.string, hit.rel);
      d.dots.push(nd);
      // MIRROR mode: clone the new dot onto every free ±12-fret slot of the
      // same string — same pitch, one or more octaves away (k = -5..5).
      d.dots.push(...mirrorAdd({ ...d, dots: [nd] }, nd, es));
      // OCTAVE MODE: also drop every octave of the new note that falls inside
      // the visible fret range (positions outside startFret..last are clipped).
      if (es.octaveMode) {
        const pc = (((es.tuning[hit.string] ?? 64) + Math.max(0, hit.rel + es.startFret)) % 12 + 12) % 12;
        for (const pos of enumerateOctavePositions(new Set([pc]), d.dots, es)) {
          d.dots.push(makeDot(es, pos.string, pos.fret - es.startFret));
        }
      }
      return d;
    });
  };

  /** One click inside a chord board with an EDITING tool (strict hit-test). */
  const handleBoardClickLocal = (local: { x: number; y: number }, e: React.MouseEvent, id?: string): boolean => {
    if (draggingRef.current) return true;      // mid drag gesture — swallow stale clicks
    const cid = id ?? selectedId;
    if (!cid || !page) return false;
    const doc = page.chords.find(c => c.id === cid);
    if (!doc) return false;
    const es = id && id !== selectedId ? applyGlobalBoardScale(mergeChordSettings(settings, doc.settings), settings) : eff;
    const sz = id && id !== selectedId ? canvasSize(es) : size;
    const { x, y } = local;
    const hit = hitTest(es, x, y);

    if (tool === 'dot' && hit) { toggleDotAt(hit, e, cid); return true; }

    if (tool === 'text') {
      // Clicking ON an existing text box with the Text tool edits that box
      // instead of stacking a new one on top of it.
      const existing = pickItemAt(cid, x, y);
      if (existing && existing.kind === 'text') {
        // Arm a drag-or-edit gesture: moving repositions the box, releasing
        // without movement opens its edit dialog (see endItemDrag).
        beginItemDrag(cid, existing, local, { x: e.clientX, y: e.clientY });
        return true;
      }
      const t = newText(es, x / sz.w, y / sz.h);
      mutateOn(cid, d => { d.texts.push(t); return d; });
      setSel({ kind: 'text', id: t.id });
      setEditing({ kind: 'text', id: t.id });
      return true;
    }

    if (tool === 'fing' && hit) {
      const existing = doc.fingerings.find(f => f.string === hit.string);
      if (existing) {
        setSel({ kind: 'fing', id: existing.id });
        setEditing({ kind: 'fing', id: existing.id });
      } else {
        const f = newFingering(es, hit.string);
        mutateOn(cid, d => { d.fingerings.push(f); return d; });
        setSel({ kind: 'fing', id: f.id });
        setEditing({ kind: 'fing', id: f.id });
      }
      return true;
    }

    setSel(pickItemAt(cid, x, y));
    return true;
  };

  /** Double-click / Alt+click / right-click inside a chord board → edit dialog. */
  const openEditLocal = (local: { x: number; y: number }, id?: string) => {
    if (draggingRef.current) return;           // mid drag gesture — swallow stale events
    const cid = id ?? selectedId;
    if (!cid) return;
    lastClickRef.current = null;
    const s = pickItemAt(cid, local.x, local.y);
    if (s) { setSel(s); setEditing(s); }
  };

  // ---------- click on the selected chord board (external editor) ----------
  const onBoardClick = (e: React.MouseEvent) => {
    if (!entry || draggingRef.current || pageDrag) return;
    e.stopPropagation();
    // Some browsers suppress dblclick when the second click's default is prevented
    // anywhere in its path — implement double-click manually (400 ms / 8 px window).
    const now = performance.now();
    const prev = lastClickRef.current;
    if (prev && !prev.id && now - prev.t < 400 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 8) {
      lastClickRef.current = null;
      openEditAt(e);            // double-click → open the edit dialog
      return;
    }
    lastClickRef.current = { x: e.clientX, y: e.clientY, t: now };
    handleBoardClickLocal(toBoardCoords(e), e);
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
      const dist = textHitDist(t, eff, size.w, size.h, x, y);
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
    if (!entry || draggingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    openEditLocal(toBoardCoords(e));
  };

  // ---------- text-box dragging inside a chord (external editor AND inline) ----------
  /** The chord doc used for text drags — on an INLINE page click we select the
   *  clicked chord and call this in the SAME event, so `entry`/`size` from the
   *  last render still describe the OLD chord. Read the clicked chord's doc and
   *  its own canvas size directly from the page instead. */
  const textDragCtx = (id: string): { doc: ChordDoc; w: number; h: number } | null => {
    if (!page) return null;
    const doc = id === selectedId && entry ? entry : page.chords.find(c => c.id === id) ?? null;
    if (!doc) return null;
    const es = applyGlobalBoardScale(mergeChordSettings(settings, doc.settings), settings);
    const sz = id === selectedId ? size : canvasSize(es);
    return { doc, w: sz.w, h: sz.h };
  };

  /** Pick a text item at a point in chord `id`'s canvas space. */
  const pickItemAt = (id: string, x: number, y: number): Sel => {
    const ctx = textDragCtx(id);
    if (!ctx) return null;
    const es = applyGlobalBoardScale(mergeChordSettings(settings, ctx.doc.settings), settings);
    let best: { d: number; sel: Sel } = { d: 26, sel: null };
    for (const d of ctx.doc.dots) {
      // dots snap to fret slots while dragging, so compare against the slot's
      // along-coordinate — not the raw center (a dot dragged off-center by its
      // grab offset must still be grabbable near its rendered position).
      const c = cellCenter(es, d.string, dotAlongFret(es, d.fret - es.startFret, fretPositions(es)));
      const dist = Math.hypot(c.x - x, c.y - y);
      if (dist < best.d) best = { d: dist, sel: { kind: 'dot', id: d.id } };
    }
    for (const t of ctx.doc.texts) {
      const dist = textHitDist(t, es, ctx.w, ctx.h, x, y);
      if (dist < best.d) best = { d: dist, sel: { kind: 'text', id: t.id } };
    }
    for (const f of ctx.doc.fingerings) {
      const p = fingeringPos(es, f.string);
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < best.d) best = { d: dist, sel: { kind: 'fing', id: f.id } };
    }
    return best.sel;
  };

  /** Grab an existing dot or text box of chord `id` for dragging. `local` is in
   *  that chord's own canvas space. Returns true when a drag started. */
  const beginItemDrag = (id: string, s: NonNullable<Sel>, local: { x: number; y: number }, client?: { x: number; y: number }): boolean => {
    const ctx = textDragCtx(id);
    if (!ctx) return false;
    if (s.kind === 'text') {
      const t = ctx.doc.texts.find(tt => tt.id === s.id);
      if (!t) return false;
      dragRef.current = { id, kind: 'text', itemId: t.id, dx: local.x - t.x * ctx.w, dy: local.y - t.y * ctx.h };
    } else if (s.kind === 'dot') {
      const d = ctx.doc.dots.find(dd => dd.id === s.id);
      if (!d) return false;
      const es = applyGlobalBoardScale(mergeChordSettings(settings, ctx.doc.settings), settings);
      const c = cellCenter(es, d.string, dotAlongFret(es, d.fret - es.startFret, fretPositions(es)));
      dragRef.current = { id, kind: 'dot', itemId: d.id, dx: local.x - c.x, dy: local.y - c.y };
    } else return false;
    // ONE snapshot for the whole gesture. pushHistory() is suppressed while a
    // gesture is active, so this call records the pre-drag state even though
    // beginItemDrag can run from inside another click handler.
    pushHistory();
    // The grab offset above was measured against the CURRENTLY RENDERED doc.
    // When the caller just changed selection or page contents in the same
    // event (select-then-grab), React hasn't re-rendered yet and the entry may
    // be stale — re-measure the item position on the next frame so the box
    // doesn't jump by the delta between old and new renders.
    pendingReanchorRef.current = true;
    draggingRef.current = true;              // suppress click follow-ups NOW
    setSel(s);
    itemDragPressRef.current = client ? { x: client.x, y: client.y, moved: false } : null;
    return true;
  };

  /** Grab a text box of chord `id`. `local` is in that chord's own canvas space.
   *  Returns true when a drag started. */
  const beginTextDrag = (id: string, local: { x: number; y: number }, client?: { x: number; y: number }): boolean => {
    const ctx = textDragCtx(id);
    if (!ctx) return false;
    const s = pickItemAt(id, local.x, local.y);
    if (s && s.kind === 'text') return beginItemDrag(id, s, local, client);
    return false;
  };

  const applyItemDrag = (local: { x: number; y: number }, client?: { x: number; y: number }) => {
    const ref = dragRef.current;
    if (!ref || !draggingRef.current) return;
    if (!sel && !itemDragPressRef.current) return;
    // Mark the gesture as MOVED once the pointer travels past a few client px
    // from where it was pressed - below that it still counts as a click.
    const press = itemDragPressRef.current;
    if (press && client && Math.hypot(client.x - press.x, client.y - press.y) > 4) press.moved = true;
    if (pendingReanchorRef.current) {
      pendingReanchorRef.current = false;
      const rc = textDragCtx(ref.id);
      if (rc) {
        if (ref.kind === 'text') {
          const t = rc.doc.texts.find(tt => tt.id === ref.itemId);
          if (t) { ref.dx = local.x - t.x * rc.w; ref.dy = local.y - t.y * rc.h; }
        } else {
          const d = rc.doc.dots.find(dd => dd.id === ref.itemId);
          if (d) {
            const es2 = applyGlobalBoardScale(mergeChordSettings(settings, rc.doc.settings), settings);
            const c2 = cellCenter(es2, d.string, dotAlongFret(es2, d.fret - es2.startFret, fretPositions(es2)));
            ref.dx = local.x - c2.x; ref.dy = local.y - c2.y;
          }
        }
      }
    }
    const ctx = textDragCtx(ref.id);
    if (!ctx) return;
    if (ref.kind === 'text') {
      let nx = (local.x - ref.dx) / ctx.w;
      let ny = (local.y - ref.dy) / ctx.h;
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;   // never corrupt coords
      nx = Math.max(-0.5, Math.min(1.5, nx));
      ny = Math.max(-0.5, Math.min(1.5, ny));
      setPageNoHist(p => {           // intermediate moves never touch history
        const i = p.chords.findIndex(c => c.id === ref.id);
        if (i < 0) return p;
        p.chords[i].texts = p.chords[i].texts.map(t => (t.id === ref.itemId ? { ...t, x: nx, y: ny } : t));
        return p;
      });
      return;
    }
    // DOT drag: live-drag through the board matrix, then SNAP to the nearest
    // string + fret slot (open zone included) — same semantics as clicking.
    const es = applyGlobalBoardScale(mergeChordSettings(settings, ctx.doc.settings), settings);
    const strings = stringLayout(es);
    let strIdx = 0, bestA = Infinity;
    for (let i = 0; i < NUM_STRINGS; i++) {
      const u = unproject(es, local.x - ref.dx, local.y - ref.dy);
      const d = Math.abs(u.a - strings[i].offset);
      if (d < bestA) { bestA = d; strIdx = i; }
    }
    const u = unproject(es, local.x - ref.dx, local.y - ref.dy);
    let rel = u.t < 0 ? -1 : (() => {
      const positions = fretPositions(es);
      let slot = positions.length - 2;
      for (let i = 0; i < positions.length - 1; i++) {
        if (u.t <= (positions[i] + positions[i + 1]) / 2) { slot = i; break; }
      }
      return Math.max(0, slot);
    })();
    rel = Math.min(rel, es.numFrets - 1);
    const absFret = es.startFret + rel;
    setPageNoHist(p => {
      const i = p.chords.findIndex(c => c.id === ref.id);
      if (i < 0) return p;
      p.chords[i].dots = p.chords[i].dots.map(d =>
        d.id === ref.itemId ? { ...d, string: strIdx, fret: absFret } : d);
      return p;
    });
  };

  /** Finalize an item-drag gesture on release. A text box pressed WITHOUT the
   *  pointer moving is a plain CLICK -> open its edit dialog; a press that
   *  moved was a repositioning drag and ends silently. Returns true when an
   *  item drag was active (so callers can skip their own mouseup logic). */
  const endItemDrag = (): boolean => {
    if (!draggingRef.current) return false;
    draggingRef.current = false;               // synchronous — blocks stale click follow-ups
    const ref = dragRef.current;
    const press = itemDragPressRef.current;
    itemDragPressRef.current = null;
    pendingReanchorRef.current = false;
    if (ref && ref.kind === 'text' && press && !press.moved) {
      setEditing({ kind: 'text', id: ref.itemId });   // click (not drag): edit it
    }
    histPausedRef.current = false;         // re-arm history after the gesture
    dragRef.current = null;
    return true;
  };

  /** Abort any armed/active item-drag gesture WITHOUT opening dialogs — used
   *  when the mouseup happened outside the chord/board so the follow-up events
   *  never see a live gesture. */
  const cancelItemDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    itemDragPressRef.current = null;
    pendingReanchorRef.current = false;
    dragRef.current = null;
    histPausedRef.current = false;
  };

  const onBoardPointerDown = (e: React.MouseEvent) => {
    if (!entry || draggingRef.current) return;
    // With the SELECT tool any text box is grabbable directly. With the TEXT
    // tool the press was already armed by handleBoardClickLocal (mousedown
    // fires before click), so do not re-begin it here or we would restart the
    // gesture with a wrong grab offset.
    if (tool !== 'select') return;
    beginTextDrag(selectedId!, toBoardCoords(e), { x: e.clientX, y: e.clientY });
  };
  const onBoardPointerMove = (e: React.MouseEvent) => {
    if (!draggingRef.current || !dragRef.current) return;
    applyItemDrag(toBoardCoords(e), { x: e.clientX, y: e.clientY });
  };
  const onBoardPointerUp = () => {
    endItemDrag();
  };

  // ---------- inline editing on the page (INLINE EDIT toggle) ----------
  /** Lenient slot hit-test in a chord's canvas space: ALWAYS snaps to the nearest
   *  string (even in the taper margins), so clicking "on the strings" of a small
   *  on-page chord reliably adds/removes dots. Still bounded by the nut zone and
   *  the last fret. */
  const hitSlotLenient = (es: Settings, x: number, y: number): { string: number; rel: number } | null => {
    const { t, a } = unproject(es, x, y);
    const strings = stringLayout(es);
    let strIdx = 0, best = Infinity;
    for (let i = 0; i < NUM_STRINGS; i++) {
      const d = Math.abs(a - strings[i].offset);
      if (d < best) { best = d; strIdx = i; }
    }
    const positions = fretPositions(es);
    let rel: number;
    if (t < 0) {
      if (t < -nutZoneDepth(es) * 1.4) return null;    // too far off the nut end
      rel = -1;                                         // open position
    } else {
      let slot = -1;
      for (let i = 0; i < positions.length - 1; i++) {
        if (t >= positions[i] && t <= positions[i + 1]) { slot = i; break; }
      }
      if (slot === -1) {
        // snap into the LAST slot when clicking slightly past the final fret
        if (t > positions[positions.length - 1] && t < positions[positions.length - 1] + es.baseDotSize * 2) slot = positions.length - 1;
        else return null;                               // beyond the board's far end
      }
      rel = slot;
    }
    return { string: strIdx, rel };
  };

  /** Nearest existing dot to a cell center (within ~1.3 slots) — click-to-remove. */
  const findNearestDotToCell = (c: ChordDoc, es: Settings, string: number, rel: number): Dot | undefined => {
    const target = cellCenter(es, string, rel);
    let best: Dot | undefined; let bd = es.stringGap * widthScale(es) * 1.3;
    for (const d of c.dots) {
      const dr = d.fret - es.startFret;
      const cc = cellCenter(es, d.string, dr);
      const dist = Math.hypot(cc.x - target.x, cc.y - target.y);
      if (dist <= bd) { bd = dist; best = d; }
    }
    return best;
  };

  /** One click inside an on-page chord box while INLINE EDIT is ON. */
  const handleInlineChordClick = (id: string, e: React.MouseEvent) => {
    if (!page || draggingRef.current || pageDrag) return;
    // Clicking a chord makes it the active chord for ALL editing tools — the
    // external editor below and the dialog paths then describe this chord too.
    if (page.selected !== id) selectChord(id);
    const local = toChordLocalById(id, e.clientX, e.clientY);
    if (!local) return;
    const c = page.chords.find(cc => cc.id === id);
    if (!c) return;
    const es = applyGlobalBoardScale(mergeChordSettings(settings, c.settings), settings);

    // Resolve WHICH item sits under the cursor BEFORE deciding the gesture —
    // grabbing an existing dot/text must always win over "add a new dot",
    // otherwise dots could never be moved or opened in the dialog.
    const near = pickItemAt(id, local.x, local.y);

    const now = performance.now();
    const prev = lastClickRef.current;
    if (prev && prev.id === id && now - prev.t < 400 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 8) {
      lastClickRef.current = null;                      // double-click → edit dialog
      if (near) { setSel(near); setEditing(near); }     // works for ANY chord now
      else openEditLocal(local, id);
      return;
    }
    lastClickRef.current = { x: e.clientX, y: e.clientY, t: now, id };

    // Grab an existing dot (any tool) or text box (select/text tool) -> drag
    // it. With the TEXT tool this doubles as "click a box to edit it": the
    // release (endItemDrag) opens the dialog when the pointer never moved.
    if (near && ((near.kind === 'dot') || ((tool === 'select' || tool === 'text') && near.kind === 'text'))) {
      if (beginItemDrag(id, near, local, { x: e.clientX, y: e.clientY })) return;
    }

    if (tool === 'dot') {
      const hit = hitSlotLenient(es, local.x, local.y);
      if (!hit) return;
      const existing = c.dots.find(d => d.string === hit.string && d.fret - es.startFret === hit.rel)
        ?? findNearestDotToCell(c, es, hit.string, hit.rel);
      pushHistory();
      setPage(p => {
        const i = p.chords.findIndex(cc => cc.id === id);
        if (i < 0) return p;
        const nc = structuredClone(p.chords[i]);   // never mutate the page object in place
        if (existing) nc.dots = mirrorRemove(nc.dots, existing, es);
        else {
          const nd = makeDot(es, hit.string, hit.rel);
          nc.dots.push(nd);
          nc.dots.push(...mirrorAdd({ ...nc, dots: [nd] }, nd, es));
        }
        const next = [...p.chords];
        next[i] = nc;
        return { ...p, chords: next, selected: id };
      });
      return;
    }

    // other tools / select: act through the shared handlers on the clicked chord
    if (id !== selectedId) selectChord(id);
    // editing tools (text/fing/select-pick): operate directly on the CLICKED
    // chord — no stale-render dependency, so it works even when the click
    // also just changed the selection.
    handleBoardClickLocal(local, e, id);
  };

  // ---------- page-level interactions (select / move chords) ----------
  // Selection changes are UI state, not document content — they must not be
  // undoable and must not clear the redo branch. `setPage` clones deeply, so
  // a pure selection change leaves the serialized snapshot identical and the
  // history dedup in HistoryManager.commit ignores it automatically.
  const selectChord = (id: string | null) => setPage(p => { p.selected = id; return p; });

  /** Page-space rect of a chord's placement box (stored w/h are native sizes). */
  const chordRect = (pl: ChordPlacement): ChordPlacement => ({
    x: pl.x, y: pl.y, w: pl.w * pl.scale, h: pl.h * pl.scale, scale: pl.scale,
  });

  /** Rendered page-space rect from a FRESH native measurement (authoritative). */
  const rectFromNat = (pl: ChordPlacement, nat: { w: number; h: number }): ChordPlacement => ({
    x: pl.x, y: pl.y, w: nat.w * pl.scale, h: nat.h * pl.scale, scale: pl.scale,
  });

  /** Find a free top-left position for a nat-sized box on the page (grid-stepped scan).
   *  When the page allows overlaps, chords may be placed anywhere — new chords
   *  simply cascade diagonally from the margin instead of hunting for a gap. */
  function findFreeSpot(p: PageDoc, nat: { w: number; h: number }): { x: number; y: number } {
    const cfg = p.config;
    const ps = pageSizePx(cfg);
    const bw = Math.min(nat.w, ps.w), bh = Math.min(nat.h, ps.h);
    const step = Math.max(20, cfg.gridSize);
    if (cfg.allowOverlap) {
      // collision detection disabled — place freely (cascade so boxes at least
      // stay visibly offset), clamped inside the page
      const off = ((p.chords.length % 8) + 1) * step;
      return {
        x: snapVal(Math.max(0, Math.min(ps.w - bw, 20 + off)), cfg),
        y: snapVal(Math.max(0, Math.min(ps.h - bh, 20 + off)), cfg),
      };
    }
    const taken = Object.values(p.placements).map(chordRect);
    const overlaps = (px: number, py: number) =>
      taken.some(t => px < t.x + t.w && px + bw > t.x && py < t.y + t.h && py + bh > t.y);
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
    if (inlineEdit && tool !== 'select') {    // inline edit: interior clicks EDIT, border/frame clicks MOVE
      const tgt = e.target as Element | null;
      const onFrame = !!tgt?.closest('.chord-frame');
      if (onFrame) { startChordMove(id, e); return; }   // frame/border → reposition
      handleInlineChordClick(id, e);                    // interior → add dots/text/etc.
      return;
    }
    // ALWAYS re-derive the pointer position in THIS chord's page space at grab
    // time. The sheet can be CSS-scaled (.page-svg max-width), so client px and
    // SVG units differ by an unknown factor — anchoring here (and re-anchoring
    // on every move through the same CTM) keeps the box glued to the cursor for
    // EVERY chord, not just the first one.
    selectChord(id);
    startChordMove(id, e);
  };

  /** Begin a whole-chord repositioning drag from the current pointer event. */
  const startChordMove = (id: string, e: React.MouseEvent) => {
    if (!page) return;
    const { x, y } = toPageCoords(e);
    // ALWAYS derive fresh native size — stale w/h in old localStorage records
    // used to poison the clamp math and freeze chords (the FIRST one) in place.
    const c = page.chords.find(cc => cc.id === id);
    if (!c) return;
    const es = applyGlobalBoardScale(mergeChordSettings(settings, c.settings), settings);
    const nat = canvasSize(es);
    let pl = page.placements[id];
    if (!pl) {
      pl = { x: Math.round(x - nat.w / 2), y: Math.round(y - nat.h / 2), w: Math.round(nat.w), h: Math.round(nat.h), scale: 1 };
      setPageNoHist(p => { p.placements[id] = pl!; return p; });
    }
    // Remember the pointer's page-space anchor and the placement at grab time.
    // Movement is applied as a DELTA through the same shared matrix, so even
    // if the CSS scale changes mid-drag it stays consistent (no jumping).
    pageDragRef.current = { id, sx: x, sy: y, ox: pl.x, oy: pl.y };
    beginDragHistory();                        // ONE snapshot per drag gesture
    setPageDrag(true);
  };
  const onChordBoxMove = (e: React.MouseEvent) => {
    // inline-edit: dragging a DOT or TEXT BOX inside a chord moves the item, not the box
    if (draggingRef.current && dragRef.current) {
      const cid = chordAtClient(e.clientX, e.clientY) ?? dragRef.current.id;
      const local = toChordLocalById(cid, e.clientX, e.clientY);
      if (local) applyItemDrag(local, { x: e.clientX, y: e.clientY });
      return;
    }
    const ref = pageDragRef.current;
    if (!ref || !pageDrag || !page) return;
    // Read placement/geometry from the LATEST committed state instead of the
    // render closure. During a fast drag, React may batch several mousemove
    // events into one render pass; a stale `page` snapshot would then clamp
    // positions against old numbers and leave the box behind the cursor.
    const pg = pages[pageIdx];
    if (!pg) return;
    // Cross-page drag: dropping onto ANOTHER visible sheet moves the chord
    // there (Alt held, or pointer inside a different page's bounds).
    const targetPi = e.altKey ? pageAtClient(e.clientX, e.clientY) : -1;
    if (targetPi >= 0 && targetPi !== pageIdx && pages[targetPi]) {
      const pt = toPageCoordsAt(e.clientX, e.clientY, targetPi);
      if (!Number.isFinite(pt.x)) return;
      const cfgT = pages[targetPi].config;
      const psT = pageSizePx(cfgT);
      const c = pg.chords.find(cc => cc.id === ref.id);
      if (!c) return;
      const es = applyGlobalBoardScale(mergeChordSettings(settings, c.settings), settings);
      const nat = canvasSize(es);
      const cur = pg.placements[ref.id];
      const scale = cur?.scale ?? 1;
      let nx = snapVal(pt.x - (ref.sx - ref.ox), cfgT);
      let ny = snapVal(pt.y - (ref.sy - ref.oy), cfgT);
      nx = Math.max(0, Math.min(Math.max(0, psT.w - nat.w * scale), nx));
      ny = Math.max(0, Math.min(Math.max(0, psT.h - nat.h * scale), ny));
      setPages(list => {
        const srcIdx = pageIdxRef.current;
        const src = list[srcIdx], dst = list[targetPi];
        if (!src || !dst || src === dst) return list;
        const i = src.chords.findIndex(cc => cc.id === ref.id);
        if (i < 0) return list;
        const next = list.slice();
        const nsrc = structuredClone(src), ndst = structuredClone(dst);
        const pl = nsrc.placements[ref.id] ?? { x: nx, y: ny, w: nat.w, h: nat.h, scale };
        const [doc] = nsrc.chords.splice(i, 1);
        delete nsrc.placements[ref.id];
        ndst.chords.push(doc);
        ndst.placements[doc.id] = { ...pl, x: nx, y: ny, w: Math.round(nat.w), h: Math.round(nat.h) };
        if (nsrc.selected === doc.id) nsrc.selected = nsrc.chords[0]?.id ?? null;
        ndst.selected = doc.id;
        next[srcIdx] = nsrc;
        next[targetPi] = ndst;
        return next;
      });
      setPageIdx(targetPi);
      // re-anchor the gesture on the new page so movement continues smoothly
      pageDragRef.current = { id: ref.id, sx: pt.x, sy: pt.y, ox: nx, oy: ny };
      return;
    }
    const { x, y } = toPageCoords(e);
    if (!Number.isFinite(x)) return;          // page svg not registered yet
    const cfg = pg.config;
    const ps = pageSizePx(cfg);
    const cur = pg.placements[ref.id];
    if (!cur) return;
    // fresh native size (never trust stored w/h during the drag)
    const c = pg.chords.find(cc => cc.id === ref.id);
    if (!c) return;
    const es = applyGlobalBoardScale(mergeChordSettings(settings, c.settings), settings);
    const nat = canvasSize(es);
    // DELTA-based movement through the SHARED page CTM: grab offset
    // (ox - sx) is added to the pointer's CURRENT page-space position. Both
    // go through the same matrix, so any CSS scale of the sheet cancels
    // exactly — the box tracks the cursor for every chord, first or last.
    let nx = snapVal(ref.ox + (x - ref.sx), cfg);
    let ny = snapVal(ref.oy + (y - ref.sy), cfg);
    nx = Math.max(0, Math.min(Math.max(0, ps.w - nat.w * cur.scale), nx));
    ny = Math.max(0, Math.min(Math.max(0, ps.h - nat.h * cur.scale), ny));
    setPageNoHist(p => {
      const pl = p.placements[ref.id] ?? { ...cur };
      p.placements[ref.id] = { ...pl, x: nx, y: ny, w: Math.round(nat.w), h: Math.round(nat.h) };
      return p;
    });
  };
  const onChordBoxUp = () => {
    if (endItemDrag()) return;                 // finished an inline item drag
    const ref = pageDragRef.current;
    if (pageDrag && ref && page) {
      endDragHistory();
      // Chords should never sit on top of each other: if the drop position
      // overlaps another box, nudge this one to the nearest free spot.
      // This happens AFTER the gesture ended, so it records its own snapshot.
      // With "Allow overlap" enabled this pass is skipped entirely — the chord
      // stays exactly where it was dropped (drag clamping already kept it on
      // the page).
      setPage(p => {
        if (p.config.allowOverlap) return p;
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
    // Edit the item wherever it lives — on ANY page, not just the current one.
    // (Inline editing lets you open a chord on another page; previously the
    // dialog wrote only into the active page and silently dropped the edit.)
    pushHistory();
    setPages(list => list.map(p => {
      const i = p.chords.findIndex(c => c.id === selectedId);
      if (i < 0) return p;
      const nc = structuredClone(p.chords[i]);
      if (kind === 'dot') nc.dots = nc.dots.map(x => x.id === item.id ? item : x);
      if (kind === 'text') nc.texts = nc.texts.map(x => x.id === item.id ? item : x);
      if (kind === 'fing') nc.fingerings = nc.fingerings.map(x => x.id === item.id ? item : x);
      // MIRROR mode: property edits propagate to the dot's ±12-fret twins on
      // the same string (color / shape / text / font / size / rotation…).
      if (kind === 'dot') {
        const es = applyGlobalBoardScale(mergeChordSettings(settingsRef.current, nc.settings), settingsRef.current);
        const edited = nc.dots.find(x => x.id === item.id);
        if (edited) nc.dots = mirrorPropEdit(nc.dots, edited, es);
      }
      if (JSON.stringify(nc) === JSON.stringify(p.chords[i])) return p;
      const next = [...p.chords];
      next[i] = nc;
      return { ...p, chords: next };
    }));
    setEditing(null);
  };
  const deleteEdit = () => {
    if (!editing) return;
    mutate(d => {
      if (editing.kind === 'dot') {
        // MIRROR mode: deleting a dot from the dialog also deletes its
        // ±12-fret same-string twins.
        const anchor = d.dots.find(x => x.id === editing.id);
        d.dots = anchor ? mirrorRemove(d.dots, anchor, eff) : d.dots.filter(x => x.id !== editing.id);
      }
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
    setPageObj(p => {
      const es = applyGlobalBoardScale(mergeChordSettings(settings, c.settings), settings);
      const nat = intrinsic(renderSvg(c, es, { customs }));
      // find a free spot so new chords never land on top of existing ones
      const { x, y } = findFreeSpot(p, nat);
      p.chords.push(c);
      // NOTE: placement w/h are stored NATIVE (unscaled). The rendered rect is
      // nw*scale × nh*scale — mixing scaled values into w/h used to double-count
      // the scale factor and break overlap checks & clamping.
      p.placements[c.id] = { x, y, w: Math.round(nat.w), h: Math.round(nat.h), scale: 1 };
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
    setPageObj(p => { for (const c of p.chords) c.settings = structuredClone(patchClip); return p; });
    flash('Settings applied to ALL chords on this page');
  };
  const pastePatchSelected = () => {
    if (!patchClip || !selectedId) { flash('Nothing copied or no chord selected'); return; }
    pushHistory();
    setPageObj(p => {
      const i = p.chords.findIndex(c => c.id === selectedId);
      if (i >= 0) p.chords[i].settings = structuredClone(patchClip);
      return p;
    });
    flash('Settings pasted onto selected chord');
  };

  const renameSelected = (name: string) => {
    if (!selectedId) return;
    pushHistory();
    setPageObj(p => {
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
      const rec: ChordDoc = { ...structuredClone(c), name: `${name} · ${c.name}`, settings: c.settings ?? chordPatchFrom(applyGlobalBoardScale(mergeChordSettings(settings, c.settings), settings)) };
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

  /** Re-measure every chord box and pull back-inside ones that no longer fit.
   *  Also normalizes legacy records whose w/h were stored pre-multiplied by the
   *  scale (double-scaling made boxes unmovable / mis-clamped). */
  const refitChords = () => {
    if (!page) return;
    const ps = pageSizePx(page.config);
    pushHistory();
    setPageObj(p => {
      for (const c of p.chords) {
        const es = applyGlobalBoardScale(mergeChordSettings(settings, c.settings), settings);
        const nat = canvasSize(es);
        let pl = p.placements[c.id] ?? { x: 20, y: 20, w: Math.round(nat.w), h: Math.round(nat.h), scale: 1 };
        // legacy fix-up + always re-measure the native box from CURRENT settings
        if (Math.abs(pl.w - nat.w * pl.scale) <= Math.max(2, nat.w * 0.05) && Math.abs(pl.w - nat.w) > 2) {
          pl = { ...pl, w: Math.round(nat.w), h: Math.round(nat.h) };
        } else {
          pl = { ...pl, w: Math.round(nat.w), h: Math.round(nat.h) };
        }
        const rect = rectFromNat(pl, nat);
        if (!fitsPage(rect, ps)) {
          let nx = Math.max(0, Math.min(Math.max(0, ps.w - rect.w), pl.x));
          let ny = Math.max(0, Math.min(Math.max(0, ps.h - rect.h), pl.y));
          let scale = pl.scale;
          if (rect.w > ps.w || rect.h > ps.h) {
            const k = Math.min(ps.w / rect.w, ps.h / rect.h);
            scale = Math.max(0.2, +(pl.scale * k).toFixed(3));
            nx = Math.max(0, Math.min(Math.max(0, ps.w - nat.w * scale), nx));
            ny = Math.max(0, Math.min(Math.max(0, ps.h - nat.h * scale), ny));
          }
          pl = { ...pl, x: nx, y: ny, scale };
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
    // Absolute mode: every chord is FIRST reset to the default scale (100%)
    // and only then multiplied by k — so chords that started at the same size
    // always end up at exactly the same size again (repeated clicks of ＋ give
    // a stable 1.1×, not a compounding drift from mismatched starting scales).
    const absolute = !!page.config.absoluteScale;
    // In absolute mode the target is an EXACT size, not a compounding factor:
    // every chord's placement scale is reset to the default (100%) and then
    // set to k — so chords that started at the same size end up at exactly
    // the same size again (＋ twice ⇒ 121%, stable, no drift).
    setPageObj(p => {
      for (const c of p.chords) {
        const es = applyGlobalBoardScale(mergeChordSettings(settings, c.settings), settings);
        const nat = canvasSize(es);
        const pl = p.placements[c.id];
        if (!pl) continue;
        const base = absolute ? 1 : pl.scale;
        pl.scale = Math.max(0.2, Math.min(3, +(base * k).toFixed(3)));
        pl.w = Math.round(nat.w);
        pl.h = Math.round(nat.h);
        pl.x = Math.max(0, Math.min(Math.max(0, ps.w - nat.w * pl.scale), pl.x));
        pl.y = Math.max(0, Math.min(Math.max(0, ps.h - nat.h * pl.scale), pl.y));
      }
      if (!p.config.allowOverlap) p = ensureNoOverlaps(p);   // scaled boxes may now collide
      return p;
    });
    flash(absolute ? `All chords set to ${Math.round(k * 100)}% (absolute)` : `All chords scaled ${k > 1 ? 'up' : 'down'} ${Math.round(Math.abs(k - 1) * 100)}%`);
  };

  const scaleToDefault = () => {
    if (!page) return;
    pushHistory();
    const ps = pageSizePx(page.config);
    setPageObj(p => {
      for (const c of p.chords) {
        const es = applyGlobalBoardScale(mergeChordSettings(settings, c.settings), settings);
        const nat = canvasSize(es);
        const pl = p.placements[c.id];
        if (!pl) continue;
        pl.scale = 1;
        pl.w = Math.round(nat.w);
        pl.h = Math.round(nat.h);
        pl.x = Math.max(0, Math.min(Math.max(0, ps.w - nat.w), pl.x));
        pl.y = Math.max(0, Math.min(Math.max(0, ps.h - nat.h), pl.y));
      }
      if (!p.config.allowOverlap) p = ensureNoOverlaps(p);   // reset boxes may now collide
      return p;
    });
    flash('All chord scales reset to 100%');
  };

  // ---------- auto-layout (pack all chords into rows/pages) ----------
  const buildAutoLayout = (): PageDoc[] => {
    if (!page) return [];
    const ps = pageSizePx(page.config);
    const margin = 24, gap = 18;
    const items = page.chords.map(c => {
      const es = applyGlobalBoardScale(mergeChordSettings(settings, c.settings), settings);
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
      const es = applyGlobalBoardScale(mergeChordSettings(settings, c.settings), settings);
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
          <button className={`btn apply-all ${applyAllChords ? 'active' : ''}`} onClick={toggleApplyAll}
            title={applyAllChords
              ? 'Apply-to-ALL is ON: every Settings change is broadcast to every chord on every page (and the saved library). Click to edit only the selected chord.'
              : 'Apply-to-ALL is OFF: settings edits affect only the selected chord. Click to make every setting change apply to ALL chords.'}>
            {applyAllChords ? '🌐 All chords' : '🎯 Selected'}
          </button>
          <span className="quick-ovr transpose-ctl" title={`Transpose pitches UP by 0–11 semitones.\n${applyAllChords ? '🌐 All chords is ON → applies to EVERY chord on every page and the saved library.' : '🎯 Selected is ON → applies only to the currently selected chord.'}\nModifies the pitch VALUES directly (per-chord tuning + dot frets + baked labels) — it is a one-shot edit, not a persistent setting. Single Undo (Ctrl+Z) reverts the whole transpose.`}>
            <label htmlFor="transpose-sel">⇧ Trsp</label>
            <select id="transpose-sel" className="txt transpose-select" defaultValue=""
              onChange={e => { const v = Number(e.target.value); e.target.value = ''; if (v > 0) onTranspose(v); }}>
              <option value="" disabled>{applyAllChords ? 'all chords…' : 'selected…'}</option>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i}>{i === 0 ? '+0 (same)' : `+${i} semitone${i === 1 ? '' : 's'}`}</option>
              ))}
            </select>
            <button className={`qbtn wrap ${transposeWrap ? 'on' : ''}`}
              data-tip={'Wrap octave: the NEXT transpose keeps every dot inside its own octave band — pitches pushed past fret 11/23 wrap back to the bottom of that octave ((fret mod 12) + 12·band), filling gaps instead of leaving them.\nE.g. a C scale run up to fret 11 transposed +5 wraps the high dots down, so F-major stays dense.\nOne-shot: it resets after each transpose.'}
              title="Wrap octave — the next transpose folds wrapped dots back into their own octave band"
              onClick={() => setTransposeWrap(w => !w)}>⟲ Wrap</button>
          </span>
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
              <label className="row check"><input type="checkbox" checked={!page.config.allowOverlap} onChange={e => setConfig({ allowOverlap: !e.target.checked })} /><span>Prevent overlap</span></label>
              <label className="row check"><input type="checkbox" checked={!!page.config.absoluteScale} onChange={e => setConfig({ absoluteScale: e.target.checked })} /><span>Absolute scale</span></label>
              <label className="row"><span>Grid (px)</span><input type="number" min={5} max={100} value={page.config.gridSize}
                onChange={e => setConfig({ gridSize: Math.max(5, Math.min(100, Number(e.target.value) || 20)) })} /></label>
              <div className="page-ops">
                <button className="btn small" onClick={doAutoLayout} title="Pack all chords neatly into rows across pages">▦ Auto-layout</button>
                <button className="btn small" onClick={refitChords} title="Re-measure chord boxes and pull them back inside the page">⇲ Refit boxes</button>
              </div>
              <div className="page-ops">
                <button className="btn small" onClick={() => scaleAll(0.9)} title="Scale ALL chords down 10% (absolute mode: reset to 100% first, then set 90%)">− Scale</button>
                <button className="btn small" onClick={() => scaleAll(1.1)} title="Scale ALL chords up 10% (absolute mode: reset to 100% first, then set 110%)">＋ Scale</button>
                <button className="btn small" onClick={() => scaleToDefault()} title="Reset ALL chord scales back to 100%">⟲ Reset scale</button>
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
                  data-page={pv.name} data-page-idx={pi}>
                  <div className="page-label">{pv.name}{pi === pageIdx ? ' — editing' : ''}</div>
                  <div className="page-svg-host">
                    <svg xmlns="http://www.w3.org/2000/svg" width={ps.w} height={ps.h} viewBox={`0 0 ${ps.w} ${ps.h}`}
                      className="page-svg" style={{ display: 'block' }}
                      ref={el => {
                        // ALWAYS set-or-replace with the live element: React may
                        // call the old ref's null-cleanup AFTER the new one is
                        // attached; unconditional delete would then leave a
                        // STALE entry that poisons pageAtClient() hit-testing.
                        if (el) svgRefs.current.set(pi, el);
                        else if (svgRefs.current.get(pi) === el || !el) svgRefs.current.delete(pi);
                      }}
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
                        const inline = pi === pageIdx && inlineEdit;
                        return (
                          <g key={c.id} transform={`translate(${c.x},${c.y}) scale(${c.scale})`}
                            className={`page-chord ${cur ? 'sel' : ''} ${inline ? 'inline-edit' : ''}`}
                            style={{ cursor: pi === pageIdx ? (inline && tool !== 'select' ? 'crosshair' : 'move') : 'default' }}
                            ref={el => {
                              // set-or-replace (never blind-delete): a stale
                              // cleanup call must not remove the NEW element
                              // React attaches during re-render, or hit-testing
                              // silently loses that chord.
                              if (el) gRefs.current.set(c.id, el);
                              else if (!el) gRefs.current.delete(c.id);
                            }}
                            onMouseDown={pi === pageIdx ? (e) => onChordBoxDown(e, c.id) : undefined}
                            onDoubleClick={inline ? (e) => { e.preventDefault(); e.stopPropagation(); } : undefined}
                            onContextMenu={inline ? (e) => { e.preventDefault(); e.stopPropagation(); handleInlineChordClick(c.id, e); } : undefined}>
                            {/* selection frame — the MOVE handle while inline editing */}
                            <rect className="chord-frame" x="-6" y="-6" width={c.nw + 12} height={c.nh + 12} rx="6"
                              fill="rgba(255,255,255,0.6)" stroke={cur ? '#1f6feb' : 'transparent'} strokeWidth={cur ? 2 / c.scale : 0} strokeDasharray={cur ? `${6 / c.scale} ${4 / c.scale}` : undefined} />
                            <rect x="0" y="0" width={c.nw} height={c.nh} fill="#ffffff" stroke="#e3e7ec" strokeWidth={1 / c.scale} />
                            <g className="chord-content" pointerEvents="none" dangerouslySetInnerHTML={{ __html: c.inner }} />
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

              {/* quick-settings toolbar — toggles apply to the SELECTED chord
                  without opening the settings panel. Hover ≥500ms for hints. */}
              <div ref={qbarRef} className={`quick-bar ${hasSel ? '' : 'off'}`} aria-disabled={!hasSel}
                onMouseOver={showQTip} onMouseOut={hideQTip}>
                <button className={`qbtn ${eff.noteVisible ? 'on' : ''}`} disabled={!hasSel}
                  data-tip={NOTE_MODE_META[eff.noteLabelMode].hint}
                  onClick={() => setEffPatch({ noteVisible: !eff.noteVisible })}>♪±</button>
                <button className={`qbtn mode ${eff.noteVisible ? 'on' : ''}`} disabled={!hasSel}
                  data-tip={`Label mode: ${NOTE_MODE_META[eff.noteLabelMode].name}. Click to cycle Notes → Intervals → Tonal → Degree.`}
                  onClick={cycleNoteMode}>{NOTE_MODE_META[eff.noteLabelMode].icon}&thinsp;{NOTE_MODE_META[eff.noteLabelMode].name}</button>
                <button className={`qbtn oct ${eff.octaveMode ? 'on' : ''}`} disabled={!hasSel}
                  data-tip={'Octave mode: while ON, every dot you add also drops ALL octaves of that pitch class that fit on the visible board (outside positions are clipped).\nUse ⤓ to strip octave duplicates of the whole shape.'}
                  onClick={() => setEffPatch({ octaveMode: !eff.octaveMode })}>8va</button>
                <button className={`qbtn oct ${eff.mirrorOctaves && !eff.octaveMode ? 'on dimmed' : ''}`} disabled={!hasSel || eff.octaveMode}
                  data-tip={eff.octaveMode
                    ? 'Mirror octaves is covered by 8va mode — turn 8va off to use it.'
                    : 'Mirror across octaves on the SAME string: every dot you add/remove/edit is mirrored to fret ±12·k (k = -5..5) on the same string — the identical pitch one or more octaves away. Edit once, every octave copy follows (adds, removes, colors, shapes, text). Fine-grained sibling of 8va (which spreads across strings).'}
                  title="Mirror across octaves on same string (irrelevant while 8va is on)"
                  onClick={() => setEffPatch({ mirrorOctaves: !eff.mirrorOctaves })}>8ve↔</button>
                <button className="qbtn act" disabled={!hasSel || entry.dots.length === 0}
                  data-tip="Fill: add every missing octave of every sounding note within the visible frets (undoable)."
                  onClick={fillAllOctaves}>⤒</button>
                <button className="qbtn act" disabled={!hasSel || entry.dots.length === 0}
                  data-tip="Strip: remove octave duplicates, keeping one representative per pitch class (the lowest-fret dot)."
                  onClick={dedupeOctaves}>⤓</button>
                <span className="qsep" />
                <button className="qbtn key" disabled={!hasSel}
                  data-tip="Reference key for tonal labels (degrees like 1, b3, #4). Click cycles through common keys; ‘auto’ uses the shape root as major."
                  onClick={cycleKey}>𝄡&thinsp;{keyLabel}</button>
                <button className="qbtn key" disabled={!hasSel}
                  data-tip="Root used by interval & degree modes. Click cycles C→C♯/D♭→…→B→auto (auto = lowest-sounding note of the shape)."
                  onClick={cycleRoot}>R&thinsp;{rootLabel}</button>
                <button className={`qbtn ${eff.preferFlats ? 'on' : ''}`} disabled={!hasSel}
                  data-tip="Spelling preference: ♭ flats vs ♯ sharps for letter names and tonal accidentals."
                  onClick={cycleAccidental}>{eff.preferFlats ? '♭' : '♯'}</button>
                <span className="qtip" role="tooltip" />
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
              globalSettings={settings}
              onGlobalChange={setSettings}
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
