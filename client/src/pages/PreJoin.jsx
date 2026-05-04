import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { meetingAPI } from '../services/api.js';
import { useTranslation } from 'react-i18next';
import { setHandoffStream } from '../utils/streamHandoff.js';

export default function PreJoin() {
  const { meetingId } = useParams();
  const { user }      = useNavigate ? useAuth() : {};
  const navigate      = useNavigate();
  const auth          = useAuth();
  const { t }         = useTranslation();

  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const watermarkInputRef = useRef(null);

  const [camOn,      setCamOn]      = useState(true);
  const [micOn,      setMicOn]      = useState(true);
  const [camError,   setCamError]   = useState(false);
  const [meetingInfo,setMeetingInfo]= useState(null);
  const [joining,    setJoining]    = useState(false);
  const [devices,    setDevices]    = useState({ cameras: [], mics: [] });
  const [selectedCam,setSelectedCam]= useState('');
  const [selectedMic,setSelectedMic]= useState('');
  const [showDevices,setShowDevices]= useState(false);
  const [watermarkDataUrl, setWatermarkDataUrl] = useState('');
  const [watermarkName, setWatermarkName] = useState('');
  const [guestDisplayName, setGuestDisplayName] = useState('');
  const [guestError, setGuestError] = useState('');

  // Load meeting info
  useEffect(() => {
    meetingAPI.getInfo(meetingId)
      .then(r => setMeetingInfo(r.data.meeting))
      .catch(() => {});
  }, [meetingId]);

  // Start camera preview
  useEffect(() => {
    startPreview();
    return () => stopPreview();
  }, []);

  const startPreview = async (camId, micId) => {
    stopPreview();
    setCamError(false);
    const videoConstraint = camId ? { deviceId: { exact: camId } } : { width: 1280, height: 720, facingMode: 'user' };
    const audioConstraint = micId ? { deviceId: { exact: micId } } : true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: audioConstraint });
    } catch {
      // Camera may be denied/busy — try audio-only so mic still works
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraint });
        setCamError(true);
      } catch {
        setCamError(true);
        return;
      }
    }
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
    // Enumerate devices after permission granted
    try {
      const devList = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        cameras: devList.filter(d => d.kind === 'videoinput'),
        mics:    devList.filter(d => d.kind === 'audioinput'),
      });
    } catch {}
  };

  const stopPreview = () => {
    if (streamRef.current) {
      // Stop every track individually so camera light turns off
      streamRef.current.getTracks().forEach(t => {
        t.stop();
        streamRef.current.removeTrack(t);
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.load();      // force browser to release camera
    }
  };

  const toggleCam = async () => {
    if (!streamRef.current) return;
    if (camOn) {
      // Stop track completely so camera light turns off
      streamRef.current.getVideoTracks().forEach(t => {
        t.stop();
        streamRef.current.removeTrack(t);
      });
      if (videoRef.current) videoRef.current.srcObject = null;
      setCamOn(false);
    } else {
      // Get a fresh video track
      try {
        const vs = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
        });
        const track = vs.getVideoTracks()[0];
        streamRef.current.addTrack(track);
        if (videoRef.current) {
          videoRef.current.srcObject = streamRef.current;
          videoRef.current.play().catch(() => {});
        }
        setCamOn(true);
      } catch { setCamError(true); }
    }
  };

  const toggleMic = () => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(t => { t.enabled = !micOn; });
    }
    setMicOn(p => !p);
  };

  const handleDeviceChange = async (type, id) => {
    if (type === 'cam') setSelectedCam(id);
    else setSelectedMic(id);
    await startPreview(
      type === 'cam' ? id : selectedCam,
      type === 'mic' ? id : selectedMic,
    );
  };

  const handleJoin = async () => {
    if (!auth.user) {
      const name = guestDisplayName.trim();
      if (!name) { setGuestError('Please enter your display name'); return; }
      setJoining(true);
      setGuestError('');
      try {
        const res = await meetingAPI.guestJoin(meetingId, { displayName: name });
        const { token, user: guestUser, meeting, is_host, waiting } = res.data;
        auth.loginAsGuest(guestUser, token);
        sessionStorage.setItem('guestJoinResult', JSON.stringify({ meeting, is_host, waiting }));
      } catch (e) {
        setGuestError(e.response?.data?.message || 'Failed to join meeting');
        setJoining(false);
        return;
      }
    } else {
      setJoining(true);
    }
    sessionStorage.setItem('prejoin', JSON.stringify({
      camOn, micOn,
      camId: selectedCam,
      micId: selectedMic,
      watermarkImage: watermarkDataUrl || null,
      watermarkPosition: 'bottom-right',
    }));
    // Hand the live stream to MeetingRoom instead of stopping and re-acquiring it.
    // stopPreview() would release the camera; getUserMedia immediately after can
    // fail on Windows/Chrome (NotReadableError) while the device is still releasing.
    if (streamRef.current) {
      setHandoffStream(streamRef.current);
      streamRef.current = null; // prevent the useEffect cleanup from stopping it
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    navigate(`/meet/${meetingId}`);
  };

  const onWatermarkSelected = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      setWatermarkDataUrl(typeof reader.result === 'string' ? reader.result : '');
      setWatermarkName(file.name);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: '20px',
      backgroundImage: 'radial-gradient(ellipse at 30% 40%, rgba(99,102,241,0.1) 0%, transparent 60%)',
    }}>
      <div style={{ width: '100%', maxWidth: 860 }}>

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h2 style={{ fontSize: 22, marginBottom: 6 }}>
            {meetingInfo ? `📹 ${meetingInfo.title}` : `📹 ${t('nav.joinMeeting')}`}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {t('pages.prejoin.subtitle')}
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)',
          gap: 20, alignItems: 'start',
        }} className="prejoin-grid">

          {/* Camera preview */}
          <div>
            <div style={{
              position: 'relative', aspectRatio: '16/9',
              background: '#0a0a18', borderRadius: 16, overflow: 'hidden',
              border: '1px solid var(--border)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}>
              <video
                ref={videoRef} autoPlay playsInline muted
                style={{
                  width: '100%', height: '100%', objectFit: 'cover',
                  display: camOn && !camError ? 'block' : 'none',
                  transform: 'scaleX(-1)', /* mirror */
                }}
              />
              {(!camOn || camError) && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 12,
                  background: '#0d0d1f',
                }}>
                  <div style={{
                    width: 72, height: 72, borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--primary), #a78bfa)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 28, fontWeight: 800, color: '#fff',
                  }}>
                    {(auth?.user?.name || guestDisplayName)?.[0]?.toUpperCase() || '?'}
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {camError ? t('pages.prejoin.cameraNotAvailable') : t('pages.prejoin.cameraOff')}
                  </span>
                </div>
              )}

              {/* Name overlay */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                padding: '8px 14px',
                background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                fontSize: 13, fontWeight: 600, color: '#fff',
              }}>
                {auth?.user?.name || guestDisplayName || '...'} ({t('common.you')})
              </div>
            </div>

            {/* Camera/Mic toggle buttons */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 12, marginTop: 16,
            }}>
              <button onClick={toggleMic} title={micOn ? t('pages.prejoin.muteMic') : t('pages.prejoin.unmuteMic')} style={{
                width: 52, height: 52, borderRadius: '50%', cursor: 'pointer',
                border: '1px solid', fontSize: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all .15s',
                background: micOn ? 'var(--surface2)' : 'rgba(239,68,68,0.15)',
                borderColor: micOn ? 'var(--border)' : 'rgba(239,68,68,0.5)',
                color: micOn ? 'var(--text)' : '#f87171',
              }}>
                {micOn ? '🎤' : '🔇'}
              </button>

              <button onClick={toggleCam} disabled={camError} title={camOn ? t('pages.prejoin.turnOffCamera') : t('pages.prejoin.turnOnCamera')} style={{
                width: 52, height: 52, borderRadius: '50%', cursor: camError ? 'not-allowed' : 'pointer',
                border: '1px solid', fontSize: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all .15s',
                background: camOn && !camError ? 'var(--surface2)' : 'rgba(239,68,68,0.15)',
                borderColor: camOn && !camError ? 'var(--border)' : 'rgba(239,68,68,0.5)',
                color: camOn && !camError ? 'var(--text)' : '#f87171',
                opacity: camError ? 0.5 : 1,
              }}>
                {camOn && !camError ? '📷' : '🚫'}
              </button>

              <button onClick={() => setShowDevices(p => !p)} title={t('nav.settings')} style={{
                width: 52, height: 52, borderRadius: '50%', cursor: 'pointer',
                border: '1px solid var(--border)', fontSize: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: showDevices ? 'rgba(99,102,241,0.2)' : 'var(--surface2)',
                borderColor: showDevices ? 'var(--primary)' : 'var(--border)',
                color: showDevices ? '#a5b4fc' : 'var(--text)',
                transition: 'all .15s',
              }}>
                ⚙️
              </button>
            </div>

            {/* Status indicators */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 10 }}>
              <span style={{ fontSize: 12, color: micOn ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                {micOn ? `● ${t('pages.prejoin.micOn')}` : `● ${t('pages.prejoin.micOff')}`}
              </span>
              <span style={{ fontSize: 12, color: (camOn && !camError) ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                {(camOn && !camError) ? `● ${t('pages.prejoin.cameraOn')}` : `● ${t('pages.prejoin.cameraOffStatus')}`}
              </span>
            </div>
          </div>

          {/* Right panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Meeting info card */}
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 14, padding: '20px',
            }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                {t('common.meetingId')}
              </div>
              <code style={{ fontSize: 15, display: 'block', marginBottom: 14 }}>{meetingId}</code>

              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                {t('pages.prejoin.joiningAs')}
              </div>
              {auth.user ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--primary), #a78bfa)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, color: '#fff',
                  }}>
                    {auth?.user?.name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{auth?.user?.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{auth?.user?.username}</div>
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom: 20 }}>
                  <input
                    type="text"
                    value={guestDisplayName}
                    onChange={e => { setGuestDisplayName(e.target.value); setGuestError(''); }}
                    placeholder="Your display name"
                    maxLength={50}
                    style={{
                      width: '100%', padding: '9px 12px', boxSizing: 'border-box',
                      background: 'var(--surface2)', border: `1px solid ${guestError ? '#f87171' : 'var(--border)'}`,
                      borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none',
                    }}
                  />
                  {guestError && (
                    <p style={{ color: '#f87171', fontSize: 12, marginTop: 4 }}>{guestError}</p>
                  )}
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
                  Watermark Image
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => watermarkInputRef.current?.click()}
                    style={{
                      border: '1px solid var(--border)',
                      background: 'var(--surface2)',
                      color: 'var(--text)',
                      borderRadius: 10,
                      padding: '8px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    🖼 Upload
                  </button>
                  <input
                    ref={watermarkInputRef}
                    type="file"
                    accept="image/*"
                    onChange={onWatermarkSelected}
                    style={{ display: 'none' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {watermarkName || 'Optional'}
                  </span>
                </div>
                {watermarkDataUrl && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img
                      src={watermarkDataUrl}
                      alt="watermark"
                      style={{
                        width: 56,
                        height: 56,
                        objectFit: 'contain',
                        background: 'var(--surface2)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: 6,
                      }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Default position: bottom-right
                    </span>
                  </div>
                )}
              </div>

              <button
                onClick={handleJoin}
                disabled={joining}
                style={{
                  width: '100%', padding: '13px', border: 'none',
                  borderRadius: 10, cursor: joining ? 'not-allowed' : 'pointer',
                  background: 'var(--primary)', color: '#fff',
                  fontSize: 15, fontWeight: 700,
                  boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
                  transition: 'all .15s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: joining ? 0.7 : 1,
                }}
              >
                {joining ? t('pages.prejoin.joining') : `🚀 ${t('common.joinNow')}`}
              </button>
            </div>

            {/* Device selector */}
            {showDevices && (
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 14, padding: '20px',
                animation: 'fadeIn .15s ease',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: 'var(--text)' }}>
                  {`⚙️ ${t('pages.prejoin.deviceSettings')}`}
                </div>

                {devices.cameras.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                      📷 {t('common.camera')}
                    </label>
                    <select
                      value={selectedCam}
                      onChange={e => handleDeviceChange('cam', e.target.value)}
                      style={{
                        width: '100%', padding: '9px 12px',
                        background: 'var(--surface2)', border: '1px solid var(--border)',
                        borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none',
                      }}
                    >
                      {devices.cameras.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `${t('common.camera')} ${d.deviceId.slice(0,8)}`}</option>
                      ))}
                    </select>
                  </div>
                )}

                {devices.mics.length > 0 && (
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                      🎤 {t('common.microphone')}
                    </label>
                    <select
                      value={selectedMic}
                      onChange={e => handleDeviceChange('mic', e.target.value)}
                      style={{
                        width: '100%', padding: '9px 12px',
                        background: 'var(--surface2)', border: '1px solid var(--border)',
                        borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none',
                      }}
                    >
                      {devices.mics.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `${t('common.micShort')} ${d.deviceId.slice(0,8)}`}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Back button */}
            <button
              onClick={() => { stopPreview(); navigate(-1); }}
              style={{
                background: 'none', border: '1px solid var(--border)',
                borderRadius: 10, padding: '10px', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: 13, fontWeight: 500,
                transition: 'all .15s',
              }}
            >
              ← {t('common.goBack')}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
        @media (max-width: 640px) {
          .prejoin-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}