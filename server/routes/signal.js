import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

router.post('/offer', authMiddleware, (req, res) => {
  const { meetingId } = req.params;
  const { to, offer } = req.body;
  req.io.to(`user:${to}:meeting:${meetingId}`).emit('offer', { from: String(req.user.id), name: req.user.name, offer });
  res.json({ ok: true });
});

router.post('/answer', authMiddleware, (req, res) => {
  const { meetingId } = req.params;
  const { to, answer } = req.body;
  req.io.to(`user:${to}:meeting:${meetingId}`).emit('answer', { from: String(req.user.id), answer });
  res.json({ ok: true });
});

router.post('/ice-candidate', authMiddleware, (req, res) => {
  const { meetingId } = req.params;
  const { to, candidate } = req.body;
  req.io.to(`user:${to}:meeting:${meetingId}`).emit('ice-candidate', { from: String(req.user.id), candidate });
  res.json({ ok: true });
});

router.post('/media-status', authMiddleware, (req, res) => {
  const { meetingId } = req.params;
  req.io.to(`meeting:${meetingId}`).emit('media-status', { userId: String(req.user.id), camOn: req.body.cam_on, micOn: req.body.mic_on });
  res.json({ ok: true });
});

router.post('/raise-hand', authMiddleware, (req, res) => {
  req.io.to(`meeting:${req.params.meetingId}`).emit('raise-hand', { userId: String(req.user.id), name: req.user.name, raised: req.body.raised });
  res.json({ ok: true });
});

router.post('/recording-status', authMiddleware, (req, res) => {
  req.io.to(`meeting:${req.params.meetingId}`).emit('recording-status', { started: req.body.started, by: req.user.name });
  res.json({ ok: true });
});

export default router;
