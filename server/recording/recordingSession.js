'use strict';

/**
 * recordingSession.js
 *
 * Manages one recording session per meeting.
 * Uses mediasoup PlainRtpTransport → FFmpeg composite pipeline.
 *
 * Each participant needs two mediasoup Producers:
 *   { videoProducerId, audioProducerId }
 *
 * How it works:
 *   1. For each participant we create two PlainRtpTransports (video + audio).
 *   2. We create Consumers on those transports to receive RTP on localhost UDP.
 *   3. FFmpeg reads those UDP RTP streams via per-stream SDP files.
 *   4. FFmpeg composites everything and writes to an MP4 file.
 *   5. When layout changes we rebuild filter_complex and restart FFmpeg,
 *      then concatenate segments into one final file at stop().
 */

import { spawn }  from 'child_process';
import path       from 'path';
import fs         from 'fs';
import os         from 'os';
import { buildFilterComplex, DIMS } from './layoutEngine.js';

// ── Port pool ────────────────────────────────────────────────────────────────
let _nextPort = 40000;
function allocatePorts(n) {
  const ports = Array.from({ length: n }, (_, i) => _nextPort + i * 2);
  _nextPort += n * 2;
  return ports; // each element is an even port; RTCP = port+1
}

// ── SDP helpers ──────────────────────────────────────────────────────────────

const CODEC_INFO = {
  VP8:  { pt: 96,  clockRate: 90000 },
  VP9:  { pt: 97,  clockRate: 90000 },
  H264: { pt: 125, clockRate: 90000 },
  opus: { pt: 100, clockRate: 48000, channels: 2 },
  PCMU: { pt: 0,   clockRate: 8000 },
  PCMA: { pt: 8,   clockRate: 8000 },
};

function buildSdpFile(port, kind, codecName) {
  const c = CODEC_INFO[codecName];
  if (!c) throw new Error(`Unknown codec: ${codecName}`);
  const ch = c.channels ? `/${c.channels}` : '';
  const lines = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=RN Recording',
    'c=IN IP4 127.0.0.1',
    't=0 0',
    `m=${kind} ${port} RTP/AVP ${c.pt}`,
    `a=rtpmap:${c.pt} ${codecName}/${c.clockRate}${ch}`,
    'a=recvonly',
    '',
  ].join('\r\n');

  const sdpPath = path.join(os.tmpdir(), `rn_rec_${kind}_${port}.sdp`);
  fs.writeFileSync(sdpPath, lines);
  return sdpPath;
}

// ── RecordingSession ─────────────────────────────────────────────────────────

