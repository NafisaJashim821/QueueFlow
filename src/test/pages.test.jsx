// @vitest-environment jsdom
// Smoke-renders every page against real snapshots exported from the Postgres
// schema (supabase/schema.sql + seed_demo), with the Supabase client mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fixture from './snapshots.fixture.json';

const state = vi.hoisted(() => ({ session: null, snapshot: null, rpcCalls: [] }));

vi.mock('../lib/supabase.js', () => {
  const channel = { on: () => channel, subscribe: (cb) => { cb('SUBSCRIBED'); return channel; } };
  const supabase = {
    rpc: async (fn, args) => {
      state.rpcCalls.push([fn, args]);
      if (fn === 'get_queue_snapshot') return { data: state.snapshot, error: null };
      if (fn === 'is_staff') return { data: !!state.session, error: null };
      return { data: null, error: null };
    },
    channel: () => channel,
    removeChannel: () => {},
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => ({ error: null }),
      signOut: async () => ({}),
    },
  };
  return {
    isConfigured: true,
    supabase,
    rpc: async (fn, args) => (await supabase.rpc(fn, args)).data,
  };
});

const { default: App } = await import('../App.jsx');

const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

beforeEach(() => { state.rpcCalls = []; state.session = null; });
afterEach(cleanup);

describe('public pages', () => {
  beforeEach(() => { state.snapshot = fixture.pub; });

  it('board shows now-serving tokens and up-next list without any names', async () => {
    const { container } = renderAt('/');
    await screen.findByText('Now serving');
    expect(screen.getAllByText(/^Counter \d$/).length).toBe(2);
    expect(screen.getByText('W-008')).toBeTruthy();       // first in line (longest-waiting walk-in)
    expect(container.textContent).not.toMatch(/Okafor|Calloway|Rook/);
  });

  it('token page shows position and estimated wait', async () => {
    renderAt('/t/a10');
    await screen.findByText('A-010');
    expect(screen.getByText(/in line|You’re next/)).toBeTruthy();
    expect(screen.getAllByText(/Estimated wait/).length).toBeGreaterThan(0);
  });

  it('token page handles unknown tokens', async () => {
    renderAt('/t/W-999');
    await screen.findByText(/not found/);
  });

  it('serving token tells the customer which counter', async () => {
    const serving = fixture.pub.tickets.find((t) => t.status === 'serving');
    renderAt(`/t/${serving.token}`);
    await screen.findByText(`Please go to Counter ${serving.counter}`);
  });
});

describe('staff pages', () => {
  beforeEach(() => { state.snapshot = fixture.staff; });

  it('redirects to login when signed out', async () => {
    renderAt('/staff');
    await screen.findByRole('heading', { name: 'Sign in' });
  });

  it('dashboard shows names, queue, booked appointments and calls next', async () => {
    state.session = { user: { id: 'u1', email: 'staff@example.com' } };
    renderAt('/staff');
    await screen.findByText('Waiting queue');
    expect(screen.getAllByText('Juniper Okafor').length).toBeGreaterThan(0);
    expect(screen.getByText('Upcoming appointments')).toBeTruthy();
    const btn = screen.getByRole('button', { name: /call next/i });
    btn.click();
    await waitFor(() => expect(state.rpcCalls.some(([fn, a]) => fn === 'call_next' && a.p_counter >= 1)).toBe(true));
  });
});
