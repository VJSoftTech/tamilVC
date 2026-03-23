import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function JoinMeeting() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const extractId = (val) => {
    const trimmed = val.trim();
    if (trimmed.includes('/meet/')) return trimmed.split('/meet/')[1].split('?')[0];
    return trimmed;
  };

  const handleJoin = (e) => {
    e.preventDefault();
    const id = extractId(input);
    if (!id) { setError(t('pages.joinMeeting.errors.invalidInput')); return; }
    navigate(`/prejoin/${id}`);
  };

  return (
    <div>
      <div className="page-header">
        <h2>🔗 {t('pages.joinMeeting.title')}</h2>
        <p>{t('pages.joinMeeting.subtitle')}</p>
      </div>
      <div className="card" style={{ maxWidth: 500 }}>
        <form onSubmit={handleJoin}>
          <div className="form-group">
            <label>{t('pages.joinMeeting.fieldLabel')}</label>
            <input
              value={input}
              onChange={e => { setInput(e.target.value); setError(''); }}
              placeholder={t('pages.joinMeeting.placeholder')}
              required autoFocus
            />
            {error && <span className="error-text">{error}</span>}
          </div>
          <button className="btn btn-primary btn-block" type="submit">🚀 {t('nav.joinMeeting')}</button>
        </form>
      </div>
    </div>
  );
}