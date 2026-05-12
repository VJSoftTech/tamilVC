import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useTranslation } from 'react-i18next';

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const { t }     = useTranslation();
  const { isDark, toggleTheme } = useTheme();

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
    <motion.div className="auth-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.65, ease: 'easeOut' }}>
      <div className="auth-split">
        <motion.section className="hero-panel"
          initial={{ opacity: 0, x: -32 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}>
          <div className="hero-grid" />
          <div className="hero-orb orb-1" />
          <div className="hero-orb orb-2" />
          <motion.div className="hero-copy-wrap"
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.8, ease: 'easeOut' }}>
            <span className="glow-badge">தமிழை கடத்துவோம்...</span>
            <h1 className="hero-heading">தமிழ் பேசலாம் வாங்க</h1>
            <p className="hero-text">
              நேர்மையாளர் உயர்திரு.உ.சகாயம் இ.ஆ.ப ( வி.ஓ ) அவர்களின் சீரிய சிந்தனையில் உதயமாகி , தமிழ்ப்பணி புரிவதற்காக 19.09.2019 அன்று முதல் தமிழ் முற்றம் என்ற திட்டம் தொடங்கப்பட்டது. அதன் ஒரு அங்கமாக ஆங்கிலம் கலவாத எளிய, இயல்பு தமிழ் உரை நிகழ்த்தும் இந் நிகழ்வானது தொடர்ந்து வெற்றிகரமாக 325-வது வார நிகழ்வை நோக்கி வீரியத்துடன் நடந்து கொண்டிருக்கிறது.
            </p>
            <div className="hero-features">
              <div className="feature-card">
                <div className="feature-icon">📹</div>
                <div>
                  <h4>தமிழ் வீடியோ கூட்டம்</h4>
                  <p>உளவுத்தன்மையுடன் நேரடி சந்திப்பு</p>
                </div>
              </div>
              <div className="feature-card">
                <div className="feature-icon">💬</div>
                <div>
                  <h4>சமூக விவாதங்கள்</h4>
                  <p>தமிழ் கலந்துரையாடல் வெள்ளிக்கிழமை</p>
                </div>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🔒</div>
                <div>
                  <h4>பாதுகாப்பான தளம்</h4>
                  <p>எளிய ஆன்மீக தனியுரிமை</p>
                </div>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🚪</div>
                <div>
                  <h4>எளிய விருந்தினர் இணைப்பு</h4>
                  <p>இடையே தடைகள் இல்லாமல் கட்டமைப்பு</p>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.section>

        <motion.div className="auth-card auth-card-panel"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.8, ease: 'easeOut' }}>
          <div className="auth-brand">
            <div className="auth-brand-body">
              <div className="brand-pill">🎥 பேசு தமிழ்</div>
              <span>{t('pages.login.subtitle')}</span>
            </div>
            <button
              type="button"
              className="theme-toggle auth-theme-toggle"
              onClick={toggleTheme}
              title={isDark ? t('ui.switchToLight') : t('ui.switchToDark')}
            >
              {isDark ? '☀️' : '🌙'}
            </button>
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

          <p className="auth-footer-text">
            {t('pages.login.noAccount')}{' '}
            <Link to="/register">{t('pages.login.register')}</Link>
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}