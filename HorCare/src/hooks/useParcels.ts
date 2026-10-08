import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { Parcel } from '../shared/parcels';

interface Snapshot { key: string; parcels: Parcel[]; error: string | null }

/** Live parcels for one property, newest first (read-only; writes go through /api/parcels). */
export function useParcels(ownerUid: string | null, buildingId: string | null) {
  const key = ownerUid && buildingId ? `${ownerUid}/${buildingId}` : '';
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!key) return;
    const q = query(collection(db, `users/${key.split('/')[0]}/buildings/${key.split('/')[1]}/parcels`), orderBy('received_at', 'desc'), limit(500));
    return onSnapshot(
      q,
      s => setSnap({ key, parcels: s.docs.map(d => d.data() as Parcel), error: null }),
      err => setSnap({ key, parcels: [], error: err.code === 'permission-denied' ? 'คุณไม่มีสิทธิ์ดูพัสดุ' : 'โหลดข้อมูลพัสดุไม่สำเร็จ' }),
    );
  }, [key]);

  // Data from a previously selected property is never shown for the current one.
  const current = snap && snap.key === key ? snap : null;
  return {
    parcels: current?.parcels ?? [],
    loading: !!key && current === null,
    error: current?.error ?? null,
  };
}
