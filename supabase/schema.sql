-- =============================================================================
-- QueueFlow — Supabase schema, security policies and queue logic
-- -----------------------------------------------------------------------------
-- Run this whole file once in Supabase Dashboard → SQL Editor → New query → Run.
-- It is safe to re-run (idempotent): it drops and recreates functions/policies,
-- and only creates tables that do not exist yet.
--
-- Security model
--   * Supabase (Postgres) is the single source of truth.
--   * Browsers only ever hold the public "anon"/publishable key.
--   * Tables are locked down with RLS. NO client (anon or authenticated) can
--     insert/update/delete rows directly — every mutation goes through a
--     SECURITY DEFINER function that first checks public.is_staff().
--   * The public (anon) role can never read the tickets table. It reads the
--     queue via get_queue_snapshot(), which strips customer names and notes.
--   * Realtime: a one-row table (queue_signal) is bumped by triggers on every
--     change. Every client subscribes to it and re-fetches the snapshot, so the
--     realtime channel itself never carries personal data.
-- =============================================================================

-- gen_random_uuid() is built into Postgres 13+, no extension needed.

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- Staff allow-list. A Supabase Auth user is staff only if listed here, so an
-- accidental public sign-up can never gain access to the queue.
create table if not exists public.staff (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Staff',
  created_at   timestamptz not null default now()
);

-- Single-row configuration table (id is always 1).
create table if not exists public.queue_settings (
  id                         int primary key default 1 check (id = 1),
  business_name              text    not null default 'QueueFlow Clinic & Salon',
  timezone                   text    not null default 'Asia/Dhaka',
  active_counters            int     not null default 2  check (active_counters between 1 and 20),
  default_service_minutes    numeric not null default 15 check (default_service_minutes between 1 and 240),
  walkin_target_minutes      int     not null default 30 check (walkin_target_minutes between 0 and 600),
  appointment_grace_minutes  int     not null default 10 check (appointment_grace_minutes between 0 and 120),
  updated_at                 timestamptz not null default now()
);
insert into public.queue_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.tickets (
  id             uuid primary key default gen_random_uuid(),
  service_day    date not null,                     -- business-local date the ticket belongs to
  token_number   int  not null,                     -- 1, 2, 3 … resets every day
  token          text not null,                     -- display code: W-001 / A-002
  booking_type   text not null check (booking_type in ('walk_in', 'appointment')),
  customer_name  text not null check (char_length(customer_name) between 1 and 80),
  notes          text check (notes is null or char_length(notes) <= 200),
  scheduled_at   timestamptz,                       -- appointments only
  status         text not null default 'waiting'
                 check (status in ('booked', 'waiting', 'serving', 'completed', 'no_show', 'cancelled')),
  checked_in_at  timestamptz,                       -- physically present since
  called_at      timestamptz,                       -- service started
  completed_at   timestamptz,                       -- service finished / closed
  counter        int,                               -- counter / chair / room number
  called_out_of_order boolean not null default false, -- staff used a manual override
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (service_day, token_number),
  check (booking_type = 'walk_in' or scheduled_at is not null)
);
create index if not exists tickets_day_status_idx on public.tickets (service_day, status);
create index if not exists tickets_completed_idx  on public.tickets (completed_at desc) where status = 'completed';

-- One row whose version is bumped on every queue change → the realtime signal.
create table if not exists public.queue_signal (
  id         int primary key default 1 check (id = 1),
  version    bigint not null default 0,
  changed_at timestamptz not null default now()
);
insert into public.queue_signal (id) values (1) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Row Level Security & grants
-- -----------------------------------------------------------------------------
alter table public.staff          enable row level security;
alter table public.queue_settings enable row level security;
alter table public.tickets        enable row level security;
alter table public.queue_signal   enable row level security;

-- Nobody writes tables directly from the browser; RPCs below do it.
revoke insert, update, delete, truncate on public.staff, public.queue_settings,
       public.tickets, public.queue_signal from anon, authenticated;
revoke select on public.staff, public.tickets from anon;
grant  select on public.queue_signal, public.queue_settings to anon, authenticated;
grant  select on public.tickets, public.staff to authenticated;

