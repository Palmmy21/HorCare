/**
 * /api/listing — the public vacancy page ("หน้าประกาศห้องว่าง").
 *
 * Public (no login; opened from ?listing=<slug>):
 *   view    – the property's name/contact and its vacant rooms. Nothing about tenants leaves the server.
 *   request – a visitor asks to view a room: saved under the property (viewing_requests), added as a lead in the
 *             leasing pipeline when Supabase is set up, and pushed to the owner.
 * Owner / staff with leasing.manage:
 *   publish – turn the page on/off and edit its text; creates the random slug on first publish.
 *
 * The slug → property index (listing_slugs/{slug}) is server-only (Firestore rules deny clients).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { honeypotTripped, rateLimit, verifyCaptcha } from './_abuse-guard.js';
import { pushToOwner } from './_notify-push.js';
import { supabase, SupabaseNotConfigured } from './_supabase.js';
import { contractOccupancy, effectiveOccupancy, type LeaseFacts, type ProfileFacts, type ReservationFacts, type StatusOverride } from '../src/shared/roomOccupancy.js';
import { cleanListingSettings, cleanViewingRequest, SLUG_RE, type ListingConfig, type ListingRoom, type PublicListing } from '../src/shared/listing.js';
import { todayTh } from '../src/shared/market.js';
import { errorInfo } from '../src/shared/errorInfo.js';

export const config = { maxDuration: 30 };

/** Calls per visitor per hour. */
const LIMITS = { view: 120, request: 5 } as const;

interface Body {
    action?: string;
    slug?: unknown;
    owner_uid?: unknown;
    building_id?: unknown;
    website?: unknown;
    captcha_token?: unknown;
    [k: string]: unknown;
}

async function resolveSlug(slug: unknown): Promise<{ owner: string; buildingId: string; cfg: Record<string, unknown> } | null> {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
    const idx = (await db.doc(`listing_slugs/${slug}`).get()).data() as { owner_uid?: string; building_id?: string } | undefined;
    if (!idx?.owner_uid || !idx.building_id) return null;
    const cfg = (await db.doc(`users/${idx.owner_uid}/buildings/${idx.building_id}/data/config`).get()).data();
    const listing = cfg?.listing as ListingConfig | undefined;
    if (!listing?.enabled || listing.slug !== slug) return null;
    const owner = (await db.doc(`users/${idx.owner_uid}`).get()).data();
    if (owner?.status === 'banned') return null;
    return { owner: idx.owner_uid, buildingId: idx.building_id, cfg: cfg as Record<string, unknown> };
}

/** Leases and reservations from the leasing module; empty when it is not set up (profiles still decide). */
async function leasingFacts(owner: string, buildingId: string): Promise<{ leases: LeaseFacts[]; reservations: ReservationFacts[] }> {
    try {
        const sb = supabase();
        const [leases, reservations] = await Promise.all([
            sb.from('leases').select('id, room_id, status, start_date, end_date').eq('owner_uid', owner).eq('building_id', buildingId).in('status', ['active', 'scheduled']),
            sb.from('leasing_reservations').select('id, room_id, status, reserved_until').eq('owner_uid', owner).eq('building_id', buildingId).eq('status', 'active'),
        ]);
        return { leases: (leases.data ?? []) as LeaseFacts[], reservations: (reservations.data ?? []) as ReservationFacts[] };
    } catch (err) {
        if (!(err instanceof SupabaseNotConfigured)) console.warn('listing: leasing facts unavailable:', errorInfo(err).message);
        return { leases: [], reservations: [] };
    }
}

