import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const activeJobs = new Map();
let asrPipelinePromise = null;

function getStem(fileName) {
  return path.parse(fileName).name;
}

export function getSubtitlePaths(recordingsDir, fileName) {
  const stem = getStem(fileName);
  return {
    videoPath: path.join(recordingsDir, fileName),
    audioPath: path.join(recordingsDir, `${stem}.wav`),
    vttPath: path.join(recordingsDir, `${stem}.vtt`),
    srtPath: path.join(recordingsDir, `${stem}.srt`),
    statusPath: path.join(recordingsDir, `${stem}.subtitles.json`),
    embeddedPath: path.join(recordingsDir, `${stem}.subtitled.mp4`),
  };
}

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

function writeStatus(statusPath, payload) {
  fs.writeFileSync(statusPath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    ...payload,
  }, null, 2));
}

export function readSubtitleStatus(recordingsDir, fileName) {
  const { statusPath, vttPath, srtPath, embeddedPath } = getSubtitlePaths(recordingsDir, fileName);

  if (fs.existsSync(statusPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      return {
        status: raw.status || 'pending',
        message: raw.message || '',
        updatedAt: raw.updatedAt || null,
        hasVtt: fs.existsSync(vttPath),
        hasSrt: fs.existsSync(srtPath),
        hasEmbedded: fs.existsSync(embeddedPath),
      };
    } catch {}
  }

  const hasVtt = fs.existsSync(vttPath);
  const hasSrt = fs.existsSync(srtPath);
  if (hasVtt || hasSrt) {
    return {
      status: 'ready',
      message: 'Subtitles ready',
      updatedAt: null,
      hasVtt,
      hasSrt,
      hasEmbedded: fs.existsSync(embeddedPath),
    };
  }

  return {
    status: 'pending',
    message: 'Waiting to generate subtitles',
    updatedAt: null,
    hasVtt: false,
    hasSrt: false,
    hasEmbedded: false,
  };
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `${command} exited with code ${code}`));
    });
  });
}

async function detectCommand(command, args) {
  try {
    await runCommand(command, args);
    return true;
  } catch {
    return false;
  }
}

async function resolveFfmpegCommand() {
  if (await detectCommand('ffmpeg', ['-version'])) {
    return 'ffmpeg';
  }

  try {
    const mod = await import('ffmpeg-static');
    const ffmpegPath = mod.default || mod;
    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
      return ffmpegPath;
    }
  } catch {}

  return null;
}

async function resolveTooling() {
  const ffmpeg = await resolveFfmpegCommand();
  if (!ffmpeg) {
    return {
      ffmpeg: null,
      whisper: null,
      message: 'FFmpeg is unavailable. Install FFmpeg or keep ffmpeg-static in dependencies.',
    };
  }

  if (await detectCommand('whisper', ['--help'])) {
    return {
      ffmpeg,
      whisper: { mode: 'cli', command: 'whisper', baseArgs: [] },
      message: '',
    };
  }

  if (await detectCommand('python', ['-m', 'whisper', '--help'])) {
    return {
      ffmpeg,
      whisper: { mode: 'cli', command: 'python', baseArgs: ['-m', 'whisper'] },
      message: '',
    };
  }

  return {
    ffmpeg,
    whisper: { mode: 'transformers' },
    message: '',
  };
}

function buildWhisperArgs(baseArgs, audioPath, outputDir) {
  return [
    ...baseArgs,
    audioPath,
    '--model',
    process.env.WHISPER_MODEL || 'base',
    '--output_dir',
    outputDir,
    '--output_format',
    'all',
    '--task',
    'transcribe',
    '--language',
    process.env.WHISPER_LANGUAGE || 'en',
  ];
}

async function extractAudio(ffmpegCommand, videoPath, audioPath) {
  safeUnlink(audioPath);
  await runCommand(ffmpegCommand, [
    '-y',
    '-i',
    videoPath,
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '16000',
    '-ac',
    '1',
    audioPath,
  ]);
}

function readPcm16MonoWav(wavPath) {
  const buffer = fs.readFileSync(wavPath);
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Invalid WAV file generated for transcription.');
  }

  let offset = 12;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkId === 'data') {
      dataOffset = chunkDataStart;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || dataOffset + dataSize > buffer.length) {
    throw new Error('WAV data chunk is missing or corrupted.');
  }

  const sampleCount = Math.floor(dataSize / 2);
  const audio = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = buffer.readInt16LE(dataOffset + i * 2);
    audio[i] = sample / 32768;
  }
  return audio;
}

function formatSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hh = Math.floor(totalMs / 3600000);
  const mm = Math.floor((totalMs % 3600000) / 60000);
  const ss = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatVttTime(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hh = Math.floor(totalMs / 3600000);
  const mm = Math.floor((totalMs % 3600000) / 60000);
  const ss = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function normalizeTranscriptionSegments(result) {
  if (Array.isArray(result?.chunks) && result.chunks.length) {
    return result.chunks.map((chunk, idx) => {
      const ts = Array.isArray(chunk.timestamp) ? chunk.timestamp : [idx * 3, idx * 3 + 3];
      const start = Number.isFinite(ts[0]) ? ts[0] : idx * 3;
      const endCandidate = Number.isFinite(ts[1]) ? ts[1] : start + 3;
      const end = endCandidate > start ? endCandidate : start + 1.5;
      return {
        start,
        end,
        text: String(chunk.text || '').trim(),
      };
    }).filter((segment) => segment.text.length > 0);
  }

  const text = String(result?.text || '').trim();
  if (!text) return [];
  return [{ start: 0, end: 5, text }];
}

function writeSubtitleFilesFromSegments(vttPath, srtPath, segments) {
  const cleaned = segments.length ? segments : [{ start: 0, end: 2, text: ' ' }];

  const srt = cleaned.map((segment, idx) => {
    return `${idx + 1}\n${formatSrtTime(segment.start)} --> ${formatSrtTime(segment.end)}\n${segment.text}\n`;
  }).join('\n');

  const vttBody = cleaned.map((segment) => {
    return `${formatVttTime(segment.start)} --> ${formatVttTime(segment.end)}\n${segment.text}\n`;
  }).join('\n');

  fs.writeFileSync(srtPath, srt, 'utf8');
  fs.writeFileSync(vttPath, `WEBVTT\n\n${vttBody}`, 'utf8');
}

async function getAsrPipeline() {
  if (!asrPipelinePromise) {
    asrPipelinePromise = (async () => {
      const transformers = await import('@xenova/transformers');
      const modelId = process.env.WHISPER_MODEL_ID || 'Xenova/whisper-tiny.en';
      return transformers.pipeline('automatic-speech-recognition', modelId);
    })();
  }
  return asrPipelinePromise;
}

async function transcribeWithTransformers(audioPath, vttPath, srtPath) {
  const audio = readPcm16MonoWav(audioPath);
  const asr = await getAsrPipeline();
  const result = await asr(audio, {
    return_timestamps: true,
    chunk_length_s: Number(process.env.WHISPER_CHUNK_SECONDS || 25),
    stride_length_s: Number(process.env.WHISPER_STRIDE_SECONDS || 4),
  });
  const segments = normalizeTranscriptionSegments(result);
  writeSubtitleFilesFromSegments(vttPath, srtPath, segments);
}

export function scheduleSubtitleGeneration(recordingsDir, fileName) {
  if (activeJobs.has(fileName)) return activeJobs.get(fileName);

  const job = (async () => {
    const { videoPath, audioPath, vttPath, srtPath, statusPath, embeddedPath } = getSubtitlePaths(recordingsDir, fileName);

    if (!fs.existsSync(videoPath)) return;
    if (fs.existsSync(vttPath) && fs.existsSync(srtPath)) {
      writeStatus(statusPath, { status: 'ready', message: 'Subtitles ready' });
      return;
    }

    writeStatus(statusPath, { status: 'processing', message: 'Generating subtitles...' });

    try {
      const tooling = await resolveTooling();
      if (!tooling.ffmpeg || !tooling.whisper) {
        writeStatus(statusPath, { status: 'unavailable', message: tooling.message || 'Subtitle generation tooling is unavailable.' });
        return;
      }

      await extractAudio(tooling.ffmpeg, videoPath, audioPath);
      if (tooling.whisper.mode === 'cli') {
        await runCommand(tooling.whisper.command, buildWhisperArgs(tooling.whisper.baseArgs, audioPath, recordingsDir));
      } else {
        await transcribeWithTransformers(audioPath, vttPath, srtPath);
      }

      if (!fs.existsSync(vttPath) && !fs.existsSync(srtPath)) {
        throw new Error('No subtitle files were generated.');
      }

      safeUnlink(embeddedPath);
      writeStatus(statusPath, { status: 'ready', message: 'Subtitles ready' });
    } catch (error) {
      writeStatus(statusPath, {
        status: 'error',
        message: error instanceof Error ? error.message : 'Subtitle generation failed.',
      });
    } finally {
      safeUnlink(audioPath);
    }
  })().finally(() => {
    activeJobs.delete(fileName);
  });

  activeJobs.set(fileName, job);
  return job;
}

function escapeSubtitleFilterPath(filePath) {
  return filePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

export async function ensureEmbeddedSubtitleVideo(recordingsDir, fileName) {
  const { videoPath, srtPath, vttPath, embeddedPath, statusPath } = getSubtitlePaths(recordingsDir, fileName);
  const status = readSubtitleStatus(recordingsDir, fileName);

  if (status.status !== 'ready') {
    throw new Error('Subtitles are not ready yet.');
  }

  const tooling = await resolveTooling();
  if (!tooling.ffmpeg) {
    throw new Error('FFmpeg is unavailable.');
  }

  const subtitleSource = fs.existsSync(srtPath)
    ? srtPath
    : (fs.existsSync(vttPath) ? vttPath : null);
  if (!subtitleSource) {
    throw new Error('Subtitle file not found.');
  }

  const shouldRebuild = !fs.existsSync(embeddedPath)
    || fs.statSync(embeddedPath).mtimeMs < fs.statSync(videoPath).mtimeMs
    || fs.statSync(embeddedPath).mtimeMs < fs.statSync(subtitleSource).mtimeMs;

  if (shouldRebuild) {
    writeStatus(statusPath, { status: 'processing', message: 'Preparing video with embedded subtitles...' });
    await runCommand(tooling.ffmpeg, [
      '-y',
      '-i',
      videoPath,
      '-vf',
      `subtitles='${escapeSubtitleFilterPath(subtitleSource)}'`,
      '-c:a',
      'copy',
      embeddedPath,
    ]);
    writeStatus(statusPath, { status: 'ready', message: 'Subtitles ready' });
  }

  return embeddedPath;
}

export function removeSubtitleArtifacts(recordingsDir, fileName) {
  const { audioPath, vttPath, srtPath, statusPath, embeddedPath } = getSubtitlePaths(recordingsDir, fileName);
  [audioPath, vttPath, srtPath, statusPath, embeddedPath].forEach(safeUnlink);
}