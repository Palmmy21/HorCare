import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase/config';
import { apiPost } from '../utils/api';
import type { AlertPrefs, AlertType, InboxItem } from '../shared/alerts';

const SEEN_KEY = (uid: string) => `horcare_inbox_seen_${uid}`;
const INBOX_SIZE = 40;

export interface Inbox {
    items: InboxItem[];
    /** Entries newer than the last time the list was opened on this device. */
    unread: number;
    /** Entries that arrived while the app was open, newest first: what a toast is shown for. */
    fresh: InboxItem[];
    dismissFresh: (id: string) => void;
    markAllSeen: () => void;
    prefs: AlertPrefs;
    /** Switch one kind (or `push`) on or off; saved for this account on the server. */
    setPref: (key: AlertType | 'push', value: boolean) => void;
}

/**
 * This account's alerts, live. The server writes `users/{uid}/inbox`; listening to it is what makes an alert appear the
 * moment it happens, with no reload. `uid` null = nobody signed in with an inbox (nothing is listened to).
 */
export function useInbox(uid: string | null): Inbox {
    const [items, setItems] = useState<InboxItem[]>([]);
    const [fresh, setFresh] = useState<InboxItem[]>([]);
    const [seenAt, setSeenAt] = useState('');
    const [prefs, setPrefs] = useState<AlertPrefs>({});
    const known = useRef<Set<string> | null>(null);

    useEffect(() => {
        known.current = null;
        if (!uid) return;
        let stored = '';
        try { stored = localStorage.getItem(SEEN_KEY(uid)) ?? ''; } catch { /* storage blocked: everything counts as unread */ }
        setSeenAt(stored); // eslint-disable-line react-hooks/set-state-in-effect
        apiPost<{ prefs: AlertPrefs }>('alerts', { action: 'prefs_get' }).then(r => setPrefs(r.prefs ?? {})).catch(() => undefined);

        const q = query(collection(db, `users/${uid}/inbox`), orderBy('created_at', 'desc'), limit(INBOX_SIZE));
        return onSnapshot(q, snap => {
            const next = snap.docs.map(d => d.data() as InboxItem);
            setItems(next);
            if (known.current === null) {
                // what was already there when the app opened is history, not news
                known.current = new Set(next.map(i => i.id));
                return;
            }
            const arrived = next.filter(i => !known.current!.has(i.id));
            for (const i of arrived) known.current.add(i.id);
            if (arrived.length > 0) setFresh(prev => [...arrived, ...prev].slice(0, 4));
        }, () => { /* no access (signed out, banned): show nothing */ setItems([]); });
    }, [uid]);

    const unread = useMemo(() => items.filter(i => i.created_at > seenAt).length, [items, seenAt]);

    const markAllSeen = useCallback(() => {
        const now = new Date().toISOString();
        setSeenAt(now);
        if (uid) { try { localStorage.setItem(SEEN_KEY(uid), now); } catch { /* storage blocked */ } }
    }, [uid]);

    const dismissFresh = useCallback((id: string) => setFresh(prev => prev.filter(i => i.id !== id)), []);

    const setPref = useCallback((key: AlertType | 'push', value: boolean) => {
        setPrefs(prev => {
            const next = { ...prev, [key]: value };
            apiPost('alerts', { action: 'prefs_set', prefs: next }).catch(() => undefined);
            return next;
        });
    }, []);

    return { items, unread, fresh, dismissFresh, markAllSeen, prefs, setPref };
}
