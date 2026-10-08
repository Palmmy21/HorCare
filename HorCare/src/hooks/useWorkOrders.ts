import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { WorkOrder, WorkStaff } from '../shared/workOrders';

interface Snap { key: string; orders?: WorkOrder[]; staff?: WorkStaff[]; error?: string }

/** Live work orders + staff directory for one property (read-only; writes go through /api/work-orders). */
export function useWorkOrders(ownerUid: string | null, buildingId: string | null) {
  const key = ownerUid && buildingId ? `${ownerUid}/${buildingId}` : '';
  const [snap, setSnap] = useState<Snap | null>(null);

  useEffect(() => {
    if (!key) return;
    const base = `users/${key.split('/')[0]}/buildings/${key.split('/')[1]}`;
    const fail = (e: { code?: string }) =>
      setSnap(prev => ({ ...(prev?.key === key ? prev : { key }), error: e.code === 'permission-denied' ? 'คุณไม่มีสิทธิ์ดูใบงาน' : 'โหลดข้อมูลไม่สำเร็จ' }));

    const unsubOrders = onSnapshot(
      query(collection(db, `${base}/work_orders`), orderBy('created_at', 'desc'), limit(300)),
      s => setSnap(prev => ({ ...(prev?.key === key ? prev : { key }), orders: s.docs.map(d => d.data() as WorkOrder), error: undefined })),
      fail,
    );
    const unsubStaff = onSnapshot(
      collection(db, `${base}/staff`),
      s => setSnap(prev => ({ ...(prev?.key === key ? prev : { key }), staff: s.docs.map(d => d.data() as WorkStaff).sort((a, b) => a.name.localeCompare(b.name)) })),
      fail,
    );
    return () => { unsubOrders(); unsubStaff(); };
  }, [key]);

  // Data from a previously selected property is never shown for the current one.
  const cur = snap && snap.key === key ? snap : null;
  return {
    orders: cur?.orders ?? [],
    staff: cur?.staff ?? [],
    loading: !!key && (cur === null || cur.orders === undefined || cur.staff === undefined) && !cur?.error,
    error: cur?.error ?? null,
  };
}
