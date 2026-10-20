import { useEffect, useState } from 'react';
import type { PayAccount } from '../shared/banks';
import { portalPost } from '../components/TenantPortal/portalApi';

export interface TenantAccount extends PayAccount {
  id: string;
  nickname: string | null;
  is_default: boolean;
}

/**
 * The property's active receiving accounts for a tenant (default first), via the portal action (the page's
 * portal link proves the room). An empty list while loading, on error, or when the property has none.
 */
export function useTenantBankAccounts(buildingId: string): TenantAccount[] {
  const [accounts, setAccounts] = useState<TenantAccount[]>([]);
  useEffect(() => {
    if (!buildingId) return;
    let cancelled = false;
    portalPost<{ accounts?: TenantAccount[] }>('bank-accounts', { action: 'tenant_list', building_id: buildingId })
      .then(data => { if (!cancelled && data.accounts) setAccounts(data.accounts); })
      .catch(() => { /* optional: no accounts means no QR, never an error screen */ });
    return () => { cancelled = true; };
  }, [buildingId]);
  return accounts;
}
