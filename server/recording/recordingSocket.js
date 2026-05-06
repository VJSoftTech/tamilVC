/**
 * recordingSocket.js  (ESM)
 *
 * Registers recording-related Socket.IO event handlers on each socket.
 * Designed to plug directly into the existing setupSocket() function.
 *
 * Socket events FROM client:
 *   recording:start   { meetingId }
 *   recording:stop    { meetingId }
 *   recording:layout  { meetingId, orientation, participants,
 *                        screenShareId, pinnedId, activeSpeakerId }
 *
 * Socket events TO room:
 *   recording:started  { meetingId }
 *   recording:stopped  { meetingId, downloadUrl, duration, fileSize, filename }
 *   recording:error    { meetingId, message }
 */

import path from 'path';
import fs   from 'fs';
import { RecordingManager } from './recordingSession.js';
import { getMediasoupRouter, producers } from '../mediasoupServer.js';
import { db } from '../db/index.js';
import { meetings } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

// ── Singleton manager (shared across all socket connections) ─────────────────
let _manager = null;

export function getRecordingManager() {
  return _manager;
}

export function initRecordingManager(outputDir) {
  if (!_manager) _manager = new RecordingManager(outputDir);
  return _manager;
}

// ── Helper: gather all producers for a meeting, grouped by userId ─────────────
function getParticipantProducers(meetingId) {
  const byUser = new Map(); // userId -> { videoProducer, audioProducer }

  for (const [, entry] of producers) {
    if (entry.meetingId !== meetingId) continue;
    const uid = String(entry.userId);
    if (!byUser.has(uid)) byUser.set(uid, { videoProducer: null, audioProducer: null });
    const rec = byUser.get(uid);
    if (entry.kind === 'video') rec.videoProducer = entry.producer;
    if (entry.kind === 'audio') rec.audioProducer = entry.producer;
  }

  return Array.from(byUser.entries()).map(([participantId, prods]) => ({
    participantId,
    ...prods,
  }));
}

// ── Helper: check if socket user is meeting host (DB lookup) ─────────────────
async function isMeetingHost(userId, meetingId) {
  try {
    const [meeting] = await db.select({ hostId: meetings.hostId })
      .from(meetings).where(eq(meetings.meetingId, meetingId));
    return meeting && String(meeting.hostId) === String(userId);
  } catch {
    return false;
  }
}

// ── Register handlers on a single socket ─────────────────────────────────────
export function registerRecordingHandlers(io, socket, baseDownloadUrl) {
  const manager = _manager;
  const user    = socket.user;

  if (!manager) {
    console.warn('[Recording] Manager not initialised — call initRecordingManager first');
    return;
  }

  // ── recording:start ────────────────────────────────────────────────────────
  socket.on('recording:start', async ({ meetingId } = {}) => {
    if (!meetingId || !user) return;

    const hostOk = await isMeetingHost(user.id, meetingId);
    if (!hostOk) {
      socket.emit('recording:error', { meetingId, message: 'Only the host can start recording.' });
      return;
    }

    if (manager.has(meetingId)) {
      socket.emit('recording:error', { meetingId, message: 'Recording already in progress.' });
      return;
    }

    try {
      const router       = await getMediasoupRouter(meetingId);
      const session      = manager.create(meetingId, router);
      const participants = getParticipantProducers(meetingId);

      if (participants.length === 0) {
        manager.delete(meetingId);
        socket.emit('recording:error', { meetingId, message: 'No active streams to record.' });
        return;
      }

      for (const { participantId, videoProducer, audioProducer } of participants) {
        await session.addParticipant(participantId, videoProducer, audioProducer);
      }

      await session.start();
      io.to(`meeting:${meetingId}`).emit('recording:started', { meetingId });
      console.log(`[Recording] Started — meeting ${meetingId}`);
    } catch (err) {
      console.error('[Recording] Start error:', err);
      manager.delete(meetingId);
      socket.emit('recording:error', { meetingId, message: err.message });
    }
  });

  // ── recording:stop ─────────────────────────────────────────────────────────
  socket.on('recording:stop', async ({ meetingId } = {}) => {
    if (!meetingId || !user) return;

    const hostOk = await isMeetingHost(user.id, meetingId);
    if (!hostOk) {
      socket.emit('recording:error', { meetingId, message: 'Only the host can stop recording.' });
      return;
    }

    const session = manager.get(meetingId);
    if (!session) {
      socket.emit('recording:error', { meetingId, message: 'No active recording.' });
      return;
    }

    try {
      const { outputPath, duration } = await session.stop();
      manager.delete(meetingId);

      const filename    = path.basename(outputPath);
      const fileSize    = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
      const downloadUrl = `${baseDownloadUrl}/${encodeURIComponent(filename)}`;

      io.to(`meeting:${meetingId}`).emit('recording:stopped', {
        meetingId, downloadUrl, duration, fileSize, filename,
      });
      console.log(`[Recording] Stopped — meeting ${meetingId} → ${outputPath}`);
    } catch (err) {
      console.error('[Recording] Stop error:', err);
      socket.emit('recording:error', { meetingId, message: err.message });
    }
  });

  // ── recording:layout ───────────────────────────────────────────────────────
  socket.on('recording:layout', ({ meetingId, ...layout } = {}) => {
    if (!meetingId) return;
    const session = manager.get(meetingId);
    if (session) session.updateLayout(layout);
  });

  // ── recording:participant_join ─────────────────────────────────────────────
  socket.on('recording:participant_join', async ({ meetingId, participantId } = {}) => {
    const session = manager.get(meetingId);
    if (!session) return;
    try {
      const all = getParticipantProducers(meetingId);
      const p   = all.find(x => x.participantId === participantId);
      if (p) await session.addParticipant(p.participantId, p.videoProducer, p.audioProducer);
    } catch (err) {
      console.error('[Recording] participant_join error:', err);
    }
  });

  // ── recording:participant_leave ────────────────────────────────────────────
  socket.on('recording:participant_leave', ({ meetingId, participantId } = {}) => {
    const session = manager.get(meetingId);
    if (session && participantId) session.removeParticipant(participantId);
  });
}
