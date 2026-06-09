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

    const projectId = (serviceAccount as { project_id?: string }).project_id;
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        // Needed for slip-image uploads via admin.storage().bucket()
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
    });
    console.log('Firebase Admin initialized for project:', projectId);
}

export const db = admin.firestore();
export { admin };
