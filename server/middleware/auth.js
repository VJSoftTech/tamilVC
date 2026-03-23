import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { users } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  // Also accept ?token= query param so direct browser links (download/view) work
  const raw = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.query.token;
  if (!raw)
    return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(raw, process.env.JWT_SECRET);
    const [user]  = await db.select({
      id: users.id, name: users.name, email: users.email,
      username: users.username, avatar: users.avatar,
      userType: users.userType, phoneNumber: users.phoneNumber,
    }).from(users).where(eq(users.id, decoded.userId));

    if (!user) return res.status(401).json({ message: 'User not found' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}