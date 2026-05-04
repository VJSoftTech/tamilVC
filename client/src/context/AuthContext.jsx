import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api.js';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  // Load synchronously so every first-render hook (e.g. setupSocket useCallback)
  // already captures the correct user — avoids stale null closures.
  const [user, setUser] = useState(() => {
    try {
      const u = localStorage.getItem('user');
      const t = localStorage.getItem('token');
      if (u && t) return JSON.parse(u);
      const gu = sessionStorage.getItem('guestUser');
      const gt = sessionStorage.getItem('guestToken');
      if (gu && gt) return JSON.parse(gu);
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    authAPI.me()
      .then((res) => {
        localStorage.setItem('user', JSON.stringify(res.data));
        setUser(res.data);
      })
      .catch(() => {});
  }, []);

  const login = async (creds) => {
    const res = await authAPI.login(creds);
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    return res.data;
  };

  const register = async (data) => {
    const res = await authAPI.register(data);
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    return res.data;
  };

  const logout = async () => {
    try { await authAPI.logout(); } catch {}
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const loginAsGuest = (guestUser, token) => {
    sessionStorage.setItem('guestToken', token);
    sessionStorage.setItem('guestUser', JSON.stringify(guestUser));
    setUser(guestUser);
  };

  const logoutGuest = () => {
    sessionStorage.removeItem('guestToken');
    sessionStorage.removeItem('guestUser');
    setUser(null);
  };

  const updateUser = (nextUser) => {
    localStorage.setItem('user', JSON.stringify(nextUser));
    setUser(nextUser);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading, updateUser, loginAsGuest, logoutGuest }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
