import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useNow, useQueueSnapshot } from '../hooks/useQueueSnapshot.js';
import { forecastQueue, formatWait, normaliseToken, ordinal } from '../lib/queueEngine.js';
import { formatClock } from '../lib/format.js';
import { ErrorBanner, FullPageMessage, Spinner, TypeBadge } from '../components/ui.jsx';
import PublicHeader from '../components/PublicHeader.jsx';
import HowItWorks from '../components/HowItWorks.jsx';

// A customer's personal, live-updating status page: /t/W-012
export default function TokenStatus() {
  const params = useParams();
  const token = normaliseToken(params.token);
  const { snapshot, error, connection, clockOffset, lastUpdated, refresh, loading } = useQueueSnapshot('public');
  const now = useNow(clockOffset, 10_000);

  const info = useMemo(() => {
    if (!snapshot || !token) return null;
    // Tokens restart daily; prefer today's ticket, else a still-active one.
    const matches = snapshot.tickets.filter((t) => t.token === token);
    const ticket = matches.find((t) => t.service_day === snapshot.service_day) || matches[0];
    if (!ticket) return null;
    const forecast = forecastQueue(snapshot, now);
    return { ticket, entry: forecast.byId.get(ticket.id) };
  }, [snapshot, token, now]);

  if (loading) return <Spinner />;
  if (!snapshot) {
    return (
      <FullPageMessage title="Queue unavailable" tone="error">
        <p>{error}</p>
        <button className="btn btn-primary" onClick={refresh}>Try again</button>
      </FullPageMessage>
    );
  }
  const tz = snapshot.settings.timezone;

  return (
    <>
      <PublicHeader name={snapshot.settings.business_name} connection={connection} lastUpdated={lastUpdated} />
      <main className="container stack" style={{ maxWidth: 640 }}>
        <ErrorBanner error={error} onRetry={refresh} />
        {!info ? (
          <div className="card status-hero">
            <h1>Token {token || params.token} not found</h1>
            <p className="muted">Check the code on your slip (for example <strong>W-012</strong>). Tokens reset every day.</p>
            <Link className="btn btn-primary" to="/">Back to queue board</Link>
          </div>
        ) : (
          <StatusCard {...info} tz={tz} settings={snapshot.settings} />
        )}
        <p className="muted small" style={{ textAlign: 'center' }}>
          Keep this page open — it updates automatically. <Link to="/">View whole queue</Link>
        </p>
        <HowItWorks settings={snapshot.settings} compact />
      </main>
    </>
  );
}

function StatusCard({ ticket, entry, tz, settings }) {
  let headline, sub, tone = '';
  switch (ticket.status) {
    case 'serving':
      headline = `Please go to Counter ${ticket.counter}`;
      sub = 'It’s your turn now.';
      tone = 'status-call';
      break;
    case 'waiting':
      headline = entry?.position === 1 ? 'You’re next' : `You’re ${ordinal(entry?.position ?? 0)} in line`;
      sub = entry ? `Estimated wait ${formatWait(entry.waitMinutes)} (around ${formatClock(entry.startMs, tz)})` : '';
      break;
    case 'booked':
      headline = 'Appointment booked';
      sub = `Please check in at reception when you arrive. Your slot is ${formatClock(ticket.scheduled_at, tz)}; arriving more than ${settings.appointment_grace_minutes} min late means joining the walk-in queue.`;
      break;
    case 'completed':
      headline = 'Service complete';
      sub = 'Thank you for visiting!';
      break;
    case 'no_show':
      headline = 'Missed turn';
      sub = 'Your token was called but we could not find you. Please speak to reception.';
      break;
    default:
      headline = 'Ticket cancelled';
      sub = 'Please speak to reception if this is a mistake.';
  }

  return (
    <div className={`card status-hero ${tone}`} aria-live="polite">
      <div className="muted small">Your token</div>
      <div className="token token-xl">{ticket.token}</div>
      <div style={{ margin: '8px 0 16px' }}><TypeBadge type={ticket.booking_type} /></div>
      <div className="big">{headline}</div>
      {sub && <p>{sub}</p>}
      {ticket.status === 'waiting' && entry && (
        <div className="facts">
          <div className="fact"><div className="k">Position</div><div className="v">{entry.position}</div></div>
          <div className="fact"><div className="k">Estimated wait</div><div className="v">{formatWait(entry.waitMinutes)}</div></div>
          <div className="fact"><div className="k">Expected call</div><div className="v">{formatClock(entry.startMs, tz)}</div></div>
          {ticket.scheduled_at && (
            <div className="fact"><div className="k">Your slot</div><div className="v">{formatClock(ticket.scheduled_at, tz)}</div></div>
          )}
        </div>
      )}
      {ticket.status === 'waiting' && entry?.lateByMinutes > 0 && (
        <p className="tag-warn">We’re running about {entry.lateByMinutes} min behind your appointment time — sorry for the wait.</p>
      )}
    </div>
  );
}
