import { describe, expect, it } from 'vitest';
import {
  canMoveLead, cleanBaht, cleanEndInput, cleanLeadInput, cleanLeaseTerms, cleanPhone, cleanReservationInput, depositsHeld,
  expiringLeases, isReservationLapsed, leaseAlert, renewalDefaults, type Lease,
} from './leasing';

const NOW = new Date('2026-10-08T05:00:00Z'); // 2026-10-08 in Thailand
const UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('lead pipeline', () => {
  it('people move leads forward and back, but never to reserved/won by hand', () => {
    expect(canMoveLead('new', 'contacted')).toBe(true);
    expect(canMoveLead('viewing', 'contacted')).toBe(true);
    expect(canMoveLead('viewing', 'reserved')).toBe(false);
    expect(canMoveLead('contacted', 'won')).toBe(false);
    expect(canMoveLead('reserved', 'lost')).toBe(false);
    expect(canMoveLead('won', 'new')).toBe(false);
    expect(canMoveLead('lost', 'new')).toBe(true);
  });
});

describe('cleanPhone / cleanBaht', () => {
  it('normalises Thai numbers and rejects junk', () => {
    expect(cleanPhone('081-234-5678')).toBe('0812345678');
    expect(cleanPhone('')).toBeNull();
    expect(cleanPhone('1234')).toBeUndefined();
    expect(cleanPhone(5)).toBeUndefined();
  });
  it('baht → satang, with limits', () => {
    expect(cleanBaht(3500.5)).toBe(350050);
    expect(cleanBaht('')).toBeNull();
    expect(cleanBaht(-1)).toBeUndefined();
    expect(cleanBaht('5')).toBeUndefined();
    expect(cleanBaht(1e12)).toBeUndefined();
  });
});

describe('cleanLeadInput', () => {
  const ok = { name: ' สมชาย ', phone: '081-234-5678', source: 'line', budget: 4000, target_move_in: '2026-11-01', note: ' ชอบห้องชั้นสูง ' };
  it('accepts and normalises a lead', () => {
    expect(cleanLeadInput(ok, NOW)).toEqual({
      name: 'สมชาย', phone: '0812345678', line_id: null, source: 'line', interested_room_id: null, budget_satang: 400000, target_move_in: '2026-11-01', note: 'ชอบห้องชั้นสูง',
    });
  });
  it('needs some way to reach the person', () => {
    expect(cleanLeadInput({ name: 'สมชาย' }, NOW)).toBeNull();
    expect(cleanLeadInput({ name: 'สมชาย', line_id: '@somchai' }, NOW)).not.toBeNull();
  });
  it('rejects bad input', () => {
    for (const bad of [
      { ...ok, name: 'ก' }, { ...ok, phone: '12' }, { ...ok, source: 'tv' }, { ...ok, budget: -5 }, { ...ok, target_move_in: '2020-01-01' },
      { ...ok, target_move_in: '2030-01-01' }, { ...ok, note: 'x'.repeat(1001) }, { ...ok, name: 5 },
    ]) expect(cleanLeadInput(bad as never, NOW)).toBeNull();
  });
});

describe('cleanReservationInput', () => {
  const ok = { lead_id: UUID, room_id: 'r1', deposit: 2000, reserved_until: '2026-10-20' };
  it('accepts a reservation within the window', () => {
    expect(cleanReservationInput(ok, NOW)).toEqual({ lead_id: UUID, room_id: 'r1', deposit_satang: 200000, reserved_until: '2026-10-20' });
    expect(cleanReservationInput({ ...ok, deposit: undefined }, NOW)?.deposit_satang).toBe(0);
  });
  it('rejects past dates, too-long holds, bad ids and amounts', () => {
    for (const bad of [{ reserved_until: '2026-10-07' }, { reserved_until: '2027-03-01' }, { lead_id: 'x' }, { room_id: '' }, { deposit: -1 }, { reserved_until: 'soon' }])
      expect(cleanReservationInput({ ...ok, ...bad }, NOW)).toBeNull();
  });
  it('a hold past its date lapses; a converted one does not', () => {
    expect(isReservationLapsed({ status: 'active', reserved_until: '2026-10-07' }, '2026-10-08')).toBe(true);
    expect(isReservationLapsed({ status: 'active', reserved_until: '2026-10-08' }, '2026-10-08')).toBe(false);
    expect(isReservationLapsed({ status: 'converted', reserved_until: '2026-01-01' }, '2026-10-08')).toBe(false);
  });
});

