import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { JournalEntry, Ledger } from '../shared/ledger';

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

export function useLedgers(ownerUid: string | null) {
  const { list, loading, error } = useLive<Ledger>(ownerUid ? `users/${ownerUid}/ledgers` : null);
  return { ledgers: useMemo(() => [...list].sort((a, b) => a.name.localeCompare(b.name, 'th')), [list]), loading, error };
}

/** All entries of one ledger, newest first. Reports are computed from these in the browser. */
export function useLedgerEntries(ownerUid: string | null, ledgerId: string | null) {
  const { list, loading, error } = useLive<JournalEntry>(ownerUid && ledgerId ? `users/${ownerUid}/ledgers/${ledgerId}/entries` : null);
  const entries = useMemo(() => [...list].sort((a, b) => b.date.localeCompare(a.date) || b.posted_at.localeCompare(a.posted_at)), [list]);
  return { entries, loading, error };
}
