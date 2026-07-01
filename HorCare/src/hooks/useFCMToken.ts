import { useEffect, useRef, useState } from 'react';
import { getToken, onMessage } from 'firebase/messaging';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { messagingPromise, firebaseConfig } from '../firebase/config';
import { db } from '../firebase/config';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
const SW_PATH = '/firebase-messaging-sw.js';

async function registerFCMServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null;
    try {
        // Use the dedicated FCM SW (separate from the PWA SW so they don't conflict)
        const reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
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

export function useFCMToken(uid: string | null) {
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
                    const tokenDocRef = doc(db, `users/${uid}/data/fcm`);
                    const deviceKey = btoa(fcmToken.slice(-32)).replace(/[^a-z0-9]/gi, '').slice(0, 20);
                    await setDoc(tokenDocRef, {
                        [`tokens.${deviceKey}`]: {
                            token: fcmToken,
                            updated_at: serverTimestamp(),
                            ua: navigator.userAgent.slice(0, 100),
                        }
                    }, { merge: true });
                }

                // Foreground messages — show system notification while app is open
                onMessage(messaging, (payload) => {
                    if (cancelled) return;
                    const title = payload.notification?.title || 'HorCare';
                    const body  = payload.notification?.body  || '';
                    const url   = (payload.data as any)?.url || '/';
                    if (Notification.permission === 'granted') {
                        const n = new Notification(title, {
                            body,
                            icon: '/logo-icon.png',
                            badge: '/logo-icon.png',
                            // @ts-ignore — vibrate is valid in mobile browsers
                            vibrate: [200, 100, 200],
                        });
                        n.onclick = () => { n.close(); window.focus(); window.location.href = url; };
                    }
                });
            } catch (e: any) {
                if (!cancelled) setError(e.message);
            }
        }

        init();
        return () => { cancelled = true; };
    }, [uid]);

    return { token, error };
}
