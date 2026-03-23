import { useRef, useState, useCallback } from 'react';
import { recordingAPI } from '../services/api';

export const useRecording = (meetingId, messages = {}) => {
  const mediaRecorderRef = useRef(null);
  const chunksRef        = useRef([]);
  const startTimeRef     = useRef(null);
  const animFrameRef     = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isSaving,    setIsSaving]    = useState(false);
  const [duration,    setDuration]    = useState(0);
  const durationInterval = useRef(null);

  const buildCompositeStream = useCallback((streams) => {
    const W = 1280, H = 720;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx      = canvas.getContext('2d');
    const audioCtx = new AudioContext();
    const dest     = audioCtx.createMediaStreamDestination();

    const videos = streams.map(s => {
      const v = document.createElement('video');
      v.srcObject = s; v.autoplay = true; v.muted = true;
      v.play().catch(() => {});
      if (s.getAudioTracks().length > 0) {
        audioCtx.createMediaStreamSource(s).connect(dest);
      }
      return v;
    });

    const draw = () => {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, W, H);
      const n = videos.length;
      let positions = [];
      if (n === 1) positions = [{ x: 0, y: 0, w: W, h: H }];
      else if (n === 2) positions = [{ x: 0, y: 0, w: W/2, h: H }, { x: W/2, y: 0, w: W/2, h: H }];
      else if (n === 3) positions = [
        { x: 0, y: 0, w: W/2, h: H/2 }, { x: W/2, y: 0, w: W/2, h: H/2 },
        { x: W/4, y: H/2, w: W/2, h: H/2 },
      ];
      else {
        const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
        const cw = W/cols, ch = H/rows;
        videos.forEach((_, i) => positions.push({ x: (i%cols)*cw, y: Math.floor(i/cols)*ch, w: cw, h: ch }));
      }
      videos.forEach((v, i) => {
        if (i < positions.length) {
          const p = positions[i];
          try { ctx.drawImage(v, p.x, p.y, p.w, p.h); } catch {}
        }
      });
      animFrameRef.current = requestAnimationFrame(draw);
    };
    draw();

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
      ? 'video/webm;codecs=vp9,opus' : 'video/webm';
    const recorder  = new MediaRecorder(composite, { mimeType, videoBitsPerSecond: 2500000 });
    chunksRef.current = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    startTimeRef.current = Date.now();
    setIsRecording(true); setDuration(0);
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
      setIsRecording(false); setIsSaving(true);
      try {
        const fd = new FormData();
        fd.append('recording', blob, 'recording.webm');
        fd.append('meeting_id', meetingId);
        fd.append('duration', dur);
        const res = await recordingAPI.save(fd);
        setIsSaving(false); resolve(res.data);
      } catch {
        setIsSaving(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `recording-${meetingId}-${Date.now()}.webm`; a.click();
        resolve(null);
      }
    };
    recorder.stop();
  }), [meetingId]);

  const fmt = s => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;

  return { isRecording, isSaving, duration, formattedDuration: fmt(duration), startRecording, stopRecording };
};
