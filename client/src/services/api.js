import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('guestToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !sessionStorage.getItem('guestToken')) {
      // Don't redirect to login when the user is on a meeting or pre-join page
      // — those pages handle unauthenticated state themselves
      const path = window.location.pathname;
      const onMeetingPath = path.startsWith('/meet/') || path.startsWith('/prejoin/');
      if (!onMeetingPath) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export const authAPI = {
  register: (d) => api.post('/register', d),
  login:    (d) => api.post('/login', d),
  logout:   ()  => api.post('/logout'),
  me:       ()  => api.get('/me'),
};

export const meetingAPI = {
  createInstant:   (d)  => api.post('/meetings/instant', d),
  schedule:        (d)  => api.post('/meetings/schedule', d),
  updateTitle:     (id, d) => api.patch(`/meetings/${id}/title`, d),
  getInfo:         (id) => api.get(`/meetings/${id}/info`),
  join:            (id) => api.post(`/meetings/${id}/join`),
  guestJoin:       (id, d) => api.post(`/meetings/${id}/guest-join`, d),
  leave:           (id) => api.post(`/meetings/${id}/leave`),
  end:             (id) => api.post(`/meetings/${id}/end`),
  getAll:          ()   => api.get('/meetings'),
  getParticipants: (id) => api.get(`/meetings/${id}/participants`),
  getStats:        ()   => api.get('/meetings/stats/dashboard'),
};

export const signalAPI = {
  sendOffer:          (mid, d) => api.post(`/signal/${mid}/offer`, d),
  sendAnswer:         (mid, d) => api.post(`/signal/${mid}/answer`, d),
  sendIceCandidate:   (mid, d) => api.post(`/signal/${mid}/ice-candidate`, d),
  sendMediaStatus:    (mid, d) => api.post(`/signal/${mid}/media-status`, d),
  sendRaiseHand:      (mid, d) => api.post(`/signal/${mid}/raise-hand`, d),
  sendRecordingStatus:(mid, d) => api.post(`/signal/${mid}/recording-status`, d),
};

export const recordingAPI = {
  getAll:   ()    => api.get('/recordings'),
  save:     (d)   => api.post('/recordings', d, { headers: { 'Content-Type': 'multipart/form-data' } }),
  download: (id)  => api.get(`/recordings/${id}/download`, { responseType: 'blob' }),
  delete:   (id)  => api.delete(`/recordings/${id}`),
};

export const messageAPI = {
  getAll: (mid)       => api.get(`/meetings/${mid}/messages`),
  send:   (mid, msg)  => api.post(`/meetings/${mid}/messages`, { message: msg }),
};

export const usersAPI = {
  validate: (params)         => api.get('/users/validate', { params }),
  getAll:    ()              => api.get('/users'),
  create:    (formData)      => api.post('/users', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  update:    (id, formData)  => api.put(`/users/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  remove:    (id)            => api.delete(`/users/${id}`),
};

export const settingsAPI = {
  getMe:      ()             => api.get('/settings/me'),
  updateMe:   (formData)     => api.put('/settings/me', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
};

export default api;
