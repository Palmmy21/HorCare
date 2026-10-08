import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { BankAccount } from '../shared/banks';

/** Live bank accounts for one property (read-only; writes go through /api/bank-accounts). */
export function useBankAccounts(ownerUid: string | null, buildingId: string | null) {
  const key = ownerUid && buildingId ? `${ownerUid}/${buildingId}` : '';
  const [snap, setSnap] = useState<{ key: string; accounts: BankAccount[]; error: boolean } | null>(null);

  useEffect(() => {
    if (!key) return;
    const [o, b] = key.split('/');
    return onSnapshot(
      collection(db, `users/${o}/buildings/${b}/bank_accounts`),
      s => setSnap({ key, accounts: s.docs.map(d => d.data() as BankAccount), error: false }),
      () => setSnap({ key, accounts: [], error: true }),
    );
  }, [key]);

  const cur = snap && snap.key === key ? snap : null;
  // default first, then active, then by creation time
  const accounts = useMemo(() => [...(cur?.accounts ?? [])].sort((a, b) =>
    Number(b.is_default) - Number(a.is_default) || Number(b.status === 'active') - Number(a.status === 'active') || a.created_at.localeCompare(b.created_at),
  ), [cur]);
  return { accounts, activeAccounts: accounts.filter(a => a.status === 'active'), loading: !!key && cur === null, error: cur?.error ?? false };
}
