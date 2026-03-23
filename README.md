# 🎥 VideoMeet

Full-stack video conferencing app — React + Node.js + PostgreSQL + Drizzle ORM.

## Project Structure

```
videomeet/
├── client/                  # React frontend (Vite)
│   ├── index.html
│   └── src/
│       ├── components/layout/
│       ├── context/
│       ├── hooks/
│       ├── pages/
│       └── services/
├── server/                  # Express + Socket.IO backend
│   ├── db/                  # Drizzle db instance
│   ├── middleware/
│   ├── routes/
│   ├── socket/
│   └── index.js
├── shared/
│   └── schema.js            # Drizzle table definitions (shared)
├── script/
│   ├── dev.js               # Runs both servers concurrently
│   └── start.js             # Production start
├── recordings/              # Uploaded recording files
├── .env
├── drizzle.config.js
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── components.json
└── package.json
```

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET, etc.
```

### 3. Push database schema
```bash
npm run db:push
```

### 4. Start development (single command)
```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:5000

### Production build & start
```bash
npm run build   # builds React into /dist
npm start       # Express serves /dist + API on port 5000
```

## Environment Variables

```env
PORT=5000
DATABASE_URL=postgresql://postgres:password@localhost:5432/videomeet
JWT_SECRET=your_long_random_secret
FRONTEND_URL=http://localhost:5173
UPLOAD_DIR=./recordings
NODE_ENV=development
```

## Commands

| Command           | Description                          |
|-------------------|--------------------------------------|
| `npm run dev`     | Start frontend + backend in dev mode |
| `npm start`       | Start in production mode             |
| `npm run build`   | Build React client to /dist          |
| `npm run db:push` | Push Drizzle schema to PostgreSQL    |
| `npm run db:studio`| Open Drizzle Studio (DB GUI)        |
