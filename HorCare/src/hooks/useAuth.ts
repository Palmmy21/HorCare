import { useState, useEffect, useCallback } from 'react';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    updateProfile,
    sendPasswordResetEmail,
    sendEmailVerification,
    setPersistence,
    browserLocalPersistence,
    type User
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import type { UserProfile, Building, DormConfig, InitialBuildingConfig } from '../types';
import { isHousekeeperUid } from './useHousekeepers';


export function useAuth() {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Tracked in state (not read off `user` directly) so a manual reload() after
    // the tenant clicks the verify link can flip the gate without a full reload.
    const [emailVerified, setEmailVerified] = useState(false);

    // Listen to auth state
    useEffect(() => {
        let profileUnsubscribe: (() => void) | null = null;

        const unsubscribe = onAuthStateChanged(auth, async (rawUser) => {
            // A housekeeper's sign-in (custom token, `hk_…`) is not an owner account: no profile is created or read
            // for it, and the app runs it as a housekeeper session (App.tsx), never as an owner or staff member.
            const firebaseUser = rawUser && isHousekeeperUid(rawUser.uid) ? null : rawUser;
            setUser(firebaseUser);
            setEmailVerified(firebaseUser?.emailVerified ?? false);
            // Always unsubscribe old profile listener first to prevent leaks
            if (profileUnsubscribe) {
                profileUnsubscribe();
                profileUnsubscribe = null;
            }
            if (firebaseUser) {
                // Subscribe to user profile changes
                const { onSnapshot, doc } = await import('firebase/firestore');
                profileUnsubscribe = onSnapshot(
                    doc(db, 'users', firebaseUser.uid),
                    async (docSnap) => {
                        if (docSnap.exists()) {
                            setProfile(docSnap.data() as UserProfile);
                        } else {
                            // Profile missing — create it now (handles incomplete signups & legacy users)
                            const fallback: UserProfile = {
                                uid: firebaseUser.uid,
                                email: firebaseUser.email ?? '',
                                display_name: firebaseUser.displayName ?? firebaseUser.email?.split('@')[0] ?? '',
                                license: 'free',
                                access_until: 0,
                                created_at: firebaseUser.metadata.creationTime ?? new Date().toISOString(),
                            };
                            try {
                                await setDoc(doc(db, 'users', firebaseUser.uid), fallback);
                            } catch (e) {
                                console.warn('Auto-create profile failed:', e);
                                setProfile(fallback);
                            }
                        }
                    },
                    (error) => {
                        // Silently handle permission errors (e.g. user just signed out)
                        if (error.code !== 'permission-denied') {
                            console.error('Profile listener error:', error);
                        }
                    }
                );
            } else {
                setProfile(null);
            }
            setLoading(false);
        });

        return () => {
            unsubscribe();
            if (profileUnsubscribe) profileUnsubscribe();
        };
    }, []);

    // Register
    const register = useCallback(async (
        email: string,
        password: string,
        displayName: string,
        initialBuilding?: InitialBuildingConfig
    ) => {
        setError(null);
        try {
            await setPersistence(auth, browserLocalPersistence);
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(cred.user, { displayName });

            // ส่งอีเมลยืนยันผ่าน Resend (ไม่ตกสแปม) — best-effort ถ้าพลาดก็ให้สมัครต่อได้
            try {
                const idToken = await cred.user.getIdToken();
                await fetch('/api/send-verify-email', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                });
                localStorage.setItem('horcare_verify_sent_at', Date.now().toString());
            } catch (e) {
                console.warn('send-verify-email on register failed:', (e as Error).message);
            }

            // Create user profile in Firestore — free plan, no expiry
            const userProfile: UserProfile = {
                uid: cred.user.uid,
                email,
                display_name: displayName,
                license: 'free',
                access_until: 0, // 0 = no expiry (Firestore rules treat this as permanent)
                created_at: new Date().toISOString(),
                ...(initialBuilding?.phone ? { phone: initialBuilding.phone.replace(/\D/g, '') || initialBuilding.phone } : {}),
                ...(initialBuilding?.referral_sources ? { referral_sources: initialBuilding.referral_sources } : {}),
            };

            await setDoc(doc(db, 'users', cred.user.uid), userProfile);
            setProfile(userProfile);

            // Initialize the user's first building with their configured initial values
            const buildingId = `building_${Date.now()}`;
            const dormName = initialBuilding?.dorm_name?.trim() || 'หอพักหลัก';
            const newBuilding: Building = {
                id: buildingId,
                name: dormName,
                created_at: new Date().toISOString(),
                order: 0,
            };
            await setDoc(doc(db, `users/${cred.user.uid}/buildings`, buildingId), newBuilding);

            const configData: DormConfig = {
                building_type: initialBuilding?.building_type || 'dormitory',
                electricity_rate: Number(initialBuilding?.electricity_rate) || 8,
                water_config: initialBuilding?.water_config || { type: 'normal', unit_rate: 18 },
                room_rent: Number(initialBuilding?.room_rent) || 3500,
                bill_customization: {
                    dorm_name: dormName,
                    dorm_address: '',
                    dorm_phone: initialBuilding?.phone || '',
                    footer_text: 'กรุณาชำระภายในวันที่กำหนด ขอบคุณครับ',
                    due_day: Number(initialBuilding?.due_day) || 5,
                    default_language: 'th',
                    bilingual_mode: false,
                    secondary_language: 'en',
                },
            };
            await setDoc(doc(db, `users/${cred.user.uid}/buildings/${buildingId}/data/config`), configData);

            return cred.user;
        } catch (err: unknown) {
            const firebaseErr = err as { code?: string; message?: string };
            if (firebaseErr.code === 'auth/email-already-in-use') {
                setError('อีเมลนี้ถูกใช้แล้ว');
            } else if (firebaseErr.code === 'auth/weak-password') {
                setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
            } else if (firebaseErr.code === 'auth/invalid-email') {
                setError('อีเมลไม่ถูกต้อง');
            } else {
                setError(firebaseErr.message || 'เกิดข้อผิดพลาด');
            }
            throw err;
        }
    }, []);

    // Login
    const login = useCallback(async (email: string, password: string) => {
        setError(null);
        try {
            await setPersistence(auth, browserLocalPersistence);
            const cred = await signInWithEmailAndPassword(auth, email, password);

            // Load profile
            const profileDoc = await getDoc(doc(db, 'users', cred.user.uid));
            if (profileDoc.exists()) {
                setProfile(profileDoc.data() as UserProfile);
            }

            return cred.user;
        } catch (err: unknown) {
            const firebaseErr = err as { code?: string; message?: string };
            if (firebaseErr.code === 'auth/user-not-found' || firebaseErr.code === 'auth/invalid-credential') {
                setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
            } else if (firebaseErr.code === 'auth/wrong-password') {
                setError('รหัสผ่านไม่ถูกต้อง');
            } else {
                setError(firebaseErr.message || 'เกิดข้อผิดพลาด');
            }
            throw err;
        }
    }, []);

    // Logout
    const logout = useCallback(async () => {
        await signOut(auth);
        setProfile(null);
    }, []);

    // ส่งอีเมลยืนยันผ่าน Resend API — หลีกเลี่ยง spam, ส่งจาก domain ตัวเอง
    const sendVerifyEmailViaResend = useCallback(async () => {
        if (!auth.currentUser) throw new Error('not-signed-in');
        const idToken = await auth.currentUser.getIdToken();
        const res = await fetch('/api/send-verify-email', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { error?: string };
            const errMsg = body.error || `HTTP ${res.status}`;
            // Resend domain not configured — fall back to Firebase native email
            if (errMsg.toLowerCase().includes('allowlist') || errMsg.toLowerCase().includes('domain')) {
                await sendEmailVerification(auth.currentUser);
                localStorage.setItem('horcare_verify_sent_at', Date.now().toString());
                return { data: { sent: true } };
            }
            throw new Error(errMsg);
        }
        localStorage.setItem('horcare_verify_sent_at', Date.now().toString());
        return res.json() as Promise<{ data: { sent: boolean; alreadyVerified?: boolean } }>;
    }, []);

    // เช็คสถานะยืนยันอีเมลใหม่หลังผู้ใช้กดลิงก์ในอีเมล — reload() จาก Firebase
    // แล้วอัปเดต state เพื่อปลดล็อก gate โดยไม่ต้องล็อกอินใหม่. คืน true ถ้ายืนยันแล้ว
    const refreshEmailVerified = useCallback(async (): Promise<boolean> => {
        if (!auth.currentUser) return false;
        await auth.currentUser.reload();
        const verified = auth.currentUser.emailVerified;
        setEmailVerified(verified);
        setUser(auth.currentUser);
        return verified;
    }, []);

    // Reset Password (Forgot Password)
    const resetPassword = useCallback(async (email: string) => {
        setError(null);
        try {
            await sendPasswordResetEmail(auth, email);
        } catch (err: unknown) {
            const firebaseErr = err as { code?: string; message?: string };
            if (firebaseErr.code === 'auth/user-not-found' || firebaseErr.code === 'auth/invalid-email') {
                setError('ไม่พบบัญชีที่ใช้อีเมลนี้');
            } else if (firebaseErr.code === 'auth/too-many-requests') {
                setError('ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
            } else {
                setError(firebaseErr.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
            }
            throw err;
        }
    }, []);

    // Paid plans (monthly_*/yearly_*) are time-boxed by current_period_end.
    // One-time PromptPay payments don't auto-renew, so once the period passes the
    // license MUST lapse — otherwise a single 79฿ payment buys lifetime access.
    // Missing current_period_end on a paid plan is treated as expired (safe default).
    const isPaidPlan = Boolean(
        profile?.license?.startsWith('monthly_') || profile?.license?.startsWith('yearly_')
    );
    const isPaidExpired = isPaidPlan &&
        (!profile?.current_period_end || new Date(profile.current_period_end) < new Date());

    const isLicenseActive =
        profile?.license === 'active' ||
        profile?.license === 'free' ||
        (isPaidPlan && !isPaidExpired);

    // Days left on a paid plan (null when not on a paid plan) — drives the renewal banner
    const licenseDaysLeft = isPaidPlan && profile?.current_period_end
        ? Math.max(0, Math.ceil((new Date(profile.current_period_end).getTime() - Date.now()) / 86400000))
        : null;

    // Ban check — admin sets status: 'banned' in Firestore
    const isBanned = profile?.status === 'banned';

    return {
        user,
        profile,
        loading,
        error,
        emailVerified,
        register,
        login,
        logout,
        resetPassword,
        sendVerifyEmailViaResend,
        refreshEmailVerified,
        isPaidExpired,
        isLicenseActive,
        licenseDaysLeft,
        isBanned,
        setError
    };
}
