# 🎸 Guitar Chord Designer

A browser-based tool for designing, arranging, and printing **guitar chord diagrams**. Build individual fretboard charts with full geometric control (real guitar fret spacing, tapered boards, note/pitch labels, fingering markers), then arrange many chords on printable multi-page sheets — like a mini desktop-publishing app for lead sheets and practice cards.

Built with **React + TypeScript + Vite**; renders crisp **SVG** fretboards; persists everything to **localStorage**; no backend required.

```
cd guitar-chords
npm install
npm run dev      # local development
npm run build    # production bundle in dist/
```

---

## Features

### Fretboard geometry (per chord)
- **Real guitar fret spacing** — logarithmic (12-TET) layout, or adjustable slot sizes shrinking geometrically from first to last displayed fret.
- **Fretboard taper** — trapezoid board that correctly *widens toward the bridge* following real neck geometry, consistent when changing the starting fret. Two modes:
  - **Relative taper** — taper measured from the chosen starting fret, so the visual trapezoid stays identical no matter where you start.
  - **Absolute taper** — taper follows true fret numbers (frets 1–5 look different from frets 10–14).
- **Nut handling** — optional nut with configurable width; the nut automatically appears only when the starting fret is 1 and disappears for higher positions.
- **Fret thickness** — adjustable stroke width to emulate jumbo, medium, or thin fret wire.
- **String order flip** — right-handed (low E → high e) or left-handed layouts; orientation stays consistent across strings, dots, labels, and fingerings.
- **Strings never overhang** — string lines are clipped exactly between the first and last displayed frets.
- **Fret dot markers** — single dots at frets 3/5/7/9 and double dots at 12 (side markers supported).

### Chord editing
- **Dot tool** — click any fret cell to add/remove note dots; Shift-click cycles colors, Ctrl-click cycles shapes (circle/square/triangle/diamond), Alt+click / right-click opens the per-dot edit dialog (custom text, font, size, color, transparency, rotation).
- **Text tool** — free text boxes anywhere on the chart.
- **Fingering tool** — click beyond the far end of the board to place finger numbers (1–4, T); open (`0`/`O`) and muted (`x`/`X`) markers render in front of the nut.
- **Note visibility mode** — toggle `♪` to auto-label every dot with its **pitch**, computed live from the current tuning and fret position (starting-fret aware). No manual typing needed.
  - Tuning presets (Standard, Drop D, DADGAD, Open G/D, Half-step down…) plus per-string MIDI note entry.
  - Sharp or flat spelling preference, label color control.
  - **Open-string pitch row** with configurable offset distance from the board and an enable/disable switch; updates instantly when tuning presets change.
- **Manual overrides always win** — typed dot text takes precedence over auto-generated note names.

### Multi-chord page layout
- **Multiple chords per page, multiple pages per project** — Legal / A4 / Letter / custom sizes, portrait or landscape.
- **Drag-and-drop placement** with collision detection: new chords auto-drop into free spots, drags nudge rather than stack, and no chord can sit on top of another. Every chord (including the first) is movable.
- **Per-chord settings** — each chord keeps its own starting fret, frets displayed, taper, sizes, etc.; quick sliders override the selected chord's start fret / fret count straight from the toolbar (frets displayed clamped to ≥ 3).
- **Copy & apply settings** — copy one chord's parameter patch and apply it to another chord or to all chords on the page.
- **Select → edit semantics** — clicking a chord selects it and the settings panel switches to that chord; click inside the board area to edit dots/text as usual.
- **Auto-layout** — one click arranges all chords into tidy rows/columns on the sheet.

### Chord library & browser
- **Built-in library** of common open-position and barre chords (Em, Am, C, G, F, B7, maj7/min7 variants, sus2/sus4…).
- **📚 Library browser dialog** with tabs for built-in vs. saved chords, live **search** ("Am7", "minor a", "a minor 7", "barre", "major seventh" all work — queries are tokenized into root + quality and matched against derived tags), plus filters by **quality**, **root**, and **open/barre position**.
- One click adds a chord to the current page as a new box (undoable).
- **"My chords"** personal library: save the selected chord, save an entire page as a named set, rename (double-click), delete, and reload onto any page.

### Undo / redo
- Full **Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y)** history covering both the page document *and* the chord library.
- Snapshot-based with deduplication, so a complete drag counts as **one** undo step; 100-step depth.

### Save / restore & export
- Everything persists automatically to localStorage with safe migration for older saved data.
- Export the selected chord or the whole page as **SVG** or raster image; print-ready multi-page output.

### UI polish
- Wider settings panel with overflow-safe sliders and ellipsized text inputs (no clipped values or wraparound distortion).
- Keyboard shortcuts for tools (1–4), undo/redo, and dialogs.

---

## Future enhancements

### Short term
- **Alignment guides & z-order** — Figma-style snap lines between chord boxes; bring-to-front/send-to-back for overlapping elements.
- **Text/annotation page objects** — titles, lyrics, measure numbers as movable items alongside chords for complete lead sheets.
- **Capo simulation** — capo position transposes auto-note labels and re-computes relative fingerings.
- **Duplicate chord shortcut** — Alt-drag a chord box to clone it on the page.
- **Zoom controls for the page canvas** — fit-to-window, 100%, custom zoom while keeping drag coordinates exact.

### Medium term
- **True vector PDF export** at exact paper dimensions with margin/bleed preview.
- **Print-safe rulers, margins & grid presets** baked into the page canvas with snap density control.
- **Alternate-tuning preset manager** — user-defined tunings saved by name, with per-chord tuning overrides.
- **Scale-mode overlay** — ghost dots showing Ionian/Dorian/pentatonic/etc. tones across the board to discover voicings visually.
- **Interactive audio playback** — strum a diagram via Web Audio synthesis; hear what you design.
- **Project import/export files** (`.gchords` JSON) for sharing and backup beyond localStorage.
- **Chord progression strip** — sequence chords on a timeline and auto-flow them onto pages in measures.

### Long term
- **AI-assisted voicing solver** — constraints like max finger span, must-include 3rd/7th, desired bass note → generate every valid voicing in a fret window, ranked by playability.
- **Multi-instrument geometry** — ukulele, 4/5-string bass, mandolin, 7-string guitar using the same taper/fret engine with different string counts and scale lengths.
- **MIDI export/import** — turn page sequences into MIDI files and back.
- **Cloud sync & accounts** — replace localStorage with synced storage for cross-device sheets.
- **Real-time collaborative editing** — CRDT-based (Yjs) shared canvas for teacher/student co-arranging.
- **PWA / offline install** — service-worker caching for lessons and stage use without connectivity.
- **Dark mode + independent print themes** — screen styling decoupled from ink-friendly output.

---

## Project layout

```
guitar-chords/
├── src/
│   ├── App.tsx                 # main app: pages, selection, tools, library, history wiring
│   ├── components/
│   │   ├── SettingsPanel.tsx   # per-chord geometry & style settings
│   │   ├── ItemDialog.tsx      # dot/text/fingering edit dialogs
│   │   └── ColorPicker.tsx     # RGBA color picker
│   └── lib/
│       ├── types.ts            # data model (Settings, ChordDoc, PageDoc, placements…)
│       ├── music.ts            # tunings, pitch math, chord library, search/tagging
│       ├── geometry.ts         # fret spacing, taper, string layout math
│       ├── render.ts           # SVG composition & hit testing
│       ├── shapes.ts           # dot shape/color palettes
│       ├── storage.ts          # localStorage persistence + migrations + exports
│       └── history.ts          # snapshot undo/redo manager (multi-slice)
└── (this README)
```
