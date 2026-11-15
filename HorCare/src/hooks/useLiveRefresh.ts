import { useEffect, useRef } from 'react';

/**
 * Keep a screen fed by an API call (not a Firestore listener) up to date: run `refresh` every `everyMs` while the tab
 * is visible, and at once when the tab comes back to the front. Money taken on a collector's phone (POS Care) is on
 * the owner's screen within seconds, without a reload.
 */
export function useLiveRefresh(refresh: () => void, everyMs = 20_000, enabled = true): void {
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    const run = () => { if (document.visibilityState === 'visible') latest.current(); };
    const timer = window.setInterval(run, everyMs);
    document.addEventListener('visibilitychange', run);
    window.addEventListener('focus', run);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', run); window.removeEventListener('focus', run); };
  }, [everyMs, enabled]);
}
