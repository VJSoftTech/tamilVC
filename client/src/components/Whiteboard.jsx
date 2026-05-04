import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

// ─── Tool definitions ─────────────────────────────────────────────
const TOOLS = {
  pencil:  { labelKey: 'pages.meetingRoom.whiteboardPanel.tools.pencil', icon: '✏️' },
  line:    { labelKey: 'pages.meetingRoom.whiteboardPanel.tools.line', icon: '╱' },
  rect:    { labelKey: 'pages.meetingRoom.whiteboardPanel.tools.rectangle', icon: '▭' },
  ellipse: { labelKey: 'pages.meetingRoom.whiteboardPanel.tools.ellipse', icon: '⬭' },
  arrow:   { labelKey: 'pages.meetingRoom.whiteboardPanel.tools.arrow', icon: '➜' },
  text:    { labelKey: 'pages.meetingRoom.whiteboardPanel.tools.text', icon: 'T' },
  eraser:  { labelKey: 'pages.meetingRoom.whiteboardPanel.tools.eraser', icon: '🧹' },
};

const COLORS = ['#ffffff','#f87171','#fb923c','#facc15','#4ade80','#34d399','#38bdf8','#818cf8','#e879f9','#000000'];
const SIZES  = [2, 4, 8, 14, 22];

// ─── Virtual canvas space ─────────────────────────────────────────
// The canvas BUFFER is always VIRT_W×VIRT_H.
// CSS dimensions scale it to fit any screen — the browser handles it.
// Every stroke is stored and transmitted in these buffer coordinates.
// A shape drawn as a circle (equal width/height in buffer) always renders
// as a circle on every device because both use the same 16:9 buffer.
const VIRT_W = 1600;
const VIRT_H = 900;

