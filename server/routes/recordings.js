import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db } from '../db/index.js';
import { recordings, meetings, users } from '../../shared/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const uploadDir  = process.env.UPLOAD_DIR || './recordings';
const recsDir    = path.resolve(process.cwd(), uploadDir);
if (!fs.existsSync(recsDir)) fs.mkdirSync(recsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, recsDir),
  filename:    (req, file, cb) => cb(null, `recording_${req.body.meeting_id || 'x'}_${Date.now()}.webm`),
});
const upload = multer({ storage, limits: { fileSize: 512 * 1024 * 1024 } });

const router = Router();

router.post('/', authMiddleware, upload.single('recording'), async (req, res) => {
  try {
    const { meeting_id, duration } = req.body;
    if (!meeting_id || !req.file) return res.status(422).json({ message: 'meeting_id and file required' });

    const [meeting] = await db.select().from(meetings)
      .where(and(eq(meetings.meetingId, meeting_id), eq(meetings.hostId, req.user.id)));
    if (!meeting) return res.status(403).json({ message: 'Not authorized' });

    const [rec] = await db.insert(recordings).values({
      meetingId: meeting_id, hostId: req.user.id,
      title: `${meeting.title} - Recording`,
      filePath: req.file.filename,
      fileSize: req.file.size,
      duration: duration ? parseInt(duration) : null,
    }).returning();
    res.status(201).json({ message: 'Saved', recording: rec });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const rows = await db.select({
      id: recordings.id, meetingId: recordings.meetingId, title: recordings.title,
      filePath: recordings.filePath, fileSize: recordings.fileSize,
      duration: recordings.duration, recordedAt: recordings.recordedAt,
      meetingTitle: meetings.title,
      hostName: users.name, hostUsername: users.username,
    }).from(recordings)
      .innerJoin(meetings, eq(meetings.meetingId, recordings.meetingId))
      .innerJoin(users, eq(users.id, recordings.hostId))
      .where(eq(recordings.hostId, req.user.id)).orderBy(desc(recordings.recordedAt));

    const base = `${req.protocol}://${req.get('host')}`;
    res.json(rows.map(r => ({
      ...r,
      meeting:      { meeting_id: r.meetingId, title: r.meetingTitle },
      host:         { name: r.hostName, username: r.hostUsername },
      download_url: `${base}/api/recordings/${r.id}/download`,
    })));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.get('/:id/download', authMiddleware, async (req, res) => {
  try {
    const [rec] = await db.select().from(recordings).where(eq(recordings.id, parseInt(req.params.id)));
    if (!rec) return res.status(404).json({ message: 'Not found' });
    const filePath = path.join(recsDir, rec.filePath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not on disk' });
    res.download(filePath, path.basename(filePath));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const [rec] = await db.delete(recordings)
      .where(and(eq(recordings.id, parseInt(req.params.id)), eq(recordings.hostId, req.user.id))).returning();
    if (!rec) return res.status(403).json({ message: 'Not authorized' });
    const fp = path.join(recsDir, rec.filePath);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    res.json({ message: 'Deleted' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

export default router;
