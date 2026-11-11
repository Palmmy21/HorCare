/**
 * The stalls of a market as the collection round sees them (shared by /api/collections, POS Care and the revenue audit):
 * number, zone, rent and how it is paid (Room.rent_type), whether anyone is on it (contracts → tenant profile → the
 * hand-set status, the same rule as everywhere else), and whether this month's monthly bill already carries the rent.
 * A stall needs nothing more than this to be collected — no plan to set up first.
 */
import { db } from './_firebase.js';
import { toSatang } from '../src/shared/accounting.js';
import { monthOf, type RoundStall } from '../src/shared/collections.js';
import { contractOccupancy, effectiveOccupancy, type LeaseFacts, type ProfileFacts, type RoomStatus, type StatusOverride } from '../src/shared/roomOccupancy.js';

interface RoomDoc {
    room_number?: string; zone?: string; is_active?: boolean; rent_amount?: number; rent_type?: string;
    room_status?: RoomStatus; status_override?: StatusOverride | null;
}

export interface RoundStallInfo extends RoundStall { zone: string | null; is_active: boolean; rent_type: string }

type Sb = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Every stall (active or not) with what the round needs. `sb` is optional: without leases, profiles decide vacancy. */
export async function loadRoundStalls(owner: string, buildingId: string, date: string, sb: Sb | null): Promise<RoundStallInfo[]> {
    const base = `users/${owner}/buildings/${buildingId}`;
    const leaseRead = sb
        ? Promise.resolve(sb.from('leases').select('*').eq('owner_uid', owner).eq('building_id', buildingId).limit(5000)).then(
            (r: { data: LeaseFacts[] | null; error: unknown }) => (r.error ? [] : r.data ?? []),
            () => [] as LeaseFacts[])
        : Promise.resolve([] as LeaseFacts[]);
    const [roomsSnap, tenantsSnap, billsSnap, leases] = await Promise.all([
        db.collection(`${base}/rooms`).get(),
        db.collection(`${base}/tenants`).get(),
        db.collection(`${base}/bills`).where('month', '==', monthOf(date)).get(),
        leaseRead,
    ]);
    const profiles = new Map<string, ProfileFacts>();
    for (const d of tenantsSnap.docs) {
        const p = d.data() as ProfileFacts;
        profiles.set(d.id, { full_name: p.full_name, move_in_date: p.move_in_date, contract_end_date: p.contract_end_date, expected_move_out: p.expected_move_out, signed_contract: p.signed_contract });
    }
    const leasesOf = new Map<string, LeaseFacts[]>();
    for (const l of leases as (LeaseFacts & { room_id: string })[]) { const list = leasesOf.get(l.room_id) ?? []; list.push(l); leasesOf.set(l.room_id, list); }
    const rentBilled = new Set<string>();
    for (const d of billsSnap.docs) {
        const b = d.data() as { room_id?: string; is_saved?: boolean; room_rent?: number };
        if (b.room_id && b.is_saved !== false && (Number(b.room_rent) || 0) > 0) rentBilled.add(b.room_id);
    }
    return roomsSnap.docs.map(d => {
        const r = d.data() as RoomDoc;
        const occ = effectiveOccupancy(contractOccupancy({ leases: leasesOf.get(d.id), profile: profiles.get(d.id) ?? null, legacyStatus: r.room_status }, date), r.status_override);
        return {
            id: d.id, room_number: String(r.room_number ?? d.id), zone: (r.zone ?? '').trim() || null, is_active: r.is_active !== false,
            rent_type: r.rent_type ?? 'monthly', rent_satang: toSatang(Number(r.rent_amount) || 0),
            // only what the contracts / profiles say: a stall made in bulk starts as 'vacant' by hand, and must still be collectable
            vacant: occ.status === 'vacant' && (occ.source !== 'none' || !!occ.override), rent_billed: rentBilled.has(d.id),
        };
    });
}
