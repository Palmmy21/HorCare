-- HorCare R0/R1 core — parties, contracts (extends `leases`), occupancy, meter readings, invoices, payments,
-- allocations, deposits, portal grants, outbox and migration bookkeeping.
-- See docs/DATA_OWNERSHIP.md (who owns what) and docs/MIGRATION_R1.md (how Firestore data moves here).
--
-- Same access model as the earlier modules: only the API (service role) touches these tables; RLS is on with no
-- policies. Money is integer satang. Business days are `date` (Asia/Bangkok); instants are `timestamptz`.
-- Room / building / owner ids are the Firestore ids (text).
--
-- State rules live in the functions below, not in the API, so every caller gets the same checks:
--   invoice  draft → approved → issued → voided      (lines are frozen once issued; fix with a new adjustment invoice)
--   payment  pending_verification → confirmed | rejected;  confirmed → reversed   (only confirmed money is allocated)
--   paid / partial / overdue are never stored: `invoice_balances` derives them from live allocations.
-- Every state change writes an `outbox` row in the same transaction, so follow-up work (LINE, Firestore read models,
-- ledger) is retried from a queue and never runs twice for the same change.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create or replace function core_touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── outbox (AUTO-02/03/07) ──────────────────────────────────────────────────
create table if not exists outbox (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text,
  topic text not null check (topic ~ '^[a-z_]+\.[a-z_]+$'),
  payload jsonb not null default '{}'::jsonb,
  -- the same business change can never be queued twice
  idempotency_key text not null,
  correlation_id text,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'retrying', 'failed', 'cancelled')),
  attempts int not null default 0 check (attempts >= 0),
  last_error text,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_uid, idempotency_key)
);
create index if not exists outbox_due on outbox (status, available_at) where status in ('queued', 'retrying');
drop trigger if exists outbox_touch on outbox;
create trigger outbox_touch before update on outbox for each row execute function core_touch_updated_at();

create or replace function core_enqueue(p_owner text, p_building text, p_topic text, p_key text, p_payload jsonb) returns void
language sql as $$
  insert into outbox (owner_uid, building_id, topic, idempotency_key, payload)
    values (p_owner, p_building, p_topic, p_key, p_payload)
    on conflict (owner_uid, idempotency_key) do nothing;
$$;

-- ── parties (DATA-02) ───────────────────────────────────────────────────────
-- A person or company, owned by the organisation and not tied to a room. Duplicates are never merged automatically.
create table if not exists parties (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  kind text not null default 'person' check (kind in ('person', 'company')),
  display_name text not null check (char_length(display_name) between 1 and 150),
  phone text check (phone is null or phone ~ '^0[0-9]{8,9}$'),
  email text check (email is null or char_length(email) <= 200),
  line_user_id text check (line_user_id is null or line_user_id ~ '^U[0-9a-f]{32}$'),
  tax_id text check (tax_id is null or tax_id ~ '^[0-9]{13}$'),           -- personal data: shown only with tenant.read
  address text check (address is null or char_length(address) <= 500),
  emergency_contact jsonb,
  legacy_ref text,                                                         -- e.g. firestore:tenants/<bid>/<rid>
  archived_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1
);
create index if not exists parties_scope on parties (owner_uid) where archived_at is null;
create index if not exists parties_phone on parties (owner_uid, phone) where phone is not null;
create unique index if not exists parties_legacy on parties (owner_uid, legacy_ref) where legacy_ref is not null;
drop trigger if exists parties_touch on parties;
create trigger parties_touch before update on parties for each row execute function core_touch_updated_at();

-- ── contracts: extend `leases` (LEA-03/04/05) ───────────────────────────────
-- 'scheduled' (already used) means signed, not yet in force. New: draft, pending_approval, cancelled.
alter table leases drop constraint if exists leases_status_check;
alter table leases add constraint leases_status_check
  check (status in ('draft', 'pending_approval', 'scheduled', 'active', 'ended', 'terminated', 'cancelled'));