-- Must be defined before policies that use it.
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

drop policy if exists "staff read own row"        on public.staff;
drop policy if exists "staff read tickets"        on public.tickets;
drop policy if exists "anyone reads settings"     on public.queue_settings;
drop policy if exists "anyone reads queue signal" on public.queue_signal;

create policy "staff read own row"        on public.staff          for select to authenticated using (user_id = auth.uid());
create policy "staff read tickets"        on public.tickets        for select to authenticated using (public.is_staff());
create policy "anyone reads settings"     on public.queue_settings for select to anon, authenticated using (true);
create policy "anyone reads queue signal" on public.queue_signal   for select to anon, authenticated using (true);

-- -----------------------------------------------------------------------------
-- Realtime signal
-- -----------------------------------------------------------------------------
create or replace function public.bump_queue_signal()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.queue_signal set version = version + 1, changed_at = now() where id = 1;
  return null;
end;
$$;

drop trigger if exists tickets_signal on public.tickets;
create trigger tickets_signal after insert or update or delete on public.tickets
  for each statement execute function public.bump_queue_signal();

drop trigger if exists settings_signal on public.queue_settings;
create trigger settings_signal after insert or update on public.queue_settings
  for each statement execute function public.bump_queue_signal();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists tickets_touch on public.tickets;
create trigger tickets_touch before update on public.tickets
  for each row execute function public.touch_updated_at();

-- Publish the signal table to Supabase Realtime (skip if already added).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_signal') then
    alter publication supabase_realtime add table public.queue_signal;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Queue priority rule (the ONE place it is defined)
-- -----------------------------------------------------------------------------
-- Earliest-deadline-first. Every present customer carries a "promise" time:
--   * appointment, arrived no later than scheduled_at + grace → its slot time
--   * walk-in (or appointment that arrived too late)          → arrival + walk-in target
-- The waiting customer with the earliest promise is served next; ties break by
-- arrival time, then token number. Walk-ins therefore stay strictly FIFO among
-- themselves, and appointments are honoured unless a walk-in has already been
-- waiting long enough that their promise is due first.
create or replace function public.ticket_deadline(t public.tickets, s public.queue_settings)
returns timestamptz
language sql stable
as $$
  select case
    when t.booking_type = 'appointment'
         and (t.checked_in_at is null
              or t.checked_in_at <= t.scheduled_at + make_interval(mins => s.appointment_grace_minutes))
      then t.scheduled_at
    else coalesce(t.checked_in_at, t.created_at) + make_interval(mins => s.walkin_target_minutes)
  end;
$$;

create or replace function public.business_today()
returns date
language sql stable security definer set search_path = public
as $$
  select (now() at time zone s.timezone)::date from public.queue_settings s where s.id = 1;
$$;

-- -----------------------------------------------------------------------------
-- Read model: one snapshot for everyone (names only for staff)
-- -----------------------------------------------------------------------------
create or replace function public.get_queue_snapshot()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  s        public.queue_settings;
  v_staff  boolean := public.is_staff();
  v_today  date;
  v_n      int;
  v_sum    numeric;
  v_avg    numeric;
  v_prior  constant int := 3;   -- default duration counts as 3 virtual samples
  v_rows   jsonb;
