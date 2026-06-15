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
import type { UserProfile } from '../types';

const TRIAL_DAYS = 60;

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

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
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
                    (docSnap) => {
                        if (docSnap.exists()) {
                            setProfile(docSnap.data() as UserProfile);
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
    const register = useCallback(async (email: string, password: string, displayName: string) => {
        setError(null);
        try {
            await setPersistence(auth, browserLocalPersistence);
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(cred.user, { displayName });

            // ส่งอีเมลยืนยันตัวตน — กันสมัครด้วยอีเมลปลอม + กันเปิดหลายบัญชีรับ trial ฟรี.
            // best-effort: ถ้าส่งพลาด (เช่นโดน rate-limit) ก็ยังให้สมัครต่อได้ แล้วกดส่งซ้ำที่หน้า gate
            try {
                await sendEmailVerification(cred.user);
            } catch (e) {
                console.warn('sendEmailVerification on register failed:', (e as Error).message);
            }

            // Create user profile in Firestore
            const trialExpires = new Date();
            trialExpires.setDate(trialExpires.getDate() + TRIAL_DAYS);

            const userProfile: UserProfile = {
                uid: cred.user.uid,
                email,
                display_name: displayName,
                license: 'trial',
                trial_expires_at: trialExpires.toISOString(),
                access_until: trialExpires.getTime(), // server-enforced expiry (Firestore rules)
                created_at: new Date().toISOString()
            };

            await setDoc(doc(db, 'users', cred.user.uid), userProfile);
            setProfile(userProfile);

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

    // ส่งอีเมลยืนยันซ้ำ (เรียกจากหน้า gate) — โยน error code ให้ผู้เรียกแสดงข้อความเอง
    const resendVerification = useCallback(async () => {
        if (!auth.currentUser) throw new Error('not-signed-in');
        await sendEmailVerification(auth.currentUser);
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

    // Check if trial is expired — treat missing trial_expires_at as expired (safe default)
    const isTrialExpired = profile?.license === 'trial' &&
        (!profile.trial_expires_at || new Date(profile.trial_expires_at) < new Date());

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
        (profile?.license === 'trial' && !isTrialExpired) ||
        (isPaidPlan && !isPaidExpired);

    // Days left on a paid plan (null when not on a paid plan) — drives the renewal banner
    const licenseDaysLeft = isPaidPlan && profile?.current_period_end
        ? Math.max(0, Math.ceil((new Date(profile.current_period_end).getTime() - Date.now()) / 86400000))
        : null;

    // Days remaining in trial
    const trialDaysLeft = profile?.license === 'trial'
        ? Math.max(0, Math.ceil((new Date(profile.trial_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
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
        resendVerification,
        refreshEmailVerified,
        isTrialExpired,
        isPaidExpired,
        isLicenseActive,
        trialDaysLeft,
        licenseDaysLeft,
        isBanned,
        setError
    };
}
