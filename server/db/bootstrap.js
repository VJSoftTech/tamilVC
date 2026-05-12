import bcrypt from 'bcryptjs';
import { sql, eq } from 'drizzle-orm';
import { db } from './index.js';
import { users } from '../../shared/schema.js';

export async function bootstrapDatabase() {
  // Create all tables if they don't exist
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      avatar VARCHAR(500),
      user_type VARCHAR(20) NOT NULL DEFAULT 'user',
      phone_number VARCHAR(30),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS meetings (
      id SERIAL PRIMARY KEY,
      meeting_id VARCHAR(20) UNIQUE NOT NULL,
      title VARCHAR(255) NOT NULL,
      sub_title VARCHAR(255),
      host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(20) NOT NULL DEFAULT 'instant',
      description TEXT,
      scheduled_at TIMESTAMP,
      started_at TIMESTAMP,
      ended_at TIMESTAMP,
      status VARCHAR(20) NOT NULL DEFAULT 'waiting',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS meeting_participants (
      id SERIAL PRIMARY KEY,
      meeting_id VARCHAR(20) NOT NULL REFERENCES meetings(meeting_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMP,
      left_at TIMESTAMP,
      is_host BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS recordings (
      id SERIAL PRIMARY KEY,
      meeting_id VARCHAR(20) NOT NULL REFERENCES meetings(meeting_id) ON DELETE CASCADE,
      host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      sub_title VARCHAR(255),
      bg_music_name VARCHAR(255),
      bg_music_volume INTEGER,
      video_volume INTEGER,
      file_path VARCHAR(500) NOT NULL,
      file_size BIGINT,
      duration INTEGER,
      recorded_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      meeting_id VARCHAR(20) NOT NULL REFERENCES meetings(meeting_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Keep schema compatible on existing deployments without manual migrations.
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type VARCHAR(20) DEFAULT 'user'`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(30)`);
  await db.execute(sql`UPDATE users SET user_type = 'user' WHERE user_type IS NULL`);

  const adminEmail = 'admin@gmail.com';
  const adminPassword = '12345678';
  const adminName = 'Administrator';
  const adminUsername = 'admin';
  const hash = await bcrypt.hash(adminPassword, 12);

  const [existingAdmin] = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail));

  if (!existingAdmin) {
    await db.insert(users).values({
      name: adminName,
      email: adminEmail,
      username: adminUsername,
      password: hash,
      userType: 'admin',
      phoneNumber: '0000000000',
    });
  } else {
    await db.update(users)
      .set({ userType: 'admin' })
      .where(eq(users.id, existingAdmin.id));
  }
}
