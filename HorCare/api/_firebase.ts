import admin from 'firebase-admin';

if (!admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log('Firebase Admin initialized with SERVICE_ACCOUNT');
        } catch (error) {
            console.error('Error parsing FIREBASE_SERVICE_ACCOUNT', error);
            admin.initializeApp();
        }
    } else {
        admin.initializeApp();
        console.log('Firebase Admin initialized with default credentials');
    }
}

export const db = admin.firestore();
export { admin };