begin
  select * into s from public.queue_settings where id = 1;
  v_today := (now() at time zone s.timezone)::date;

  -- Rolling average of the last 20 real service durations (last 7 days),
  -- ignoring obvious outliers (<1 min = mis-click, >3 h = forgotten ticket),
  -- smoothed toward the configured default so early estimates don't swing.
  select count(*), coalesce(sum(extract(epoch from (completed_at - called_at)) / 60), 0)
    into v_n, v_sum
  from (
    select completed_at, called_at from public.tickets
    where status = 'completed' and called_at is not null
      and completed_at > now() - interval '7 days'
      and completed_at - called_at between interval '1 minute' and interval '3 hours'
    order by completed_at desc
    limit 20
  ) recent;
  v_avg := (s.default_service_minutes * v_prior + v_sum) / (v_prior + v_n);

  select coalesce(jsonb_agg(
           case when v_staff then r.j else r.j - 'customer_name' - 'notes' - 'created_by' end
           order by r.token_number), '[]'::jsonb)
    into v_rows
  from (
    select t.token_number,
           to_jsonb(t) || jsonb_build_object('priority_deadline', public.ticket_deadline(t, s)) as j
    from public.tickets t
    where t.service_day = v_today
       or t.status in ('waiting', 'serving')        -- never lose someone still in the building
  ) r;

  return jsonb_build_object(
    'server_time',          now(),
    'service_day',          v_today,
    'is_staff',             v_staff,
    'settings',             jsonb_build_object(
                              'business_name',             s.business_name,
                              'timezone',                  s.timezone,
                              'active_counters',           s.active_counters,
                              'default_service_minutes',   s.default_service_minutes,
                              'walkin_target_minutes',     s.walkin_target_minutes,
                              'appointment_grace_minutes', s.appointment_grace_minutes),
    'avg_service_minutes',  round(v_avg, 2),
    'service_samples',      v_n,
    'tickets',              v_rows
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Staff mutations (all atomic, all staff-checked)
-- -----------------------------------------------------------------------------
create or replace function public.assert_staff()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Only signed-in staff can change the queue' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.add_ticket(
  p_name         text,
  p_booking_type text,
  p_scheduled_at timestamptz default null,
  p_arrived      boolean     default true,
  p_notes        text        default null
)
returns public.tickets
language plpgsql security definer set search_path = public
as $$
declare
  s      public.queue_settings;
  v_day  date;
  v_num  int;
  v_row  public.tickets;
