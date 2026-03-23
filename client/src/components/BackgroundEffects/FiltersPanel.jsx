import React from 'react';
import { useTranslation } from 'react-i18next';

const FILTERS = [
  { key: 'none', labelKey: 'pages.meetingRoom.effectsPanel.filters.none' },
  { key: 'brightness', labelKey: 'pages.meetingRoom.effectsPanel.filters.brightness' },
  { key: 'contrast', labelKey: 'pages.meetingRoom.effectsPanel.filters.contrast' },
  { key: 'warm', labelKey: 'pages.meetingRoom.effectsPanel.filters.warm' },
  { key: 'cool', labelKey: 'pages.meetingRoom.effectsPanel.filters.cool' },
  { key: 'grayscale', labelKey: 'pages.meetingRoom.effectsPanel.filters.grayscale' },
];

export default function FiltersPanel({ selected, onChange }) {
  const { t } = useTranslation();

  return (
    <div className="bgfx-chip-row">
      {FILTERS.map((filter) => (
        <button
          type="button"
          key={filter.key}
          className={`bgfx-chip ${selected === filter.key ? 'active' : ''}`}
          onClick={() => onChange(filter.key)}
        >
          {t(filter.labelKey)}
        </button>
      ))}
    </div>
  );
}
