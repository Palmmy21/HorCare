/**
 * Server-side Supabase client for the ERP modules (see supabase/README.md).
 *
 * Uses the service-role key, so it must only ever run in the API: callers have to check the user's role
 * and property with `authorize()` BEFORE touching a table. The browser never receives this key.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export class SupabaseNotConfigured extends Error {
    constructor() { super('supabase_not_configured'); }
}

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new SupabaseNotConfigured();
    client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
}

/** PostgREST / Postgres error → an HTTP status and a stable error code for the UI. */
export function dbError(err: { code?: string; message?: string }): { status: number; code: string } {
    switch (err.code) {
        case '23505': return { status: 409, code: 'conflict' };           // unique violation (e.g. room already reserved)
        case '23514': return { status: 400, code: 'invalid_input' };      // check constraint
        case '23503': return { status: 409, code: 'in_use' };            // foreign key
        case '23P01': return { status: 409, code: 'conflict' };          // exclusion violation (room already booked for those nights)
        case 'P0002': return { status: 404, code: err.message || 'not_found' };
        case 'P0001': return { status: 409, code: err.message || 'conflict' };
        default: return { status: 502, code: 'database_error' };
    }
}
