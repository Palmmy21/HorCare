import { describe, expect, it } from 'vitest';
import {
  canTransition, decideSettlement, effectiveStatus, INTENT_STATUSES, intentExpiry, isFinal, isOpen, isReference, makeReference, netAmount, REFERENCE_RE,
  type IntentStatus,
} from './paymentGateway';

describe('lifecycle', () => {
  it('only moves forward along allowed steps', () => {
    expect(canTransition('created', 'pending')).toBe(true);
    expect(canTransition('pending', 'paid')).toBe(true);
    expect(canTransition('paid', 'refunded')).toBe(true);
    expect(canTransition('paid', 'pending')).toBe(false);
    expect(canTransition('refunded', 'paid')).toBe(false);
    expect(canTransition('failed', 'paid')).toBe(false);
  });
  it('money that arrives after expiry or cancellation is still accepted for handling, never lost', () => {
    expect(canTransition('expired', 'paid')).toBe(true);
    expect(canTransition('cancelled', 'needs_review')).toBe(true);
  });
  it('every status is known and final ones lead nowhere', () => {
    for (const s of INTENT_STATUSES) expect(typeof isOpen(s)).toBe('boolean');
    for (const s of INTENT_STATUSES.filter(isFinal)) for (const t of INTENT_STATUSES) expect(canTransition(s, t as IntentStatus)).toBe(false);
  });
  it('an open intent past its time is expired without anyone having to run a job', () => {
    const now = Date.parse('2026-10-08T10:00:00Z');
    expect(effectiveStatus({ status: 'pending', expires_at: '2026-10-08T10:30:00Z' }, now)).toBe('pending');
    expect(effectiveStatus({ status: 'pending', expires_at: '2026-10-08T09:59:59Z' }, now)).toBe('expired');
    expect(effectiveStatus({ status: 'paid', expires_at: '2026-10-08T09:00:00Z' }, now)).toBe('paid');
  });
  it('expiry defaults to 30 minutes and is clamped', () => {
    const now = Date.parse('2026-10-08T10:00:00Z');
    expect(intentExpiry(undefined, now)).toBe('2026-10-08T10:30:00.000Z');
    expect(intentExpiry(0, now)).toBe('2026-10-08T10:01:00.000Z');
    expect(Date.parse(intentExpiry(99999, now)) - now).toBe(24 * 60 * 60_000);
  });
});

describe('reference', () => {
  it('is HC plus 10 unambiguous characters, derived from the bytes it is given', () => {
    const r = makeReference(Uint8Array.from({ length: 10 }, (_, i) => i * 7));
    expect(r).toMatch(REFERENCE_RE);
    expect(r).toBe(makeReference(Uint8Array.from({ length: 10 }, (_, i) => i * 7)));
    expect(r).not.toBe(makeReference(Uint8Array.from({ length: 10 }, (_, i) => i * 7 + 1)));
    expect(makeReference([])).toMatch(REFERENCE_RE); // short input never produces garbage
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'hc12345678ab', 'HC1234567890', 'HCABCDEFGHJ', 'XXABCDEFGHJK', 5, undefined]) expect(isReference(bad)).toBe(false);
    expect(isReference('HCABCDEFGHJK')).toBe(true);
  });
});

describe('deciding what a verified payment does', () => {
  const intent = (status: IntentStatus) => ({ status, amount_satang: 350000, expires_at: '2026-10-08T10:30:00Z' });
  const paid = (amount = 350000) => ({ status: 'paid' as const, amount_satang: amount });

  it('settles an open intent paid in full', () => {
    expect(decideSettlement(intent('pending'), paid())).toEqual({ action: 'settle' });
    expect(decideSettlement(intent('created'), paid())).toEqual({ action: 'settle' });
  });
  it('a retried webhook changes nothing', () => {
    expect(decideSettlement(intent('paid'), paid())).toEqual({ action: 'ignore', reason: 'already_applied' });
    expect(decideSettlement(intent('refunded'), paid())).toEqual({ action: 'ignore', reason: 'already_applied' });
  });
  it('a wrong amount is never applied: short or over goes to review', () => {
    expect(decideSettlement(intent('pending'), paid(300000))).toEqual({ action: 'review', reason: 'amount_mismatch', received_satang: 300000 });
    expect(decideSettlement(intent('pending'), paid(400000))).toEqual({ action: 'review', reason: 'amount_mismatch', received_satang: 400000 });
  });
  it('a payment after the QR expired is accepted; after cancellation it needs a human', () => {
    expect(decideSettlement(intent('expired'), paid())).toEqual({ action: 'settle' });
    expect(decideSettlement(intent('cancelled'), paid())).toEqual({ action: 'review', reason: 'after_cancel', received_satang: 350000 });
  });
  it('failure, expiry and refund events mark the intent where that is a legal step', () => {
    expect(decideSettlement(intent('pending'), { status: 'failed', amount_satang: 0 })).toEqual({ action: 'mark', status: 'failed' });
    expect(decideSettlement(intent('pending'), { status: 'expired', amount_satang: 0 })).toEqual({ action: 'mark', status: 'expired' });
    expect(decideSettlement(intent('paid'), { status: 'refunded', amount_satang: 350000 })).toEqual({ action: 'mark', status: 'refunded' });
    expect(decideSettlement(intent('paid'), { status: 'failed', amount_satang: 0 })).toEqual({ action: 'ignore', reason: 'not_applicable' });
    expect(decideSettlement(intent('failed'), { status: 'failed', amount_satang: 0 })).toEqual({ action: 'ignore', reason: 'already_applied' });
  });
  it('net amount after the provider fee never goes negative', () => {
    expect(netAmount(350000, 1200)).toBe(348800);
    expect(netAmount(350000, undefined)).toBe(350000);
    expect(netAmount(1000, 5000)).toBe(0);
  });
});
