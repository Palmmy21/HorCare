import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { Announcement, FaqEntry } from '../shared/chatbot';

/** Live list of one per-property collection (read-only; writes go through the API). */
function useLive<T>(ownerUid: string | null, buildingId: string | null, name: string) {
  const key = ownerUid && buildingId ? `${ownerUid}/${buildingId}` : '';
  const [snap, setSnap] = useState<{ key: string; list: T[]; error: boolean } | null>(null);

  useEffect(() => {
    if (!key) return;
    const [o, b] = key.split('/');
    return onSnapshot(
      collection(db, `users/${o}/buildings/${b}/${name}`),
      s => setSnap({ key, list: s.docs.map(d => d.data() as T), error: false }),
      () => setSnap({ key, list: [], error: true }),
    );
  }, [key, name]);

  const cur = snap && snap.key === key ? snap : null;
  return { list: cur?.list ?? [], loading: !!key && cur === null, error: cur?.error ?? false };
}

export function useFaqs(ownerUid: string | null, buildingId: string | null) {
  const { list, loading, error } = useLive<FaqEntry>(ownerUid, buildingId, 'faqs');
  const faqs = useMemo(() => [...list].sort((a, b) => a.created_at.localeCompare(b.created_at)), [list]);
  return { faqs, loading, error };
}

export function useAnnouncements(ownerUid: string | null, buildingId: string | null) {
  const { list, loading, error } = useLive<Announcement>(ownerUid, buildingId, 'announcements');
  const announcements = useMemo(
    () => [...list].sort((a, b) => Number(b.status === 'published') - Number(a.status === 'published') || b.created_at.localeCompare(a.created_at)),
    [list],
  );
  return { announcements, loading, error };
}
