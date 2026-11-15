import { describe, expect, it } from 'vitest';
import { cleanPlaceIssuers, issuerFor } from './billIssuer';

const bc = {
  dorm_name: 'CTM', dorm_address: '1 ถ.มิตรภาพ', dorm_phone: '081', dorm_logo: 'data:logo',
  place_issuers: { 'วันเดอร์แลนด์': { name: 'วันเดอร์แลนด์', phone: '089' }, 'ตึก B': { address: '2 ถ.สุทธวาส' } },
};

describe('issuerFor', () => {
  it('a unit with no building, or one the owner set nothing for, carries the branch', () => {
    expect(issuerFor(bc, undefined)).toEqual({ name: 'CTM', address: '1 ถ.มิตรภาพ', phone: '081', logo: 'data:logo' });
    expect(issuerFor(bc, 'ตึก Z')).toMatchObject({ name: 'CTM' });
    expect(issuerFor(undefined, 'x')).toEqual({ name: undefined, address: undefined, phone: undefined, logo: undefined });
  });

  it('a building with its own details uses them, and the branch fills what is empty', () => {
    expect(issuerFor(bc, ' วันเดอร์แลนด์ ')).toEqual({ name: 'วันเดอร์แลนด์', address: '1 ถ.มิตรภาพ', phone: '089', logo: 'data:logo' });
    expect(issuerFor(bc, 'ตึก B')).toMatchObject({ name: 'CTM', address: '2 ถ.สุทธวาส' });
  });
});

describe('cleanPlaceIssuers', () => {
  it('keeps filled fields of buildings that exist, and nothing else', () => {
    expect(cleanPlaceIssuers({ A: { name: ' หอ A ', address: '' }, gone: { name: 'x' }, B: { name: '  ' } }, ['A', 'B'])).toEqual({ A: { name: 'หอ A' } });
    expect(cleanPlaceIssuers({ B: {} }, ['B'])).toBeUndefined();
    expect(cleanPlaceIssuers(undefined, ['A'])).toBeUndefined();
  });
});
