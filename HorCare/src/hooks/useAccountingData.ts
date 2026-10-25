import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { PaymentRec } from '../shared/accounting';
import type { Fine, MonthlyBill, Room } from '../types';

function useLive<T>(path: string | null) {
  const [snap, setSnap] = useState<{ path: string; list: T[]; error: boolean } | null>(null);
  useEffect(() => {
    if (!path) return;
    return onSnapshot(
      collection(db, path),
      s => setSnap({ path, list: s.docs.map(d => d.data() as T), error: false }),
      () => setSnap({ path, list: [], error: true }),
    );
  }, [path]);
  const cur = snap && snap.path === path ? snap : null;
  return { list: cur?.list ?? [], loading: !!path && cur === null, error: cur?.error ?? false };
}

export function useBuildingRooms(ownerUid: string | null, buildingId: string | null) {
  const { list, loading } = useLive<Room & { id: string }>(ownerUid && buildingId ? `users/${ownerUid}/buildings/${buildingId}/rooms` : null);
  return { rooms: useMemo(() => list.filter(r => r.is_active !== false).sort((a, b) => a.room_number.localeCompare(b.room_number, 'th', { numeric: true })), [list]), loading };
}

/** A payment recorded with allocations (see /api/accounting record_payment). */
export type RecordedPayment = PaymentRec & { bank_account_id?: string | null; room_number?: string; transaction_ref?: string | null; bank_transaction_id?: string };
export function useBuildingPayments(ownerUid: string | null, buildingId: string | null) {
  const { list, loading } = useLive<RecordedPayment>(ownerUid && buildingId ? `users/${ownerUid}/buildings/${buildingId}/payments` : null);
  return { payments: useMemo(() => [...list].sort((a, b) => b.paid_at.localeCompare(a.paid_at)), [list]), loading };
}

export type BillingItem = (MonthlyBill | Fine) & { allocated_satang?: number; payments_recorded?: boolean };
export function useBuildingBilling(ownerUid: string | null, buildingId: string | null) {
  const base = ownerUid && buildingId ? `users/${ownerUid}/buildings/${buildingId}` : null;
  const bills = useLive<MonthlyBill>(base ? `${base}/bills` : null);
  const fines = useLive<Fine>(base ? `${base}/fines` : null);
  return { bills: bills.list as BillingItem[], fines: fines.list as BillingItem[], loading: bills.loading || fines.loading };
}
