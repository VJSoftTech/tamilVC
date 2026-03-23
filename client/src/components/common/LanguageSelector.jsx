import React from 'react';
import { useTranslation } from 'react-i18next';

export const LANGUAGE_OPTIONS = [
  { code: 'ta', flag: '🇮🇳', name: 'Tamil (தமிழ்)' },
  { code: 'en', flag: '🇺🇸', name: 'English' },
  { code: 'es', flag: '🇪🇸', name: 'Spanish (Español)' },
  { code: 'ar', flag: '🇸🇦', name: 'Arabic (العربية)' },
  { code: 'de', flag: '🇩🇪', name: 'German (Deutsch)' },
  { code: 'fr', flag: '🇫🇷', name: 'French (Français)' },
  { code: 'it', flag: '🇮🇹', name: 'Italian (Italiano)' },
  { code: 'pt', flag: '🇵🇹', name: 'Portuguese (Português)' },
  { code: 'ru', flag: '🇷🇺', name: 'Russian (Русский)' },
  { code: 'tr', flag: '🇹🇷', name: 'Turkish (Türkçe)' },
];

export default function LanguageSelector({ compact = false, className = '' }) {
  const { i18n, t } = useTranslation();

  return (
    <div className={`language-select-wrap ${className}`.trim()}>
      {!compact && <span className="language-label">{t('ui.language')}</span>}
      <select
        className="language-select"
        value={i18n.language}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        aria-label={t('ui.language')}
      >
        {LANGUAGE_OPTIONS.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.flag} {lang.name}
          </option>
        ))}
      </select>
    </div>
  );
}
