'use strict';

/**
 * layoutEngine.js
 * Builds FFmpeg filter_complex strings for composite recording.
 *
 * Input stream ordering convention (passed to FFmpeg):
 *   Each participant occupies TWO sequential inputs: [2i:v] video, [2i+1:a] audio
 *   Screen-share participant (if any) is ALWAYS input index 0.
 *
 * Grid layout rules (participant-only, no screen share):
 *   n=1           → 1×1  full screen
 *   n=2           → landscape: 2×1 (side-by-side)  |  portrait: 1×2 (stacked)
 *   n=3           → landscape: 2×2 last-tile centred | portrait: 1×3 (no gaps)
 *   n=4           → 2×2
 *   n=5–6         → 3×2
 *   n=7–9         → 3×3
 *   n=10–12       → 4×3
 *   n=13–16       → 4×4
 *   n>16          → ceil(√n) columns, rows filled top-to-bottom
 *
 * Tile rendering: scale-to-COVER (fills cell fully, crops overflow, no black bars)
 * Last row: centred when not completely full.
 *
 * Screen-share layout:
 *   Main area (80 %): screen content – scale-to-contain (no cropping of slides)
 *   Thumb strip (20 %): webcam tiles  – scale-to-cover
 *
 * Orientations:
 *   portrait  → 720 × 1280
 *   landscape → 1280 × 720
 */

