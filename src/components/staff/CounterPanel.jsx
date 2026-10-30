import { TypeBadge } from '../ui.jsx';
import { formatClock, minutesBetween } from '../../lib/format.js';

export default function CounterPanel({ counter, current, next, now, settings, busy, actions }) {
  const nextLabel = next
    ? `${next.ticket.token} · ${next.ticket.customer_name}`
    : null;

  return (
    <section className="card serving-now" aria-labelledby="counter-title">
      <div className="card-head">
        <h2 id="counter-title">Counter {counter}</h2>
        {current && <span className="muted small">serving for {minutesBetween(current.called_at, now)} min</span>}
      </div>

      {current ? (
        <div style={{ marginBottom: 12 }}>
          <div className="token token-xl">{current.token}</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 600, marginTop: 6 }}>{current.customer_name}</div>
          <div className="row" style={{ marginTop: 4 }}>
            <TypeBadge type={current.booking_type} />
            {current.scheduled_at && <span className="muted small">slot {formatClock(current.scheduled_at, settings.timezone)}</span>}
            {current.called_out_of_order && <span className="tag-warn">called out of order</span>}
          </div>
          {current.notes && <p className="muted small" style={{ margin: '6px 0 0' }}>📝 {current.notes}</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => actions.complete(current)} disabled={!!busy}>✓ Complete</button>
            <button className="btn btn-danger" onClick={() => actions.close(current, 'no_show')} disabled={!!busy}>No-show</button>
            <button className="btn" onClick={() => actions.returnToQueue(current)} disabled={!!busy} title="Called by mistake — put back in the queue">Undo call</button>
          </div>
        </div>
      ) : (
        <p className="muted">Counter is free.</p>
      )}

      <button className="btn btn-primary btn-big" onClick={actions.callNext} disabled={!!busy || !next}>
        {busy === 'callNext' ? 'Calling…' : current ? 'Complete & call next' : 'Call next customer'}
      </button>
      <p className="small" style={{ margin: '8px 0 0' }}>
        {next ? <>Next: <strong>{nextLabel}</strong> <span className="muted">— {next.reason.label.toLowerCase()}</span></> : <span className="muted">No one is waiting.</span>}
      </p>
    </section>
  );
}
