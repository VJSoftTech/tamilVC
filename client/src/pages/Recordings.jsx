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

const renderEditedBlob = async ({ sourceUrl, watermarkDataUrl, position, introDataUrl, introOutroPosition }) => {
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
  try {
    const sourceNode = audioCtx.createMediaElementSource(video);
    sourceNode.connect(dest);
    sourceNode.connect(audioCtx.destination);
  } catch {
    // Ignore if media node cannot be attached; output will contain only video.
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

  // Phase 1: Intro image segment
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
  const blob = await blobPromise;
  mixedStream.getTracks().forEach((t) => t.stop());
  video.src = '';

  const extraSecs = (hasIntro ? 5 : 0) + (hasOutro ? 5 : 0);
  return { blob, duration: Math.max(1, Math.round((video.duration || 0) + extraSecs)) };
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
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 8;
  const recListRef = useRef(null);
  const videoPreviewRef = useRef(null);
  const watermarkInputRef = useRef(null);
  const introOutroInputRef = useRef(null);

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
  };

  const closeEditModal = () => {
    if (editSaving) return;
    setEditingRec(null);
    setEditWatermark('');
    setEditPosition('bottom-right');
    setEditIntroOutro('');
    setEditIntroOutroPosition('front');
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
    if (!editingRec || (!editWatermark && !editIntroOutro)) {
      alert('Upload a watermark or intro/outro image before saving.');
      return;
    }

    setEditSaving(true);
    try {
      const sourceUrl = urlWithToken(editingRec.download_url);
      const { blob, duration } = await renderEditedBlob({
        sourceUrl,
        watermarkDataUrl: editWatermark || null,
        position: editPosition,
        introDataUrl: editIntroOutro || null,
        introOutroPosition: editIntroOutroPosition,
      });

      const fd = new FormData();
      fd.append('recording', blob, `recording_${editingRec.meetingId || editingRec.meeting_id}_${Date.now()}.webm`);
      fd.append('meeting_id', editingRec.meetingId || editingRec.meeting_id);
      fd.append('duration', duration || editingRec.duration || 0);

      await recordingAPI.save(fd);
      await recordingAPI.delete(editingRec.id);
      await loadRecordings();
      closeEditModal();
    } catch (err) {
      console.error(err);
      alert('Failed to edit recording.');
    } finally {
      setEditSaving(false);
    }
  };

  const fmtDur = (s) => {
    if (!s) return '-';
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
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
                {/* <button
                  className="rec-btn rec-btn-edit"
                  onClick={() => openEditModal(r)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  Edit
                </button> */}
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
        <div
          onClick={closeEditModal}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(4,8,18,0.75)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 1100,
              background: 'linear-gradient(180deg, rgba(20,27,42,0.98), rgba(14,19,33,0.98))',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 18,
              boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
              overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.12)',
              color: '#eef2ff',
            }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>Edit Recording</div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{editingRec.title}</div>
              </div>
              <button
                onClick={closeEditModal}
                disabled={editSaving}
                style={{
                  border: 'none',
                  background: 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  borderRadius: 10,
                  width: 34,
                  height: 34,
                  cursor: editSaving ? 'not-allowed' : 'pointer',
                }}
              >
                X
              </button>
            </div>

            <div className="recording-edit-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.8fr) minmax(0,1fr)' }}>
              <div style={{ padding: 18, borderRight: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{
                  background: '#000',
                  borderRadius: 14,
                  overflow: 'hidden',
                  position: 'relative',
                  minHeight: 260,
                }}>
                  <video
                    ref={videoPreviewRef}
                    src={urlWithToken(editingRec.download_url)}
                    controls
                    onPlay={() => setEditPlaying(true)}
                    onPause={() => setEditPlaying(false)}
                    onLoadedMetadata={(e) => { e.currentTarget.volume = editVolume; }}
                    style={{ width: '100%', display: 'block', maxHeight: '62vh' }}
                  />
                  {editWatermark && (
                    <img src={editWatermark} alt="watermark preview" style={getOverlayStyle(editPosition)} />
                  )}
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                  <button className="btn btn-outline" onClick={togglePreviewPlay}>
                    {editPlaying ? 'Pause' : 'Play'}
                  </button>
                  <button className="btn btn-outline" onClick={() => setPreviewVolume(editVolume + 0.1)}>Vol +</button>
                  <button className="btn btn-outline" onClick={() => setPreviewVolume(editVolume - 0.1)}>Vol -</button>
                  <span style={{ color: '#b6c1da', fontSize: 12, alignSelf: 'center' }}>
                    Volume: {Math.round(editVolume * 100)}%
                  </span>
                </div>
              </div>

              <div style={{ padding: 18, color: '#dbe5ff' }}>
                <div style={{ fontSize: 12, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                  Watermark Image
                </div>
                <button
                  className="btn btn-outline"
                  onClick={() => watermarkInputRef.current?.click()}
                  style={{ marginBottom: 10 }}
                >
                  Upload Image
                </button>
                <input
                  ref={watermarkInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onUploadWatermark}
                  style={{ display: 'none' }}
                />

                {editWatermark ? (
                  <div style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 12,
                    padding: 10,
                    marginBottom: 18,
                  }}>
                    <img src={editWatermark} alt="selected watermark" style={{ width: '100%', maxHeight: 140, objectFit: 'contain' }} />
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#95a3c9', marginBottom: 18 }}>
                    No watermark selected yet.
                  </div>
                )}

                <div style={{ fontSize: 12, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                  Position
                </div>
                <div style={{ display: 'grid', gap: 8, marginBottom: 18 }}>
                  {POSITION_OPTIONS.map((opt) => (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <input
                        type="radio"
                        name="wm-position"
                        value={opt.value}
                        checked={editPosition === opt.value}
                        onChange={(e) => setEditPosition(e.target.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 4, paddingTop: 16 }}>
                  <div style={{ fontSize: 12, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                    Intro / Outro Image
                  </div>
                  <button
                    className="btn btn-outline"
                    onClick={() => introOutroInputRef.current?.click()}
                    style={{ marginBottom: 10 }}
                    disabled={editSaving}
                  >
                    Upload Image
                  </button>
                  <input
                    ref={introOutroInputRef}
                    type="file"
                    accept="image/*"
                    onChange={onUploadIntroOutro}
                    style={{ display: 'none' }}
                  />

                  {editIntroOutro ? (
                    <div style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 12,
                      padding: 10,
                      marginBottom: 12,
                    }}>
                      <img src={editIntroOutro} alt="intro/outro preview" style={{ width: '100%', maxHeight: 120, objectFit: 'contain' }} />
                      <button
                        onClick={() => setEditIntroOutro('')}
                        style={{ marginTop: 6, background: 'none', border: 'none', color: '#f87171', fontSize: 11, cursor: 'pointer', padding: 0 }}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#95a3c9', marginBottom: 12 }}>
                      No intro/outro image selected.
                    </div>
                  )}

                  {editIntroOutro && (
                    <>
                      <div style={{ fontSize: 12, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                        Display Position
                      </div>
                      <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
                        {INTRO_OUTRO_OPTIONS.map((opt) => (
                          <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                            <input
                              type="radio"
                              name="io-position"
                              value={opt.value}
                              checked={editIntroOutroPosition === opt.value}
                              onChange={(e) => setEditIntroOutroPosition(e.target.value)}
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, color: '#7080a0', marginBottom: 4 }}>
                        Each segment plays for 5 seconds.
                      </div>
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={handleSaveEdit} disabled={editSaving}>
                    {editSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button className="btn btn-outline" onClick={closeEditModal} disabled={editSaving}>
                    Discard
                  </button>
                </div>
              </div>
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

        /* ── Edit modal responsive ──────────────────────────── */
        @media (max-width: 900px) {
          .recording-edit-grid {
            grid-template-columns: 1fr !important;
          }
        }

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
