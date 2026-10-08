-- HorCare ERP — Leasing module (leads → reservations → leases).
--
-- Access model: the browser never talks to these tables. Every request goes through the Vercel API
-- (api/_leasing.ts), which checks the caller's role and property first and then uses the service-role
-- key. Row Level Security is enabled with NO policies, so the anon and authenticated roles are denied
-- everything even if a key leaks into a client by mistake.
--
-- Ids of rooms/buildings/owners are the Firestore ids (text); they are not foreign keys because those
-- records still live in Firestore. Money is integer satang.

create extension if not exists pgcrypto;

create or replace function leasing_touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── leads ───────────────────────────────────────────────────────────────────
create table if not exists leasing_leads (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  name text not null check (char_length(name) between 2 and 100),
  phone text check (phone is null or phone ~ '^0[0-9]{8,9}$'),
  line_id text check (line_id is null or char_length(line_id) <= 100),
  source text not null default 'walk_in' check (source in ('walk_in', 'phone', 'line', 'online', 'referral', 'other')),
  interested_room_id text,
  budget_satang bigint check (budget_satang is null or budget_satang >= 0),
  target_move_in date,
  status text not null default 'new' check (status in ('new', 'contacted', 'viewing', 'reserved', 'won', 'lost')),
  lost_reason text check (lost_reason is null or char_length(lost_reason) <= 300),
  note text check (note is null or char_length(note) <= 1000),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leasing_leads_scope on leasing_leads (owner_uid, building_id, status);
drop trigger if exists leasing_leads_touch on leasing_leads;
create trigger leasing_leads_touch before update on leasing_leads for each row execute function leasing_touch_updated_at();

-- ── reservations ────────────────────────────────────────────────────────────
create table if not exists leasing_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  lead_id uuid not null references leasing_leads (id) on delete restrict,
  room_id text not null,
  room_number text not null,
  deposit_satang bigint not null default 0 check (deposit_satang >= 0),
  reserved_until date not null,
  status text not null default 'active' check (status in ('active', 'converted', 'cancelled', 'expired')),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leasing_reservations_scope on leasing_reservations (owner_uid, building_id, status);
-- a room can have only one live reservation, enforced by the database (two clerks cannot both win)
create unique index if not exists leasing_one_active_reservation_per_room
  on leasing_reservations (owner_uid, building_id, room_id) where status = 'active';
drop trigger if exists leasing_reservations_touch on leasing_reservations;
create trigger leasing_reservations_touch before update on leasing_reservations for each row execute function leasing_touch_updated_at();

-- ── leases ──────────────────────────────────────────────────────────────────
create table if not exists leases (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  room_id text not null,
  room_number text not null,
  tenant_name text not null check (char_length(tenant_name) between 2 and 100),
  tenant_phone text check (tenant_phone is null or tenant_phone ~ '^0[0-9]{8,9}$'),
  lead_id uuid references leasing_leads (id) on delete restrict,
  reservation_id uuid references leasing_reservations (id) on delete restrict,
  renewal_of uuid references leases (id) on delete restrict,
  start_date date not null,
  end_date date not null,
  rent_satang bigint not null check (rent_satang >= 0),
  deposit_satang bigint not null default 0 check (deposit_satang >= 0),
  -- scheduled = signed for a future start (e.g. a renewal); active = in force now
  status text not null default 'active' check (status in ('scheduled', 'active', 'ended', 'terminated')),
  ended_on date,
  end_reason text check (end_reason is null or char_length(end_reason) <= 300),
  note text check (note is null or char_length(note) <= 1000),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date > start_date)
);
create index if not exists leases_scope on leases (owner_uid, building_id, status, end_date);
-- one lease in force per room
create unique index if not exists leases_one_active_per_room
  on leases (owner_uid, building_id, room_id) where status = 'active';
drop trigger if exists leases_touch on leases;
create trigger leases_touch before update on leases for each row execute function leasing_touch_updated_at();

-- ── atomic operations ───────────────────────────────────────────────────────

-- Reserve a room for a lead: creates the reservation and moves the lead to "reserved" together.
create or replace function leasing_reserve(
  p_owner text, p_building text, p_lead uuid, p_room_id text, p_room_number text,
  p_deposit bigint, p_until date, p_by text
) returns leasing_reservations language plpgsql as $$
declare
  v_lead leasing_leads;
  v_res leasing_reservations;
begin
  select * into v_lead from leasing_leads
    where id = p_lead and owner_uid = p_owner and building_id = p_building for update;
  if not found then raise exception 'lead_not_found' using errcode = 'P0002'; end if;
  if v_lead.status in ('won', 'lost') then raise exception 'lead_closed' using errcode = 'P0001'; end if;

  insert into leasing_reservations (owner_uid, building_id, lead_id, room_id, room_number, deposit_satang, reserved_until, created_by)
    values (p_owner, p_building, p_lead, p_room_id, p_room_number, p_deposit, p_until, p_by)
    returning * into v_res; -- unique violation (23505) if the room already has a live reservation

  update leasing_leads set status = 'reserved', interested_room_id = p_room_id where id = p_lead;
  return v_res;
end $$;

-- Turn an active reservation into a lease: creates the lease, closes the reservation and marks the lead won.
create or replace function leasing_convert_reservation(
  p_owner text, p_building text, p_reservation uuid, p_tenant_name text, p_tenant_phone text,
  p_start date, p_end date, p_rent bigint, p_deposit bigint, p_by text
) returns leases language plpgsql as $$
declare
  v_res leasing_reservations;
  v_lease leases;
begin
  select * into v_res from leasing_reservations
    where id = p_reservation and owner_uid = p_owner and building_id = p_building for update;
  if not found then raise exception 'reservation_not_found' using errcode = 'P0002'; end if;
  if v_res.status <> 'active' then raise exception 'reservation_not_active' using errcode = 'P0001'; end if;

  insert into leases (owner_uid, building_id, room_id, room_number, tenant_name, tenant_phone, lead_id, reservation_id,
                      start_date, end_date, rent_satang, deposit_satang, status, created_by)
    values (p_owner, p_building, v_res.room_id, v_res.room_number, p_tenant_name, p_tenant_phone, v_res.lead_id, v_res.id,
            p_start, p_end, p_rent, p_deposit, 'active', p_by)
    returning * into v_lease; -- unique violation (23505) if the room already has a lease in force

  update leasing_reservations set status = 'converted' where id = v_res.id;
  update leasing_leads set status = 'won' where id = v_res.lead_id;
  return v_lease;
end $$;

-- ── deny everything to client roles ─────────────────────────────────────────
alter table leasing_leads enable row level security;
alter table leasing_reservations enable row level security;
alter table leases enable row level security;
revoke all on leasing_leads, leasing_reservations, leases from anon, authenticated;
revoke execute on function leasing_reserve(text, text, uuid, text, text, bigint, date, text) from public, anon, authenticated;
revoke execute on function leasing_convert_reservation(text, text, uuid, text, text, date, date, bigint, bigint, text) from public, anon, authenticated;
