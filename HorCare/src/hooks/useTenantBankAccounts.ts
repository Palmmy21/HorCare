import { useEffect, useState } from 'react';
import type { PayAccount } from '../shared/banks';

export interface TenantAccount extends PayAccount {
  id: string;
  nickname: string | null;
  is_default: boolean;
}

/**
 * The property's active receiving accounts for a tenant (default first), via the public portal action.
 * An empty list while loading, on error, or when the property has none.
 */
export function useTenantBankAccounts(uid: string, buildingId: string, roomId: string): TenantAccount[] {
  const [accounts, setAccounts] = useState<TenantAccount[]>([]);
  useEffect(() => {
    if (!uid || !buildingId || !roomId) return;
    let cancelled = false;
    fetch('/api/bank-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tenant_list', owner_uid: uid, building_id: buildingId, room_id: roomId }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((data: { accounts?: TenantAccount[] } | null) => { if (!cancelled && data?.accounts) setAccounts(data.accounts); })
      .catch(() => { /* optional: no accounts means no QR, never an error screen */ });
    return () => { cancelled = true; };
  }, [uid, buildingId, roomId]);
  return accounts;
}