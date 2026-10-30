// Database tests: runs supabase/schema.sql in PGlite (real Postgres compiled to
// WASM) and checks RLS, privacy, priority order and concurrency-relevant RPCs.
// Run with: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const STAFF = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

const db = new PGlite();
const schema = fs.readFileSync(here('../schema.sql'), 'utf8');
await db.exec(fs.readFileSync(here('./supabase_stub.sql'), 'utf8'));
await db.exec(schema);
await db.exec(schema); // must be re-runnable
await db.exec(`insert into public.staff (user_id) values ('${STAFF}')`);

async function as(role, sub, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ''}', false); set role ${role};`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
}
const staff = (sql) => as('authenticated', STAFF, sql);
const rejects = async (p, re) => assert.rejects(p, re);

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('schema.sql');

await test('seed_demo creates fictional data for staff', async () => {
  const [{ n }] = await staff('select public.seed_demo() n');
  assert.equal(n, 13);
});

await test('anonymous users cannot read or write tickets directly', async () => {
  await rejects(as('anon', null, 'select * from tickets'), /permission denied/);
  await rejects(as('anon', null, `update tickets set status = 'completed'`), /permission denied/);
  await rejects(as('anon', null, `select public.add_ticket('X', 'walk_in')`), /permission denied/);
  await rejects(as('anon', null, `select public.update_settings('{}')`), /permission denied/);
});

await test('public snapshot never contains names or notes', async () => {
  const [{ s }] = await as('anon', null, 'select public.get_queue_snapshot() s');
  assert.equal(s.is_staff, false);
  assert.equal(s.tickets.length, 13);
  for (const t of s.tickets) {
    assert.ok(!('customer_name' in t) && !('notes' in t) && !('created_by' in t));
  }
});

await test('signed-in non-staff users get nothing extra', async () => {
  assert.equal((await as('authenticated', OTHER, 'select count(*)::int c from tickets'))[0].c, 0);
  await rejects(as('authenticated', OTHER, `select public.add_ticket('X', 'walk_in')`), /Only signed-in staff/);
  const [{ s }] = await as('authenticated', OTHER, 'select public.get_queue_snapshot() s');
  assert.ok(s.tickets.every((t) => !('customer_name' in t)));
});

await test('staff cannot bypass RPCs with direct writes', async () => {
  await rejects(staff(`update tickets set status = 'completed'`), /permission denied/);
});

await test('staff snapshot includes names and a priority deadline', async () => {
  const [{ s }] = await staff('select public.get_queue_snapshot() s');
  assert.ok(s.tickets.every((t) => t.customer_name && t.priority_deadline));
  assert.ok(s.avg_service_minutes > 0);
});

await test('call_next follows earliest-deadline-first and completes current service', async () => {
  // Seeded waiting: W-008 (arrived -28 → promise +2), A-010 (slot +5), W-009 (+18), W-011 (+26)
  const order = [];
  for (let i = 0; i < 4; i++) order.push((await staff('select token from public.call_next(1)'))[0].token);
  assert.deepEqual(order, ['W-008', 'A-010', 'W-009', 'W-011']);
  const [{ token }] = await staff('select token from public.call_next(1)');
  assert.equal(token, null, 'empty queue returns null');
  const serving = await staff(`select count(*)::int c from tickets where status = 'serving' and counter = 1`);
  assert.equal(serving[0].c, 0);
});

await test('every change bumps the realtime signal', async () => {
  const v = async () => (await as('anon', null, 'select version from queue_signal'))[0].version;
  const before = await v();
  await staff(`select public.add_ticket('Robin Example', 'walk_in')`);
  assert.ok((await v()) > before);
});

await test('tokens are sequential per day and typed', async () => {
  const [a] = await staff(`select token, status from public.add_ticket('Test Walk', 'walk_in')`);
  const [b] = await staff(`select token, status from public.add_ticket('Test Appt', 'appointment', now() + interval '1 hour', false)`);
  assert.match(a.token, /^W-\d{3}$/);
  assert.match(b.token, /^A-\d{3}$/);
  assert.equal(Number(b.token.slice(2)), Number(a.token.slice(2)) + 1);
  assert.equal(b.status, 'booked');
});

await test('input validation', async () => {
  await rejects(staff(`select public.add_ticket('  ', 'walk_in')`), /name is required/);
  await rejects(staff(`select public.add_ticket('T', 'appointment')`), /scheduled time/);
  await rejects(staff(`select public.add_ticket('T', 'vip')`), /Invalid booking type/);
  await rejects(staff(`select public.update_settings('{"timezone":"Mars/Base"}')`), /Unknown time zone/);
  await rejects(staff(`select public.update_settings('{"active_counters":0}')`), /check constraint/);
});

await test('lifecycle: check-in, override call, undo, no-show', async () => {
  const [{ id }] = await staff(`select id from tickets where status = 'booked' order by token_number limit 1`);
  assert.equal((await staff(`select status from public.check_in_ticket('${id}')`))[0].status, 'waiting');
  await rejects(staff(`select public.check_in_ticket('${id}')`), /not awaiting check-in/);
  assert.equal((await staff(`select called_out_of_order o from public.call_ticket('${id}', 2)`))[0].o, true);
  assert.equal((await staff(`select status from public.return_to_queue('${id}')`))[0].status, 'waiting');
  assert.equal((await staff(`select status from public.close_ticket('${id}', 'no_show')`))[0].status, 'no_show');
  await rejects(staff(`select public.complete_ticket('${id}')`), /not being served/);
});

await test('late appointment is ranked as a walk-in from its check-in time', async () => {
  await staff(`select public.update_settings('{"walkin_target_minutes":30,"appointment_grace_minutes":10}')`);
  await db.exec(`update tickets set status = 'cancelled' where status in ('waiting','booked','serving')`);
  const [late] = await staff(`select id from public.add_ticket('Late Appt', 'appointment', now() - interval '40 minutes', false)`);
  await staff(`select public.add_ticket('Early Walk', 'walk_in')`);
  await db.exec(`update tickets set checked_in_at = now() - interval '5 minutes' where customer_name = 'Early Walk'`);
  await staff(`select public.check_in_ticket('${late.id}')`);
  assert.equal((await staff('select customer_name n from public.call_next(1)'))[0].n, 'Early Walk');
});

console.log(`\n${passed} database tests passed`);
