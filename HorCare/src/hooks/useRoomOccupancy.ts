import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { apiPost } from '../utils/api';
import { todayTh } from '../shared/market';
import type { Lead, Lease, Reservation } from '../shared/leasing';
import {
  contractOccupancy, contractTerms, effectiveOccupancy,
  type LeaseFacts, type Occupancy, type ProfileFacts, type ReservationFacts,
} from '../shared/roomOccupancy';
import type { Room, TenantProfile } from '../types';

interface LeasingFacts { leases: LeaseFacts[]; reservations: ReservationFacts[] }

/**
 * Each room's status, derived from its contracts (see shared/roomOccupancy.ts):
 * leases and reservations from the leasing module (API, Supabase) first, then the tenant profiles (Firestore).
 * A source the account cannot read, or a property without the leasing module set up, simply contributes nothing.
 */
export function useRoomOccupancy(
  uid: string | null | undefined,
  buildingId: string | null | undefined,
  rooms: Room[],
  access: { leasing: boolean; tenants: boolean } = { leasing: true, tenants: true },
) {
  const [leasing, setLeasing] = useState<LeasingFacts | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ProfileFacts>>({});
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!uid || !buildingId || !access.leasing) { setLeasing(null); return; } // eslint-disable-line react-hooks/set-state-in-effect
    let cancelled = false;
    apiPost<{ leads: Lead[]; reservations: Reservation[]; leases: Lease[] }>('leasing', { owner_uid: uid, building_id: buildingId, action: 'overview' })
      .then(r => {
        if (cancelled) return;
        const leadName = new Map(r.leads.map(l => [l.id, l.name]));
        setLeasing({
          leases: r.leases.map(l => ({ id: l.id, room_id: l.room_id, status: l.status, start_date: l.start_date, end_date: l.end_date, tenant_name: l.tenant_name })),
          reservations: r.reservations.map(x => ({ id: x.id, room_id: x.room_id, status: x.status, reserved_until: x.reserved_until, lead_name: leadName.get(x.lead_id) })),
        });
      })
      // not set up / no permission: the profiles still decide
      .catch(() => { if (!cancelled) setLeasing(null); });
    return () => { cancelled = true; };
  }, [uid, buildingId, access.leasing, reloadTick]);

  useEffect(() => {
    if (!uid || !buildingId || !access.tenants) { setProfiles({}); return; } // eslint-disable-line react-hooks/set-state-in-effect
    return onSnapshot(
      collection(db, `users/${uid}/buildings/${buildingId}/tenants`),
      snap => {
        const next: Record<string, ProfileFacts> = {};
        snap.docs.forEach(d => {
          const p = d.data() as Partial<TenantProfile>;
          next[d.id] = {
            full_name: p.full_name, move_in_date: p.move_in_date, contract_end_date: p.contract_end_date, expected_move_out: p.expected_move_out,
            signed_contract: p.signed_contract
              ? { id: p.signed_contract.id, contract_number: p.signed_contract.contract_number, status: p.signed_contract.status, start_date: p.signed_contract.start_date, end_date: p.signed_contract.end_date }
              : undefined,
          };
        });
        setProfiles(next);
      },
      () => setProfiles({}),
    );
  }, [uid, buildingId, access.tenants]);

  // Re-read the leasing module when the owner comes back to the tab (a lease may have been signed meanwhile).
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') setReloadTick(t => t + 1); };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, []);

  const byRoom = useMemo(() => {
    const today = todayTh();
    const out: Record<string, Occupancy> = {};
    for (const room of rooms) {
      const auto = contractOccupancy({
        leases: leasing?.leases.filter(l => l.room_id === room.id),
        reservations: leasing?.reservations.filter(r => r.room_id === room.id),
        profile: profiles[room.id] ?? null,
        legacyStatus: room.room_status,
      }, today);
      out[room.id] = effectiveOccupancy(auto, room.status_override);
    }
    return out;
  }, [rooms, leasing, profiles]);

  // Tenant name and contract end per room (plan contract layer, units of one tenant)
  const termsByRoom = useMemo(() => {
    const today = todayTh();
    const out: Record<string, { tenant?: string; end?: string }> = {};
    for (const room of rooms) {
      out[room.id] = contractTerms({ leases: leasing?.leases.filter(l => l.room_id === room.id), profile: profiles[room.id] ?? null }, today);
    }
    return out;
  }, [rooms, leasing, profiles]);

  const reload = useCallback(() => setReloadTick(t => t + 1), []);
  return { byRoom, termsByRoom, reload, leasingAvailable: leasing !== null };
}
