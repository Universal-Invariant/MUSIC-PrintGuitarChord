// ---------- Global theme manager panel (overlay) ----------
//
// Lists every saved theme with a mini 12-dot preview strip. From here the user
// can create / duplicate / rename / delete themes, open the editor and APPLY a
// theme to the selected chord — or to EVERY chord on every page plus the saved
// library when "🌐 All chords" is ON (scope mirrors the transpose control).

import { useState } from 'react';
import type { Settings } from '../lib/types';
import type { NoteTheme } from '../lib/themes';
import { makeTheme, themeStripSvg } from '../lib/themes';

interface Props {
  themes: NoteTheme[];
  settings: Settings;
  customs: Record<string, string>;
  applyAll: boolean;
  hasSelection: boolean;
  onEdit: (t: NoteTheme) => void;                       // open the dot-row editor
  onDelete: (id: string) => void;
  onAdd: (t: NoteTheme) => void;                        // create + immediately edit
  onApply: (t: NoteTheme) => void;                      // apply with current scope
  onClose: () => void;
}

export default function ThemePanel({ themes, settings, customs, applyAll, hasSelection, onEdit, onDelete, onAdd, onApply, onClose }: Props) {
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog theme-mgr">
        <div className="dlg-head">
          <h3>🎨 Note themes</h3>
          <button className="btn small" onClick={onClose}>✕</button>
        </div>

        <p className="mini-note">
          A theme maps each of the 12 chromatic slots to a color + shape + text.
          <b> Relative</b> themes key off the ROOT selected in the chord editor (look follows the function — transposes keep dots in their slot);
          <b> absolute</b> themes key off the sounding pitch class anchored at the theme's root note (with root C, every C dot gets slot&nbsp;1's style).
        </p>

        <div className="theme-toolbar">
          <button className="btn small primary" onClick={() => onAdd(makeTheme(`Theme ${themes.length + 1}`))}>＋ New theme</button>
          <span className={`theme-scope ${applyAll ? 'all' : ''}`} title={applyAll
            ? '🌐 Apply-to-ALL is ON → "Apply" restyles EVERY chord on every page AND the saved library.'
            : '🎯 Selected is ON → "Apply" restyles only the currently selected chord.'}>
            {applyAll ? '🌐 applies to all chords' : `🎯 applies to ${hasSelection ? 'selected chord' : 'a chord you select'}`}
          </span>
        </div>

        <div className="theme-list">
          {themes.length === 0 && <div className="mini-note empty">No themes yet — click "＋ New theme".</div>}
          {themes.map(t => (
            <div key={t.id} className="theme-row">
              <div className="theme-strip" dangerouslySetInnerHTML={{ __html: themeStripSvg(t, settings, customs) }} />
              <div className="theme-meta">
                <span className="theme-name">{t.name}</span>
                <span className="theme-mode" title={t.mode === 'absolute' ? 'Absolute: slot = pitch class (root anchors letters)' : 'Relative: slot = semitones above the chord root'}>
                  {t.mode === 'absolute' ? `abs · root ${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][t.rootPc]}` : 'rel · chord root'}
                  {t.preferFlats ? ' · ♭' : ''}
                </span>
              </div>
              <div className="theme-actions">
                <button className="btn small" onClick={() => onApply(t)} title="Apply this theme now (scope shown above)">✔ Apply</button>
                <button className="btn small" onClick={() => onEdit(structuredClone(t))}>✎ Edit</button>
                <button className="btn small" onClick={() => onAdd({ ...structuredClone(t), id: makeTheme('').id, name: `${t.name} copy` })}>⧉ Duplicate</button>
                {confirmDel === t.id ? (
                  <>
                    <button className="btn small danger" onClick={() => { onDelete(t.id); setConfirmDel(null); }}>Sure?</button>
                    <button className="btn small" onClick={() => setConfirmDel(null)}>No</button>
                  </>
                ) : (
                  <button className="btn small" onClick={() => setConfirmDel(t.id)} title="Delete this theme">🗑</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
