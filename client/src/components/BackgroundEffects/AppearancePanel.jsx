import React from 'react';
import { useTranslation } from 'react-i18next';

export default function AppearancePanel({ brightness, softLight, mirror, onBrightness, onSoftLight, onMirror }) {
  const { t } = useTranslation();

  return (
    <div className="bgfx-appearance">
      <label className="bgfx-range-field">
        <span>{t('pages.meetingRoom.effectsPanel.appearance.cameraBrightness')}</span>
        <input
          type="range"
          min="60"
          max="150"
          step="1"
          value={brightness}
          onChange={(e) => onBrightness(Number(e.target.value))}
        />
        <em>{brightness}%</em>
      </label>

      <label className="bgfx-range-field">
        <span>{t('pages.meetingRoom.effectsPanel.appearance.softLight')}</span>
        <input
          type="range"
          min="0"
          max="40"
          step="1"
          value={softLight}
          onChange={(e) => onSoftLight(Number(e.target.value))}
        />
        <em>{softLight}%</em>
      </label>

      <label className="bgfx-switch-row">
        <span>{t('pages.meetingRoom.effectsPanel.appearance.mirrorVideo')}</span>
        <button type="button" className={`bgfx-switch ${mirror ? 'on' : ''}`} onClick={() => onMirror(!mirror)}>
          <span />
        </button>
      </label>
    </div>
  );
}
