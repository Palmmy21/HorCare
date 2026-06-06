import admin from 'firebase-admin';

if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        // Fail loud instead of silently falling back to default creds
        // (which surfaces later as a confusing Firestore PERMISSION_DENIED).
        throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    }

    let serviceAccount: admin.ServiceAccount;
    try {
        serviceAccount = JSON.parse(raw);
    } catch (error) {
        throw new Error(
            'FIREBASE_SERVICE_ACCOUNT is not valid JSON: ' + (error as Error).message
        );
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase Admin initialized for project:', (serviceAccount as { project_id?: string }).project_id);
}

export const db = admin.firestore();
export { admin };
