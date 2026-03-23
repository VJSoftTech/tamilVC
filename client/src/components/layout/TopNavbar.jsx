import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSelector from '../common/LanguageSelector.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';

export default function TopNavbar({ user, onToggleMenu, onLogout }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isDark, toggleTheme } = useTheme();

  return (
    <header className="top-navbar">
      <div className="top-navbar-left">
        <button className="hamburger desktop-hidden" onClick={onToggleMenu} aria-label={t('ui.menu')}>
          <span /><span /><span />
        </button>
        <div className="top-navbar-brand" onClick={() => navigate('/dashboard')}>
          <span className="brand-title company-title">பேசு தமிழ்</span>
        </div>
      </div>

      <div className="top-navbar-right">
        <button className="navbar-profile" onClick={() => navigate('/settings')} title={t('ui.profile')}>
          <span className="navbar-avatar">
            {user?.avatar ? <img src={user.avatar} alt={user?.name || 'User'} className="avatar-img" /> : user?.name?.[0]?.toUpperCase()}
          </span>
          <span className="navbar-name">{user?.name || 'User'}</span>
        </button>

        <LanguageSelector compact className="navbar-language" />

        <button className="theme-toggle" onClick={toggleTheme} title={isDark ? t('ui.switchToLight') : t('ui.switchToDark')}>
          {isDark ? '☀️' : '🌙'}
        </button>

        <button className="btn btn-outline navbar-logout" onClick={onLogout}>
          <span>🚪</span>
          <span className="logout-text">{t('ui.logout')}</span>
        </button>
      </div>
    </header>
  );
}
