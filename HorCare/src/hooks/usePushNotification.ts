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
        // Default to enabled if permission granted and not explicitly disabled
        setEnabled(perm === 'granted' && stored !== 'false');
    }, []);

    const requestPermission = useCallback(async (): Promise<NotifPermission> => {
        if (!('Notification' in window)) return 'unsupported';
        setLoading(true);
        try {
            let result: NotificationPermission;
            // Support both modern Promise and legacy callback API
            try {
                result = await Notification.requestPermission();
            } catch {
                result = await new Promise((resolve) => Notification.requestPermission(resolve));
            }

            const perm = result as NotifPermission;
            setPermission(perm);

            if (perm === 'granted') {
                setEnabled(true);
                localStorage.setItem(STORAGE_KEY, 'true');

                // Ensure Service Worker is registered for mobile push notifications (Samsung/Android)
                if ('serviceWorker' in navigator) {
                    try {
                        const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
                        // Fire a confirmation welcome notification
                        setTimeout(async () => {
                            try {
                                await reg.showNotification('HorCare ยินดีต้อนรับ 🎉', {
                                    body: 'คุณเปิดรับการแจ้งเตือนสำเร็จแล้ว!',
                                    icon: '/logo-icon.png?v=2',
                                    badge: '/logo-icon.png?v=2',
                                    // @ts-expect-error vibrate
                                    vibrate: [200, 100, 200],
                                });
                            } catch {
                                // silent fallback
                            }
                        }, 500);
                    } catch (swErr) {
                        console.warn('SW registration on permission grant:', swErr);
                    }
                }
            }
            return perm;
        } finally {
            setLoading(false);
        }
    }, []);

    const toggleEnabled = useCallback((value: boolean) => {
        setEnabled(value);
        localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    }, []);

    const notify = useCallback(async (title: string, options?: NotificationOptions) => {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;

        // Trigger mobile device vibration if in foreground
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try {
                navigator.vibrate([200, 100, 200]);
            } catch {
                // ignore
            }
        }

        const notifOptions: NotificationOptions = {
            icon: '/logo-icon.png?v=2',
            badge: '/logo-icon.png?v=2',
            lang: 'th',
            // @ts-expect-error vibrate is supported in mobile browsers
            vibrate: [200, 100, 200],
            renotify: true,
            requireInteraction: false,
            ...options,
        };

        // On Android / Samsung Internet: new Notification() is forbidden in window context.
        // We MUST use ServiceWorkerRegistration.showNotification().
        if ('serviceWorker' in navigator) {
            try {
                let reg: ServiceWorkerRegistration | null | undefined = null;
                try {
                    reg = await Promise.race([
                        navigator.serviceWorker.ready,
                        new Promise<null>((r) => setTimeout(() => r(null), 1000)),
                    ]);
                } catch {
                    reg = null;
                }

                if (!reg) {
                    reg = await navigator.serviceWorker.getRegistration();
                }
                if (!reg) {
                    reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
                }
                if (reg) {
                    await reg.showNotification(title, notifOptions);
                    return;
                }
            } catch (swErr) {
                console.warn('ServiceWorker showNotification failed, trying desktop fallback:', swErr);
            }
        }

        // Desktop fallback for browsers where window Notification constructor is allowed
        try {
            new Notification(title, notifOptions);
        } catch {
            // ignore if blocked by OS policy
        }
    }, []);

    const testNotification = useCallback(async () => {
        // Play notification sound
        try {
            const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            const ctx = new AudioContextClass();
            const now = ctx.currentTime;
            [880, 1100].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, now + i * 0.18);
                gain.gain.linearRampToValueAtTime(0.28, now + i * 0.18 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.35);
                osc.start(now + i * 0.18);
                osc.stop(now + i * 0.18 + 0.35);
            });
        } catch {
            // silent fallback
        }

        await notify('HorCare ทดสอบการแจ้งเตือน 🎉', {
            body: 'ระบบแจ้งเตือนทำงานได้สมบูรณ์แล้ว!',
            tag: 'horcare-test-' + Date.now(),
        });
    }, [notify]);

    return {
        permission,
        enabled,
        loading,
        requestPermission,
        toggleEnabled,
        notify,
        testNotification,
    };
}
