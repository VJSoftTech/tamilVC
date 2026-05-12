import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db } from '../db/index.js';
import { recordings, meetings, users } from '../../shared/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import {
  ensureEmbeddedSubtitleVideo,
  getSubtitlePaths,
  readSubtitleStatus,
  removeSubtitleArtifacts,
  scheduleSubtitleGeneration,
} from '../services/subtitles.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const uploadDir  = process.env.UPLOAD_DIR || './recordings';
const recsDir    = path.resolve(process.cwd(), uploadDir);
console.log('Recordings directory:', recsDir);
if (!fs.existsSync(recsDir)) fs.mkdirSync(recsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, recsDir),
  filename:    (req, file, cb) => cb(null, `recording_${req.body.meeting_id || 'x'}_${Date.now()}.webm`),
});
const upload = multer({ storage, limits: { fileSize: 512 * 1024 * 1024 } });

const router = Router();

async function getAuthorizedRecording(id, userId) {
  const [rec] = await db.select().from(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.hostId, userId)));
  return rec || null;
}

router.post('/', authMiddleware, upload.single('recording'), async (req, res) => {
  try {
    console.log('Recording save attempt:', { meeting_id: req.body.meeting_id, user: req.user.id, file: req.file?.filename });
    const { meeting_id, duration } = req.body;
    if (!meeting_id || !req.file) return res.status(422).json({ message: 'meeting_id and file required' });

    const [meeting] = await db.select().from(meetings)
      .where(eq(meetings.meetingId, meeting_id));
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

    const [rec] = await db.insert(recordings).values({
      meetingId: meeting_id, hostId: req.user.id,
      title: `${meeting.title} - Recording`,
      subTitle: meeting.subTitle || null,
      bgMusicName: req.body.bg_music_name || null,
      bgMusicVolume: req.body.bg_music_volume ? parseInt(req.body.bg_music_volume) : null,
      videoVolume: req.body.video_volume ? parseInt(req.body.video_volume) : null,
      filePath: req.file.filename,
      fileSize: req.file.size,
      duration: duration ? parseInt(duration) : null,
    }).returning();
    console.log('Recording saved:', rec);
    scheduleSubtitleGeneration(recsDir, req.file.filename);
    res.status(201).json({ message: 'Saved', recording: rec });
  } catch (err) { console.error('Recording save error:', err); res.status(500).json({ message: 'Server error' }); }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    console.log('Fetching recordings for user:', req.user.id);
    const rows = await db.select({
      id: recordings.id, meetingId: recordings.meetingId, title: recordings.title, subTitle: recordings.subTitle,
      filePath: recordings.filePath, fileSize: recordings.fileSize,
      duration: recordings.duration, recordedAt: recordings.recordedAt,
      meetingTitle: meetings.title, meetingSubTitle: meetings.subTitle,
      hostName: users.name, hostUsername: users.username,
    }).from(recordings)
      .innerJoin(meetings, eq(meetings.meetingId, recordings.meetingId))
      .innerJoin(users, eq(users.id, recordings.hostId))
      .where(eq(recordings.hostId, req.user.id)).orderBy(desc(recordings.recordedAt));

    console.log('Found recordings:', rows.length);
    res.json(rows.map(r => ({
      ...(function () {
        const current = readSubtitleStatus(recsDir, r.filePath);
        if (['pending', 'unavailable', 'error'].includes(current.status) && !current.hasVtt && !current.hasSrt) {
          scheduleSubtitleGeneration(recsDir, r.filePath);
        }
        const subtitle = readSubtitleStatus(recsDir, r.filePath);
        return {
          subtitle_status: subtitle.status,
          subtitle_message: subtitle.message,
          subtitle_updated_at: subtitle.updatedAt,
          subtitle_url: subtitle.hasVtt ? `/api/recordings/${r.id}/subtitles.vtt` : null,
          subtitle_srt_url: subtitle.hasSrt ? `/api/recordings/${r.id}/subtitles.srt` : null,
          embedded_subtitles_download_url: subtitle.status === 'ready'
            ? `/api/recordings/${r.id}/download-with-subtitles`
            : null,
        };
      })(),
      ...r,
      meeting:      { meeting_id: r.meetingId, title: r.meetingTitle, subTitle: r.meetingSubTitle },
      host:         { name: r.hostName, username: r.hostUsername },
      download_url: `/api/recordings/${r.id}/download`,
    })));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.get('/:id/download', authMiddleware, async (req, res) => {
  try {
    const rec = await getAuthorizedRecording(parseInt(req.params.id), req.user.id);
    if (!rec) return res.status(404).json({ message: 'Not found' });
    const filePath = path.join(recsDir, rec.filePath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not on disk' });
    res.download(filePath, path.basename(filePath));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.get('/:id/subtitles.vtt', authMiddleware, async (req, res) => {
  try {
    const rec = await getAuthorizedRecording(parseInt(req.params.id), req.user.id);
    if (!rec) return res.status(404).json({ message: 'Not found' });
    const { vttPath } = getSubtitlePaths(recsDir, rec.filePath);
    if (!fs.existsSync(vttPath)) return res.status(404).json({ message: 'Subtitle file not found' });
    res.type('text/vtt').sendFile(vttPath);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.get('/:id/subtitles.srt', authMiddleware, async (req, res) => {
  try {
    const rec = await getAuthorizedRecording(parseInt(req.params.id), req.user.id);
    if (!rec) return res.status(404).json({ message: 'Not found' });
    const { srtPath } = getSubtitlePaths(recsDir, rec.filePath);
    if (!fs.existsSync(srtPath)) return res.status(404).json({ message: 'Subtitle file not found' });
    res.download(srtPath, path.basename(srtPath));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.get('/:id/download-with-subtitles', authMiddleware, async (req, res) => {
  try {
    const rec = await getAuthorizedRecording(parseInt(req.params.id), req.user.id);
    if (!rec) return res.status(404).json({ message: 'Not found' });
    const embeddedPath = await ensureEmbeddedSubtitleVideo(recsDir, rec.filePath);
    res.download(embeddedPath, path.basename(embeddedPath));
  } catch (err) {
    console.error(err);
    res.status(409).json({ message: err instanceof Error ? err.message : 'Unable to prepare subtitled video' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const [rec] = await db.delete(recordings)
      .where(and(eq(recordings.id, parseInt(req.params.id)), eq(recordings.hostId, req.user.id))).returning();
    if (!rec) return res.status(403).json({ message: 'Not authorized' });
    const fp = path.join(recsDir, rec.filePath);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    removeSubtitleArtifacts(recsDir, rec.filePath);
    res.json({ message: 'Deleted' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

export default router;
