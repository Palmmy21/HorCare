/**
 * /api/leasing — leads, reservations and leases (data lives in Supabase; see supabase/README.md).
 *
 * Every call checks the caller's role and property first (`authorize`), then uses the service-role
 * client, and every row is scoped by owner_uid + building_id so one property can never reach another's.
 * Rooms are validated against Firestore, where they still live.
 *
 * read:   overview
 * manage: lead_create | lead_update | lead_move | reserve | reservation_cancel | convert
 *         lease_create | lease_renew | lease_activate | lease_end
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { dbError, supabase, SupabaseNotConfigured } from './_supabase.js';
import { todayTh } from '../src/shared/market.js';
import {
    canMoveLead, cleanEndInput, cleanLeadInput, cleanLeaseTerms, cleanReservationInput, LEAD_STATUSES, renewalDefaults, UUID_RE,
    type Lead, type LeadStatus, type Lease, type Reservation,
} from '../src/shared/leasing.js';
import type { Permission } from '../src/shared/permissions.js';

export const config = { maxDuration: 30 };

type Action = 'overview' | 'lead_create' | 'lead_update' | 'lead_move' | 'reserve' | 'reservation_cancel' | 'convert'
    | 'lease_create' | 'lease_renew' | 'lease_activate' | 'lease_end';
const ACTIONS: Action[] = ['overview', 'lead_create', 'lead_update', 'lead_move', 'reserve', 'reservation_cancel', 'convert', 'lease_create', 'lease_renew', 'lease_activate', 'lease_end'];

const LIST_LIMIT = 500;

class HttpError extends Error {
    constructor(public status: number, public code: string, public detail?: unknown) { super(code); }
}

type Body = Record<string, unknown> & { action?: Action; owner_uid?: string; building_id?: string };

const uuid = (v: unknown): string => {
    if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpError(400, 'invalid_input');
    return v;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const action = body.action;
    const buildingId = body.building_id;
    if (!action || !ACTIONS.includes(action)) { res.status(400).json({ error: 'unknown_action' }); return; }
    if (typeof buildingId !== 'string' || !buildingId) { res.status(400).json({ error: 'building_id is required' }); return; }

    const permission: Permission = action === 'overview' ? 'leasing.read' : 'leasing.manage';
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }

    const owner = ctx.ownerUid;
    const today = todayTh();
    const audit = (act: 'CREATE' | 'UPDATE', type: 'lead' | 'lease', id: string, label: string, extra: object = {}) =>
        writeAudit({
            ownerUid: owner, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: act, resourceType: type, resourceId: id, resourceLabel: label, req, ...extra,
        });

    try {
        const sb = supabase();
        const scope = { owner_uid: owner, building_id: buildingId };
        const fail = (error: { code?: string; message?: string }): never => { const e = dbError(error); throw new HttpError(e.status, e.code); };

        /** The room must exist and be active in this property (Firestore). */
        const room = async (id: unknown) => {
            if (typeof id !== 'string' || !id) throw new HttpError(400, 'invalid_input');
            const snap = await db.doc(`users/${owner}/buildings/${buildingId}/rooms/${id}`).get();
            const r = snap.data() as { room_number?: string; is_active?: boolean } | undefined;
            if (!snap.exists || r?.is_active === false) throw new HttpError(404, 'room_not_found');
            return { id, number: String(r?.room_number ?? id) };
        };
        const one = async <T,>(table: string, id: string): Promise<T> => {
            const { data, error } = await sb.from(table).select('*').eq('id', id).eq('owner_uid', owner).eq('building_id', buildingId).maybeSingle();
            if (error) fail(error);
            if (!data) throw new HttpError(404, 'not_found');
            return data as T;
        };

        if (action === 'overview') {
            const pull = async (table: string, order: string) => {
                const { data, error } = await sb.from(table).select('*').eq('owner_uid', owner).eq('building_id', buildingId).order(order, { ascending: false }).limit(LIST_LIMIT);
                if (error) fail(error);
                return data ?? [];
            };
            res.status(200).json({
                leads: await pull('leasing_leads', 'created_at'), reservations: await pull('leasing_reservations', 'created_at'), leases: await pull('leases', 'end_date'),
            });
            return;
        }

        // ── leads ────────────────────────────────────────────────────────────
        if (action === 'lead_create' || action === 'lead_update') {
            const input = cleanLeadInput(body);
            if (!input) throw new HttpError(400, 'invalid_input');
            if (input.interested_room_id) await room(input.interested_room_id);
            if (action === 'lead_create') {
                const { data, error } = await sb.from('leasing_leads').insert({ ...scope, ...input, created_by: ctx.uid }).select().single();
                if (error) fail(error);
                await audit('CREATE', 'lead', (data as Lead).id, `lead ${input.source}`);
                res.status(200).json({ lead: data });
                return;
            }
            const lead = await one<Lead>('leasing_leads', uuid(body.lead_id));
            if (lead.status === 'won') throw new HttpError(409, 'lead_closed');
            const { data, error } = await sb.from('leasing_leads').update(input).eq('id', lead.id).eq('owner_uid', owner).eq('building_id', buildingId).select().single();
            if (error) fail(error);
            await audit('UPDATE', 'lead', lead.id, 'lead updated');
            res.status(200).json({ lead: data });
            return;
        }

        if (action === 'lead_move') {
            const lead = await one<Lead>('leasing_leads', uuid(body.lead_id));
            const to = body.status;
            if (typeof to !== 'string' || !(LEAD_STATUSES as readonly string[]).includes(to)) throw new HttpError(400, 'invalid_input');
            if (!canMoveLead(lead.status, to as LeadStatus)) throw new HttpError(409, 'invalid_transition');
            const reason = typeof body.lost_reason === 'string' ? body.lost_reason.trim().slice(0, 300) : '';
            const { data, error } = await sb.from('leasing_leads')
                .update({ status: to, lost_reason: to === 'lost' ? (reason || null) : null })
                .eq('id', lead.id).eq('owner_uid', owner).eq('building_id', buildingId).eq('status', lead.status).select().maybeSingle();
            if (error) fail(error);
            if (!data) throw new HttpError(409, 'changed_meanwhile'); // someone else moved it first
            await audit('UPDATE', 'lead', lead.id, `${lead.status} → ${to}`);
            res.status(200).json({ lead: data });
            return;
        }

        // ── reservations ─────────────────────────────────────────────────────
        if (action === 'reserve') {
            const input = cleanReservationInput(body);
            if (!input) throw new HttpError(400, 'invalid_input');
            const r = await room(input.room_id);
            await one<Lead>('leasing_leads', input.lead_id);
            const inForce = await sb.from('leases').select('id').eq('owner_uid', owner).eq('building_id', buildingId).eq('room_id', r.id).eq('status', 'active').limit(1);
            if (inForce.error) fail(inForce.error);
            if ((inForce.data ?? []).length) throw new HttpError(409, 'room_leased');
            const { data, error } = await sb.rpc('leasing_reserve', {
                p_owner: owner, p_building: buildingId, p_lead: input.lead_id, p_room_id: r.id, p_room_number: r.number,
                p_deposit: input.deposit_satang, p_until: input.reserved_until, p_by: ctx.uid,
            });
            if (error) {
                if (error.code === '23505') throw new HttpError(409, 'room_already_reserved');
                fail(error);
            }
            await audit('CREATE', 'lead', input.lead_id, `reserved room ${r.number} until ${input.reserved_until}`);
            res.status(200).json({ reservation: data });
            return;
        }

        if (action === 'reservation_cancel') {
            const reservation = await one<Reservation>('leasing_reservations', uuid(body.reservation_id));
            const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
            const { data, error } = await sb.from('leasing_reservations').update({ status: 'cancelled', cancel_reason: reason || null })
                .eq('id', reservation.id).eq('owner_uid', owner).eq('building_id', buildingId).eq('status', 'active').select().maybeSingle();
            if (error) fail(error);
            if (!data) throw new HttpError(409, 'reservation_not_active');
            // the lead goes back to the pipeline, ready to be offered another room
            await sb.from('leasing_leads').update({ status: 'viewing' }).eq('id', reservation.lead_id).eq('owner_uid', owner).eq('building_id', buildingId).eq('status', 'reserved');
            await audit('UPDATE', 'lead', reservation.lead_id, `reservation of room ${reservation.room_number} cancelled`);
            res.status(200).json({ reservation: data });
            return;
        }

        if (action === 'convert') {
            const terms = cleanLeaseTerms(body);
            if (!terms) throw new HttpError(400, 'invalid_input');
            const reservation = await one<Reservation>('leasing_reservations', uuid(body.reservation_id));
            await room(reservation.room_id);
            const { data, error } = await sb.rpc('leasing_convert_reservation', {
                p_owner: owner, p_building: buildingId, p_reservation: reservation.id, p_tenant_name: terms.tenant_name, p_tenant_phone: terms.tenant_phone,
                p_start: terms.start_date, p_end: terms.end_date, p_rent: terms.rent_satang, p_deposit: terms.deposit_satang, p_by: ctx.uid,
            });
            if (error) {
                if (error.code === '23505') throw new HttpError(409, 'room_has_active_lease');
                fail(error);
            }
            await audit('CREATE', 'lease', (data as Lease).id, `Room ${reservation.room_number} ${terms.start_date}..${terms.end_date}`);
            res.status(200).json({ lease: data });
            return;
        }

        // ── leases ───────────────────────────────────────────────────────────
        if (action === 'lease_create') {
            const terms = cleanLeaseTerms(body);
            if (!terms) throw new HttpError(400, 'invalid_input');
            const r = await room(body.room_id);
            // a lease whose start is still in the future waits as "scheduled" instead of occupying the room today
            const status = terms.start_date > today ? 'scheduled' : 'active';
            const { data, error } = await sb.from('leases').insert({ ...scope, room_id: r.id, room_number: r.number, ...terms, status, created_by: ctx.uid }).select().single();
            if (error) {
                if (error.code === '23505') throw new HttpError(409, 'room_has_active_lease');
                fail(error);
            }
            await audit('CREATE', 'lease', (data as Lease).id, `Room ${r.number} ${terms.start_date}..${terms.end_date}`);
            res.status(200).json({ lease: data });
            return;
        }

        const lease = await one<Lease>('leases', uuid(body.lease_id));

        if (action === 'lease_renew') {
            if (lease.status !== 'active') throw new HttpError(409, 'lease_not_active');
            const pending = await sb.from('leases').select('id').eq('owner_uid', owner).eq('building_id', buildingId).eq('renewal_of', lease.id).in('status', ['scheduled', 'active']).limit(1);
            if (pending.error) fail(pending.error);
            if ((pending.data ?? []).length) throw new HttpError(409, 'already_renewed');
            const defaults = renewalDefaults(lease);
            const terms = cleanLeaseTerms({
                tenant_name: lease.tenant_name, tenant_phone: lease.tenant_phone ?? undefined,
                start_date: body.start_date ?? defaults.start_date, end_date: body.end_date ?? defaults.end_date,
                rent: body.rent ?? defaults.rent_satang / 100, deposit: body.deposit ?? 0,
            });
            // a renewal must begin after the current term ends — never overlap it
            if (!terms || terms.start_date <= lease.end_date) throw new HttpError(400, 'invalid_input');
            const { data, error } = await sb.from('leases').insert({
                ...scope, room_id: lease.room_id, room_number: lease.room_number, ...terms, lead_id: lease.lead_id, renewal_of: lease.id, status: 'scheduled', created_by: ctx.uid,
            }).select().single();
            if (error) fail(error);
            await audit('CREATE', 'lease', (data as Lease).id, `Room ${lease.room_number} renewal ${terms.start_date}..${terms.end_date}`);
            res.status(200).json({ lease: data });
            return;
        }

        if (action === 'lease_activate') {
            if (lease.status !== 'scheduled') throw new HttpError(409, 'lease_not_scheduled');
            if (lease.start_date > today) throw new HttpError(409, 'not_started_yet');
            const { data, error } = await sb.from('leases').update({ status: 'active' }).eq('id', lease.id).eq('owner_uid', owner).eq('building_id', buildingId).eq('status', 'scheduled').select().maybeSingle();
            if (error) {
                if (error.code === '23505') throw new HttpError(409, 'room_has_active_lease'); // end the current lease first
                fail(error);
            }
            if (!data) throw new HttpError(409, 'changed_meanwhile');
            await audit('UPDATE', 'lease', lease.id, `Room ${lease.room_number} activated`);
            res.status(200).json({ lease: data });
            return;
        }

        // lease_end
        if (lease.status !== 'active') throw new HttpError(409, 'lease_not_active');
        const end = cleanEndInput(body, lease);
        if (!end) throw new HttpError(400, 'invalid_input');
        const { data, error } = await sb.from('leases').update({ status: end.terminated ? 'terminated' : 'ended', ended_on: end.ended_on, end_reason: end.reason })
            .eq('id', lease.id).eq('owner_uid', owner).eq('building_id', buildingId).eq('status', 'active').select().maybeSingle();
        if (error) fail(error);
        if (!data) throw new HttpError(409, 'changed_meanwhile');
        await audit('UPDATE', 'lease', lease.id, `Room ${lease.room_number} ${end.terminated ? 'terminated' : 'ended'} ${end.ended_on}`, { note: end.reason ?? undefined });
        res.status(200).json({ lease: data });
    } catch (e) {
        if (e instanceof SupabaseNotConfigured) { res.status(503).json({ error: 'supabase_not_configured', message: 'ยังไม่ได้ตั้งค่า Supabase บนเซิร์ฟเวอร์ (ดู supabase/README.md)' }); return; }
        if (e instanceof HttpError) { res.status(e.status).json({ error: e.code, ...(e.detail ? { detail: e.detail } : {}) }); return; }
        throw e;
    }
}
