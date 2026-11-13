import { describe, expect, it } from 'vitest';
import { isLiffId, joinKind, joinUrl, liffChannelOf } from './joinCodes';

describe('joinKind', () => {
  it('tells the registrations apart, including the two HCR- lengths', () => {
    expect(joinKind('HCR-ABCDEFGHJK')).toBe('room');
    expect(joinKind('hcr-abcdefgh')).toBe('staff_reg');
    expect(joinKind('HCS-ABCDEFGH')).toBe('staff_link');
    expect(joinKind('HCO-ABCDEFGH')).toBe('owner_link');
    expect(joinKind(' HCP-ABCDEFGH ')).toBe('pos_link');
    expect(joinKind('HCW-AB12CD34')).toBe('walkin');
  });
  it('refuses anything else', () => {
    expect(joinKind('HCR-ABCDEFGHI')).toBeNull();   // 9 characters
    expect(joinKind('HCS-ABCDEFG1')).toBeNull();    // 1 is not in the alphabet
    expect(joinKind('')).toBeNull();
    expect(joinKind(42)).toBeNull();
  });
});

describe('joinUrl', () => {
  it('builds the short address, normalised', () => {
    expect(joinUrl('https://hor-care.vercel.app/', 'hcs-abcdefgh')).toBe('https://hor-care.vercel.app/j/HCS-ABCDEFGH');
  });
});

describe('LIFF ids', () => {
  it('recognises a LIFF id and its channel', () => {
    expect(isLiffId('2001234567-AbCdEfGh')).toBe(true);
    expect(isLiffId('not-a-liff')).toBe(false);
    expect(liffChannelOf('2001234567-AbCdEfGh')).toBe('2001234567');
  });
});
