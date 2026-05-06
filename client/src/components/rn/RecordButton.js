/**
 * RecordButton.js  (React Native)
 *
 * Host-only record / stop button.
 * Visible only when isHost === true.
 * Handles Android RECORD_AUDIO + iOS microphone permissions.
 *
 * Props:
 *   isHost        boolean
 *   isRecording   boolean
 *   onStart       () => void
 *   onStop        () => void
 */

import React, { useCallback } from 'react';
import {
  TouchableOpacity,
  View,
  Text,
  StyleSheet,
  Platform,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';

async function ensureAudioPermission() {
  const permission = Platform.OS === 'android'
    ? PERMISSIONS.ANDROID.RECORD_AUDIO
    : PERMISSIONS.IOS.MICROPHONE;

  const current = await check(permission);
  if (current === RESULTS.GRANTED) return true;
  if (current === RESULTS.DENIED) {
    const result = await request(permission);
    return result === RESULTS.GRANTED;
  }
  // BLOCKED or UNAVAILABLE
  Alert.alert(
    'Microphone Permission Required',
    'Please enable microphone access in your device Settings to record the meeting.',
    [{ text: 'OK' }],
  );
  return false;
}

export default function RecordButton({ isHost, isRecording, onStart, onStop }) {
  const { width } = useWindowDimensions();

  if (!isHost) return null;

  // Scale button with screen size (small phone → bigger tablet)
  const btnSize  = Math.round(Math.min(44 + (width - 360) * 0.02, 56));
  const fontSize = Math.round(Math.min(11 + (width - 360) * 0.006, 14));

  const handlePress = useCallback(async () => {
    if (isRecording) {
      onStop?.();
      return;
    }
    const granted = await ensureAudioPermission();
    if (granted) onStart?.();
  }, [isRecording, onStart, onStop]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.75}
      style={[
        styles.button,
        isRecording ? styles.buttonActive : styles.buttonIdle,
        { width: btnSize, height: btnSize, borderRadius: btnSize / 2 },
      ]}
      accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
      accessibilityRole="button"
    >
      {isRecording
        ? <View style={[styles.stopSquare, { width: btnSize * 0.4, height: btnSize * 0.4, borderRadius: 3 }]} />
        : <View style={[styles.startDot,  { width: btnSize * 0.45, height: btnSize * 0.45, borderRadius: (btnSize * 0.45) / 2 }]} />
      }
      <Text style={[styles.label, { fontSize }]}>
        {isRecording ? 'STOP' : 'REC'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems:      'center',
    justifyContent:  'center',
    shadowColor:     '#000',
    shadowOpacity:   0.35,
    shadowOffset:    { width: 0, height: 2 },
    shadowRadius:    4,
    elevation:       5,
  },
  buttonIdle: {
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
    borderWidth:     2,
    borderColor:     '#ff3b30',
  },
  buttonActive: {
    backgroundColor: '#ff3b30',
    borderWidth:     0,
  },
  startDot: {
    backgroundColor: '#ff3b30',
  },
  stopSquare: {
    backgroundColor: '#fff',
  },
  label: {
    color:      '#fff',
    fontWeight: '700',
    marginTop:  2,
    letterSpacing: 0.5,
  },
});