alter table leases add column if not exists party_id uuid references parties (id) on delete restrict;
alter table leases add column if not exists billing_day int not null default 1 check (billing_day between 1 and 28);
alter table leases add column if not exists due_days int not null default 5 check (due_days between 0 and 60);
-- partial months: 'none' bills the full month (today's behaviour); 'daily' prorates by days in the month
alter table leases add column if not exists proration text not null default 'none' check (proration in ('none', 'daily'));
alter table leases add column if not exists terms_snapshot jsonb;
alter table leases add column if not exists approved_by text;
alter table leases add column if not exists approved_at timestamptz;
alter table leases add column if not exists legacy_ref text;
alter table leases add column if not exists version int not null default 1;
create unique index if not exists leases_legacy on leases (owner_uid, legacy_ref) where legacy_ref is not null;

-- everyone on the contract (main tenant, co-tenants, guarantor, company contact)
create table if not exists lease_parties (
  lease_id uuid not null references leases (id) on delete restrict,
  party_id uuid not null references parties (id) on delete restrict,
  role text not null default 'tenant' check (role in ('tenant', 'co_tenant', 'guarantor', 'contact')),
  primary key (lease_id, party_id)
);

-- the spaces a contract covers and when (WS-06: occupancy is a date range, not a flag). Ranges are [starts_on, ends_on).
create table if not exists lease_units (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  lease_id uuid not null references leases (id) on delete restrict,
  room_id text not null,
  room_number text not null,
  starts_on date not null,
  ends_on date,                                                            -- null = open-ended
  status text not null default 'planned' check (status in ('planned', 'occupied', 'released', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on > starts_on),
  -- LEA-02 / UAT-02: two contracts can never hold the same space on the same day
  constraint lease_units_no_overlap exclude using gist (
    owner_uid with =, building_id with =, room_id with =,
    daterange(starts_on, coalesce(ends_on, 'infinity'::date), '[)') with &&
  ) where (status <> 'cancelled')
);
create index if not exists lease_units_lease on lease_units (lease_id);
drop trigger if exists lease_units_touch on lease_units;
create trigger lease_units_touch before update on lease_units for each row execute function core_touch_updated_at();

-- contract state changes reach the rest of the system through the outbox (room read model, portal access …)
create or replace function leases_status_outbox() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    perform core_enqueue(new.owner_uid, new.building_id, 'lease.' || new.status,
      'lease:' || new.id || ':' || new.status || ':' || new.version,
      jsonb_build_object('lease_id', new.id, 'room_id', new.room_id, 'from', old.status, 'to', new.status));
    new.version = old.version + 1;
  end if;
  return new;
end $$;
drop trigger if exists leases_status_outbox on leases;
create trigger leases_status_outbox before update of status on leases for each row execute function leases_status_outbox();

-- ── meter readings (MET-01) ─────────────────────────────────────────────────
-- One live reading per room, meter and period; a correction supersedes the old row (history is kept).
create table if not exists meter_readings (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  room_id text not null,
  meter text not null check (meter in ('electricity', 'water')),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  reading numeric(12, 2) not null check (reading >= 0),
  previous_reading numeric(12, 2) check (previous_reading is null or previous_reading >= 0),
  -- a replaced meter starts a new baseline and must say why; otherwise the reading may not go down
  is_baseline boolean not null default false,
  baseline_reason text check (baseline_reason is null or char_length(baseline_reason) <= 300),
  photo_ref text,
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  -- a correction marks the old row superseded (time, replacement, why); rows are never deleted
  superseded_at timestamptz,
  superseded_by uuid references meter_readings (id),
  correction_reason text check (correction_reason is null or char_length(correction_reason) between 3 and 300),
  legacy_ref text,
  check (not is_baseline or baseline_reason is not null),
  check (is_baseline or previous_reading is null or reading >= previous_reading)
);
create unique index if not exists meter_readings_one_live
  on meter_readings (owner_uid, building_id, room_id, meter, period) where superseded_at is null;

-- ── invoices (BIL-01/02/03, DATA-04) ────────────────────────────────────────
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  lease_id uuid references leases (id) on delete restrict,
  party_id uuid references parties (id) on delete restrict,
  room_id text not null,
  room_number text not null,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind text not null default 'regular' check (kind in ('regular', 'adjustment', 'final')),
  adjusts_invoice_id uuid references invoices (id),
  status text not null default 'draft' check (status in ('draft', 'approved', 'issued', 'voided')),
  total_satang bigint not null default 0,
  issue_date date,
  due_date date,
  -- what the document said when it was issued: names, address, rates, readings (never re-read from master data)
  snapshot jsonb,
  -- one regular invoice per room, contract and period; retries of "create invoices" find the existing one
  dedupe_key text not null,
  legacy_ref text,
  approved_by text, approved_at timestamptz,
  issued_by text, issued_at timestamptz,
  voided_by text, voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) between 3 and 300),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  check (kind <> 'adjustment' or adjusts_invoice_id is not null),
  check (status <> 'voided' or void_reason is not null),
  check (kind = 'adjustment' or total_satang >= 0),
  unique (owner_uid, building_id, dedupe_key)
);
create index if not exists invoices_scope on invoices (owner_uid, building_id, period, status);
create index if not exists invoices_party on invoices (party_id) where party_id is not null;
create unique index if not exists invoices_legacy on invoices (owner_uid, legacy_ref) where legacy_ref is not null;
drop trigger if exists invoices_touch on invoices;
create trigger invoices_touch before update on invoices for each row execute function core_touch_updated_at();

