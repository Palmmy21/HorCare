// Pure helpers for bulk room creation (no Firebase, easy to unit-test).

export const MAX_BULK_ROOMS = 500;

export interface BulkRoomPattern {
  /** First number of the range, e.g. 101 */
  start: number;
  /** Last number of the range (inclusive), e.g. 120 */
  end: number;
  /** Text before the number, e.g. building "A" -> "A" */
  prefix?: string;
  /** Text after the number */
  suffix?: string;
  /** Left-pad the number with zeros to this width (e.g. 3 turns 7 into 007) */
  padWidth?: number;
}

export function buildRoomNumbers(p: BulkRoomPattern): string[] {
  const { start, end, prefix = '', suffix = '', padWidth = 0 } = p;
  const out: string[] = [];
  for (let n = start; n <= end; n++) {
    out.push(`${prefix}${padWidth > 0 ? String(n).padStart(padWidth, '0') : String(n)}${suffix}`);
  }
  return out;
}

export type PatternError =
  | 'not_integer' | 'negative' | 'end_before_start' | 'too_many' | null;

export function validatePattern(p: BulkRoomPattern): PatternError {
  if (!Number.isInteger(p.start) || !Number.isInteger(p.end)) return 'not_integer';
  if (p.start < 0 || p.end < 0) return 'negative';
  if (p.end < p.start) return 'end_before_start';
  if (p.end - p.start + 1 > MAX_BULK_ROOMS) return 'too_many';
  return null;
}

/**
 * Room numbers must be unique within a property. Comparison is case-insensitive and
 * ignores surrounding whitespace so "a101" and "A101 " are treated as the same room.
 */
export function normalizeRoomNumber(n: string): string {
  return n.trim().toLowerCase();
}

export function findDuplicates(candidates: string[], existing: string[]): string[] {
  const taken = new Set(existing.map(normalizeRoomNumber));
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const c of candidates) {
    const key = normalizeRoomNumber(c);
    if (taken.has(key) || seen.has(key)) dupes.push(c);
    seen.add(key);
  }
  return dupes;
}
