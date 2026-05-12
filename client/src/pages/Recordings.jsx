import React, { useEffect, useRef, useState } from 'react';
import { recordingAPI } from '../services/api.js';
import { useTranslation } from 'react-i18next';

const POSITION_OPTIONS = [
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-right', label: 'Bottom Right' },
];

const INTRO_OUTRO_OPTIONS = [
  { value: 'front', label: 'Front — Intro (first 5 sec)' },
  { value: 'back',  label: 'Back — Outro (last 5 sec)' },
  { value: 'both',  label: 'Both — Intro & Outro (5 sec each)' },
];

// Default background music library.
// Place audio files under public/music/ matching the urls below,
// or swap the urls for any publicly hosted royalty-free tracks.
const DEFAULT_MUSIC_LIBRARY = [
  { id: 'soft-1',          genre: 'Soft',         name: 'Gentle Breeze',     url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',  duration: 120 },
  { id: 'soft-2',          genre: 'Soft',         name: 'Morning Light',     url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',  duration: 95  },
  { id: 'romantic-1',      genre: 'Romantic',     name: 'Sweet Moments',     url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',  duration: 110 },
  { id: 'romantic-2',      genre: 'Romantic',     name: 'Tender Touch',      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',  duration: 130 },
  { id: 'corporate-1',     genre: 'Corporate',    name: 'Business Flow',     url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',  duration: 90  },
  { id: 'corporate-2',     genre: 'Corporate',    name: 'Professional Rise', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',  duration: 105 },
  { id: 'cinematic-1',     genre: 'Cinematic',    name: 'Epic Journey',      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',  duration: 150 },
  { id: 'cinematic-2',     genre: 'Cinematic',    name: 'Grand Horizon',     url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',  duration: 140 },
  { id: 'happy-1',         genre: 'Happy',        name: 'Sunny Days',        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3',  duration: 88  },
  { id: 'happy-2',         genre: 'Happy',        name: 'Joyful Bounce',     url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3', duration: 92  },
  { id: 'emotional-1',     genre: 'Emotional',    name: 'Deep Reflection',   url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3', duration: 118 },
  { id: 'motivational-1',  genre: 'Motivational', name: 'Rise Up',           url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3', duration: 125 },
];
const MUSIC_GENRES = ['All', 'Soft', 'Romantic', 'Corporate', 'Cinematic', 'Happy', 'Emotional', 'Motivational'];

const getOverlayStyle = (position) => {
  const base = {
    position: 'absolute',
    maxWidth: '22%',
    maxHeight: '22%',
    objectFit: 'contain',
    pointerEvents: 'none',
    filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.45))',
  };
  if (position === 'top-left') return { ...base, top: 12, left: 12 };
  if (position === 'top-right') return { ...base, top: 12, right: 12 };
  if (position === 'bottom-left') return { ...base, bottom: 12, left: 12 };
  return { ...base, bottom: 12, right: 12 };
};

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const waitForEvent = (target, event) => new Promise((resolve) => {
  const handler = () => {
    target.removeEventListener(event, handler);
    resolve();
  };
  target.addEventListener(event, handler);
});

const drawStaticImageSegment = (ctx, img, width, height, durationSec) =>
  new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      if (img) {
        const ir = (img.naturalWidth || 1) / (img.naturalHeight || 1);
        const cr = width / height;
        let dw, dh, dx, dy;
        if (ir > cr) { dw = width; dh = width / ir; dx = 0; dy = (height - dh) / 2; }
        else { dh = height; dw = height * ir; dy = 0; dx = (width - dw) / 2; }
        ctx.drawImage(img, dx, dy, dw, dh);
      }
      if ((performance.now() - start) / 1000 < durationSec) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });

const renderEditedBlob = async ({
  sourceUrl, watermarkDataUrl, position, introDataUrl, introOutroPosition,
  bgMusicUrl = null, bgMusicVolume = 0.5, videoGainValue = 1,
  bgMusicStartInVideo = 0, bgMusicTrimStart = 0, bgMusicTrimEnd = null,
  bgMusicFadeIn = false, bgMusicFadeOut = false, bgMusicLoop = true,
}) => {
  const hasIntro = !!introDataUrl && (introOutroPosition === 'front' || introOutroPosition === 'both');
  const hasOutro = !!introDataUrl && (introOutroPosition === 'back' || introOutroPosition === 'both');

  const video = document.createElement('video');
  video.src = sourceUrl;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';

  await waitForEvent(video, 'loadedmetadata');

  const width = Math.max(1, video.videoWidth || 1280);
  const height = Math.max(1, video.videoHeight || 720);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const loadImg = async (src) => {
    if (!src) return null;
    const img = new Image();
    img.src = src;
    await waitForEvent(img, 'load');
    return img;
  };

  const [watermarkImg, overlayImg] = await Promise.all([
    loadImg(watermarkDataUrl),
    loadImg(introDataUrl),
  ]);

  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();

  // Video audio with independent volume control
  const videoGain = audioCtx.createGain();
  videoGain.gain.value = videoGainValue;
  try {
    const sourceNode = audioCtx.createMediaElementSource(video);
    sourceNode.connect(videoGain);
    videoGain.connect(dest);
    videoGain.connect(audioCtx.destination);
  } catch {
    // Ignore if media node cannot be attached; output will contain only video.
  }

  // Load background music if provided
  let bgBuffer = null;
  if (bgMusicUrl) {
    try {
      const resp = await fetch(bgMusicUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} from music source`);
      const arrayBuf = await resp.arrayBuffer();
      bgBuffer = await audioCtx.decodeAudioData(arrayBuf);
    } catch (e) {
      audioCtx.close().catch(() => {});
      throw new Error(`Background music failed to load: ${e.message}`);
    }
  }

  const mixedStream = new MediaStream([
    ...canvas.captureStream(30).getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus'
    : 'video/webm';

  const chunks = [];
  const recorder = new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: 2_500_000 });
  recorder.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data);
  };

  const blobPromise = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
  });

  if (audioCtx.state === 'suspended') {
    try { await audioCtx.resume(); } catch {}
  }

  recorder.start(1000);

  // Schedule background music
  let bgSource = null;
  if (bgBuffer) {
    const musicGain = audioCtx.createGain();
    bgSource = audioCtx.createBufferSource();
    bgSource.buffer = bgBuffer;
    bgSource.loop = bgMusicLoop;

    const startAt = audioCtx.currentTime + Math.max(0, bgMusicStartInVideo);
    const trimOffset = Math.max(0, bgMusicTrimStart);
    const trimDuration = bgMusicTrimEnd != null
      ? Math.max(0.1, bgMusicTrimEnd - trimOffset)
      : undefined;

    musicGain.gain.setValueAtTime(bgMusicFadeIn ? 0 : bgMusicVolume, audioCtx.currentTime);
    bgSource.connect(musicGain);
    musicGain.connect(dest);
    bgSource.start(startAt, trimOffset, trimDuration);

    if (bgMusicFadeIn) {
      const fadeEnd = startAt + Math.min(2, (video.duration || 10) * 0.15);
      musicGain.gain.linearRampToValueAtTime(bgMusicVolume, fadeEnd);
    }
    if (bgMusicFadeOut && (video.duration || 0) > 2) {
      const fadeStart = audioCtx.currentTime + (video.duration - Math.min(2, video.duration * 0.15));
      musicGain.gain.setValueAtTime(bgMusicVolume, Math.max(startAt + 0.01, fadeStart));
      musicGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + video.duration);
    }
  }
  if (hasIntro) await drawStaticImageSegment(ctx, overlayImg, width, height, 5);

  // Phase 2: Main video with optional watermark
  let raf = null;
  const draw = () => {
    ctx.drawImage(video, 0, 0, width, height);

    if (watermarkImg) {
      const targetW = Math.max(100, Math.floor(width * 0.18));
      const wmRatio = (watermarkImg.naturalWidth || 1) / (watermarkImg.naturalHeight || 1);
      const drawW = targetW;
      const drawH = Math.max(38, Math.floor(targetW / wmRatio));
      const margin = Math.max(12, Math.floor(width * 0.012));

      let x = width - drawW - margin;
      let y = height - drawH - margin;
      if (position === 'top-left') { x = margin; y = margin; }
      if (position === 'top-right') { x = width - drawW - margin; y = margin; }
      if (position === 'bottom-left') { x = margin; y = height - drawH - margin; }

      ctx.globalAlpha = 0.9;
      ctx.drawImage(watermarkImg, x, y, drawW, drawH);
      ctx.globalAlpha = 1;
    }

    if (!video.paused && !video.ended) {
      raf = requestAnimationFrame(draw);
    }
  };

  video.currentTime = 0;
  await video.play();
  draw();

  await waitForEvent(video, 'ended');
  if (raf) cancelAnimationFrame(raf);

  // Phase 3: Outro image segment
  if (hasOutro) await drawStaticImageSegment(ctx, overlayImg, width, height, 5);

  recorder.stop();
  if (bgSource) { try { bgSource.stop(); } catch {} }
  const blob = await blobPromise;
  const videoDuration = video.duration;
  mixedStream.getTracks().forEach((t) => t.stop());
  video.src = '';

  const extraSecs = (hasIntro ? 5 : 0) + (hasOutro ? 5 : 0);
  return { blob, duration: Math.max(1, Math.round((videoDuration || 0) + extraSecs)) };
};

export default function Recordings() {
  const { t } = useTranslation();
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingRec, setViewingRec] = useState(null);

  const [editingRec, setEditingRec] = useState(null);
  const [editWatermark, setEditWatermark] = useState('');
  const [editPosition, setEditPosition] = useState('bottom-right');
  const [editSaving, setEditSaving] = useState(false);
  const [editPlaying, setEditPlaying] = useState(false);
  const [editVolume, setEditVolume] = useState(1);
  const [editIntroOutro, setEditIntroOutro] = useState('');
  const [editIntroOutroPosition, setEditIntroOutroPosition] = useState('front');
  // Background music state
  const [editTab, setEditTab] = useState('overlay');
  const [musicSourceTab, setMusicSourceTab] = useState('upload');
  const [bgMusicFile, setBgMusicFile] = useState(null);
  const [bgMusicFileUrl, setBgMusicFileUrl] = useState(null);
  const [bgMusicFileName, setBgMusicFileName] = useState('');
  const [bgMusicFileDuration, setBgMusicFileDuration] = useState(null);
  const [selectedLibraryTrack, setSelectedLibraryTrack] = useState(null);
  const [bgMusicVolume, setBgMusicVolume] = useState(0.5);
  const [bgMusicStartInVideo, setBgMusicStartInVideo] = useState(0);
  const [bgMusicTrimStart, setBgMusicTrimStart] = useState(0);
  const [bgMusicTrimEnd, setBgMusicTrimEnd] = useState('');
  const [bgMusicFadeIn, setBgMusicFadeIn] = useState(false);
  const [bgMusicFadeOut, setBgMusicFadeOut] = useState(false);
  const [bgMusicLoop, setBgMusicLoop] = useState(true);
  const [musicLibraryGenre, setMusicLibraryGenre] = useState('All');
  const [previewingTrackId, setPreviewingTrackId] = useState(null);
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 8;
  const recListRef = useRef(null);
  const videoPreviewRef = useRef(null);
  const watermarkInputRef = useRef(null);
  const introOutroInputRef = useRef(null);
  const bgMusicInputRef = useRef(null);
  const previewAudioRef = useRef(null);

  const loadRecordings = async () => {
    setLoading(true);
    try {
      const r = await recordingAPI.getAll();
      setRecs(r.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecordings();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm(t('pages.recordings.confirmDelete'))) return;
    await recordingAPI.delete(id);
    setRecs((r) => r.filter((x) => x.id !== id));
  };

  const urlWithToken = (url) => {
    const token = localStorage.getItem('token');
    if (!token || !url) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${token}`;
  };

  const openEditModal = (recording) => {
    setEditingRec(recording);
    setEditWatermark('');
    setEditPosition('bottom-right');
    setEditIntroOutro('');
    setEditIntroOutroPosition('front');
    setEditSaving(false);
    setEditPlaying(false);
    setEditVolume(1);
    setEditTab('overlay');
    setMusicSourceTab('upload');
    setBgMusicFile(null);
    setBgMusicFileUrl(null);
    setBgMusicFileName('');
    setBgMusicFileDuration(null);
    setSelectedLibraryTrack(null);
    setBgMusicVolume(0.5);
    setBgMusicStartInVideo(0);
    setBgMusicTrimStart(0);
    setBgMusicTrimEnd('');
    setBgMusicFadeIn(false);
    setBgMusicFadeOut(false);
    setBgMusicLoop(true);
    setMusicLibraryGenre('All');
    setPreviewingTrackId(null);
  };

  const closeEditModal = () => {
    if (editSaving) return;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = '';
    }
    if (bgMusicFileUrl) URL.revokeObjectURL(bgMusicFileUrl);
    setEditingRec(null);
    setEditWatermark('');
    setEditPosition('bottom-right');
    setEditIntroOutro('');
    setEditIntroOutroPosition('front');
    setBgMusicFile(null);
    setBgMusicFileUrl(null);
    setBgMusicFileName('');
    setBgMusicFileDuration(null);
    setSelectedLibraryTrack(null);
    setPreviewingTrackId(null);
  };

  const onUploadWatermark = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file.');
      return;
    }
    try {
      const data = await readAsDataUrl(file);
      setEditWatermark(data);
    } catch {
      alert('Failed to read image. Please try another file.');
    }
  };

  const onUploadIntroOutro = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file.');
      return;
    }
    try {
      const data = await readAsDataUrl(file);
      setEditIntroOutro(data);
    } catch {
      alert('Failed to read image. Please try another file.');
    }
  };

  const onUploadBgMusic = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ok = /\.(mp3|wav|m4a)$/i.test(file.name) ||
      ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac'].includes(file.type);
    if (!ok) { alert('Please upload an MP3, WAV, or M4A file.'); return; }
    try {
      if (bgMusicFileUrl) URL.revokeObjectURL(bgMusicFileUrl);
      const url = URL.createObjectURL(file);
      const dur = await new Promise((res) => {
        const a = new Audio(url);
        a.onloadedmetadata = () => res(a.duration);
        a.onerror = () => res(null);
      });
      setBgMusicFile(file);
      setBgMusicFileUrl(url);
      setBgMusicFileName(file.name);
      setBgMusicFileDuration(dur);
      setSelectedLibraryTrack(null);
    } catch {
      alert('Failed to load audio file. Please try another file.');
    }
  };

  const toggleTrackPreview = (track) => {
    const audio = previewAudioRef.current;
    if (!audio) return;

    // Clicking the same track — stop it
    if (previewingTrackId === track.id) {
      audio.pause();
      audio.src = '';
      setPreviewingTrackId(null);
      return;
    }

    // Switch to a new track
    audio.pause();
    audio.src = track.url;
    audio.volume = 0.7;
    setPreviewingTrackId(track.id);
    audio.play().catch((err) => {
      // AbortError is expected on rapid track-switching; ignore it
      if (err.name !== 'AbortError') {
        setPreviewingTrackId(null);
      }
    });
  };

  const togglePreviewPlay = async () => {
    const v = videoPreviewRef.current;
    if (!v) return;
    if (v.paused) {
      await v.play().catch(() => {});
      setEditPlaying(true);
    } else {
      v.pause();
      setEditPlaying(false);
    }
  };

  const setPreviewVolume = (next) => {
    const clamped = Math.max(0, Math.min(1, next));
    setEditVolume(clamped);
    if (videoPreviewRef.current) videoPreviewRef.current.volume = clamped;
  };

  const handleSaveEdit = async () => {
    const activeMusicUrl = bgMusicFileUrl || selectedLibraryTrack?.url || null;
    if (!editingRec || (!editWatermark && !editIntroOutro && !activeMusicUrl)) {
      alert('Upload a watermark, intro/outro image, or background music before saving.');
      return;
    }

    setEditSaving(true);
    let tempMusicBlobUrl = null;
    try {
      // Pre-fetch external (library) music through the server proxy and convert to
      // a same-origin blob URL before calling renderEditedBlob.
      // This sidesteps the browser CORS restriction that blocks fetch() +
      // Web Audio API decodeAudioData() on cross-origin audio files.
      let renderMusicUrl = activeMusicUrl;
      if (activeMusicUrl && !activeMusicUrl.startsWith('blob:') && !activeMusicUrl.startsWith('data:')) {
        const proxyUrl = `/api/proxy-audio?url=${encodeURIComponent(activeMusicUrl)}`;
        const proxyResp = await fetch(proxyUrl);
        if (!proxyResp.ok) throw new Error(`Failed to load background music (HTTP ${proxyResp.status}). Make sure the server is running.`);
        const audioBuf = await proxyResp.arrayBuffer();
        const audioBlob = new Blob([audioBuf], { type: proxyResp.headers.get('content-type') || 'audio/mpeg' });
        tempMusicBlobUrl = URL.createObjectURL(audioBlob);
        renderMusicUrl = tempMusicBlobUrl;
      }
      const sourceUrl = urlWithToken(editingRec.download_url);
      const { blob, duration } = await renderEditedBlob({
        sourceUrl,
        watermarkDataUrl: editWatermark || null,
        position: editPosition,
        introDataUrl: editIntroOutro || null,
        introOutroPosition: editIntroOutroPosition,
        bgMusicUrl: renderMusicUrl,
        bgMusicVolume,
        videoGainValue: editVolume,
        bgMusicStartInVideo: Math.max(0, bgMusicStartInVideo),
        bgMusicTrimStart: Math.max(0, bgMusicTrimStart),
        bgMusicTrimEnd: bgMusicTrimEnd !== '' && bgMusicTrimEnd !== null ? parseFloat(bgMusicTrimEnd) : null,
        bgMusicFadeIn,
        bgMusicFadeOut,
        bgMusicLoop,
      });

      const fd = new FormData();
      fd.append('recording', blob, `recording_${editingRec.meetingId || editingRec.meeting_id}_${Date.now()}.webm`);
      fd.append('meeting_id', editingRec.meetingId || editingRec.meeting_id);
      fd.append('duration', duration || editingRec.duration || 0);
      const bgMusicName = bgMusicFileName || selectedLibraryTrack?.name || '';
      if (bgMusicName) {
        fd.append('bg_music_name', bgMusicName);
        fd.append('bg_music_volume', Math.round(bgMusicVolume * 100));
        fd.append('video_volume', Math.round(editVolume * 100));
      }

      await recordingAPI.save(fd);
      await recordingAPI.delete(editingRec.id);
      await loadRecordings();
      closeEditModal();
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Failed to edit recording.');
    } finally {
      if (tempMusicBlobUrl) URL.revokeObjectURL(tempMusicBlobUrl);
      setEditSaving(false);
    }
  };

  const fmtDur = (s) => {
    if (!s) return '-';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };
  const fmtSize = (b) => {
    if (!b) return '-';
    return b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(0)} KB`;
  };
  // The DB column is TIMESTAMP WITHOUT TIME ZONE: values are stored in server
  // local time, but the postgres driver reads them back as UTC and appends "Z".
  // Stripping "Z" makes the browser treat the value as local time, which matches
  // when it was actually recorded.
  const fmt = (dt) => {
    if (!dt) return '-';
    const s = typeof dt === 'string' ? dt.replace('Z', '') : dt;
    return new Date(s).toLocaleString();
  };

  const totalPages = Math.max(1, Math.ceil(recs.length / PAGE_SIZE));
  const paginated = recs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const goToPage = (p) => {
    if (p < 1 || p > totalPages) return;
    setPage(p);
    recListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const getPageNumbers = (current, total) => {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
    if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '...', current - 1, current, current + 1, '...', total];
  };

  return (
    <div>
      <div className="page-header">
        <h2>Recordings</h2>
        <p>{t('pages.recordings.subtitle')}</p>
      </div>

      {loading ? (
        <div className="card"><p className="text-muted">{t('pages.recordings.loading')}</p></div>
      ) : recs.length === 0 ? (
        <div className="card"><p className="text-muted">{t('pages.recordings.empty')}</p></div>
      ) : (
        <>
        {recs.length > 0 && (
          <div className="rec-count-label">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, recs.length)} of {recs.length} recording{recs.length !== 1 ? 's' : ''}
          </div>
        )}
        <div className="rec-list" ref={recListRef}>
          {paginated.map((r) => (
            <div key={r.id} className="rec-card">

              {/* ── Thumbnail ────────────────────────────────── */}
              <div
                className="rec-thumb"
                onClick={() => setViewingRec({ ...r, url: urlWithToken(r.download_url) })}
                title="Click to play"
              >
                <video
                  preload="metadata"
                  muted
                  playsInline
                  className="rec-thumb-video"
                  onLoadedMetadata={(e) => { e.currentTarget.currentTime = 1; }}
                >
                  <source src={urlWithToken(r.download_url)} />
                </video>
                <div className="rec-thumb-overlay">
                  <span className="rec-play-btn">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  </span>
                </div>
                {r.duration && (
                  <span className="rec-duration-badge">{fmtDur(r.duration)}</span>
                )}
              </div>

              {/* ── Info ─────────────────────────────────────── */}
              <div className="rec-info">
                <div className="rec-title">{r.title}</div>
                {r.subTitle && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 2, marginBottom: 4 }}>{r.subTitle}</div>
                )}
                <div className="rec-meta">
                  <span className="rec-meta-label">Meeting ID:</span>
                  <code className="rec-meeting-id">{r.meetingId || r.meeting_id}</code>
                </div>
                <div className="rec-meta">
                  <span className="rec-meta-label">Date:</span>
                  {fmt(r.recordedAt || r.recorded_at)}
                </div>
                <div className="rec-meta rec-meta-row">
                  <span>
                    <span className="rec-meta-label">Duration:</span>
                    {fmtDur(r.duration)}
                  </span>
                  <span className="rec-meta-sep">·</span>
                  <span>
                    <span className="rec-meta-label">Size:</span>
                    {fmtSize(r.fileSize || r.file_size)}
                  </span>
                </div>
              </div>

              {/* ── Actions ──────────────────────────────────── */}
              <div className="rec-actions">
                <button
                  className="rec-btn rec-btn-view"
                  onClick={() => setViewingRec({ ...r, url: urlWithToken(r.download_url) })}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5,3 19,12 5,21" fill="currentColor" stroke="none"/>
                  </svg>
                  View
                </button>
                <button
                  className="rec-btn rec-btn-edit"
                  onClick={() => openEditModal(r)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  Edit
                </button>
                <a
                  href={urlWithToken(r.download_url)}
                  download
                  className="rec-btn rec-btn-download"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download
                </a>
                <button
                  className="rec-btn rec-btn-delete"
                  onClick={() => handleDelete(r.id)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                  Delete
                </button>
              </div>

            </div>
          ))}
        </div>

        {totalPages > 1 && (
          <nav className="rec-pagination" aria-label="Recordings pages" data-label={`Page ${page} of ${totalPages}`}>
            <button
              className="rec-page-btn rec-page-prev"
              onClick={() => goToPage(page - 1)}
              disabled={page === 1}
              aria-label="Previous page"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>

            <div className="rec-page-numbers">
              {getPageNumbers(page, totalPages).map((p, i) =>
                p === '...' ? (
                  <span key={`ellipsis-${i}`} className="rec-page-ellipsis">&hellip;</span>
                ) : (
                  <button
                    key={p}
                    className={`rec-page-btn rec-page-num${p === page ? ' rec-page-active' : ''}`}
                    onClick={() => goToPage(p)}
                    aria-label={`Page ${p}`}
                    aria-current={p === page ? 'page' : undefined}
                  >
                    {p}
                  </button>
                )
              )}
            </div>

            <button
              className="rec-page-btn rec-page-next"
              onClick={() => goToPage(page + 1)}
              disabled={page === totalPages}
              aria-label="Next page"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </nav>
        )}
        </>
      )}

      {viewingRec && (
        <div
          onClick={() => setViewingRec(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface, #1e1e2e)', borderRadius: 16,
              width: '100%', maxWidth: 860,
              boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
              overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{viewingRec.title}</div>
                {viewingRec.subTitle && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 1 }}>{viewingRec.subTitle}</div>
                )}
                <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 2 }}>
                  {fmt(viewingRec.recordedAt || viewingRec.recorded_at)}
                  {viewingRec.duration ? ` · ${fmtDur(viewingRec.duration)}` : ''}
                </div>
              </div>
              <button
                onClick={() => setViewingRec(null)}
                style={{
                  background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff',
                  borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16,
                }}
              >
                X
              </button>
            </div>
            <div style={{ background: '#000', lineHeight: 0 }}>
              <video src={viewingRec.url} controls autoPlay style={{ width: '100%', maxHeight: '60vh', display: 'block' }} />
            </div>
          </div>
        </div>
      )}

      {editingRec && (
        <div className="em-overlay" onClick={closeEditModal}>
          <div className="em-dialog" onClick={(e) => e.stopPropagation()}>

            {/* ── Header ── */}
            <div className="em-header">
              <div>
                <div className="em-header-title">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 7, verticalAlign: 'middle', opacity: 0.7 }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit Recording
                </div>
                <div className="em-header-sub">{editingRec.title}{editingRec.subTitle ? ` · ${editingRec.subTitle}` : ''}</div>
              </div>
              <button className="em-close-btn" onClick={closeEditModal} disabled={editSaving} aria-label="Close">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* ── Body ── */}
            <div className="em-body recording-edit-grid">

              {/* Left — video preview */}
              <div className="em-left">
                <div className="em-video-wrap">
                  <video
                    ref={videoPreviewRef}
                    src={urlWithToken(editingRec.download_url)}
                    controls
                    onPlay={() => setEditPlaying(true)}
                    onPause={() => setEditPlaying(false)}
                    onLoadedMetadata={(e) => { e.currentTarget.volume = editVolume; }}
                    className="em-video"
                  />
                  {editWatermark && (
                    <img src={editWatermark} alt="watermark preview" style={getOverlayStyle(editPosition)} />
                  )}
                </div>

                <div className="em-controls-card">
                  <div className="em-controls-top">
                    <button className="em-play-btn" onClick={togglePreviewPlay}>
                      {editPlaying ? (
                        <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause</>
                      ) : (
                        <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Play</>
                      )}
                    </button>
                    <span className="em-controls-hint">Preview</span>
                  </div>
                  <div className="em-vol-row">
                    <svg className="em-vol-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                    <span className="em-vol-label">Volume</span>
                    <input type="range" min="0" max="1" step="0.05" value={editVolume}
                      onChange={(e) => setPreviewVolume(parseFloat(e.target.value))}
                      className="em-range em-range-purple" />
                    <span className="em-vol-pct">{Math.round(editVolume * 100)}%</span>
                  </div>
                </div>
              </div>

              {/* Right — controls */}
              <div className="em-right">

                {/* Tab bar */}
                <div className="em-tabs" role="tablist">
                  {[{ key: 'overlay', icon: '🖼', label: 'Overlay' }, { key: 'music', icon: '🎵', label: 'Music' }].map(tab => (
                    <button key={tab.key} role="tab" aria-selected={editTab === tab.key}
                      onClick={() => setEditTab(tab.key)}
                      className={`em-tab${editTab === tab.key ? ' em-tab-active' : ''}`}>
                      {tab.icon} {tab.label}
                    </button>
                  ))}
                </div>

                {/* ── OVERLAY TAB ── */}
                {editTab === 'overlay' && (
                  <div className="em-tab-content">

                    <div className="em-section">
                      <div className="em-section-label">Watermark Image</div>
                      <button className="em-upload-btn" onClick={() => watermarkInputRef.current?.click()} disabled={editSaving}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Choose Image
                      </button>
                      <input ref={watermarkInputRef} type="file" accept="image/*" onChange={onUploadWatermark} style={{ display: 'none' }} />
                      {editWatermark ? (
                        <div className="em-preview-card">
                          <img src={editWatermark} alt="watermark" className="em-preview-img" />
                          <button className="em-remove-btn" onClick={() => setEditWatermark('')}>✕ Remove</button>
                        </div>
                      ) : (
                        <p className="em-empty-hint">No watermark selected yet.</p>
                      )}
                    </div>

                    <div className="em-section">
                      <div className="em-section-label">Position</div>
                      <div className="em-radio-group">
                        {POSITION_OPTIONS.map((opt) => (
                          <label key={opt.value} className="em-radio-label">
                            <input type="radio" name="wm-position" value={opt.value} checked={editPosition === opt.value}
                              onChange={(e) => setEditPosition(e.target.value)} />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    <hr className="em-divider" />

                    <div className="em-section">
                      <div className="em-section-label">Intro / Outro Image</div>
                      <button className="em-upload-btn" onClick={() => introOutroInputRef.current?.click()} disabled={editSaving}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                        Choose Image
                      </button>
                      <input ref={introOutroInputRef} type="file" accept="image/*" onChange={onUploadIntroOutro} style={{ display: 'none' }} />
                      {editIntroOutro ? (
                        <div className="em-preview-card">
                          <img src={editIntroOutro} alt="intro/outro" className="em-preview-img" />
                          <button className="em-remove-btn" onClick={() => setEditIntroOutro('')}>✕ Remove</button>
                        </div>
                      ) : (
                        <p className="em-empty-hint">No intro/outro image selected.</p>
                      )}
                      {editIntroOutro && (
                        <>
                          <div className="em-section-label" style={{ marginTop: 14 }}>Display At</div>
                          <div className="em-radio-group">
                            {INTRO_OUTRO_OPTIONS.map((opt) => (
                              <label key={opt.value} className="em-radio-label">
                                <input type="radio" name="io-position" value={opt.value} checked={editIntroOutroPosition === opt.value}
                                  onChange={(e) => setEditIntroOutroPosition(e.target.value)} />
                                {opt.label}
                              </label>
                            ))}
                          </div>
                          <p className="em-hint-text">Each segment plays for 5 seconds.</p>
                        </>
                      )}
                    </div>

                  </div>
                )}

                {/* ── MUSIC TAB ── */}
                {editTab === 'music' && (
                  <div className="em-tab-content">

                    {/* Volume mix */}
                    <div className="em-vol-card">
                      <div className="em-section-label">Volume Mix</div>
                      <div className="em-vol-row" style={{ marginBottom: 10 }}>
                        <span className="em-vol-label">🎬 Video</span>
                        <input type="range" min="0" max="1" step="0.05" value={editVolume}
                          onChange={(e) => setPreviewVolume(parseFloat(e.target.value))}
                          className="em-range em-range-purple" />
                        <span className="em-vol-pct">{Math.round(editVolume * 100)}%</span>
                      </div>
                      <div className="em-vol-row">
                        <span className="em-vol-label">🎵 Music</span>
                        <input type="range" min="0" max="1" step="0.05" value={bgMusicVolume}
                          onChange={(e) => setBgMusicVolume(parseFloat(e.target.value))}
                          className="em-range em-range-amber" />
                        <span className="em-vol-pct">{Math.round(bgMusicVolume * 100)}%</span>
                      </div>
                    </div>

                    {/* Upload / Library sub-tabs */}
                    <div className="em-subtabs">
                      {[{ key: 'upload', label: '📤 Upload' }, { key: 'library', label: '🎵 Library' }].map(sub => (
                        <button key={sub.key} onClick={() => setMusicSourceTab(sub.key)}
                          className={`em-subtab${musicSourceTab === sub.key ? ' em-subtab-active' : ''}`}>
                          {sub.label}
                        </button>
                      ))}
                    </div>

                    {/* Upload sub-tab */}
                    {musicSourceTab === 'upload' && (
                      <div className="em-section">
                        <button className="em-upload-btn" onClick={() => bgMusicInputRef.current?.click()} disabled={editSaving}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                          Upload MP3 / WAV / M4A
                        </button>
                        <input ref={bgMusicInputRef} type="file"
                          accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a"
                          onChange={onUploadBgMusic} style={{ display: 'none' }} />
                        {bgMusicFileName ? (
                          <div className="em-music-file-card">
                            <span className="em-music-file-icon">🎵</span>
                            <div className="em-music-file-info">
                              <div className="em-music-file-name">{bgMusicFileName}</div>
                              {bgMusicFileDuration != null && (
                                <div className="em-music-file-dur">{fmtDur(Math.round(bgMusicFileDuration))}</div>
                              )}
                            </div>
                            <button className="em-remove-icon-btn" title="Remove" onClick={() => {
                              setBgMusicFile(null);
                              if (bgMusicFileUrl) { URL.revokeObjectURL(bgMusicFileUrl); setBgMusicFileUrl(null); }
                              setBgMusicFileName('');
                              setBgMusicFileDuration(null);
                            }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </div>
                        ) : (
                          <p className="em-empty-hint">No music file selected.</p>
                        )}
                      </div>
                    )}

                    {/* Library sub-tab */}
                    {musicSourceTab === 'library' && (
                      <div className="em-section">
                        <div className="em-genre-row">
                          {MUSIC_GENRES.map(g => (
                            <button key={g} onClick={() => setMusicLibraryGenre(g)}
                              className={`em-genre-pill ${musicLibraryGenre === g ? 'em-genre-active' : 'em-genre-idle'}`}>
                              {g}
                            </button>
                          ))}
                        </div>
                        <div className="em-track-list">
                          {DEFAULT_MUSIC_LIBRARY.filter(tr => musicLibraryGenre === 'All' || tr.genre === musicLibraryGenre).map(track => (
                            <div key={track.id}
                              onClick={() => setSelectedLibraryTrack(selectedLibraryTrack?.id === track.id ? null : track)}
                              className={`em-track ${selectedLibraryTrack?.id === track.id ? 'em-track-selected' : 'em-track-idle'}`}>
                              <div className="em-track-info">
                                <div className={`em-track-name${selectedLibraryTrack?.id === track.id ? ' em-track-name-sel' : ''}`}>{track.name}</div>
                                <div className="em-track-meta">{track.genre} · {fmtDur(track.duration)}</div>
                              </div>
                              <button className="em-track-play" title={previewingTrackId === track.id ? 'Stop' : 'Preview'}
                                onClick={(e) => { e.stopPropagation(); toggleTrackPreview(track); }}>
                                {previewingTrackId === track.id ? '⏹' : '▶'}
                              </button>
                            </div>
                          ))}
                        </div>
                        {selectedLibraryTrack && (
                          <div className="em-selected-badge">✓ {selectedLibraryTrack.name}</div>
                        )}
                      </div>
                    )}

                    {/* Music settings — shown when music is selected */}
                    {(bgMusicFileName || selectedLibraryTrack) && (
                      <div className="em-settings-card">
                        <div className="em-section-label">Timing &amp; Effects</div>
                        <div className="em-settings-grid">
                          {[
                            { label: 'Start in video (sec)', value: bgMusicStartInVideo, onChange: (v) => setBgMusicStartInVideo(Math.max(0, parseFloat(v) || 0)), placeholder: '0' },
                            { label: 'Trim start (sec)',     value: bgMusicTrimStart,    onChange: (v) => setBgMusicTrimStart(Math.max(0, parseFloat(v) || 0)),    placeholder: '0' },
                            { label: 'Trim end (sec)',       value: bgMusicTrimEnd,      onChange: (v) => setBgMusicTrimEnd(v),                                     placeholder: 'auto' },
                          ].map(({ label, value, onChange, placeholder }) => (
                            <div key={label}>
                              <div className="em-input-label">{label}</div>
                              <input type="number" min="0" step="1" value={value} placeholder={placeholder}
                                onChange={e => onChange(e.target.value)}
                                className="em-num-input" />
                            </div>
                          ))}
                        </div>
                        <div className="em-check-row">
                          {[
                            { checked: bgMusicFadeIn,  onChange: setBgMusicFadeIn,  label: 'Fade In'  },
                            { checked: bgMusicFadeOut, onChange: setBgMusicFadeOut, label: 'Fade Out' },
                            { checked: bgMusicLoop,    onChange: setBgMusicLoop,    label: 'Loop'     },
                          ].map(({ checked, onChange, label }) => (
                            <label key={label} className="em-check-label">
                              <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
                                style={{ accentColor: '#6366f1', width: 14, height: 14 }} />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                )}

              </div>
            </div>

            {/* Hidden audio for library preview */}
            <audio ref={previewAudioRef} style={{ display: 'none' }} onEnded={() => setPreviewingTrackId(null)} onError={() => setPreviewingTrackId(null)} />

            {/* ── Footer ── */}
            <div className="em-footer">
              <button className="em-btn-discard" onClick={closeEditModal} disabled={editSaving}>Discard</button>
              <button className="em-btn-save" onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? (
                  <><span className="em-spinner" />Rendering…</>
                ) : (
                  <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save &amp; Render</>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      <style>{`
        /* ── Recordings list ─────────────────────────────────────── */
        .rec-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 4px 0 24px;
        }

        .rec-card {
          display: flex;
          align-items: stretch;
          gap: 0;
          background: var(--surface, #16192a);
          border: 1px solid var(--border, rgba(255,255,255,0.07));
          border-radius: 14px;
          overflow: hidden;
          transition: box-shadow 0.2s, border-color 0.2s;
          box-shadow: 0 2px 12px rgba(0,0,0,0.18);
        }
        .rec-card:hover {
          box-shadow: 0 6px 28px rgba(0,0,0,0.35);
          border-color: rgba(99,102,241,0.35);
        }

        /* Thumbnail */
        .rec-thumb {
          flex-shrink: 0;
          width: 220px;
          min-width: 220px;
          background: #000;
          position: relative;
          cursor: pointer;
          overflow: hidden;
        }
        .rec-thumb-video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transition: transform 0.25s;
        }
        .rec-thumb:hover .rec-thumb-video {
          transform: scale(1.04);
        }
        .rec-thumb-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s;
        }
        .rec-thumb:hover .rec-thumb-overlay {
          background: rgba(0,0,0,0.45);
        }
        .rec-play-btn {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          background: rgba(99,102,241,0.9);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transform: scale(0.8);
          transition: opacity 0.2s, transform 0.2s;
          box-shadow: 0 4px 20px rgba(99,102,241,0.5);
        }
        .rec-thumb:hover .rec-play-btn {
          opacity: 1;
          transform: scale(1);
        }
        .rec-duration-badge {
          position: absolute;
          bottom: 7px;
          right: 8px;
          background: rgba(0,0,0,0.75);
          color: #fff;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 7px;
          border-radius: 5px;
          letter-spacing: 0.3px;
          pointer-events: none;
        }

        /* Info */
        .rec-info {
          flex: 1;
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 5px;
          min-width: 0;
          border-right: 1px solid var(--border, rgba(255,255,255,0.07));
        }
        .rec-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text, #eef2ff);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 2px;
        }
        .rec-meta {
          font-size: 12.5px;
          color: var(--text-muted, #8b99bd);
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: wrap;
        }
        .rec-meta-row {
          gap: 8px;
        }
        .rec-meta-sep {
          opacity: 0.4;
        }
        .rec-meta-label {
          color: var(--text-muted, #8b99bd);
          opacity: 0.65;
          margin-right: 2px;
        }
        .rec-meeting-id {
          background: rgba(99,102,241,0.12);
          color: #a5b4fc;
          padding: 1px 6px;
          border-radius: 5px;
          font-size: 11.5px;
        }

        /* Actions */
        .rec-actions {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 16px 18px;
          justify-content: center;
          align-items: stretch;
          min-width: 132px;
        }
        .rec-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 8px 14px;
          border-radius: 9px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: background 0.18s, transform 0.15s, box-shadow 0.18s;
          text-decoration: none;
          white-space: nowrap;
        }
        .rec-btn:hover { transform: translateY(-1px); }
        .rec-btn:active { transform: translateY(0); }

        .rec-btn-view {
          background: rgba(99,102,241,0.14);
          color: #818cf8;
          border: 1px solid rgba(99,102,241,0.25);
        }
        .rec-btn-view:hover {
          background: rgba(99,102,241,0.28);
          box-shadow: 0 4px 14px rgba(99,102,241,0.2);
        }

        .rec-btn-edit {
          background: rgba(251,191,36,0.1);
          color: #fbbf24;
          border: 1px solid rgba(251,191,36,0.22);
        }
        .rec-btn-edit:hover {
          background: rgba(251,191,36,0.22);
          box-shadow: 0 4px 14px rgba(251,191,36,0.15);
        }

        .rec-btn-download {
          background: rgba(34,197,94,0.1);
          color: #4ade80;
          border: 1px solid rgba(34,197,94,0.22);
        }
        .rec-btn-download:hover {
          background: rgba(34,197,94,0.22);
          box-shadow: 0 4px 14px rgba(34,197,94,0.15);
        }

        .rec-btn-delete {
          background: rgba(239,68,68,0.1);
          color: #f87171;
          border: 1px solid rgba(239,68,68,0.22);
        }
        .rec-btn-delete:hover {
          background: rgba(239,68,68,0.22);
          box-shadow: 0 4px 14px rgba(239,68,68,0.15);
        }

        /* ════════════════════════════════════════════════════
           Edit Modal  (.em-*)  — light + dark theme aware
           ════════════════════════════════════════════════════ */
        .em-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.55);
          backdrop-filter: blur(5px);
          display: flex; align-items: center; justify-content: center;
          z-index: 1200; padding: 16px; box-sizing: border-box;
        }
        .em-dialog {
          width: 100%; max-width: 1120px; max-height: 92vh;
          background: var(--surface, #fff);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 20px;
          box-shadow: 0 32px 80px rgba(0,0,0,0.22);
          display: flex; flex-direction: column; overflow: hidden;
        }
        /* Header */
        .em-header {
          flex-shrink: 0;
          display: flex; align-items: center; justify-content: space-between;
          padding: 15px 22px;
          border-bottom: 1px solid var(--border, #e2e8f0);
          background: var(--surface2, #f8fafc);
        }
        .em-header-title {
          font-size: 16px; font-weight: 700;
          color: var(--text, #1e293b);
          display: flex; align-items: center;
        }
        .em-header-sub {
          font-size: 12px; margin-top: 3px;
          color: var(--text-muted, #64748b);
        }
        .em-close-btn {
          width: 32px; height: 32px; border-radius: 50%;
          border: 1px solid var(--border, #e2e8f0);
          background: var(--surface3, #f1f5f9);
          color: var(--text-muted, #64748b);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: background 0.15s, color 0.15s;
        }
        .em-close-btn:hover { background: #fee2e2; color: #ef4444; border-color: #fca5a5; }
        .em-close-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        /* Body grid */
        .em-body {
          flex: 1; overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0,1.75fr) minmax(0,1fr);
        }
        .em-left {
          padding: 18px;
          border-right: 1px solid var(--border, #e2e8f0);
          overflow-y: auto;
        }
        .em-right {
          padding: 18px;
          color: var(--text, #1e293b);
          display: flex; flex-direction: column;
          overflow-y: auto;
        }
        /* Video area */
        .em-video-wrap {
          background: #000;
          border-radius: 12px; overflow: hidden;
          position: relative;
          box-shadow: 0 6px 24px rgba(0,0,0,0.3);
        }
        .em-video {
          width: 100%; display: block;
          max-height: 42vh; object-fit: contain;
        }
        /* Controls card below video */
        .em-controls-card {
          margin-top: 12px;
          background: var(--surface2, #f8fafc);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 12px;
          padding: 12px 16px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .em-controls-top {
          display: flex; align-items: center; gap: 10px;
        }
        .em-play-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 16px; border-radius: 8px; border: none;
          background: #6366f1; color: #fff;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: background 0.15s, transform 0.1s;
          box-shadow: 0 2px 8px rgba(99,102,241,0.3);
        }
        .em-play-btn:hover { background: #4f46e5; transform: translateY(-1px); }
        .em-controls-hint {
          font-size: 12px; color: var(--text-muted, #64748b);
        }
        .em-vol-row {
          display: flex; align-items: center; gap: 8px;
        }
        .em-vol-icon { flex-shrink: 0; opacity: 0.55; }
        .em-vol-label {
          font-size: 12px; color: var(--text-muted, #64748b);
          min-width: 72px; white-space: nowrap;
        }
        .em-range { flex: 1; cursor: pointer; }
        .em-range-purple { accent-color: #6366f1; }
        .em-range-amber  { accent-color: #f59e0b; }
        .em-vol-pct {
          font-size: 12px; color: var(--text-muted, #64748b);
          min-width: 38px; text-align: right; font-variant-numeric: tabular-nums;
        }
        /* Tabs */
        .em-tabs {
          display: flex; gap: 4px;
          background: var(--surface3, #f1f5f9);
          border-radius: 10px; padding: 4px;
          margin-bottom: 16px; flex-shrink: 0;
        }
        .em-tab {
          flex: 1; border: none; border-radius: 7px; padding: 8px 0;
          font-size: 13px; font-weight: 500; cursor: pointer;
          background: none; color: var(--text-muted, #64748b);
          transition: background 0.15s, color 0.15s;
        }
        .em-tab-active {
          background: #6366f1; color: #fff; font-weight: 700;
          box-shadow: 0 2px 8px rgba(99,102,241,0.35);
        }
        /* Tab content */
        .em-tab-content { display: flex; flex-direction: column; flex: 1; }
        .em-section { margin-bottom: 18px; }
        .em-section-label {
          font-size: 11px; font-weight: 700; letter-spacing: 0.6px;
          text-transform: uppercase; color: var(--text-dim, #94a3b8);
          margin-bottom: 8px;
        }
        /* Upload button */
        .em-upload-btn {
          width: 100%; display: flex; align-items: center; justify-content: center; gap: 7px;
          padding: 9px 12px; border-radius: 9px;
          border: 1.5px dashed var(--border-light, #cbd5e1);
          background: var(--surface2, #f8fafc);
          color: var(--text-muted, #64748b);
          font-size: 13px; font-weight: 500; cursor: pointer;
          transition: border-color 0.15s, color 0.15s, background 0.15s;
          margin-bottom: 10px;
        }
        .em-upload-btn:hover {
          border-color: #6366f1; color: #6366f1;
          background: rgba(99,102,241,0.05);
        }
        .em-upload-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        /* Preview card */
        .em-preview-card {
          border-radius: 10px; overflow: hidden;
          border: 1px solid var(--border, #e2e8f0);
          background: var(--surface2, #f8fafc);
          padding: 10px; display: flex; flex-direction: column; gap: 6px;
          margin-bottom: 4px;
        }
        .em-preview-img {
          width: 100%; max-height: 100px; object-fit: contain; display: block;
          border-radius: 6px;
        }
        .em-remove-btn {
          align-self: flex-start;
          background: none; border: none; padding: 0;
          font-size: 11px; color: #ef4444; cursor: pointer; font-weight: 600;
        }
        .em-remove-btn:hover { color: #dc2626; }
        /* Empty / hint text */
        .em-empty-hint {
          font-size: 12px; color: var(--text-dim, #94a3b8);
          margin: 0 0 4px;
        }
        .em-hint-text {
          font-size: 11px; color: var(--text-dim, #94a3b8); margin: 0;
        }
        /* Radio group */
        .em-radio-group {
          display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
        }
        .em-radio-label {
          display: flex; align-items: center; gap: 7px;
          font-size: 12px; cursor: pointer;
          padding: 7px 10px; border-radius: 8px;
          border: 1px solid var(--border, #e2e8f0);
          background: var(--surface2, #f8fafc);
          color: var(--text, #1e293b);
          transition: border-color 0.15s, background 0.15s;
          user-select: none;
        }
        .em-radio-label:has(input:checked) {
          border-color: #6366f1;
          background: rgba(99,102,241,0.07);
          color: #6366f1; font-weight: 600;
        }
        .em-divider {
          border: none; border-top: 1px solid var(--border, #e2e8f0);
          margin: 4px 0 18px;
        }
        /* Music sub-tabs */
        .em-subtabs {
          display: flex; background: var(--surface3, #f1f5f9);
          border-radius: 8px; overflow: hidden; margin-bottom: 14px;
        }
        .em-subtab {
          flex: 1; border: none; padding: 8px 0; font-size: 12px; font-weight: 500;
          cursor: pointer; background: none;
          color: var(--text-muted, #64748b);
          transition: background 0.15s, color 0.15s;
        }
        .em-subtab-active {
          background: rgba(99,102,241,0.18); color: #6366f1; font-weight: 700;
        }
        /* Volume card */
        .em-vol-card {
          background: var(--surface2, #f8fafc);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 12px; padding: 13px 15px; margin-bottom: 14px;
        }
        /* Genre pills */
        .em-genre-row { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
        .em-genre-pill {
          border: none; border-radius: 20px; padding: 3px 11px; font-size: 11px;
          cursor: pointer; transition: background 0.15s, color 0.15s; font-weight: 500;
        }
        .em-genre-active { background: #6366f1; color: #fff; }
        .em-genre-idle {
          background: var(--surface3, #f1f5f9);
          color: var(--text-muted, #64748b);
        }
        .em-genre-idle:hover { background: var(--border, #e2e8f0); }
        /* Track list */
        .em-track-list {
          display: flex; flex-direction: column; gap: 5px;
          max-height: 188px; overflow-y: auto;
          margin-bottom: 8px; padding-right: 2px;
        }
        .em-track {
          display: flex; align-items: center; justify-content: space-between;
          border-radius: 9px; padding: 9px 11px; cursor: pointer;
          border: 1px solid transparent;
          transition: background 0.12s, border-color 0.12s;
        }
        .em-track-idle { background: var(--surface2, #f8fafc); }
        .em-track-idle:hover { background: var(--surface3, #f1f5f9); }
        .em-track-selected {
          background: rgba(99,102,241,0.09);
          border-color: rgba(99,102,241,0.35);
        }
        .em-track-info { flex: 1; min-width: 0; }
        .em-track-name {
          font-size: 13px; color: var(--text, #1e293b);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .em-track-name-sel { color: #6366f1; font-weight: 600; }
        .em-track-meta { font-size: 11px; color: var(--text-dim, #94a3b8); margin-top: 1px; }
        .em-track-play {
          width: 30px; height: 30px; border-radius: 50%; border: none; cursor: pointer;
          background: var(--surface3, #f1f5f9); color: #6366f1;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; flex-shrink: 0; margin-left: 8px;
          transition: background 0.12s;
        }
        .em-track-play:hover { background: rgba(99,102,241,0.15); }
        .em-selected-badge {
          font-size: 12px; color: #6366f1; font-weight: 600;
          padding: 5px 8px;
          background: rgba(99,102,241,0.08); border-radius: 6px;
        }
        /* Music file card */
        .em-music-file-card {
          display: flex; align-items: center; gap: 10px;
          background: rgba(99,102,241,0.07);
          border: 1px solid rgba(99,102,241,0.25);
          border-radius: 10px; padding: 10px 13px; margin-top: 4px;
        }
        .em-music-file-icon { font-size: 20px; flex-shrink: 0; }
        .em-music-file-info { flex: 1; min-width: 0; }
        .em-music-file-name {
          font-size: 13px; font-weight: 600; color: var(--text, #1e293b);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .em-music-file-dur { font-size: 11px; color: var(--text-muted, #64748b); margin-top: 2px; }
        .em-remove-icon-btn {
          background: none; border: none; cursor: pointer;
          color: var(--text-dim, #94a3b8); padding: 4px;
          border-radius: 5px; display: flex; align-items: center;
          transition: color 0.12s, background 0.12s;
        }
        .em-remove-icon-btn:hover { color: #ef4444; background: #fee2e2; }
        /* Settings card */
        .em-settings-card {
          border-top: 1px solid var(--border, #e2e8f0);
          padding-top: 14px; margin-top: 4px;
        }
        .em-settings-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;
        }
        .em-input-label {
          font-size: 10px; color: var(--text-dim, #94a3b8); margin-bottom: 3px;
          text-transform: uppercase; letter-spacing: 0.4px;
        }
        .em-num-input {
          width: 100%;
          background: var(--surface2, #f8fafc);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 7px; padding: 6px 9px;
          color: var(--text, #1e293b); font-size: 12px;
          box-sizing: border-box; outline: none;
          transition: border-color 0.15s;
        }
        .em-num-input:focus { border-color: #6366f1; }
        .em-check-row { display: flex; flex-wrap: wrap; gap: 14px; }
        .em-check-label {
          display: flex; align-items: center; gap: 7px;
          font-size: 13px; cursor: pointer; user-select: none;
          color: var(--text, #1e293b);
        }
        /* Footer */
        .em-footer {
          flex-shrink: 0;
          display: flex; gap: 10px; padding: 13px 22px;
          justify-content: flex-end; flex-wrap: wrap;
          border-top: 1px solid var(--border, #e2e8f0);
          background: var(--surface2, #f8fafc);
        }
        .em-btn-discard {
          padding: 8px 20px; border-radius: 9px;
          border: 1px solid var(--border-light, #cbd5e1);
          background: var(--surface, #fff);
          color: var(--text, #1e293b);
          font-size: 14px; font-weight: 500; cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .em-btn-discard:hover { background: var(--surface3, #f1f5f9); border-color: #94a3b8; }
        .em-btn-discard:disabled { opacity: 0.45; cursor: not-allowed; }
        .em-btn-save {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 8px 22px; border-radius: 9px; border: none;
          background: linear-gradient(135deg, #6366f1, #4f46e5);
          color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;
          box-shadow: 0 4px 14px rgba(99,102,241,0.35);
          transition: opacity 0.15s, transform 0.1s;
        }
        .em-btn-save:hover { opacity: 0.88; transform: translateY(-1px); }
        .em-btn-save:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        /* Spinner */
        .em-spinner {
          display: inline-block; width: 13px; height: 13px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: em-spin 0.7s linear infinite;
        }
        @keyframes em-spin { to { transform: rotate(360deg); } }
        /* Responsive */
        @media (max-width: 860px) {
          .em-body { grid-template-columns: 1fr !important; }
          .em-left { border-right: none !important; border-bottom: 1px solid var(--border, #e2e8f0); }
          .em-video { max-height: 35vh; }
        }
        /* Dark mode overrides */
        [data-theme="dark"] .em-dialog {
          background: #13132a;
          border-color: #2a2a4a;
          box-shadow: 0 32px 80px rgba(0,0,0,0.55);
        }
        [data-theme="dark"] .em-header {
          background: #1c1c35;
          border-color: #2a2a4a;
        }
        [data-theme="dark"] .em-header-title { color: #e8eaf6; }
        [data-theme="dark"] .em-header-sub   { color: #8b8fad; }
        [data-theme="dark"] .em-close-btn {
          background: rgba(255,255,255,0.07);
          border-color: #35355a; color: #8b8fad;
        }
        [data-theme="dark"] .em-close-btn:hover { background: rgba(239,68,68,0.15); color: #f87171; border-color: rgba(239,68,68,0.3); }
        [data-theme="dark"] .em-left  { border-color: #2a2a4a; }
        [data-theme="dark"] .em-right { color: #e8eaf6; }
        [data-theme="dark"] .em-controls-card {
          background: rgba(255,255,255,0.04);
          border-color: #2a2a4a;
        }
        [data-theme="dark"] .em-controls-hint { color: #8b8fad; }
        [data-theme="dark"] .em-vol-label { color: #8b8fad; }
        [data-theme="dark"] .em-vol-pct   { color: #8b8fad; }
        [data-theme="dark"] .em-tabs { background: rgba(255,255,255,0.05); }
        [data-theme="dark"] .em-tab  { color: #8b8fad; }
        [data-theme="dark"] .em-section-label { color: #5a5e7a; }
        [data-theme="dark"] .em-upload-btn {
          border-color: #35355a;
          background: rgba(255,255,255,0.03);
          color: #8b8fad;
        }
        [data-theme="dark"] .em-upload-btn:hover { border-color: #6366f1; color: #a5b4fc; background: rgba(99,102,241,0.08); }
        [data-theme="dark"] .em-preview-card { background: rgba(255,255,255,0.05); border-color: #35355a; }
        [data-theme="dark"] .em-empty-hint { color: #5a5e7a; }
        [data-theme="dark"] .em-hint-text  { color: #5a5e7a; }
        [data-theme="dark"] .em-radio-label { background: rgba(255,255,255,0.03); border-color: #2a2a4a; color: #c8cce8; }
        [data-theme="dark"] .em-radio-label:has(input:checked) { background: rgba(99,102,241,0.15); color: #a5b4fc; border-color: rgba(99,102,241,0.45); }
        [data-theme="dark"] .em-divider { border-color: #2a2a4a; }
        [data-theme="dark"] .em-subtabs { background: rgba(255,255,255,0.05); }
        [data-theme="dark"] .em-subtab { color: #8b8fad; }
        [data-theme="dark"] .em-subtab-active { background: rgba(99,102,241,0.25); color: #a5b4fc; }
        [data-theme="dark"] .em-vol-card { background: rgba(255,255,255,0.04); border-color: #2a2a4a; }
        [data-theme="dark"] .em-genre-idle { background: rgba(255,255,255,0.07); color: #8b8fad; }
        [data-theme="dark"] .em-genre-idle:hover { background: rgba(255,255,255,0.12); }
        [data-theme="dark"] .em-track-idle { background: rgba(255,255,255,0.04); }
        [data-theme="dark"] .em-track-idle:hover { background: rgba(255,255,255,0.07); }
        [data-theme="dark"] .em-track-selected { background: rgba(99,102,241,0.18); border-color: rgba(99,102,241,0.45); }
        [data-theme="dark"] .em-track-name { color: #c8cce8; }
        [data-theme="dark"] .em-track-name-sel { color: #a5b4fc; }
        [data-theme="dark"] .em-track-meta { color: #5a5e7a; }
        [data-theme="dark"] .em-track-play { background: rgba(255,255,255,0.08); }
        [data-theme="dark"] .em-track-play:hover { background: rgba(99,102,241,0.3); }
        [data-theme="dark"] .em-selected-badge { background: rgba(99,102,241,0.15); color: #a5b4fc; }
        [data-theme="dark"] .em-music-file-card { background: rgba(99,102,241,0.12); border-color: rgba(99,102,241,0.3); }
        [data-theme="dark"] .em-music-file-name { color: #e8eaf6; }
        [data-theme="dark"] .em-music-file-dur  { color: #8b8fad; }
        [data-theme="dark"] .em-remove-icon-btn { color: #5a5e7a; }
        [data-theme="dark"] .em-remove-icon-btn:hover { color: #f87171; background: rgba(239,68,68,0.12); }
        [data-theme="dark"] .em-settings-card { border-color: #2a2a4a; }
        [data-theme="dark"] .em-input-label { color: #5a5e7a; }
        [data-theme="dark"] .em-num-input {
          background: rgba(255,255,255,0.05);
          border-color: #35355a; color: #e8eaf6;
        }
        [data-theme="dark"] .em-num-input:focus { border-color: #6366f1; }
        [data-theme="dark"] .em-check-label { color: #c8cce8; }
        [data-theme="dark"] .em-footer {
          background: #1c1c35;
          border-color: #2a2a4a;
        }
        [data-theme="dark"] .em-btn-discard {
          background: rgba(255,255,255,0.05);
          border-color: #35355a; color: #c8cce8;
        }
        [data-theme="dark"] .em-btn-discard:hover { background: rgba(255,255,255,0.1); border-color: #5a5e7a; }

        /* ── Card responsive ─────────────────────────────────── */
        @media (max-width: 700px) {
          .rec-card {
            flex-direction: column;
          }
          .rec-thumb {
            width: 100%;
            min-width: unset;
            height: 200px;
          }
          .rec-info {
            border-right: none;
            border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
          }
          .rec-actions {
            flex-direction: row;
            flex-wrap: wrap;
            padding: 12px 16px;
            min-width: unset;
          }
          .rec-btn {
            flex: 1;
            min-width: 80px;
          }
        }

        /* ── Count label ─────────────────────────────────────────── */
        .rec-count-label {
          font-size: 12.5px;
          color: var(--text-muted, #8b99bd);
          margin-bottom: 10px;
          padding-left: 2px;
        }

        /* ── Pagination ──────────────────────────────────────────── */
        .rec-pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 28px 0 8px;
        }

        .rec-page-numbers {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .rec-page-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          border-radius: 50px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.04);
          color: var(--text-muted, #a0aec0);
          font-size: 13.5px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.18s, border-color 0.18s, color 0.18s, transform 0.15s, box-shadow 0.18s;
          user-select: none;
        }
        .rec-page-btn:hover:not(:disabled):not(.rec-page-active) {
          background: rgba(99,102,241,0.12);
          border-color: rgba(99,102,241,0.3);
          color: #c7d2fe;
          transform: translateY(-1px);
        }
        .rec-page-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        .rec-page-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
          pointer-events: none;
        }
        .rec-page-btn:focus-visible {
          outline: 2px solid rgba(99,102,241,0.6);
          outline-offset: 2px;
        }

        .rec-page-active {
          background: linear-gradient(135deg, #6366f1, #4f46e5);
          border-color: transparent;
          color: #fff;
          font-weight: 700;
          box-shadow: 0 4px 14px rgba(99,102,241,0.4);
          cursor: default;
          pointer-events: none;
        }

        .rec-page-prev,
        .rec-page-next {
          min-width: 40px;
          height: 40px;
          border-radius: 50%;
        }

        .rec-page-ellipsis {
          min-width: 32px;
          text-align: center;
          color: var(--text-muted, #8b99bd);
          font-size: 15px;
          opacity: 0.5;
          user-select: none;
          pointer-events: none;
        }

        @media (max-width: 700px) {
          .rec-page-numbers .rec-page-num:not(.rec-page-active):not(:first-child):not(:last-child) {
            display: none;
          }
          .rec-page-numbers .rec-page-ellipsis {
            display: none;
          }
          .rec-pagination::before {
            content: attr(data-label);
            font-size: 13px;
            color: var(--text-muted, #8b99bd);
          }
        }
      `}</style>
    </div>
  );
}
