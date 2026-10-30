import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useNow, useQueueSnapshot } from '../hooks/useQueueSnapshot.js';
import { forecastQueue, formatWait, groupTickets, quoteNewWalkIn } from '../lib/queueEngine.js';
import { rpc } from '../lib/supabase.js';
import { ConnectionBadge, ErrorBanner, FullPageMessage, Spinner, useToast } from '../components/ui.jsx';
import AddCustomerForm from '../components/staff/AddCustomerForm.jsx';
import CounterPanel from '../components/staff/CounterPanel.jsx';
import WaitingTable from '../components/staff/WaitingTable.jsx';
import BookedTable from '../components/staff/BookedTable.jsx';
import ServingList from '../components/staff/ServingList.jsx';
import DoneList from '../components/staff/DoneList.jsx';
import SettingsPanel from '../components/staff/SettingsPanel.jsx';
import HowItWorks from '../components/HowItWorks.jsx';

const COUNTER_KEY = 'queueflow.counter';

function readCounter() {
  try { return Number(localStorage.getItem(COUNTER_KEY)) || 1; } catch { return 1; }
}

export default function StaffDashboard() {
  const { user, signOut } = useAuth();
  const { snapshot, error, connection, clockOffset, lastUpdated, refresh, loading } = useQueueSnapshot(user?.id);
  const now = useNow(clockOffset);
  const toast = useToast();
  const [counter, setCounterState] = useState(readCounter);
  const [busy, setBusy] = useState(null);

  const setCounter = (c) => {
    setCounterState(c);
    // Per-device preference only (which desk this screen is); queue data never lives here.
    try { localStorage.setItem(COUNTER_KEY, String(c)); } catch { /* storage unavailable */ }
  };

  /** Runs a server mutation, reports errors, and re-fetches the source of truth. */
  const act = useCallback(async (key, fn, success) => {
    setBusy(key);
    try {
      const result = await fn();
      const msg = typeof success === 'function' ? success(result) : success;
      if (msg) toast(msg);
      return result;
    } catch (e) {
      toast(e.message, 'error');
      return undefined;
    } finally {
      setBusy(null);
      refresh();
    }
  }, [refresh, toast]);

  const view = useMemo(() => {
    if (!snapshot) return null;
    const groups = groupTickets(snapshot);
    const forecast = forecastQueue(snapshot, now);
    const waitingEntries = forecast.entries.filter((e) => e.position != null);
    return {
      groups,
      forecast,
      waitingEntries,
      quote: quoteNewWalkIn(snapshot, now),
      servedToday: groups.done.filter((t) => t.status === 'completed' && t.service_day === snapshot.service_day).length,
    };
  }, [snapshot, now]);

  if (loading) return <Spinner />;
  if (!snapshot) {
    return (
      <FullPageMessage title="Couldn’t load the queue" tone="error">
        <p>{error}</p>
        <button className="btn btn-primary" onClick={refresh}>Try again</button>
      </FullPageMessage>
    );
  }

  const { settings } = snapshot;
  const counters = Array.from({ length: Math.max(settings.active_counters, counter) }, (_, i) => i + 1);
  const myCurrent = view.groups.serving.find((t) => t.counter === counter) || null;
  const next = view.waitingEntries[0] || null;

  const actions = {
    callNext: () => act('callNext', () => rpc('call_next', { p_counter: counter, p_complete_current: true }),
      (t) => (t ? `Calling ${t.token} (${t.customer_name}) to counter ${counter}` : 'Nobody is waiting')),
    callTicket: (t) => act(`call-${t.id}`, () => rpc('call_ticket', { p_id: t.id, p_counter: counter, p_complete_current: true }),
      `Calling ${t.token} to counter ${counter}`),
    complete: (t) => act(`complete-${t.id}`, () => rpc('complete_ticket', { p_id: t.id }), `${t.token} marked complete`),
    close: (t, status) => act(`close-${t.id}`, () => rpc('close_ticket', { p_id: t.id, p_status: status }),
      `${t.token} marked ${status === 'no_show' ? 'no-show' : 'cancelled'}`),
    returnToQueue: (t) => act(`return-${t.id}`, () => rpc('return_to_queue', { p_id: t.id }), `${t.token} returned to the queue`),
    checkIn: (t) => act(`checkin-${t.id}`, () => rpc('check_in_ticket', { p_id: t.id }), `${t.token} checked in`),
    add: (args) => act('add', () => rpc('add_ticket', args), (t) => `Token ${t.token} issued to ${t.customer_name}`),
    saveSettings: (p) => act('settings', () => rpc('update_settings', { p }), 'Settings saved'),
    seed: () => act('seed', () => rpc('seed_demo'), (n) => `Loaded ${n} fictional demo customers`),
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/staff" className="brand"><span className="brand-mark">Q</span>{settings.business_name}</Link>
          <ConnectionBadge connection={connection} lastUpdated={lastUpdated} />
          <span className="spacer" />
          <label htmlFor="counter" className="small" style={{ margin: 0 }}>This screen is</label>
          <select id="counter" value={counter} onChange={(e) => setCounter(Number(e.target.value))} style={{ width: 'auto' }}>
            {counters.map((c) => <option key={c} value={c}>Counter {c}</option>)}
          </select>
          <a className="btn btn-small" href="/" target="_blank" rel="noreferrer">Public board ↗</a>
          <button className="btn btn-small" onClick={signOut} title={user?.email}>Sign out</button>
        </div>
      </header>

      <main className="container stack">
        <ErrorBanner error={error} onRetry={refresh} />
        {connection !== 'live' && connection !== 'connecting' && (
          <div className="banner banner-warn" role="status">Live updates are reconnecting — the queue still refreshes every few seconds.</div>
        )}

        <section className="stats" aria-label="Queue summary">
          <Stat label="Waiting" value={view.groups.waiting.length} />
          <Stat label="Being served" value={view.groups.serving.length} hint={`${settings.active_counters} counter(s) open`} />
          <Stat label="Booked, not arrived" value={view.groups.booked.length} />
          <Stat label="Served today" value={view.servedToday} />
          <Stat label="Avg service" value={`${Math.round(view.forecast.avg)} min`}
                hint={snapshot.service_samples ? `from ${snapshot.service_samples} recent` : 'default (no data yet)'} />
          <Stat label="New walk-in wait" value={formatWait(view.quote)} hint="quote for someone arriving now" />
        </section>

        <div className="grid grid-dash">
          <div className="stack">
            <WaitingTable entries={view.waitingEntries} now={now} settings={settings} counter={counter} busy={busy} actions={actions} />
            <BookedTable tickets={view.groups.booked} forecast={view.forecast} now={now} settings={settings} busy={busy} actions={actions} />
            <DoneList tickets={view.groups.done} timezone={settings.timezone} />
          </div>
          <aside className="stack side-first">
            <CounterPanel counter={counter} current={myCurrent} next={next} now={now} settings={settings} busy={busy} actions={actions} />
            <AddCustomerForm busy={busy === 'add'} onAdd={actions.add} quote={view.quote} />
            <ServingList tickets={view.groups.serving} counter={counter} now={now} busy={busy} actions={actions} />
            <SettingsPanel settings={settings} busy={busy} actions={actions} />
            <HowItWorks settings={settings} compact />
          </aside>
        </div>
      </main>
    </>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
