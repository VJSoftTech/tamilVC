
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { users } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getMediasoupRouter, mediasoupWorkers, transports, producers, consumers } from '../mediasoupServer.js';

export function setupSocket(io) {
  // Track who is in which meeting: meetingId -> Set of {socketId, userId, name, username, avatar, userType}
  const meetingRooms = new Map();

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication error'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Accept guest tokens (no DB lookup needed)
      if (decoded.isGuest) {
        socket.user = {
          id: decoded.guestId,
          name: decoded.displayName,
          username: decoded.displayName,
          avatar: null,
          userType: 'user',
          isGuest: true,
        };
        return next();
      }
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

    // ────────────── mediasoup SFU events ──────────────
    // Store mediasoup transport/producer/consumer for this socket
    socket.mediasoupTransports = [];
    socket.mediasoupProducers = [];
    socket.mediasoupConsumers = [];

    // 1. Create WebRTC transport (send/recv)
    socket.on('createTransport', async ({ meetingId, direction }, callback) => {
      try {
        const router = await getMediasoupRouter(meetingId);
        const transport = await router.createWebRtcTransport({
          listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
          enableSctp: false,
          initialAvailableOutgoingBitrate: 1000000,
          maxIncomingBitrate: 1500000,
        });
        transports.set(transport.id, { transport, meetingId, userId: user.id, direction });
        socket.mediasoupTransports.push(transport.id);
        callback({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // 2. Connect transport (DTLS handshake)
    socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
      const entry = transports.get(transportId);
      if (!entry) return callback({ error: 'Transport not found' });
      try {
        await entry.transport.connect({ dtlsParameters });
        callback({ connected: true });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // 3. Produce (send audio/video)
    socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, callback) => {
      const entry = transports.get(transportId);
      if (!entry) return callback({ error: 'Transport not found' });
      try {
        const producer = await entry.transport.produce({ kind, rtpParameters, appData });
        producers.set(producer.id, { producer, meetingId: entry.meetingId, userId: entry.userId, kind });
        socket.mediasoupProducers.push(producer.id);
        // Notify others in the meeting
        socket.to(`meeting:${entry.meetingId}`).emit('new-producer', { userId: entry.userId, producerId: producer.id, kind });
        callback({ id: producer.id });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // 4. Consume (receive remote stream)
    socket.on('consume', async ({ meetingId, producerId, rtpCapabilities }, callback) => {
      try {
        const router = await getMediasoupRouter(meetingId);
        if (!router.canConsume({ producerId, rtpCapabilities })) {
          return callback({ error: 'Cannot consume' });
        }
        // Find a recv transport for this user
        const recvTransportEntry = Array.from(transports.values()).find(t => t.userId === user.id && t.meetingId === meetingId && t.direction === 'recv');
        if (!recvTransportEntry) return callback({ error: 'No recv transport' });
        const producerEntry = producers.get(producerId);
        if (!producerEntry) return callback({ error: 'Producer not found' });
        const consumer = await recvTransportEntry.transport.consume({
          producerId,
          rtpCapabilities,
          paused: false,
        });
        consumers.set(consumer.id, { consumer, meetingId, userId: user.id, producerId });
        socket.mediasoupConsumers.push(consumer.id);
        consumer.on('transportclose', () => consumers.delete(consumer.id));
        callback({
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          type: consumer.type,
          producerPaused: consumer.producerPaused,
        });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // Clean up mediasoup resources on disconnect
    socket.on('disconnect', () => {
      for (const id of socket.mediasoupConsumers || []) {
        const entry = consumers.get(id);
        if (entry) entry.consumer.close();
        consumers.delete(id);
      }
      for (const id of socket.mediasoupProducers || []) {
        const entry = producers.get(id);
        if (entry) entry.producer.close();
        producers.delete(id);
      }
      for (const id of socket.mediasoupTransports || []) {
        const entry = transports.get(id);
        if (entry) entry.transport.close();
        transports.delete(id);
      }
    });

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
      const room = meetingRooms.get(meetingId) || [];
      // Only emit user-left and remove from the room list when THIS socket is
      // still the registered socket for the user.  If the user refreshed their
      // page, the new socket will have already replaced this socket's entry
      // in meetingRooms.  Emitting user-left in that case would wrongly remove
      // the still-active user from every other participant's view.
      const entry = room.find(m => m.socketId === socket.id);

      // Always leave the Socket.IO rooms so the old socket stops receiving events.
      socket.leave(`meeting:${meetingId}`);
      socket.leave(`user:${user.id}:meeting:${meetingId}`);

      if (!entry) {
        // This socket's entry was superseded by a newer connection for the same
        // user (fast page-refresh).  Skip user-left — the user is still present.
        currentMeeting = null;
        return;
      }

      socket.to(`meeting:${meetingId}`).emit('user-left', { userId: String(user.id) });
      meetingRooms.set(meetingId, room.filter(m => m.socketId !== socket.id));
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