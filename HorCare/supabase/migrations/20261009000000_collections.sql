-- HorCare ERP — daily / weekly collection (resort, hotel, market).
--
-- Same access model as the leasing module: only the Vercel API (service-role key) touches these tables, after it
-- has checked the user's role and property. Row Level Security is on with NO policies. Money is integer satang,
-- dates are Thai calendar days (`date`), instants are timestamptz. Ids of rooms/stalls/buildings/owners are the
-- Firestore ids (text).

create extension if not exists pgcrypto;
create extension if not exists btree_gist; -- lets a room id take part in an exclusion constraint

create or replace function collections_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ── rates ───────────────────────────────────────────────────────────────────
create table if not exists collection_rates (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  name text not null check (char_length(name) between 2 and 80),
  purpose text not null check (purpose in ('stay', 'stall', 'walk_in')),
  unit text not null check (unit in ('night', 'day', 'week')),
  amount_satang bigint not null check (amount_satang >= 0),
  scope text not null default 'all' check (scope in ('all', 'zone', 'room')),
  zone text,
  room_id text,
  valid_from date,
  valid_to date,
  priority int not null default 0 check (priority between -100 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((purpose = 'stay') = (unit = 'night')),
  check (scope <> 'zone' or zone is not null),
  check (scope <> 'room' or room_id is not null),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index if not exists collection_rates_scope on collection_rates (owner_uid, building_id, purpose);
drop trigger if exists collection_rates_touch on collection_rates;
create trigger collection_rates_touch before update on collection_rates for each row execute function collections_touch_updated_at();

-- ── bookings (hotel / resort calendar) ──────────────────────────────────────
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  room_id text not null,
  room_number text not null,
  guest_name text not null check (char_length(guest_name) between 2 and 100),
  guest_phone text check (guest_phone is null or guest_phone ~ '^0[0-9]{8,9}$'),
  adults int not null default 1 check (adults between 1 and 20),
  check_in date not null,
  check_out date not null,
  status text not null default 'reserved' check (status in ('reserved', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
  charge_id uuid,
  source text not null default 'staff',
  notes text check (notes is null or char_length(notes) <= 500),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out > check_in),
  check (check_out - check_in <= 60),
  -- a room cannot hold two stays at once; the check-out day is free for the next guest (half-open range)
  constraint bookings_no_double_booking exclude using gist (
    owner_uid with =, building_id with =, room_id with =, daterange(check_in, check_out, '[)') with &&
  ) where (status in ('reserved', 'checked_in'))
);
create index if not exists bookings_scope on bookings (owner_uid, building_id, check_in, check_out);
drop trigger if exists bookings_touch on bookings;
create trigger bookings_touch before update on bookings for each row execute function collections_touch_updated_at();

-- ── stall plans (market) ────────────────────────────────────────────────────
create table if not exists stall_plans (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  room_id text not null,
  room_number text not null,
  mode text not null check (mode in ('weekly_advance', 'daily_actual')),
  unit text not null check (unit in ('day', 'week')),
  rate_satang bigint check (rate_satang is null or rate_satang >= 0),
  open_days int[] not null check (cardinality(open_days) between 1 and 7),
  starts_on date not null,
  ends_on date,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mode <> 'daily_actual' or unit = 'day'),
  check (ends_on is null or ends_on >= starts_on)
);
-- one live plan per stall
create unique index if not exists stall_plans_one_active_per_room on stall_plans (owner_uid, building_id, room_id) where status = 'active';
drop trigger if exists stall_plans_touch on stall_plans;
create trigger stall_plans_touch before update on stall_plans for each row execute function collections_touch_updated_at();

-- ── charges ─────────────────────────────────────────────────────────────────
create table if not exists charges (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  kind text not null check (kind in ('stay', 'stall_week', 'stall_day', 'walk_in', 'extra')),
  room_id text,
  room_number text,
  party_name text not null check (char_length(party_name) between 1 and 100),
  party_phone text,
  booking_id uuid references bookings (id) on delete restrict,
  period_start date not null,
  period_end date not null,
  description text not null default '' check (char_length(description) <= 300),
  amount_satang bigint not null check (amount_satang >= 0),
  paid_satang bigint not null default 0,
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  -- makes generation idempotent: the same stall-week / stall-day / stay is never charged twice
  dedupe_key text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (owner_uid, building_id, dedupe_key)
);
create index if not exists charges_scope on charges (owner_uid, building_id, period_start, status);
drop trigger if exists charges_touch on charges;
create trigger charges_touch before update on charges for each row execute function collections_touch_updated_at();

alter table bookings drop constraint if exists bookings_charge_fk;
alter table bookings add constraint bookings_charge_fk foreign key (charge_id) references charges (id) on delete restrict;

create table if not exists charge_payments (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  charge_id uuid not null references charges (id) on delete restrict,
  amount_satang bigint not null check (amount_satang <> 0),
  method text not null check (method in ('cash', 'transfer')),
  kind text not null default 'payment' check (kind in ('payment', 'deposit', 'refund')),
  bank_account_id text,
  note text check (note is null or char_length(note) <= 200),
  received_by text not null,
  received_by_name text not null,
  received_at timestamptz not null default now(),
  check ((kind = 'refund') = (amount_satang < 0)),
  check (method <> 'transfer' or bank_account_id is not null)
);
create index if not exists charge_payments_scope on charge_payments (owner_uid, building_id, received_at);

-- ── daily-actual stalls: who turned up (or did not) on a day ──
create table if not exists stall_attendance (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  room_id text not null,
  visit_date date not null,
  present boolean not null,
  marked_by text not null,
  marked_at timestamptz not null default now(),
  unique (owner_uid, building_id, room_id, visit_date)
);

-- ── end of day ──────────────────────────────────────────────────────────────
create table if not exists day_closes (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  close_date date not null,
  expected_cash_satang bigint not null,
  counted_cash_satang bigint not null check (counted_cash_satang >= 0),
  transfer_satang bigint not null,
  payments_count int not null,
  difference_satang bigint not null,
  note text check (note is null or char_length(note) <= 300),
  closed_by text not null,
  closed_by_name text not null,
  closed_at timestamptz not null default now(),
  unique (owner_uid, building_id, close_date)
);

-- ── atomic operations ───────────────────────────────────────────────────────

-- Idempotent: returns the existing charge for a dedupe key, or creates it.
create or replace function collections_ensure_charge(
  p_owner text, p_building text, p_kind text, p_room_id text, p_room_number text, p_party text, p_phone text,
  p_start date, p_end date, p_desc text, p_amount bigint, p_key text, p_by text
) returns charges language plpgsql as $$
declare v charges;
begin
  insert into charges (owner_uid, building_id, kind, room_id, room_number, party_name, party_phone, period_start, period_end, description, amount_satang, dedupe_key, created_by)
    values (p_owner, p_building, p_kind, p_room_id, p_room_number, p_party, p_phone, p_start, p_end, p_desc, p_amount, p_key, p_by)
    on conflict (owner_uid, building_id, dedupe_key) do nothing;
  select * into v from charges where owner_uid = p_owner and building_id = p_building and dedupe_key = p_key;
  return v;
end $$;

-- Record money against a charge. Refuses overpayment, voided charges and refunds above what was paid.
create or replace function collections_pay(
  p_owner text, p_building text, p_charge uuid, p_amount bigint, p_method text, p_kind text,
  p_bank text, p_note text, p_by text, p_by_name text
) returns charge_payments language plpgsql as $$
declare
  c charges;
  pay charge_payments;
  new_paid bigint;
begin
  select * into c from charges where id = p_charge and owner_uid = p_owner and building_id = p_building for update;
  if not found then raise exception 'charge_not_found' using errcode = 'P0002'; end if;
  if c.status = 'void' then raise exception 'charge_void' using errcode = 'P0001'; end if;
  if p_kind = 'refund' then
    if p_amount >= 0 or -p_amount > c.paid_satang then raise exception 'refund_exceeds_paid' using errcode = 'P0001'; end if;
  else
    if p_amount <= 0 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
    if p_amount > c.amount_satang - c.paid_satang then raise exception 'exceeds_outstanding' using errcode = 'P0001'; end if;
  end if;
  insert into charge_payments (owner_uid, building_id, charge_id, amount_satang, method, kind, bank_account_id, note, received_by, received_by_name)
    values (p_owner, p_building, p_charge, p_amount, p_method, p_kind, p_bank, p_note, p_by, p_by_name)
    returning * into pay;
  new_paid := c.paid_satang + p_amount;
  update charges set paid_satang = new_paid, status = case when new_paid >= amount_satang and amount_satang > 0 then 'paid' else 'open' end
    where id = p_charge;
  return pay;
end $$;

-- Create a stay: the booking, its charge and (optionally) the deposit, together. The exclusion constraint
-- raises 23P01 when the room is taken for any of those nights.
create or replace function stays_create_booking(
  p_owner text, p_building text, p_room_id text, p_room_number text, p_guest text, p_phone text, p_adults int,
  p_in date, p_out date, p_notes text, p_total bigint, p_deposit bigint, p_method text, p_bank text, p_by text, p_by_name text
) returns bookings language plpgsql as $$
declare
  b bookings;
  c charges;
begin
  insert into bookings (owner_uid, building_id, room_id, room_number, guest_name, guest_phone, adults, check_in, check_out, notes, created_by)
    values (p_owner, p_building, p_room_id, p_room_number, p_guest, p_phone, p_adults, p_in, p_out, p_notes, p_by)
    returning * into b;
  insert into charges (owner_uid, building_id, kind, room_id, room_number, party_name, party_phone, booking_id, period_start, period_end, description, amount_satang, dedupe_key, created_by)
    values (p_owner, p_building, 'stay', p_room_id, p_room_number, p_guest, p_phone, b.id, p_in, p_out - 1,
            'ค่าห้อง ' || p_room_number || ' ' || p_in || ' – ' || p_out, p_total, 'stay:' || b.id, p_by)
    returning * into c;
  update bookings set charge_id = c.id where id = b.id returning * into b;
  if p_deposit > 0 then
    perform collections_pay(p_owner, p_building, c.id, p_deposit, p_method, 'deposit', p_bank, null, p_by, p_by_name);
  end if;
  return b;
end $$;

-- Cancel a stay and settle its charge: 'void' (nothing was paid), 'forfeit' (keep what was paid), 'refund' (pay it back).
create or replace function stays_cancel_booking(
  p_owner text, p_building text, p_booking uuid, p_mode text, p_method text, p_bank text, p_by text, p_by_name text
) returns bookings language plpgsql as $$
declare
  b bookings;
  c charges;
begin
  select * into b from bookings where id = p_booking and owner_uid = p_owner and building_id = p_building for update;
  if not found then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  if b.status not in ('reserved', 'checked_in') then raise exception 'cannot_cancel' using errcode = 'P0001'; end if;
  select * into c from charges where id = b.charge_id for update;
  if found then
    if c.paid_satang > 0 and p_mode = 'void' then raise exception 'has_payments' using errcode = 'P0001'; end if;
    if p_mode = 'refund' and c.paid_satang > 0 then
      perform collections_pay(p_owner, p_building, c.id, -c.paid_satang, p_method, 'refund', p_bank, 'refund on cancellation', p_by, p_by_name);
      update charges set status = 'void' where id = c.id;
    elsif p_mode = 'forfeit' and c.paid_satang > 0 then
      update charges set amount_satang = c.paid_satang, status = 'paid' where id = c.id;
    else
      update charges set status = 'void' where id = c.id;
    end if;
  end if;
  update bookings set status = 'cancelled' where id = b.id returning * into b;
  return b;
end $$;

-- ── deny everything to client roles; the API (service role) is the only user ──
alter table collection_rates enable row level security;
alter table bookings enable row level security;
alter table stall_plans enable row level security;
alter table charges enable row level security;
alter table charge_payments enable row level security;
alter table day_closes enable row level security;
alter table stall_attendance enable row level security;
revoke all on collection_rates, bookings, stall_plans, charges, charge_payments, day_closes, stall_attendance from anon, authenticated;
grant select, insert, update, delete on collection_rates, bookings, stall_plans, charges, charge_payments, day_closes, stall_attendance to service_role;

revoke execute on function collections_ensure_charge(text, text, text, text, text, text, text, date, date, text, bigint, text, text) from public, anon, authenticated;
revoke execute on function collections_pay(text, text, uuid, bigint, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function stays_create_booking(text, text, text, text, text, text, int, date, date, text, bigint, bigint, text, text, text, text) from public, anon, authenticated;
revoke execute on function stays_cancel_booking(text, text, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function collections_ensure_charge(text, text, text, text, text, text, text, date, date, text, bigint, text, text) to service_role;
grant execute on function collections_pay(text, text, uuid, bigint, text, text, text, text, text, text) to service_role;
grant execute on function stays_create_booking(text, text, text, text, text, text, int, date, date, text, bigint, bigint, text, text, text, text) to service_role;
grant execute on function stays_cancel_booking(text, text, uuid, text, text, text, text, text) to service_role;
