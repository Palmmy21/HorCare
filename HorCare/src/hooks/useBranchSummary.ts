import { useCallback, useEffect, useState } from 'react';
import { apiPost } from '../utils/api';
import type { BranchSummary } from '../shared/branchSummary';

interface SummaryResponse {
  branches: BranchSummary[];
  canSeeFinance: boolean;
  failed: string[];
  lastAccess: Record<string, string | null>;
}

const localKey = (uid: string) => `horcare_branch_access_${uid}`;

/**
 * The last figures, kept for this tab: going back to the picker shows them at once, and within a minute does not
 * ask the server again (every ask costs database reads for every branch).
 */
const SUMMARY_KEY = (owner: string) => `horcare_branch_summary_v1_${owner}`;
const SUMMARY_FRESH_MS = 60_000;
function readKept(owner: string): { at: number; data: SummaryResponse } | null {
  try { const v = JSON.parse(sessionStorage.getItem(SUMMARY_KEY(owner)) || 'null'); return v?.data ? v : null; } catch { return null; }
}
function keep(owner: string, data: SummaryResponse) {
  try { sessionStorage.setItem(SUMMARY_KEY(owner), JSON.stringify({ at: Date.now(), data })); } catch { /* storage full or blocked */ }
}

function readLocal(uid: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(localKey(uid)) || '{}') as Record<string, string>; } catch { return {}; }
}

/**
 * Remember on this device that a branch was just opened, and tell the server (FR-03 / FR-07).
 * The device copy keeps the order right at once, even before (or without) the server.
 */
export function recordBranchAccess(userUid: string | null | undefined, ownerUid: string, buildingId: string) {
  if (!userUid || !ownerUid || !buildingId) return;
  try {
    const map = readLocal(userUid);
    map[buildingId] = new Date().toISOString();
    localStorage.setItem(localKey(userUid), JSON.stringify(map));
  } catch { /* storage blocked: the server copy still counts */ }
  apiPost('branches', { action: 'touch', owner_uid: ownerUid, building_id: buildingId }).catch(() => { /* best effort */ });
}

/** Every branch card's figures in one call (api/_branch-summary.ts). */
export function useBranchSummary(userUid: string | null | undefined, ownerUid: string | null | undefined, enabled: boolean) {
  const [data, setData] = useState<SummaryResponse | null>(() => (ownerUid ? readKept(ownerUid)?.data ?? null : null));
  const [loading, setLoading] = useState(() => enabled && !(ownerUid && readKept(ownerUid)));
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !ownerUid) { setLoading(false); return; } // eslint-disable-line react-hooks/set-state-in-effect
    const kept = readKept(ownerUid);
    if (kept) setData(kept.data);
    // fresh enough, and not a retry: no need to count again
    if (kept && tick === 0 && Date.now() - kept.at < SUMMARY_FRESH_MS && !kept.data.failed?.length) { setLoading(false); return; }
    let cancelled = false;
    setLoading(!kept); // with kept figures on screen, refresh quietly
    setError(false);
    apiPost<SummaryResponse>('branches', { action: 'summary', owner_uid: ownerUid })
      .then(r => { if (!cancelled) { setData(r); keep(ownerUid, r); } })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ownerUid, enabled, tick]);

  const retry = useCallback(() => setTick(t => t + 1), []);

  // Latest of the server's record and this device's.
  const local = userUid ? readLocal(userUid) : {};
  const lastAccess: Record<string, string | null> = { ...(data?.lastAccess ?? {}) };
  for (const [id, at] of Object.entries(local)) {
    if (!lastAccess[id] || at > (lastAccess[id] as string)) lastAccess[id] = at;
  }

  return {
    byId: new Map((data?.branches ?? []).map(b => [b.id, b])),
    failed: new Set(data?.failed ?? []),
    canSeeFinance: data?.canSeeFinance ?? false,
    lastAccess,
    loading,
    error,
    retry,
  };
}
