/**
 * RecordingCompleteModal.js  (React Native)
 *
 * Shown to the host after recording stops.
 * Fully responsive — uses percentage widths, scrollable on small screens.
 *
 * Props:
 *   visible       boolean
 *   onClose       () => void
 *   downloadUrl   string
 *   duration      number   (seconds)
 *   fileSize      number   (bytes)
 *   filename      string
 */

import React, { useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  Share,
  Platform,
  useWindowDimensions,
} from 'react-native';

function pad(n) { return String(n).padStart(2, '0'); }

function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

export default function RecordingCompleteModal({
  visible = false,
  onClose,
  downloadUrl,
  duration = 0,
  fileSize = 0,
  filename = 'recording.mp4',
}) {
  const { width, height } = useWindowDimensions();

  // 90 % of screen width, capped at 480
  const modalWidth = Math.min(width * 0.90, 480);

  const handleDownload = useCallback(async () => {
    if (!downloadUrl) return;
    try {
      const canOpen = await Linking.canOpenURL(downloadUrl);
      if (canOpen) Linking.openURL(downloadUrl);
    } catch {}
  }, [downloadUrl]);

  const handleShare = useCallback(async () => {
    if (!downloadUrl) return;
    try {
      await Share.share({
        title:   'Meeting Recording',
        message: Platform.OS === 'ios' ? filename : downloadUrl,
        url:     Platform.OS === 'ios' ? downloadUrl : undefined,
      });
    } catch {}
  }, [downloadUrl, filename]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { width: modalWidth, maxHeight: height * 0.85 }]}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.checkCircle}>
                <Text style={styles.checkIcon}>✓</Text>
              </View>
              <Text style={styles.title}>Recording Saved</Text>
              <Text style={styles.subtitle}>Your meeting has been recorded successfully.</Text>
            </View>

            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Duration</Text>
                <Text style={styles.statValue}>{fmtDuration(duration)}</Text>
              </View>
              <View style={[styles.statBox, styles.statDivider]}>
                <Text style={styles.statLabel}>File Size</Text>
                <Text style={styles.statValue}>{fmtSize(fileSize)}</Text>
              </View>
            </View>

            {/* Filename */}
            <View style={styles.filenameRow}>
              <Text style={styles.filenameLabel}>File</Text>
              <Text style={styles.filenameValue} numberOfLines={2}>{filename}</Text>
            </View>

            {/* Actions */}
            <TouchableOpacity style={styles.btnPrimary} onPress={handleDownload} activeOpacity={0.8}>
              <Text style={styles.btnPrimaryText}>⬇  Download Recording</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btnSecondary} onPress={handleShare} activeOpacity={0.8}>
              <Text style={styles.btnSecondaryText}>↗  Share Link</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btnGhost} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.btnGhostText}>Close</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius:    20,
    overflow:        'hidden',
    shadowColor:     '#000',
    shadowOpacity:   0.5,
    shadowOffset:    { width: 0, height: 8 },
    shadowRadius:    24,
    elevation:       12,
  },
  scrollContent: {
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  checkCircle: {
    width:           56,
    height:          56,
    borderRadius:    28,
    backgroundColor: 'rgba(52, 199, 89, 0.15)',
    borderWidth:     2,
    borderColor:     '#34c759',
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    12,
  },
  checkIcon: {
    color:    '#34c759',
    fontSize: 26,
    fontWeight: '700',
  },
  title: {
    color:      '#ffffff',
    fontSize:   20,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    color:     'rgba(255,255,255,0.55)',
    fontSize:  13,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection:   'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius:    12,
    marginBottom:    16,
  },
  statBox: {
    flex:      1,
    padding:   16,
    alignItems: 'center',
  },
  statDivider: {
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.10)',
  },
  statLabel: {
    color:        'rgba(255,255,255,0.5)',
    fontSize:     11,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    color:      '#ffffff',
    fontSize:   18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  filenameRow: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius:    10,
    padding:         12,
    marginBottom:    20,
    flexDirection:   'row',
    alignItems:      'flex-start',
    gap:             8,
  },
  filenameLabel: {
    color:     'rgba(255,255,255,0.5)',
    fontSize:  12,
    marginTop: 1,
    minWidth:  30,
  },
  filenameValue: {
    flex:       1,
    color:      'rgba(255,255,255,0.85)',
    fontSize:   13,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  btnPrimary: {
    backgroundColor: '#5b6af0',
    borderRadius:    12,
    paddingVertical: 14,
    alignItems:      'center',
    marginBottom:    10,
  },
  btnPrimaryText: {
    color:      '#fff',
    fontSize:   15,
    fontWeight: '700',
  },
  btnSecondary: {
    backgroundColor: 'rgba(91,106,240,0.15)',
    borderRadius:    12,
    paddingVertical: 14,
    alignItems:      'center',
    borderWidth:     1,
    borderColor:     'rgba(91,106,240,0.4)',
    marginBottom:    10,
  },
  btnSecondaryText: {
    color:      '#8b9bf5',
    fontSize:   15,
    fontWeight: '600',
  },
  btnGhost: {
    paddingVertical: 12,
    alignItems:      'center',
  },
  btnGhostText: {
    color:     'rgba(255,255,255,0.45)',
    fontSize:  14,
  },
});