describe('cleanLeaseTerms / renewal', () => {
  const ok = { tenant_name: 'สมชาย ใจดี', tenant_phone: '0812345678', start_date: '2026-11-01', end_date: '2027-10-31', rent: 3500, deposit: 7000 };
  it('accepts valid terms in satang', () => {
    expect(cleanLeaseTerms(ok)).toMatchObject({ rent_satang: 350000, deposit_satang: 700000, start_date: '2026-11-01' });
  });
  it('rejects reversed/zero-length/over-long ranges and bad money', () => {
    for (const bad of [{ end_date: '2026-11-01' }, { end_date: '2026-10-01' }, { end_date: '2036-01-01' }, { rent: undefined }, { rent: -1 }, { tenant_name: '' }, { start_date: '2026-02-30' }])
      expect(cleanLeaseTerms({ ...ok, ...bad })).toBeNull();
  });
  it('renewal starts the day after and keeps the length and rent', () => {
    const r = renewalDefaults({ start_date: '2026-11-01', end_date: '2027-10-31', rent_satang: 350000, deposit_satang: 700000, tenant_name: 'A B', tenant_phone: null });
    expect(r).toMatchObject({ start_date: '2027-11-01', rent_satang: 350000, deposit_satang: 0 });
    expect(r.end_date).toBe('2028-10-30');
  });
});

describe('lease alerts and totals', () => {
  const lease = (end: string, status: Lease['status'] = 'active', deposit = 100): Pick<Lease, 'status' | 'end_date' | 'deposit_satang'> => ({ status, end_date: end, deposit_satang: deposit });
  it('flags expired and expiring-soon active leases only', () => {
    expect(leaseAlert(lease('2026-10-07'), '2026-10-08')).toBe('expired');
    expect(leaseAlert(lease('2026-12-07'), '2026-10-08')).toBe('expiring'); // exactly 60 days
    expect(leaseAlert(lease('2026-12-08'), '2026-10-08')).toBeNull();
    expect(leaseAlert(lease('2026-10-07', 'ended'), '2026-10-08')).toBeNull();
    expect(leaseAlert(lease('2026-10-20', 'scheduled'), '2026-10-08')).toBeNull();
  });
  it('lists the most urgent first', () => {
    const list = [lease('2026-11-30'), lease('2026-10-01'), lease('2027-06-01'), lease('2026-10-15')];
    expect(expiringLeases(list, '2026-10-08').map(l => l.end_date)).toEqual(['2026-10-01', '2026-10-15', '2026-11-30']);
  });
  it('deposits held count active and scheduled leases only', () => {
    expect(depositsHeld([lease('x', 'active', 700), lease('x', 'scheduled', 300), lease('x', 'ended', 999), lease('x', 'terminated', 5)])).toBe(1000);
  });
});

describe('cleanEndInput', () => {
  it('a normal end needs only a date; an early termination needs a reason', () => {
    expect(cleanEndInput({ ended_on: '2026-10-08' }, { start_date: '2026-01-01' }, NOW)).toEqual({ ended_on: '2026-10-08', reason: null, terminated: false });
    expect(cleanEndInput({ ended_on: '2026-10-08', terminated: true }, { start_date: '2026-01-01' }, NOW)).toBeNull();
    expect(cleanEndInput({ ended_on: '2026-10-08', terminated: true, reason: 'ย้ายงาน' }, { start_date: '2026-01-01' }, NOW)?.terminated).toBe(true);
  });
  it('rejects dates before the start or far in the future', () => {
    expect(cleanEndInput({ ended_on: '2025-12-31' }, { start_date: '2026-01-01' }, NOW)).toBeNull();
    expect(cleanEndInput({ ended_on: '2027-01-01' }, { start_date: '2026-01-01' }, NOW)).toBeNull();
  });
});