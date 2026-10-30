import { StatusBadge, TypeBadge } from '../ui.jsx';
import { formatClock } from '../../lib/format.js';

export default function DoneList({ tickets, timezone }) {
  return (
    <details className="card">
      <summary><strong>Finished today ({tickets.length})</strong></summary>
      {tickets.length === 0 ? (
        <p className="muted">Nothing finished yet.</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="qtable">
            <thead><tr><th>Token</th><th>Customer</th><th>Type</th><th>Outcome</th><th>Called</th><th>Service time</th></tr></thead>
            <tbody>
              {tickets.map((t) => {
                const mins = t.called_at && t.completed_at ? Math.round((Date.parse(t.completed_at) - Date.parse(t.called_at)) / 60_000) : null;
                return (
                  <tr key={t.id}>
                    <td data-label="Token"><span className="token">{t.token}</span></td>
                    <td data-label="Customer">{t.customer_name}</td>
                    <td data-label="Type"><TypeBadge type={t.booking_type} /></td>
                    <td data-label="Outcome"><StatusBadge status={t.status} />{t.called_out_of_order && <div className="tag-warn">override</div>}</td>
                    <td data-label="Called" className="mono">{t.called_at ? formatClock(t.called_at, timezone) : '—'}</td>
                    <td data-label="Service time" className="mono">{t.status === 'completed' && mins != null ? `${mins} min` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
