import { describe, expect, it } from 'vitest';
import { describeBinding, lineRef, openAlertCount, sortAlerts } from './security-alerts';

describe('describeBinding', () => {
  it('a first-time binding is informational', () => {
    expect(describeBinding({ roomNumber: '101', replacedExisting: false, movedFromRoomNumber: null, via: 'invitation' }))
      .toMatchObject({ type: 'line_bound', severity: 'info' });
  });
  it('replacing the room\'s LINE account is a warning', () => {
    const a = describeBinding({ roomNumber: '101', replacedExisting: true, movedFromRoomNumber: null, via: 'room_number' });
    expect(a).toMatchObject({ type: 'line_replaced', severity: 'warning' });
    expect(a.message).toContain('101');
  });
  it('an account moving between rooms is a warning that names both rooms, and wins over "replaced"', () => {
    const a = describeBinding({ roomNumber: '202', replacedExisting: true, movedFromRoomNumber: '101', via: 'invitation' });
    expect(a.type).toBe('line_moved');
    expect(a.message).toContain('101');
    expect(a.message).toContain('202');
  });
});

describe('helpers', () => {
  it('lineRef exposes only the last 4 characters', () => {
    expect(lineRef('U' + 'a'.repeat(28) + '1234')).toBe('1234');
  });
  it('counts open alerts and sorts open warnings first, newest first', () => {
    const l = [
      { id: 'a', status: 'acknowledged' as const, severity: 'warning' as const, created_at: '2026-10-03' },
      { id: 'b', status: 'open' as const, severity: 'info' as const, created_at: '2026-10-02' },
      { id: 'c', status: 'open' as const, severity: 'warning' as const, created_at: '2026-10-01' },
      { id: 'd', status: 'open' as const, severity: 'info' as const, created_at: '2026-10-04' },
    ];
    expect(openAlertCount(l)).toBe(3);
    expect(sortAlerts(l).map(x => x.id)).toEqual(['c', 'd', 'b', 'a']);
  });
});