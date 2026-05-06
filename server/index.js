import 'dotenv/config';
import express    from 'express';
import http       from 'http';
import { Server } from 'socket.io';
import cors       from 'cors';
import path       from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import authRoutes      from './routes/auth.js';
import meetingRoutes   from './routes/meetings.js';
import recordingRoutes from './routes/recordings.js';
import signalRoutes    from './routes/signal.js';
import messageRoutes   from './routes/messages.js';
import usersRoutes     from './routes/users.js';
import settingsRoutes  from './routes/settings.js';
import { setupSocket } from './socket/index.js';
import { bootstrapDatabase } from './db/bootstrap.js';
import { initRecordingManager } from './recording/recordingSocket.js';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const isProd        = process.env.NODE_ENV === 'production';
const FRONTEND_URL  = process.env.FRONTEND_URL || 'http://localhost:5173';

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: isProd ? false : FRONTEND_URL, methods: ['GET', 'POST'], credentials: true },
  // Performance: compress signaling messages, tune ping
  perMessageDeflate: { threshold: 512 },
  httpCompression:   { threshold: 512 },
  pingTimeout:  20000,
  pingInterval: 25000,
  // Use websocket first, fall back to polling only if needed
  transports: ['websocket', 'polling'],
  upgradeTimeout: 5000,
});

// Middleware
app.use(cors({ origin: isProd ? false : FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => { req.io = io; next(); });

// Static uploads + recording output directory (same folder)
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './recordings');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

// Initialise composite recording manager (mediasoup → FFmpeg pipeline)
initRecordingManager(uploadDir);

// Serve composite-recorded MP4 files for direct download
app.get('/api/recordings/files/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found' });
  res.download(filePath, filename);
});

// API routes
app.use('/api', authRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/meetings/:meetingId/messages', messageRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/signal/:meetingId', signalRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/settings', settingsRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date() }));

// Production: serve built React app from /dist
if (isProd) {
  const distPath = path.resolve(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

setupSocket(io);

const PORT = process.env.PORT || 5000;

bootstrapDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\n🎥 VideoMeet server running on http://localhost:${PORT}`);
      if (!isProd) console.log(`🌐 Frontend dev server: ${FRONTEND_URL}`);
      else         console.log(`🌐 Serving built client from /dist`);
      console.log(`📡 Socket.IO ready\n`);
    });
  })
  .catch((err) => {
    console.error('Failed to bootstrap database:', err);
    process.exit(1);
  });