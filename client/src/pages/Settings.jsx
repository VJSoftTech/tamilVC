import React, { useEffect, useState } from 'react';
import { settingsAPI } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTranslation } from 'react-i18next';

export default function Settings() {
  const { user, updateUser } = useAuth();
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: '',
    phone_number: '',
    username: '',
    password: '',
    avatar: null,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      name: user.name || '',
      phone_number: user.phoneNumber || '',
      username: user.username || '',
    }));
  }, [user]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setErrors({});

    try {
      const fd = new FormData();
      if (form.name) fd.append('name', form.name);
      if (form.phone_number) fd.append('phone_number', form.phone_number);
      if (form.avatar) fd.append('avatar', form.avatar);

      if (user?.userType === 'admin') {
        if (form.username) fd.append('username', form.username);
        if (form.password) fd.append('password', form.password);
      }

      const res = await settingsAPI.updateMe(fd);
      updateUser(res.data.user);
      setMessage(t('pages.settings.success'));
      setForm((f) => ({ ...f, password: '', avatar: null }));
    } catch (err) {
      setErrors(err.response?.data?.errors || { form: [err.response?.data?.message || t('pages.settings.updateFailed')] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>{t('pages.settings.title')}</h2>
        <p>{t('pages.settings.subtitle')}</p>
      </div>

      <div className="card settings-card">
        <form onSubmit={onSubmit}>
          <div className="settings-avatar-row">
            <div className="settings-avatar-preview">
              {user?.avatar ? <img src={user.avatar} alt={user.name} className="avatar-img" /> : (user?.name?.[0]?.toUpperCase() || 'U')}
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
              <label>{t('pages.settings.avatar')}</label>
              <input type="file" accept="image/*" onChange={(e) => setForm((f) => ({ ...f, avatar: e.target.files?.[0] || null }))} />
            </div>
          </div>

          <div className="form-group">
            <label>{t('pages.settings.name')}</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            {errors.name && <span className="error-text">{errors.name[0]}</span>}
          </div>

          <div className="form-group">
            <label>{t('pages.settings.phone')}</label>
            <input value={form.phone_number} onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))} />
          </div>

          {user?.userType === 'admin' && (
            <>
              <div className="form-group">
                <label>{t('pages.settings.usernameAdmin')}</label>
                <input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
                {errors.username && <span className="error-text">{errors.username[0]}</span>}
              </div>

              <div className="form-group">
                <label>{t('pages.settings.passwordAdmin')}</label>
                <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
                {errors.password && <span className="error-text">{errors.password[0]}</span>}
              </div>
            </>
          )}

          {errors.form && <span className="error-text">{errors.form[0]}</span>}
          {message && <div className="success-text">{message}</div>}

          <div className="flex-row mt-4">
            <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.saveChanges')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
