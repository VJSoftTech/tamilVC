import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Login       from './pages/Login.jsx';
import Register    from './pages/Register.jsx';
import Dashboard   from './pages/Dashboard.jsx';
import NewMeeting  from './pages/NewMeeting.jsx';
import JoinMeeting from './pages/JoinMeeting.jsx';
import MeetingRoom from './pages/MeetingRoom.jsx';
import PreJoin     from './pages/PreJoin.jsx';
import Recordings  from './pages/Recordings.jsx';
import Meetings    from './pages/Meetings.jsx';
import Layout      from './components/layout/Layout.jsx';
import Users       from './pages/Users.jsx';
import Settings    from './pages/Settings.jsx';

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  return user ? children : <Navigate to="/login" />;
};
const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  return user ? <Navigate to="/dashboard" /> : children;
};

const AdminRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" />;
  return user.userType === 'admin' ? children : <Navigate to="/dashboard" />;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/"         element={<Navigate to="/dashboard" />} />
      <Route path="/login"    element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route path="dashboard"    element={<Dashboard />} />
        <Route path="new-meeting"  element={<NewMeeting />} />
        <Route path="join-meeting" element={<JoinMeeting />} />
        <Route path="meetings"     element={<Meetings />} />
        <Route path="recordings"   element={<Recordings />} />
        <Route path="settings"     element={<Settings />} />
        <Route path="users"        element={<AdminRoute><Users /></AdminRoute>} />
      </Route>
      {/* Prejoin lobby — full page, no sidebar */}
      <Route path="/prejoin/:meetingId" element={<PrivateRoute><PreJoin /></PrivateRoute>} />
      {/* Meeting room */}
      <Route path="/meet/:meetingId"    element={<PrivateRoute><MeetingRoom /></PrivateRoute>} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}