// ─── Draw helpers ─────────────────────────────────────────────────
// All coordinates are already in VIRT_W×VIRT_H buffer space — no scaling needed.
function drawStroke(ctx, stroke) {
  const { tool, color, size, points, text, x1, y1, x2, y2 } = stroke;
  ctx.save();
  ctx.strokeStyle = tool === 'eraser' ? '#1e1e2e' : color;
  ctx.fillStyle   = color;
  ctx.lineWidth   = size;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  switch (tool) {
    case 'pencil':
    case 'eraser':
      if (!points || points.length < 2) break;
      ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
      break;
    case 'line':
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      break;
    case 'rect':
      ctx.beginPath();
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(
        (x1 + x2) / 2, (y1 + y2) / 2,
        Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2,
        0, 0, 2 * Math.PI,
      );
      ctx.stroke();
      break;
    case 'arrow': {
      const headLen = Math.max(size * 4, 12);
      const angle   = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'text':
      if (!text) break;
      ctx.font = `${size * 5 + 10}px sans-serif`;
      ctx.fillStyle = color;
      ctx.fillText(text, x1, y1);
      break;
    default: break;
  }
  ctx.restore();
}

function redrawAll(ctx, strokes) {
  ctx.clearRect(0, 0, VIRT_W, VIRT_H);
  strokes.forEach(s => drawStroke(ctx, s));
}

// ─── Whiteboard component ─────────────────────────────────────────
// isHost  — shows the toolbar; viewers see a read-only canvas
// socket  — socket.io instance for broadcasting
// meetingId — for scoping socket events
const Whiteboard = forwardRef(function Whiteboard({ isHost, socketRef, meetingId }, ref) {
  const { t } = useTranslation();
  const canvasRef   = useRef(null);
  const strokesRef  = useRef([]);   // committed strokes for replay
  const drawingRef  = useRef(false);
  const currentRef  = useRef(null); // in-progress stroke data
  const textInputRef= useRef(null);

  const [tool,       setTool]       = useState('pencil');
  const [color,      setColor]      = useState('#ffffff');
  const [size,       setSize]       = useState(4);
  const [textInput,  setTextInput]  = useState('');
  const [textPos,    setTextPos]    = useState(null); // {x,y} awaiting text entry

  // Set the canvas buffer to exactly VIRT_W×VIRT_H once on mount.
  // CSS width:100%/height:100% scales it visually — no ResizeObserver needed.
  // Done in useLayoutEffect (sync, before paint) so the canvas is always
  // correctly sized before any stroke can be drawn or received.
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = VIRT_W;
    canvas.height = VIRT_H;
  }, []);

  // Expose methods so MeetingRoom can sync strokes and apply remote events
  useImperativeHandle(ref, () => ({
    getStrokes: () => strokesRef.current,
    applyStrokes: (strokes) => {
      strokesRef.current = strokes;
      const canvas = canvasRef.current;
      if (canvas) redrawAll(canvas.getContext('2d'), strokes);
    },
    receiveStroke: (stroke) => {
      strokesRef.current.push(stroke);
      const canvas = canvasRef.current;
      if (canvas) drawStroke(canvas.getContext('2d'), stroke);
    },
    clearBoard: () => {
      strokesRef.current = [];
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext('2d').clearRect(0, 0, VIRT_W, VIRT_H);
    },
  }), []);

  // Remote draw/clear/sync events are handled by MeetingRoom via ref methods

  // ── Pointer helpers ───────────────────────────────────────────────
  // Returns position in virtual (VIRT_W × VIRT_H) coordinates
  const getPos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - r.left) / r.width  * VIRT_W,
      y: (src.clientY - r.top)  / r.height * VIRT_H,
    };
  };

  const commitAndBroadcast = useCallback((stroke) => {
    strokesRef.current.push(stroke);
    socketRef?.current?.emit('whiteboard:draw', { meetingId, stroke });
  }, [socketRef, meetingId]);

  // ── Pointer down ──────────────────────────────────────────────────
  const onPointerDown = useCallback((e) => {
    if (!isHost) return;
    e.preventDefault();
    const pos = getPos(e);

    if (tool === 'text') {
      setTextPos(pos);
      setTextInput('');
      setTimeout(() => textInputRef.current?.focus(), 0);
      return;
    }

    drawingRef.current = true;
    canvasRef.current.setPointerCapture(e.pointerId);

    if (tool === 'pencil' || tool === 'eraser') {
      currentRef.current = { tool, color, size, points: [pos] };
    } else {
      currentRef.current = { tool, color, size, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
    }
  }, [isHost, tool, color, size]);

  // ── Pointer move ──────────────────────────────────────────────────
  const onPointerMove = useCallback((e) => {
    if (!drawingRef.current || !currentRef.current) return;
    e.preventDefault();
    const pos = getPos(e);
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    const s      = currentRef.current;

    if (tool === 'pencil' || tool === 'eraser') {
      s.points.push(pos);
      // Draw incremental segment directly in buffer coords
      ctx.save();
      ctx.strokeStyle = tool === 'eraser' ? '#1e1e2e' : s.color;
      ctx.lineWidth   = s.size;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.beginPath();
      const pts = s.points;
      ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
      ctx.restore();
    } else {
      // Shape preview: redraw committed strokes then overlay current ghost
      s.x2 = pos.x;
      s.y2 = pos.y;
      redrawAll(ctx, strokesRef.current);
      drawStroke(ctx, s);
    }
  }, [tool]);

  // ── Pointer up ────────────────────────────────────────────────────
  const onPointerUp = useCallback((e) => {
    if (!drawingRef.current || !currentRef.current) return;
    drawingRef.current = false;
    const pos = getPos(e);
    const s   = currentRef.current;

    if (tool !== 'pencil' && tool !== 'eraser') {
      s.x2 = pos.x;
      s.y2 = pos.y;
    }

    // Final draw + commit
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    redrawAll(ctx, strokesRef.current);
    drawStroke(ctx, s);
    commitAndBroadcast(s);
    currentRef.current = null;
  }, [tool, commitAndBroadcast]);

  // ── Text commit ───────────────────────────────────────────────────
  const commitText = useCallback(() => {
    if (!textPos || !textInput.trim()) { setTextPos(null); return; }
    const stroke = { tool: 'text', color, size, text: textInput.trim(), x1: textPos.x, y1: textPos.y };
    const canvas = canvasRef.current;
    drawStroke(canvas.getContext('2d'), stroke);
    commitAndBroadcast(stroke);
    setTextPos(null);
    setTextInput('');
  }, [textPos, textInput, color, size, commitAndBroadcast]);

  // ── Clear ─────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    strokesRef.current = [];
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, VIRT_W, VIRT_H);
    socketRef?.current?.emit('whiteboard:clear', { meetingId });
  }, [socketRef, meetingId]);

  // ── Undo ──────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    if (!strokesRef.current.length) return;
    strokesRef.current.pop();
    const canvas = canvasRef.current;
    redrawAll(canvas.getContext('2d'), strokesRef.current);
    // Broadcast virtual-coord strokes so all peers undo in one shot
    socketRef?.current?.emit('whiteboard:sync', {
      meetingId,
      to: '__room__',
      strokes: strokesRef.current,
    });
  }, [socketRef, meetingId]);

  const cursor = isHost
    ? (tool === 'eraser' ? 'cell' : tool === 'text' ? 'text' : 'crosshair')
    : 'default';

  return (
    <div style={{
      position: 'relative',
      width: '100%', aspectRatio: '16/9',
      maxWidth: '100%', maxHeight: '100%',
      margin: 'auto',
      background: '#1e1e2e', borderRadius: 12, overflow: 'hidden',
    }}>

      {/* ── Canvas ── */}
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%', cursor, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />

      {/* ── Floating text input ── */}
      {textPos && (
        <div style={{
          position: 'absolute',
          left: `${textPos.x / VIRT_W * 100}%`,
          top:  `calc(${textPos.y / VIRT_H * 100}% - 20px)`,          zIndex: 20,
        }}>
          <input
            ref={textInputRef}
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextPos(null); }}
            onBlur={commitText}
            placeholder={t('pages.meetingRoom.whiteboardPanel.textPlaceholder')}
            style={{
              background: 'rgba(30,30,46,0.9)',
              border: `2px solid ${color}`,
              color, fontSize: size * 5 + 10,
              padding: '2px 6px', borderRadius: 4, outline: 'none',
              minWidth: 120,
            }}
          />
        </div>
      )}

      {/* ── Toolbar (host only) ── */}
      {isHost && (
        <div style={{
          position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'rgba(15,15,30,0.92)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 40, padding: '6px 14px',
          flexWrap: 'nowrap', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
          maxWidth: 'calc(100% - 24px)',
          zIndex: 10,
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        }}>

          {/* Tools */}
          {Object.entries(TOOLS).map(([key, { labelKey, icon }]) => (
            <button
              key={key}
              title={t(labelKey)}
              onClick={() => setTool(key)}
              style={{
                width: 36, height: 36, borderRadius: 8,
                background: tool === key ? 'rgba(99,102,241,0.4)' : 'transparent',
                border: tool === key ? '1px solid rgba(99,102,241,0.8)' : '1px solid transparent',
                color: '#e2e8f0', cursor: 'pointer', fontSize: key === 'text' ? 15 : 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all .15s',
              }}
            >{icon}</button>
          ))}

          <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

          {/* Colors */}
          {COLORS.map(c => (
            <button
              key={c}
              title={c}
              onClick={() => setColor(c)}
              style={{
                width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                border: color === c ? '2px solid #fff' : '2px solid transparent',
                boxShadow: color === c ? `0 0 0 2px ${c}` : 'none',
                flexShrink: 0,
                transition: 'all .15s',
              }}
            />
          ))}

          <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

          {/* Sizes */}
          {SIZES.map(s => (
            <button
              key={s}
              title={t('pages.meetingRoom.whiteboardPanel.sizeN', { size: s })}
              onClick={() => setSize(s)}
              style={{
                width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
                background: size === s ? 'rgba(99,102,241,0.4)' : 'transparent',
                border: size === s ? '1px solid rgba(99,102,241,0.8)' : '1px solid transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all .15s',
              }}
            >
              <div style={{ width: Math.min(s * 1.8, 18), height: Math.min(s * 1.8, 18), borderRadius: '50%', background: color }} />
            </button>
          ))}

          <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

          {/* Undo */}
          <button
            title={t('pages.meetingRoom.whiteboardPanel.undo')}
            onClick={handleUndo}
            style={{
              width: 36, height: 36, borderRadius: 8, background: 'transparent',
              border: '1px solid transparent', color: '#e2e8f0', cursor: 'pointer',
              fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .15s',
            }}
          >↩</button>

          {/* Clear */}
          <button
            title={t('pages.meetingRoom.whiteboardPanel.clearBoard')}
            onClick={handleClear}
            style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#f87171', cursor: 'pointer', fontSize: 14, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .15s',
            }}
          >✕</button>
        </div>
      )}

      {/* Viewer banner */}
      {!isHost && (
        <div style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)',
          borderRadius: 20, padding: '4px 14px', fontSize: 12, color: '#a5b4fc',
          pointerEvents: 'none',
        }}>
          📋 {t('pages.meetingRoom.whiteboardPanel.hostPresenting')}
        </div>
      )}
    </div>
  );
});

export default Whiteboard;
