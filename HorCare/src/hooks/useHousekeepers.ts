import { useEffect, useState, useCallback, useRef } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { auth, db } from '../firebase/config';
import { apiPost } from '../utils/api';
import type { Housekeeper, HousekeeperSession } from '../types';

/**
 * Housekeeper accounts of one building. Reading is straight from Firestore (the records hold no passcode);
 * every change goes through /api/housekeepers, which hashes passcodes server-side and ends open sessions when
 * a passcode changes or an account is switched off.
 */
export function useHousekeepers(
  uid: string | null,
  buildingId: string | null,
) {
  const [housekeepers, setHousekeepers] = useState<Housekeeper[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Loading only while there is something to load; with no property selected there is nothing to wait for. */
  const loading = !!(uid && buildingId) && !loaded;
  const migratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!uid || !buildingId) return;

    const col = collection(db, `users/${uid}/buildings/${buildingId}/housekeepers`);
    const unsub = onSnapshot(
      col,
      snap => {
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as Housekeeper & { passcode?: string }));
        // Records from older versions still hold a readable passcode: have the server strip it (once per building).
        // Those housekeepers then need a new passcode, which the list shows.
        if (docs.some(d => d.passcode !== undefined) && migratedRef.current !== `${uid}/${buildingId}`) {
          migratedRef.current = `${uid}/${buildingId}`;
          apiPost('housekeepers', { action: 'migrate', owner_uid: uid, building_id: buildingId })
            .catch(err => console.warn('housekeeper passcode migration failed:', err));
        }
        const list: Housekeeper[] = docs.map(d => {
          const rest: Housekeeper & { passcode?: string } = { ...d };
          delete rest.passcode;
          return rest;
        });
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setHousekeepers(list);
        setLoaded(true);
      },
      err => {
        console.error('Housekeepers onSnapshot error:', err);
        setLoaded(true);
      }
    );

    return unsub;
  }, [uid, buildingId]);

  const call = useCallback((body: Record<string, unknown>) => {
    if (!uid || !buildingId) return Promise.reject(new Error('no_property'));
    return apiPost<{ ok: boolean; id?: string }>('housekeepers', { ...body, owner_uid: uid, building_id: buildingId });
  }, [uid, buildingId]);

  const addHousekeeper = useCallback(async (data: {
    name: string;
    phone: string;
    passcode: string;
    notes?: string;
    is_active?: boolean;
    buildingName?: string;
  }) => {
    const res = await call({
      action: 'upsert', name: data.name.trim(), phone: data.phone, passcode: data.passcode.trim(),
      notes: data.notes?.trim() || '', is_active: data.is_active !== false, building_name: data.buildingName || '',
    });
    return res.id;
  }, [call]);

  /** `passcode` empty or absent keeps the current one. */
  const updateHousekeeper = useCallback(async (
    maidId: string,
    updates: { name: string; phone: string; passcode?: string; notes?: string; is_active?: boolean },
    buildingName?: string
  ) => {
    await call({
      action: 'upsert', maid_id: maidId, name: updates.name.trim(), phone: updates.phone,
      passcode: updates.passcode?.trim() || '', notes: updates.notes?.trim() || '',
      is_active: updates.is_active !== false, building_name: buildingName || '',
    });
  }, [call]);

  const deleteHousekeeper = useCallback(async (maidId: string) => {
    await call({ action: 'delete', maid_id: maidId });
  }, [call]);

  return {
    housekeepers,
    loading,
    addHousekeeper,
    updateHousekeeper,
    deleteHousekeeper,
  };
}

const LOGIN_ERRORS: Record<string, string> = {
  invalid_credentials: 'เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง',
  passcode_reset_required: 'ระบบเปลี่ยนวิธีเก็บรหัสผ่านแล้ว กรุณาขอรหัสใหม่จากเจ้าของหอพัก',
  account_disabled: 'บัญชีแม่บ้านนี้ถูกปิดใช้งานชั่วคราว',
  too_many_attempts: 'ลองรหัสผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่',
};

/**
 * Housekeeper sign-in (login page). The server checks the passcode and returns a Firebase custom token limited to
 * one building; Firestore rules then allow only that building's housekeeping data.
 */
export async function authenticateHousekeeper(phone: string, passcode: string): Promise<HousekeeperSession> {
  const cleanPhone = phone.replace(/\D/g, '');
  if (!cleanPhone || !passcode.trim()) {
    throw new Error('กรุณากรอกเบอร์โทรศัพท์และรหัสผ่าน');
  }

  const res = await fetch('/api/housekeepers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', phone: cleanPhone, passcode: passcode.trim() }),
  });
  const data = await res.json().catch(() => ({})) as { error?: string; token?: string; session?: HousekeeperSession };
  if (!res.ok || !data.token || !data.session) {
    throw new Error(LOGIN_ERRORS[data.error ?? ''] ?? 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
  }

  await signInWithCustomToken(auth, data.token);
  localStorage.setItem('horcare_maid_session', JSON.stringify(data.session));
  return data.session;
}

/** End a housekeeper session (also signs the custom-token user out of Firebase). */
export async function signOutHousekeeper() {
  localStorage.removeItem('horcare_maid_session');
  if (auth.currentUser && isHousekeeperUid(auth.currentUser.uid)) await signOut(auth);
}

/** Housekeepers sign in as `hk_…` users (see api/_housekeepers.ts); they are never owners or staff. */
export function isHousekeeperUid(uid: string | null | undefined): boolean {
  return !!uid && uid.startsWith('hk_');
}
