import { useEffect, useRef, useState } from 'react';
import { getToken, onMessage } from 'firebase/messaging';
import { messagingPromise, firebaseConfig } from '../firebase/config';
import { apiPost } from '../utils/api';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
const SW_PATH = '/firebase-messaging-sw.js';

async function registerFCMServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null;
    try {
        // Use dedicated scope so it does not overwrite the root PWA Service Worker (VitePWA /sw.js)
        const reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/firebase-cloud-messaging-push-scope' });
        // Pass Firebase config to SW so it can init without bundler
        if (reg.active) {
            reg.active.postMessage({ type: 'FIREBASE_CONFIG', config: firebaseConfig });
        } else {
            const sw = reg.installing || reg.waiting;
            if (sw) {
                sw.addEventListener('statechange', () => {
                    if (sw.state === 'activated') {
                        sw.postMessage({ type: 'FIREBASE_CONFIG', config: firebaseConfig });
                    }
                });
            }
        }
        return reg;
    } catch {
        return null;
    }
}

/**
 * Register this device for notifications that arrive with the app closed. `permission` is passed so that the moment
 * the person allows notifications (from the bell), the device registers — without waiting for the next visit.
 */
export function useFCMToken(uid: string | null, permission?: string) {
    const [token, setToken] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const savedRef = useRef<string | null>(null);

    useEffect(() => {
        if (!uid || !VAPID_KEY) return;
        if (!('Notification' in window) || Notification.permission === 'denied') return;

        let cancelled = false;

        async function init() {
            try {
                const messaging = await messagingPromise;
                if (!messaging || cancelled) return;

                const swReg = await registerFCMServiceWorker();
                if (!swReg || cancelled) return;

                const fcmToken = await getToken(messaging, {
                    vapidKey: VAPID_KEY,
                    serviceWorkerRegistration: swReg,
                });

                if (cancelled || !fcmToken) return;
                setToken(fcmToken);

                // Persist token (upsert) so the backend can push to this device
                if (savedRef.current !== fcmToken) {
                    savedRef.current = fcmToken;
                    // Through the server, not straight to the database: the rules only let an account with its own
                    // active plan write here, which a staff account (accounting, front desk, …) never has.
                    await apiPost('alerts', { action: 'token_save', token: fcmToken, ua: navigator.userAgent.slice(0, 100) });
                }

                // Foreground messages — show system notification while app is open
                onMessage(messaging, async (payload) => {
                    if (cancelled) return;
                    const title = payload.notification?.title || 'HorCare';
                    const body  = payload.notification?.body  || '';
                    const url   = (payload.data as Record<string, string>)?.url || '/';
                    if (Notification.permission === 'granted') {
                        try {
                            if (swReg) {
                                await swReg.showNotification(title, {
                                    body,
                                    icon: '/logo-icon.png?v=2',
                                    badge: '/logo-icon.png?v=2',
                                    data: { url },
                                    // @ts-expect-error — vibrate is valid in mobile browsers
                                    vibrate: [200, 100, 200],
                                });
                                return;
                            }
                        } catch {
                            // Fallback to desktop Notification if SW fails
                        }

                        try {
                            const n = new Notification(title, {
                                body,
                                icon: '/logo-icon.png?v=2',
                                badge: '/logo-icon.png?v=2',
                            });
                            n.onclick = () => { n.close(); window.focus(); window.location.href = url; };
                        } catch {
                            // silent
                        }
                    }
                });
            } catch (e: unknown) {
                if (!cancelled) setError((e as Error)?.message ?? String(e));
            }
        }

        init();
        return () => { cancelled = true; };
    }, [uid, permission]);

    return { token, error };
}
