import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { and, eq, ne, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../../shared/schema.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

const rootUploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './recordings');
const avatarDir = path.join(rootUploadDir, 'avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarDir),
  filename: (_req, file, cb) => {
    const safeExt = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, `avatar_self_${Date.now()}_${Math.floor(Math.random() * 100000)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  username: u.username,
  avatar: u.avatar,
  userType: u.userType,
  phoneNumber: u.phoneNumber,
  createdAt: u.createdAt,
});

router.get('/me', authMiddleware, async (req, res) => {
  const [row] = await db.select().from(users).where(eq(users.id, req.user.id));
  if (!row) return res.status(404).json({ message: 'User not found' });
  return res.json({ user: safeUser(row) });
});

router.put('/me', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    const patch = {};
    if (req.file) patch.avatar = `/uploads/avatars/${req.file.filename}`;

    // Admin-only account controls
    if (req.user.userType === 'admin') {
      if (req.body.username) patch.username = String(req.body.username).trim();
      if (req.body.password) {
        if (String(req.body.password).length < 8) {
          return res.status(422).json({ errors: { password: ['Password must be at least 8 characters'] } });
        }
        patch.password = await bcrypt.hash(String(req.body.password), 12);
      }

      if (patch.username) {
        const [hit] = await db.select({ id: users.id }).from(users)
          .where(and(eq(users.username, patch.username), ne(users.id, req.user.id)));
        if (hit) return res.status(422).json({ errors: { username: ['Username already exists'] } });
      }
    }

    // Optional shared fields
    if (req.body.phone_number) patch.phoneNumber = String(req.body.phone_number).trim();
    if (req.body.name) patch.name = String(req.body.name).trim();

    if (patch.name) {
      const [nameHit] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.name, patch.name), ne(users.id, req.user.id)));
      if (nameHit) return res.status(422).json({ errors: { name: ['Name already exists'] } });
    }

    if (Object.keys(patch).length === 0) {
      const [current] = await db.select().from(users).where(eq(users.id, req.user.id));
      return res.json({ user: safeUser(current) });
    }

    const [updated] = await db.update(users).set(patch).where(eq(users.id, req.user.id)).returning();
    return res.json({ user: safeUser(updated) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to update settings' });
  }
});

export default router;
