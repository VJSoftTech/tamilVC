/**
 * Module-level store that lets PreJoin hand its live MediaStream directly to
 * MeetingRoom, avoiding the stop-then-re-acquire pattern that causes
 * NotReadableError on Windows/Chrome when the camera is briefly still "busy".
 */
let _stream = null;

export const setHandoffStream = (stream) => { _stream = stream; };
export const takeHandoffStream = () => { const s = _stream; _stream = null; return s; };
