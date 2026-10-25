import { useEffect, useRef, useState } from 'react';

/** Counts a number up from where it was (zero on mount) to `target`; jumps straight there when motion is reduced. */
export function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(target);
  const from = useRef(0);
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      from.current = target;
      setV(target); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    const start = performance.now(), base = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setV(base + (target - base) * (1 - Math.pow(1 - t, 4)));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
