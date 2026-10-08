// Bank reconciliation: match money that really arrived in a bank account to the bills / fines it pays.
// Pure functions only (shared by the API and the UI). A slip is a claim; a bank transaction is evidence —
// only a confirmed match to a bank transaction may turn a payment's verification_status into 'verified'.

export const RECON_STATUSES = ['unmatched', 'suggested', 'matched', 'conflict', 'reconciled'] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];

export const RECON_STATUS_LABELS_TH: Record<ReconStatus, string> = {
  unmatched: 'ยังไม่จับคู่',
  suggested: 'แนะนำให้จับคู่',
  matched: 'จับคู่แล้ว (รอยืนยัน)',
  conflict: 'ขัดแย้ง',
  reconciled: 'ตรวจสอบแล้ว',
};

export interface ReconTarget {
  kind: 'bill' | 'fine';
  id: string;
  room_id: string;
  room_number: string;
}

export interface MatchCandidate extends ReconTarget {
  score: number;
  reasons: string[];
  /** Already reconciled against another bank transaction. */
  taken?: boolean;
}

export interface BankTransaction {
  id: string;
  bank_account_id: string;
  /** Money in, THB. */
  amount: number;
  /** ISO timestamp. */
  occurred_at: string;
  reference: string | null;
  description: string | null;
  status: ReconStatus;
  matched: ReconTarget | null;
  candidates: MatchCandidate[];
  conflict_reason?: string | null;
  /** Items a human rejected for this transaction; never suggested again. */
  rejected_item_ids?: string[];
  source: 'manual' | 'csv';
  created_at: string;
  created_by: string;
  reconciled_at?: string;
  reconciled_by?: string;
}

/** A bill or fine, reduced to what matching needs. */
export interface ReconItem extends ReconTarget {
  /** Amount the item should have brought in. */
  amount: number;
  payment_status: 'unpaid' | 'pending' | 'paid';
  verification_status?: 'unverified' | 'verified' | 'rejected';
  transaction_ref?: string;
  bank_account_id?: string;
  /** When the slip says the transfer was made, else when it was marked paid. */
  paid_time?: string;
  /** Bank transaction this item was reconciled with, if any. */
  bank_transaction_id?: string;
}

export interface MatchResult {
  status: ReconStatus;
  matched: ReconTarget | null;
  candidates: MatchCandidate[];
  conflict_reason: string | null;
}

const MINUTE = 60_000;
const SUGGEST_MIN_SCORE = 50;
const SCORE_GAP = 10;

export const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;
const normRef = (r: string | null | undefined) => (r ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const MIN_REF_LEN = 6;

/** Score one item against a transaction; null when the amount differs (never a candidate). */
export function scoreItem(tx: Pick<BankTransaction, 'amount' | 'bank_account_id' | 'occurred_at' | 'reference'>, item: ReconItem): MatchCandidate | null {
  if (!sameAmount(tx.amount, item.amount)) return null;
  let score = 40;
  const reasons = ['amount'];

  const txRef = normRef(tx.reference);
  const itemRef = normRef(item.transaction_ref);
  if (txRef.length >= MIN_REF_LEN && txRef === itemRef) { score += 40; reasons.push('reference'); }

  if (item.bank_account_id) {
    if (item.bank_account_id === tx.bank_account_id) { score += 10; reasons.push('account'); }
    else { score -= 30; reasons.push('account_mismatch'); }
  }

  if (item.paid_time) {
    const diff = Math.abs(new Date(tx.occurred_at).getTime() - new Date(item.paid_time).getTime());
    if (Number.isFinite(diff)) {
      if (diff <= 10 * MINUTE) { score += 20; reasons.push('time_close'); }
      else if (diff <= 24 * 60 * MINUTE) { score += 10; reasons.push('same_day'); }
    }
  }

  return { kind: item.kind, id: item.id, room_id: item.room_id, room_number: item.room_number, score, reasons };
}

/**
 * Decide the status of a transaction.
 *  matched    – unique item with same amount AND same reference (and not on another account)
 *  suggested  – unique best item by amount + account/time evidence, no reference
 *  conflict   – several equally good items, a duplicate reference, a reference on the wrong account, or
 *               the only fitting item is already reconciled with another transaction
 *  unmatched  – nothing fits
 * Never returns 'reconciled': only a human confirmation does.
 */
export function matchTransaction(
  tx: Pick<BankTransaction, 'id' | 'amount' | 'bank_account_id' | 'occurred_at' | 'reference' | 'rejected_item_ids'>,
  items: ReconItem[],
): MatchResult {
  const rejected = new Set(tx.rejected_item_ids ?? []);
  const all: MatchCandidate[] = [];
  for (const item of items) {
    if (rejected.has(item.id)) continue;
    const c = scoreItem(tx, item);
    if (!c) continue;
    if (item.bank_transaction_id && item.bank_transaction_id !== tx.id) c.taken = true;
    else if (item.verification_status === 'verified') c.taken = true;
    all.push(c);
  }
  all.sort((a, b) => b.score - a.score);
  const free = all.filter(c => !c.taken);
  const candidates = all.slice(0, 5);

  if (free.length === 0) {
    return all.length > 0
      ? { status: 'conflict', matched: null, candidates, conflict_reason: 'already_reconciled' }
      : { status: 'unmatched', matched: null, candidates: [], conflict_reason: null };
  }

  const byRef = free.filter(c => c.reasons.includes('reference'));
  if (byRef.length > 1) return { status: 'conflict', matched: null, candidates, conflict_reason: 'duplicate_reference' };
  if (byRef.length === 1) {
    const c = byRef[0];
    if (c.reasons.includes('account_mismatch')) return { status: 'conflict', matched: null, candidates, conflict_reason: 'account_mismatch' };
    return { status: 'matched', matched: toTarget(c), candidates, conflict_reason: null };
  }

  const top = free[0];
  if (top.score < SUGGEST_MIN_SCORE) return { status: 'unmatched', matched: null, candidates, conflict_reason: null };
  const second = free[1];
  if (second && top.score - second.score < SCORE_GAP) return { status: 'conflict', matched: null, candidates, conflict_reason: 'multiple_candidates' };
  return { status: 'suggested', matched: toTarget(top), candidates, conflict_reason: null };
}

const toTarget = (c: ReconTarget): ReconTarget => ({ kind: c.kind, id: c.id, room_id: c.room_id, room_number: c.room_number });

export const CONFLICT_REASON_LABELS_TH: Record<string, string> = {
  already_reconciled: 'รายการที่ตรงกันถูกจับคู่กับรายการธนาคารอื่นแล้ว',
  duplicate_reference: 'มีหลายรายการที่เลขอ้างอิงตรงกัน',
  account_mismatch: 'เลขอ้างอิงตรง แต่โอนเข้าคนละบัญชี',
  multiple_candidates: 'มีหลายรายการที่ยอดและเวลาใกล้เคียงกัน',
};

export const MATCH_REASON_LABELS_TH: Record<string, string> = {
  amount: 'ยอดตรง',
  reference: 'เลขอ้างอิงตรง',
  account: 'บัญชีตรง',
  account_mismatch: 'คนละบัญชี',
  time_close: 'เวลาใกล้เคียง (≤10 นาที)',
  same_day: 'วันเดียวกัน',
};

/** Stable id so importing the same statement twice never duplicates a transaction. */
export function transactionKey(t: { bank_account_id: string; occurred_at: string; amount: number; reference: string | null }): string {
  const minute = new Date(t.occurred_at).toISOString().slice(0, 16);
  return [t.bank_account_id, minute, t.amount.toFixed(2), normRef(t.reference)].join('|');
}
