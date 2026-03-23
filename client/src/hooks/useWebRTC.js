import { useRef, useState, useCallback } from 'react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80',          username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443',         username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
  iceCandidatePoolSize: 10,
};

const VIDEO_CONSTRAINTS = {
  width: { ideal: 640, max: 1280 }, height: { ideal: 360, max: 720 },
  frameRate: { ideal: 24, max: 30 }, facingMode: 'user',
};

const applyBandwidthConstraints = async (pc) => {
  try {
    for (const sender of pc.getSenders()) {
      if (!sender.track) continue;
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      if (sender.track.kind === 'video') {
        params.encodings[0].maxBitrate   = 500_000;
        params.encodings[0].maxFramerate = 24;
      } else if (sender.track.kind === 'audio') {
        params.encodings[0].maxBitrate = 48_000;
      }
      await sender.setParameters(params).catch(() => {});
    }
  } catch {}
};

function preferVP8(sdp) {
  try {
    const lines  = sdp.split('\r\n');
    const vLine  = lines.findIndex(l => l.startsWith('m=video'));
    if (vLine === -1) return sdp;
    const vp8    = lines.find(l => /a=rtpmap:\d+ VP8/.test(l));
    if (!vp8) return sdp;
    const pt     = vp8.match(/a=rtpmap:(\d+) VP8/)[1];
    const mParts = lines[vLine].split(' ');
    const pts    = mParts.slice(3).filter(p => p !== pt);
    lines[vLine] = [...mParts.slice(0, 3), pt, ...pts].join(' ');
    return lines.join('\r\n');
  } catch { return sdp; }
}