create table if not exists invoice_lines (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  invoice_id uuid not null references invoices (id) on delete restrict,
  kind text not null check (kind in ('rent', 'electricity', 'water', 'common_fee', 'fine', 'service', 'deposit', 'discount', 'adjustment', 'other')),
  description text not null check (char_length(description) between 1 and 300),
  quantity numeric(12, 2),
  unit_price_satang bigint,
  amount_satang bigint not null,
  -- where the charge came from (a reading, a fine, a work order …): billed once only (BIL-01)
  source_type text,
  source_id text,
  meter_reading_id uuid references meter_readings (id),
  voided boolean not null default false,
  sort int not null default 0,
  check ((source_type is null) = (source_id is null)),
  check (kind in ('discount', 'adjustment') or amount_satang >= 0)
);
create index if not exists invoice_lines_invoice on invoice_lines (invoice_id);
create unique index if not exists invoice_lines_source_once
  on invoice_lines (owner_uid, building_id, source_type, source_id) where source_type is not null and not voided;

-- lines can only change while the invoice is a draft; the total follows the lines
create or replace function invoice_lines_guard() returns trigger language plpgsql as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    select status into v_status from invoices where id = old.invoice_id;
    if v_status <> 'draft' then raise exception 'invoice_not_draft' using errcode = 'P0001'; end if;
    return old;
  end if;
  select status into v_status from invoices where id = new.invoice_id;
  if v_status = 'draft' then return new; end if;
  -- the void path flips `voided` on lines of a voided invoice; nothing else may touch them
  if tg_op = 'UPDATE' and v_status = 'voided' and new.voided and not old.voided
     and new.invoice_id = old.invoice_id and new.amount_satang = old.amount_satang
     and new.source_type is not distinct from old.source_type and new.source_id is not distinct from old.source_id then
    return new;
  end if;
  raise exception 'invoice_not_draft' using errcode = 'P0001';
end $$;
drop trigger if exists invoice_lines_guard on invoice_lines;
create trigger invoice_lines_guard before insert or update or delete on invoice_lines for each row execute function invoice_lines_guard();

create or replace function invoice_lines_total() returns trigger language plpgsql as $$
declare v_inv uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update invoices set total_satang = coalesce((select sum(amount_satang) from invoice_lines where invoice_id = v_inv and not voided), 0)
    where id = v_inv and status = 'draft';
  return null;
end $$;
drop trigger if exists invoice_lines_total on invoice_lines;
create trigger invoice_lines_total after insert or update or delete on invoice_lines for each row execute function invoice_lines_total();

-- an issued invoice is frozen: only the void columns may change
create or replace function invoices_guard() returns trigger language plpgsql as $$
begin
  if old.status in ('issued', 'voided') and (
       new.total_satang <> old.total_satang or new.room_id <> old.room_id or new.period <> old.period
       or new.lease_id is distinct from old.lease_id or new.party_id is distinct from old.party_id
       or new.snapshot is distinct from old.snapshot or new.due_date is distinct from old.due_date
       or new.issue_date is distinct from old.issue_date) then
    raise exception 'invoice_frozen' using errcode = 'P0001';
  end if;
  if old.status = 'voided' and new.status <> 'voided' then raise exception 'invoice_frozen' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists invoices_guard on invoices;
