import { describe, expect, it } from 'vitest';
import { cleanOverride, contractOccupancy, contractTerms, effectiveOccupancy, type LeaseFacts } from './roomOccupancy';

const today = '2026-10-25';
const lease = (over: Partial<LeaseFacts> = {}): LeaseFacts => ({ id: 'L1', room_id: 'r1', status: 'active', start_date: '2026-01-01', end_date: '2026-12-31', tenant_name: 'สมชาย', ...over });

describe('contractOccupancy', () => {
  it('an active lease means occupied, even if the profile says the tenant left', () => {
    const o = contractOccupancy({ leases: [lease()], profile: { expected_move_out: '2026-09-01' } }, today);
    expect(o.status).toBe('occupied');
    expect(o.source).toBe('lease');
    expect(o.warning).toBeUndefined();
  });

  it('flags an active lease that ran past its end date but stays occupied', () => {
    const o = contractOccupancy({ leases: [lease({ end_date: '2026-10-01' })] }, today);
    expect(o.status).toBe('occupied');
    expect(o.warning).toBeTruthy();
  });

  it('a scheduled lease or a live reservation reserves the room', () => {
    expect(contractOccupancy({ leases: [lease({ status: 'scheduled', start_date: '2026-11-01' })] }, today).status).toBe('reserved');
    expect(contractOccupancy({ reservations: [{ id: 'R', room_id: 'r1', status: 'active', reserved_until: '2026-11-05' }] }, today).status).toBe('reserved');
  });

  it('a lapsed reservation and ended leases fall through to the profile', () => {
    const o = contractOccupancy({
      leases: [lease({ status: 'ended' })],
      reservations: [{ id: 'R', room_id: 'r1', status: 'active', reserved_until: '2026-10-01' }],
      profile: { move_in_date: '2026-02-01' },
    }, today);
    expect(o).toMatchObject({ status: 'occupied', source: 'profile' });
  });

  it('reads the tenant profile: move-out, E-Sign, move-in dates', () => {
    expect(contractOccupancy({ profile: { move_in_date: '2026-01-01', expected_move_out: '2026-10-20' } }, today).status).toBe('vacant');
    expect(contractOccupancy({ profile: { expected_move_out: '2026-11-30', move_in_date: '2026-01-01' } }, today).status).toBe('occupied');
    expect(contractOccupancy({ profile: { signed_contract: { id: 'c', status: 'pending_lessee' } } }, today).status).toBe('reserved');
    expect(contractOccupancy({ profile: { signed_contract: { id: 'c', status: 'signed', start_date: '2026-12-01' } } }, today).status).toBe('reserved');
    expect(contractOccupancy({ profile: { signed_contract: { id: 'c', status: 'signed', start_date: '2026-01-01', end_date: '2027-01-01' } } }, today))
      .toMatchObject({ status: 'occupied', source: 'e_sign' });
    expect(contractOccupancy({ profile: { move_in_date: '2026-11-15' } }, today).status).toBe('reserved');
  });

  it('a profile whose contract ended with no move-out stays occupied with a warning', () => {
    const o = contractOccupancy({ profile: { move_in_date: '2025-01-01', contract_end_date: '2026-01-01' } }, today);
    expect(o.status).toBe('occupied');
    expect(o.warning).toBeTruthy();
  });

  it('with no contract at all, keeps the old hand-set status, else vacant', () => {
    expect(contractOccupancy({ legacyStatus: 'occupied' }, today)).toMatchObject({ status: 'occupied', source: 'legacy' });
    expect(contractOccupancy({}, today)).toMatchObject({ status: 'vacant', source: 'none' });
    // contract facts beat the legacy value
    expect(contractOccupancy({ legacyStatus: 'occupied', profile: { expected_move_out: '2026-10-01' } }, today).status).toBe('vacant');
  });
});

describe('admin override', () => {
  const auto = contractOccupancy({ leases: [lease()] }, today);

  it('needs a different status and a reason', () => {
    const now = new Date('2026-10-25T03:00:00Z');
    expect(cleanOverride({ status: 'occupied', reason: 'ทดสอบ' }, auto, { now })).toBeNull();      // same as contract
    expect(cleanOverride({ status: 'vacant', reason: '  ' }, auto, { now })).toBeNull();           // no reason
    expect(cleanOverride({ status: 'gone', reason: 'ทดสอบ' }, auto, { now })).toBeNull();          // not a status
    expect(cleanOverride({ status: 'vacant', reason: 'ผู้เช่าทิ้งห้อง' }, auto, { now, by: 'แอดมิน' }))
      .toMatchObject({ status: 'vacant', reason: 'ผู้เช่าทิ้งห้อง', contract_key: auto.key, set_by: 'แอดมิน' });
  });

  it('applies while the contract is unchanged, and lapses when the contract changes', () => {
    const ov = cleanOverride({ status: 'vacant', reason: 'ผู้เช่าทิ้งห้อง' }, auto, { now: new Date() })!;
    expect(effectiveOccupancy(auto, ov)).toMatchObject({ status: 'vacant', override: ov });
    const renewed = contractOccupancy({ leases: [lease({ end_date: '2027-12-31' })] }, today);
    const eff = effectiveOccupancy(renewed, ov);
    expect(eff.status).toBe('occupied');
    expect(eff.override).toBeUndefined();
  });
});

describe('contractTerms', () => {
  it('reads the active lease first, then the signed E-Sign contract, then the profile', () => {
    expect(contractTerms({ leases: [lease()] }, today)).toEqual({ tenant: 'สมชาย', end: '2026-12-31' });
    expect(contractTerms({ profile: { full_name: 'ก', signed_contract: { id: 'c', status: 'signed', end_date: '2027-01-31' } } }, today)).toEqual({ tenant: 'ก', end: '2027-01-31' });
    expect(contractTerms({ profile: { full_name: 'ข', move_in_date: '2026-01-01', contract_end_date: '2026-11-30' } }, today)).toEqual({ tenant: 'ข', end: '2026-11-30' });
  });
  it('is empty once the tenant has moved out or nobody holds the room', () => {
    expect(contractTerms({ profile: { full_name: 'ค', expected_move_out: '2026-10-01' } }, today)).toEqual({});
    expect(contractTerms({}, today)).toEqual({});
  });
});
