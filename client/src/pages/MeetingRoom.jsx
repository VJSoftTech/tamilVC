import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth }      from '../context/AuthContext.jsx';
import { useWebRTC }    from '../hooks/useWebRTC.js';
import { useRecording } from '../hooks/useRecording.js';
import { meetingAPI, messageAPI } from '../services/api.js';
import { getSocket, disconnectSocket } from '../services/socket.js';
import Whiteboard from '../components/Whiteboard.jsx';
import BackgroundPanel from '../components/BackgroundEffects/BackgroundPanel.jsx';

// ─── SVG Icon components ───────────────────────────────────────────
const Icon = ({ d, size = 20, fill = 'none', stroke = 'currentColor', strokeWidth = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const Icons = {
  MicOn:       () => <Icon d={['M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z','M19 10v2a7 7 0 0 1-14 0v-2','M12 19v4','M8 23h8']} />,
  MicOff:      () => <Icon d={['M1 1l22 22','M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6','M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23','M12 19v4','M8 23h8']} />,
  CamOn:       () => <Icon d={['M23 7l-7 5 7 5V7z','M1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z']} />,
  CamOff:      () => <Icon d={['M1 1l22 22','M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06A4 4 0 0 1 8.56 15.17']} />,
  ScreenOn:    () => <Icon d={['M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3','M8 21h8','M12 17v4','M17 1l4 4-4 4','M21 5H9']} />,
  ScreenOff:   () => <Icon d={['M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3','M8 21h8','M12 17v4','M1 1l22 22']} />,
  Whiteboard:  () => <Icon d={['M2 3h20v14H2z','M8 21h8','M12 17v4']} />,
  WhiteboardOff:()=> <Icon d={['M2 3h20v14H2z','M8 21h8','M12 17v4','M1 1l22 22']} />,
  Effects:     () => <Icon d={['M12 3l1.9 4.8L19 10l-4.2 3.1L16 18l-4-2.7L8 18l1.2-4.9L5 10l5.1-2.2L12 3z']} />,
  Pencil:      () => <Icon d={['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7','M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z']} />,
  Hand:        () => <Icon d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a6 6 0 0 0 12 0v-3a2 2 0 0 0-4 0" />,
  RecStart:    () => <Icon d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 0" fill="currentColor" stroke="none" />,
  RecStop:     () => <Icon d="M6 6h12v12H6z" fill="currentColor" stroke="none" />,
  Chat:        () => <Icon d={['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z']} />,
  People:      () => <Icon d={['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2','M23 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z']} />,
  Leave:       () => <Icon d={['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4','M16 17l5-5-5-5','M21 12H9']} />,
  EndCall:     () => <Icon d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-3.41m-3.5-6.9A19.79 19.79 0 0 1 4.42 4 2 2 0 0 1 6.61 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L10.68 9.78" strokeWidth={2} />,
  ChevronLeft: () => <Icon d="M15 18l-6-6 6-6" />,
  ChevronRight:() => <Icon d="M9 18l6-6-6-6" />,
  Send:        () => <Icon d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />,
  Copy:        () => <Icon d={['M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z','M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 0 2 2v1']} />,
};

// ─── Meeting Room Component ────────────────────────────────────────
export default function MeetingRoom() {
  const { meetingId } = useParams();
  const { user }      = useAuth();
  const navigate      = useNavigate();
  const { t }         = useTranslation();

  const socketRef      = useRef(null);
  const webrtcRef      = useRef(null);
  const socketSetupRef = useRef(false);
  const localVideoRef  = useRef(null);
  const chatBottomRef  = useRef(null);

  const whiteboardRef       = useRef(null);
  const whiteboardActiveRef  = useRef(false);

  const [meetingInfo,      setMeetingInfo]      = useState(null);
  const [isHost,           setIsHost]           = useState(false);
  const [hostId,           setHostId]           = useState(null);
  const [screenSharer,     setScreenSharer]     = useState(null);
  const [whiteboardActive, setWhiteboardActive] = useState(false);
  whiteboardActiveRef.current = whiteboardActive;
  const [waiting,          setWaiting]          = useState(false);
  const [participants, setParticipants] = useState([]);
  const [error,        setError]        = useState('');
  const [loadingJoin,  setLoadingJoin]  = useState(true);
  const [sidebarTab,   setSidebarTab]   = useState('chat');
  const [showSidebar,  setShowSidebar]  = useState(true);
  const [messages,     setMessages]     = useState([]);
  const [chatInput,    setChatInput]    = useState('');
  const [copied,       setCopied]       = useState(false);
  const [showEffectsPanel, setShowEffectsPanel] = useState(false);

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

  // Sync remote streams into participants — runs whenever streams OR participants change
  useEffect(() => {
    setParticipants(prev => prev.map(p => {
      const stream = webrtc.remoteStreams[p.userId];
      return stream ? { ...p, stream } : p;
    }));
  }, [webrtc.remoteStreams]);

  // Broadcast our actual cam/mic state whenever a new peer's stream appears.
  // This ensures peers who joined with cam off are shown correctly (avatar not blank)
  // and that existing participants always know our real media state.
  const prevStreamKeysRef = useRef(new Set());
  useEffect(() => {
    const currentKeys = new Set(Object.keys(webrtc.remoteStreams));
    const hasNew = [...currentKeys].some(k => !prevStreamKeysRef.current.has(k));
    if (hasNew) {
      prevStreamKeysRef.current = currentKeys;
      const camOn = webrtc.isCameraOn;
      const micOn = webrtc.isMicOn;
      setTimeout(() => {
        if (socketRef.current?.connected) {
          socketRef.current.emit('signal:media-status', { meetingId, camOn, micOn });
        }
      }, 400);
    }
  }, [webrtc.remoteStreams]); // eslint-disable-line

  // Extra sync: when a new participant is added, check if we already have their stream
  const syncStreams = useCallback(() => {
    setParticipants(prev => prev.map(p => {
      const stream = webrtcRef.current?.remoteStreams?.[p.userId];
      return (stream && !p.stream) ? { ...p, stream } : p;
    }));
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Socket setup ──────────────────────────────────────────────────
  const setupSocket = useCallback((token) => {
    if (socketSetupRef.current) return;
    socketSetupRef.current = true;

    disconnectSocket();
    const socket = getSocket(token);
    socketRef.current = socket;

    // Tell server we're in this meeting
    socket.emit('join-meeting', meetingId);

    // ── Server sends us list of already-present members ──
    // We initiate calls TO them (we are the new joiner)
    socket.on('room-members', (members) => {
      members.forEach(({ userId, name, username, avatar }) => {
        const uid = String(userId);
        if (uid === String(user.id)) return;
        setParticipants(prev => {
          if (prev.find(p => p.userId === uid)) return prev;
          return [...prev, { userId: uid, name, username, avatar, stream: null, camOn: true, micOn: true, handRaised: false }];
        });
        // Small delay to let our socket listeners register first
        setTimeout(() => webrtcRef.current.initiateCall(uid), 300);
      });
      // Tell existing members we're ready to receive calls from them too
      setTimeout(() => socket.emit('signal:ready', { meetingId }), 400);
      // Also broadcast our current media status for reliable initial participant state.
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

    // ── An existing member sees us join and creates a call TO us ──
    socket.on('peer-ready', ({ userId, name, username, avatar }) => {
      const uid = String(userId);
      setParticipants(prev => {
        if (prev.find(p => p.userId === uid)) return prev;
        return [...prev, { userId: uid, name, username, avatar, stream: null, camOn: true, micOn: true, handRaised: false }];
      });
      webrtcRef.current.initiateCall(uid);
      // Push latest local media state to the room when a new peer arrives.
      setTimeout(() => {
        if (socket.connected) {
          socket.emit('signal:media-status', {
            meetingId,
            camOn: !!webrtcRef.current?.isCameraOn,
            micOn: !!webrtcRef.current?.isMicOn,
          });
        }
      }, 500);
      // Sync current whiteboard to the new participant if it's active
      if (whiteboardActiveRef.current && whiteboardRef.current) {
        const strokes = whiteboardRef.current.getStrokes();
        socket.emit('whiteboard:sync', { meetingId, to: uid, strokes });
      }
    });

    // Notification only — offer handling creates the participant entry
    socket.on('user-joined', ({ userId, name, username, avatar }) => {
      const uid = String(userId);
      if (uid === String(user.id)) return;
      // Don't add yet — wait for peer-ready or offer
    });

    socket.on('user-left', ({ userId }) => {
      const uid = String(userId);
      webrtcRef.current.removePeer(uid);
      setParticipants(prev => prev.filter(p => p.userId !== uid));
    });

    socket.on('offer', ({ from, name, avatar, offer }) => {
      const uid = String(from);
      setParticipants(prev => {
        if (prev.find(p => p.userId === uid)) return prev;
        return [...prev, { userId: uid, name, avatar, stream: null, camOn: true, micOn: true, handRaised: false }];
      });
      webrtcRef.current.handleOffer({ from: uid, offer });
      // After answer is sent and connection established, sync streams
      setTimeout(() => syncStreams(), 1000);
      setTimeout(() => syncStreams(), 3000);
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
      setWhiteboardActive(active);
    });

    // When we join late, the host may send us a canvas sync
    socket.on('whiteboard:sync', ({ strokes }) => {
      whiteboardRef.current?.applyStrokes(strokes);
    });

    socket.on('raise-hand', ({ userId, raised }) => {
      setParticipants(prev => prev.map(p => String(p.userId) === String(userId) ? { ...p, handRaised: raised } : p));
    });

    socket.on('chat-message', (msg) => {
      setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
    });

    socket.on('meeting-ended', () => {
      alert(t('pages.meetingRoom.hostEnded'));
      doCleanup();
      navigate('/dashboard');
    });

    // Re-connect: re-join the meeting room on socket reconnect
    socket.on('reconnect', () => {
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
      await webrtc.startLocalStream(prejoin.camId, prejoin.micId, prejoin.camOn ?? true, prejoin.micOn ?? true)
        .catch(err => console.warn('Media error:', err));
      messageAPI.getAll(meetingId).then(r => setMessages(r.data)).catch(() => {});
      setupSocket(localStorage.getItem('token'));
    };

    tryJoin();
    return () => { cancelled = true; if (pollInterval) clearInterval(pollInterval); };
  }, [meetingId]); // eslint-disable-line

  // ── Controls ───────────────────────────────────────────────────────
  const releaseAndLeave = (dest) => {
    doCleanup();
    navigate(dest);
  };

  const handleLeave = async () => {
    socketRef.current?.emit('leave-meeting', meetingId);
    releaseAndLeave('/dashboard');
    await meetingAPI.leave(meetingId).catch(() => {});
  };

  // Called when screen sharing stops — either via the controls button or the
  // browser's native "Stop sharing" button. Clears local state and notifies peers.
  const handleScreenShareEnded = useCallback(() => {
    socketRef.current?.emit('signal:screen-share', { meetingId, active: false });
    setScreenSharer(null);
  }, [meetingId]);

  const handleToggleWhiteboard = useCallback(() => {
    const next = !whiteboardActive;
    setWhiteboardActive(next);
    socketRef.current?.emit('whiteboard:active', { meetingId, active: next });
    if (!next) {
      // Clear canvas for everyone when host closes whiteboard
      socketRef.current?.emit('whiteboard:clear', { meetingId });
    }
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
    await recording.startRecording(streams);
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
    setMessages(prev => [...prev, { id: tempId, user: { id: user.id, name: user.name }, message: msg, created_at: new Date().toISOString(), _own: true }]);
    const res = await messageAPI.send(meetingId, msg);
    setMessages(prev => prev.map(m => m.id === tempId ? { ...res.data, _own: true } : m));
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.origin + '/meet/' + meetingId);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  // ── Layout ─────────────────────────────────────────────────────────
  const localUserId = String(user?.id || '');
  const allTiles = [
    { userId: 'local', name: (user?.name || '') + ' (You)', isLocal: true,
      isHost: isHost, camOn: webrtc.isCameraOn, micOn: webrtc.isMicOn,
      handRaised: webrtc.handRaised, stream: webrtc.localStream, avatar: user?.avatar },
    ...participants.map(p => ({ ...p, isLocal: false, isHost: String(p.userId) === hostId })),
  ];

  // Screen share layout
  const sharerTile = (() => {
    if (!screenSharer) return null;
    if (screenSharer === 'local') {
      return { ...allTiles[0], screenStream: webrtc.screenStreamRef?.current };
    }
    const p = allTiles.find(t => t.userId === screenSharer);
    return p || null;
  })();
  const isScreenShareActive  = !!sharerTile;
  const isSpotlightMode      = isScreenShareActive || whiteboardActive;

  const gridClass = allTiles.length === 1 ? 'count-1' : allTiles.length === 2 ? 'count-2' : allTiles.length <= 4 ? 'count-4' : 'count-many';

  if (loadingJoin) return (
    <div className="waiting-room">
      <div className="waiting-card">
        <div className="spinner" style={{ margin: '0 auto 16px' }} />
        <h3>{t('pages.meetingRoom.connecting')}</h3>
      </div>
    </div>
  );
  if (error) return (
    <div className="waiting-room">
      <div className="waiting-card">
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h3>{error}</h3>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/dashboard')}>← {t('nav.dashboard')}</button>
      </div>
    </div>
  );
  if (waiting) return (
    <div className="waiting-room">
      <div className="waiting-card">
        <div className="spinner" style={{ margin: '0 auto 16px' }} />
        <h3>{t('pages.meetingRoom.waitingForHost')}</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: 8, fontSize: 13 }}>{t('pages.meetingRoom.autoAdmit')}</p>
        <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={handleLeave}>{t('common.cancel')}</button>
      </div>
    </div>
  );

  return (
    <div className="meeting-room">

      {/* ── Header ── */}
      <div className="room-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{meetingInfo?.title || t('pages.newMeeting.meetingFallbackTitle')}</span>
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
            /* ── Spotlight layout: screen share OR whiteboard + participant strip ── */
            <div className="spotlight-layout">
              <div className="spotlight-main">
                {whiteboardActive
                  ? <Whiteboard ref={whiteboardRef} isHost={isHost} socket={socketRef.current} meetingId={meetingId} />
                  : <ScreenTile tile={sharerTile} />
                }
              </div>
              <div className="spotlight-strip">
                {allTiles.map(tile => (
                  <VideoTile
                    key={tile.userId + '-strip'}
                    tile={tile}
                    videoRef={tile.isLocal ? localVideoRef : null}
                    compact
                  />
                ))}
              </div>
            </div>
          ) : (
            /* ── Normal grid layout ── */
            <div className={`video-grid ${gridClass}`}>
              {allTiles.map(tile => (
                <VideoTile key={tile.userId} tile={tile} videoRef={tile.isLocal ? localVideoRef : null} />
              ))}
            </div>
          )}
        </div>

        {showSidebar && (
          <div className="room-sidebar">
            <div className="room-sidebar-tabs">
              <button className={sidebarTab === 'chat' ? 'active' : ''} onClick={() => setSidebarTab('chat')}>
                <Icons.Chat /> {t('common.chat')}
              </button>
              <button className={sidebarTab === 'participants' ? 'active' : ''} onClick={() => setSidebarTab('participants')}>
                <Icons.People /> {t('common.people')} <span className="tab-badge">{allTiles.length}</span>
              </button>
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
                    {messages.map((m, i) => (
                      <div key={m.id || i} className={`chat-msg ${m._own || m.user?.id === user?.id ? 'own' : ''}`}>
                        {!(m._own || m.user?.id === user?.id) && (
                          <span className="msg-author">{m.user?.name}</span>
                        )}
                        <div className="msg-body">{m.message}</div>
                        <div className="msg-time">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    ))}
                    <div ref={chatBottomRef} />
                  </div>
                  <form className="chat-input-row" onSubmit={sendChat}>
                    <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder={t('pages.meetingRoom.typeMessage')} autoComplete="off" />
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
                        <span className={`p-badge ${p.micOn ? 'on' : 'off'}`} title={p.micOn ? t('pages.meetingRoom.micOnStatus') : t('pages.meetingRoom.mutedStatus')}>
                          {p.micOn ? <Icons.MicOn /> : <Icons.MicOff />}
                        </span>
                        <span className={`p-badge ${p.camOn ? 'on' : 'off'}`} title={p.camOn ? t('pages.meetingRoom.cameraOnStatus') : t('pages.meetingRoom.cameraOffStatus')}>
                          {p.camOn ? <Icons.CamOn /> : <Icons.CamOff />}
                        </span>
                        {p.handRaised && <span className="p-badge raised" title={t('pages.meetingRoom.handRaised')}>✋</span>}
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
      <div className="controls-bar">
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
          {/* Screen share */}
          <CtrlBtn
            active={!webrtc.isScreenSharing} offStyle="blue"
            onClick={webrtc.isScreenSharing
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
                  // User cancelled screen picker or permission denied
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
              active={!whiteboardActive} offStyle="blue"
              onClick={handleToggleWhiteboard}
              icon={whiteboardActive ? <Icons.WhiteboardOff /> : <Icons.Whiteboard />}
              label={whiteboardActive ? t('pages.meetingRoom.closeBoard') : t('pages.meetingRoom.whiteboard')}
            />
          )}
          {/* Backgrounds and effects */}
          <CtrlBtn
            active={!webrtc.isEffectActive}
            offStyle="blue"
            onClick={() => setShowEffectsPanel(true)}
            icon={<Icons.Effects />}
            label={t('pages.meetingRoom.effects')}
          />
          {/* Chat */}
          <CtrlBtn
            active={true}
            onClick={() => { setSidebarTab('chat'); setShowSidebar(true); }}
            icon={<Icons.Chat />}
            label={t('common.chat')}
          />
        </div>

        <div className="controls-divider" />

        {/* Leave */}
        <CtrlBtn
          active={false} offStyle="red" always
          onClick={handleLeave}
          icon={<Icons.Leave />}
          label={t('common.leave')}
        />
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes pulse-ring { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(1.4);opacity:0} }
      `}</style>

      <BackgroundPanel
        open={showEffectsPanel}
        onClose={() => setShowEffectsPanel(false)}
        sourceStream={webrtc.rawVideoStream || webrtc.localStreamRef.current}
        cameraOn={webrtc.isCameraOn}
        onTrackChange={handleEffectTrackChange}
      />
    </div>
  );
}

// ─── Control Button ────────────────────────────────────────────────
function CtrlBtn({ icon, label, onClick, active, offStyle, pulse }) {
  const colors = {
    red:    { bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.4)',   color: '#f87171' },
    blue:   { bg: 'rgba(99,102,241,0.2)',   border: 'rgba(99,102,241,0.5)',  color: '#a5b4fc' },
    yellow: { bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.4)',  color: '#fcd34d' },
  };
  const c = !active && offStyle ? colors[offStyle] : null;
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        background: c ? c.bg : 'var(--surface2)',
        border: `1px solid ${c ? c.border : 'var(--border)'}`,
        color: c ? c.color : 'var(--text)',
        borderRadius: 12, padding: '10px 14px', cursor: 'pointer',
        transition: 'all .15s', minWidth: 60, position: 'relative',
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
    if (!activeRef.current || !stream) return;
    if (activeRef.current.srcObject !== stream) {
      activeRef.current.srcObject = stream;
    }
    activeRef.current.play().catch(() => {});
  }, [stream]); // eslint-disable-line
}

// ─── Screen Share Tile ────────────────────────────────────────────
// Local sharer: show screenStreamRef directly (not camera stream)
// Remote viewer: the screen track replaced their video sender, so it
//                arrives on the existing remoteStream — just show it
//                with objectFit:contain so nothing gets cropped
function ScreenTile({ tile }) {
  const { t } = useTranslation();
  const screenRef = useRef(null);

  useEffect(() => {
    if (!screenRef.current) return;
    // Local: use actual screen capture stream
    // Remote: use their stream (which now has screen track via replaceTrack)
    const stream = tile.screenStream || tile.stream;
    if (stream && screenRef.current.srcObject !== stream) {
      screenRef.current.srcObject = stream;
      screenRef.current.play().catch(() => {});
    }
  }, [tile.screenStream, tile.stream]);

  // Clear srcObject on unmount so the frozen last frame is never left on screen
  useEffect(() => {
    const el = screenRef.current;
    return () => {
      if (el) {
        el.srcObject = null;
        el.load();
      }
    };
  }, []);

  const stream = tile.screenStream || tile.stream;

  return (
    <div className="screen-tile">
      <video
        ref={screenRef}
        autoPlay playsInline muted={tile.isLocal}
        style={{
          width: '100%', height: '100%',
          objectFit: 'contain',   // NEVER crop — show full screen
          background: '#000',
          display: stream ? 'block' : 'none',
        }}
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
function VideoTile({ tile, videoRef, compact }) {
  const { t } = useTranslation();
  const ownRef    = useRef(null);
  const activeRef = videoRef || ownRef;
  useVideoStream(activeRef, tile.stream);

  return (
    <div className={compact ? 'video-tile compact' : 'video-tile'}>
      <video
        ref={activeRef} autoPlay playsInline muted={tile.isLocal}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: tile.camOn && tile.stream ? 'block' : 'none' }}
      />
      {(!tile.camOn || !tile.stream) && (
        <div className="cam-off-overlay">
          <div className={compact ? 'big-avatar' : 'big-avatar'}>{tile.avatar ? <img src={tile.avatar} alt={tile.name || 'User'} className="avatar-img" /> : tile.name?.[0]?.toUpperCase()}</div>
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