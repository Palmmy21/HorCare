import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { apiPost } from '../utils/api';
import type { Permission } from '../shared/permissions';

export interface Membership {
  owner_uid: string;
  owner_name: string;
  role: string;
  permissions: Permission[];
  /** Building ids the account may use, or ['*'] for every property. */
  property_ids: string[];
  managed: boolean;
  /** The owner's plan: it governs the whole organisation, and staff cannot read the owner's profile. */
  license: string;
  access_until: number;
}

/**
 * Is this signed-in person an administrator created by an owner? If so the app opens that owner's data limited to the
 * assigned buildings. Only accounts the owner created (`managed`) switch the app into staff mode; an ordinary owner
 * who happens to be listed somewhere else keeps their own account.
 * `loading` stays true until the answer is known, so the app never flashes an empty owner view first.
 */
export function useMembership(user: User | null): { membership: Membership | null; loading: boolean } {
  const [state, setState] = useState<{ uid: string | null; membership: Membership | null }>({ uid: null, membership: null });
  const uid = user?.uid ?? null;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    apiPost<{ memberships: Membership[] }>('members', { action: 'my_memberships' })
      .then(r => { if (!cancelled) setState({ uid, membership: r.memberships.find(m => m.managed) ?? null }); })
      .catch(() => { if (!cancelled) setState({ uid, membership: null }); }); // when in doubt show the person's own account
    return () => { cancelled = true; };
  }, [uid]);

  if (!uid) return { membership: null, loading: false };
  return state.uid === uid ? { membership: state.membership, loading: false } : { membership: null, loading: true };
}
