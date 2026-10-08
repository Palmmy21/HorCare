import { describe, expect, it } from 'vitest';
import { matchTransaction, transactionKey, type ReconItem } from './reconciliation';

const item = (id: string, over: Partial<ReconItem> = {}): ReconItem => ({
  kind: 'bill', id, room_id: `r-${id}`, room_number: id, amount: 3500, payment_status: 'paid',
  verification_status: 'unverified', ...over,
});
const tx = (over: Record<string, unknown> = {}) => ({
  id: 'tx1', amount: 3500, bank_account_id: 'acc1', occurred_at: '2026-10-05T10:00:00.000Z', reference: null as string | null, ...over,
});

describe('matchTransaction', () => {
  it('matches a unique item with the same reference', () => {
    const r = matchTransaction(tx({ reference: 'REF-123456' }), [item('A', { transaction_ref: 'ref123456', bank_account_id: 'acc1' }), item('B')]);
    expect(r.status).toBe('matched');
    expect(r.matched?.id).toBe('A');
  });

  it('ignores items whose amount differs', () => {
    const r = matchTransaction(tx(), [item('A', { amount: 3400, bank_account_id: 'acc1' })]);
    expect(r).toMatchObject({ status: 'unmatched', matched: null, candidates: [] });
  });

  it('suggests a unique item by amount + account + time when there is no reference', () => {
    const r = matchTransaction(tx(), [item('A', { bank_account_id: 'acc1', paid_time: '2026-10-05T10:03:00.000Z' })]);
    expect(r.status).toBe('suggested');
    expect(r.matched?.id).toBe('A');
  });

  it('amount alone is too weak to suggest', () => {
    expect(matchTransaction(tx(), [item('A')]).status).toBe('unmatched');
  });

  it('two equally good items is a conflict, never a guess', () => {
    const a = item('A', { bank_account_id: 'acc1', paid_time: '2026-10-05T10:01:00.000Z' });
    const b = item('B', { bank_account_id: 'acc1', paid_time: '2026-10-05T10:02:00.000Z' });
    const r = matchTransaction(tx(), [a, b]);
    expect(r).toMatchObject({ status: 'conflict', matched: null, conflict_reason: 'multiple_candidates' });
  });

  it('same reference on two items is a conflict', () => {
    const r = matchTransaction(tx({ reference: 'ABCDEF12' }), [item('A', { transaction_ref: 'ABCDEF12' }), item('B', { transaction_ref: 'ABCDEF12' })]);
    expect(r.conflict_reason).toBe('duplicate_reference');
  });

  it('matching reference but a different account is a conflict', () => {
    const r = matchTransaction(tx({ reference: 'ABCDEF12' }), [item('A', { transaction_ref: 'ABCDEF12', bank_account_id: 'other' })]);
    expect(r).toMatchObject({ status: 'conflict', conflict_reason: 'account_mismatch' });
  });

  it('a different account lowers the score below the suggestion threshold', () => {
    expect(matchTransaction(tx(), [item('A', { bank_account_id: 'other', paid_time: '2026-10-05T10:01:00.000Z' })]).status).toBe('unmatched');
  });

  it('items already reconciled with another transaction are never offered; if they are the only fit it is a conflict', () => {
    const taken = item('A', { bank_account_id: 'acc1', verification_status: 'verified', bank_transaction_id: 'other-tx' });
    expect(matchTransaction(tx(), [taken])).toMatchObject({ status: 'conflict', matched: null, conflict_reason: 'already_reconciled' });
    const free = item('B', { bank_account_id: 'acc1', paid_time: '2026-10-05T10:01:00.000Z' });
    expect(matchTransaction(tx(), [taken, free]).matched?.id).toBe('B');
  });

  it('an item already linked to this very transaction is still matchable (re-run is idempotent)', () => {
    const mine = item('A', { bank_account_id: 'acc1', bank_transaction_id: 'tx1', paid_time: '2026-10-05T10:01:00.000Z' });
    expect(matchTransaction(tx(), [mine]).status).toBe('suggested');
  });

  it('never suggests an item a human rejected', () => {
    const a = item('A', { bank_account_id: 'acc1', paid_time: '2026-10-05T10:01:00.000Z' });
    expect(matchTransaction(tx({ rejected_item_ids: ['A'] }), [a]).status).toBe('unmatched');
  });

  it('short references are not trusted', () => {
    expect(matchTransaction(tx({ reference: '123' }), [item('A', { transaction_ref: '123' })]).matched).toBeNull();
  });

  it('works for unpaid items (money arrived before any slip) and fines', () => {
    const f = item('F', { kind: 'fine', payment_status: 'unpaid', bank_account_id: 'acc1' });
    expect(matchTransaction(tx(), [f]).status).toBe('suggested');
  });
});

describe('transactionKey', () => {
  it('is the same for the same transfer and ignores reference punctuation/case', () => {
    const base = { bank_account_id: 'a', occurred_at: '2026-10-05T10:00:10.000Z', amount: 100 };
    expect(transactionKey({ ...base, reference: 'ab-12' })).toBe(transactionKey({ ...base, occurred_at: '2026-10-05T10:00:50.000Z', reference: 'AB12' }));
    expect(transactionKey({ ...base, reference: null })).not.toBe(transactionKey({ ...base, amount: 101, reference: null }));
  });
});