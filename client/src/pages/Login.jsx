import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTranslation } from 'react-i18next';

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const { t }     = useTranslation();

  const [form,    setForm]    = useState({ username: '', password: '' });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await login(form);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || t('pages.login.errors.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <h1>🎥 பேசு தமிழ்</h1>
          <span>{t('pages.login.subtitle')}</span>
        </div>

        {error && <div className="error-text" style={{ marginBottom: 14, textAlign: 'center' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('pages.login.username')}</label>
            <input name="username" value={form.username} onChange={handleChange}
              placeholder={t('pages.login.usernamePlaceholder')} required autoFocus />
          </div>
          <div className="form-group">
            <label>{t('pages.login.password')}</label>
            <input type="password" name="password" value={form.password} onChange={handleChange}
              placeholder={t('pages.login.passwordPlaceholder')} required />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? t('pages.login.signingIn') : t('pages.login.signIn')}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--text-muted)' }}>
          {t('pages.login.noAccount')}{' '}
          <Link to="/register" style={{ color: 'var(--primary)' }}>{t('pages.login.register')}</Link>
        </p>
      </div>
    </div>
  );
}
