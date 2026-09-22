import { useEffect, useState, useCallback } from 'react';
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type { Housekeeper, HousekeeperSession } from '../types';

export function useHousekeepers(
  uid: string | null,
  buildingId: string | null,
) {
  const [housekeepers, setHousekeepers] = useState<Housekeeper[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid || !buildingId) { setLoading(false); return; }

    const col = collection(db, `users/${uid}/buildings/${buildingId}/housekeepers`);
    const unsub = onSnapshot(
      col,
      snap => {
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as Housekeeper));
        docs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setHousekeepers(docs);
        setLoading(false);
      },
      err => {
        console.error('Housekeepers onSnapshot error:', err);
        setLoading(false);
      }
    );

    return unsub;
  }, [uid, buildingId]);

  const buildingPath = uid && buildingId ? `users/${uid}/buildings/${buildingId}` : null;

  const addHousekeeper = useCallback(async (data: {
    name: string;
    phone: string;
    passcode: string;
    notes?: string;
    is_active?: boolean;
    buildingName?: string;
  }) => {
    if (!buildingPath || !uid || !buildingId) return;
    const cleanPhone = data.phone.replace(/\D/g, '');
    const id = `maid_${cleanPhone || Date.now()}`;
    const now = new Date().toISOString();

    const newMaid: Housekeeper = {
      id,
      name: data.name.trim(),
      phone: cleanPhone,
      passcode: data.passcode.trim(),
      status: data.is_active !== false ? 'active' : 'off',
      is_active: data.is_active !== false,
      notes: data.notes?.trim() || '',
      created_at: now,
      updated_at: now,
    };

    // 1. Save in building's housekeepers subcollection
    await setDoc(doc(db, buildingPath, 'housekeepers', id), newMaid);

    // 2. Save in root housekeepers_auth mapping for simple Phone + Passcode login
    if (cleanPhone) {
      await setDoc(doc(db, 'housekeepers_auth', cleanPhone), {
        owner_uid: uid,
        building_id: buildingId,
        building_name: data.buildingName || '',
        maid_id: id,
        name: data.name.trim(),
        phone: cleanPhone,
        passcode: data.passcode.trim(),
        status: data.is_active !== false ? 'active' : 'off',
        updated_at: now,
      });
    }

    return newMaid;
  }, [buildingPath, uid, buildingId]);

  const updateHousekeeper = useCallback(async (
    maidId: string,
    updates: Partial<Housekeeper>,
    buildingName?: string
  ) => {
    if (!buildingPath || !uid || !buildingId) return;
    const now = new Date().toISOString();
    const finalUpdates: Record<string, any> = {
      ...updates,
      updated_at: now,
    };
    if (updates.is_active !== undefined) {
      finalUpdates.status = updates.is_active ? 'active' : 'off';
    }
    await updateDoc(doc(db, buildingPath, 'housekeepers', maidId), finalUpdates);

    const cleanPhone = (updates.phone || '').replace(/\D/g, '');
    if (cleanPhone && uid && buildingId) {
      await setDoc(doc(db, 'housekeepers_auth', cleanPhone), {
        owner_uid: uid,
        building_id: buildingId,
        building_name: buildingName || '',
        maid_id: maidId,
        ...(updates.name && { name: updates.name }),
        phone: cleanPhone,
        ...(updates.passcode && { passcode: updates.passcode }),
        status: updates.is_active !== false ? 'active' : 'off',
        updated_at: now,
      }, { merge: true });
    }
  }, [buildingPath, uid, buildingId]);

  const deleteHousekeeper = useCallback(async (maidId: string, phone?: string) => {
    if (!buildingPath) return;
    await deleteDoc(doc(db, buildingPath, 'housekeepers', maidId));
    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone) {
        await deleteDoc(doc(db, 'housekeepers_auth', cleanPhone));
      }
    }
  }, [buildingPath]);

  return {
    housekeepers,
    loading,
    addHousekeeper,
    updateHousekeeper,
    deleteHousekeeper,
  };
}

/**
 * Authenticate housekeeper using Phone + Passcode (Login page helper)
 */
export async function authenticateHousekeeper(phone: string, passcode: string): Promise<HousekeeperSession> {
  const cleanPhone = phone.replace(/\D/g, '');
  if (!cleanPhone || !passcode.trim()) {
    throw new Error('กรุณากรอกเบอร์โทรศัพท์และรหัสผ่าน');
  }

  const snap = await getDoc(doc(db, 'housekeepers_auth', cleanPhone));
  if (!snap.exists()) {
    throw new Error('ไม่พบข้อมูลเบอร์โทรศัพท์นี้ในระบบแม่บ้าน กรุณาติดต่อเจ้าของหอพัก');
  }

  const data = snap.data();
  if (data.passcode !== passcode.trim()) {
    throw new Error('รหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบรหัสผ่านที่ได้รับจากเจ้าของหอพัก');
  }

  if (data.status === 'off') {
    throw new Error('บัญชีแม่บ้านนี้ถูกปิดใช้งานชั่วคราว');
  }

  const session: HousekeeperSession = {
    owner_uid: data.owner_uid,
    building_id: data.building_id,
    building_name: data.building_name || 'หอพัก',
    maid_id: data.maid_id,
    name: data.name,
    maid_name: data.name,
    phone: cleanPhone,
  };

  localStorage.setItem('horcare_maid_session', JSON.stringify(session));
  return session;
}
