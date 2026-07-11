import { useState, useEffect, useCallback } from 'react';
import {
  collection, doc,
  onSnapshot, setDoc, updateDoc, deleteDoc, addDoc,
  query, orderBy,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type { TenantProfile, TenantEvent } from '../types';

/**
 * Firestore path:
 *   users/{uid}/buildings/{buildingId}/data/tenants/{roomId}   ← profile doc
 *   users/{uid}/buildings/{buildingId}/data/tenants/{roomId}/events/{eventId}
 *
 * We put tenant data under the same base path as config/rooms/bills
 * so existing Firestore Security Rules cover it automatically.
 */
function buildingPath(uid: string, buildingId: string) {
  return `users/${uid}/buildings/${buildingId}`;
}

function profileDocRef(uid: string, buildingId: string, roomId: string) {
  return doc(db, buildingPath(uid, buildingId), 'tenants', roomId);
}

function eventsColRef(uid: string, buildingId: string, roomId: string) {
  return collection(db, buildingPath(uid, buildingId), 'tenants', roomId, 'events');
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useTenantProfile — single room profile + events with real-time sync
// ─────────────────────────────────────────────────────────────────────────────
export function useTenantProfile(
  uid: string | null,
  buildingId: string | null,
  roomId: string | null,
) {
  const [profile, setProfile] = useState<TenantProfile | null>(null);
  const [events, setEvents] = useState<TenantEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Real-time listener — profile document
  useEffect(() => {
    if (!uid || !buildingId || !roomId) {
      setProfile(null); // eslint-disable-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    setLoading(true);
    const ref = profileDocRef(uid, buildingId, roomId);
    const unsub = onSnapshot(
      ref,
      snap => {
        setProfile(snap.exists() ? (snap.data() as TenantProfile) : null);
        setLoading(false);
      },
      () => {
        // Silently ignore permission/not-found errors — treat as no profile
        setProfile(null);
        setLoading(false);
      },
    );
    return unsub;
  }, [uid, buildingId, roomId]);

  // Real-time listener — events sub-collection
  useEffect(() => {
    if (!uid || !buildingId || !roomId) { setEvents([]); return; } // eslint-disable-line react-hooks/set-state-in-effect
    const q = query(eventsColRef(uid, buildingId, roomId), orderBy('date', 'desc'));
    const unsub = onSnapshot(
      q,
      snap => {
        setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as TenantEvent)));
      },
      () => {
        setEvents([]);
      },
    );
    return unsub;
  }, [uid, buildingId, roomId]);

  /** บันทึก / อัปเดต profile (upsert) */
  const saveProfile = useCallback(async (
    data: Omit<TenantProfile, 'id' | 'created_at' | 'updated_at'>,
  ) => {
    if (!uid || !buildingId || !roomId) return;
    const ref = profileDocRef(uid, buildingId, roomId);
    const now = new Date().toISOString();
    if (profile) {
      await updateDoc(ref, { ...data, updated_at: now });
    } else {
      await setDoc(ref, {
        ...data,
        id: roomId,
        room_id: roomId,
        building_id: buildingId,
        created_at: now,
        updated_at: now,
      });
    }
  }, [uid, buildingId, roomId, profile]);

  /** เพิ่ม event (move_in, move_out, ฯลฯ) */
  const addEvent = useCallback(async (
    data: Omit<TenantEvent, 'id' | 'room_id' | 'created_at'>,
  ) => {
    if (!uid || !buildingId || !roomId) return;
    await addDoc(eventsColRef(uid, buildingId, roomId), {
      ...data,
      room_id: roomId,
      created_at: new Date().toISOString(),
    });
  }, [uid, buildingId, roomId]);

  /** ลบ event */
  const deleteEvent = useCallback(async (eventId: string) => {
    if (!uid || !buildingId || !roomId) return;
    await deleteDoc(doc(eventsColRef(uid, buildingId, roomId), eventId));
  }, [uid, buildingId, roomId]);

  return { profile, events, loading, saveProfile, addEvent, deleteEvent };
}
