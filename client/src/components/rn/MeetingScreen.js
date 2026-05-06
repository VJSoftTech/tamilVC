/**
 * MeetingScreen.js  (React Native)  — INTEGRATION EXAMPLE
 *
 * Shows how to wire together:
 *   - VideoGrid (responsive tile layout)
 *   - useConferenceLayout (orientation + layout state → server)
 *   - RecordingIndicator (blinking REC dot)
 *   - RecordButton (host-only)
 *   - RecordingCompleteModal (post-recording)
 *   - Socket events for recording state
 *
 * Replace RTCView with your actual video component.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  Platform,
  ToastAndroid,
  Alert,
} from 'react-native';
import { RTCView } from 'react-native-webrtc';
import io from 'socket.io-client';

import VideoGrid from '../components/rn/VideoGrid';
import RecordingIndicator from '../components/rn/RecordingIndicator';
import RecordButton from '../components/rn/RecordButton';
import RecordingCompleteModal from '../components/rn/RecordingCompleteModal';
import { useConferenceLayout } from '../hooks/useConferenceLayout';

const SERVER_URL = 'https://your-server.com'; // ← replace

// ── Util ─────────────────────────────────────────────────────────────────────

function showToast(msg) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(msg, ToastAndroid.SHORT);
  } else {
    Alert.alert('', msg, [{ text: 'OK' }]);
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MeetingScreen({ route }) {
  const { meetingId, userId, isHost } = route.params;

  // ── Socket ────────────────────────────────────────────────────────────────
  const socketRef = useRef(null);
  useEffect(() => {
    const socket = io(SERVER_URL, {
      auth: { token: 'YOUR_JWT_TOKEN' },
    });
    socketRef.current = socket;
    socket.emit('join-meeting', meetingId);
    return () => socket.disconnect();
  }, [meetingId]);

  // ── Participants state ────────────────────────────────────────────────────
  // Each entry: { id, stream: MediaStream, name, isActiveSpeaker }
  const [participants,    setParticipants]    = useState([]);
  const [activeSpeakerId, setActiveSpeakerId] = useState(null);
  const [pinnedId,        setPinnedId]        = useState(null);
  const [screenShareStream, setScreenShareStream] = useState(null);

  // ── Recording state ───────────────────────────────────────────────────────
  const [isRecording,       setIsRecording]       = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState(null);
  const [recordingResult,   setRecordingResult]   = useState(null); // { downloadUrl, duration, fileSize, filename }
  const [showModal,         setShowModal]         = useState(false);

  // ── Layout hook ───────────────────────────────────────────────────────────
  const layout = useConferenceLayout({
    socket:         socketRef.current,
    meetingId,
    isHost,
    participants:   participants.map(p => p.id),
    activeSpeakerId,
    screenShareId:  screenShareStream ? 'screen-share' : null,
    pinnedId,
  });

  // ── Recording socket events ───────────────────────────────────────────────
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.on('recording:started', ({ meetingId: mid }) => {
      if (mid !== meetingId) return;
      setIsRecording(true);
      setRecordingStartTime(new Date());
      showToast('Recording has started');
    });

    socket.on('recording:stopped', (data) => {
      if (data.meetingId !== meetingId) return;
      setIsRecording(false);
      setRecordingStartTime(null);
      showToast('Recording stopped');
      if (isHost) {
        setRecordingResult(data);
        setShowModal(true);
      }
    });

    socket.on('recording:error', ({ message }) => {
      showToast(`Recording error: ${message}`);
    });

    return () => {
      socket.off('recording:started');
      socket.off('recording:stopped');
      socket.off('recording:error');
    };
  }, [meetingId, isHost]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleStartRecording = useCallback(() => {
    socketRef.current?.emit('recording:start', { meetingId });
  }, [meetingId]);

  const handleStopRecording = useCallback(() => {
    socketRef.current?.emit('recording:stop', { meetingId });
  }, [meetingId]);

  // ── Render video tile ─────────────────────────────────────────────────────
  const renderVideoTile = useCallback(({ stream, style, name, isActive }) => (
    <RTCView
      streamURL={stream?.toURL?.() ?? ''}
      style={style}
      objectFit="cover"
      mirror={false}
    />
  ), []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      {/* Video grid fills the screen */}
      <VideoGrid
        participants={participants}
        screenShareStream={screenShareStream}
        pinnedId={pinnedId}
        orientation={layout.orientation}
        screenWidth={layout.screenWidth}
        screenHeight={layout.screenHeight}
        renderVideoTile={renderVideoTile}
      />

      {/* Recording indicator — absolutely positioned top-left */}
      <View style={styles.recIndicatorWrap} pointerEvents="none">
        <RecordingIndicator
          isRecording={isRecording}
          startTime={recordingStartTime}
        />
      </View>

      {/* Bottom toolbar */}
      <View style={styles.toolbar}>
        {/* ... other controls (mute, camera, etc.) */}
        <RecordButton
          isHost={isHost}
          isRecording={isRecording}
          onStart={handleStartRecording}
          onStop={handleStopRecording}
        />
      </View>

      {/* Post-recording modal (host only) */}
      {isHost && (
        <RecordingCompleteModal
          visible={showModal}
          onClose={() => setShowModal(false)}
          downloadUrl={recordingResult?.downloadUrl}
          duration={recordingResult?.duration}
          fileSize={recordingResult?.fileSize}
          filename={recordingResult?.filename}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex:            1,
    backgroundColor: '#000',
  },
  recIndicatorWrap: {
    position: 'absolute',
    top:      16,
    left:     16,
    zIndex:   100,
  },
  toolbar: {
    position:        'absolute',
    bottom:          0,
    left:            0,
    right:           0,
    flexDirection:   'row',
    justifyContent:  'center',
    alignItems:      'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap:             16,
  },
});
