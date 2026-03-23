import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { and, desc, eq, ne, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../../shared/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { adminOnly } from '../middleware/admin.js';

const router = Router();

const rootUploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './recordings');
const avatarDir = path.join(rootUploadDir, 'avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarDir),
  filename: (_req, file, cb) => {
    const safeExt = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, `avatar_${Date.now()}_${Math.floor(Math.random() * 100000)}${safeExt}`);
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

const toClient = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  username: u.username,
  avatar: u.avatar,
  user_type: u.userType,
  phone_number: u.phoneNumber,
  created_at: u.createdAt,
  updated_at: u.updatedAt,
});

router.get('/validate', authMiddleware, adminOnly, async (req, res) => {
  const { name, email } = req.query;
  if (!name && !email) return res.json({ nameExists: false, emailExists: false });

  const whereParts = [];
  if (name) whereParts.push(eq(users.name, String(name).trim()));
  if (email) whereParts.push(eq(users.email, String(email).trim().toLowerCase()));

  const existing = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(or(...whereParts));

  return res.json({
    nameExists: !!existing.find((u) => u.name === String(name).trim()),
    emailExists: !!existing.find((u) => u.email === String(email).trim().toLowerCase()),
  });
});

router.get('/', authMiddleware, adminOnly, async (_req, res) => {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));
  res.json(rows.map(toClient));
});

router.post('/', authMiddleware, adminOnly, upload.single('avatar'), async (req, res) => {
  try {
    const { name, email, password, phone_number } = req.body;
    if (!name || !email || !password || !phone_number || !req.file) {
      return res.status(422).json({ message: 'All fields are required', errors: { fields: ['All fields are required'] } });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedName = String(name).trim();

    const existing = await db.select({ id: users.id, name: users.name, email: users.email, username: users.username })
      .from(users)
      .where(or(eq(users.name, normalizedName), eq(users.email, normalizedEmail), eq(users.username, normalizedName.toLowerCase().replace(/\s+/g, '_'))));

    const errors = {};
    if (existing.find((u) => u.name === normalizedName)) errors.name = ['Name already exists'];
    if (existing.find((u) => u.email === normalizedEmail)) errors.email = ['Email already exists'];
    if (Object.keys(errors).length > 0) return res.status(422).json({ errors });

    const usernameBase = normalizedName.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'user';
    let username = usernameBase;
    let idx = 1;
    while (true) {
      const [hit] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
      if (!hit) break;
      username = `${usernameBase}_${idx++}`;
    }

    const hashed = await bcrypt.hash(password, 12);
    const avatarPath = `/uploads/avatars/${req.file.filename}`;

    const [created] = await db.insert(users).values({
      name: normalizedName,
      email: normalizedEmail,
      username,
      password: hashed,
      phoneNumber: String(phone_number).trim(),
      userType: 'user',
      avatar: avatarPath,
    }).returning();

    res.status(201).json({ user: toClient(created) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create user' });
  }
});

router.put('/:id', authMiddleware, adminOnly, upload.single('avatar'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid user id' });

    const [target] = await db.select().from(users).where(eq(users.id, id));
    if (!target) return res.status(404).json({ message: 'User not found' });

    const patch = {};
    if (req.body.name) patch.name = String(req.body.name).trim();
    if (req.body.email) patch.email = String(req.body.email).trim().toLowerCase();
    if (req.body.phone_number) patch.phoneNumber = String(req.body.phone_number).trim();
    if (req.body.user_type && ['admin', 'user'].includes(req.body.user_type)) patch.userType = req.body.user_type;
    if (req.file) patch.avatar = `/uploads/avatars/${req.file.filename}`;
    if (req.body.password) patch.password = await bcrypt.hash(String(req.body.password), 12);

    if (patch.name || patch.email) {
      const clashConditions = [];
      if (patch.name) clashConditions.push(eq(users.name, patch.name));
      if (patch.email) clashConditions.push(eq(users.email, patch.email));

      const clashes = await db.select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(and(
          ne(users.id, id),
          or(...clashConditions),
        ));

      const errors = {};
      if (patch.name && clashes.find((u) => u.name === patch.name)) errors.name = ['Name already exists'];
      if (patch.email && clashes.find((u) => u.email === patch.email)) errors.email = ['Email already exists'];
      if (Object.keys(errors).length) return res.status(422).json({ errors });
    }

    const [updated] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
    res.json({ user: toClient(updated) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid user id' });
  if (id === req.user.id) return res.status(422).json({ message: 'Admin cannot delete own account' });

  const [deleted] = await db.delete(users).where(eq(users.id, id)).returning();
  if (!deleted) return res.status(404).json({ message: 'User not found' });

  res.json({ message: 'User deleted' });
});

export default router;
