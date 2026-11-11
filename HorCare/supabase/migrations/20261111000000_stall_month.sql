-- Monthly-rent stalls collected on the round: a stall made with a monthly rent is ready to collect straight away
-- (charge kind 'stall_month', one per stall per month, dedupe key stall-month:<room>:<YYYY-MM>). Utilities stay on
-- the meter bill, rent is collected here. Safe to run more than once.
alter table charges drop constraint if exists charges_kind_check;
alter table charges add constraint charges_kind_check
  check (kind in ('stay', 'stall_week', 'stall_day', 'stall_month', 'walk_in', 'extra'));
