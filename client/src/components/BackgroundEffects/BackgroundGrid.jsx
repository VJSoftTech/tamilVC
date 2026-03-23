import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const BUILTIN_OPTIONS = [
  { key: 'none', labelKey: 'pages.meetingRoom.effectsPanel.background.noBackground', kind: 'none' },
  { key: 'blur', labelKey: 'pages.meetingRoom.effectsPanel.background.blurBackground', kind: 'blur' },
  { key: 'slight-blur', labelKey: 'pages.meetingRoom.effectsPanel.background.slightBlur', kind: 'blur-light' },
  { key: 'upload', labelKey: 'pages.meetingRoom.effectsPanel.background.customImage', kind: 'upload' },
];

export default function BackgroundGrid({ selectedKey, images, customImageUrl, onSelect, onUpload }) {
  const { t } = useTranslation();

  const imageOptions = useMemo(() => images.map((url, index) => ({
    key: `image-${index}`,
    label: t('pages.meetingRoom.effectsPanel.background.sceneN', { index: index + 1 }),
    kind: 'image',
    preview: url,
  })), [images, t]);

  const options = customImageUrl
    ? [...BUILTIN_OPTIONS, {
      key: 'image-custom',
      label: t('pages.meetingRoom.effectsPanel.background.uploadedImage'),
      kind: 'image',
      preview: customImageUrl,
    }, ...imageOptions]
    : [...BUILTIN_OPTIONS, ...imageOptions];

  return (
    <div className="bgfx-grid">
      {options.map((option) => (
        <button
          key={option.key}
          className={`bgfx-grid-item ${selectedKey === option.key ? 'active' : ''}`}
          onClick={() => {
            if (option.key === 'upload') {
              onUpload();
              return;
            }
            onSelect(option);
          }}
          title={option.label || t(option.labelKey)}
          type="button"
        >
          <div className={`bgfx-grid-preview kind-${option.kind}`}>
            {option.kind === 'none' && <span className="bgfx-grid-label">{t('pages.meetingRoom.effectsPanel.background.short.none')}</span>}
            {option.kind === 'blur' && <span className="bgfx-grid-label">{t('pages.meetingRoom.effectsPanel.background.short.blur')}</span>}
            {option.kind === 'blur-light' && <span className="bgfx-grid-label">{t('pages.meetingRoom.effectsPanel.background.short.slight')}</span>}
            {option.kind === 'upload' && <span className="bgfx-grid-label">{t('pages.meetingRoom.effectsPanel.background.short.upload')}</span>}
            {option.kind === 'image' && <img src={option.preview} alt={option.label} />}
          </div>
          <span className="bgfx-grid-caption">{option.label || t(option.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
