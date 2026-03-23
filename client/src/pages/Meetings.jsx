import React, { useEffect, useState } from 'react';
import { meetingAPI } from '../services/api.js';
import { useTranslation } from 'react-i18next';

export default function Meetings() {
  const { t } = useTranslation();
  const [meetings, setMeetings] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    meetingAPI.getAll()
      .then(r => setMeetings(r.data.data || r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const statusBadge = (s) => {
    const map = { active: 'badge-green', waiting: 'badge-orange', ended: 'badge-red' };
    return <span className={`badge ${map[s] || 'badge-blue'}`}>{s}</span>;
  };

  const fmt = (dt) => dt ? new Date(dt).toLocaleString() : '—';

  return (
    <div>
      <div className="page-header">
        <h2>📋 {t('pages.meetings.title')}</h2>
        <p>{t('pages.meetings.subtitle')}</p>
      </div>
      <div className="card">
        {loading ? (
          <p className="text-muted">{t('pages.meetings.loading')}</p>
        ) : meetings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <p>{t('pages.meetings.empty')}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.title')}</th><th>{t('common.meetingId')}</th><th>{t('common.host')}</th>
                  <th>{t('common.date')}</th><th>{t('common.participants')}</th><th>{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map(m => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 500 }}>{m.title}</td>
                    <td><code>{m.meeting_id || m.meetingId}</code></td>
                    <td style={{ color: 'var(--text-muted)' }}>{m.host?.name || '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{fmt(m.created_at || m.createdAt)}</td>
                    <td style={{ textAlign: 'center' }}>{m.participants?.length ?? 0}</td>
                    <td>{statusBadge(m.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}