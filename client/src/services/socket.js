import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

let socket = null;

export function getSocket(token) {
  if (socket && socket.connected) return socket;

  if (socket) { socket.disconnect(); socket = null; }

  socket = io(SOCKET_URL, {
    auth: { token },
    // WebSocket first — much lower latency than polling (critical for ngrok)
    transports: ['websocket'],
    // Reconnect quickly if connection drops
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 3000,
    timeout: 10000,
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}

export default { getSocket, disconnectSocket };