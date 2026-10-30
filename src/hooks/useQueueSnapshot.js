import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const POLL_LIVE_MS = 30_000;     // safety net even when realtime is healthy
const POLL_DEGRADED_MS = 5_000;  // realtime down → poll fast
const DEBOUNCE_MS = 120;

/**
 * Keeps an always-fresh copy of public.get_queue_snapshot().
 *
 * Supabase is the single source of truth: this hook never edits the snapshot
 * locally. It re-fetches when
 *   1. the queue_signal row changes (Supabase Realtime, every device/tab),
 *   2. the realtime channel (re)subscribes — catches changes missed while offline,
 *   3. the tab becomes visible / the browser comes back online,
 *   4. a poll timer fires (fast while realtime is down),
 *   5. the caller invokes refresh() right after its own mutation.
 *
 * `authKey` should change when the signed-in user changes so staff get names.
 */
export function useQueueSnapshot(authKey = 'anon') {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [connection, setConnection] = useState('connecting'); // connecting | live | degraded | offline
  const [clockOffset, setClockOffset] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  const seq = useRef(0);
  const timer = useRef(null);
  const connRef = useRef('connecting');

  const fetchNow = useCallback(async () => {
    const mine = ++seq.current;
    const sentAt = Date.now();
    const { data, error: err } = await supabase.rpc('get_queue_snapshot');
    if (mine !== seq.current) return; // a newer request is in flight; drop stale result
    if (err) {
      setError(err.message || 'Could not load the queue');
      return;
    }
    const receivedAt = Date.now();
    const serverMs = Date.parse(data.server_time);
    // Use server time for all estimates so a wrong device clock can't skew them.
    setClockOffset(serverMs - (sentAt + receivedAt) / 2);
    setSnapshot(data);
    setError(null);
    setLastUpdated(receivedAt);
  }, []);

  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fetchNow, DEBOUNCE_MS);
  }, [fetchNow]);

  useEffect(() => {
    fetchNow();
    const setConn = (c) => { connRef.current = c; setConnection(c); };

    const channel = supabase
      .channel(`queue-signal-${authKey}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_signal' }, refresh)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') { setConn('live'); refresh(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConn('degraded');
        else if (status === 'CLOSED') setConn(navigator.onLine ? 'degraded' : 'offline');
      });

    let pollId;
    const schedulePoll = () => {
      pollId = setTimeout(() => {
        fetchNow().finally(schedulePoll);
      }, connRef.current === 'live' ? POLL_LIVE_MS : POLL_DEGRADED_MS);
    };
    schedulePoll();

    const onVisible = () => document.visibilityState === 'visible' && refresh();
    const onOnline = () => { setConn(connRef.current === 'offline' ? 'degraded' : connRef.current); refresh(); };
    const onOffline = () => setConn('offline');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      clearTimeout(pollId);
      clearTimeout(timer.current);
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [authKey, fetchNow, refresh]);

  return { snapshot, error, connection, clockOffset, lastUpdated, refresh, loading: !snapshot && !error };
}

/** Server-corrected "now" that re-renders every `intervalMs` so waits count down. */
export function useNow(clockOffset, intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    setNow(Date.now() + clockOffset);
    const id = setInterval(() => setNow(Date.now() + clockOffset), intervalMs);
    return () => clearInterval(id);
  }, [clockOffset, intervalMs]);
  return now;
}
