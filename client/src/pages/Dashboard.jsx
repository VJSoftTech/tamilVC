import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { meetingAPI } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTranslation } from 'react-i18next';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t }    = useTranslation();
  const [stats,   setStats]   = useState({ total_created: 0, total_joined: 0, total_recordings: 0, total_users: 0, upcoming: [] });
  const [loading, setLoading] = useState(true);
  const isAdmin = user?.userType === 'admin';

  useEffect(() => {
    meetingAPI.getStats()
      .then(r => setStats(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const fmt = (dt) => dt ? new Date(dt).toLocaleString() : '—';

  return (
    <div>
      <div className="page-header">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="dashboard-avatar">{user?.avatar ? <img src={user.avatar} alt={user?.name || 'User'} className="avatar-img" /> : user?.name?.[0]?.toUpperCase()}</span>
          <span>{t('pages.dashboard.welcomeBack', { name: user?.name?.split(' ')[0] || '' })}</span>
        </h2>
        <p>{t('pages.dashboard.overview')}</p>
      </div>

      <div className="dashboard-actions">
        <button className="dashboard-action-card action-new" onClick={() => navigate('/new-meeting')}>
          <span className="action-badge">{t('pages.dashboard.startNow', { defaultValue: 'Start now' })}</span>
          <span className="action-icon" aria-hidden="true">📹</span>
          <h3>{t('nav.newMeeting')}</h3>
          <p>{t('pages.newMeeting.instantDesc')}</p>
        </button>

        <button className="dashboard-action-card action-join" onClick={() => navigate('/join-meeting')}>
          <span className="action-badge">{t('pages.dashboard.jumpIn', { defaultValue: 'Jump in fast' })}</span>
          <span className="action-icon" aria-hidden="true">🔗</span>
          <h3>{t('nav.joinMeeting')}</h3>
          <p>{t('pages.joinMeeting.subtitle')}</p>
        </button>
      </div>

      <div className={`stats-grid ${isAdmin ? '' : 'dashboard-stats-grid'}`.trim()}>
        {[
          { label: t('pages.dashboard.cards.created'), value: stats.total_created, icon: '📹' },
          { label: t('pages.dashboard.cards.recordings'), value: stats.total_recordings, icon: '⏺️' },
          ...(isAdmin ? [{ label: t('pages.dashboard.cards.users'), value: stats.total_users, icon: '👥' }] : []),
        ].map(s => (
          <div className="stat-card" key={s.label}>
            <span className="stat-label">{s.icon} {s.label}</span>
            <span className="stat-value">{loading ? '…' : s.value}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title">📅 {t('pages.dashboard.upcoming')}</div>
        {loading ? (
          <p className="text-muted">{t('common.loading')}</p>
        ) : stats.upcoming.length === 0 ? (
          <p className="text-muted">
            {t('pages.dashboard.noUpcoming')}{' '}
            <span style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}
              onClick={() => navigate('/new-meeting')}>
              {t('pages.dashboard.scheduleOne')}
            </span>
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('common.title')}</th><th>{t('common.meetingId')}</th><th>{t('common.scheduledAt')}</th><th>{t('common.action')}</th></tr></thead>
              <tbody>
                {stats.upcoming.map(m => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 500 }}>
                      <div>{m.title}</div>
                      {m.subTitle && <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 2 }}>{m.subTitle}</div>}
                    </td>
                    <td><code>{m.meeting_id}</code></td>
                    <td style={{ color: 'var(--text-muted)' }}>{fmt(m.scheduledAt || m.scheduled_at)}</td>
                    <td>
                      <button className="btn btn-primary" style={{ padding: '5px 14px', fontSize: 12 }}
                        onClick={() => navigate(`/prejoin/${m.meeting_id}`)}>{t('common.start')}</button>
                    </td>
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