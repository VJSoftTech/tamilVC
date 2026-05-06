/**
 * VideoGrid.js  (React Native)
 *
 * Responsive video tile layout that mirrors the server-side composite.
 * Uses a uniform CSS-like flexWrap grid for ALL participant counts.
 * No dominant-speaker or scrollable-strip layout.
 *
 * Grid mapping (mirrors server layoutEngine.js):
 *   n=1           → full screen
 *   n=2           → 2×1 landscape / 1×2 portrait
 *   n=3           → 2×2 landscape (last tile centred) / 1×3 portrait
 *   n=4           → 2×2
 *   n=5–6         → 3×2
 *   n=7–9         → 3×3
 *   n=10–12       → 4×3
 *   n=13–16       → 4×4
 *   n>16          → ceil(√n) cols
 *
 * Props:
 *   participants    - array of { id, stream, name, isActiveSpeaker }
 *   screenShareStream - MediaStream | null
 *   pinnedId        - string | null
 *   orientation     - 'portrait' | 'landscape'
 *   screenWidth     - number
 *   screenHeight    - number
 *   renderVideoTile - ({ stream, style, name, isActive }) => React element
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { computeTileSizes, computeGridDimensions } from '../hooks/useConferenceLayout';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const DEFAULT_TILE_BG = '#1a1a2e';

function TileWrapper({ style, label, children }) {
  return (
    <View style={[styles.tile, style]}>
      {children}
      {!!label && (
        <View style={styles.tileLabel}>
          <Text style={styles.tileLabelText} numberOfLines={1}>{label}</Text>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function VideoGrid({
  participants = [],
  screenShareStream = null,
  pinnedId = null,
  orientation,
  screenWidth,
  screenHeight,
  renderVideoTile,
}) {
  const n = participants.length;
  const hasScreenShare = !!screenShareStream;

  // Reorder: pinned / active speaker first (unless screen-share overrides)
  const ordered = useMemo(() => {
    if (hasScreenShare) return participants;
    if (!pinnedId) return participants;
    const idx = participants.findIndex(p => p.id === pinnedId);
    if (idx <= 0) return participants;
    const arr = [...participants];
    const [pinned] = arr.splice(idx, 1);
    return [pinned, ...arr];
  }, [participants, pinnedId, hasScreenShare]);

  const { tiles, dominant } = useMemo(
    () => computeTileSizes(n, screenWidth, screenHeight, orientation),
    [n, screenWidth, screenHeight, orientation],
  );

  // ── Screen-share layout ──────────────────────────────────────────────────
  if (hasScreenShare) {
    const isPortrait = orientation === 'portrait';
    const mainW = isPortrait ? screenWidth : Math.floor(screenWidth * 0.80);
    const mainH = isPortrait ? Math.floor(screenHeight * 0.80) : screenHeight;
    const stripH = isPortrait ? screenHeight - mainH : screenHeight;
    const stripW = isPortrait ? screenWidth : screenWidth - mainW;
    const maxTiles = 4;
    const tileW = isPortrait
      ? Math.floor(screenWidth / Math.max(1, Math.min(n, maxTiles)))
      : stripW;
    const tileH = isPortrait
      ? stripH
      : Math.floor(screenHeight / Math.max(1, Math.min(n, maxTiles)));

    const screenShareTile = renderVideoTile({
      stream: screenShareStream,
      style:  { width: mainW, height: mainH },
      name:   'Screen Share',
      isActive: false,
    });

    const participantTiles = ordered.slice(0, maxTiles).map((p, i) =>
      <TileWrapper key={p.id} style={{ width: tileW, height: tileH }} label={p.name}>
        {renderVideoTile({ stream: p.stream, style: StyleSheet.absoluteFillObject, name: p.name, isActive: p.isActiveSpeaker })}
      </TileWrapper>
    );

    return isPortrait ? (
      <View style={{ width: screenWidth, height: screenHeight, backgroundColor: '#000' }}>
        <View style={{ width: mainW, height: mainH }}>{screenShareTile}</View>
        <View style={{ flexDirection: 'row', height: stripH }}>
          {participantTiles}
        </View>
      </View>
    ) : (
      <View style={{ width: screenWidth, height: screenHeight, backgroundColor: '#000', flexDirection: 'row' }}>
        <View style={{ width: mainW, height: mainH }}>{screenShareTile}</View>
        <View style={{ flexDirection: 'column', width: stripW }}>
          {participantTiles}
        </View>
      </View>
    );
  }

  // ── 1 participant ────────────────────────────────────────────────────────
  if (n === 1) {
    const p = ordered[0];
    return (
      <TileWrapper style={{ width: screenWidth, height: screenHeight }} label={p.name}>
        {renderVideoTile({ stream: p.stream, style: StyleSheet.absoluteFillObject, name: p.name, isActive: true })}
      </TileWrapper>
    );
  }

  // ── 2 participants ───────────────────────────────────────────────────────
  if (n === 2) {
    const isPortrait = orientation === 'portrait';
    return (
      <View style={{
        width: screenWidth, height: screenHeight, backgroundColor: '#000',
        flexDirection: isPortrait ? 'column' : 'row',
      }}>
        {ordered.slice(0, 2).map((p, i) => (
          <TileWrapper key={p.id} style={tiles[i]} label={p.name}>
            {renderVideoTile({ stream: p.stream, style: StyleSheet.absoluteFillObject, name: p.name, isActive: p.isActiveSpeaker })}
          </TileWrapper>
        ))}
      </View>
    );
  }

  // ── 3+ participants — uniform grid (mirrors server layoutEngine) ──────────
  const isPortrait = orientation === 'portrait';
  const { cols, rows } = computeGridDimensions(n, isPortrait);
  const tileW = Math.floor(screenWidth  / cols);
  const tileH = Math.floor(screenHeight / rows);

  // For a partial last row (e.g. 5 tiles in 3×2), centre the remaining tiles
  // by adding invisible spacers so the row is right-padded to the grid width.
  const lastRowCount = n % cols === 0 ? cols : n % cols;
  const spacerCount  = lastRowCount < cols ? cols - lastRowCount : 0;

  return (
    <View style={{
      width: screenWidth, height: screenHeight,
      backgroundColor: '#000',
      flexDirection: 'row', flexWrap: 'wrap',
      alignContent: 'flex-start',
    }}>
      {ordered.map(p => (
        <TileWrapper key={p.id} style={{ width: tileW, height: tileH }} label={p.name}>
          {renderVideoTile({
            stream: p.stream,
            style:  StyleSheet.absoluteFillObject,
            name:   p.name,
            isActive: p.isActiveSpeaker,
          })}
        </TileWrapper>
      ))}
      {/* Invisible spacers to keep partial last row left-aligned within grid */}
      {Array.from({ length: spacerCount }, (_, i) => (
        <View key={`spacer-${i}`} style={{ width: tileW, height: tileH }} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  tile: {
    overflow:        'hidden',
    backgroundColor: DEFAULT_TILE_BG,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.08)',
  },
  tileLabel: {
    position:        'absolute',
    bottom:          6,
    left:            6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6,
    paddingVertical:   2,
    borderRadius:    4,
  },
  tileLabelText: {
    color:    '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
});
