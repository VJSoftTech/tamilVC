import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTranslation } from 'react-i18next';

export default function Register() {
  const { register } = useAuth();
  const navigate     = useNavigate();
  const { t }        = useTranslation();

  const [form,   setForm]   = useState({ name: '', email: '', username: '', password: '', password_confirmation: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors({}); setLoading(true);
    try {
      await register(form);
      navigate('/dashboard');
    } catch (err) {
      if (err.response?.data?.errors) {
        setErrors(err.response.data.errors);
      } else {
        setErrors({ general: err.response?.data?.message || t('pages.register.errors.failed') });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <h1>🎥 VideoMeet</h1>
          <span>{t('pages.register.subtitle')}</span>
        </div>

        {errors.general && <div className="error-text" style={{ marginBottom: 14, textAlign: 'center' }}>{errors.general}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('pages.register.fullName')}</label>
            <input name="name" value={form.name} onChange={handleChange} placeholder={t('pages.register.fullNamePlaceholder')} required />
            {errors.name && <span className="error-text">{errors.name[0]}</span>}
          </div>
          <div className="form-group">
            <label>{t('pages.register.email')}</label>
            <input type="email" name="email" value={form.email} onChange={handleChange} placeholder={t('pages.register.emailPlaceholder')} required />
            {errors.email && <span className="error-text">{errors.email[0]}</span>}
          </div>
          <div className="form-group">
            <label>{t('pages.register.username')}</label>
            <input name="username" value={form.username} onChange={handleChange} placeholder={t('pages.register.usernamePlaceholder')} required />
            {errors.username && <span className="error-text">{errors.username[0]}</span>}
          </div>
          <div className="form-group">
            <label>{t('pages.register.password')}</label>
            <input type="password" name="password" value={form.password} onChange={handleChange} placeholder={t('pages.register.passwordPlaceholder')} required />
            {errors.password && <span className="error-text">{errors.password[0]}</span>}
          </div>
          <div className="form-group">
            <label>{t('pages.register.confirmPassword')}</label>
            <input type="password" name="password_confirmation" value={form.password_confirmation} onChange={handleChange} placeholder={t('pages.register.confirmPasswordPlaceholder')} required />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? t('pages.register.creating') : t('pages.register.createAccount')}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--text-muted)' }}>
          {t('pages.register.haveAccount')}{' '}
          <Link to="/login" style={{ color: 'var(--primary)' }}>{t('pages.register.signIn')}</Link>
        </p>
      </div>
    </div>
  );
}