create trigger invoices_guard before update on invoices for each row execute function invoices_guard();

-- ── payments + allocations (PAY-01..04) ─────────────────────────────────────
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  party_id uuid references parties (id) on delete restrict,
  method text not null check (method in ('cash', 'transfer', 'gateway', 'cheque', 'other')),
  amount_satang bigint not null check (amount_satang > 0),
  received_on date not null,
  reference text check (reference is null or char_length(reference) between 1 and 100),
  bank_account_id text,
  evidence_ref text,                                                       -- slip / receipt photo
  status text not null default 'pending_verification'
    check (status in ('pending_verification', 'confirmed', 'rejected', 'reversed')),
  status_reason text check (status_reason is null or char_length(status_reason) between 3 and 300),
  received_by text not null,
  received_by_name text,
  confirmed_by text, confirmed_at timestamptz,
  legacy_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  check (method <> 'transfer' or bank_account_id is not null),
  check (status not in ('rejected', 'reversed') or status_reason is not null)
);
create index if not exists payments_scope on payments (owner_uid, building_id, status, received_on);
-- PAY-01: the same bank / gateway reference is accepted once per channel
create unique index if not exists payments_reference_once
  on payments (owner_uid, building_id, method, reference) where reference is not null and status <> 'rejected';
create unique index if not exists payments_legacy on payments (owner_uid, legacy_ref) where legacy_ref is not null;
drop trigger if exists payments_touch on payments;
create trigger payments_touch before update on payments for each row execute function core_touch_updated_at();

create table if not exists payment_allocations (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  payment_id uuid not null references payments (id) on delete restrict,
  invoice_id uuid not null references invoices (id) on delete restrict,
  amount_satang bigint not null check (amount_satang > 0),
  created_by text not null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by text
);
create index if not exists payment_allocations_payment on payment_allocations (payment_id) where reversed_at is null;
create index if not exists payment_allocations_invoice on payment_allocations (invoice_id) where reversed_at is null;

-- outstanding is derived, never stored: issued total minus live allocations from confirmed payments
create or replace view invoice_balances as
  select i.id as invoice_id, i.owner_uid, i.building_id, i.room_id, i.period, i.status, i.due_date, i.total_satang,
         -- sum() of bigint is numeric: cast back so clients get numbers, not strings
         coalesce(a.allocated, 0)::bigint as allocated_satang,
         (i.total_satang - coalesce(a.allocated, 0))::bigint as outstanding_satang,
         case
           when i.status <> 'issued' then null
           when i.total_satang - coalesce(a.allocated, 0) <= 0 then 'paid'
           when coalesce(a.allocated, 0) > 0 and (i.due_date is null or i.due_date >= current_date) then 'partial'
           when i.due_date is not null and i.due_date < current_date then 'overdue'
           else 'unpaid'
         end as payment_state
  from invoices i
  left join (
    select pa.invoice_id, sum(pa.amount_satang) as allocated
    from payment_allocations pa join payments p on p.id = pa.payment_id
    where pa.reversed_at is null and p.status = 'confirmed'
    group by pa.invoice_id
  ) a on a.invoice_id = i.id;

create or replace view payment_balances as
  select p.id as payment_id, p.owner_uid, p.building_id, p.status, p.amount_satang,
         coalesce(sum(pa.amount_satang) filter (where pa.reversed_at is null), 0)::bigint as allocated_satang,
         (p.amount_satang - coalesce(sum(pa.amount_satang) filter (where pa.reversed_at is null), 0))::bigint as unallocated_satang
  from payments p left join payment_allocations pa on pa.payment_id = p.id
  group by p.id;

