import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';
import { useTranslation } from 'react-i18next';
import BackgroundGrid from './BackgroundGrid.jsx';
import FiltersPanel from './FiltersPanel.jsx';
import AppearancePanel from './AppearancePanel.jsx';

const TABS = [
  { key: 'Backgrounds', labelKey: 'pages.meetingRoom.effectsPanel.tabs.backgrounds' },
  { key: 'Filters', labelKey: 'pages.meetingRoom.effectsPanel.tabs.filters' },
  { key: 'Appearance', labelKey: 'pages.meetingRoom.effectsPanel.tabs.appearance' },
];
const PRESET_BACKGROUNDS = [
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1465101046530-73398c7f28ca?auto=format&fit=crop&w=1200&q=80',
];

function getFilterPreset(name) {
  switch (name) {
    case 'brightness': return 'brightness(1.12)';
    case 'contrast': return 'contrast(1.22)';
    case 'warm': return 'sepia(0.18) saturate(1.18)';
    case 'cool': return 'hue-rotate(335deg) saturate(1.06)';
    case 'grayscale': return 'grayscale(1)';
    default: return 'none';
  }
}

export default function BackgroundPanel({ open, onClose, sourceStream, cameraOn, onTrackChange }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('Backgrounds');
  const [backgroundKey, setBackgroundKey] = useState('none');
  const [selectedImage, setSelectedImage] = useState('');
  const [customImageUrl, setCustomImageUrl] = useState('');
  const [filterName, setFilterName] = useState('none');
  const [brightness, setBrightness] = useState(100);
  const [softLight, setSoftLight] = useState(0);
  const [mirror, setMirror] = useState(false);

  const fileInputRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const sourceVideoRef = useRef(null);
  const compositionCanvasRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const rafRef = useRef(0);
  const segmentationRef = useRef(null);
  const processingTrackRef = useRef(null);
  const runningRef = useRef(false);
  const sendingRef = useRef(false);

  const backgroundMode = useMemo(() => {
    if (backgroundKey === 'blur') return 'blur';
    if (backgroundKey === 'slight-blur') return 'slight-blur';
    if (backgroundKey.startsWith('image-')) return 'image';
    return 'none';
  }, [backgroundKey]);

  const needsSegmentation = backgroundMode !== 'none';
  const needsPostProcess = filterName !== 'none' || brightness !== 100 || softLight > 0 || mirror;
  const shouldProcess = cameraOn && (needsSegmentation || needsPostProcess);

  const imageCacheRef = useRef(new Map());
  const getBackgroundImage = useMemo(() => async (url) => {
    if (!url) return null;
    if (imageCacheRef.current.has(url)) return imageCacheRef.current.get(url);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const ready = new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
    });
    img.src = url;
    const resolved = await ready;
    imageCacheRef.current.set(url, resolved);
    return resolved;
  }, []);

  useEffect(() => {
    if (!sourceStream || !sourceVideoRef.current) return;
    sourceVideoRef.current.srcObject = sourceStream;
    sourceVideoRef.current.play().catch(() => {});
  }, [sourceStream]);

  useEffect(() => {
    if (!shouldProcess) {
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (processingTrackRef.current) {
        processingTrackRef.current.stop();
        processingTrackRef.current = null;
      }
      onTrackChange?.(null);
      return;
    }

    const previewCanvas = previewCanvasRef.current;
    const sourceVideo = sourceVideoRef.current;
    if (!previewCanvas || !sourceVideo) return;

    const compositionCanvas = compositionCanvasRef.current || document.createElement('canvas');
    const maskCanvas = maskCanvasRef.current || document.createElement('canvas');
    compositionCanvasRef.current = compositionCanvas;
    maskCanvasRef.current = maskCanvas;

    const setupTrack = () => {
      if (!processingTrackRef.current) {
        const stream = previewCanvas.captureStream(24);
        processingTrackRef.current = stream.getVideoTracks()[0];
        onTrackChange?.(processingTrackRef.current);
      }
    };

    const resizeAllCanvases = () => {
      const w = sourceVideo.videoWidth || 1280;
      const h = sourceVideo.videoHeight || 720;
      if (previewCanvas.width !== w || previewCanvas.height !== h) {
        previewCanvas.width = w;
        previewCanvas.height = h;
        compositionCanvas.width = w;
        compositionCanvas.height = h;
        maskCanvas.width = w;
        maskCanvas.height = h;
      }
    };

    const initSegmentation = async () => {
      if (!needsSegmentation || segmentationRef.current) return;
      const segmenter = new SelfieSegmentation({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
      });
      // modelSelection: 0 is tuned for front camera / selfie framing and is more stable for webcam calls.
      segmenter.setOptions({ modelSelection: 0 });
      segmenter.onResults((results) => {
        if (!maskCanvasRef.current) return;
        const ctx = maskCanvasRef.current.getContext('2d');
        ctx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
        ctx.drawImage(results.segmentationMask, 0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
      });
      segmentationRef.current = segmenter;
    };

    const drawFrame = async () => {
      resizeAllCanvases();
      setupTrack();

      const w = previewCanvas.width;
      const h = previewCanvas.height;
      const compositionCtx = compositionCanvas.getContext('2d');
      const previewCtx = previewCanvas.getContext('2d');

      compositionCtx.clearRect(0, 0, w, h);

      if (needsSegmentation) {
        if (segmentationRef.current && !sendingRef.current) {
          sendingRef.current = true;
          segmentationRef.current.send({ image: sourceVideo }).finally(() => {
            sendingRef.current = false;
          });
        }

        const maskCanvasLocal = maskCanvasRef.current;
        if (maskCanvasLocal) {
          compositionCtx.save();
          compositionCtx.drawImage(maskCanvasLocal, 0, 0, w, h);
          compositionCtx.globalCompositeOperation = 'source-in';
          compositionCtx.drawImage(sourceVideo, 0, 0, w, h);
          compositionCtx.globalCompositeOperation = 'destination-atop';

          if (backgroundMode === 'blur' || backgroundMode === 'slight-blur') {
            const px = backgroundMode === 'blur' ? 16 : 7;
            compositionCtx.filter = `blur(${px}px)`;
            compositionCtx.drawImage(sourceVideo, 0, 0, w, h);
            compositionCtx.filter = 'none';
          } else if (backgroundMode === 'image') {
            const bgImage = await getBackgroundImage(selectedImage);
            if (bgImage) {
              compositionCtx.drawImage(bgImage, 0, 0, w, h);
            } else {
              compositionCtx.fillStyle = '#101423';
              compositionCtx.fillRect(0, 0, w, h);
            }
          }

          compositionCtx.globalCompositeOperation = 'source-over';
          compositionCtx.restore();
        }
      } else {
        compositionCtx.drawImage(sourceVideo, 0, 0, w, h);
      }

      previewCtx.clearRect(0, 0, w, h);
      previewCtx.save();
      previewCtx.filter = `${getFilterPreset(filterName)} brightness(${brightness / 100})`;
      if (mirror) {
        previewCtx.translate(w, 0);
        previewCtx.scale(-1, 1);
      }
      previewCtx.drawImage(compositionCanvas, 0, 0, w, h);
      previewCtx.restore();

      if (softLight > 0) {
        previewCtx.save();
        previewCtx.fillStyle = `rgba(255, 242, 224, ${softLight / 100})`;
        previewCtx.fillRect(0, 0, w, h);
        previewCtx.restore();
      }
    };

    runningRef.current = true;

    const loop = async () => {
      if (!runningRef.current) return;
      if (sourceVideo.readyState >= 2) {
        if (needsSegmentation) await initSegmentation();
        await drawFrame();
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    shouldProcess,
    needsSegmentation,
    backgroundMode,
    selectedImage,
    filterName,
    brightness,
    mirror,
    softLight,
    getBackgroundImage,
    onTrackChange,
    cameraOn,
  ]);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (processingTrackRef.current) {
        processingTrackRef.current.stop();
      }
      onTrackChange?.(null);
    };
  }, [onTrackChange]);

  useEffect(() => {
    return () => {
      if (customImageUrl && customImageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(customImageUrl);
      }
    };
  }, [customImageUrl]);

  const selectBackground = (option) => {
    setBackgroundKey(option.key);
    if (option.kind === 'image') {
      setSelectedImage(option.preview);
    } else {
      setSelectedImage('');
    }
  };

  return (
    <>
      <video ref={sourceVideoRef} muted playsInline autoPlay style={{ display: 'none' }} />

      <div className={`bgfx-backdrop ${open ? 'open' : 'hidden'}`} onClick={(e) => e.target === e.currentTarget && onClose?.()}>
          <div className="bgfx-modal" role="dialog" aria-modal="true" aria-label={t('pages.meetingRoom.effectsPanel.title')}>
            <div className="bgfx-modal-header">
              <h3>{t('pages.meetingRoom.effectsPanel.title')}</h3>
              <button type="button" className="bgfx-close" onClick={onClose}>
                {t('common.close')}
              </button>
            </div>

            <div className="bgfx-preview-wrap">
              {!cameraOn && <div className="bgfx-disabled">{t('pages.meetingRoom.effectsPanel.cameraOffHint')}</div>}
              <canvas ref={previewCanvasRef} className="bgfx-preview" />
            </div>

            <div className="bgfx-tabs">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`bgfx-tab ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {t(tab.labelKey)}
                </button>
              ))}
            </div>

            <div className="bgfx-content">
              {activeTab === 'Backgrounds' && (
                <BackgroundGrid
                  selectedKey={backgroundKey}
                  images={PRESET_BACKGROUNDS}
                  customImageUrl={customImageUrl}
                  onSelect={selectBackground}
                  onUpload={() => fileInputRef.current?.click()}
                />
              )}

              {activeTab === 'Filters' && (
                <FiltersPanel selected={filterName} onChange={setFilterName} />
              )}

              {activeTab === 'Appearance' && (
                <AppearancePanel
                  brightness={brightness}
                  softLight={softLight}
                  mirror={mirror}
                  onBrightness={setBrightness}
                  onSoftLight={setSoftLight}
                  onMirror={setMirror}
                />
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const url = URL.createObjectURL(file);
                setCustomImageUrl(url);
                setSelectedImage(url);
                setBackgroundKey('image-custom');
              }}
            />

            <div className="bgfx-modal-footer">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setBackgroundKey('none');
                  setSelectedImage('');
                  setFilterName('none');
                  setBrightness(100);
                  setSoftLight(0);
                  setMirror(false);
                }}
              >
                {t('pages.meetingRoom.effectsPanel.reset')}
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                {t('pages.meetingRoom.effectsPanel.done')}
              </button>
            </div>
          </div>
        </div>
    </>
  );
}
