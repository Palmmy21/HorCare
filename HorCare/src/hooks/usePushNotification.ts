import { useState, useEffect, useCallback } from 'react';

export type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported';

const STORAGE_KEY = 'horcare_notif_enabled';

export function usePushNotification() {
    const [permission, setPermission] = useState<NotifPermission>('default');
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!('Notification' in window)) {
            setPermission('unsupported');
            return;
        }
        const perm = Notification.permission as NotifPermission;
        setPermission(perm);
        const stored = localStorage.getItem(STORAGE_KEY);
        setEnabled(perm === 'granted' && stored === 'true');
    }, []);

    const requestPermission = useCallback(async (): Promise<NotifPermission> => {
        if (!('Notification' in window)) return 'unsupported';
        setLoading(true);
        try {
            const result = await Notification.requestPermission() as NotifPermission;
            setPermission(result);
            if (result === 'granted') {
                setEnabled(true);
                localStorage.setItem(STORAGE_KEY, 'true');
            }
            return result;
        } finally {
            setLoading(false);
        }
    }, []);

    const toggleEnabled = useCallback((value: boolean) => {
        setEnabled(value);
        localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    }, []);

    const notify = useCallback((title: string, options?: NotificationOptions) => {
        if (permission !== 'granted' || !enabled) return;
        try {
            new Notification(title, {
                icon: '/logo.png',
                badge: '/logo.png',
                lang: 'th',
                ...options
            });
        } catch {
            // ignore if notifications blocked at OS level
        }
    }, [permission, enabled]);

    return { permission, enabled, loading, requestPermission, toggleEnabled, notify };
}
