import { pgTable, serial, varchar, text, boolean, integer, bigint, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id:         serial('id').primaryKey(),
  name:       varchar('name', { length: 255 }).notNull(),
  email:      varchar('email', { length: 255 }).unique().notNull(),
  username:   varchar('username', { length: 100 }).unique().notNull(),
  password:   varchar('password', { length: 255 }).notNull(),
  avatar:     varchar('avatar', { length: 500 }),
  userType:   varchar('user_type', { length: 20 }).notNull().default('user'),
  phoneNumber:varchar('phone_number', { length: 30 }),
  createdAt:  timestamp('created_at').defaultNow(),
  updatedAt:  timestamp('updated_at').defaultNow(),
});

export const meetings = pgTable('meetings', {
  id:           serial('id').primaryKey(),
  meetingId:    varchar('meeting_id', { length: 20 }).unique().notNull(),
  title:        varchar('title', { length: 255 }).notNull(),
  hostId:       integer('host_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type:         varchar('type', { length: 20 }).notNull().default('instant'),
  description:  text('description'),
  scheduledAt:  timestamp('scheduled_at'),
  startedAt:    timestamp('started_at'),
  endedAt:      timestamp('ended_at'),
  status:       varchar('status', { length: 20 }).notNull().default('waiting'),
  createdAt:    timestamp('created_at').defaultNow(),
  updatedAt:    timestamp('updated_at').defaultNow(),
});

export const meetingParticipants = pgTable('meeting_participants', {
  id:         serial('id').primaryKey(),
  meetingId:  varchar('meeting_id', { length: 20 }).notNull().references(() => meetings.meetingId, { onDelete: 'cascade' }),
  userId:     integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt:   timestamp('joined_at'),
  leftAt:     timestamp('left_at'),
  isHost:     boolean('is_host').default(false),
  createdAt:  timestamp('created_at').defaultNow(),
  updatedAt:  timestamp('updated_at').defaultNow(),
});

export const recordings = pgTable('recordings', {
  id:         serial('id').primaryKey(),
  meetingId:  varchar('meeting_id', { length: 20 }).notNull().references(() => meetings.meetingId, { onDelete: 'cascade' }),
  hostId:     integer('host_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title:      varchar('title', { length: 255 }).notNull(),
  filePath:   varchar('file_path', { length: 500 }).notNull(),
  fileSize:   bigint('file_size', { mode: 'number' }),
  duration:   integer('duration'),
  recordedAt: timestamp('recorded_at').defaultNow(),
  createdAt:  timestamp('created_at').defaultNow(),
});

export const messages = pgTable('messages', {
  id:         serial('id').primaryKey(),
  meetingId:  varchar('meeting_id', { length: 20 }).notNull().references(() => meetings.meetingId, { onDelete: 'cascade' }),
  userId:     integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  message:    text('message').notNull(),
  createdAt:  timestamp('created_at').defaultNow(),
});
