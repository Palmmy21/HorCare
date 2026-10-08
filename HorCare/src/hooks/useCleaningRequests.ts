import { useEffect, useState, useCallback } from 'react';
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, query, where
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type { CleaningRequest, CleaningStatus } from '../types';

export function useCleaningRequests(
  uid: string | null,
  buildingId: string | null,
  roomId?: string,
  maidId?: string,
) {
  const [requests, setRequests] = useState<CleaningRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Loading only while there is something to load; with no property selected there is nothing to wait for. */
  const loading = !!(uid && buildingId) && !loaded;

  useEffect(() => {
    if (!uid || !buildingId) return;

    const col = collection(db, `users/${uid}/buildings/${buildingId}/cleaning`);
    let q = query(col);

    if (roomId) {
      q = query(col, where('room_id', '==', roomId));
    }

    const unsub = onSnapshot(
      q,
      snap => {
        let docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as CleaningRequest));
        
        // Filter by maid if in maid specific scope (or show all unassigned + assigned to this maid)
        if (maidId) {
          docs = docs.filter(r => !r.assigned_maid_id || r.assigned_maid_id === maidId);
        }

        // Sort by urgency then created_at desc
        docs.sort((a, b) => {
          if (a.urgency !== b.urgency) return a.urgency === 'urgent' ? -1 : 1;
          return (b.created_at || '').localeCompare(a.created_at || '');
        });

        setRequests(docs);
        setLoaded(true);
      },
      err => {
        console.error('Cleaning onSnapshot error:', err);
        setLoaded(true);
      }
    );

    return unsub;
  }, [uid, buildingId, roomId, maidId]);

  const buildingPath = uid && buildingId ? `users/${uid}/buildings/${buildingId}` : null;

  const addRequest = useCallback(async (data: Partial<CleaningRequest>) => {
    if (!buildingPath) return;
    const now = new Date().toISOString();
    return await addDoc(collection(db, buildingPath, 'cleaning'), {
      status: 'pending',
      ...data,
      created_at: now,
      updated_at: now,
    });
  }, [buildingPath]);

  const assignMaid = useCallback(async (
    reqId: string,
    maidOrId: string | { id: string; name: string; phone: string },
    maidName?: string,
    maidPhone?: string,
  ) => {
    if (!buildingPath) return;
    const id = typeof maidOrId === 'string' ? maidOrId : maidOrId.id;
    const name = typeof maidOrId === 'string' ? (maidName || '') : maidOrId.name;
    const phone = typeof maidOrId === 'string' ? (maidPhone || '') : maidOrId.phone;

    await updateDoc(doc(db, buildingPath, 'cleaning', reqId), {
      status: 'in_progress',
      assigned_maid_id: id,
      assigned_maid_name: name,
      assigned_maid_phone: phone,
      updated_at: new Date().toISOString(),
    });
  }, [buildingPath]);

  const acceptRequest = useCallback(async (
    reqId: string,
    maidOrId?: string | { id: string; name: string; phone: string },
    maidName?: string,
    maidPhone?: string,
  ) => {
    if (!buildingPath) return;
    const updates: Partial<CleaningRequest> = {
      status: 'in_progress',
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (maidOrId) {
      if (typeof maidOrId === 'string') {
        updates.assigned_maid_id = maidOrId;
        updates.assigned_maid_name = maidName || '';
        updates.assigned_maid_phone = maidPhone || '';
      } else {
        updates.assigned_maid_id = maidOrId.id;
        updates.assigned_maid_name = maidOrId.name;
        updates.assigned_maid_phone = maidOrId.phone;
      }
    }
    await updateDoc(doc(db, buildingPath, 'cleaning', reqId), updates);
  }, [buildingPath]);

  const completeRequest = useCallback(async (
    reqId: string,
    noteOrOpts?: string | {
      completed_by?: 'maid' | 'landlord';
      completion_notes?: string;
      completion_photo_url?: string | null;
      fee?: number;
    }
  ) => {
    if (!buildingPath) return;
    const note = typeof noteOrOpts === 'string' ? noteOrOpts : noteOrOpts?.completion_notes;
    const completedBy = typeof noteOrOpts === 'object' && noteOrOpts?.completed_by ? noteOrOpts.completed_by : 'maid';

    await updateDoc(doc(db, buildingPath, 'cleaning', reqId), {
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: completedBy,
      ...(note && { completion_notes: note, completed_note: note }),
      updated_at: new Date().toISOString(),
    });
  }, [buildingPath]);

  const updateStatus = useCallback(async (
    reqId: string,
    status: CleaningStatus,
    notes?: string
  ) => {
    if (!buildingPath) return;
    await updateDoc(doc(db, buildingPath, 'cleaning', reqId), {
      status,
      ...(notes !== undefined && { completion_notes: notes, completed_note: notes }),
      updated_at: new Date().toISOString(),
    });
  }, [buildingPath]);

  const deleteRequest = useCallback(async (reqId: string) => {
    if (!buildingPath) return;
    await deleteDoc(doc(db, buildingPath, 'cleaning', reqId));
  }, [buildingPath]);

  return {
    requests,
    loading,
    addRequest,
    assignMaid,
    acceptRequest,
    completeRequest,
    updateStatus,
    deleteRequest,
  };
}
