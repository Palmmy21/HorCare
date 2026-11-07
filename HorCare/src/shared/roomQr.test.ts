import { describe, expect, it } from 'vitest';
import { chunk, paginateForPrint, roomQrState, sortForPrint } from './roomQr';

describe('roomQrState', () => {
  it('reads the room', () => {
    expect(roomQrState({})).toBe('unregistered');
    expect(roomQrState({ line_user_id: 'U1' })).toBe('linked');
    expect(roomQrState({ line_user_id: 'U1', line_unreachable: true })).toBe('unreachable');
  });
});

describe('sheet layout', () => {
  it('chunks without losing rooms', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it('orders by floor, then room number as a number', () => {
    const sorted = sortForPrint([
      { room_number: '210', floor: '2' }, { room_number: '101', floor: '1' }, { room_number: '29', floor: '2' },
    ]);
    expect(sorted.map(r => r.room_number)).toEqual(['101', '29', '210']);
  });

  it('starts each floor on a new page and numbers pages across the whole sheet', () => {
    const rooms = [
      ...Array.from({ length: 10 }, (_, i) => ({ room_number: `1${i}`, floor: '1' })),
      { room_number: '201', floor: '2' },
    ];
    expect(paginateForPrint(rooms, 9).map(p => [p.group, p.items.length, p.page, p.pages])).toEqual([
      ['1', 9, 1, 3], ['1', 1, 2, 3], ['2', 1, 3, 3],
    ]);
  });

  it('handles several thousand rooms and keeps every one', () => {
    const rooms = Array.from({ length: 5000 }, (_, i) => ({ room_number: String(i), floor: String(i % 20) }));
    expect(paginateForPrint(rooms).flatMap(p => p.items)).toHaveLength(5000);
  });
});