begin
  perform public.assert_staff();
  select * into s from public.queue_settings where id = 1;

  p_name := btrim(coalesce(p_name, ''));
  if p_name = '' then raise exception 'Customer name is required'; end if;
  if p_booking_type not in ('walk_in', 'appointment') then raise exception 'Invalid booking type'; end if;
  if p_booking_type = 'appointment' and p_scheduled_at is null then
    raise exception 'Appointments need a scheduled time';
  end if;
  if p_booking_type = 'walk_in' then p_scheduled_at := null; p_arrived := true; end if;

  v_day := (coalesce(p_scheduled_at, now()) at time zone s.timezone)::date;
  if v_day < (now() at time zone s.timezone)::date then
    raise exception 'Appointment time is in a past day';
  end if;

  -- Serialise token allocation per day so two staff devices never get the same number.
  perform pg_advisory_xact_lock(hashtext('queueflow-token-' || v_day::text));
  select coalesce(max(token_number), 0) + 1 into v_num from public.tickets where service_day = v_day;

  insert into public.tickets (service_day, token_number, token, booking_type, customer_name, notes,
                              scheduled_at, status, checked_in_at, created_by)
  values (v_day, v_num,
          case when p_booking_type = 'walk_in' then 'W' else 'A' end || '-' || lpad(v_num::text, 3, '0'),
          p_booking_type, left(p_name, 80), nullif(btrim(coalesce(p_notes, '')), ''),
          p_scheduled_at,
          case when p_arrived then 'waiting' else 'booked' end,
          case when p_arrived then now() end,
          auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.check_in_ticket(p_id uuid)
returns public.tickets
language plpgsql security definer set search_path = public
as $$
declare v_row public.tickets;
begin
  perform public.assert_staff();
  update public.tickets set status = 'waiting', checked_in_at = now()
   where id = p_id and status = 'booked'
  returning * into v_row;
  if v_row.id is null then raise exception 'Ticket is not awaiting check-in'; end if;
  return v_row;
end;
$$;

-- Calls the next customer by the priority rule. Optionally completes whoever
-- this counter is currently serving first. FOR UPDATE SKIP LOCKED makes two
-- simultaneous clicks on two devices pick two different customers.
create or replace function public.call_next(p_counter int, p_complete_current boolean default true)
returns public.tickets
language plpgsql security definer set search_path = public
as $$
declare
  s      public.queue_settings;
  v_id   uuid;
  v_row  public.tickets;
begin
  perform public.assert_staff();
  select * into s from public.queue_settings where id = 1;
  if p_counter is null or p_counter < 1 then raise exception 'Choose a counter first'; end if;

  if p_complete_current then
    update public.tickets set status = 'completed', completed_at = now()
     where status = 'serving' and counter = p_counter;
  elsif exists (select 1 from public.tickets where status = 'serving' and counter = p_counter) then
    raise exception 'Counter % is still serving someone', p_counter;
  end if;

  select t.id into v_id
    from public.tickets t
   where t.status = 'waiting'
   order by public.ticket_deadline(t, s), t.checked_in_at, t.token_number
   limit 1
   for update skip locked;

  if v_id is null then return null; end if;   -- queue empty

  update public.tickets
     set status = 'serving', called_at = now(), counter = p_counter, called_out_of_order = false
   where id = v_id
  returning * into v_row;
  return v_row;
end;
$$;

-- Manual override: call a specific waiting customer (e.g. urgent case).
create or replace function public.call_ticket(p_id uuid, p_counter int, p_complete_current boolean default true)
returns public.tickets
language plpgsql security definer set search_path = public
as $$
declare v_row public.tickets;
begin
  perform public.assert_staff();
  if p_counter is null or p_counter < 1 then raise exception 'Choose a counter first'; end if;
  if p_complete_current then
    update public.tickets set status = 'completed', completed_at = now()
     where status = 'serving' and counter = p_counter and id <> p_id;
  end if;
  update public.tickets
     set status = 'serving', called_at = now(), counter = p_counter,
         checked_in_at = coalesce(checked_in_at, now()), called_out_of_order = true
   where id = p_id and status in ('waiting', 'booked')
  returning * into v_row;
  if v_row.id is null then raise exception 'Ticket is no longer waiting'; end if;
  return v_row;
end;
$$;

create or replace function public.complete_ticket(p_id uuid)
returns public.tickets
language plpgsql security definer set search_path = public
as $$
declare v_row public.tickets;
begin
  perform public.assert_staff();
  update public.tickets set status = 'completed', completed_at = now()
   where id = p_id and status = 'serving'
  returning * into v_row;
  if v_row.id is null then raise exception 'Ticket is not being served'; end if;
  return v_row;
end;
$$;

-- No-show (called but never came, or appointment never arrived) or cancel.
create or replace function public.close_ticket(p_id uuid, p_status text)
returns public.tickets
language plpgsql security definer set search_path = public
as $$
declare v_row public.tickets;
begin
  perform public.assert_staff();
  if p_status not in ('no_show', 'cancelled') then raise exception 'Invalid status'; end if;
  update public.tickets set status = p_status, completed_at = now()
   where id = p_id and status in ('booked', 'waiting', 'serving')
  returning * into v_row;
  if v_row.id is null then raise exception 'Ticket is already closed'; end if;
  return v_row;
end;
$$;

-- Put a called customer back into the queue (e.g. called by mistake).
create or replace function public.return_to_queue(p_id uuid)
returns public.tickets
language plpgsql security definer set search_path = public
as $$
declare v_row public.tickets;
begin
  perform public.assert_staff();
  update public.tickets set status = 'waiting', called_at = null, counter = null, called_out_of_order = false
   where id = p_id and status = 'serving'
  returning * into v_row;
  if v_row.id is null then raise exception 'Ticket is not being served'; end if;
  return v_row;
end;
$$;

create or replace function public.update_settings(p jsonb)
returns public.queue_settings
language plpgsql security definer set search_path = public
as $$
declare v_row public.queue_settings;
begin
  perform public.assert_staff();
  if p ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p->>'timezone') then
    raise exception 'Unknown time zone: %', p->>'timezone';
  end if;
  update public.queue_settings set
    business_name             = coalesce(nullif(btrim(p->>'business_name'), ''), business_name),
    timezone                  = coalesce(p->>'timezone', timezone),
    active_counters           = coalesce((p->>'active_counters')::int, active_counters),
    default_service_minutes   = coalesce((p->>'default_service_minutes')::numeric, default_service_minutes),
    walkin_target_minutes     = coalesce((p->>'walkin_target_minutes')::int, walkin_target_minutes),
    appointment_grace_minutes = coalesce((p->>'appointment_grace_minutes')::int, appointment_grace_minutes),
    updated_at                = now()
  where id = 1
  returning * into v_row;
  return v_row;
