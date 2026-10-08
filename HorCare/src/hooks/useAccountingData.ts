import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { ExportBatch, MangoProfile } from '../shared/accounting';
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

export function useMangoProfiles(ownerUid: string | null) {
  const { list, loading, error } = useLive<MangoProfile>(ownerUid ? `users/${ownerUid}/accounting_profiles` : null);
  return { profiles: useMemo(() => [...list].sort((a, b) => a.name.localeCompare(b.name, 'th')), [list]), loading, error };
}

export function useExportBatches(ownerUid: string | null) {
  const { list, loading, error } = useLive<ExportBatch>(ownerUid ? `users/${ownerUid}/accounting_batches` : null);
  return { batches: useMemo(() => [...list].sort((a, b) => b.created_at.localeCompare(a.created_at)), [list]), loading, error };
}

export function useBuildingRooms(ownerUid: string | null, buildingId: string | null) {
  const { list, loading } = useLive<Room & { id: string }>(ownerUid && buildingId ? `users/${ownerUid}/buildings/${buildingId}/rooms` : null);
  return { rooms: useMemo(() => list.filter(r => r.is_active !== false).sort((a, b) => a.room_number.localeCompare(b.room_number, 'th', { numeric: true })), [list]), loading };
}

export type BillingItem = (MonthlyBill | Fine) & { allocated_satang?: number; payments_recorded?: boolean };
export function useBuildingBilling(ownerUid: string | null, buildingId: string | null) {
  const base = ownerUid && buildingId ? `users/${ownerUid}/buildings/${buildingId}` : null;
  const bills = useLive<MonthlyBill>(base ? `${base}/bills` : null);
  const fines = useLive<Fine>(base ? `${base}/fines` : null);
  return { bills: bills.list as BillingItem[], fines: fines.list as BillingItem[], loading: bills.loading || fines.loading };
}
