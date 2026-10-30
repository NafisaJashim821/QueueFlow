import { useState } from 'react';
import { toLocalInput } from '../../lib/format.js';
import { formatWait } from '../../lib/queueEngine.js';

function defaultSlot() {
  const d = new Date(Date.now() + 30 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(d);
}

export default function AddCustomerForm({ onAdd, busy, quote }) {
  const [type, setType] = useState('walk_in');
  const [name, setName] = useState('');
  const [slot, setSlot] = useState(defaultSlot);
  const [arrived, setArrived] = useState(true);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Enter the customer’s name.'); return; }
    let scheduledAt = null;
    if (type === 'appointment') {
      // datetime-local is interpreted in this device's time zone (assumed = business time zone).
      const d = new Date(slot);
      if (Number.isNaN(d.getTime())) { setError('Pick an appointment time.'); return; }
      scheduledAt = d.toISOString();
    }
    const result = await onAdd({
      p_name: name.trim(),
      p_booking_type: type,
      p_scheduled_at: scheduledAt,
      p_arrived: type === 'walk_in' ? true : arrived,
      p_notes: notes.trim() || null,
    });
    if (result) { setName(''); setNotes(''); setSlot(defaultSlot()); }
  };

  return (
    <form className="card" onSubmit={submit} aria-labelledby="add-title">
      <div className="card-head"><h2 id="add-title">Add customer</h2></div>
      <div className="field">
        <div className="segmented" role="group" aria-label="Booking type">
          <button type="button" aria-pressed={type === 'walk_in'} onClick={() => setType('walk_in')}>Walk-in</button>
          <button type="button" aria-pressed={type === 'appointment'} onClick={() => setType('appointment')}>Appointment</button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="cust-name">Customer name</label>
        <input id="cust-name" type="text" maxLength={80} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan Reyes" />
      </div>
      {type === 'appointment' && (
        <>
          <div className="field">
            <label htmlFor="cust-slot">Appointment time</label>
            <input id="cust-slot" type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} required />
          </div>
          <div className="field">
            <label className="check"><input type="checkbox" checked={arrived} onChange={(e) => setArrived(e.target.checked)} /> Customer is here now (check in)</label>
            <span className="hint">Untick when booking ahead — check them in when they arrive.</span>
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="cust-notes">Note <span className="hint">(optional, staff only)</span></label>
        <input id="cust-notes" type="text" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. haircut + colour" />
      </div>
      {error && <p className="tag-warn" role="alert">{error}</p>}
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Issue token'}</button>
      {type === 'walk_in' && <p className="hint" style={{ marginBottom: 0 }}>Quote for this walk-in: {formatWait(quote)}</p>}
    </form>
  );
}
