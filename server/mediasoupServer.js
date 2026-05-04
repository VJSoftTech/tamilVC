// mediasoupServer.js
// This file sets up mediasoup worker, router, and manages transports/producers/consumers for each meeting room.
import mediasoup from 'mediasoup';

const mediasoupWorkers = [];
const meetingRouters = new Map(); // meetingId -> mediasoup Router
const transports = new Map();     // transportId -> { transport, meetingId, userId, direction }
const producers = new Map();      // producerId -> { producer, meetingId, userId, kind }
const consumers = new Map();      // consumerId -> { consumer, meetingId, userId, producerId }

const createMediasoupWorker = async () => {
  const worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
  });
  worker.on('died', () => {
    console.error('Mediasoup worker died, exiting...');
    process.exit(1);
  });
  return worker;
};

export async function getMediasoupRouter(meetingId) {
  if (!meetingRouters.has(meetingId)) {
    if (mediasoupWorkers.length === 0) {
      const worker = await createMediasoupWorker();
      mediasoupWorkers.push(worker);
    }
    const worker = mediasoupWorkers[0];
    const router = await worker.createRouter({
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: { 'x-google-start-bitrate': 1000 },
        },
      ],
    });
    meetingRouters.set(meetingId, router);
  }
  return meetingRouters.get(meetingId);
}

export { mediasoupWorkers, transports, producers, consumers };
