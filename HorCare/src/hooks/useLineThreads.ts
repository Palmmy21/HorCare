import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { LineMessage, LineThread } from '../shared/messages';

/** Live LINE conversations for one property, newest first (read-only; sending goes through /api/line-inbox). */
export function useLineThreads(ownerUid: string | null, buildingId: string | null) {
  const key = ownerUid && buildingId ? `${ownerUid}/${buildingId}` : '';
  const [snap, setSnap] = useState<{ key: string; threads: LineThread[]; error: string | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    const [o, b] = key.split('/');
    const q = query(collection(db, `users/${o}/buildings/${b}/line_threads`), orderBy('last_message_at', 'desc'), limit(200));
    return onSnapshot(
      q,
      s => setSnap({ key, threads: s.docs.map(d => d.data() as LineThread), error: null }),
      err => setSnap({ key, threads: [], error: err.code === 'permission-denied' ? 'คุณไม่มีสิทธิ์ดูข้อความ' : 'โหลดข้อความไม่สำเร็จ' }),
    );
  }, [key]);

  const cur = snap && snap.key === key ? snap : null;
  const threads = cur?.threads ?? [];
  return {
    threads,
    unreadTotal: threads.reduce((n, t) => n + (t.unread_count || 0), 0),
    loading: !!key && cur === null,
    error: cur?.error ?? null,
  };
}

/** Live messages of one conversation, oldest first. */
export function useThreadMessages(ownerUid: string | null, buildingId: string | null, lineUserId: string | null) {
  const key = ownerUid && buildingId && lineUserId ? `${ownerUid}/${buildingId}/${lineUserId}` : '';
  const [snap, setSnap] = useState<{ key: string; messages: LineMessage[] } | null>(null);

  useEffect(() => {
    if (!key) return;
    const [o, b, l] = key.split('/');
    const q = query(collection(db, `users/${o}/buildings/${b}/line_threads/${l}/messages`), orderBy('at', 'asc'), limit(300));
    return onSnapshot(q, s => setSnap({ key, messages: s.docs.map(d => d.data() as LineMessage) }), () => setSnap({ key, messages: [] }));
  }, [key]);

  const cur = snap && snap.key === key ? snap : null;
  return { messages: cur?.messages ?? [], loading: !!key && cur === null };
}