/** Active rooms that are vacant today, by the same rules as the room map. */
export async function vacantRooms(owner: string, buildingId: string, showPrices: boolean): Promise<ListingRoom[]> {
    const base = `users/${owner}/buildings/${buildingId}`;
    const [roomsSnap, tenantsSnap, facts] = await Promise.all([
        db.collection(`${base}/rooms`).get(),
        db.collection(`${base}/tenants`).get(),
        leasingFacts(owner, buildingId),
    ]);
    const profiles = new Map(tenantsSnap.docs.map(d => [d.id, d.data() as ProfileFacts]));
    const today = todayTh();
    const out: ListingRoom[] = [];
    for (const doc of roomsSnap.docs) {
        const r = doc.data() as {
            room_number?: string; is_active?: boolean; floor?: string; building_name?: string; rent_amount?: number; rent_type?: string;
            deposit_amount?: number; area_sqm?: number | null; amenities?: string[]; room_status?: 'occupied' | 'vacant' | 'reserved'; status_override?: StatusOverride | null;
        };
        if (r.is_active === false) continue;
        const auto = contractOccupancy({
            leases: facts.leases.filter(l => l.room_id === doc.id),
            reservations: facts.reservations.filter(x => x.room_id === doc.id),
            profile: profiles.get(doc.id) ?? null,
            legacyStatus: r.room_status,
        }, today);
        if (effectiveOccupancy(auto, r.status_override).status !== 'vacant') continue;
        out.push({
            id: doc.id,
            number: String(r.room_number ?? doc.id),
            floor: r.floor || null,
            building_name: r.building_name || null,
            rent: showPrices && typeof r.rent_amount === 'number' && r.rent_amount > 0 ? r.rent_amount : null,
            rent_type: r.rent_type || 'monthly',
            deposit: showPrices && typeof r.deposit_amount === 'number' && r.deposit_amount > 0 ? r.deposit_amount : null,
            area_sqm: typeof r.area_sqm === 'number' && r.area_sqm > 0 ? r.area_sqm : null,
            amenities: Array.isArray(r.amenities) ? r.amenities.filter(a => typeof a === 'string').slice(0, 20) : [],
        });
    }
    return out.sort((a, b) => a.number.localeCompare(b.number, 'th', { numeric: true }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const action = body.action;

    try {
        if (action === 'view' || action === 'request') {
            const slugKey = typeof body.slug === 'string' ? body.slug.slice(0, 24) : '';
            // counted first, so guessing slugs costs the same as any other call
            const limited = await rateLimit(req, `listing:${action}:${slugKey}`, LIMITS[action], 3600);
            if (!limited.ok) { res.setHeader?.('Retry-After', String(limited.retryAfterSec)); res.status(429).json({ error: 'too_many_requests', retry_after_sec: limited.retryAfterSec }); return; }

            const found = await resolveSlug(body.slug);
            if (!found) { res.status(404).json({ error: 'not_found' }); return; }
            const { owner, buildingId, cfg } = found;
            const listing = cfg.listing as ListingConfig;
            const bill = (cfg.bill_customization ?? {}) as { dorm_name?: string; dorm_address?: string; dorm_phone?: string; dorm_logo?: string };

            if (action === 'view') {
                const payload: PublicListing = {
                    name: bill.dorm_name || 'ห้องว่างให้เช่า',
                    address: bill.dorm_address || null,
                    phone: listing.contact_phone || bill.dorm_phone || null,
                    logo: bill.dorm_logo || null,
                    headline: listing.headline || null,
                    description: listing.description || null,
                    line_url: listing.line_url || null,
                    building_type: String(cfg.building_type || 'dormitory'),
                    rooms: await vacantRooms(owner, buildingId, listing.show_prices !== false),
                    updated_at: new Date().toISOString(),
                };
                res.setHeader?.('Cache-Control', 'public, max-age=60');
                res.status(200).json(payload);
                return;
            }

            // ── request a viewing ──
            // bots that fill the hidden field get a normal-looking answer and nothing is stored
            if (honeypotTripped(body.website)) { res.status(200).json({ ok: true }); return; }
            if (!(await verifyCaptcha(body.captcha_token, req))) { res.status(400).json({ error: 'captcha_failed' }); return; }
            const input = cleanViewingRequest(body, todayTh());
            if (!input) { res.status(400).json({ error: 'invalid_input' }); return; }

            const base = `users/${owner}/buildings/${buildingId}`;
            let roomNumber: string | null = null;
            if (input.room_id) {
                const room = (await db.doc(`${base}/rooms/${input.room_id}`).get()).data();
                if (!room || room.is_active === false) { res.status(400).json({ error: 'invalid_input' }); return; }
                roomNumber = String(room.room_number ?? input.room_id);
            }

            const now = new Date().toISOString();
            const ref = db.collection(`${base}/viewing_requests`).doc();
            await ref.set({ id: ref.id, ...input, room_number: roomNumber, status: 'new', source: 'listing', created_at: now });

            // the leasing pipeline, when it is set up; the request above is kept either way
            let leadId: string | null = null;
            try {
                const { data, error } = await supabase().from('leasing_leads').insert({
                    owner_uid: owner, building_id: buildingId, name: input.name, phone: input.phone, line_id: input.line_id,
                    source: 'online', interested_room_id: input.room_id, target_move_in: input.move_in,
                    note: ['ขอนัดดูห้องจากหน้าประกาศห้องว่าง', input.note].filter(Boolean).join(' — '), created_by: 'public_listing',
                }).select('id').single();
                if (error) throw error;
                leadId = (data as { id: string }).id;
                await ref.update({ lead_id: leadId });
            } catch (err) {
                if (!(err instanceof SupabaseNotConfigured)) console.warn('listing: lead not created:', errorInfo(err).message);
            }

            await pushToOwner(owner, {
                title: `มีคนขอดูห้อง${roomNumber ? ` ${roomNumber}` : ''}`,
                body: `${input.name} · ${input.phone}${input.move_in ? ` · อยากเข้าอยู่ ${input.move_in}` : ''}`,
                data: { type: 'viewing_request', building_id: buildingId },
            }).catch(err => console.warn('listing: owner push failed:', errorInfo(err).message));

            res.status(200).json({ ok: true });
            return;
        }

        if (action === 'publish') {
            const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId: body.building_id, permission: 'leasing.manage' });
            if (!ctx) return;
            const buildingId = String(body.building_id);
            if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }
            const settings = cleanListingSettings(body);
            if (!settings) { res.status(400).json({ error: 'invalid_input' }); return; }

            const cfgRef = db.doc(`users/${ctx.ownerUid}/buildings/${buildingId}/data/config`);
            const current = (await cfgRef.get()).data()?.listing as ListingConfig | undefined;
            let slug = current?.slug && SLUG_RE.test(current.slug) ? current.slug : '';
            if (!slug) {
                slug = randomBytes(8).toString('hex').slice(0, 12);
                await db.doc(`listing_slugs/${slug}`).set({ owner_uid: ctx.ownerUid, building_id: buildingId, created_at: new Date().toISOString() });
            }
            const listing: ListingConfig = { ...settings, slug };
            // replace the whole field (a cleared headline must disappear); strip undefined for the Admin SDK
            await cfgRef.update({ listing: JSON.parse(JSON.stringify(listing)) });
            res.status(200).json({ listing });
            return;
        }

        res.status(400).json({ error: 'unknown_action' });
    } catch (err) {
        console.error('listing failed:', errorInfo(err).message);
        res.status(500).json({ error: 'internal_error' });
    }
}
