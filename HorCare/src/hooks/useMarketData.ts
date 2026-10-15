import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { ShopClosure, WalkIn } from '../shared/market';

function useLive<T>(ownerUid: string | null, buildingId: string | null, name: string) {
  const key = ownerUid && buildingId ? `${ownerUid}/${buildingId}` : '';
  const [snap, setSnap] = useState<{ key: string; list: T[]; error: string | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    const [o, b] = key.split('/');
    return onSnapshot(
      collection(db, `users/${o}/buildings/${b}/${name}`),
      s => setSnap({ key, list: s.docs.map(d => d.data() as T), error: null }),
      // surface it: an empty list here used to look exactly like "nothing was submitted"
      e => { console.error(`[market] read ${name} failed`, e); setSnap({ key, list: [], error: (e as { code?: string }).code ?? e.message }); },
    );
  }, [key, name]);

  const cur = snap && snap.key === key ? snap : null;
  return { list: cur?.list ?? [], loading: !!key && cur === null, error: cur?.error ?? null };
}

export function useShopClosures(ownerUid: string | null, buildingId: string | null) {
  const { list, loading, error } = useLive<ShopClosure>(ownerUid, buildingId, 'shop_closures');
  return { closures: useMemo(() => list, [list]), loading, error };
}

export function useWalkIns(ownerUid: string | null, buildingId: string | null) {
  const { list, loading, error } = useLive<WalkIn>(ownerUid, buildingId, 'walk_ins');
  const walkIns = useMemo(() => [...list].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)), [list]);
  return { walkIns, loading, error };
}
