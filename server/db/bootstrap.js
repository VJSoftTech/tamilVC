import bcrypt from 'bcryptjs';
import { sql, eq } from 'drizzle-orm';
import { db } from './index.js';
import { users } from '../../shared/schema.js';

export async function bootstrapDatabase() {
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
