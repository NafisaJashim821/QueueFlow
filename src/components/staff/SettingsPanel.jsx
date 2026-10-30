import { useEffect, useState } from 'react';

const FIELDS = [
  ['active_counters', 'Open counters', 'How many staff are serving at once', 1, 20],
  ['default_service_minutes', 'Default service time (min)', 'Used until real service times are recorded', 1, 240],
  ['walkin_target_minutes', 'Walk-in target wait (min)', 'Higher = appointments get stronger priority; 0 = pure arrival order', 0, 600],
  ['appointment_grace_minutes', 'Appointment grace (min)', 'How late an appointment may check in and keep its slot', 0, 120],
];

export default function SettingsPanel({ settings, busy, actions }) {
  const [form, setForm] = useState(settings);
  // Keep the form in sync when another device changes settings. Keyed on the
  // values, not the object, because every snapshot refetch creates a new object.
  const settingsKey = JSON.stringify(settings);
  useEffect(() => { setForm(settings); }, [settingsKey]);

  const save = (e) => {
    e.preventDefault();
    const p = { business_name: form.business_name, timezone: form.timezone };
    for (const [k] of FIELDS) p[k] = Number(form[k]);
    actions.saveSettings(p);
  };
  const seed = () => {
    if (window.confirm('Replace today’s queue with fictional demo customers? This deletes all of today’s tickets.')) actions.seed();
  };

  return (
    <details className="card">
      <summary><strong>Settings & demo data</strong></summary>
      <form onSubmit={save} style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="s-name">Business name</label>
          <input id="s-name" type="text" value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-tz">Time zone <span className="hint">(IANA, e.g. Asia/Dhaka)</span></label>
          <input id="s-tz" type="text" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
        </div>
        {FIELDS.map(([k, label, hint, min, max]) => (
          <div className="field" key={k}>
            <label htmlFor={`s-${k}`}>{label}</label>
            <input id={`s-${k}`} type="number" min={min} max={max} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            <span className="hint">{hint}</span>
          </div>
        ))}
        <button className="btn btn-primary btn-block" type="submit" disabled={!!busy}>Save settings</button>
      </form>
      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '16px 0' }} />
      <button className="btn btn-block" onClick={seed} disabled={!!busy}>Load demo data</button>
      <p className="hint">Fills today’s queue with fictional customers (no real data) to try the app.</p>
    </details>
  );
}
