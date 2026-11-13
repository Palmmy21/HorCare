import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { apiPost } from '../utils/api';
import type { Permission } from '../shared/permissions';
import { pickWorkspace, SELF, workspaceStorageKey } from '../shared/workspace';

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

function readChoice(uid: string | null): string | null {
  if (!uid) return null;
  try { return localStorage.getItem(workspaceStorageKey(uid)); } catch { return null; }
}

/**
 * Which organisation the signed-in person is working in (see shared/workspace.ts). `membership` is the team being
 * worked in, or null for the person's own account; the app then opens that owner's data limited to the assigned
 * buildings. An account an owner created (`managed`) always works in a team; someone with an account of their own
 * chooses with `choose` (null = their own account), remembered per person on this device.
 * `loading` stays true until the answer is known, so the app never flashes an empty owner view first.
 */
export function useMembership(user: User | null): {
  membership: Membership | null;
  teams: Membership[];
  hasOwn: boolean;
  choose: (ownerUid: string | null) => void;
  loading: boolean;
} {
  const [state, setState] = useState<{ uid: string | null; memberships: Membership[] }>({ uid: null, memberships: [] });
  const uid = user?.uid ?? null;
  const [choice, setChoice] = useState<{ uid: string | null; value: string | null }>(() => ({ uid, value: readChoice(uid) }));
  const current = choice.uid === uid ? choice.value : readChoice(uid);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    apiPost<{ memberships: Membership[] }>('members', { action: 'my_memberships' })
      .then(r => { if (!cancelled) setState({ uid, memberships: r.memberships }); })
      .catch(() => { if (!cancelled) setState({ uid, memberships: [] }); }); // when in doubt show the person's own account
    return () => { cancelled = true; };
  }, [uid]);

  const choose = useCallback((ownerUid: string | null) => {
    const value = ownerUid ?? SELF;
    if (uid) { try { localStorage.setItem(workspaceStorageKey(uid), value); } catch { /* storage blocked: this visit only */ } }
    setChoice({ uid, value });
  }, [uid]);

  const memberships = state.uid === uid ? state.memberships : null;
  const picked = useMemo(() => pickWorkspace(memberships ?? [], current), [memberships, current]);

  if (!uid) return { membership: null, teams: [], hasOwn: true, choose, loading: false };
  if (!memberships) return { membership: null, teams: [], hasOwn: true, choose, loading: true };
  return { membership: picked.active, teams: picked.teams, hasOwn: picked.hasOwn, choose, loading: false };
}
