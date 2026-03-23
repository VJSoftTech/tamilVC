import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { users } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

export function setupSocket(io) {
  // Track who is in which meeting: meetingId -> Set of {socketId, userId, name, username, avatar, userType}
  const meetingRooms = new Map();

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication error'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const [user]  = await db.select({
        id: users.id,
        name: users.name,
        username: users.username,
        avatar: users.avatar,
        userType: users.userType,
      })
        .from(users).where(eq(users.id, decoded.userId));
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch { next(new Error('Invalid token')); }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    let currentMeeting = null;

    socket.on('join-meeting', (meetingId) => {
      currentMeeting = meetingId;
      socket.join(`meeting:${meetingId}`);
      socket.join(`user:${user.id}:meeting:${meetingId}`);

      // Track room members
      if (!meetingRooms.has(meetingId)) meetingRooms.set(meetingId, []);
      const room = meetingRooms.get(meetingId);
      // Remove stale entry for same user if any
      const filtered = room.filter(m => m.userId !== String(user.id));
      filtered.push({
        socketId: socket.id,
        userId: String(user.id),
        name: user.name,
        username: user.username,
        avatar: user.avatar,
        userType: user.userType,
      });
      meetingRooms.set(meetingId, filtered);

      // Tell existing participants a new user joined
      socket.to(`meeting:${meetingId}`).emit('user-joined', {
        userId: String(user.id), name: user.name, username: user.username, avatar: user.avatar, userType: user.userType,
      });

      // Send the new joiner the current list of existing participants
      // so they can initiate calls TO each existing peer
      const existing = filtered.filter(m => m.userId !== String(user.id));
      socket.emit('room-members', existing);
    });

    socket.on('leave-meeting', (meetingId) => {
      _leave(meetingId);
    });

    const _leave = (meetingId) => {
      if (!meetingId) return;
      socket.to(`meeting:${meetingId}`).emit('user-left', { userId: String(user.id) });
      socket.leave(`meeting:${meetingId}`);
      socket.leave(`user:${user.id}:meeting:${meetingId}`);
      if (meetingRooms.has(meetingId)) {
        meetingRooms.set(meetingId, meetingRooms.get(meetingId).filter(m => m.userId !== String(user.id)));
      }
      currentMeeting = null;
    };

    socket.on('disconnect', () => {
      if (currentMeeting) _leave(currentMeeting);
    });

    // ── WebRTC signaling — direct peer-to-peer routing ──
    socket.on('signal:offer', ({ meetingId, to, offer }) =>
      io.to(`user:${to}:meeting:${meetingId}`).emit('offer', { from: String(user.id), name: user.name, offer }));

    socket.on('signal:answer', ({ meetingId, to, answer }) =>
      io.to(`user:${to}:meeting:${meetingId}`).emit('answer', { from: String(user.id), answer }));

    socket.on('signal:ice-candidate', ({ meetingId, to, candidate }) =>
      io.to(`user:${to}:meeting:${meetingId}`).emit('ice-candidate', { from: String(user.id), candidate }));

    socket.on('signal:media-status', ({ meetingId, camOn, micOn }) =>
      socket.to(`meeting:${meetingId}`).emit('media-status', { userId: String(user.id), camOn, micOn }));

    socket.on('signal:screen-share', ({ meetingId, active }) =>
      socket.to(`meeting:${meetingId}`).emit('screen-share-status', { userId: String(user.id), active }));

    socket.on('signal:raise-hand', ({ meetingId, raised }) =>
      io.to(`meeting:${meetingId}`).emit('raise-hand', { userId: String(user.id), name: user.name, raised }));

    // ── Ready signal: new joiner tells others "I'm ready, call me" ──
    // This replaces the old 500ms setTimeout hack
    socket.on('signal:ready', ({ meetingId }) =>
      socket.to(`meeting:${meetingId}`).emit('peer-ready', {
        userId: String(user.id),
        name: user.name,
        username: user.username,
        avatar: user.avatar,
        userType: user.userType,
      }));

    // ── Whiteboard ───────────────────────────────────────────────────
    // Relay draw strokes/commands to everyone else in the room.
    socket.on('whiteboard:draw', ({ meetingId, stroke }) =>
      socket.to(`meeting:${meetingId}`).emit('whiteboard:draw', { stroke }));

    socket.on('whiteboard:clear', ({ meetingId }) =>
      socket.to(`meeting:${meetingId}`).emit('whiteboard:clear'));

    socket.on('whiteboard:active', ({ meetingId, active }) =>
      socket.to(`meeting:${meetingId}`).emit('whiteboard:active', { active }));

    // When a new participant joins, the host can re-send the current canvas state.
    // to='__room__' broadcasts to all (used for undo); otherwise targeted delivery.
    socket.on('whiteboard:sync', ({ meetingId, to, strokes }) => {
      if (to === '__room__') {
        socket.to(`meeting:${meetingId}`).emit('whiteboard:sync', { strokes });
      } else {
        io.to(`user:${to}:meeting:${meetingId}`).emit('whiteboard:sync', { strokes });
      }
    });
  });
}