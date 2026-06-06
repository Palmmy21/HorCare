import { useState, useEffect, useCallback, useRef } from 'react';
import {
    collection, doc, setDoc, updateDoc, deleteDoc,
    onSnapshot, query, orderBy, getDocs, getDoc
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type { Building } from '../types';

export function useBuildings(userId: string | null) {
    const [buildings, setBuildings] = useState<Building[]>([]);
    const [loading, setLoading] = useState(true);
    const [migrating] = useState(false);
    const migratedRef = useRef(false);

    useEffect(() => {
        if (!userId) { setLoading(false); return; }

        const buildingsRef = collection(db, `users/${userId}/buildings`);
        const q = query(buildingsRef, orderBy('order'));

        const unsub = onSnapshot(q, async (snap) => {
            const list = snap.docs.map(d => ({ ...d.data(), id: d.id } as Building));
            setBuildings(list);

            // First load: if no buildings exist, check for legacy data and migrate
            if (!migratedRef.current && snap.empty) {
                migratedRef.current = true;
                try {
                    await migrateLegacyData(userId);
                } catch (err) {
                    console.error('Migration failed (deploy Firestore rules and reload):', err);
                }
            }

            setLoading(false);
        });

        return () => unsub();
    }, [userId]);

    const addBuilding = useCallback(async (name: string): Promise<Building | undefined> => {
        if (!userId) return;
        const id = `building_${Date.now()}`;
        const newBuilding: Building = {
            id,
            name: name.trim(),
            created_at: new Date().toISOString(),
            order: buildings.length,
        };
        await setDoc(doc(db, `users/${userId}/buildings`, id), newBuilding);
        return newBuilding;
    }, [userId, buildings.length]);

    const renameBuilding = useCallback(async (buildingId: string, name: string) => {
        if (!userId) return;
        await updateDoc(doc(db, `users/${userId}/buildings`, buildingId), { name: name.trim() });
    }, [userId]);

    const deleteBuilding = useCallback(async (buildingId: string) => {
        if (!userId) return;
        await deleteDoc(doc(db, `users/${userId}/buildings`, buildingId));
    }, [userId]);

    return { buildings, loading, migrating, addBuilding, renameBuilding, deleteBuilding };
}

/**
 * One-time migration: copy data from legacy flat paths to the new buildings structure.
 * Legacy: users/{uid}/rooms, users/{uid}/bills, users/{uid}/data/config
 * New:    users/{uid}/buildings/{id}/rooms, .../bills, .../data/config
 */
async function migrateLegacyData(userId: string) {
    const buildingId = 'default';
    const basePath = `users/${userId}/buildings/${buildingId}`;

    // Check if legacy rooms exist
    const legacyRoomsSnap = await getDocs(collection(db, `users/${userId}/rooms`));
    if (legacyRoomsSnap.empty) {
        // No legacy data — just create a default empty building
        await setDoc(doc(db, `users/${userId}/buildings`, buildingId), {
            id: buildingId,
            name: 'หอพักหลัก',
            created_at: new Date().toISOString(),
            order: 0,
        } as Building);
        return;
    }

    // Has legacy data — migrate it
    const writes: Promise<void>[] = [];

    // Create building document
    writes.push(setDoc(doc(db, `users/${userId}/buildings`, buildingId), {
        id: buildingId,
        name: 'หอพักหลัก',
        created_at: new Date().toISOString(),
        order: 0,
    } as Building));

    // Migrate config
    const configSnap = await getDoc(doc(db, `users/${userId}/data/config`));
    if (configSnap.exists()) {
        writes.push(setDoc(doc(db, `${basePath}/data/config`), configSnap.data()));
    }

    // Migrate rooms
    legacyRoomsSnap.docs.forEach(d => {
        writes.push(setDoc(doc(db, `${basePath}/rooms/${d.id}`), d.data()));
    });

    // Migrate bills
    const legacyBillsSnap = await getDocs(collection(db, `users/${userId}/bills`));
    legacyBillsSnap.docs.forEach(d => {
        writes.push(setDoc(doc(db, `${basePath}/bills/${d.id}`), d.data()));
    });

    await Promise.all(writes);
}