class RecordingSession {
  /**
   * @param {string}   meetingId
   * @param {object}   mediasoupRouter  - mediasoup Router instance
   * @param {string}   outputDir        - directory to write MP4 files
   */
  constructor(meetingId, mediasoupRouter, outputDir) {
    this.meetingId  = meetingId;
    this.router     = mediasoupRouter;
    this.outputDir  = outputDir;
    this.startTime  = Date.now();

    // participant data: id → { videoPort, audioPort, videoSdp, audioSdp,
    //                          videoTransport, audioTransport,
    //                          videoConsumer, audioConsumer }
    this.participants = new Map();

    this.layoutState = {
      orientation:    'portrait',
      participants:   [],   // ordered list of IDs
      screenShareId:  null,
      pinnedId:       null,
      activeSpeakerId: null,
    };

    this.segments      = []; // paths of recorded MP4 segments
    this.segmentIndex  = 0;
    this.ffmpegProcess = null;
    this.isRunning     = false;
    this._layoutTimer  = null;
    this._segStartTime = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Add a participant's streams.
   * @param {string} participantId
   * @param {object} videoProducer - mediasoup Producer (kind === 'video')
   * @param {object} audioProducer - mediasoup Producer (kind === 'audio')
   */
  async addParticipant(participantId, videoProducer, audioProducer) {
    if (this.participants.has(participantId)) return; // already added

    const [videoPort, audioPort] = allocatePorts(2);

    // Create plain RTP transports (no encryption, fixed remote addr)
    const makeTransport = () => this.router.createPlainTransport({
      listenIp:  { ip: '127.0.0.1', announcedIp: null },
      rtcpMux:   true,
      comedia:   false,
    });

    const videoTransport = await makeTransport();
    const audioTransport = await makeTransport();

    // Tell the transport to send RTP to FFmpeg's listening port
    await videoTransport.connect({ ip: '127.0.0.1', port: videoPort });
    await audioTransport.connect({ ip: '127.0.0.1', port: audioPort });

    // Consume producers — this causes mediasoup to forward RTP to the transport
    const videoConsumer = videoProducer
      ? await videoTransport.consume({
          producerId:      videoProducer.id,
          rtpCapabilities: this.router.rtpCapabilities,
          paused:          false,
        })
      : null;

    const audioConsumer = audioProducer
      ? await audioTransport.consume({
          producerId:      audioProducer.id,
          rtpCapabilities: this.router.rtpCapabilities,
          paused:          false,
        })
      : null;

    // Derive codec names for SDP files
    const videoCodec = videoConsumer
      ? videoConsumer.rtpParameters.codecs[0].mimeType.split('/')[1].toUpperCase()
      : 'VP8';
    const audioCodec = audioConsumer
      ? audioConsumer.rtpParameters.codecs[0].mimeType.split('/')[1].toLowerCase() === 'opus'
        ? 'opus'
        : audioConsumer.rtpParameters.codecs[0].mimeType.split('/')[1].toUpperCase()
      : 'opus';

    const videoSdp = buildSdpFile(videoPort, 'video', videoCodec);
    const audioSdp = buildSdpFile(audioPort, 'audio', audioCodec);

    this.participants.set(participantId, {
      videoPort, audioPort,
      videoSdp, audioSdp,
      videoTransport, audioTransport,
      videoConsumer, audioConsumer,
    });

    if (!this.layoutState.participants.includes(participantId)) {
      this.layoutState.participants.push(participantId);
    }

    if (this.isRunning) this._scheduleRestart();
    return { videoPort, audioPort };
  }

  removeParticipant(participantId) {
    const p = this.participants.get(participantId);
    if (!p) return;

    p.videoConsumer?.close();
    p.audioConsumer?.close();
    p.videoTransport?.close();
    p.audioTransport?.close();

    // Clean SDP temp files
    try { fs.unlinkSync(p.videoSdp); } catch {}
    try { fs.unlinkSync(p.audioSdp); } catch {}

    this.participants.delete(participantId);
    this.layoutState.participants = this.layoutState.participants.filter(id => id !== participantId);

    if (this.isRunning) this._scheduleRestart();
  }

  /**
   * Update layout state from React Native app.
   * @param {object} layout
   */
  updateLayout(layout) {
    this.layoutState = { ...this.layoutState, ...layout };
    if (this.isRunning) this._scheduleRestart();
  }

  /** Start recording. */
  async start() {
    if (this.participants.size === 0) throw new Error('No participants');
    this.isRunning = true;
    await this._startFFmpegSegment();
  }

  /** Stop recording — concatenate all segments and return final MP4 path. */
  async stop() {
    this.isRunning = false;
    if (this._layoutTimer) clearTimeout(this._layoutTimer);

    const segPath = await this._stopCurrentFFmpeg();
    if (segPath) this.segments.push(segPath);

    const finalPath = await this._concatenateSegments();
    this._cleanup();
    return {
      outputPath: finalPath,
      duration:   Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _scheduleRestart() {
    if (this._layoutTimer) clearTimeout(this._layoutTimer);
    // Debounce 800 ms so rapid orientation changes don't thrash FFmpeg
    this._layoutTimer = setTimeout(() => this._restartFFmpeg(), 800);
  }

  async _restartFFmpeg() {
    if (!this.isRunning) return;
    const segPath = await this._stopCurrentFFmpeg();
    if (segPath) this.segments.push(segPath);
    await this._startFFmpegSegment();
  }

  _buildFFmpegArgs(segmentPath) {
    const { orderedIds, filterComplex, videoMap, audioMap } =
      buildFilterComplex(this.layoutState);

    // Build inputs in the same order as orderedIds
    const inputs = [];
    const PROTOCOL_WHITELIST = 'file,crypto,data,rtp,udp';

    for (const id of orderedIds) {
      const p = this.participants.get(id);
      if (!p) continue;
      inputs.push(
        '-protocol_whitelist', PROTOCOL_WHITELIST, '-i', p.videoSdp,
        '-protocol_whitelist', PROTOCOL_WHITELIST, '-i', p.audioSdp,
      );
    }

    const { W, H } = DIMS[this.layoutState.orientation] || DIMS.portrait;

    return [
      '-y',
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', videoMap,
      '-map', audioMap,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-s', `${W}x${H}`, '-r', '30', '-g', '60',
      '-c:a', 'aac', '-ar', '48000', '-b:a', '128k',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      segmentPath,
    ];
  }

  async _startFFmpegSegment() {
    this.segmentIndex += 1;
    const segPath = path.join(
      this.outputDir,
      `seg_${this.meetingId}_${this.startTime}_${this.segmentIndex}.mp4`,
    );
    this._segStartTime = Date.now();

    const args = this._buildFFmpegArgs(segPath);
    console.log(`[Recording:${this.meetingId}] Starting FFmpeg segment ${this.segmentIndex}`);

    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    this.ffmpegProcess = proc;
    this._currentSegPath = segPath;

    proc.stderr.on('data', d => {
      const msg = d.toString();
      // Log frame updates without flooding
      if (!msg.includes('frame=')) console.error(`[FFmpeg] ${msg.trim()}`);
    });
    proc.on('error', err => console.error('[FFmpeg spawn error]', err.message));
    proc.on('close', code => {
      if (code && code !== 255) {
        console.error(`[Recording:${this.meetingId}] FFmpeg exited unexpectedly: ${code}`);
      }
    });
  }

  _stopCurrentFFmpeg() {
    return new Promise(resolve => {
      const proc = this.ffmpegProcess;
      const segPath = this._currentSegPath;
      if (!proc) { resolve(null); return; }

      proc.once('close', () => {
        // Only keep segment if it has content
        const exists = segPath && fs.existsSync(segPath) && fs.statSync(segPath).size > 0;
        resolve(exists ? segPath : null);
      });

      // Ask FFmpeg to stop gracefully
      try { proc.stdin.write('q'); } catch {}
      proc.kill('SIGTERM');

      // Force kill after 8 s
      const force = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 8000);
      proc.once('close', () => clearTimeout(force));
    });
  }

  async _concatenateSegments() {
    if (this.segments.length === 0) return null;

    const finalPath = path.join(
      this.outputDir,
      `recording_${this.meetingId}_${this.startTime}.mp4`,
    );

    if (this.segments.length === 1) {
      fs.renameSync(this.segments[0], finalPath);
      return finalPath;
    }

    // Write concat list file
    const listPath = path.join(os.tmpdir(), `concat_${this.meetingId}.txt`);
    const listContent = this.segments.map(s => `file '${s}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-y', '-f', 'concat', '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        finalPath,
      ], { stdio: 'inherit' });
      proc.on('close', code => {
        fs.unlinkSync(listPath);
        code === 0 ? resolve() : reject(new Error(`ffmpeg concat failed: ${code}`));
      });
    });

    // Remove segment files
    for (const seg of this.segments) {
      try { fs.unlinkSync(seg); } catch {}
    }

    return finalPath;
  }

  _cleanup() {
    for (const [, p] of this.participants) {
      p.videoConsumer?.close();
      p.audioConsumer?.close();
      p.videoTransport?.close();
      p.audioTransport?.close();
      try { fs.unlinkSync(p.videoSdp); } catch {}
      try { fs.unlinkSync(p.audioSdp); } catch {}
    }
    this.participants.clear();
  }
}

// ── RecordingManager (session registry) ─────────────────────────────────────

class RecordingManager {
  constructor(outputDir) {
    this.outputDir = outputDir;
    this.sessions  = new Map();
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  }

  /** Create (or return existing) session for a meeting. */
  create(meetingId, mediasoupRouter) {
    if (this.sessions.has(meetingId)) return this.sessions.get(meetingId);
    const session = new RecordingSession(meetingId, mediasoupRouter, this.outputDir);
    this.sessions.set(meetingId, session);
    return session;
  }

  get(meetingId)    { return this.sessions.get(meetingId) || null; }
  has(meetingId)    { return this.sessions.has(meetingId); }
  delete(meetingId) { this.sessions.delete(meetingId); }
}

export { RecordingManager, RecordingSession };
