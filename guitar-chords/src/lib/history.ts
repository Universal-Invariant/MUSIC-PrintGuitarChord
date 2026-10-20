// ---------- Undo / redo history manager ----------
//
// The app edits two persisted slices that both need undo:
//   • pages (PageDoc[])  — the multi-page document model
//   • chords (ChordDoc[]) — the saved "My chords" library
//
// Every mutation takes a *snapshot* of the slice it touches BEFORE applying
// the change.  Because App's setters are functional and React StrictMode may
// double-invoke them, snapshots are deduplicated inside `commit` (a snapshot
// equal to the current top-of-stack is ignored) — so an action pushed twice
// still undoes exactly once.

type Json = unknown;

const HISTORY_LIMIT = 100;

export interface HistorySlice<T> {
  /** stable serialization of the slice state */
  serialize: (v: T) => Json;
  /** apply a snapshot back to React state */
  restore: (snap: Json) => void;
}

interface SliceHistory {
  undo: Json[];
  redo: Json[];
  /** latest accessor functions (they close over fresh React state setters) */
  acc?: HistorySlice<never>;
}

const eq = (a: Json, b: Json): boolean => JSON.stringify(a) === JSON.stringify(b);

export class HistoryManager {
  private slices = new Map<string, SliceHistory>();
  private notify?: () => void;

  register(name: string, s: HistorySlice<never>) {
    let h = this.slices.get(name);
    if (!h) { h = { undo: [], redo: [] }; this.slices.set(name, h); }
    h.acc = s;
  }

  /** Record the CURRENT state of `name` before a mutation, clearing redo. */
  commit(name: string, currentSerialized: Json) {
    const h = this.slices.get(name);
    if (!h) return;
    if (h.undo.length && eq(h.undo[h.undo.length - 1], currentSerialized)) {
      // same snapshot already recorded — just clear the redo branch
      h.redo.length = 0;
      return;
    }
    h.undo.push(currentSerialized);
    if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
    h.redo.length = 0;
    this.notify?.();
  }

  /** Drop the newest snapshot without restoring (used when an op was aborted). */
  cancel(name: string) {
    const h = this.slices.get(name);
    if (!h) return;
    h.undo.pop();
    this.notify?.();
  }

  canUndo(): boolean { return [...this.slices.values()].some(h => h.undo.length > 0); }
  canRedo(): boolean { return [...this.slices.values()].some(h => h.redo.length > 0); }
  undoCount(): number { return [...this.slices.values()].reduce((n, h) => n + h.undo.length, 0); }
  redoCount(): number { return [...this.slices.values()].reduce((n, h) => n + h.redo.length, 0); }

  private pop(lists: 'undo' | 'redo') {
    const other = lists === 'undo' ? 'redo' : 'undo';
    for (const [name, h] of this.slices) {
      if (!h.undo.length && !h.redo.length) continue;
      if (h[lists].length) {
        const acc = h.acc;
        const snap = h[lists].pop()!;
        h[other].push(acc ? acc.serialize(undefined as never) : null);
        acc?.restore(snap);
        this.notify?.();
        return true;
      }
    }
    return false;
  }

  undoAll(): boolean { return this.pop('undo'); }
  redoAll(): boolean { return this.pop('redo'); }

  clear() {
    for (const h of this.slices.values()) { h.undo.length = 0; h.redo.length = 0; }
    this.notify?.();
  }

  onChange(fn: () => void) { this.notify = fn; }
}