-- ── deposits (OUT-02) ───────────────────────────────────────────────────────
-- A ledger per contract: what is held is the sum of entries. Deductions and refunds need an approver.
create table if not exists deposit_entries (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  lease_id uuid not null references leases (id) on delete restrict,
  kind text not null check (kind in ('required', 'received', 'deducted', 'refunded', 'transferred_in', 'transferred_out')),
  -- received / transferred_in add to the balance; deducted / refunded / transferred_out reduce it; 'required' is the
  -- obligation and does not count as money held
  amount_satang bigint not null check (amount_satang > 0),
  payment_id uuid references payments (id),
  reason text check (reason is null or char_length(reason) <= 300),
  approved_by text,
  created_by text not null,
  created_at timestamptz not null default now(),
  legacy_ref text,
  check (kind not in ('deducted', 'refunded') or (approved_by is not null and reason is not null))
);
create index if not exists deposit_entries_lease on deposit_entries (lease_id);
create unique index if not exists deposit_entries_legacy on deposit_entries (owner_uid, legacy_ref) where legacy_ref is not null;

create or replace view deposit_balances as
  select lease_id, owner_uid, building_id,
         coalesce(sum(amount_satang) filter (where kind = 'required'), 0)::bigint as required_satang,
         coalesce(sum(case when kind in ('received', 'transferred_in') then amount_satang
                           when kind in ('deducted', 'refunded', 'transferred_out') then -amount_satang else 0 end), 0)::bigint as held_satang
  from deposit_entries group by lease_id, owner_uid, building_id;

-- ── portal access (SEC-04) ──────────────────────────────────────────────────
-- Tied to a person AND a contract, with an end. Ending the contract ends the grant (via the outbox worker).
create table if not exists portal_grants (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  building_id text not null,
  party_id uuid not null references parties (id) on delete restrict,
  lease_id uuid references leases (id) on delete restrict,
  secret_hash text not null check (char_length(secret_hash) = 64),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (valid_until > valid_from),
  unique (secret_hash)
);
create index if not exists portal_grants_party on portal_grants (party_id) where revoked_at is null;

-- ── migration bookkeeping (Migration §12) ───────────────────────────────────
create table if not exists migration_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_uid text not null,
  building_id text,
  dry_run boolean not null,
  checkpoint text,
  stats jsonb not null default '{}'::jsonb,
  started_by text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
-- what could not be converted safely waits here for a person (never guessed)
create table if not exists migration_issues (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references migration_runs (id) on delete cascade,
  owner_uid text not null,
  building_id text,
  entity text not null,
  legacy_ref text not null,
  problem text not null,
  details jsonb,
  resolved_at timestamptz,
  resolved_by text,
  resolution text,
  unique (run_id, entity, legacy_ref, problem)
);

-- ── atomic operations ───────────────────────────────────────────────────────

-- Record (or correct) a reading. A correction needs a reason and is refused once the reading is on an invoice that
-- has left draft: an issued month is fixed with an adjustment invoice, never by changing it (BIL-03 / UAT-06).
create or replace function meter_record_reading(
  p_owner text, p_building text, p_room text, p_meter text, p_period text, p_reading numeric, p_previous numeric,
  p_baseline boolean, p_baseline_reason text, p_photo text, p_by text, p_correction_reason text
) returns meter_readings language plpgsql as $$
declare
  old_r meter_readings;
  new_r meter_readings;
begin
  select * into old_r from meter_readings
    where owner_uid = p_owner and building_id = p_building and room_id = p_room and meter = p_meter and period = p_period
      and superseded_at is null
    for update;
  if found then
    if p_correction_reason is null then raise exception 'reading_exists' using errcode = 'P0001'; end if;
    if exists (select 1 from invoice_lines l join invoices i on i.id = l.invoice_id
               where l.meter_reading_id = old_r.id and not l.voided and i.status <> 'draft') then
      raise exception 'reading_billed' using errcode = 'P0001';
    end if;
    update meter_readings set superseded_at = now(), correction_reason = p_correction_reason where id = old_r.id;
  end if;
  insert into meter_readings (owner_uid, building_id, room_id, meter, period, reading, previous_reading, is_baseline, baseline_reason, photo_ref, recorded_by)
    values (p_owner, p_building, p_room, p_meter, p_period, p_reading, p_previous, coalesce(p_baseline, false), p_baseline_reason, p_photo, p_by)
    returning * into new_r;
  if old_r.id is not null then
    update meter_readings set superseded_by = new_r.id where id = old_r.id;
  end if;
  return new_r;
end $$;

