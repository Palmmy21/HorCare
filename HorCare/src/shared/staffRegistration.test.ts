import { describe, expect, it } from 'vitest';
import {
  cleanPersonName, isCancel, isRegCode, parseRole, samePhone, sessionExpired, stepRegistration, SESSION_TTL_MS, type RegSession,
} from './staffRegistration';

const start = (): RegSession => ({ line_user_id: 'U1', owner_uid: 'o', building_id: 'b', step: 'role', updated_at: 1000 });

describe('registration code', () => {
  it('accepts only the HCR- format without ambiguous letters, in any case', () => {
    expect(isRegCode('HCR-ABCDEFGH')).toBe(true);
    expect(isRegCode(' hcr-abcdefgh ')).toBe(true);
    expect(isRegCode('HCS-ABCDEFGH')).toBe(false);   // that is the link code of an existing staff record
    expect(isRegCode('HCR-ABCDEFG0')).toBe(false);   // 0 / O / 1 / I are never issued
    expect(isRegCode('HCR-ABC')).toBe(false);
  });
});

describe('answers', () => {
  it('understands the role in Thai, English, by number or from the quick-reply button', () => {
    for (const t of ['ช่าง', ' ช่างซ่อม ', 'Technician', '1', 'role:technician']) expect(parseRole(t)).toBe('technician');
    for (const t of ['แม่บ้าน', 'housekeeper', '2', 'role:housekeeping']) expect(parseRole(t)).toBe('housekeeping');
    for (const t of ['', 'คนสวน', '3', 'ใช่']) expect(parseRole(t)).toBeNull();
  });
  it('accepts a real name and rejects numbers, symbols, markup and absurd lengths', () => {
    expect(cleanPersonName('  สมชาย   ใจดี ')).toBe('สมชาย ใจดี');
    expect(cleanPersonName('John Smith')).toBe('John Smith');
    for (const bad of ['', 'ก', '12345', '!!!', '<script>', 'ก'.repeat(61)]) expect(cleanPersonName(bad)).toBeNull();
  });
  it('treats ยกเลิก as cancel', () => {
    expect(isCancel(' ยกเลิก ')).toBe(true);
    expect(isCancel('Cancel')).toBe(true);
    expect(isCancel('ช่าง')).toBe(false);
  });
  it('matches phone numbers by their digits', () => {
    expect(samePhone('081-234-5678', '0812345678')).toBe(true);
    expect(samePhone('0812345678', '0812345679')).toBe(false);
    expect(samePhone(null, '0812345678')).toBe(false);
  });
});

describe('the conversation', () => {
  it('walks role → name → phone → confirm → submit', () => {
    let s: RegSession | null = start();
    let r = stepRegistration(s, 'ช่าง', 2000); s = r.session!;
    expect(r.reply.kind).toBe('ask_name'); expect(s).toMatchObject({ step: 'name', role: 'technician', updated_at: 2000 });
    r = stepRegistration(s, 'สมชาย ใจดี'); s = r.session!;
    expect(r.reply.kind).toBe('ask_phone');
    r = stepRegistration(s, '081-234-5678'); s = r.session!;
    expect(r.reply).toEqual({ kind: 'ask_confirm', role: 'technician', name: 'สมชาย ใจดี', phone: '0812345678' });
    r = stepRegistration(s, 'ใช่');
    expect(r.reply).toEqual({ kind: 'submit', role: 'technician', name: 'สมชาย ใจดี', phone: '0812345678' });
    expect(r.session).toBeNull();
  });

  it('a wrong answer repeats the same question and keeps what was already given', () => {
    const s: RegSession = { ...start(), step: 'phone', role: 'housekeeping', name: 'สมศรี' };
    const r = stepRegistration(s, '123');
    expect(r.reply).toEqual({ kind: 'retry', step: 'phone' });
    expect(r.session).toMatchObject({ step: 'phone', name: 'สมศรี' });
    expect(stepRegistration(start(), 'อะไรก็ไม่รู้').reply).toEqual({ kind: 'retry', step: 'role' });
  });

  it('ยกเลิก ends the conversation at every step, and "แก้ไข" at the end starts over', () => {
    for (const step of ['role', 'name', 'phone', 'confirm'] as const) {
      const r = stepRegistration({ ...start(), step, role: 'technician', name: 'สมชาย', phone: '0812345678' }, 'ยกเลิก');
      expect(r.session).toBeNull();
      expect(r.reply.kind).toBe('cancelled');
    }
    const redo = stepRegistration({ ...start(), step: 'confirm', role: 'technician', name: 'สมชาย', phone: '0812345678' }, 'แก้ไข');
    expect(redo.session).toMatchObject({ step: 'role' });
    expect(redo.session?.name).toBeUndefined();
    const unsure = stepRegistration({ ...start(), step: 'confirm', role: 'technician', name: 'สมชาย', phone: '0812345678' }, 'อืม');
    expect(unsure.reply.kind).toBe('ask_confirm');
    expect(unsure.session?.step).toBe('confirm');
  });

  it('an unanswered conversation expires', () => {
    expect(sessionExpired({ updated_at: 0 }, SESSION_TTL_MS - 1)).toBe(false);
    expect(sessionExpired({ updated_at: 0 }, SESSION_TTL_MS + 1)).toBe(true);
  });
});
