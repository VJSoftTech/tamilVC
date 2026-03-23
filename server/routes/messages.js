import { Router } from 'express';
import { db } from '../db/index.js';
import { messages, users } from '../../shared/schema.js';
import { eq, asc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

router.get('/', authMiddleware, async (req, res) => {
  try {
    const rows = await db.select({
      id: messages.id, meetingId: messages.meetingId, message: messages.message, createdAt: messages.createdAt,
      userId: users.id, userName: users.name, userUsername: users.username, userAvatar: users.avatar,
    }).from(messages).innerJoin(users, eq(users.id, messages.userId))
      .where(eq(messages.meetingId, req.params.meetingId)).orderBy(asc(messages.createdAt));

    res.json(rows.map(r => ({
      id: r.id, meetingId: r.meetingId, message: r.message, createdAt: r.createdAt,
      user: { id: r.userId, name: r.userName, username: r.userUsername, avatar: r.userAvatar },
    })));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { meetingId } = req.params;
    if (!req.body.message) return res.status(422).json({ message: 'Message required' });
    const [msg] = await db.insert(messages).values({
      meetingId, userId: req.user.id, message: req.body.message,
    }).returning();
    const out = { ...msg, user: req.user };
    req.io.to(`meeting:${meetingId}`).emit('chat-message', out);
    res.status(201).json(out);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

export default router;
