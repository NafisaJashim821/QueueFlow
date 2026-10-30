import { minutesBetween } from '../../lib/format.js';

export default function ServingList({ tickets, counter, now, busy, actions }) {
  const others = tickets.filter((t) => t.counter !== counter);
  if (others.length === 0) return null;
  return (
    <section className="card" aria-labelledby="others-title">
      <div className="card-head"><h2 id="others-title">Other counters</h2></div>
      <ul className="serving-list">
        {others.map((t) => (
          <li key={t.id}>
            <div>
              <span className="token">{t.token}</span> <span className="muted small">Counter {t.counter}</span>
              <div className="small">{t.customer_name} · {minutesBetween(t.called_at, now)} min</div>
            </div>
            <button className="btn btn-small" disabled={!!busy} onClick={() => actions.complete(t)}>Complete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
