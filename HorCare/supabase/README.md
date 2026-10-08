# Supabase (ERP modules)

New ERP modules (starting with **Leasing**) store their data in Supabase Postgres. The existing HorCare
features (bills, tenants, LINE, the ledger) stay on Firebase.

## Access model

The browser **never** talks to Supabase. Every request goes through the Vercel API (`api/_leasing.ts`), which
checks the signed-in user's role and property with HorCare's RBAC and only then queries Supabase with the
**service-role key**. Row Level Security is enabled with no policies, so even the public anon key can read nothing.

## Set up

1. Create a project at supabase.com (pick the Singapore region for Thailand).
2. Run the SQL in `migrations/` in order — paste each file into **SQL Editor → Run**, or use the Supabase CLI
   (`supabase link` then `supabase db push`).
3. In **Vercel → Project → Settings → Environment Variables** add (Production and Preview):
   - `SUPABASE_URL` — the project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — the **service_role** key (Project Settings → API). Server-only; never put it in
     any `VITE_` variable and never commit it.
4. Redeploy. Until both variables exist the Leasing screens show "Supabase is not configured".

## Rules for new migrations

- One file per change, named `YYYYMMDDHHMMSS_description.sql`, never edited after it has been applied.
- Every table: `enable row level security` and no policies; scope every row by `owner_uid` + `building_id`.
- Money is integer satang. Dates are `date` (Thai calendar day); instants are `timestamptz`.
- Multi-step changes that must be atomic belong in a SQL function called through `rpc` (see `leasing_reserve`).
