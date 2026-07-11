import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { MaintenanceRequest, MaintenancePartUsed, StockItem, Asset, AssetCondition, Vendor } from '../types';

export function useMaintenanceRequests(
  uid: string | null,
  buildingId: string | null,
  roomId?: string,
) {
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid || !buildingId) { setLoading(false); return; } // eslint-disable-line react-hooks/set-state-in-effect

    const col = collection(db, `users/${uid}/buildings/${buildingId}/maintenance`);
    const q = roomId
      ? query(col, where('room_id', '==', roomId))
      : query(col);

    const unsub = onSnapshot(q,
      snap => {
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as MaintenanceRequest));
        docs.sort((a, b) => {
          if (a.urgency !== b.urgency) return a.urgency === 'urgent' ? -1 : 1;
          return (b.created_at || '').localeCompare(a.created_at || '');
        });
        setRequests(docs);
        setLoading(false);
      },
      (err) => { console.error('Maintenance onSnapshot error:', err); setLoading(false); },
    );
    return unsub;
  }, [uid, buildingId, roomId]);

  const buildingPath = uid && buildingId ? `users/${uid}/buildings/${buildingId}` : null;

  const updateStatus = async (
    reqId: string,
    status: MaintenanceRequest['status'],
    adminNote?: string,
    extra?: {
      vendor_id?: string;
      vendor_name?: string;
      vendor_phone?: string;
      scheduled_date?: string;
    },
  ) => {
    if (!buildingPath) return;
    await updateDoc(doc(db, buildingPath, 'maintenance', reqId), {
      status,
      updated_at: new Date().toISOString(),
      ...(adminNote !== undefined && { admin_note: adminNote }),
      ...(extra && extra),
    });
  };

  // Save completion: updates maintenance doc only — stock/asset side effects handled by their own hooks
  const completeRequest = async (
    reqId: string,
    adminNote: string,
    partsUsed: MaintenancePartUsed[],
    assetUpdate?: { asset_id: string; asset_name: string; condition: AssetCondition },
  ) => {
    if (!buildingPath) return;
    await updateDoc(doc(db, buildingPath, 'maintenance', reqId), {
      status: 'done',
      updated_at: new Date().toISOString(),
      ...(adminNote && { admin_note: adminNote }),
      parts_used: partsUsed,
      ...(assetUpdate && {
        asset_id: assetUpdate.asset_id,
        asset_name: assetUpdate.asset_name,
        asset_condition_after: assetUpdate.condition,
      }),
    });
  };

  const deleteRequest = async (reqId: string) => {
    if (!buildingPath) return;
    await deleteDoc(doc(db, buildingPath, 'maintenance', reqId));
  };

  return { requests, loading, updateStatus, completeRequest, deleteRequest };
}

// ── Stock hook (for use in MaintenancePage completion panel) ──────────────────
export function useStockItems(uid: string | null, buildingId: string | null) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid || !buildingId) { setLoading(false); return; } // eslint-disable-line react-hooks/set-state-in-effect
    const unsub = onSnapshot(
      collection(db, `users/${uid}/buildings/${buildingId}/stock`),
      snap => {
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as StockItem));
        docs.sort((a, b) => a.name.localeCompare(b.name, 'th'));
        setItems(docs);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [uid, buildingId]);

  const decrementMany = async (parts: MaintenancePartUsed[], stockMap: Map<string, StockItem>) => {
    if (!uid || !buildingId) return;
    const now = new Date().toISOString();
    await Promise.all(parts.map(part => {
      const current = stockMap.get(part.stock_id);
      const newQty = Math.max(0, (current?.quantity ?? 0) - part.qty);
      return updateDoc(doc(db, `users/${uid}/buildings/${buildingId}/stock`, part.stock_id), {
        quantity: newQty, updated_at: now,
      });
    }));
  };

  return { items, loading, decrementMany };
}

// ── Assets hook (for use in MaintenancePage completion panel) ─────────────────
export function useAssets(uid: string | null, buildingId: string | null) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid || !buildingId) { setLoading(false); return; } // eslint-disable-line react-hooks/set-state-in-effect
    const unsub = onSnapshot(
      collection(db, `users/${uid}/buildings/${buildingId}/assets`),
      snap => {
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as Asset));
        docs.sort((a, b) => a.name.localeCompare(b.name, 'th'));
        setAssets(docs);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [uid, buildingId]);

  const updateCondition = async (assetId: string, condition: AssetCondition) => {
    if (!uid || !buildingId) return;
    await updateDoc(doc(db, `users/${uid}/buildings/${buildingId}/assets`, assetId), { condition });
  };

  return { assets, loading, updateCondition };
}

// ── Vendors hook (for use in MaintenancePage assignment panel) ────────────────
export function useVendors(uid: string | null, buildingId: string | null) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid || !buildingId) { setLoading(false); return; } // eslint-disable-line react-hooks/set-state-in-effect
    const unsub = onSnapshot(
      collection(db, `users/${uid}/buildings/${buildingId}/vendors`),
      snap => {
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as Vendor));
        docs.sort((a, b) => a.name.localeCompare(b.name, 'th'));
        setVendors(docs);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [uid, buildingId]);

  return { vendors, loading };
}
