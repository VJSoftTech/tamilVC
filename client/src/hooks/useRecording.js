import { useRef, useState, useCallback } from 'react';
import { recordingAPI } from '../services/api';

export const useRecording = (meetingId, messages = {}) => {
  const mediaRecorderRef = useRef(null);
  const chunksRef        = useRef([]);
  const startTimeRef     = useRef(null);
  const animFrameRef     = useRef(null);
  const watermarkConfigRef = useRef({ image: '', position: 'bottom-right' });
  const watermarkImageRef = useRef(null);

  const setWatermarkConfig = useCallback((config = {}) => {
    const imageSrc = config.image || '';
    let img = null;
    if (imageSrc) {
      img = new Image();
      img.src = imageSrc;
    }
    watermarkImageRef.current = img;
    watermarkConfigRef.current = {
      image: imageSrc,
      position: config.position || 'bottom-right',
    };
  }, []);

  const [isRecording, setIsRecording] = useState(false);
  const [isSaving,    setIsSaving]    = useState(false);
  const [duration,    setDuration]    = useState(0);
  const durationInterval = useRef(null);

  // ── Draw a single video into a canvas cell, preserving aspect ratio ──
  // letterboxes / pillarboxes with a dark background so nothing stretches.
  const drawContained = (ctx, video, cellX, cellY, cellW, cellH) => {
    const vw = video.videoWidth  || cellW;
    const vh = video.videoHeight || cellH;
    const scale = Math.min(cellW / vw, cellH / vh);
    const dw    = vw * scale;
    const dh    = vh * scale;
    const dx    = cellX + (cellW - dw) / 2;
    const dy    = cellY + (cellH - dh) / 2;

    // Dark cell background
    ctx.fillStyle = '#111118';
    ctx.fillRect(cellX, cellY, cellW, cellH);

    try { ctx.drawImage(video, dx, dy, dw, dh); } catch {}
  };

  // ── Compute tile positions for n participants ─────────────────────
  // Keeps a sensible aspect ratio per tile and centres a single tile.
  const computeLayout = (n, canvasW, canvasH) => {
    if (n === 0) return [];

    if (n === 1) {
      // Centred, leaving some padding
      const pad = 0;
      return [{ x: pad, y: pad, w: canvasW - pad * 2, h: canvasH - pad * 2 }];
    }

    if (n === 2) {
      return [
        { x: 0,         y: 0, w: canvasW / 2, h: canvasH },
        { x: canvasW/2, y: 0, w: canvasW / 2, h: canvasH },
      ];
    }

    if (n === 3) {
      return [
        { x: 0,         y: 0,         w: canvasW / 2, h: canvasH / 2 },
        { x: canvasW/2, y: 0,         w: canvasW / 2, h: canvasH / 2 },
        { x: canvasW/4, y: canvasH/2, w: canvasW / 2, h: canvasH / 2 },
      ];
    }

    if (n === 4) {
      const hw = canvasW / 2, hh = canvasH / 2;
      return [
        { x: 0,  y: 0,  w: hw, h: hh },
        { x: hw, y: 0,  w: hw, h: hh },
        { x: 0,  y: hh, w: hw, h: hh },
        { x: hw, y: hh, w: hw, h: hh },
      ];
    }

    // 5+ : compute optimal grid (minimise wasted space)
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cw   = canvasW / cols;
    const ch   = canvasH / rows;
    const last = n % cols; // how many tiles in the final (possibly short) row
    const positions = [];

    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const isLastRow = row === rows - 1 && last > 0;

      if (isLastRow) {
        // Centre the remaining tiles in the last row
        const totalW  = last * cw;
        const startX  = (canvasW - totalW) / 2;
        positions.push({ x: startX + col * cw, y: row * ch, w: cw, h: ch });
      } else {
        positions.push({ x: col * cw, y: row * ch, w: cw, h: ch });
      }
    }

    return positions;
  };

  const buildCompositeStream = useCallback((streams) => {
    // Use 16:9 canvas — works well for landscape and portrait sources alike
    // because drawContained() letterboxes portrait content.
    const W = 1280, H = 720;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx      = canvas.getContext('2d');
    const audioCtx = new AudioContext();
    const dest     = audioCtx.createMediaStreamDestination();

    // Create hidden video elements for each stream
    const videos = streams.map(s => {
      const v    = document.createElement('video');
      v.srcObject = s;
      v.autoplay  = true;
      v.muted     = true;
      // Force portrait-correct rendering: let the browser figure out natural size
      v.playsInline = true;
      v.play().catch(() => {});

      if (s.getAudioTracks().length > 0) {
        try { audioCtx.createMediaStreamSource(s).connect(dest); } catch {}
      }
      return v;
    });

    const n = videos.length;

    const draw = () => {
      // Background
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, W, H);

      const positions = computeLayout(n, W, H);

      videos.forEach((v, i) => {
        if (i < positions.length) {
          const p = positions[i];
          drawContained(ctx, v, p.x, p.y, p.w, p.h);
        }
      });

      const wm = watermarkImageRef.current;
      if (wm?.complete && watermarkConfigRef.current?.image) {
          const base = Math.min(W, H);
          const targetW = Math.max(120, Math.floor(base * 0.16));
          const ratio = (wm.naturalWidth || 1) / (wm.naturalHeight || 1);
          const drawW = targetW;
          const drawH = Math.max(42, Math.floor(targetW / ratio));
          const margin = 20;
          let x = W - drawW - margin;
          let y = H - drawH - margin;

          if (watermarkConfigRef.current.position === 'top-left') {
            x = margin;
            y = margin;
          }
          if (watermarkConfigRef.current.position === 'top-right') {
            x = W - drawW - margin;
            y = margin;
          }
          if (watermarkConfigRef.current.position === 'bottom-left') {
            x = margin;
            y = H - drawH - margin;
          }

          ctx.globalAlpha = 0.9;
          try { ctx.drawImage(wm, x, y, drawW, drawH); } catch {}
          ctx.globalAlpha = 1;
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    // Wait one frame so video elements have a chance to load metadata
    // (videoWidth/videoHeight become available), then start the loop
    requestAnimationFrame(() => {
      requestAnimationFrame(draw);
    });

    return new MediaStream([
      ...canvas.captureStream(30).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
  }, []);

  const startRecording = useCallback(async (streams) => {
    if (!streams.length) {
      alert(messages.noActiveStreams || 'No active camera streams to record.');
      return;
    }
    const composite = buildCompositeStream(streams);
    const mimeType  = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : 'video/webm';

    const recorder = new MediaRecorder(composite, { mimeType, videoBitsPerSecond: 2_500_000 });
    chunksRef.current = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    startTimeRef.current     = Date.now();
    setIsRecording(true);
    setDuration(0);
    durationInterval.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, [buildCompositeStream, messages.noActiveStreams]);

  const stopRecording = useCallback(() => new Promise(resolve => {
    if (!mediaRecorderRef.current) { resolve(null); return; }
    clearInterval(durationInterval.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    const recorder = mediaRecorderRef.current;
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      const dur  = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setIsRecording(false);
      setIsSaving(true);
      try {
        const fd = new FormData();
        fd.append('recording', blob, 'recording.webm');
        fd.append('meeting_id', meetingId);
        fd.append('duration', dur);
        const res = await recordingAPI.save(fd);
        setIsSaving(false);
        resolve(res.data);
      } catch {
        setIsSaving(false);
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = `recording-${meetingId}-${Date.now()}.webm`;
        a.click();
        resolve(null);
      }
    };
    recorder.stop();
  }), [meetingId]);

  const fmt = s =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return {
    isRecording,
    isSaving,
    duration,
    formattedDuration: fmt(duration),
    startRecording,
    stopRecording,
    setWatermarkConfig,
  };
};