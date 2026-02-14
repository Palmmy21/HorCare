import { useState, useEffect, useCallback } from 'react';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    updateProfile,
    type User
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import type { UserProfile } from '../types';

const TRIAL_DAYS = 30;

export function useAuth() {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Listen to auth state
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setUser(firebaseUser);
            if (firebaseUser) {
                // Load user profile from Firestore
                try {
                    const profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
                    if (profileDoc.exists()) {
                        setProfile(profileDoc.data() as UserProfile);
                    }
                } catch (err) {
                    console.error('Error loading profile:', err);
                }
            } else {
                setProfile(null);
            }
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    // Register
    const register = useCallback(async (email: string, password: string, displayName: string) => {
        setError(null);
        try {
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(cred.user, { displayName });

            // Create user profile in Firestore
            const trialExpires = new Date();
            trialExpires.setDate(trialExpires.getDate() + TRIAL_DAYS);

            const userProfile: UserProfile = {
                uid: cred.user.uid,
                email,
                display_name: displayName,
                license: 'trial',
                trial_expires_at: trialExpires.toISOString(),
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

    // Check if trial is expired
    const isTrialExpired = profile?.license === 'trial' &&
        new Date(profile.trial_expires_at) < new Date();

    const isLicenseActive = profile?.license === 'active' ||
        (profile?.license === 'trial' && !isTrialExpired);

    // Days remaining in trial
    const trialDaysLeft = profile?.license === 'trial'
        ? Math.max(0, Math.ceil((new Date(profile.trial_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : null;

    return {
        user,
        profile,
        loading,
        error,
        register,
        login,
        logout,
        isTrialExpired,
        isLicenseActive,
        trialDaysLeft,
        setError
    };
}
