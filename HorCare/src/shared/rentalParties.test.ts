import { describe, expect, it } from 'vitest';
import {
  cleanSubleaseInput, cleanUnitOwnerInput, currentSublease, feeLabel, ownerStatement, recentMonths, subleaseProblem,
} from './rentalParties';

describe('subleases', () => {
  const lease = { status: 'active', start_date: '2026-01-01', end_date: '2026-12-31' };
  it('cleans the input', () => {
    expect(cleanSubleaseInput({ tenant_name: ' สมชาย  ใจดี ', tenant_phone: '081-234-5678', start_date: '2026-03-01', end_date: '2026-09-01', rent: 6000 }))
      .toEqual({ tenant_name: 'สมชาย ใจดี', tenant_phone: '0812345678', start_date: '2026-03-01', end_date: '2026-09-01', rent_satang: 600000, note: null });
    expect(cleanSubleaseInput({ tenant_name: 'ก', start_date: '2026-03-01', end_date: '2026-09-01' })).toBeNull();
    expect(cleanSubleaseInput({ tenant_name: 'สมชาย', start_date: '2026-09-01', end_date: '2026-03-01' })).toBeNull();
  });
  it('must sit inside the lease and not overlap another', () => {
    const inside = { start_date: '2026-03-01', end_date: '2026-09-01' };
    expect(subleaseProblem(lease, inside, [])).toBeNull();
    expect(subleaseProblem(lease, { start_date: '2026-03-01', end_date: '2027-02-01' }, [])).toBe('outside_lease');
    expect(subleaseProblem({ ...lease, status: 'ended' }, inside, [])).toBe('lease_not_active');
    expect(subleaseProblem(lease, inside, [{ status: 'active', start_date: '2026-08-01', end_date: '2026-10-01' }])).toBe('overlaps_sublease');
    expect(subleaseProblem(lease, inside, [{ status: 'ended', start_date: '2026-08-01', end_date: '2026-10-01' }])).toBeNull();
  });
  it('knows who is in the room today', () => {
    const list = [{ status: 'active' as const, start_date: '2026-03-01', end_date: '2026-09-01' }];
    expect(currentSublease(list, '2026-05-01')).toBeDefined();
    expect(currentSublease(list, '2026-09-01')).toBeUndefined();
  });
});

describe('unit owners', () => {
  it('cleans a percent or fixed fee', () => {
    expect(cleanUnitOwnerInput({ name: 'คุณมานัส', fee_type: 'percent', fee_value: '10' })).toMatchObject({ fee_type: 'percent', fee_value: 10 });
    expect(cleanUnitOwnerInput({ name: 'คุณมานัส', fee_type: 'fixed', fee_value: 500 })).toMatchObject({ fee_type: 'fixed', fee_value: 50000 });
    expect(cleanUnitOwnerInput({ name: 'คุณมานัส', fee_type: 'percent', fee_value: 120 })).toBeNull();
    expect(cleanUnitOwnerInput({ name: 'คุณมานัส', fee_type: 'free', fee_value: 0 })).toBeNull();
    expect(feeLabel({ fee_type: 'fixed', fee_value: 50000 })).toBe('500 บาท/ห้อง/เดือน');
  });

  const rooms = [{ id: 'a', room_number: '820/63' }, { id: 'b', room_number: '10' }];
  const bills = [
    { room_id: 'a', month: '2026-11', is_saved: true, payment_status: 'paid', room_rent: 7000 },
    { room_id: 'b', month: '2026-11', is_saved: true, payment_status: 'unpaid', room_rent: 5000 },
    { room_id: 'a', month: '2026-10', is_saved: true, payment_status: 'paid', room_rent: 7000 },
    { room_id: 'c', month: '2026-11', is_saved: true, payment_status: 'paid', room_rent: 9999 },   // not theirs
  ];
  it('pays out collected rent minus the fee, only for the owner\'s rooms and month', () => {
    const s = ownerStatement({ fee_type: 'percent', fee_value: 10, room_ids: ['a', 'b'] }, rooms, bills, '2026-11');
    expect(s).toMatchObject({ rent_billed: 12000, rent_collected: 7000, fee: 700, payout: 6300, outstanding: 5000 });
    expect(s.lines.map(l => l.room_number)).toEqual(['10', '820/63']);
  });
  it('charges a fixed fee only on rooms that brought rent in, and never more than came in', () => {
    const s = ownerStatement({ fee_type: 'fixed', fee_value: 800000, room_ids: ['a', 'b'] }, rooms, bills, '2026-11');
    expect(s.lines.find(l => l.room_id === 'a')).toMatchObject({ fee: 7000, payout: 0 });
    expect(s.lines.find(l => l.room_id === 'b')).toMatchObject({ fee: 0, payout: 0 });
  });
  it('lists recent months newest first', () => {
    expect(recentMonths('2026-01', 3)).toEqual(['2026-01', '2025-12', '2025-11']);
  });
});
