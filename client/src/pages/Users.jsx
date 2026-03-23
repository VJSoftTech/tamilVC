import React, { useEffect, useMemo, useState } from 'react';
import { usersAPI } from '../services/api.js';
import { useTranslation } from 'react-i18next';

const EMPTY_FORM = {
  name: '',
  email: '',
  password: '',
  phone_number: '',
  avatar: null,
};

function UserModal({ open, mode, initial, onClose, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (mode === 'edit' && initial) {
      setForm({
        name: initial.name || '',
        email: initial.email || '',
        password: '',
        phone_number: initial.phone_number || '',
        avatar: null,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, mode, initial]);

  const validateInline = async () => {
    if (!form.name || !form.email) return;
    try {
      const res = await usersAPI.validate({ name: form.name, email: form.email });
      const next = {};
      if (res.data.nameExists && mode === 'create') next.name = ['Name already exists'];
      if (res.data.emailExists && mode === 'create') next.email = ['Email already exists'];
      setErrors((prev) => ({ ...prev, ...next }));
    } catch {}
  };

  const onSubmit = async (e) => {
    e.preventDefault();

    const localErrors = {};
    if (!form.name?.trim()) localErrors.name = [t('pages.users.errors.nameRequired')];
    if (!form.email?.trim()) localErrors.email = [t('pages.users.errors.emailRequired')];
    if (!form.phone_number?.trim()) localErrors.phone_number = [t('pages.users.errors.phoneRequired')];
    if (mode === 'create') {
      if (!form.password) localErrors.password = [t('pages.users.errors.passwordRequired')];
      if (!form.avatar) localErrors.avatar = [t('pages.users.errors.avatarRequired')];
    }
    if (Object.keys(localErrors).length) {
      setErrors(localErrors);
      return;
    }

    setSaving(true);
    setErrors({});

    try {
      const fd = new FormData();
      fd.append('name', form.name.trim());
      fd.append('email', form.email.trim());
      fd.append('phone_number', form.phone_number.trim());
      if (form.password) fd.append('password', form.password);
      if (form.avatar) fd.append('avatar', form.avatar);

      if (mode === 'create') {
        await usersAPI.create(fd);
      } else {
        await usersAPI.update(initial.id, fd);
      }

      onSaved();
      onClose();
    } catch (err) {
      setErrors(err.response?.data?.errors || { form: [err.response?.data?.message || t('pages.users.errors.saveFailed')] });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-header">
          <h3>{mode === 'create' ? t('pages.users.addUser') : t('pages.users.editUser')}</h3>
          <button className="btn btn-outline btn-sm" type="button" onClick={onClose}>{t('common.close')}</button>
        </div>

        <form onSubmit={onSubmit} className="modal-form">
          <div className="form-group">
            <label>{t('pages.users.name')}</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onBlur={validateInline}
            />
            {errors.name && <span className="error-text">{errors.name[0]}</span>}
          </div>

          <div className="form-group">
            <label>{t('pages.users.email')}</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              onBlur={validateInline}
            />
            {errors.email && <span className="error-text">{errors.email[0]}</span>}
          </div>

          <div className="form-group">
            <label>{t('pages.users.password')} {mode === 'edit' ? t('pages.users.passwordKeepHint') : ''}</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
            {errors.password && <span className="error-text">{errors.password[0]}</span>}
          </div>

          <div className="form-group">
            <label>{t('pages.users.phone')}</label>
            <input
              value={form.phone_number}
              onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))}
            />
            {errors.phone_number && <span className="error-text">{errors.phone_number[0]}</span>}
          </div>

          <div className="form-group">
            <label>{t('pages.users.avatar')}</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setForm((f) => ({ ...f, avatar: e.target.files?.[0] || null }))}
            />
            {errors.avatar && <span className="error-text">{errors.avatar[0]}</span>}
          </div>

          {errors.form && <span className="error-text">{errors.form[0]}</span>}

          <div className="modal-actions">
            <button className="btn btn-outline" type="button" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? t('common.saving') : mode === 'create' ? t('pages.users.createUser') : t('common.saveChanges')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Users() {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [selected, setSelected] = useState(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await usersAPI.getAll();
      setRows(res.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) =>
      String(u.id).includes(q) ||
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.phone_number?.toLowerCase().includes(q) ||
      u.user_type?.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const onDelete = async (row) => {
    if (!window.confirm(t('pages.users.confirmDelete', { name: row.name }))) return;
    await usersAPI.remove(row.id);
    await loadUsers();
  };

  return (
    <div>
      <div className="page-header users-header-row">
        <div>
          <h2>{t('nav.users')}</h2>
          <p>{t('pages.users.subtitle')}</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setModalMode('create');
            setSelected(null);
            setModalOpen(true);
          }}
        >
          + {t('common.new')}
        </button>
      </div>

      <div className="card">
        <div className="users-toolbar">
          <input
            className="users-search"
            placeholder={t('pages.users.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {loading ? (
          <p className="text-muted">{t('pages.users.loading')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.id')}</th>
                  <th>{t('pages.users.avatar')}</th>
                  <th>{t('pages.users.name')}</th>
                  <th>{t('pages.users.email')}</th>
                  <th>{t('pages.users.phone')}</th>
                  <th>{t('pages.users.userType')}</th>
                  <th>{t('pages.users.createdAt')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>
                      <div className="table-avatar-wrap">
                        {u.avatar ? <img className="table-avatar" src={u.avatar} alt={u.name} /> : <span>{u.name?.[0]?.toUpperCase()}</span>}
                      </div>
                    </td>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.phone_number || '—'}</td>
                    <td><span className={`badge ${u.user_type === 'admin' ? 'badge-blue' : 'badge-green'}`}>{u.user_type}</span></td>
                    <td>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                    <td className="users-actions">
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setModalMode('edit');
                          setSelected(u);
                          setModalOpen(true);
                        }}
                      >
                        {t('common.edit')}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => onDelete(u)}>{t('common.delete')}</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      {t('pages.users.empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <UserModal
        open={modalOpen}
        mode={modalMode}
        initial={selected}
        onClose={() => setModalOpen(false)}
        onSaved={loadUsers}
      />
    </div>
  );
}
