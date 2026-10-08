import { describe, expect, it } from 'vitest';
import {
  addDays, cleanClosureInput, cleanWalkInInput, closuresOn, isValidDate, todayTh, upcomingClosures, type ShopClosure,
} from './market';

// 2026-10-10 02:00 in Bangkok (still the 9th in UTC)
const NOW = new Date('2026-10-09T19:00:00Z');

describe('dates', () => {
  it('todayTh uses the Thai calendar day', () => {
    expect(todayTh(NOW)).toBe('2026-10-10');
    expect(todayTh(new Date('2026-10-10T16:59:00Z'))).toBe('2026-10-10');
    expect(todayTh(new Date('2026-10-10T17:00:00Z'))).toBe('2026-10-11');
  });
  it('validates and shifts dates', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-10-10')).toBe(true);
    expect(isValidDate('10/10/2026')).toBe(false);
    expect(isValidDate(20261010)).toBe(false);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('cleanClosureInput', () => {
  const ok = { from_date: '2026-10-12', to_date: '2026-10-13', reason: 'sick' };
  it('accepts a valid range and trims the note', () => {
    expect(cleanClosureInput({ ...ok, note: ' ไปหาหมอ ' }, NOW)).toEqual({ ...ok, note: 'ไปหาหมอ' });
    expect(cleanClosureInput({ ...ok, from_date: '2026-10-10', to_date: '2026-10-10' }, NOW)).not.toBeNull();
  });
  it('rejects the past, reversed ranges, long spans, bad reasons and notes', () => {
    for (const bad of [
      { ...ok, from_date: '2026-10-09' }, { ...ok, to_date: '2026-10-11' }, { ...ok, to_date: '2026-12-31' },
      { ...ok, reason: 'vacation' }, { ...ok, reason: undefined }, { ...ok, note: 'x'.repeat(201) }, { ...ok, note: 5 },
      { ...ok, from_date: 'soon' },
    ]) expect(cleanClosureInput(bad as never, NOW)).toBeNull();
  });
});

describe('closure queries', () => {
  const c = (id: string, room: string, from: string, to: string, status: 'active' | 'cancelled' = 'active'): ShopClosure =>
    ({ id, room_id: id, room_number: room, from_date: from, to_date: to, reason: 'other', note: null, status, created_at: '' });
  const list = [c('a', 'A10', '2026-10-10', '2026-10-12'), c('b', 'A2', '2026-10-11', '2026-10-11'), c('c', 'A3', '2026-10-10', '2026-10-10', 'cancelled'), c('d', 'B1', '2026-10-01', '2026-10-05')];
  it('closuresOn includes only active covering ranges, sorted naturally', () => {
    expect(closuresOn(list, '2026-10-11').map(x => x.id)).toEqual(['b', 'a']);
    expect(closuresOn(list, '2026-10-10').map(x => x.id)).toEqual(['a']);
  });
  it('upcoming drops finished and cancelled ones', () => {
    expect(upcomingClosures(list, '2026-10-10').map(x => x.id)).toEqual(['a', 'b']);
  });
});

describe('cleanWalkInInput', () => {
  const ok = { date: '2026-10-11', name: ' สมชาย ', phone: '081-234-5678', goods: ' ผลไม้ ' };
  it('normalises phone and text', () => {
    expect(cleanWalkInInput(ok, NOW)).toEqual({ date: '2026-10-11', name: 'สมชาย', phone: '0812345678', goods: 'ผลไม้' });
  });
  it('limits the date window and rejects bad contact data', () => {
    for (const bad of [
      { ...ok, date: '2026-10-09' }, { ...ok, date: '2026-10-25' }, { ...ok, phone: '12345' }, { ...ok, phone: '1812345678' },
      { ...ok, name: 'ก' }, { ...ok, goods: '' }, { ...ok, goods: 'x'.repeat(101) }, { ...ok, name: 5 },
    ]) expect(cleanWalkInInput(bad as never, NOW)).toBeNull();
    expect(cleanWalkInInput({ ...ok, date: '2026-10-24' }, NOW)).not.toBeNull();
  });
});