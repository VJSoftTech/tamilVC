import { useRef, useState, useCallback } from 'react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

const getVideoConstraints = (camId, facingMode = 'user') => ({
  width: { ideal: 640, max: 1280 },
  height: { ideal: 360, max: 720 },
  frameRate: { ideal: 24, max: 30 },
  ...(camId ? { deviceId: { exact: camId } } : { facingMode }),
});

function preferVP8(sdp) {
  return sdp; // passthrough — customize if needed
}

function applyBandwidthConstraints(pc) {
  // optional — customize if needed
}

export const useWebRTC = (meetingId, socketRef) => {
  const localStreamRef      = useRef(null);
  const screenStreamRef     = useRef(null);
  const peerConnectionsRef  = useRef({});
  const pendingIceCandidatesRef = useRef({}); // buffer ICE candidates that arrive before remote desc is set
  const rawVideoTrackRef    = useRef(null);
  const effectTrackRef      = useRef(null);
  const activeVideoTrackRef = useRef(null);
  const currentFacingModeRef = useRef('user'); // ← track current facing mode

  const [localStream,    setLocalStream]    = useState(null);
  const [rawVideoStream, setRawVideoStream] = useState(null);
  const [remoteStreams,  setRemoteStreams]  = useState({});
  const [isCameraOn,     setIsCameraOn]     = useState(true);
  const [isMicOn,        setIsMicOn]        = useState(true);
  const [isScreenSharing,setIsScreenSharing]= useState(false);
  const [handRaised,     setHandRaised]     = useState(false);
  const [isEffectActive, setIsEffectActive] = useState(false);

  const emitSignal = useCallback((event, data) => {
    socketRef?.current?.connected && socketRef.current.emit(event, { meetingId, ...data });
  }, [meetingId, socketRef]);

  // ── replaceVideoTrack: swap track on ALL peer connections ─────────
  const replaceVideoTrack = useCallback(async (newTrack) => {
    const entries = Object.entries(peerConnectionsRef.current);
    await Promise.all(entries.map(async ([remoteUserId, pc]) => {
      try {
        let needsRenegotiation = false;
        let sender = pc.getSenders().find(s => s.track?.kind === 'video');

        if (!sender) {
          sender = pc.getSenders().find(s => {
            const t = pc.getTransceivers().find(tr => tr.sender === s);
            return t && t.sender.track === null;
          });
        }

        if (sender) {
          await sender.replaceTrack(newTrack);
        } else if (newTrack && localStreamRef.current) {
          pc.addTrack(newTrack, localStreamRef.current);
          needsRenegotiation = true;
        }

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
        console.warn('replaceTrack failed for peer:', remoteUserId, err);
      }
    }));
  }, [meetingId, socketRef]);

  // ── startLocalStream ──────────────────────────────────────────────
  // existingStream: optional MediaStream already acquired by PreJoin.
  // Passing it avoids stopping + re-acquiring the camera (prevents
  // NotReadableError on Windows/Chrome where the device needs time to release).
  const startLocalStream = useCallback(async (camId, micId, camOn = true, micOn = true, facingMode = 'user', existingStream = null) => {
    currentFacingModeRef.current = facingMode;

    const audioC = micId
      ? { deviceId: { exact: micId }, echoCancellation: true, noiseSuppression: true }
      : { echoCancellation: true, noiseSuppression: true };

    let stream;
    // Validate handoff stream: if tracks have ended (e.g. backgrounded on mobile), fall back to getUserMedia
    const handoff = existingStream && (
      existingStream.getAudioTracks().some(t => t.readyState === 'live') ||
      existingStream.getVideoTracks().some(t => t.readyState === 'live')
    ) ? existingStream : null;

    if (handoff) {
      // Reuse the already-live stream handed off from PreJoin
      stream = handoff;
      stream.getAudioTracks().forEach(t => { t.enabled = micOn; });
    } else {
      if (camOn) {
        const videoC = getVideoConstraints(camId, facingMode);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: videoC, audio: audioC });
        } catch {
          // Camera denied or busy — fall back to audio-only so mic still works
          stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioC });
          camOn = false; // treat as camera-off
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioC });
      }
      stream.getAudioTracks().forEach(t => { t.enabled = micOn; });
    }

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
    setIsCameraOn(camOn && stream.getVideoTracks().some(t => t.readyState === 'live'));
    setIsMicOn(micOn);
    return stream;
  }, []);

  // ── flipCamera: switch front ↔ back without full reconnect ────────
  const flipCamera = useCallback(async () => {
    if (!isCameraOn) return;

    const nextFacing = currentFacingModeRef.current === 'user' ? 'environment' : 'user';

    // Stop current video track(s)
    const oldTrack = rawVideoTrackRef.current;
    if (oldTrack) oldTrack.stop();
    if (effectTrackRef.current) {
      effectTrackRef.current.stop();
      effectTrackRef.current = null;
      setIsEffectActive(false);
    }

    // Acquire new camera track with opposite facing mode
    let newStream;
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        video: { ...getVideoConstraints(undefined, nextFacing), facingMode: { exact: nextFacing } },
        audio: false,
      });
    } catch {
      // Fallback: without 'exact' (some devices don't support it)
      newStream = await navigator.mediaDevices.getUserMedia({
        video: getVideoConstraints(undefined, nextFacing),
        audio: false,
      });
    }

    const newVideoTrack = newStream.getVideoTracks()[0];
    currentFacingModeRef.current = nextFacing;

    // Update internal track refs
    rawVideoTrackRef.current    = newVideoTrack;
    activeVideoTrackRef.current = newVideoTrack;
    setRawVideoStream(new MediaStream([newVideoTrack]));

    // Rebuild local stream (keep existing audio tracks)
    const audioTracks = localStreamRef.current?.getAudioTracks() || [];
    const updatedStream = new MediaStream([newVideoTrack, ...audioTracks]);
    localStreamRef.current = updatedStream;
    setLocalStream(updatedStream);

    // Push new track to all peer connections
    await replaceVideoTrack(newVideoTrack);

    return nextFacing;
  }, [isCameraOn, replaceVideoTrack]);

  // ── createPeerConnection ──────────────────────────────────────────
  const createPeerConnection = useCallback((remoteUserId) => {
    const existing = peerConnectionsRef.current[remoteUserId];
    if (existing) {
      // Reuse a healthy PC; close + recreate a broken one so reconnects work.
      if (!['disconnected', 'failed', 'closed'].includes(existing.connectionState)) {
        return existing;
      }
      existing.close();
      delete peerConnectionsRef.current[remoteUserId];
      delete pendingIceCandidatesRef.current[remoteUserId];
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    }

    const hasVideo = pc.getSenders().some(s => s.track?.kind === 'video') ||
                     pc.getTransceivers().some(t => t.sender.track === null && t.receiver.track?.kind === 'video');
    if (!hasVideo) {
      pc.addTransceiver('video', { direction: 'sendrecv' });
    }

    pc.ontrack = ({ track, streams }) => {
      setRemoteStreams(prev => {
        const existing = prev[remoteUserId];
        // Collect tracks: use streams[0] if the browser provides it (Chrome/Firefox
        // always do), else fall back to the individual track.
        const sourceTracks = streams?.[0]
          ? streams[0].getTracks()
          : [...(existing ? existing.getTracks() : []), track].filter(
              (t, i, a) => a.findIndex(x => x.id === t.id) === i
            );
        // CRITICAL: always wrap in a NEW MediaStream object.
        // Chrome passes the same e.streams[0] reference for every ontrack event
        // on a given PC.  If we store that native object, React sees
        // `stream === p.stream` on subsequent tracks (e.g. video after audio)
        // and skips the state update — useVideoStream never re-runs, play() is
        // never called for the video track, and the tile stays black.
        // A new MediaStream wrapping the same underlying tracks forces the full
        // React update chain on every track arrival.
        return { ...prev, [remoteUserId]: new MediaStream(sourceTracks) };
      });
    };

    pc.onnegotiationneeded = async () => {
      // Only renegotiate on an already-established connection (remoteDescription
      // set). Skipping during initial offer/answer prevents glare.
      if (pc.signalingState !== 'stable' || !pc.remoteDescription) return;
      try {
        const offer = await pc.createOffer();
        offer.sdp = preferVP8(offer.sdp);
        await pc.setLocalDescription(offer);
        emitSignal('signal:offer', { to: remoteUserId, offer: { type: offer.type, sdp: offer.sdp } });
      } catch (err) {
        console.warn('Renegotiation failed for peer:', remoteUserId, err);
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
    const pc = createPeerConnection(remoteUserId);
    // If the local stream wasn't ready when the PC was created (race condition),
    // add its tracks now before creating the offer.
    if (localStreamRef.current) {
      const existingSenders = pc.getSenders().map(s => s.track?.id).filter(Boolean);
      localStreamRef.current.getTracks().forEach(t => {
        if (!existingSenders.includes(t.id)) pc.addTrack(t, localStreamRef.current);
      });
    }
    const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
    offer.sdp   = preferVP8(offer.sdp);
    await pc.setLocalDescription(offer);
    emitSignal('signal:offer', { to: remoteUserId, offer: { type: offer.type, sdp: offer.sdp } });
  }, [createPeerConnection, emitSignal]);

  const handleOffer = useCallback(async ({ from, offer }) => {
    const pc = createPeerConnection(from);
    // If the local stream wasn't ready when the PC was created, add tracks now
    // before answering so the remote side receives our media.
    if (localStreamRef.current) {
      const existingSenders = pc.getSenders().map(s => s.track?.id).filter(Boolean);
      localStreamRef.current.getTracks().forEach(t => {
        if (!existingSenders.includes(t.id)) pc.addTrack(t, localStreamRef.current);
      });
    }
    try {
      if (pc.signalingState !== 'stable') {
        await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      // Drain any ICE candidates that arrived before this offer was processed
      const pending = pendingIceCandidatesRef.current[from] || [];
      for (const c of pending) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
      }
      delete pendingIceCandidatesRef.current[from];
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
    if (!pc) return;
    // Only apply the answer when we actually sent an offer
    if (pc.signalingState !== 'have-local-offer') return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      // Drain any ICE candidates that arrived before the answer was applied
      const pending = pendingIceCandidatesRef.current[from] || [];
      for (const c of pending) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
      }
      delete pendingIceCandidatesRef.current[from];
    } catch (err) {
      console.warn('handleAnswer failed:', err);
    }
  }, []);

  const handleIceCandidate = useCallback(async ({ from, candidate }) => {
    const pc = peerConnectionsRef.current[from];
    if (!pc || !pc.remoteDescription) {
      // Buffer the candidate — remote description not set yet
      if (candidate) {
        pendingIceCandidatesRef.current[from] = [
          ...(pendingIceCandidatesRef.current[from] || []),
          candidate,
        ];
      }
      return;
    }
    if (candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    }
  }, []);

  // ── Camera toggle ─────────────────────────────────────────────────
  const toggleCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    if (isCameraOn) {
      if (rawVideoTrackRef.current) { try { rawVideoTrackRef.current.stop(); } catch {} }
      if (effectTrackRef.current) { effectTrackRef.current.stop(); effectTrackRef.current = null; }
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
        const facing = currentFacingModeRef.current || 'user';
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: getVideoConstraints(undefined, facing),
        });
        const newTrack = camStream.getVideoTracks()[0];
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

  // ── Virtual background / effects ──────────────────────────────────
  const setVideoEffectTrack = useCallback(async (track) => {
    const rawTrack = rawVideoTrackRef.current;
    if (!rawTrack || !localStreamRef.current) return;

    if (!track) {
      if (effectTrackRef.current) effectTrackRef.current.stop();
      effectTrackRef.current = null;
      activeVideoTrackRef.current = rawTrack;
      await replaceVideoTrack(rawTrack);
      setLocalStream(new MediaStream([rawTrack, ...localStreamRef.current.getAudioTracks()]));
      setIsEffectActive(false);
      return;
    }

    if (effectTrackRef.current && effectTrackRef.current !== track) effectTrackRef.current.stop();
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
  const startScreenShare = useCallback(async (onEnded) => {
    const screenMedia = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always', displaySurface: 'monitor', frameRate: { ideal: 15, max: 30 } },
      audio: false,
    });

    screenStreamRef.current = screenMedia;
    const screenTrack = screenMedia.getVideoTracks()[0];
    await replaceVideoTrack(screenTrack);
    setIsScreenSharing(true);

    screenTrack.onended = async () => {
      await doStopScreenShare();
      onEnded?.();
    };

    return screenMedia;
  }, [replaceVideoTrack]); // eslint-disable-line

  const doStopScreenShare = useCallback(async () => {
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
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
    delete pendingIceCandidatesRef.current[remoteUserId];
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

  // Close every peer connection (e.g. on socket reconnect) without stopping
  // local media.  New PCs will be created fresh when initiateCall / handleOffer
  // runs after the reconnect.
  const closeAllPeers = useCallback(() => {
    Object.values(peerConnectionsRef.current).forEach(pc => { try { pc.close(); } catch {} });
    peerConnectionsRef.current  = {};
    pendingIceCandidatesRef.current = {};
    setRemoteStreams({});
  }, []);

  return {
    localStream, rawVideoStream, remoteStreams,
    isCameraOn, isMicOn, isScreenSharing, handRaised, isEffectActive,
    localStreamRef, screenStreamRef,
    startLocalStream, flipCamera,           // ← flipCamera exported
    replaceVideoTrack,                      // ← exported for external use
    initiateCall, handleOffer, handleAnswer, handleIceCandidate,
    toggleCamera, toggleMic,
    startScreenShare, stopScreenShare,
    toggleRaiseHand, removePeer, closeAllPeers, cleanup,
    setVideoEffectTrack,
  };
};