import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { BankTransaction } from '../shared/reconciliation';

/** Live bank transactions for one property, newest first (read-only; writes go through /api/reconciliation). */
export function useBankTransactions(ownerUid: string | null, buildingId: string | null) {
  const key = ownerUid && buildingId ? `${ownerUid}/${buildingId}` : '';
  const [snap, setSnap] = useState<{ key: string; list: BankTransaction[]; error: boolean } | null>(null);

  useEffect(() => {
    if (!key) return;
    const [o, b] = key.split('/');
    return onSnapshot(
      collection(db, `users/${o}/buildings/${b}/bank_transactions`),
      s => setSnap({ key, list: s.docs.map(d => d.data() as BankTransaction), error: false }),
      () => setSnap({ key, list: [], error: true }),
    );
  }, [key]);

  const cur = snap && snap.key === key ? snap : null;
  const transactions = useMemo(
    () => [...(cur?.list ?? [])].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    [cur],
  );
  return { transactions, loading: !!key && cur === null, error: cur?.error ?? false };
}
