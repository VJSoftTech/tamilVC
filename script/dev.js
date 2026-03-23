import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
  const proc = spawn(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    ...opts,
  });
  proc.on('error', (err) => console.error(`[${cmd}] error:`, err));
  return proc;
}

console.log('🚀 Starting VideoMeet in development mode...\n');

// Start Express + Socket.IO server
const server = run('node', ['--watch', 'server/index.js'], {
  env: { ...process.env, NODE_ENV: 'development' },
});

// Give server a moment to bind, then start Vite
setTimeout(() => {
  const vite = run('vite', ['--config', 'vite.config.js']);

  process.on('SIGINT',  () => { server.kill(); vite.kill(); process.exit(0); });
  process.on('SIGTERM', () => { server.kill(); vite.kill(); process.exit(0); });
}, 800);
