import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ta from './locales/ta.json';
import es from './locales/es.json';
import ar from './locales/ar.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import tr from './locales/tr.json';

const resources = {
  en: { translation: en },
  ta: { translation: ta },
  es: { translation: es },
  ar: { translation: ar },
  de: { translation: de },
  fr: { translation: fr },
  it: { translation: it },
  pt: { translation: pt },
  ru: { translation: ru },
  tr: { translation: tr },
};

const savedLanguage = localStorage.getItem('vm-lang') || 'en';

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: savedLanguage,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('vm-lang', lng);
  const rtl = lng === 'ar';
  document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
});

const initialRtl = savedLanguage === 'ar';
document.documentElement.setAttribute('dir', initialRtl ? 'rtl' : 'ltr');

export default i18n;
