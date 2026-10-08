import { describe, expect, it } from 'vitest';
import { csvText } from './csv';

describe('csvText', () => {
  it('quotes every cell and doubles inner quotes', () => {
    expect(csvText([['a', 'b"c'], [1, 2.5]])).toBe('"a","b""c"\r\n"1","2.5"');
  });
  it('keeps text that looks like a formula as text, but leaves negative numbers alone', () => {
    expect(csvText([['=1+1', '+x', '-y', '@z', -5]])).toBe('"\'=1+1","\'+x","\'-y","\'@z","-5"');
  });
  it('keeps Thai and commas intact', () => {
    expect(csvText([['ค่าเช่า, ห้อง 1']])).toBe('"ค่าเช่า, ห้อง 1"');
  });
});