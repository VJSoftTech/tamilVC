import React, { useEffect, useState } from 'react';
import { recordingAPI } from '../services/api.js';
import { useTranslation } from 'react-i18next';

export default function Recordings() {
  const { t } = useTranslation();
  const [recs,       setRecs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [viewingRec, setViewingRec] = useState(null);

  useEffect(() => {
    recordingAPI.getAll()
      .then(r => setRecs(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm(t('pages.recordings.confirmDelete'))) return;
    await recordingAPI.delete(id);
    setRecs(r => r.filter(x => x.id !== id));
  };

  const urlWithToken = (url) => {
    const token = localStorage.getItem('token');
    if (!token || !url) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${token}`;
  };

  const fmtDur  = (s) => { if (!s) return '—'; const m = Math.floor(s/60); return `${m}:${(s%60).toString().padStart(2,'0')}`; };
  const fmtSize = (b) => { if (!b) return '—'; return b > 1e6 ? (b/1e6).toFixed(1)+' MB' : (b/1e3).toFixed(0)+' KB'; };
  const fmt     = (dt) => dt ? new Date(dt).toLocaleString() : '—';

  return (
    <div>
      <div className="page-header">
        <h2>⏺️ {t('pages.recordings.title')}</h2>
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
                {recs.map(r => (
                  <tr key={r.id}>
                    <td>{r.title}</td>
                    <td><code>{r.meetingId || r.meeting_id}</code></td>
                    <td>{fmt(r.recordedAt || r.recorded_at)}</td>
                    <td>{fmtDur(r.duration)}</td>
                    <td>{fmtSize(r.fileSize || r.file_size)}</td>
                    <td>
                      <div className="flex-row" style={{ gap: 6 }}>
                        <button
                          className="btn btn-outline"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => setViewingRec({ ...r, url: urlWithToken(r.download_url) })}>
                          ▶ {t('common.view')}
                        </button>
                        <a href={urlWithToken(r.download_url)} download
                          className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }}>⬇ {t('common.download')}</a>
                        <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => handleDelete(r.id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Video Player Modal */}
      {viewingRec && (
        <div
          onClick={() => setViewingRec(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 24,
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface, #1e1e2e)', borderRadius: 16,
              width: '100%', maxWidth: 860,
              boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
              overflow: 'hidden',
            }}>
            {/* Modal header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{viewingRec.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 2 }}>
                  {fmt(viewingRec.recordedAt || viewingRec.recorded_at)}
                  {viewingRec.duration ? ` · ${fmtDur(viewingRec.duration)}` : ''}
                  {viewingRec.fileSize || viewingRec.file_size ? ` · ${fmtSize(viewingRec.fileSize || viewingRec.file_size)}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a href={viewingRec.url} download
                  className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 13 }}>
                  ⬇ {t('common.download')}
                </a>
                <button
                  onClick={() => setViewingRec(null)}
                  style={{
                    background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff',
                    borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 16,
                  }}>✕</button>
              </div>
            </div>

            {/* Video player */}
            <div style={{ background: '#000', lineHeight: 0 }}>
              <video
                src={viewingRec.url}
                controls
                autoPlay
                style={{ width: '100%', maxHeight: '60vh', display: 'block' }}
              />
            </div>

            {/* Volume / playback controls hint */}
            <div style={{
              padding: '12px 20px', fontSize: 12,
              color: 'var(--text-muted, #888)',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', gap: 20, flexWrap: 'wrap',
            }}>
              <span>🔊 {t('pages.recordings.hintVolume')}</span>
              <span>⌨️ {t('pages.recordings.hintKeys')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}