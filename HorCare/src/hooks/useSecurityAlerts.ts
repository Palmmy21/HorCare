import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { openAlertCount, sortAlerts, type SecurityAlert } from '../shared/security-alerts';

export type PropertyAlert = SecurityAlert & { building_id: string };

/** Live security alerts for the given properties (read-only; acknowledging goes through the API). */
export function useSecurityAlerts(ownerUid: string | null, buildingIds: string[]) {
  const idsKey = buildingIds.join('|');
  const [byBuilding, setByBuilding] = useState<Record<string, SecurityAlert[]>>({});

  useEffect(() => {
    if (!ownerUid || !idsKey) return;
    const ids = idsKey.split('|');
    const unsubs = ids.map(bid => onSnapshot(
      collection(db, `users/${ownerUid}/buildings/${bid}/security_alerts`),
      s => setByBuilding(prev => ({ ...prev, [bid]: s.docs.map(d => ({ ...(d.data() as SecurityAlert), id: d.id })) })),
      () => setByBuilding(prev => ({ ...prev, [bid]: [] })),
    ));
    return () => unsubs.forEach(u => u());
  }, [ownerUid, idsKey]);

  const alerts = useMemo<PropertyAlert[]>(() => {
    const ids = idsKey ? idsKey.split('|') : [];
    return sortAlerts(ids.flatMap(bid => (byBuilding[bid] ?? []).map(a => ({ ...a, building_id: bid }))));
  }, [byBuilding, idsKey]);

  return { alerts, openCount: openAlertCount(alerts) };
}