end;
$$;

-- Replaces today's queue with fictional demo data, timed relative to "now".
create or replace function public.seed_demo()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  s     public.queue_settings;
  v_day date;
  v_now timestamptz := now();
  v_n   int := 0;
  r     record;
begin
  perform public.assert_staff();
  select * into s from public.queue_settings where id = 1;
  v_day := (v_now at time zone s.timezone)::date;
  delete from public.tickets where service_day = v_day or status in ('waiting', 'serving', 'booked');

  -- All names are fictional. offsets in minutes relative to now.
  for r in
    select * from (values
      -- name,              type,          sched, arrived, status,      called, done, counter, notes
      ('Mira Castellane',   'walk_in',     null,  -95,  'completed',  -90,  -76,  1, null),
      ('Tobin Ashgrove',    'appointment', -80,   -84,  'completed',  -78,  -61,  2, 'Follow-up'),
      ('Selva Durant',      'walk_in',     null,  -70,  'completed',  -60,  -47,  1, null),
      ('Kester Vale',       'appointment', -50,   -55,  'completed',  -50,  -33,  2, null),
      ('Nadia Orlov',       'walk_in',     null,  -40,  'no_show',    null, -35,  null, null),
      ('Ilse Marrow',       'walk_in',     null,  -35,  'serving',    -9,   null, 1, null),
      ('Orrin Patel-Hayes', 'appointment', -10,   -20,  'serving',    -6,   null, 2, 'Colour consult'),
      ('Juniper Okafor',    'walk_in',     null,  -28,  'waiting',    null, null, null, null),
      ('Bastian Rook',      'walk_in',     null,  -12,  'waiting',    null, null, null, 'Prefers counter 1'),
      ('Wren Calloway',     'appointment', 5,     -3,   'waiting',    null, null, null, null),
      ('Delphine Sato',     'walk_in',     null,  -4,   'waiting',    null, null, null, null),
      ('Arlo Whitcombe',    'appointment', 40,    null, 'booked',     null, null, null, null),
      ('Cyra Montel',       'appointment', 75,    null, 'booked',     null, null, null, 'First visit')
    ) as v(name, btype, sched, arrived, status, called, done, counter, notes)
  loop
    v_n := v_n + 1;
    insert into public.tickets (service_day, token_number, token, booking_type, customer_name, notes,
                                scheduled_at, status, checked_in_at, called_at, completed_at, counter,
                                created_by, created_at)
    values (v_day, v_n,
            case when r.btype = 'walk_in' then 'W' else 'A' end || '-' || lpad(v_n::text, 3, '0'),
            r.btype, r.name, r.notes,
            case when r.sched   is not null then v_now + make_interval(mins => r.sched) end,
            r.status,
            case when r.arrived is not null then v_now + make_interval(mins => r.arrived) end,
            case when r.called  is not null then v_now + make_interval(mins => r.called) end,
            case when r.done    is not null then v_now + make_interval(mins => r.done) end,
            r.counter, auth.uid(),
            v_now + make_interval(mins => coalesce(r.arrived, -120)));
  end loop;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function permissions
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;

grant execute on function public.get_queue_snapshot() to anon, authenticated;
grant execute on function public.is_staff()           to anon, authenticated;
grant execute on function public.business_today()     to anon, authenticated;
grant execute on function public.ticket_deadline(public.tickets, public.queue_settings) to authenticated;

grant execute on function public.add_ticket(text, text, timestamptz, boolean, text) to authenticated;
grant execute on function public.check_in_ticket(uuid)              to authenticated;
grant execute on function public.call_next(int, boolean)            to authenticated;
grant execute on function public.call_ticket(uuid, int, boolean)    to authenticated;
grant execute on function public.complete_ticket(uuid)              to authenticated;
grant execute on function public.close_ticket(uuid, text)           to authenticated;
grant execute on function public.return_to_queue(uuid)              to authenticated;
grant execute on function public.update_settings(jsonb)             to authenticated;
grant execute on function public.seed_demo()                        to authenticated;
grant execute on function public.assert_staff()                     to authenticated;
