/**
 * RecordingIndicator.js  (React Native)
 *
 * Blinking red REC dot + duration timer shown to ALL participants
 * while recording is active.
 *
 * Fully responsive — scales with screen size via useWindowDimensions.
 *
 * Props:
 *   isRecording   boolean
 *   startTime     Date | null   (Date when recording started)
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet, useWindowDimensions } from 'react-native';

function pad(n) { return String(n).padStart(2, '0'); }

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function RecordingIndicator({ isRecording, startTime }) {
  const { width } = useWindowDimensions();

  // Scale: phones 360 → factor 1.0 … tablets 1024 → factor 1.6
  const scale = Math.min(1 + (width - 360) / 664 * 0.6, 1.6);

  const dotSize  = Math.round(10 * scale);
  const fontSize = Math.round(12 * scale);
  const padding  = Math.round(6  * scale);

  const [elapsed, setElapsed] = useState(0);
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const timerRef  = useRef(null);

  // Blink animation
  useEffect(() => {
    if (!isRecording) {
      blinkAnim.setValue(1);
      return;
    }
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    blink.start();
    return () => blink.stop();
  }, [isRecording, blinkAnim]);

  // Duration timer
  useEffect(() => {
    if (!isRecording || !startTime) {
      setElapsed(0);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [isRecording, startTime]);

  if (!isRecording) return null;

  return (
    <View style={[styles.container, { paddingHorizontal: padding * 1.5, paddingVertical: padding }]}>
      {/* Blinking dot */}
      <Animated.View
        style={[
          styles.dot,
          { width: dotSize, height: dotSize, borderRadius: dotSize / 2, opacity: blinkAnim },
        ]}
      />
      {/* REC label */}
      <Text style={[styles.recText, { fontSize }]}>REC</Text>
      {/* Timer */}
      <Text style={[styles.timerText, { fontSize }]}>{formatDuration(elapsed)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: 'rgba(0,0,0,0.60)',
    borderRadius:    20,
    gap:             6,
    // Position in top-left — parent must use position:'absolute' wrapper if needed
  },
  dot: {
    backgroundColor: '#ff3b30',
  },
  recText: {
    color:      '#ff3b30',
    fontWeight: '700',
    letterSpacing: 1,
  },
  timerText: {
    color:      '#ffffff',
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
});