export const useWebRTC = (meetingId, socketRef) => {
  const localStreamRef     = useRef(null);
  const screenStreamRef    = useRef(null);
  const peerConnectionsRef = useRef({});
  const rawVideoTrackRef   = useRef(null);
  const effectTrackRef     = useRef(null);
  const activeVideoTrackRef = useRef(null);

  const [localStream,     setLocalStream]     = useState(null);
  const [rawVideoStream,  setRawVideoStream]  = useState(null);
  const [remoteStreams,   setRemoteStreams]    = useState({});
  const [isCameraOn,      setIsCameraOn]      = useState(true);
  const [isMicOn,         setIsMicOn]         = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [handRaised,      setHandRaised]      = useState(false);
  const [isEffectActive,  setIsEffectActive]  = useState(false);

  const emitSignal = useCallback((event, data) => {
    socketRef?.current?.connected && socketRef.current.emit(event, { meetingId, ...data });
  }, [meetingId, socketRef]);

  // ── replaceVideoTrack: replace on ALL peer connections + renegotiate ──
  // replaceTrack() alone does NOT push the new track to remote peers;
  // we must send a fresh offer so remote peers receive the updated stream.
  const replaceVideoTrack = useCallback(async (newTrack) => {
    const entries = Object.entries(peerConnectionsRef.current);
    await Promise.all(entries.map(async ([remoteUserId, pc]) => {
      try {
        let needsRenegotiation = false;
        // Find video sender — could have null track if joined with cam off
        let sender = pc.getSenders().find(s => s.track?.kind === 'video');

        if (!sender) {
          // Check for null-track video transceiver
          sender = pc.getSenders().find(s => {
            const t = pc.getTransceivers().find(tr => tr.sender === s);
            return t && t.sender.track === null;
          });
        }

        if (sender) {
          await sender.replaceTrack(newTrack);
        } else if (newTrack && localStreamRef.current) {
          // No sender at all — add the track (requires renegotiation)
          pc.addTrack(newTrack, localStreamRef.current);
          needsRenegotiation = true;
        }

        // Replace track is normally enough. Renegotiate only when a sender was missing.
        if (needsRenegotiation) {
          const offer = await pc.createOffer();
          offer.sdp = preferVP8(offer.sdp);
          await pc.setLocalDescription(offer);
          socketRef?.current?.connected && socketRef.current.emit('signal:offer', {
            meetingId,
            to: remoteUserId,
            offer: { type: offer.type, sdp: offer.sdp },
          });
        }
      } catch (err) {
        console.warn('replaceTrack/renegotiate failed for peer:', err);
      }
    }));
  }, [meetingId, socketRef]);

  // ── startLocalStream ──────────────────────────────────────────────
  const startLocalStream = useCallback(async (camId, micId, camOn = true, micOn = true) => {
    const audioC = micId
      ? { deviceId: { exact: micId }, echoCancellation: true, noiseSuppression: true }
      : { echoCancellation: true, noiseSuppression: true };

    let stream;
    if (camOn) {
      const videoC = camId ? { ...VIDEO_CONSTRAINTS, deviceId: { exact: camId } } : VIDEO_CONSTRAINTS;
      stream = await navigator.mediaDevices.getUserMedia({ video: videoC, audio: audioC });
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioC });
    }

    stream.getAudioTracks().forEach(t => { t.enabled = micOn; });
    rawVideoTrackRef.current = stream.getVideoTracks()[0] || null;
    activeVideoTrackRef.current = rawVideoTrackRef.current;
    setRawVideoStream(rawVideoTrackRef.current ? new MediaStream([rawVideoTrackRef.current]) : null);
    if (effectTrackRef.current) {
      effectTrackRef.current.stop();
      effectTrackRef.current = null;
      setIsEffectActive(false);
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setIsCameraOn(camOn);
    setIsMicOn(micOn);
    return stream;
  }, []);

  // ── createPeerConnection ──────────────────────────────────────────
  const createPeerConnection = useCallback((remoteUserId) => {
    if (peerConnectionsRef.current[remoteUserId]) return peerConnectionsRef.current[remoteUserId];
    const pc = new RTCPeerConnection(ICE_SERVERS);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    }

    // Always ensure a video transceiver exists so replaceTrack works even with cam off
    const hasVideo = pc.getSenders().some(s => s.track?.kind === 'video') ||
                     pc.getTransceivers().some(t => t.sender.track === null && t.receiver.track?.kind === 'video');
    if (!hasVideo) {
      pc.addTransceiver('video', { direction: 'sendrecv' });
    }

    pc.ontrack = (e) => {
      const track = e.track;

      if (e.streams?.[0]) {
        // Normal case: track arrives with a stream association.
        // Also merge any stream-less tracks (e.g. video transceiver) that
        // arrived earlier before the real stream was known.
        const incomingStream = e.streams[0];
        const update = () => setRemoteStreams(prev => {
          const existing = prev[remoteUserId];
          let stream = incomingStream;
          if (existing && existing !== incomingStream) {
            // Carry over tracks collected before the stream-bearing track arrived
            const extras = existing.getTracks().filter(t => !incomingStream.getTrackById(t.id));
            if (extras.length > 0) {
              stream = new MediaStream([...incomingStream.getTracks(), ...extras]);
            }
          }
          return { ...prev, [remoteUserId]: stream };
        });
        update();
        setTimeout(update, 500);
        setTimeout(update, 1500);
      } else {
        // Stream-less track: video transceiver added when remote peer joined with cam off.
        // Add it to the peer's existing stream so the video element already has the
        // track when the sender later calls replaceTrack to turn their camera on.
        const update = () => setRemoteStreams(prev => {
          const existing = prev[remoteUserId];
          if (existing) {
            if (!existing.getTrackById(track.id)) {
              existing.addTrack(track);
              // New MediaStream reference forces React to re-render
              return { ...prev, [remoteUserId]: new MediaStream(existing.getTracks()) };
            }
            return prev; // track already present, no change
          }
          // No stream yet — create a temporary one with just this track
          return { ...prev, [remoteUserId]: new MediaStream([track]) };
        });
        update();
        setTimeout(update, 500);
        setTimeout(update, 1500);
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) emitSignal('signal:ice-candidate', { to: remoteUserId, candidate: e.candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') applyBandwidthConstraints(pc);
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        setRemoteStreams(prev => { const u = { ...prev }; delete u[remoteUserId]; return u; });
      }
    };

    peerConnectionsRef.current[remoteUserId] = pc;
    return pc;
  }, [emitSignal]);

  const initiateCall = useCallback(async (remoteUserId) => {
    const pc    = createPeerConnection(remoteUserId);
    const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
    offer.sdp   = preferVP8(offer.sdp);
    await pc.setLocalDescription(offer);
    emitSignal('signal:offer', { to: remoteUserId, offer: { type: offer.type, sdp: offer.sdp } });
  }, [createPeerConnection, emitSignal]);

  const handleOffer = useCallback(async ({ from, offer }) => {
    const pc     = createPeerConnection(from);
    try {
      if (pc.signalingState !== 'stable') {
        await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
    } catch (err) {
      console.warn('Failed to apply remote offer:', err);
      return;
    }
    const answer = await pc.createAnswer();
    answer.sdp   = preferVP8(answer.sdp);
    await pc.setLocalDescription(answer);
    emitSignal('signal:answer', { to: from, answer: { type: answer.type, sdp: answer.sdp } });
  }, [createPeerConnection, emitSignal]);

  const handleAnswer = useCallback(async ({ from, answer }) => {
    const pc = peerConnectionsRef.current[from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }, []);

  const handleIceCandidate = useCallback(async ({ from, candidate }) => {
    const pc = peerConnectionsRef.current[from];
    if (pc && candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    }
  }, []);

  // ── Camera toggle ─────────────────────────────────────────────────
  const toggleCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    if (isCameraOn) {
      if (rawVideoTrackRef.current) {
        try { rawVideoTrackRef.current.stop(); } catch {}
      }
      if (effectTrackRef.current) {
        effectTrackRef.current.stop();
        effectTrackRef.current = null;
      }
      stream.getVideoTracks().forEach(t => { t.stop(); stream.removeTrack(t); });
      rawVideoTrackRef.current = null;
      activeVideoTrackRef.current = null;
      setRawVideoStream(null);
      await replaceVideoTrack(null);
      setIsCameraOn(false);
      setIsEffectActive(false);
      setLocalStream(new MediaStream(stream.getTracks()));
      emitSignal('signal:media-status', { camOn: false, micOn: isMicOn });
    } else {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
        const newTrack  = camStream.getVideoTracks()[0];
        stream.addTrack(newTrack);
        rawVideoTrackRef.current = newTrack;
        activeVideoTrackRef.current = newTrack;
        setRawVideoStream(new MediaStream([newTrack]));
        await replaceVideoTrack(newTrack);
        const updated = new MediaStream([newTrack, ...stream.getAudioTracks()]);
        localStreamRef.current = updated;
        setLocalStream(updated);
        setIsCameraOn(true);
        emitSignal('signal:media-status', { camOn: true, micOn: isMicOn });
      } catch (err) { console.error('Camera re-enable failed:', err); }
    }
  }, [isCameraOn, isMicOn, emitSignal, replaceVideoTrack]);

  // ── Virtual background / effects track ──────────────────────────
  // `track` should come from canvas.captureStream().getVideoTracks()[0].
  // Pass null to restore the raw camera feed and disable effects.
  const setVideoEffectTrack = useCallback(async (track) => {
    const rawTrack = rawVideoTrackRef.current;
    if (!rawTrack || !localStreamRef.current) return;

    if (!track) {
      if (effectTrackRef.current) {
        effectTrackRef.current.stop();
      }
      effectTrackRef.current = null;
      activeVideoTrackRef.current = rawTrack;
      await replaceVideoTrack(rawTrack);
      setLocalStream(new MediaStream([rawTrack, ...localStreamRef.current.getAudioTracks()]));
      setIsEffectActive(false);
      return;
    }

    if (effectTrackRef.current && effectTrackRef.current !== track) {
      effectTrackRef.current.stop();
    }
    effectTrackRef.current = track;
    activeVideoTrackRef.current = track;
    await replaceVideoTrack(track);
    setLocalStream(new MediaStream([track, ...localStreamRef.current.getAudioTracks()]));
    setIsEffectActive(true);
  }, [replaceVideoTrack]);

  // ── Mic toggle ────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    if (!localStreamRef.current) return;
    const newVal = !isMicOn;
    localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = newVal; });
    setIsMicOn(newVal);
    emitSignal('signal:media-status', { camOn: isCameraOn, micOn: newVal });
  }, [isCameraOn, isMicOn, emitSignal]);

  // ── Screen share ──────────────────────────────────────────────────
  // Returns the screen stream so MeetingRoom can use it.
  // onEnded is an optional callback invoked when the browser's native
  // "Stop sharing" button ends the track — lets the caller clean up state.
  const startScreenShare = useCallback(async (onEnded) => {
    const screenMedia = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always', displaySurface: 'monitor', frameRate: { ideal: 15, max: 30 } },
      audio: false,
    });

    screenStreamRef.current = screenMedia;
    const screenTrack = screenMedia.getVideoTracks()[0];

    // Replace video track on ALL peer connections
    await replaceVideoTrack(screenTrack);

    setIsScreenSharing(true);

    // When user stops via browser's built-in stop button
    screenTrack.onended = async () => {
      await doStopScreenShare();
      onEnded?.();
    };

    return screenMedia;
  }, [replaceVideoTrack]); // eslint-disable-line

  const doStopScreenShare = useCallback(async () => {
    // Stop screen tracks
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;

    // Restore camera track (or null if cam is off)
    const camTrack = activeVideoTrackRef.current || rawVideoTrackRef.current || null;
    await replaceVideoTrack(camTrack);

    setIsScreenSharing(false);
  }, [replaceVideoTrack]);

  const stopScreenShare = useCallback(async () => {
    await doStopScreenShare();
  }, [doStopScreenShare]);

  const toggleRaiseHand = useCallback(() => {
    const newVal = !handRaised;
    setHandRaised(newVal);
    emitSignal('signal:raise-hand', { raised: newVal });
  }, [handRaised, emitSignal]);

  const removePeer = useCallback((remoteUserId) => {
    peerConnectionsRef.current[remoteUserId]?.close();
    delete peerConnectionsRef.current[remoteUserId];
    setRemoteStreams(prev => { const u = { ...prev }; delete u[remoteUserId]; return u; });
  }, []);

  const cleanup = useCallback(() => {
    Object.values(peerConnectionsRef.current).forEach(pc => {
      pc.getSenders().forEach(s => { try { s.track?.stop(); } catch {} });
      pc.close();
    });
    peerConnectionsRef.current = {};
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => { t.stop(); try { localStreamRef.current?.removeTrack(t); } catch {} });
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    if (effectTrackRef.current) {
      effectTrackRef.current.stop();
      effectTrackRef.current = null;
    }
    rawVideoTrackRef.current = null;
    activeVideoTrackRef.current = null;
    setRawVideoStream(null);
    setLocalStream(null);
    setRemoteStreams({});
    setIsCameraOn(true);
    setIsMicOn(true);
    setIsScreenSharing(false);
    setIsEffectActive(false);
  }, []);

  return {
    localStream, rawVideoStream, remoteStreams, isCameraOn, isMicOn, isScreenSharing, handRaised, isEffectActive,
    localStreamRef, screenStreamRef, startLocalStream, initiateCall, handleOffer,
    handleAnswer, handleIceCandidate, toggleCamera, toggleMic,
    startScreenShare, stopScreenShare, toggleRaiseHand, removePeer, cleanup, setVideoEffectTrack,
  };
};