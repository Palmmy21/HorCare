/** A "nice" ceiling for a chart axis, so the ticks are round numbers. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** 123456 satang -> "1.2k" (baht), for axis labels. */
export const compactBaht = (satang: number): string => {
  const b = Math.abs(satang) / 100;
  const s = b >= 1_000_000 ? `${(b / 1_000_000).toFixed(1)}M` : b >= 1000 ? `${(b / 1000).toFixed(b >= 10_000 ? 0 : 1)}k` : String(Math.round(b));
  return satang < 0 ? `-${s}` : s;
};