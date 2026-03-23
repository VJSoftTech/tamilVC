import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('🚀 Starting VideoMeet in production mode...\n');

const server = spawn('node', ['server/index.js'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NODE_ENV: 'production' },
});

server.on('error', (err) => console.error('Server error:', err));
process.on('SIGINT',  () => { server.kill(); process.exit(0); });
process.on('SIGTERM', () => { server.kill(); process.exit(0); });
