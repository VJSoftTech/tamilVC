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
  /**
   * Draw one video frame into a canvas cell, correcting for stream pixel
   * orientation.
   *
   * The fundamental problem on mobile:
   *   - The camera hardware always captures pixels in its native orientation
   *     (usually portrait: tall pixel buffer).
   *   - When the user holds the device in landscape, the OS may or may not
   *     rotate the pixel buffer before handing it to the MediaStream.
   *   - iOS Safari: NEVER rotates — always delivers portrait pixels regardless
   *     of device orientation.
   *   - Android Chrome: Usually rotates automatically, but not always.
   *
   * We detect a mismatch by comparing videoWidth/videoHeight against the
   * canvas cell dimensions and apply a compensating CSS rotation.
   *
   * Browser orientation angle convention (screen.orientation.angle):
   *   0   = portrait upright
   *   90  = landscape, device rotated CCW (home button on right side of screen)
   *         → the "top" of the scene is on the RIGHT edge of the pixel buffer
   *         → rotate pixel buffer CCW (-90°) to bring top back to top
   *   180 = portrait upside-down
   *   270 = landscape, device rotated CW (home button on left side of screen)
   *         → the "top" of the scene is on the LEFT edge of the pixel buffer
   *         → rotate pixel buffer CW (+90°) to bring top back to top
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLVideoElement} video
   * @param {number} cellX
   * @param {number} cellY
   * @param {number} cellW
   * @param {number} cellH
   * @param {number} orientationAngle  Normalised screen.orientation.angle (0/90/180/270)
   * @param {boolean} canvasIsPortrait  Whether the recording canvas is taller than wide
   */
//   const drawOriented = (ctx, video, cellX, cellY, cellW, cellH, orientationAngle, canvasIsPortrait) => {
//     const vw = video.videoWidth  || cellW;
//     const vh = video.videoHeight || cellH;

//     const videoIsPortrait = vh > vw;
//     const cellIsPortrait  = cellH > cellW;
//     let rotation = 0; // degrees

//     if (videoIsPortrait !== cellIsPortrait) {
//       // Stream pixels are portrait but canvas cell is landscape (or vice versa).
//       // The browser did NOT auto-rotate the stream — we must do it manually.
//       //
//       // angle=90  → device landscape CCW → "top" is at RIGHT of pixel buffer → rotate CCW (-90°)
//       // angle=270 → device landscape CW  → "top" is at LEFT of pixel buffer  → rotate CW  (+90°)
//       // angle=0/180 → portrait mismatch (rare) → best-effort 90° rotation
//       if (orientationAngle === 270) {
//         rotation = 90;   // landscape-right (home button left): rotate CW
//       } else if (orientationAngle === 90) {
//         rotation = -90;  // landscape-left (home button right): rotate CCW
//       } else if (orientationAngle === 180) {
//         rotation = 180;  // upside-down portrait in landscape cell
//       } else {
//         rotation = 90;   // angle=0 fallback
//       }
//     } else if (!videoIsPortrait && !canvasIsPortrait && orientationAngle === 270) {
//       // Android landscape-right edge case: both stream AND canvas are landscape,
//       // but pixel data is 180° flipped relative to what the user sees.
//       rotation = 180;
//     }

//     ctx.save();
//     ctx.fillStyle = '#111118';
//     ctx.fillRect(cellX, cellY, cellW, cellH);

//     const cx = cellX + cellW / 2;
//     const cy = cellY + cellH / 2;
//     ctx.translate(cx, cy);

//     if (rotation !== 0) {
//       ctx.rotate(rotation * Math.PI / 180);
//       // After ±90° rotation the video's effective w/h are swapped relative to
//       // the cell; fit into the swapped space.
//       const absRot = Math.abs(rotation);
//       const needsSwap = absRot === 90 || absRot === 270;
//       const fitW = needsSwap ? cellH : cellW;
//       const fitH = needsSwap ? cellW : cellH;
// const scale = Math.max(fitW / vw, fitH / vh);
//       const dw = vw * scale;
//       const dh = vh * scale;
//       try { ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh); } catch {}
//     } else {
// const scale = Math.max(cellW / vw, cellH / vh);
//       const dw = vw * scale;
//       const dh = vh * scale;
//       try { ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh); } catch {}
//     }

