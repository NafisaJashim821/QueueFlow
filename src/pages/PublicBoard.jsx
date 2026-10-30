import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNow, useQueueSnapshot } from '../hooks/useQueueSnapshot.js';
import { forecastQueue, formatWait, groupTickets, normaliseToken, quoteNewWalkIn } from '../lib/queueEngine.js';
import { formatClock } from '../lib/format.js';
import { ErrorBanner, FullPageMessage, Spinner, TypeBadge } from '../components/ui.jsx';
import PublicHeader from '../components/PublicHeader.jsx';
import HowItWorks from '../components/HowItWorks.jsx';

// Public screen (waiting-room TV or phone). Shows tokens only — never names.
export default function PublicBoard() {
  const { snapshot, error, connection, clockOffset, lastUpdated, refresh, loading } = useQueueSnapshot('public');
  const now = useNow(clockOffset);
  const navigate = useNavigate();
  const [lookup, setLookup] = useState('');
  const [lookupError, setLookupError] = useState('');

  const view = useMemo(() => {
    if (!snapshot) return null;
    const groups = groupTickets(snapshot);
    const forecast = forecastQueue(snapshot, now);
    const upNext = forecast.entries.filter((e) => e.position != null);
    return { groups, upNext, quote: quoteNewWalkIn(snapshot, now), forecast };
  }, [snapshot, now]);

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
  const onLookup = (e) => {
    e.preventDefault();
    const token = normaliseToken(lookup);
    if (!token) { setLookupError('Enter a token like W-012 or A-004'); return; }
    navigate(`/t/${token}`);
  };

  return (
    <>
      <PublicHeader name={snapshot.settings.business_name} connection={connection} lastUpdated={lastUpdated} />
      <main className="container stack">
        <ErrorBanner error={error} onRetry={refresh} />

        <section aria-labelledby="now-serving">
          <h2 id="now-serving">Now serving</h2>
          <div className="board-hero">
            {view.groups.serving.length === 0 && (
              <div className="card now-card"><p className="muted">No one is being served right now.</p></div>
            )}
            {view.groups.serving.map((t) => (
              <div className="card now-card" key={t.id}>
                <div className="counter">Counter {t.counter}</div>
                <div className="token token-xl">{t.token}</div>
                <div style={{ marginTop: 8 }}><TypeBadge type={t.booking_type} /></div>
              </div>
            ))}
          </div>
        </section>

        <section className="card" aria-labelledby="find-token">
          <div className="card-head">
            <h2 id="find-token">Check your token</h2>
            <span className="muted small">Estimated wait for a new walk-in: <strong>{formatWait(view.quote)}</strong></span>
          </div>
          <form className="lookup" onSubmit={onLookup}>
            <label htmlFor="token-input" className="sr-only">Token number</label>
            <input id="token-input" type="text" inputMode="text" autoComplete="off" placeholder="e.g. W-012"
                   value={lookup} onChange={(e) => { setLookup(e.target.value); setLookupError(''); }} />
            <button className="btn btn-primary" type="submit">Check</button>
          </form>
          {lookupError && <p className="tag-warn" role="alert">{lookupError}</p>}
        </section>

        <section aria-labelledby="up-next">
          <div className="card-head">
            <h2 id="up-next">Up next</h2>
            <span className="muted small">{view.upNext.length} waiting · times are estimates</span>
          </div>
          {view.upNext.length === 0 ? (
            <div className="card empty">The queue is empty — walk right up!</div>
          ) : (
            <ul className="upnext">
              {view.upNext.map((e) => (
                <li key={e.ticket.id}>
                  <div>
                    <div className="token token-lg">{e.ticket.token}</div>
                    <div className="pos">#{e.position} · <TypeBadge type={e.ticket.booking_type} /></div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div><strong>{formatWait(e.waitMinutes)}</strong></div>
                    <div className="muted small">≈ {formatClock(e.startMs, tz)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <HowItWorks settings={snapshot.settings} compact />
      </main>
      <footer className="footer">Times shown in {tz}. Your token is printed on your slip or given by reception.</footer>
    </>
  );
}
