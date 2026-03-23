// NewMeeting.js
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { meetingAPI } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTranslation } from 'react-i18next';

export default function NewMeeting() {
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const { t }     = useTranslation();

  const [view,        setView]        = useState('choose');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [meetingData, setMeetingData] = useState(null);
  const [copied,      setCopied]      = useState(false);
  const [instantTitle,setInstantTitle]= useState('Instant Meeting');
  const [schedForm,   setSchedForm]   = useState({ title: '', scheduled_at: '', description: '' });

  const handleInstant = async () => {
    setLoading(true); setError('');
    try {
      const defaultTitle = t('pages.newMeeting.instantDefaultTitle');
      const res = await meetingAPI.createInstant({ title: defaultTitle });
      setInstantTitle(res.data?.meeting?.title || defaultTitle);
      setMeetingData(res.data); setView('ready');
    } catch { setError(t('pages.newMeeting.errors.createFailed')); }
    finally { setLoading(false); }
  };

  const handleJoinReady = async () => {
    if (!meetingData?.meeting?.meeting_id) return;
    const nextTitle = instantTitle.trim() || t('pages.newMeeting.instantDefaultTitle');
    setLoading(true);
    setError('');
    try {
      await meetingAPI.updateTitle(meetingData.meeting.meeting_id, { title: nextTitle });
      setMeetingData((prev) => ({
        ...prev,
        meeting: { ...prev.meeting, title: nextTitle },
      }));
      navigate(`/prejoin/${meetingData.meeting.meeting_id}`);
    } catch (e) {
      setError(e.response?.data?.message || t('pages.newMeeting.errors.saveTitleFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSchedule = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await meetingAPI.schedule(schedForm);
      setInstantTitle(res.data?.meeting?.title || schedForm.title || t('pages.newMeeting.meetingFallbackTitle'));
      setMeetingData(res.data); setView('ready');
    } catch (e) {
      setError(e.response?.data?.message || t('pages.newMeeting.errors.scheduleFailed'));
    } finally { setLoading(false); }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(meetingData.meeting_link);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  if (view === 'ready' && meetingData) {
    return (
      <div>
        <div className="page-header"><h2>✅ {t('pages.newMeeting.readyTitle')}</h2><p>{t('pages.newMeeting.readySubtitle')}</p></div>
        <div className="card" style={{ maxWidth: 500 }}>
          <div className="card-title">{meetingData.meeting.title}</div>
          <div className="form-group">
            <label>{t('pages.newMeeting.meetingTitle')}</label>
            <input
              value={instantTitle}
              onChange={(e) => setInstantTitle(e.target.value)}
              placeholder={t('pages.newMeeting.meetingTitlePlaceholder')}
              required
            />
          </div>
          <div className="form-group">
            <label>{t('pages.newMeeting.displayName')}</label>
            <input value={user?.name || ''} disabled />
          </div>
          <p className="text-muted">{t('common.meetingId')}: <strong>{meetingData.meeting.meeting_id}</strong></p>
          <div className="link-box mt-2">
            <span style={{ flex: 1, wordBreak: 'break-all', fontSize: 13 }}>{meetingData.meeting_link}</span>
          </div>
          {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}
          <div className="flex-row mt-4">
            <button className="btn btn-outline" onClick={copyLink}>{copied ? t('common.copied') : `📋 ${t('common.copyLink')}`}</button>
            <button className="btn btn-primary" onClick={handleJoinReady} disabled={loading}>
              {loading ? t('common.saving') : `🎥 ${t('common.joinNow')}`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'schedule') {
    return (
      <div>
        <div className="page-header"><h2>📅 {t('pages.newMeeting.scheduleTitle')}</h2><p>{t('pages.newMeeting.scheduleSubtitle')}</p></div>
        <div className="card" style={{ maxWidth: 440 }}>
          <form onSubmit={handleSchedule}>
            <div className="form-group">
              <label>{t('pages.newMeeting.meetingTitle')}</label>
              <input value={schedForm.title} onChange={e => setSchedForm(p => ({ ...p, title: e.target.value }))}
                placeholder={t('pages.newMeeting.schedulePlaceholder')} required />
            </div>
            <div className="form-group">
              <label>{t('pages.newMeeting.dateTime')}</label>
              <input type="datetime-local" value={schedForm.scheduled_at}
                onChange={e => setSchedForm(p => ({ ...p, scheduled_at: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>{t('pages.newMeeting.descriptionOptional')}</label>
              <textarea rows={3} value={schedForm.description}
                onChange={e => setSchedForm(p => ({ ...p, description: e.target.value }))}
                placeholder={t('pages.newMeeting.descriptionPlaceholder')} />
            </div>
            {error && <div className="error-text">{error}</div>}
            <div className="flex-row mt-2">
              <button type="button" className="btn btn-outline" onClick={() => setView('choose')}>← {t('common.back')}</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? t('pages.newMeeting.scheduling') : `📅 ${t('pages.newMeeting.schedule')}`}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header"><h2>📹 {t('pages.newMeeting.title')}</h2><p>{t('pages.newMeeting.subtitle')}</p></div>
      <div className="meeting-options">
        <div className="meeting-option-card" onClick={handleInstant}>
          <div className="icon">⚡</div>
          <h3>{t('pages.newMeeting.instant')}</h3>
          <p>{t('pages.newMeeting.instantDesc')}</p>
        </div>
        <div className="meeting-option-card" onClick={() => setView('schedule')}>
          <div className="icon">📅</div>
          <h3>{t('pages.newMeeting.scheduleMeeting')}</h3>
          <p>{t('pages.newMeeting.scheduleDesc')}</p>
        </div>
      </div>
    </div>
  );
}