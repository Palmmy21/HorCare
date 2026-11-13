import { describe, expect, it } from 'vitest';
import { parseLoginId } from './loginId';

describe('parseLoginId', () => {
  it('reads an email, lower-cased', () => {
    expect(parseLoginId('  Admin.A@Example.com ')).toEqual({ kind: 'email', email: 'admin.a@example.com' });
  });

  it('reads Thai phone numbers in the ways people type them', () => {
    for (const v of ['0812345678', '081-234-5678', '081 234 5678', '+66812345678', '66812345678', '+66 81 234 5678']) {
      expect(parseLoginId(v)).toEqual({ kind: 'phone', phone: '0812345678' });
    }
    expect(parseLoginId('021234567')).toEqual({ kind: 'phone', phone: '021234567' });
  });

  it('refuses anything else', () => {
    for (const v of ['', '   ', 'admin', 'a@b', '12345', '812345678', '08123456789012', 'abc0812345678']) expect(parseLoginId(v)).toBeNull();
  });
});