const DIMS = {
  portrait:  { W: 720,  H: 1280 },
  landscape: { W: 1280, H: 720  },
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * @param {object}  state
 * @param {'portrait'|'landscape'} state.orientation
 * @param {string[]} state.participants   – ordered participant IDs
 * @param {string|null} state.screenShareId
 * @param {string|null} state.pinnedId
 * @param {string|null} state.activeSpeakerId
 * @returns {{ filterComplex: string, videoMap: string, audioMap: string, orderedIds: string[] }}
 */
function buildFilterComplex(state) {
  const {
    orientation = 'landscape',
    participants = [],
    screenShareId,
    pinnedId,
    activeSpeakerId,
  } = state;
  const { W, H } = DIMS[orientation] || DIMS.landscape;

  const ordered = reorderParticipants(participants, screenShareId, pinnedId || activeSpeakerId);
  const n = ordered.length;

  if (n === 0) {
    const fc = `color=black:s=${W}x${H}:r=30[vout];aevalsrc=0:c=stereo:s=48000[aout]`;
    return { filterComplex: fc, videoMap: '[vout]', audioMap: '[aout]', orderedIds: [] };
  }

  if (screenShareId && ordered.includes(screenShareId)) {
    return buildScreenShareLayout(ordered, W, H);
  }

  return buildDynamicGridLayout(ordered, W, H, orientation);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reorderParticipants(participants, screenShareId, priorityId) {
  let arr = [...participants];
  if (screenShareId) {
    arr = [screenShareId, ...arr.filter(id => id !== screenShareId)];
  }
  if (priorityId && priorityId !== screenShareId) {
    const idx = arr.indexOf(priorityId);
    if (idx > 1) {
      arr.splice(idx, 1);
      arr.splice(1, 0, priorityId);
    }
  }
  return arr;
}

/**
 * Scale-to-COVER: scale the video so it fills w×h exactly, then centre-crop.
 * No black bars appear inside the tile; slight overflow is cropped.
 */
function scaleCover(streamIdx, w, h, label) {
  return (
    `[${streamIdx * 2}:v]` +
    `scale=${w}:${h}:force_original_aspect_ratio=increase,` +
    `crop=${w}:${h}` +
    `[${label}]`
  );
}

/**
 * Scale-to-CONTAIN: fit within w×h with black letterbox/pillarbox padding.
 * Used for screen-share main area so slide/desktop content is never cropped.
 */
function scaleContain(streamIdx, w, h, label) {
  return (
    `[${streamIdx * 2}:v]` +
    `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black` +
    `[${label}]`
  );
}

/** Mix audio from all n streams; single-stream is a pass-through resample. */
function amix(count) {
  if (count === 1) {
    return `[1:a]aresample=48000[aout]`;
  }
  const inputs = Array.from({ length: count }, (_, i) => `[${i * 2 + 1}:a]`).join('');
  return `${inputs}amix=inputs=${count}:normalize=0,aresample=48000[aout]`;
}

/**
 * Compute optimal grid dimensions (cols × rows) for n participants.
 * Chosen to keep tiles close to 16:9 and minimise empty space.
 */
function computeGrid(n, W, H) {
  if (n <= 1)  return { cols: 1, rows: 1 };
  if (n === 2) return W >= H ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
  // n=3: portrait stacks 3 rows (no gaps); landscape uses 2×2 (last tile centred)
  if (n === 3) return W >= H ? { cols: 2, rows: 2 } : { cols: 1, rows: 3 };
  if (n <= 4)  return { cols: 2, rows: 2 };
  if (n <= 6)  return { cols: 3, rows: 2 };
  if (n <= 9)  return { cols: 3, rows: 3 };
  if (n <= 12) return { cols: 4, rows: 3 };
  if (n <= 16) return { cols: 4, rows: 4 };
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

/**
 * Compute pixel-aligned tile positions that partition the canvas.
 *
 * For full rows the width/height is distributed via integer partitioning so
 * the tiles fill the canvas exactly (1-px rounding differences are invisible).
 * For a partial last row the tiles use uniform size and are centred.
 *
 * Returns an array of { x, y, w, h } for each of the n tiles.
 */
function computeTilePositions(n, cols, rows, W, H) {
  const lastRowCount = (n % cols === 0) ? cols : (n % cols);
  const positions = [];

  // Uniform tile size for last-row centering
  const uniformTW = Math.floor(W / cols);
  const uniformTH = Math.floor(H / rows);

  for (let i = 0; i < n; i++) {
    const row  = Math.floor(i / cols);
    const col  = i % cols;
    const isLastRow    = row === rows - 1;
    const isPartialRow = isLastRow && lastRowCount < cols;

    let x, y, w, h;

    if (isPartialRow) {
      // Centre the partial last row; tiles all have the same size
      const rowStartX = Math.floor((W - lastRowCount * uniformTW) / 2);
      x = rowStartX + col * uniformTW;
      y = Math.floor(row * H / rows);
      w = uniformTW;
      h = H - y;          // last row gets remaining pixels (≥ uniformTH)
    } else {
      // Full row: integer-partition for pixel-perfect fill
      x = Math.floor(col * W / cols);
      y = Math.floor(row * H / rows);
      w = Math.floor((col + 1) * W / cols) - x;
      h = Math.floor((row + 1) * H / rows) - y;
    }

    positions.push({ x, y, w, h });
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Layout builders
// ---------------------------------------------------------------------------

/**
 * Dynamic full-grid layout for any number of participants.
 *
 * All tiles use scale-to-cover so there are no black bars inside any cell.
 * For a non-square participant count the partial last row is centred;
 * the canvas edges show the background colour only at the sides of that row.
 */
function buildDynamicGridLayout(ordered, W, H, orientation) {
  const n = ordered.length;
  const parts = [];
  const { cols, rows } = computeGrid(n, W, H);
  const positions = computeTilePositions(n, cols, rows, W, H);

  // 1. Scale every tile (cover mode: fill cell, centre-crop)
  for (let i = 0; i < n; i++) {
    const { w, h } = positions[i];
    parts.push(scaleCover(i, w, h, `t${i}`));
  }

  // 2. Black base canvas (visible only behind centred partial-last-row, if any)
  parts.push(`color=black:s=${W}x${H}:r=30[base]`);

  // 3. Chain overlays: place each tile at its computed position
  let prev = 'base';
  for (let i = 0; i < n; i++) {
    const { x, y } = positions[i];
    const out = (i === n - 1) ? 'vout' : `f${i}`;
    parts.push(`[${prev}][t${i}]overlay=${x}:${y}[${out}]`);
    prev = out;
  }

  // 4. Mix all audio streams
  parts.push(amix(n));

  return {
    filterComplex: parts.join(';'),
    videoMap: '[vout]',
    audioMap: '[aout]',
    orderedIds: ordered,
  };
}

/**
 * Screen-share layout:
 *   ordered[0]  = screen-share stream  → main area (80 %, scale-to-contain)
 *   ordered[1…] = webcam participants  → thumbnail strip (20 %, scale-to-cover)
 *
 * Portrait: main on top, strip on bottom.
 * Landscape: main on left, strip on right.
 */
function buildScreenShareLayout(ordered, W, H) {
  const isPortrait = H > W;
  const parts = [];
  const n = ordered.length;
  const thumbCount = n - 1;

  if (isPortrait) {
    const mainH  = thumbCount > 0 ? Math.floor(H * 0.80) : H;
    const stripH = H - mainH;
    const tW     = thumbCount > 0 ? Math.floor(W / thumbCount) : W;

    parts.push(scaleContain(0, W, mainH, 'vmain'));
    for (let i = 0; i < thumbCount; i++) {
      parts.push(scaleCover(i + 1, tW, stripH, `vt${i}`));
    }
    parts.push(`color=black:s=${W}x${H}:r=30[base]`);
    parts.push(`[base][vmain]overlay=0:0[f_main]`);

    if (thumbCount > 0) {
      let prev = 'f_main';
      for (let i = 0; i < thumbCount; i++) {
        const out = (i === thumbCount - 1) ? 'vout' : `fth${i}`;
        parts.push(`[${prev}][vt${i}]overlay=${i * tW}:${mainH}[${out}]`);
        prev = out;
      }
    } else {
      parts.push(`[f_main]copy[vout]`);
    }
  } else {
    const mainW = thumbCount > 0 ? Math.floor(W * 0.80) : W;
    const colW  = W - mainW;
    const tH    = thumbCount > 0 ? Math.floor(H / thumbCount) : H;

    parts.push(scaleContain(0, mainW, H, 'vmain'));
    for (let i = 0; i < thumbCount; i++) {
      parts.push(scaleCover(i + 1, colW, tH, `vt${i}`));
    }
    parts.push(`color=black:s=${W}x${H}:r=30[base]`);
    parts.push(`[base][vmain]overlay=0:0[f_main]`);

    if (thumbCount > 0) {
      let prev = 'f_main';
      for (let i = 0; i < thumbCount; i++) {
        const out = (i === thumbCount - 1) ? 'vout' : `fth${i}`;
        parts.push(`[${prev}][vt${i}]overlay=${mainW}:${i * tH}[${out}]`);
        prev = out;
      }
    } else {
      parts.push(`[f_main]copy[vout]`);
    }
  }

  parts.push(amix(n));

  return {
    filterComplex: parts.join(';'),
    videoMap: '[vout]',
    audioMap: '[aout]',
    orderedIds: ordered,
  };
}

export { buildFilterComplex, DIMS };
