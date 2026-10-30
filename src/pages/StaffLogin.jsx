import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

export default function StaffLogin() {
  const { session, isStaff, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!loading && session && isStaff) return <Navigate to="/staff" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await signIn(email.trim(), password);
    setBusy(false);
    if (err) setError(err.message === 'Invalid login credentials' ? 'Wrong email or password.' : err.message);
    else navigate('/staff', { replace: true });
  };

  return (
    <div className="fullpage">
      <form className="card fullpage-card" onSubmit={onSubmit} style={{ maxWidth: 400 }}>
        <div className="brand" style={{ marginBottom: 16 }}><span className="brand-mark">Q</span>QueueFlow staff</div>
        <h1>Sign in</h1>
        <p className="muted small">Staff accounts are created by an administrator. Customers don’t need to sign in — <Link to="/">view the public queue</Link>.</p>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="banner banner-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
