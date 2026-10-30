import { Navigate, Route, Routes } from 'react-router-dom';
import { isConfigured } from './lib/supabase.js';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import { FullPageMessage, Spinner, ToastProvider } from './components/ui.jsx';
import PublicBoard from './pages/PublicBoard.jsx';
import TokenStatus from './pages/TokenStatus.jsx';
import StaffLogin from './pages/StaffLogin.jsx';
import StaffDashboard from './pages/StaffDashboard.jsx';

function RequireStaff({ children }) {
  const { session, isStaff, loading, signOut } = useAuth();
  if (loading) return <Spinner label="Checking your sign-in…" />;
  if (!session) return <Navigate to="/staff/login" replace />;
  if (!isStaff) {
    return (
      <FullPageMessage title="Not a staff account" tone="error">
        <p>You are signed in as <strong>{session.user.email}</strong>, but this account is not on the staff list.</p>
        <p className="muted small">An administrator must add it with <code>supabase/add_staff.sql</code>.</p>
        <button className="btn" onClick={signOut}>Sign out</button>
      </FullPageMessage>
    );
  }
  return children;
}

export default function App() {
  if (!isConfigured) {
    return (
      <FullPageMessage title="Supabase is not configured" tone="error">
        <p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code>), then restart the dev server or redeploy on Vercel.</p>
      </FullPageMessage>
    );
  }
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<PublicBoard />} />
          <Route path="/t/:token" element={<TokenStatus />} />
          <Route path="/staff/login" element={<StaffLogin />} />
          <Route path="/staff" element={<RequireStaff><StaffDashboard /></RequireStaff>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
