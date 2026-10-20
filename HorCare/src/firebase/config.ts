import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, persistentLocalCache } from 'firebase/firestore';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getMessaging, isSupported } from 'firebase/messaging';

export const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// ── Environments (NFR-10): local development must not touch production data by default ──
// `npm run dev` refuses to start against a production project unless .env.local says so on purpose
// (VITE_ALLOW_PRODUCTION_IN_DEV=true). Use a staging project, or the local emulators (VITE_FIREBASE_EMULATORS=true).
const PRODUCTION_PROJECT_IDS = ['horcare-8ef92'];
const useEmulators = import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === 'true';
if (import.meta.env.DEV && !useEmulators && PRODUCTION_PROJECT_IDS.includes(firebaseConfig.projectId)
    && import.meta.env.VITE_ALLOW_PRODUCTION_IN_DEV !== 'true') {
    throw new Error(
        `Local development is pointed at the PRODUCTION Firebase project (${firebaseConfig.projectId}). ` +
        'Use a staging project or VITE_FIREBASE_EMULATORS=true in .env.local; ' +
        'set VITE_ALLOW_PRODUCTION_IN_DEV=true only if you really mean to work on live data.',
    );
}

const app = initializeApp(firebaseConfig);

export const db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    // the emulator is wiped between runs; an IndexedDB cache would show stale documents from earlier runs
    localCache: useEmulators ? memoryLocalCache() : persistentLocalCache(),
});
export const auth = getAuth(app);

if (useEmulators) {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
export const storage = getStorage(app);

// Messaging is only available in browsers that support service workers + push
export const messagingPromise = isSupported().then(ok => ok ? getMessaging(app) : null);

export default app;
