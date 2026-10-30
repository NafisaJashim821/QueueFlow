import { createContext, useCallback, useContext, useState } from 'react';

const LABELS = {
  live: ['Live', 'Changes appear instantly on every device'],
  connecting: ['Connecting…', 'Connecting to the live queue'],
  degraded: ['Reconnecting', 'Live updates interrupted — refreshing every few seconds'],
  offline: ['Offline', 'No internet connection — showing last known queue'],
};

export function ConnectionBadge({ connection, lastUpdated }) {
  const [label, title] = LABELS[connection] || LABELS.connecting;
  const at = lastUpdated ? ` · updated ${new Date(lastUpdated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : '';
  return (
    <span className={`conn conn-${connection}`} title={title + at} role="status" aria-live="polite">
      <span className="conn-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function TypeBadge({ type }) {
  return type === 'appointment'
    ? <span className="badge badge-appt">Appointment</span>
    : <span className="badge badge-walk">Walk-in</span>;
}

export function StatusBadge({ status }) {
  const map = {
    waiting: 'Waiting', serving: 'Being served', booked: 'Booked', completed: 'Done',
    no_show: 'No-show', cancelled: 'Cancelled',
  };
  return <span className={`badge badge-status-${status}`}>{map[status] || status}</span>;
}

export function FullPageMessage({ title, children, tone = 'info' }) {
  return (
    <div className="fullpage">
      <div className={`card fullpage-card tone-${tone}`}>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading the queue…' }) {
  return (
    <div className="fullpage" role="status">
      <div className="spinner" aria-hidden="true" />
      <p className="muted">{label}</p>
    </div>
  );
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="banner banner-error" role="alert">
      <span>⚠ {error}</span>
      {onRetry && <button className="btn btn-small" onClick={onRetry}>Retry</button>}
    </div>
  );
}

// --- Toasts ------------------------------------------------------------------
const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="assertive">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
