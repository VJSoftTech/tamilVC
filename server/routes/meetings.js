import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { meetings, meetingParticipants, recordings, users } from '../../shared/schema.js';
import { eq, and, or, isNull, gt, desc, count } from 'drizzle-orm';
import { authMiddleware, guestOrAuthMiddleware } from '../middleware/auth.js';

const router = Router();

async function generateMeetingId() {
  while (true) {
    // 6-digit number: 100000–999999
    const id = String(Math.floor(100000 + Math.random() * 900000));
    const [exists] = await db.select().from(meetings).where(eq(meetings.meetingId, id));
    if (!exists) return id;
  }
}

// GET /api/meetings/:meetingId/info  (public)
router.get('/:meetingId/info', async (req, res) => {
  try {
    const [row] = await db.select({
      id: meetings.id, meetingId: meetings.meetingId, title: meetings.title, subTitle: meetings.subTitle,
      type: meetings.type, description: meetings.description, scheduledAt: meetings.scheduledAt,
      startedAt: meetings.startedAt, endedAt: meetings.endedAt, status: meetings.status, createdAt: meetings.createdAt,
      hostId: meetings.hostId,
      hostName: users.name, hostUsername: users.username,
    }).from(meetings).innerJoin(users, eq(users.id, meetings.hostId))
      .where(eq(meetings.meetingId, req.params.meetingId));

    if (!row) return res.status(404).json({ message: 'Meeting not found' });

    const [hostJoined] = await db.select().from(meetingParticipants)
      .where(and(eq(meetingParticipants.meetingId, row.meetingId), eq(meetingParticipants.userId, row.hostId), isNull(meetingParticipants.leftAt)));

    const meeting = { ...row, meeting_id: row.meetingId, host: { id: row.hostId, name: row.hostName, username: row.hostUsername } };
    res.json({ meeting, host_joined: !!hostJoined });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// POST /api/meetings/:meetingId/guest-join  (no auth — guests use a shared link)
router.post('/:meetingId/guest-join', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const displayName = String(req.body.displayName || '').trim().slice(0, 50);
    if (!displayName) return res.status(422).json({ message: 'Display name is required' });

    const [row] = await db.select({
      id: meetings.id, meetingId: meetings.meetingId, title: meetings.title, subTitle: meetings.subTitle,
      type: meetings.type, status: meetings.status, startedAt: meetings.startedAt,
      createdAt: meetings.createdAt, hostId: meetings.hostId,
      hostName: users.name, hostUsername: users.username,
    }).from(meetings).innerJoin(users, eq(users.id, meetings.hostId))
      .where(eq(meetings.meetingId, meetingId));

    if (!row) return res.status(404).json({ message: 'Meeting not found' });
    if (row.status === 'ended') return res.status(403).json({ message: 'Meeting has ended' });

    const [hostJoined] = await db.select().from(meetingParticipants)
      .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.userId, row.hostId), isNull(meetingParticipants.leftAt)));

    const guestId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const token = jwt.sign({ guestId, displayName, isGuest: true }, process.env.JWT_SECRET, { expiresIn: '24h' });

    const meeting = {
      ...row,
      meeting_id: row.meetingId,
      host: { id: row.hostId, name: row.hostName, username: row.hostUsername },
    };
    res.json({
      token,
      user: { id: guestId, name: displayName, username: displayName, isGuest: true },
      meeting,
      is_host: false,
      waiting: !hostJoined,
    });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// GET /api/meetings/stats/dashboard
router.get('/stats/dashboard', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.id;
    const isAdmin = req.user.userType === 'admin';
    const [created]    = await db.select({ count: count() }).from(meetings).where(eq(meetings.hostId, uid));
    const [joined]     = await db.select({ count: count() }).from(meetingParticipants).where(eq(meetingParticipants.userId, uid));
    const [recs]       = await db.select({ count: count() }).from(recordings).where(eq(recordings.hostId, uid));
    const [usersCount] = isAdmin
      ? await db.select({ count: count() }).from(users).where(eq(users.userType, 'user'))
      : [{ count: 0 }];
    const upcoming     = await db.select().from(meetings)
      .where(and(eq(meetings.hostId, uid), eq(meetings.type, 'scheduled'), eq(meetings.status, 'waiting'), gt(meetings.scheduledAt, new Date())))
      .orderBy(meetings.scheduledAt).limit(5);

    res.json({
      total_created: created.count, total_joined: joined.count,
      total_recordings: recs.count,
      total_users: isAdmin ? usersCount.count : undefined,
      upcoming: upcoming.map(m => ({ ...m, meeting_id: m.meetingId })),
    });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// POST /api/meetings/instant
router.post('/instant', authMiddleware, async (req, res) => {
  try {
    const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const meetingId = await generateMeetingId();
    const [meeting] = await db.insert(meetings).values({
      meetingId, title: req.body.title || 'Instant Meeting',
      subTitle: req.body.subTitle || null,
      hostId: req.user.id, type: 'instant', status: 'waiting',
    }).returning();
    const normalized = { ...meeting, meeting_id: meeting.meetingId };
    const link = `${frontendUrl}/meet/${meetingId}`;
    res.status(201).json({ message: 'Meeting created', meeting: { ...normalized, host: req.user }, meeting_link: link });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// POST /api/meetings/schedule
router.post('/schedule', authMiddleware, async (req, res) => {
  try {
    const { title, scheduled_at, description } = req.body;
    if (!title || !scheduled_at) return res.status(422).json({ message: 'Title and scheduled_at required' });
    if (new Date(scheduled_at) <= new Date()) return res.status(422).json({ message: 'Scheduled time must be in the future' });

    const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const meetingId = await generateMeetingId();
    const [meeting] = await db.insert(meetings).values({
      meetingId, title, subTitle: req.body.subTitle || null, hostId: req.user.id, type: 'scheduled',
      description: description || null, scheduledAt: new Date(scheduled_at), status: 'waiting',
    }).returning();
    const normalized = { ...meeting, meeting_id: meeting.meetingId };
    const link = `${frontendUrl}/meet/${meetingId}`;
    res.status(201).json({ message: 'Meeting scheduled', meeting: { ...normalized, host: req.user }, meeting_link: link });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// POST /api/meetings/:meetingId/join
router.post('/:meetingId/join', guestOrAuthMiddleware, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const [meeting] = await db.select().from(meetings).where(eq(meetings.meetingId, meetingId));
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
    if (meeting.status === 'ended') return res.status(403).json({ message: 'Meeting has ended' });

    const userId = req.user.id;
    const isHost = !req.user.isGuest && meeting.hostId === userId;

    if (!isHost) {
      const [hostJoined] = await db.select().from(meetingParticipants)
        .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.userId, meeting.hostId), isNull(meetingParticipants.leftAt)));
      if (!hostJoined) return res.json({ message: 'Waiting for host', waiting: true });
    }

    if (isHost && meeting.status === 'waiting') {
      await db.update(meetings).set({ status: 'active', startedAt: new Date() }).where(eq(meetings.meetingId, meetingId));
    }

    // Guests have no real DB user row — skip participant upsert
    if (!req.user.isGuest) {
      const [existing] = await db.select().from(meetingParticipants)
        .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.userId, userId)));
      if (existing) {
        await db.update(meetingParticipants).set({ joinedAt: new Date(), leftAt: null, isHost })
          .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.userId, userId)));
      } else {
        await db.insert(meetingParticipants).values({ meetingId, userId, joinedAt: new Date(), isHost });
      }
    }

    const [fresh] = await db.select({
      id: meetings.id, meetingId: meetings.meetingId, title: meetings.title, subTitle: meetings.subTitle,
      type: meetings.type, status: meetings.status, startedAt: meetings.startedAt, createdAt: meetings.createdAt,
      hostId: meetings.hostId, hostName: users.name, hostUsername: users.username,
    }).from(meetings).innerJoin(users, eq(users.id, meetings.hostId)).where(eq(meetings.meetingId, meetingId));

    res.json({
      message: 'Joined',
      meeting: {
        ...fresh,
        meeting_id: fresh.meetingId,
        host: { id: fresh.hostId, name: fresh.hostName, username: fresh.hostUsername },
      },
      is_host: isHost, waiting: false,
    });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// POST /api/meetings/:meetingId/leave
