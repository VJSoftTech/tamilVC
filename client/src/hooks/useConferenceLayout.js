/**
 * useConferenceLayout.js
 *
 * Hook that tracks screen orientation, participant list, active speaker,
 * pinned participant, and screen-share state.
 *
 * Automatically sends layout updates to the server via Socket.IO
 * whenever any of these values change.
 *
 * Usage:
 *   const layout = useConferenceLayout({ socket, meetingId, isHost, participants });
 *   // layout.orientation, layout.tileLayout, etc.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * Returns 'portrait' or 'landscape' based on window dimensions.
 */
function getOrientation(width, height) {
  return height >= width ? 'portrait' : 'landscape';
}

/**
 * Compute grid dimensions (cols × rows) for n participants.
 * Mirrors the server-side layoutEngine.js computeGrid() logic exactly.
 */
function computeGridDimensions(n, isPortrait) {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return isPortrait ? { cols: 1, rows: 2 } : { cols: 2, rows: 1 };
  // n=3: 3 in a row (landscape) / stacked (portrait) — matches Google Meet
  if (n === 3) return isPortrait ? { cols: 1, rows: 3 } : { cols: 3, rows: 1 };
  if (n <= 4)  return { cols: 2, rows: 2 };
  if (n <= 6)  return { cols: 3, rows: 2 };
  if (n <= 9)  return { cols: 3, rows: 3 };
  if (n <= 12) return { cols: 4, rows: 3 };
  if (n <= 16) return { cols: 4, rows: 4 };
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

/**
 * Compute tile sizes for the video grid.
 *
 * Returns an array of { width, height } objects — one per participant.
 * All tiles are equal-sized (uniform grid). No dominant-speaker layout.
 */
export function computeTileSizes(participantCount, screenWidth, screenHeight, orientation) {
  const n = participantCount;
  if (n === 0) return { tiles: [], dominant: null };

  const isPortrait = orientation === 'portrait';
  const { cols, rows } = computeGridDimensions(n, isPortrait);

  const tileW = Math.floor(screenWidth  / cols);
  const tileH = Math.floor(screenHeight / rows);

  return {
    tiles:    Array.from({ length: n }, () => ({ width: tileW, height: tileH })),
    dominant: null,
  };
}

export { computeGridDimensions };

/**
 * @param {object} opts
 * @param {object}   opts.socket           - socket.io-client socket
 * @param {string}   opts.meetingId
 * @param {boolean}  opts.isHost
 * @param {string[]} opts.participants     - array of participant IDs
 * @param {string|null} opts.activeSpeakerId
 * @param {string|null} opts.screenShareId
 * @param {string|null} opts.pinnedId
 */
export function useConferenceLayout({
  socket,
  meetingId,
  isHost = false,
  participants = [],
  activeSpeakerId = null,
  screenShareId   = null,
  pinnedId        = null,
}) {
  const { width, height } = useWindowDimensions();
  const orientation = getOrientation(width, height);

  // Compute tile geometry whenever anything changes
  const { tiles, dominant } = computeTileSizes(
    participants.length,
    width,
    height,
    orientation,
  );

  // Send layout update to server (debounced 300 ms)
  const timerRef = useRef(null);

  const sendLayout = useCallback(() => {
    if (!socket || !meetingId) return;
    socket.emit('recording:layout', {
      meetingId,
      orientation,
      participants,
      activeSpeakerId,
      screenShareId,
      pinnedId,
    });
  }, [socket, meetingId, orientation, participants, activeSpeakerId, screenShareId, pinnedId]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(sendLayout, 300);
    return () => clearTimeout(timerRef.current);
  }, [sendLayout]);

  return {
    orientation,
    screenWidth:  width,
    screenHeight: height,
    tileSizes:    tiles,
    dominantSize: dominant,
  };
}
