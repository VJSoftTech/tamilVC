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
  const fmt = (dt) => (dt ? new Date(dt).toLocaleString() : '-');

  return (
    <div>
      <div className="page-header">
        <h2>Recordings</h2>
        <p>{t('pages.recordings.subtitle')}</p>
      </div>
      <div className="card">
        {loading ? (
          <p className="text-muted">{t('pages.recordings.loading')}</p>
        ) : recs.length === 0 ? (
          <p className="text-muted">{t('pages.recordings.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.title')}</th><th>{t('common.meetingId')}</th><th>{t('common.date')}</th>
                  <th>{t('common.duration')}</th><th>{t('common.size')}</th><th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {recs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: 'grid', gap: 6 }}>
                        <span>{r.title}</span>
                        <div style={{ marginTop: 4, maxWidth: 320, borderRadius: 10, overflow: 'hidden', background: '#000' }}>
                          <video controls preload="metadata" style={{ width: '100%', display: 'block' }}>
                            <source src={urlWithToken(r.download_url)} />
                          </video>
                        </div>
                      </div>
                    </td>
                    <td><code>{r.meetingId || r.meeting_id}</code></td>
                    <td>{fmt(r.recordedAt || r.recorded_at)}</td>
                    <td>{fmtDur(r.duration)}</td>
                    <td>{fmtSize(r.fileSize || r.file_size)}</td>
                    <td>
                      <div className="flex-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-outline"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => setViewingRec({ ...r, url: urlWithToken(r.download_url) })}
                        >
                          View
                        </button>
                        <button
                          className="btn btn-outline"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => openEditModal(r)}
                        >
                          Edit
                        </button>
                        <a
                          href={urlWithToken(r.download_url)}
                          download
                          className="btn btn-primary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                        >
                          {t('common.download')}
                        </a>
                        <button
                          className="btn btn-danger"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => handleDelete(r.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
        @media (max-width: 900px) {
          .recording-edit-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
