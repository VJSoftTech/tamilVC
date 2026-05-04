import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { users } from '../../shared/schema.js';
import { eq, or, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// POST /api/register
router.post('/register', async (req, res) => {
  const { name, email, username, password, password_confirmation, phone_number } = req.body;
  if (!name || !email || !username || !password)
    return res.status(422).json({ message: 'All fields are required' });
  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedUsername = String(username).trim().toLowerCase();
  if (password !== password_confirmation)
    return res.status(422).json({ errors: { password: ['Passwords do not match'] } });
  if (password.length < 8)
    return res.status(422).json({ errors: { password: ['Password must be at least 8 characters'] } });
  if (!/^[a-zA-Z0-9_-]+$/.test(normalizedUsername))
    return res.status(422).json({ errors: { username: ['Username may only contain letters, numbers, dashes and underscores'] } });

  try {
    const existing = await db.select().from(users)
      .where(or(
        sql`lower(${users.email}) = ${normalizedEmail}`,
        sql`lower(${users.username}) = ${normalizedUsername}`,
      ));
    if (existing.length > 0) {
      const errors = {};
      if (existing.find(u => String(u.email).toLowerCase() === normalizedEmail)) errors.email = ['Email is already taken'];
      if (existing.find(u => String(u.username).toLowerCase() === normalizedUsername)) errors.username = ['Username is already taken'];
      return res.status(422).json({ errors });
    }

    const hash = await bcrypt.hash(password, 12);
    const [user] = await db.insert(users).values({
      name,
      email: normalizedEmail,
      username: normalizedUsername,
      password: hash,
      phoneNumber: phone_number || null,
      userType: 'user',
    }).returning({
      id: users.id, name: users.name, email: users.email, username: users.username,
      avatar: users.avatar, createdAt: users.createdAt, userType: users.userType, phoneNumber: users.phoneNumber,
    });
    const token = jwt.sign({ userId: user.id, userType: user.userType }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'Registration successful', user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(422).json({ message: 'Email/Username and password are required' });
  try {
    const loginInput = String(username).trim().toLowerCase();
    const [user] = await db.select().from(users).where(or(
      sql`lower(${users.username}) = ${loginInput}`,
      sql`lower(${users.email}) = ${loginInput}`,
    ));
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(422).json({ message: 'Invalid credentials.' });

    const token = jwt.sign({ userId: user.id, userType: user.userType }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...safeUser } = user;
    res.json({ message: 'Login successful', user: safeUser, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/logout', authMiddleware, (req, res) => res.json({ message: 'Logged out' }));
router.get('/me',     authMiddleware, (req, res) => res.json(req.user));

export default router;
