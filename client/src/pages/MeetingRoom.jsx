import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth }      from '../context/AuthContext.jsx';
import { useWebRTC }    from '../hooks/useWebRTC.js';
import { useRecording } from '../hooks/useRecording.js';
import { meetingAPI, messageAPI } from '../services/api.js';
import { getSocket, disconnectSocket } from '../services/socket.js';
import { takeHandoffStream } from '../utils/streamHandoff.js';
import Whiteboard from '../components/Whiteboard.jsx';
import BackgroundPanel from '../components/BackgroundEffects/BackgroundPanel.jsx';

// ─── SVG Icon components ───────────────────────────────────────────
const Icon = ({ d, size = 20, fill = 'none', stroke = 'currentColor', strokeWidth = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const Icons = {
  MicOn:        () => <Icon d={['M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z','M19 10v2a7 7 0 0 1-14 0v-2','M12 19v4','M8 23h8']} />,
  MicOff:       () => <Icon d={['M1 1l22 22','M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6','M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23','M12 19v4','M8 23h8']} />,
  CamOn:        () => <Icon d={['M23 7l-7 5 7 5V7z','M1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z']} />,
  CamOff:       () => <Icon d={['M1 1l22 22','M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06A4 4 0 0 1 8.56 15.17']} />,
  ScreenOn:     () => <Icon d={['M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3','M8 21h8','M12 17v4','M17 1l4 4-4 4','M21 5H9']} />,
  ScreenOff:    () => <Icon d={['M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3','M8 21h8','M12 17v4','M1 1l22 22']} />,
  Whiteboard:   () => <Icon d={['M2 3h20v14H2z','M8 21h8','M12 17v4']} />,
  WhiteboardOff:() => <Icon d={['M2 3h20v14H2z','M8 21h8','M12 17v4','M1 1l22 22']} />,
  Effects:      () => <Icon d={['M12 3l1.9 4.8L19 10l-4.2 3.1L16 18l-4-2.7L8 18l1.2-4.9L5 10l5.1-2.2L12 3z']} />,
  Hand:         () => <Icon d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a6 6 0 0 0 12 0v-3a2 2 0 0 0-4 0" />,
  RecStart:     () => <Icon d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 0" fill="currentColor" stroke="none" />,
  RecStop:      () => <Icon d="M6 6h12v12H6z" fill="currentColor" stroke="none" />,
  Chat:         () => <Icon d={['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z']} />,
  People:       () => <Icon d={['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2','M23 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z']} />,
  Leave:        () => <Icon d={['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4','M16 17l5-5-5-5','M21 12H9']} />,
  EndCall:      () => <Icon d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-3.41m-3.5-6.9A19.79 19.79 0 0 1 4.42 4 2 2 0 0 1 6.61 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L10.68 9.78" strokeWidth={2} />,
  ChevronLeft:  () => <Icon d="M15 18l-6-6 6-6" />,
  ChevronRight: () => <Icon d="M9 18l6-6-6-6" />,
  Send:         () => <Icon d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />,
  Copy:         () => <Icon d={['M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z','M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 0 2 2v1']} />,
  // Flip camera icon
  CamFlip: () => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      <path d="M23 7l-7 5 7 5V7z" />
      <circle cx="9" cy="12" r="3" />
      <path d="M6 4c0-1.1.9-2 2-2h2" strokeWidth={1.5} />
      <path d="M13 2h1a2 2 0 0 1 2 2" strokeWidth={1.5} />
      <path d="M7.5 2.5L6 4l1.5 1.5" strokeWidth={1.5} />
    </svg>
  ),
  More: () => <Icon d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm7 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm7 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" strokeWidth={2.5} />,
};

// ─── Video grid layout helpers ────────────────────────────────────
/**
 * Compute CSS-Grid template style for n participants.
 * Layout matches Google Meet:
 *   n=1  → full screen
 *   n=2  → landscape: side-by-side  |  portrait: stacked
 *   n=3  → 3 tiles in one row (landscape) | stacked (portrait)
 *   n=4  → 2×2 grid
 *   n=5–6 → 3×2  |  n=7-9 → 3×3  |  etc.
 */
function getVideoGridStyle(n, isPortrait) {
  if (n <= 0) return {};
  if (n === 1) {
    return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
  }
  if (n === 2) {
    return isPortrait
      ? { gridTemplateColumns: '1fr',           gridTemplateRows: 'repeat(2, 1fr)' }
      : { gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: '1fr'            };
  }
  if (n === 3) {
    // Google Meet style: 3 tiles in a single row
    return isPortrait
      ? { gridTemplateColumns: '1fr',           gridTemplateRows: 'repeat(3, 1fr)' }
      : { gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: '1fr'            };
  }
  if (n === 4) {
    return { gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' };
  }
  const cols = n <= 6 ? 3 : n <= 9 ? 3 : n <= 12 ? 4 : n <= 16 ? 4 : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return {
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows:    `repeat(${rows}, 1fr)`,
  };
}

/** Track viewport orientation so the grid switches on rotate/resize. */
function useViewportPortrait() {
  const [isPortrait, setIsPortrait] = useState(() => window.innerHeight > window.innerWidth);
  useEffect(() => {
    const update = () => setIsPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return isPortrait;
}

/**
 * Returns a CSS transform string for the local video element so it stays
 * upright regardless of device orientation.
 *
 * Strategy:
 *  1. Front camera always mirrors (scaleX(-1)) — standard selfie UX.
 *  2. If the browser does NOT auto-correct the stream rotation (detectable
 *     by comparing videoWidth/videoHeight vs window orientation), we apply
 *     a CSS rotation to compensate.  We use the actual pixel dimensions of
 *     the live video so we only rotate when genuinely needed — avoiding
 *     double-correction on browsers that already handle it.
 */
function useLocalVideoTransform(facingMode, videoRef) {
  const [transform, setTransform] = useState(() =>
    facingMode === 'user' ? 'scaleX(-1)' : 'none'
  );

  const recompute = useCallback(() => {
    const el = videoRef?.current;
    const mirror = facingMode === 'user' ? 'scaleX(-1)' : '';

    // Read device orientation angle (0=portrait, 90=landscape-right,
    // 180=portrait-upside-down, 270=landscape-left; iOS may return -90).
    let angle = 0;
    try {
      angle = (typeof screen.orientation?.angle === 'number')
        ? screen.orientation.angle
        : (typeof window.orientation === 'number' ? window.orientation : 0);
    } catch {}
    // Normalise to [0, 360)
    if (angle < 0) angle += 360;

    let rotateAngle = 0;
    if (el && el.videoWidth && el.videoHeight) {
      const videoPortrait   = el.videoHeight > el.videoWidth;
      const displayPortrait = window.innerHeight > window.innerWidth;

      if (videoPortrait !== displayPortrait) {
        // Stream orientation ≠ display orientation → browser did NOT auto-correct.
        // Determine rotation direction from the current device angle.
        if (angle === 90 || angle === 270) {
          // Map 270 (landscape-left) → rotate -90 deg to bring it upright
          rotateAngle = angle === 90 ? 90 : -90;
        } else {
          // Fallback: rotate 90° CW
          rotateAngle = 90;
        }
      } else if (angle === 180) {
        // Same orientation type but device is upside-down
        rotateAngle = 180;
      }
    } else {
      // Video dimensions not yet available; just handle the upside-down case
      if (angle === 180) rotateAngle = 180;
    }

    const parts = [];
    if (rotateAngle !== 0) parts.push(`rotate(${rotateAngle}deg)`);
    if (mirror) parts.push(mirror);
    setTransform(parts.length ? parts.join(' ') : 'none');
  }, [facingMode]); // eslint-disable-line

  useEffect(() => {
    recompute();
    // Recompute after a short delay on orientation change so the layout has
    // settled and videoWidth/videoHeight reflect the new stream dimensions.
    const onChange = () => setTimeout(recompute, 150);
    window.addEventListener('resize', onChange);
    try { screen.orientation.addEventListener('change', onChange); } catch {}
    return () => {
      window.removeEventListener('resize', onChange);
      try { screen.orientation.removeEventListener('change', onChange); } catch {}
    };
  }, [recompute]);

  // Also recompute when the video element reports its dimensions for the first time
  const onLoadedMetadata = useCallback(() => recompute(), [recompute]);

  return { transform, onLoadedMetadata };
}

// ─── Meeting Room Component ────────────────────────────────────────
export default function MeetingRoom() {
  const { meetingId } = useParams();
  const { user, logoutGuest } = useAuth();
  const navigate      = useNavigate();
  const { t }         = useTranslation();

  const socketRef      = useRef(null);
  const webrtcRef      = useRef(null);
  const socketSetupRef = useRef(false);
  const localVideoRef  = useRef(null);
  const chatBottomRef   = useRef(null);
  const chatVisibleRef  = useRef(true);

  const whiteboardRef         = useRef(null);
  const whiteboardActiveRef   = useRef(false);
  const pendingWbStrokesRef   = useRef([]); // buffer strokes that arrive before Whiteboard mounts

  const [meetingInfo,      setMeetingInfo]      = useState(null);
  const [isHost,           setIsHost]           = useState(false);
  const [hostId,           setHostId]           = useState(null);
  const [screenSharer,     setScreenSharer]     = useState(null);
  const [whiteboardActive, setWhiteboardActive] = useState(false);
  whiteboardActiveRef.current = whiteboardActive;
  const [waiting,      setWaiting]      = useState(false);
  const [participants, setParticipants] = useState([]);
  const [error,        setError]        = useState('');
  const [loadingJoin,  setLoadingJoin]  = useState(true);
  const [sidebarTab,   setSidebarTab]   = useState('chat');
  const [showSidebar,  setShowSidebar]  = useState(false);
  const [messages,     setMessages]     = useState([]);
  const [chatInput,    setChatInput]    = useState('');
  const [unreadCount,  setUnreadCount]  = useState(0);
  const [copied,       setCopied]       = useState(false);
  const [showEffectsPanel, setShowEffectsPanel] = useState(false);
  const [showLeaveDialog,  setShowLeaveDialog]  = useState(false);
  // When the user presses the browser back button we intercept it, show the
  // dialog, and push a new history entry so the URL doesn't change yet.
  const backBlockedRef = useRef(false);

  // ── Camera flip state ──────────────────────────────────────────────
  const [facingMode,     setFacingMode]     = useState('user'); // 'user' = front, 'environment' = back
  const [isFlippingCam,  setIsFlippingCam]  = useState(false);
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [showMoreMenu,   setShowMoreMenu]   = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef(null);

  // Detect mobile once on mount
  useEffect(() => {
    const mobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /MacIntel/.test(navigator.platform));
    setIsMobileDevice(mobile);
  }, []);

  const webrtc    = useWebRTC(meetingId, socketRef);
  const recording = useRecording(meetingId, {
    noActiveStreams: t('pages.meetingRoom.noActiveStreams'),
  });
  webrtcRef.current = webrtc;

  // Sync local video
  useEffect(() => {
    if (localVideoRef.current && webrtc.localStream) {
      localVideoRef.current.srcObject = webrtc.localStream;
    }
  }, [webrtc.localStream]);

  // Sync remote streams into participants — always overwrite so renegotiation
  // and reconnect stream updates are reflected correctly.
  useEffect(() => {
    setParticipants(prev => prev.map(p => {
      const stream = webrtc.remoteStreams[p.userId];
      if (stream === undefined) return p;          // no entry yet — leave unchanged
      if (stream === p.stream) return p;           // same object — no re-render needed
      return { ...p, stream: stream || null };     // update (including null = disconnected)
    }));
  }, [webrtc.remoteStreams]);

  const prevStreamKeysRef = useRef(new Set());
  useEffect(() => {
    const currentKeys = new Set(Object.keys(webrtc.remoteStreams));
    const hasNew = [...currentKeys].some(k => !prevStreamKeysRef.current.has(k));
    if (hasNew) {
      prevStreamKeysRef.current = currentKeys;
      setTimeout(() => {
        if (socketRef.current?.connected) {
          socketRef.current.emit('signal:media-status', {
            meetingId,
            camOn: !!webrtcRef.current?.isCameraOn,
            micOn: !!webrtcRef.current?.isMicOn,
          });
        }
      }, 400);
    }
  }, [webrtc.remoteStreams]); // eslint-disable-line

  const syncStreams = useCallback(() => {
    setParticipants(prev => prev.map(p => {
      const stream = webrtcRef.current?.remoteStreams?.[p.userId];
      return (stream && !p.stream) ? { ...p, stream } : p;
    }));
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const visible = showSidebar && sidebarTab === 'chat';
    chatVisibleRef.current = visible;
    if (visible) setUnreadCount(0);
  }, [showSidebar, sidebarTab]);

  // Drain any buffered whiteboard strokes that arrived before the Whiteboard
  // component was mounted (whiteboard:draw can arrive faster than React can
  // process the setWhiteboardActive(true) re-render).
  useEffect(() => {
    if (whiteboardActive && whiteboardRef.current && pendingWbStrokesRef.current.length > 0) {
      pendingWbStrokesRef.current.forEach(s => whiteboardRef.current.receiveStroke(s));
      pendingWbStrokesRef.current = [];
    }
  }, [whiteboardActive]);

  // ── Socket setup ──────────────────────────────────────────────────
  const setupSocket = useCallback((token) => {
    if (socketSetupRef.current) return;
    socketSetupRef.current = true;

    disconnectSocket();
    const socket = getSocket(token);
    socketRef.current = socket;

    socket.emit('join-meeting', meetingId);

    socket.on('room-members', (members) => {
      members.forEach(({ userId, name, username, avatar }) => {
        const uid = String(userId);
        if (user && uid === String(user.id)) return;
        setParticipants(prev => {
          if (prev.find(p => p.userId === uid)) return prev;
          return [...prev, { userId: uid, name, username, avatar, stream: null, camOn: true, micOn: true, handRaised: false }];
        });
        // We are the new joiner — initiate calls to everyone already in the room.
        // Delay slightly to ensure local stream is attached to the PC before offer.
        setTimeout(() => webrtcRef.current.initiateCall(uid), 400);
      });
      // Do NOT emit signal:ready here — that caused offer collision (glare).
      // Existing members learn about us via user-joined and wait for our offer.
      setTimeout(() => {
        if (socket.connected) {
          socket.emit('signal:media-status', {
            meetingId,
            camOn: !!webrtcRef.current?.isCameraOn,
            micOn: !!webrtcRef.current?.isMicOn,
          });
        }
      }, 700);
    });

    // peer-ready: only used for participant tracking now; do NOT call initiateCall
    // here — that causes glare (both sides offering simultaneously).
    socket.on('peer-ready', ({ userId, name, username, avatar }) => {
      const uid = String(userId);
      setParticipants(prev => {
        if (prev.find(p => p.userId === uid)) return prev;
        return [...prev, { userId: uid, name, username, avatar, stream: null, camOn: true, micOn: true, handRaised: false }];
      });
      if (whiteboardActiveRef.current && whiteboardRef.current) {
        const strokes = whiteboardRef.current.getStrokes();
        socket.emit('whiteboard:sync', { meetingId, to: uid, strokes });
      }
    });

    // user-joined: add them to participant list immediately so their tile appears.
    // Also close any stale PC — the user may have refreshed, giving them a new
    // socket. Their room-members handler will initiate fresh offers to us.
    socket.on('user-joined', ({ userId, name, username, avatar }) => {
      const uid = String(userId);
      if (user && uid === String(user.id)) return;
      // Tear down stale peer connection so createPeerConnection builds a fresh one
      webrtcRef.current.removePeer(uid);
      setParticipants(prev => {
        const entry = { userId: uid, name, username: username || name, avatar,
          stream: null, camOn: true, micOn: true, handRaised: false };
        const idx = prev.findIndex(p => p.userId === uid);
        if (idx >= 0) {
          // User reconnected — reset their tile so dead stream is cleared
          const next = [...prev];
          next[idx] = entry;
          return next;
        }
        return [...prev, entry];
      });
    });

    socket.on('user-left', ({ userId }) => {
      const uid = String(userId);
      webrtcRef.current.removePeer(uid);
      setParticipants(prev => prev.filter(p => p.userId !== uid));
    });

    socket.on('offer', ({ from, name, username, avatar, offer }) => {
      const uid = String(from);
      setParticipants(prev => {
        if (prev.find(p => p.userId === uid)) return prev;
        return [...prev, { userId: uid, name, username: username || name, avatar, stream: null, camOn: true, micOn: true, handRaised: false }];
      });
      webrtcRef.current.handleOffer({ from: uid, offer });
    });

    socket.on('answer',        ({ from, answer })    => webrtcRef.current.handleAnswer({ from: String(from), answer }));
    socket.on('ice-candidate', ({ from, candidate }) => webrtcRef.current.handleIceCandidate({ from: String(from), candidate }));

    socket.on('media-status', ({ userId, camOn, micOn }) => {
      setParticipants(prev => prev.map(p => String(p.userId) === String(userId) ? { ...p, camOn, micOn } : p));
    });

    socket.on('screen-share-status', ({ userId, active }) => {
      setScreenSharer(active ? String(userId) : null);
    });

    socket.on('whiteboard:active', ({ active }) => {
      if (!active) pendingWbStrokesRef.current = [];
      setWhiteboardActive(active);
    });

    socket.on('whiteboard:sync', ({ strokes }) => {
      whiteboardRef.current?.applyStrokes(strokes);
    });

    socket.on('whiteboard:draw', ({ stroke }) => {
      if (whiteboardRef.current) {
        whiteboardRef.current.receiveStroke(stroke);
      } else {
        pendingWbStrokesRef.current.push(stroke);
      }
    });

    socket.on('whiteboard:clear', () => {
      whiteboardRef.current?.clearBoard();
    });

    socket.on('raise-hand', ({ userId, raised }) => {
      setParticipants(prev => prev.map(p => String(p.userId) === String(userId) ? { ...p, handRaised: raised } : p));
    });

    socket.on('chat-message', (msg) => {
      setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
      if (!chatVisibleRef.current) setUnreadCount(c => c + 1);
    });

    socket.on('meeting-ended', () => {
      alert(t('pages.meetingRoom.hostEnded'));
      doCleanup();
      if (user?.isGuest) { logoutGuest(); navigate(`/prejoin/${meetingId}`); }
      else navigate('/dashboard');
    });

    socket.on('reconnect', () => {
      // All WebRTC peer connections are broken after a socket disconnect.
      // Close them now so createPeerConnection will build fresh ones once
      // room-members fires and initiateCall is triggered again.
      webrtcRef.current.closeAllPeers();
      // Reset participant streams so tiles show avatars while reconnecting.
      setParticipants(prev => prev.map(p => ({ ...p, stream: null })));
      socket.emit('join-meeting', meetingId);
      setTimeout(() => {
        if (socket.connected) {
          socket.emit('signal:media-status', {
            meetingId,
            camOn: !!webrtcRef.current?.isCameraOn,
            micOn: !!webrtcRef.current?.isMicOn,
          });
        }
      }, 600);
    });
  }, [meetingId, user]); // eslint-disable-line

  const doCleanup = useCallback(() => {
    if (localVideoRef.current) { localVideoRef.current.srcObject = null; localVideoRef.current.load(); }
    webrtcRef.current?.cleanup();
    disconnectSocket();
    socketSetupRef.current = false;
  }, []);

  // ── Join meeting ──────────────────────────────────────────────────
  useEffect(() => {
    let pollInterval = null;
    let cancelled    = false;

    const tryJoin = async () => {
      try {
        // Guests: use pre-fetched join result stored by PreJoin
        const storedResult = sessionStorage.getItem('guestJoinResult');
        if (storedResult) {
          sessionStorage.removeItem('guestJoinResult');
          const data = JSON.parse(storedResult);
          if (data.waiting) {
            setWaiting(true);
            pollInterval = setInterval(async () => {
              try {
                const poll = await meetingAPI.getInfo(meetingId);
                if (poll.data.host_joined) {
                  clearInterval(pollInterval);
                  await enterMeeting({ meeting: poll.data.meeting, is_host: false });
                }
              } catch {}
            }, 3000);
          } else {
            await enterMeeting(data);
          }
          return;
        }

        // No token at all — send to pre-join lobby to get a guest token
        const localToken = localStorage.getItem('token');
        const guestToken = sessionStorage.getItem('guestToken');

        if (!localToken && !guestToken) {
          navigate(`/prejoin/${meetingId}`, { replace: true });
          return;
        }

        // Has a token (regular or guest) — the join endpoint accepts both
        const res = await meetingAPI.join(meetingId);
        if (cancelled) return;
        if (res.data.waiting) {
          setWaiting(true);
          pollInterval = setInterval(async () => {
            try {
              const poll = await meetingAPI.join(meetingId);
              if (!poll.data.waiting) { clearInterval(pollInterval); await enterMeeting(poll.data); }
            } catch {}
          }, 3000);
        } else {
          await enterMeeting(res.data);
        }
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.message || 'Failed to join meeting');
      } finally {
        if (!cancelled) setLoadingJoin(false);
      }
    };

    const enterMeeting = async (data) => {
      setMeetingInfo(data.meeting);
      setIsHost(data.is_host);
      setHostId(String(data.meeting?.host?.id || data.meeting?.hostId || ''));
      setWaiting(false);
      let prejoin = { camOn: true, micOn: true, camId: '', micId: '' };
      try { prejoin = JSON.parse(sessionStorage.getItem('prejoin') || '{}'); sessionStorage.removeItem('prejoin'); } catch {}
      recording.setWatermarkConfig({
        image: prejoin.watermarkImage || '',
        position: prejoin.watermarkPosition || 'bottom-right',
      });
      await webrtc.startLocalStream(prejoin.camId, prejoin.micId, prejoin.camOn ?? true, prejoin.micOn ?? true, 'user', takeHandoffStream())
        .catch(err => console.warn('Media error:', err));
      // Socket setup MUST run AFTER startLocalStream so localStreamRef.current
      // is populated before the first initiateCall fires (prevents blank video).
      // Guests start with empty chat history (messages endpoint needs real user for history)
      if (!sessionStorage.getItem('guestToken')) {
        messageAPI.getAll(meetingId).then(r => setMessages(r.data)).catch(() => {});
      }
      const token = localStorage.getItem('token') || sessionStorage.getItem('guestToken');
      setupSocket(token);
    };

    tryJoin();
    return () => { cancelled = true; if (pollInterval) clearInterval(pollInterval); };
  }, [meetingId]); // eslint-disable-line

  // ── Controls ───────────────────────────────────────────────────────
  const releaseAndLeave = (dest) => { doCleanup(); navigate(dest); };

  // Actual leave — called after the user confirms.
  const handleLeave = async () => {
    setShowLeaveDialog(false);
    socketRef.current?.emit('leave-meeting', meetingId);
    if (user?.isGuest) {
      doCleanup();
      logoutGuest();
      navigate(`/prejoin/${meetingId}`);
    } else {
      releaseAndLeave('/dashboard');
      await meetingAPI.leave(meetingId).catch(() => {});
    }
  };

  // Show dialog instead of leaving immediately.
  const promptLeave = () => setShowLeaveDialog(true);

  // ── Back-button + page-close interception ─────────────────────────
  useEffect(() => {
    // Push a sentinel entry so we can detect the back gesture.
    window.history.pushState({ meetingGuard: true }, '');
    backBlockedRef.current = false;

    const onPopState = (e) => {
      if (backBlockedRef.current) return; // already handling
      backBlockedRef.current = true;
      // Re-push the sentinel so the URL stays on the meeting page.
      window.history.pushState({ meetingGuard: true }, '');
      setShowLeaveDialog(true);
      // Reset flag after a tick so repeated presses still work.
      setTimeout(() => { backBlockedRef.current = false; }, 300);
    };

    const onBeforeUnload = (e) => {
      // This fires on tab close, browser close, and hard refresh.
      // We eagerly emit leave-meeting so the server cleans up even if the
      // confirmation sheet never resolves.
      socketRef.current?.emit('leave-meeting', meetingId);
      e.preventDefault();
      e.returnValue = ''; // required for the browser to show its own dialog
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [meetingId]); // eslint-disable-line

  const handleScreenShareEnded = useCallback(() => {
    socketRef.current?.emit('signal:screen-share', { meetingId, active: false });
    setScreenSharer(null);
  }, [meetingId]);

  const handleToggleWhiteboard = useCallback(() => {
    const next = !whiteboardActive;
    setWhiteboardActive(next);
    socketRef.current?.emit('whiteboard:active', { meetingId, active: next });
    if (!next) socketRef.current?.emit('whiteboard:clear', { meetingId });
  }, [whiteboardActive, meetingId]);

  const handleEffectTrackChange = useCallback(async (track) => {
    await webrtcRef.current?.setVideoEffectTrack(track || null);
  }, []);

  const handleEnd = async () => {
    if (!window.confirm(t('pages.meetingRoom.confirmEndAll'))) return;
    if (recording.isRecording) await recording.stopRecording();
    socketRef.current?.emit('leave-meeting', meetingId);
    releaseAndLeave('/dashboard');
    await meetingAPI.end(meetingId).catch(() => {});
  };

  const handleStartRecording = async () => {
    const streams = [];
    if (webrtc.isCameraOn && webrtc.localStreamRef.current) streams.push(webrtc.localStreamRef.current);
    participants.forEach(p => { if (p.camOn && p.stream) streams.push(p.stream); });
    await recording.startRecording(streams, isPortraitViewport);
    socketRef.current?.emit('signal:recording-status', { meetingId, started: true });
  };

  const handleStopRecording = async () => {
    const result = await recording.stopRecording();
    if (result) alert(t('pages.meetingRoom.recordingSaved'));
    socketRef.current?.emit('signal:recording-status', { meetingId, started: false });
  };

  const sendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    const tempId = -Date.now();
    setChatInput('');
    setMessages(prev => [...prev, { id: tempId, user: { id: user.id, name: user.name }, message: msg, createdAt: new Date().toISOString(), _own: true }]);
    const res = await messageAPI.send(meetingId, msg);
    setMessages(prev => prev.map(m => m.id === tempId ? { ...res.data, _own: true } : m));
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.origin + '/meet/' + meetingId);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  // ── Camera flip handler ────────────────────────────────────────────
  // Delegates entirely to webrtc.flipCamera() which handles track replacement
  // on all peer connections. We just update local UI state with the result.
  const handleFlipCamera = useCallback(async () => {
    if (isFlippingCam || !webrtc.isCameraOn) return;
    setIsFlippingCam(true);
    try {
      const nextFacing = await webrtcRef.current.flipCamera();
      if (nextFacing) setFacingMode(nextFacing);
    } catch (err) {
      console.warn('Camera flip failed:', err);
    } finally {
      setIsFlippingCam(false);
    }
  }, [isFlippingCam, webrtc.isCameraOn]);

  // ── Auto-hide controls on mobile (tap screen to reveal) ─────────────
  const resetControlsTimer = useCallback(() => {
    setControlsVisible(true);
    if (!isMobileDevice) return;
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 4500);
  }, [isMobileDevice]);

  useEffect(() => {
    if (isMobileDevice) resetControlsTimer();
    return () => clearTimeout(controlsTimerRef.current);
  }, [isMobileDevice]); // eslint-disable-line

  // Keep controls visible while More menu is open
  useEffect(() => {
    if (showMoreMenu) clearTimeout(controlsTimerRef.current);
    else if (isMobileDevice) resetControlsTimer();
  }, [showMoreMenu]); // eslint-disable-line

  // ── Layout ─────────────────────────────────────────────────────────
  const allTiles = [
    { userId: 'local', name: (user?.name || '') + ' (You)', isLocal: true,
      isHost, camOn: webrtc.isCameraOn, micOn: webrtc.isMicOn,
      handRaised: webrtc.handRaised, stream: webrtc.localStream, avatar: user?.avatar },
    ...participants.map(p => ({ ...p, isLocal: false, isHost: String(p.userId) === hostId })),
  ];

  const sharerTile = (() => {
    if (!screenSharer) return null;
    if (screenSharer === 'local') return { ...allTiles[0], screenStream: webrtc.screenStreamRef?.current };
    return allTiles.find(t => t.userId === screenSharer) || null;
  })();

  const isSpotlightMode = !!sharerTile || whiteboardActive;
  const isPortraitViewport = useViewportPortrait();
  const videoGridStyle = getVideoGridStyle(allTiles.length, isPortraitViewport);
  const { transform: localVideoTransform, onLoadedMetadata: onLocalVideoMetadata } =
    useLocalVideoTransform(facingMode, localVideoRef);

  if (loadingJoin) return (
    <div className="waiting-room"><div className="waiting-card">
      <div className="spinner" style={{ margin: '0 auto 16px' }} />
      <h3>{t('pages.meetingRoom.connecting')}</h3>
    </div></div>
  );
  if (error) return (
    <div className="waiting-room"><div className="waiting-card">
      <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
      <h3>{error}</h3>
      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => user?.isGuest ? navigate('/') : navigate('/dashboard')}>← {user?.isGuest ? t('common.goBack') : t('nav.dashboard')}</button>
    </div></div>
  );
  if (waiting) return (
    <div className="waiting-room"><div className="waiting-card">
      <div className="spinner" style={{ margin: '0 auto 16px' }} />
      <h3>{t('pages.meetingRoom.waitingForHost')}</h3>
      <p style={{ color: 'var(--text-muted)', marginTop: 8, fontSize: 13 }}>{t('pages.meetingRoom.autoAdmit')}</p>
      <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={promptLeave}>{t('common.cancel')}</button>
    </div></div>
  );

  return (
    <div
      className="meeting-room"
      onTouchStart={isMobileDevice ? resetControlsTimer : undefined}
      onClick={isMobileDevice ? resetControlsTimer : undefined}
    >

      {/* ── Header ── */}
      <div className="room-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{meetingInfo?.title || t('pages.newMeeting.meetingFallbackTitle')}</span>
            {meetingInfo?.subTitle && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.3 }}>{meetingInfo.subTitle}</span>
            )}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface2)', padding: '2px 8px', borderRadius: 20 }}>{meetingId}</span>
          {recording.isRecording && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', padding: '3px 10px', borderRadius: 20 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'blink 1s infinite' }} />
              <span style={{ fontSize: 11, color: '#f87171', fontWeight: 700 }}>REC {recording.formattedDuration}</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="hdr-btn" onClick={copyLink} title={t('pages.meetingRoom.copyMeetingLink')}>
            <Icons.Copy /> <span>{copied ? t('common.copied') : t('common.copyLink')}</span>
          </button>
          <button className="hdr-btn" onClick={() => setShowSidebar(s => !s)} title={t('pages.meetingRoom.togglePanel')}>
            {showSidebar ? <Icons.ChevronRight /> : <Icons.ChevronLeft />}
            <span>{showSidebar ? t('common.hide') : t('common.panel')}</span>
          </button>
          {isHost && (
            <button className="hdr-btn danger" onClick={handleEnd}>
              <Icons.EndCall /> <span>{t('pages.meetingRoom.endForAll')}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="room-body">
        <div className="video-grid-area">
          {isSpotlightMode ? (
            <div className="spotlight-layout">
              <div className="spotlight-main">
                {whiteboardActive
                  ? <Whiteboard ref={whiteboardRef} isHost={isHost} socketRef={socketRef} meetingId={meetingId} />
                  : <ScreenTile tile={sharerTile} />
                }
              </div>
              <div className="spotlight-strip">
                {allTiles.map(tile => (
                  <VideoTile
                    key={tile.userId + '-strip'}
                    tile={tile}
                    videoRef={tile.isLocal ? localVideoRef : null}
                    videoTransform={tile.isLocal ? localVideoTransform : undefined}
                    onVideoMetadata={tile.isLocal ? onLocalVideoMetadata : undefined}
                    compact
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="video-grid" style={videoGridStyle}>
              {allTiles.map(tile => (
                <VideoTile
                  key={tile.userId}
                  tile={tile}
                  videoRef={tile.isLocal ? localVideoRef : null}
                  videoTransform={tile.isLocal ? localVideoTransform : undefined}
                  onVideoMetadata={tile.isLocal ? onLocalVideoMetadata : undefined}
                />
              ))}
            </div>
          )}
        </div>

        {showSidebar && <div className="room-sidebar-backdrop" onClick={() => setShowSidebar(false)} />}
        {showSidebar && (
          <div className="room-sidebar">
            <div className="room-sidebar-tabs">
              <button className={sidebarTab === 'chat' ? 'active' : ''} onClick={() => { setSidebarTab('chat'); setUnreadCount(0); }}>
                <Icons.Chat /> {t('common.chat')}
                {unreadCount > 0 && sidebarTab !== 'chat' && <span className="tab-badge tab-unread">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </button>
              <button className={sidebarTab === 'participants' ? 'active' : ''} onClick={() => setSidebarTab('participants')}>
                <Icons.People /> {t('common.people')} <span className="tab-badge">{allTiles.length}</span>
              </button>
              <button className="room-sidebar-close-btn" onClick={() => setShowSidebar(false)} aria-label="Close panel">✕</button>
            </div>
            <div className="room-sidebar-content">
              {sidebarTab === 'chat' ? (
                <>
                  <div className="chat-messages">
                    {messages.length === 0 && (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginTop: 40 }}>
                        {t('pages.meetingRoom.noMessages')}<br />{t('pages.meetingRoom.sayHello')}
                      </div>
                    )}
                    {messages.map((m, i) => {
                      const isOwn = m._own || m.user?.id === user?.id;
                      const ts = new Date(m.createdAt || m.created_at);
                      const timeStr = isNaN(ts) ? '' : ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      return (
                        <div key={m.id || i} className={`chat-msg ${isOwn ? 'own' : ''}`}>
                          {!isOwn && (
                            <div className="msg-avatar">
                              {m.user?.avatar
                                ? <img src={m.user.avatar} alt={m.user?.name || ''} />
                                : (m.user?.name?.[0] || '?').toUpperCase()}
                            </div>
                          )}
                          <div className="msg-content">
                            {!isOwn && <span className="msg-author">{m.user?.name}</span>}
                            <div className="msg-body">{m.message}</div>
                            <div className="msg-time">{timeStr}</div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatBottomRef} />
                  </div>
                  <form className="chat-input-row" onSubmit={sendChat}>
                    <textarea
                      className="chat-textarea"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(e); } }}
                      placeholder={t('pages.meetingRoom.typeMessage')}
                      autoComplete="off"
                      rows={1}
                    />
                    <button type="submit" className="send-btn"><Icons.Send /></button>
                  </form>
                </>
              ) : (
                <div className="participants-list">
                  {allTiles.map(p => (
                    <div key={p.userId} className="participant-item">
                      <div className="p-avatar">{p.avatar ? <img src={p.avatar} alt={p.name || 'User'} className="avatar-img" /> : p.name?.[0]?.toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="p-name">{p.name}</div>
                        {p.isLocal && <div style={{ fontSize: 11, color: 'var(--primary)' }}>{t('common.you')}</div>}
                      </div>
                      <div className="p-badges">
                        <span className={`p-badge ${p.micOn ? 'on' : 'off'}`}>{p.micOn ? <Icons.MicOn /> : <Icons.MicOff />}</span>
                        <span className={`p-badge ${p.camOn ? 'on' : 'off'}`}>{p.camOn ? <Icons.CamOn /> : <Icons.CamOff />}</span>
                        {p.handRaised && <span className="p-badge raised">✋</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Controls Bar ── */}
      <div className={`controls-bar${isMobileDevice && !controlsVisible ? ' ctrl-bar-hidden' : ''}`}>
        <div className="controls-group">
          {/* Mic */}
          <CtrlBtn
            active={webrtc.isMicOn} offStyle="red"
            onClick={webrtc.toggleMic}
            icon={webrtc.isMicOn ? <Icons.MicOn /> : <Icons.MicOff />}
            label={webrtc.isMicOn ? t('pages.meetingRoom.mute') : t('pages.meetingRoom.unmute')}
          />
          {/* Camera */}
          <CtrlBtn
            active={webrtc.isCameraOn} offStyle="red"
            onClick={webrtc.toggleCamera}
            icon={webrtc.isCameraOn ? <Icons.CamOn /> : <Icons.CamOff />}
            label={webrtc.isCameraOn ? t('pages.meetingRoom.stopVideo') : t('pages.meetingRoom.startVideo')}
          />

          {/* ── Flip Camera: in More menu on mobile ── */}
          {isMobileDevice && webrtc.isCameraOn && (
            <CtrlBtn
              className="ctrl-secondary"
              active={!isFlippingCam}
              offStyle="blue"
              onClick={handleFlipCamera}
              disabled={isFlippingCam}
              icon={
                isFlippingCam
                  ? <span style={{ display: 'inline-block', fontSize: 18, animation: 'spin 0.5s linear infinite' }}>↻</span>
                  : <Icons.CamFlip />
              }
              label={isFlippingCam ? 'Switch…' : '↺ Switch'}
            />
          )}

          {/* Screen share */}
          <CtrlBtn
            className="ctrl-secondary"
            active={!webrtc.isScreenSharing} offStyle="blue"
            onClick={
              webrtc.isScreenSharing
                ? async () => {
                    await webrtc.stopScreenShare();
                    socketRef.current?.emit('signal:screen-share', { meetingId, active: false });
                    setScreenSharer(null);
                  }
                : async () => {
                    try {
                      await webrtc.startScreenShare(handleScreenShareEnded);
                      socketRef.current?.emit('signal:screen-share', { meetingId, active: true });
                      setScreenSharer('local');
                    } catch (err) {
                      if (err.name !== 'NotAllowedError') console.error('Screen share error:', err);
                    }
                  }
            }
            icon={webrtc.isScreenSharing ? <Icons.ScreenOff /> : <Icons.ScreenOn />}
            label={webrtc.isScreenSharing ? t('pages.meetingRoom.stopShare') : t('pages.meetingRoom.shareScreen')}
          />
          {/* Raise hand */}
          <CtrlBtn
            active={!webrtc.handRaised} offStyle="yellow"
            onClick={webrtc.toggleRaiseHand}
            icon={<Icons.Hand />}
            label={webrtc.handRaised ? t('pages.meetingRoom.lowerHand') : t('pages.meetingRoom.raiseHand')}
          />
          {/* Recording (host only) */}
          {isHost && (
            <CtrlBtn
              active={!recording.isRecording} offStyle="red"
              onClick={recording.isRecording ? handleStopRecording : handleStartRecording}
              icon={recording.isRecording ? <Icons.RecStop /> : <Icons.RecStart />}
              label={recording.isRecording ? t('pages.meetingRoom.stopRec') : t('pages.meetingRoom.record')}
              pulse={recording.isRecording}
            />
          )}
          {/* Whiteboard (host only) */}
          {isHost && (
            <CtrlBtn
              className="ctrl-secondary"
              active={!whiteboardActive} offStyle="blue"
              onClick={handleToggleWhiteboard}
              icon={whiteboardActive ? <Icons.WhiteboardOff /> : <Icons.Whiteboard />}
              label={whiteboardActive ? t('pages.meetingRoom.closeBoard') : t('pages.meetingRoom.whiteboard')}
            />
          )}
          {/* Effects */}
          <CtrlBtn
            className="ctrl-secondary"
            active={!webrtc.isEffectActive} offStyle="blue"
            onClick={() => setShowEffectsPanel(true)}
            icon={<Icons.Effects />}
            label={t('pages.meetingRoom.effects')}
          />
          {/* Chat */}
          <CtrlBtn
            active={true}
            onClick={() => { setSidebarTab('chat'); setShowSidebar(true); setUnreadCount(0); }}
            icon={
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <Icons.Chat />
                {unreadCount > 0 && <span className="chat-unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </span>
            }
            label={t('common.chat')}
          />
          {/* More: mobile only — secondary controls in a bottom sheet */}
          {isMobileDevice && (
            <CtrlBtn
              active={showMoreMenu}
              offStyle="blue"
              onClick={() => setShowMoreMenu(true)}
              icon={<Icons.More />}
              label="More"
            />
          )}
        </div>

        <div className="controls-divider" />

        <CtrlBtn
          active={false} offStyle="red" always
          onClick={promptLeave}
          icon={<Icons.Leave />}
          label={t('common.leave')}
        />
      </div>

      {/* ── More menu bottom sheet (mobile) ── */}
      {showMoreMenu && (
        <div
          className="more-menu-backdrop"
          onClick={() => { setShowMoreMenu(false); resetControlsTimer(); }}
        >
          <div className="more-menu-sheet" onClick={e => e.stopPropagation()}>
            <div className="more-menu-handle" />
            <div className="more-menu-title">More options</div>
            <div className="more-menu-grid">
              {/* Screen share */}
              <CtrlBtn
                active={!webrtc.isScreenSharing} offStyle="blue"
                onClick={async () => {
                  if (webrtc.isScreenSharing) {
                    await webrtc.stopScreenShare();
                    socketRef.current?.emit('signal:screen-share', { meetingId, active: false });
                    setScreenSharer(null);
                  } else {
                    try {
                      await webrtc.startScreenShare(handleScreenShareEnded);
                      socketRef.current?.emit('signal:screen-share', { meetingId, active: true });
                      setScreenSharer('local');
                    } catch (err) {
                      if (err.name !== 'NotAllowedError') console.error('Screen share error:', err);
                    }
                  }
                  setShowMoreMenu(false); resetControlsTimer();
                }}
                icon={webrtc.isScreenSharing ? <Icons.ScreenOff /> : <Icons.ScreenOn />}
                label={webrtc.isScreenSharing ? t('pages.meetingRoom.stopShare') : t('pages.meetingRoom.shareScreen')}
              />
              {/* Whiteboard (host only) */}
              {isHost && (
                <CtrlBtn
                  active={!whiteboardActive} offStyle="blue"
                  onClick={() => { handleToggleWhiteboard(); setShowMoreMenu(false); resetControlsTimer(); }}
                  icon={whiteboardActive ? <Icons.WhiteboardOff /> : <Icons.Whiteboard />}
                  label={whiteboardActive ? t('pages.meetingRoom.closeBoard') : t('pages.meetingRoom.whiteboard')}
                />
              )}
              {/* Effects */}
              <CtrlBtn
                active={!webrtc.isEffectActive} offStyle="blue"
                onClick={() => { setShowEffectsPanel(true); setShowMoreMenu(false); resetControlsTimer(); }}
                icon={<Icons.Effects />}
                label={t('pages.meetingRoom.effects')}
              />
              {/* Participants */}
              <CtrlBtn
                active={true}
                onClick={() => { setSidebarTab('participants'); setShowSidebar(true); setShowMoreMenu(false); resetControlsTimer(); }}
                icon={<Icons.People />}
                label={t('common.people')}
              />
              {/* Flip Camera */}
              {webrtc.isCameraOn && (
                <CtrlBtn
                  active={!isFlippingCam}
                  onClick={() => { handleFlipCamera(); setShowMoreMenu(false); resetControlsTimer(); }}
                  disabled={isFlippingCam}
                  icon={isFlippingCam
                    ? <span style={{ fontSize: 18, animation: 'spin 0.5s linear infinite', display: 'inline-block' }}>↻</span>
                    : <Icons.CamFlip />}
                  label={isFlippingCam ? 'Switch…' : '↺ Switch'}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes blink     { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes pulse-ring{ 0%{transform:scale(1);opacity:.8} 100%{transform:scale(1.4);opacity:0} }
        @keyframes spin      { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }

        /* ── Mobile controls ────────────────────────────────────── */
        .controls-bar { transition: transform 0.35s cubic-bezier(0.4,0,0.2,1); }
        .ctrl-bar-hidden { transform: translateY(115%); }

        @media (max-width: 768px) {
          /* Hide secondary controls — they live in the More sheet */
          .ctrl-secondary { display: none !important; }

          /* Glass bottom bar */
          .controls-bar {
            background: rgba(12,14,26,0.78);
            backdrop-filter: blur(16px) saturate(1.7);
            -webkit-backdrop-filter: blur(16px) saturate(1.7);
            border-top: 1px solid rgba(255,255,255,0.07);
            padding: 8px 6px 14px;
          }
          /* Larger tap targets on mobile */
          .controls-bar button {
            min-width: 52px;
            min-height: 52px;
            border-radius: 14px;
          }
        }

        /* ── More menu bottom sheet ────────────────────────────── */
        .more-menu-backdrop {
          position: fixed; inset: 0; z-index: 3000;
          background: rgba(0,0,0,0.55);
          backdrop-filter: blur(3px);
          display: flex; align-items: flex-end; justify-content: center;
          animation: mm-fade 0.2s ease;
        }
        .more-menu-sheet {
          width: 100%; max-width: 520px;
          background: var(--surface, #16192a);
          border: 1px solid rgba(255,255,255,0.1);
          border-bottom: none;
          border-radius: 22px 22px 0 0;
          padding: 12px 20px calc(env(safe-area-inset-bottom, 0px) + 28px);
          animation: mm-slide 0.28s cubic-bezier(0.4,0,0.2,1);
        }
        .more-menu-handle {
          width: 36px; height: 4px;
          background: rgba(255,255,255,0.18);
          border-radius: 2px; margin: 0 auto 14px;
        }
        .more-menu-title {
          font-size: 11px; font-weight: 700;
          color: var(--text-muted, #8b99bd);
          text-align: center; letter-spacing: 1px;
          text-transform: uppercase;
          margin-bottom: 16px;
        }
        .more-menu-grid {
          display: flex; flex-wrap: wrap;
          gap: 10px; justify-content: center;
        }
        .more-menu-grid > button { flex: 0 0 auto; min-width: 72px; }
        @keyframes mm-fade  { from{opacity:0}      to{opacity:1} }
        @keyframes mm-slide { from{transform:translateY(100%)} to{transform:translateY(0)} }
      `}</style>

      <BackgroundPanel
        open={showEffectsPanel}
        onClose={() => setShowEffectsPanel(false)}
        sourceStream={webrtc.rawVideoStream || webrtc.localStreamRef.current}
        cameraOn={webrtc.isCameraOn}
        onTrackChange={handleEffectTrackChange}
      />

      {/* ── Leave-meeting confirmation dialog ── */}
      {showLeaveDialog && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 16, padding: '32px 28px', width: '100%', maxWidth: 360,
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, lineHeight: 1 }}>🚪</div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {t('pages.meetingRoom.leaveTitle')}
            </h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
              {t('pages.meetingRoom.leaveConfirm')}
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 8, width: '100%' }}>
              <button
                onClick={() => setShowLeaveDialog(false)}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer',
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  color: 'var(--text)', fontWeight: 600, fontSize: 14,
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleLeave}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer',
                  background: 'rgba(239,68,68,0.9)', border: '1px solid rgba(239,68,68,0.5)',
                  color: '#fff', fontWeight: 700, fontSize: 14,
                }}
              >
                {t('common.leave')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Control Button ────────────────────────────────────────────────
function CtrlBtn({ icon, label, onClick, active, offStyle, pulse, disabled, className }) {
  const colors = {
    red:    { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.4)',  color: '#f87171' },
    blue:   { bg: 'rgba(99,102,241,0.2)',  border: 'rgba(99,102,241,0.5)', color: '#a5b4fc' },
    yellow: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)', color: '#fcd34d' },
  };
  const c = !active && offStyle ? colors[offStyle] : null;
  return (
    <button
      onClick={onClick}
      title={label}
      disabled={disabled}
      className={className || ''}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        background: c ? c.bg : 'var(--surface2)',
        border: `1px solid ${c ? c.border : 'var(--border)'}`,
        color: c ? c.color : 'var(--text)',
        borderRadius: 12, padding: '10px 14px', cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all .15s', minWidth: 60, position: 'relative',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {pulse && (
        <span style={{
          position: 'absolute', inset: 0, borderRadius: 12,
          border: '2px solid #ef4444',
          animation: 'pulse-ring 1.2s ease-out infinite',
          pointerEvents: 'none',
        }} />
      )}
      <span style={{ display: 'flex' }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

// ─── Shared hook for attaching stream to video element ────────────
function useVideoStream(activeRef, stream) {
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    if (!stream) {
      // Clear stale stream so the element doesn't show a frozen last frame
      if (el.srcObject) { el.srcObject = null; el.load(); }
      return;
    }
    if (el.srcObject !== stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]); // eslint-disable-line
}

// ─── Screen Share Tile ────────────────────────────────────────────
function ScreenTile({ tile }) {
  const { t } = useTranslation();
  const screenRef = useRef(null);

  useEffect(() => {
    if (!screenRef.current) return;
    const stream = tile.screenStream || tile.stream;
    if (stream && screenRef.current.srcObject !== stream) {
      screenRef.current.srcObject = stream;
      screenRef.current.play().catch(() => {});
    }
  }, [tile.screenStream, tile.stream]);

  useEffect(() => {
    const el = screenRef.current;
    return () => { if (el) { el.srcObject = null; el.load(); } };
  }, []);

  const stream = tile.screenStream || tile.stream;
  return (
    <div className="screen-tile">
      <video ref={screenRef} autoPlay playsInline muted={tile.isLocal}
        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: stream ? 'block' : 'none' }}
      />
      {!stream && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>🖥️</div>
            <div style={{ fontSize: 13, marginTop: 8 }}>{t('pages.meetingRoom.waitingForScreen')}</div>
          </div>
        </div>
      )}
      <div className="tile-footer" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.9))' }}>
        <span className="tile-name">🖥️ {t('pages.meetingRoom.presenting', { name: tile.name })}</span>
      </div>
    </div>
  );
}

// ─── Video Tile ────────────────────────────────────────────────────
function VideoTile({ tile, videoRef, compact, videoTransform, onVideoMetadata }) {
  const { t } = useTranslation();
  const ownRef    = useRef(null);
  const activeRef = videoRef || ownRef;
  useVideoStream(activeRef, tile.stream);

  return (
    <div className={compact ? 'video-tile compact' : 'video-tile'}>
      {/* Video is always mounted so srcObject assignment is always valid.
          Visibility is controlled by opacity/visibility, not display:none. */}
      <video ref={activeRef} autoPlay playsInline muted={tile.isLocal}
        onLoadedMetadata={onVideoMetadata}
        style={{
          width: '100%', height: '100%', objectFit: 'cover',
          opacity: tile.camOn && tile.stream ? 1 : 0,
          position: tile.camOn && tile.stream ? 'relative' : 'absolute',
          transform: videoTransform || 'none',
          transition: 'transform 0.3s ease',
        }}
      />
      {(!tile.camOn || !tile.stream) && (
        <div className="cam-off-overlay">
          <div className="big-avatar">{tile.avatar ? <img src={tile.avatar} alt={tile.name || 'User'} className="avatar-img" /> : tile.name?.[0]?.toUpperCase()}</div>
        </div>
      )}
      <div className="tile-footer">
        <div className="tile-indicators">
          {!tile.micOn && <span className="tile-badge muted" title={t('pages.meetingRoom.mutedStatus')}><Icons.MicOff /></span>}
          {tile.handRaised && <span className="tile-badge hand">✋</span>}
        </div>
        <span className="tile-name">
          {tile.name}
          {tile.isHost && <span className="host-badge">{t('common.host')}</span>}
        </span>
      </div>
    </div>
  );
}