//     ctx.restore();
//   };
const drawOriented = (
  ctx,
  video,
  cellX,
  cellY,
  cellW,
  cellH
) => {
  const vw = video.videoWidth || cellW;
  const vh = video.videoHeight || cellH;

  ctx.save();

  // background
  ctx.fillStyle = '#111118';
  ctx.fillRect(cellX, cellY, cellW, cellH);

  // COVER fit without rotation
  const scale = Math.max(cellW / vw, cellH / vh);

  const dw = vw * scale;
  const dh = vh * scale;

  const dx = cellX + (cellW - dw) / 2;
  const dy = cellY + (cellH - dh) / 2;

  try {
    ctx.drawImage(video, dx, dy, dw, dh);
  } catch {}

  ctx.restore();
};
  // ── Compute tile positions for n participants ─────────────────────
  const computeLayout = (n, canvasW, canvasH) => {
    if (n === 0) return [];

    if (n === 1) {
      return [{ x: 0, y: 0, w: canvasW, h: canvasH }];
    }

    if (n === 2) {
      if (canvasH > canvasW) {
        return [
          { x: 0, y: 0,           w: canvasW, h: canvasH / 2 },
          { x: 0, y: canvasH / 2, w: canvasW, h: canvasH / 2 },
        ];
      }
      return [
        { x: 0,         y: 0, w: canvasW / 2, h: canvasH },
        { x: canvasW/2, y: 0, w: canvasW / 2, h: canvasH },
      ];
    }

     if (n === 3) {
      if (canvasH > canvasW) {
        const h3 = canvasH / 3;
        return [
          { x: 0, y: 0,      w: canvasW, h: h3 },
          { x: 0, y: h3,     w: canvasW, h: h3 },
          { x: 0, y: h3 * 2, w: canvasW, h: h3 },
        ];
      }
      const w3 = canvasW / 3;
      return [
        { x: 0,      y: 0, w: w3, h: canvasH },
        { x: w3,     y: 0, w: w3, h: canvasH },
        { x: w3 * 2, y: 0, w: w3, h: canvasH },
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

    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cw   = canvasW / cols;
    const ch   = canvasH / rows;
    const last = n % cols;
    const positions = [];

    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const isLastRow = row === rows - 1 && last > 0;

      if (isLastRow) {
        const totalW  = last * cw;
        const startX  = (canvasW - totalW) / 2;
        positions.push({ x: startX + col * cw, y: row * ch, w: cw, h: ch });
      } else {
        positions.push({ x: col * cw, y: row * ch, w: cw, h: ch });
      }
    }

    return positions;
  };

  const buildCompositeStream = useCallback((streams, isPortrait = false) => {
    const W = isPortrait ? 720 : 1280;
    const H = isPortrait ? 1280 : 720;

    // Snapshot the device orientation angle at recording start.
    // IMPORTANT: We must read this BEFORE starting the draw loop because
    // the user may rotate the device mid-recording; we compensate based on
    // the orientation at the moment they pressed Record.
    let orientationAngle = 0;
    try {
      // Prefer screen.orientation.angle (standard, consistent across browsers).
      // Fall back to window.orientation (deprecated, iOS Safari legacy).
      // window.orientation uses the OPPOSITE sign convention on some iOS versions,
      // so we normalise to [0, 360) after reading.
      let raw = 0;
      if (typeof screen?.orientation?.angle === 'number') {
        raw = screen.orientation.angle;
      } else if (typeof window.orientation === 'number') {
        // window.orientation: 0, 90, -90, 180
        // -90 on iOS = landscape-left = same as screen.orientation.angle 90
        raw = window.orientation;
      }
      orientationAngle = ((raw % 360) + 360) % 360; // normalise to [0, 360)
    } catch {}

    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx      = canvas.getContext('2d');
    const audioCtx = new AudioContext();
    const dest     = audioCtx.createMediaStreamDestination();

    const videos = streams.map(s => {
      const v    = document.createElement('video');
      v.srcObject = s;
      v.autoplay  = true;
      v.muted     = true;
      v.playsInline = true;
      v.play().catch(() => {});

      if (s.getAudioTracks().length > 0) {
        try { audioCtx.createMediaStreamSource(s).connect(dest); } catch {}
      }
      return v;
    });

    const n = videos.length;

    const draw = () => {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, W, H);

      const positions = computeLayout(n, W, H);

      videos.forEach((v, i) => {
        if (i < positions.length) {
          const p = positions[i];
        //  drawOriented(ctx, v, p.x, p.y, p.w, p.h, orientationAngle, isPortrait);
      drawOriented(ctx, v, p.x, p.y, p.w, p.h);  
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

    requestAnimationFrame(() => {
      requestAnimationFrame(draw);
    });

    return new MediaStream([
      ...canvas.captureStream(30).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
  }, []);

const startRecording = useCallback(async (streams, isPortrait = false) => {
  if (!streams.length) {
    alert(messages.noActiveStreams || 'No active camera streams to record.');
    return;
  }

  // BLOCK recording if phone rotated but auto-rotate OFF
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isMobile) {
    const isLandscapePhysical = window.innerWidth > window.innerHeight;

    // screen.orientation.angle stays 0 when auto-rotate OFF
    const orientationAngle =
      typeof screen?.orientation?.angle === 'number'
        ? screen.orientation.angle
        : 0;

    const autoRotateOff =
      isLandscapePhysical && orientationAngle === 0;

    if (autoRotateOff) {
      alert('Please enable Auto Rotate before recording.');
      return;
    }
  }


const initialOrientation =
  window.innerWidth > window.innerHeight
    ? 'landscape'
    : 'portrait';

window.__LOCK_RECORDING_ORIENTATION__ = initialOrientation;

    
    const composite = buildCompositeStream(streams, isPortrait);
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
      console.log('Recording blob size:', blob.size, 'bytes');
      setIsRecording(false);
      setIsSaving(true);

      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `recording-${meetingId}-${Date.now()}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);

      try {
        const fd = new FormData();
        fd.append('meeting_id', meetingId);
        fd.append('duration', dur);
        fd.append('recording', blob, 'recording.webm');
        console.log('Saving recording to API...');
        const res = await recordingAPI.save(fd);
        console.log('Recording saved successfully:', res.data);
        setIsSaving(false);
        resolve(res.data);
      } catch (error) {
        console.error('Recording save failed:', error);
        setIsSaving(false);
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