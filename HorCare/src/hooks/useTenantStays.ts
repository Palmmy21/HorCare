import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { TenantProfile } from '../types';
import type { Stay } from '../shared/prorate';

/**
 * Move-in / move-out dates per room, from the tenant profiles (`move_in_date`, `expected_move_out`), for prorated rent.
 * Pass a null uid to skip loading (prorating off, or a housekeeper session that may not read tenants).
 */
export function useTenantStays(uid: string | null | undefined, buildingId: string | null | undefined): Record<string, Stay> {
  const [state, setState] = useState<{ key: string; stays: Record<string, Stay> }>({ key: '', stays: {} });
  const key = uid && buildingId ? `${uid}/${buildingId}` : '';

  useEffect(() => {
    if (!key) return;
    return onSnapshot(
      collection(db, `users/${uid}/buildings/${buildingId}/tenants`),
      snap => {
        const stays: Record<string, Stay> = {};
        snap.docs.forEach(d => {
          const p = d.data() as Partial<TenantProfile>;
          if (p.move_in_date || p.expected_move_out) stays[d.id] = { from: p.move_in_date ?? null, to: p.expected_move_out ?? null };
        });
        setState({ key, stays });
      },
      () => setState({ key, stays: {} }), // no permission: bill full rent
    );
  }, [key, uid, buildingId]);

  return state.key === key ? state.stays : {};
}
