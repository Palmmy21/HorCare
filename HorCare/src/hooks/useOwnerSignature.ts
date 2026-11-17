import { useCallback, useEffect, useState } from 'react';
import { deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { cleanSignatureImage, ownerSignaturePath, parseOwnerSignature, type OwnerSignature } from '../shared/ownerSignature';
import { logActivity } from '../utils/auditLog';

export interface OwnerSignatureState {
  signature: OwnerSignature | null;
  loading: boolean;
  /** Owner only (Firestore rules refuse anyone else). Throws on a bad image or a refused write. */
  save: (image: string, signerName?: string) => Promise<void>;
  remove: () => Promise<void>;
}

/**
 * The organisation's owner signature, live. `ownerUid` is the organisation (the owner's uid, also for staff, who may
 * read it so the documents they print carry it). Empty uid = nothing is listened to.
 */
export function useOwnerSignature(ownerUid: string | null | undefined): OwnerSignatureState {
  const [signature, setSignature] = useState<OwnerSignature | null>(null);
  const [loading, setLoading] = useState(!!ownerUid);

  useEffect(() => {
    setSignature(null); // eslint-disable-line react-hooks/set-state-in-effect
    if (!ownerUid) { setLoading(false); return; }
    setLoading(true);
    return onSnapshot(doc(db, ownerSignaturePath(ownerUid)),
      snap => { setSignature(snap.exists() ? parseOwnerSignature(snap.data()) : null); setLoading(false); },
      () => { setSignature(null); setLoading(false); }); // no access (e.g. a housekeeper session): documents go unsigned
  }, [ownerUid]);

  const save = useCallback(async (image: string, signerName?: string) => {
    if (!ownerUid) throw new Error('no_owner');
    const clean = cleanSignatureImage(image);
    if (!clean) throw new Error('invalid_signature');
    const name = signerName?.trim().slice(0, 120) ?? '';
    const had = !!signature;
    await setDoc(doc(db, ownerSignaturePath(ownerUid)), { image: clean, signer_name: name, updated_at: new Date().toISOString() });
    logActivity({ action: had ? 'UPDATE' : 'CREATE', resourceType: 'signature', resourceId: 'owner', resourceLabel: 'ลายเซ็นอิเล็กทรอนิกส์ของเจ้าของ', propertyId: null });
  }, [ownerUid, signature]);

  const remove = useCallback(async () => {
    if (!ownerUid) return;
    await deleteDoc(doc(db, ownerSignaturePath(ownerUid)));
    logActivity({ action: 'DELETE', resourceType: 'signature', resourceId: 'owner', resourceLabel: 'ลายเซ็นอิเล็กทรอนิกส์ของเจ้าของ', propertyId: null });
  }, [ownerUid]);

  return { signature, loading, save, remove };
}