router.post('/:meetingId/leave', authMiddleware, async (req, res) => {
  try {
    const { meetingId } = req.params;
    await db.update(meetingParticipants).set({ leftAt: new Date() })
      .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.userId, req.user.id)));
    req.io.to(`meeting:${meetingId}`).emit('user-left', { userId: String(req.user.id) });
    res.json({ message: 'Left meeting' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// PATCH /api/meetings/:meetingId/title
router.patch('/:meetingId/title', authMiddleware, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(422).json({ message: 'Title is required' });
    const subTitle = req.body.subTitle !== undefined ? (String(req.body.subTitle).trim() || null) : undefined;

    const setValues = { title, updatedAt: new Date() };
    if (subTitle !== undefined) setValues.subTitle = subTitle;

    const [updated] = await db.update(meetings)
      .set(setValues)
      .where(and(eq(meetings.meetingId, meetingId), eq(meetings.hostId, req.user.id)))
      .returning({
        id: meetings.id,
        meetingId: meetings.meetingId,
        title: meetings.title,
        subTitle: meetings.subTitle,
      });

    if (!updated) return res.status(403).json({ message: 'Not authorized' });
    return res.json({ meeting: { ...updated, meeting_id: updated.meetingId } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/meetings/:meetingId/end
router.post('/:meetingId/end', authMiddleware, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const [updated] = await db.update(meetings).set({ status: 'ended', endedAt: new Date() })
      .where(and(eq(meetings.meetingId, meetingId), eq(meetings.hostId, req.user.id))).returning();
    if (!updated) return res.status(403).json({ message: 'Not authorized' });
    await db.update(meetingParticipants).set({ leftAt: new Date() })
      .where(and(eq(meetingParticipants.meetingId, meetingId), isNull(meetingParticipants.leftAt)));
    req.io.to(`meeting:${meetingId}`).emit('meeting-ended', {});
    res.json({ message: 'Meeting ended' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// GET /api/meetings/:meetingId/participants
router.get('/:meetingId/participants', authMiddleware, async (req, res) => {
  try {
    const rows = await db.select({
      id: meetingParticipants.id, meetingId: meetingParticipants.meetingId,
      userId: users.id, isHost: meetingParticipants.isHost, joinedAt: meetingParticipants.joinedAt,
      name: users.name, username: users.username, avatar: users.avatar,
    }).from(meetingParticipants).innerJoin(users, eq(users.id, meetingParticipants.userId))
      .where(and(eq(meetingParticipants.meetingId, req.params.meetingId), isNull(meetingParticipants.leftAt)));

    res.json(rows.map(r => ({ ...r, user: { id: r.userId, name: r.name, username: r.username, avatar: r.avatar } })));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// GET /api/meetings
router.get('/', authMiddleware, async (req, res) => {
  try {
    const uid  = req.user.id;
    const rows = await db.select({
      id: meetings.id, meetingId: meetings.meetingId, title: meetings.title, subTitle: meetings.subTitle,
      type: meetings.type, status: meetings.status, scheduledAt: meetings.scheduledAt,
      startedAt: meetings.startedAt, endedAt: meetings.endedAt, createdAt: meetings.createdAt,
      hostId: meetings.hostId, hostName: users.name, hostUsername: users.username,
    }).from(meetings).innerJoin(users, eq(users.id, meetings.hostId))
      .where(or(eq(meetings.hostId, uid)))
      .orderBy(desc(meetings.createdAt)).limit(100);

    const result = await Promise.all(rows.map(async (row) => {
      const parts = await db.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, row.meetingId));
      return {
        ...row,
        meeting_id: row.meetingId,
        host: { id: row.hostId, name: row.hostName, username: row.hostUsername },
        participants: parts,
      };
    }));

    res.json({ data: result });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

export default router;