-- draft → approved
create or replace function billing_approve_invoice(p_owner text, p_building text, p_invoice uuid, p_by text, p_version int)
returns invoices language plpgsql as $$
declare v invoices;
begin
  select * into v from invoices where id = p_invoice and owner_uid = p_owner and building_id = p_building for update;
  if not found then raise exception 'invoice_not_found' using errcode = 'P0002'; end if;
  if v.version <> p_version then raise exception 'stale_version' using errcode = 'P0001'; end if;
  if v.status <> 'draft' then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  if not exists (select 1 from invoice_lines where invoice_id = v.id and not voided) then raise exception 'invoice_empty' using errcode = 'P0001'; end if;
  update invoices set status = 'approved', approved_by = p_by, approved_at = now(), version = version + 1 where id = v.id returning * into v;
  return v;
end $$;

-- approved → issued (freezes the document and queues delivery)
create or replace function billing_issue_invoice(p_owner text, p_building text, p_invoice uuid, p_by text, p_issue date, p_due date, p_snapshot jsonb)
returns invoices language plpgsql as $$
declare v invoices;
begin
  select * into v from invoices where id = p_invoice and owner_uid = p_owner and building_id = p_building for update;
  if not found then raise exception 'invoice_not_found' using errcode = 'P0002'; end if;
  if v.status = 'issued' then return v; end if;                          -- retry of the same command: no-op
  if v.status <> 'approved' then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
  if p_due < p_issue then raise exception 'invalid_due_date' using errcode = 'P0001'; end if;
  update invoices set status = 'issued', issued_by = p_by, issued_at = now(), issue_date = p_issue, due_date = p_due,
                      snapshot = coalesce(p_snapshot, snapshot), version = version + 1
    where id = v.id returning * into v;
  perform core_enqueue(p_owner, p_building, 'invoice.issued', 'invoice:' || v.id || ':issued', jsonb_build_object('invoice_id', v.id));
  return v;
end $$;

-- issued → voided (only with no money allocated; the reason is required). Frees its source charges for re-billing.
create or replace function billing_void_invoice(p_owner text, p_building text, p_invoice uuid, p_by text, p_reason text)
returns invoices language plpgsql as $$
declare v invoices;
begin
  select * into v from invoices where id = p_invoice and owner_uid = p_owner and building_id = p_building for update;
  if not found then raise exception 'invoice_not_found' using errcode = 'P0002'; end if;
  if v.status = 'voided' then return v; end if;
  if exists (select 1 from payment_allocations where invoice_id = v.id and reversed_at is null) then
    raise exception 'invoice_has_allocations' using errcode = 'P0001';
  end if;
  update invoices set status = 'voided', voided_by = p_by, voided_at = now(), void_reason = p_reason, version = version + 1
    where id = v.id returning * into v;
  update invoice_lines set voided = true where invoice_id = v.id and not voided;
  perform core_enqueue(p_owner, p_building, 'invoice.voided', 'invoice:' || v.id || ':voided', jsonb_build_object('invoice_id', v.id));
  return v;
end $$;

-- pending_verification → confirmed | rejected;  confirmed → reversed (allocations are reversed with it)
create or replace function billing_set_payment_status(p_owner text, p_building text, p_payment uuid, p_status text, p_by text, p_reason text)
returns payments language plpgsql as $$
declare v payments;
begin
  select * into v from payments where id = p_payment and owner_uid = p_owner and building_id = p_building for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  if v.status = p_status then return v; end if;
  if not ((v.status = 'pending_verification' and p_status in ('confirmed', 'rejected'))
          or (v.status = 'confirmed' and p_status = 'reversed')) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if p_status = 'reversed' then
    update payment_allocations set reversed_at = now(), reversed_by = p_by where payment_id = v.id and reversed_at is null;
  end if;
  update payments set status = p_status, status_reason = coalesce(p_reason, status_reason),
                      confirmed_by = case when p_status = 'confirmed' then p_by else confirmed_by end,
                      confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
                      version = version + 1
    where id = v.id returning * into v;
  perform core_enqueue(p_owner, p_building, 'payment.' || p_status, 'payment:' || v.id || ':' || p_status, jsonb_build_object('payment_id', v.id));
  return v;
end $$;

