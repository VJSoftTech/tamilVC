import React, { useMemo, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext.jsx';
import LanguageSelector from '../common/LanguageSelector.jsx';
import TopNavbar from './TopNavbar.jsx';

const navItems = [
  { path: '/dashboard',    icon: '🏠', labelKey: 'nav.dashboard' },
  { path: '/new-meeting',  icon: '📹', labelKey: 'nav.newMeeting' },
  { path: '/join-meeting', icon: '🔗', labelKey: 'nav.joinMeeting' },
  { path: '/meetings',     icon: '📋', labelKey: 'nav.meetings' },
  { path: '/recordings',   icon: '⏺️', labelKey: 'nav.recordings' },
  { path: '/settings',     icon: '⚙️', labelKey: 'nav.settings' },
  { path: '/users',        icon: '👥', labelKey: 'nav.users', adminOnly: true },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();
  const location         = useLocation();
  const { t }            = useTranslation();
  const { isDark, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => !item.adminOnly || user?.userType === 'admin'),
    [user?.userType]
  );
  const activeNavItem = visibleNavItems.find((item) => item.path === location.pathname);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleNav = (path) => {
    navigate(path);
    setMenuOpen(false);
  };

  return (
    <div className="app-shell">
      <TopNavbar
        user={user}
        onToggleMenu={() => setMenuOpen((o) => !o)}
        onLogout={handleLogout}
      />

      <div className="app-layout">

      {/* Overlay for mobile */}
        {menuOpen && <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} />}

        <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
          <div className="sidebar-logo">
            <h2 className="logo-text menu-title">{t(activeNavItem?.labelKey || 'app.name')}</h2>
            <button className="sidebar-close" onClick={() => setMenuOpen(false)}>✕</button>
          </div>
          <nav className="sidebar-nav">
            {visibleNavItems.map(item => (
              <button
                key={item.path}
                className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                onClick={() => handleNav(item.path)}
              >
                <span className="nav-icon">{item.icon}</span>
                {t(item.labelKey)}
              </button>
            ))}
          </nav>

          <div className="sidebar-footer desktop-only-footer">
            <div className="user-info sidebar-profile-row">
              <div className="avatar-circle">
                {user?.avatar ? <img src={user.avatar} alt={user?.name || 'User'} className="avatar-img" /> : user?.name?.[0]?.toUpperCase()}
              </div>
              <div className="user-details">
                <div className="user-name">{user?.name}</div>
                <div className="user-username">@{user?.username}</div>
              </div>
              <LanguageSelector compact className="sidebar-language" />
            </div>

            <div className="sidebar-footer-actions">
              <button className="btn btn-outline" onClick={handleLogout}>
                🚪 {t('ui.logout')}
              </button>
              <button className="theme-toggle" onClick={toggleTheme} title={isDark ? t('ui.switchToLight') : t('ui.switchToDark')}>
                {isDark ? '☀️' : '🌙'}
              </button>
            </div>
          </div>

        </aside>

        <main className="main-content">
          <div className="content-area">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}