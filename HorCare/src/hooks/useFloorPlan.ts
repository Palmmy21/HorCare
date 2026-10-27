import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { autoPlan, isFloorPlan, reconcile, type FloorPlan, type PlanKind, type PlanRoom } from '../shared/floorPlan';

/**
 * The property's plan, kept at users/{uid}/buildings/{id}/data/floor_plan (same rules as the property settings:
 * members read, the owner or property.update writes). Until the owner saves one, the plan is generated from the rooms;
 * either way it is reconciled with the current rooms on every read.
 */
export function useFloorPlan(uid: string | null | undefined, buildingId: string | null | undefined, rooms: PlanRoom[], kind: PlanKind) {
  const [stored, setStored] = useState<{ key: string; plan: FloorPlan | null } | null>(null);
  const key = uid && buildingId ? `${uid}/${buildingId}` : '';

  useEffect(() => {
    if (!uid || !buildingId) return;
    return onSnapshot(
      doc(db, `users/${uid}/buildings/${buildingId}/data/floor_plan`),
      snap => setStored({ key: `${uid}/${buildingId}`, plan: snap.exists() && isFloorPlan(snap.data()) ? snap.data() as FloorPlan : null }),
      () => setStored({ key: `${uid}/${buildingId}`, plan: null }),
    );
  }, [uid, buildingId]);

  const current = stored?.key === key ? stored : null;
  const plan = useMemo(
    () => (current?.plan ? reconcile(current.plan, rooms, kind) : autoPlan(rooms, kind)),
    [current, rooms, kind],
  );

  const save = useCallback(async (next: FloorPlan, by?: string) => {
    if (!uid || !buildingId) return;
    const body: FloorPlan = { ...next, updated_at: new Date().toISOString(), ...(by ? { updated_by: by.slice(0, 100) } : {}) };
    await setDoc(doc(db, `users/${uid}/buildings/${buildingId}/data/floor_plan`), JSON.parse(JSON.stringify(body)));
  }, [uid, buildingId]);

  return { plan, saved: !!current?.plan, loading: !!key && !current, save };
}