-- Allocate confirmed money to an issued invoice: never more than the payment has left nor than the invoice owes.
create or replace function billing_allocate(p_owner text, p_building text, p_payment uuid, p_invoice uuid, p_amount bigint, p_by text)
returns payment_allocations language plpgsql as $$
declare
  p payments;
  i invoices;
  left_on_payment bigint;
  left_on_invoice bigint;
  a payment_allocations;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
  -- lock in a fixed order (payment, then invoice) so concurrent allocations cannot deadlock or both pass the checks
  select * into p from payments where id = p_payment and owner_uid = p_owner and building_id = p_building for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  if p.status <> 'confirmed' then raise exception 'payment_not_confirmed' using errcode = 'P0001'; end if;
  select * into i from invoices where id = p_invoice and owner_uid = p_owner and building_id = p_building for update;
  if not found then raise exception 'invoice_not_found' using errcode = 'P0002'; end if;
  if i.status <> 'issued' then raise exception 'invoice_not_issued' using errcode = 'P0001'; end if;

  select p.amount_satang - coalesce(sum(amount_satang), 0) into left_on_payment
    from payment_allocations where payment_id = p.id and reversed_at is null;
  select i.total_satang - coalesce(sum(pa.amount_satang), 0) into left_on_invoice
    from payment_allocations pa join payments pp on pp.id = pa.payment_id
    where pa.invoice_id = i.id and pa.reversed_at is null and pp.status = 'confirmed';
  if p_amount > left_on_payment then raise exception 'exceeds_payment' using errcode = 'P0001'; end if;
  if p_amount > left_on_invoice then raise exception 'exceeds_outstanding' using errcode = 'P0001'; end if;

  insert into payment_allocations (owner_uid, building_id, payment_id, invoice_id, amount_satang, created_by)
    values (p_owner, p_building, p.id, i.id, p_amount, p_by) returning * into a;
  perform core_enqueue(p_owner, p_building, 'allocation.created', 'allocation:' || a.id, jsonb_build_object('allocation_id', a.id, 'invoice_id', i.id, 'payment_id', p.id));
  return a;
end $$;

-- ── deny everything to client roles; the API (service role) is the only user ──
alter table outbox enable row level security;
alter table parties enable row level security;
alter table lease_parties enable row level security;
alter table lease_units enable row level security;
alter table meter_readings enable row level security;
alter table invoices enable row level security;
alter table invoice_lines enable row level security;
alter table payments enable row level security;
alter table payment_allocations enable row level security;
alter table deposit_entries enable row level security;
alter table portal_grants enable row level security;
alter table migration_runs enable row level security;
alter table migration_issues enable row level security;
revoke all on outbox, parties, lease_parties, lease_units, meter_readings, invoices, invoice_lines, payments,
  payment_allocations, deposit_entries, portal_grants, migration_runs, migration_issues,
  invoice_balances, payment_balances, deposit_balances from anon, authenticated;
grant select, insert, update, delete on outbox, parties, lease_parties, lease_units, meter_readings, invoices, invoice_lines,
  payments, payment_allocations, deposit_entries, portal_grants, migration_runs, migration_issues to service_role;
grant select on invoice_balances, payment_balances, deposit_balances to service_role;

revoke execute on function core_enqueue(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function meter_record_reading(text, text, text, text, text, numeric, numeric, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function meter_record_reading(text, text, text, text, text, numeric, numeric, boolean, text, text, text, text) to service_role;
revoke execute on function billing_approve_invoice(text, text, uuid, text, int) from public, anon, authenticated;
revoke execute on function billing_issue_invoice(text, text, uuid, text, date, date, jsonb) from public, anon, authenticated;
revoke execute on function billing_void_invoice(text, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function billing_set_payment_status(text, text, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function billing_allocate(text, text, uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function core_enqueue(text, text, text, text, jsonb) to service_role;
grant execute on function billing_approve_invoice(text, text, uuid, text, int) to service_role;
grant execute on function billing_issue_invoice(text, text, uuid, text, date, date, jsonb) to service_role;
grant execute on function billing_void_invoice(text, text, uuid, text, text) to service_role;
grant execute on function billing_set_payment_status(text, text, uuid, text, text, text) to service_role;
grant execute on function billing_allocate(text, text, uuid, uuid, bigint, text) to service_role;
