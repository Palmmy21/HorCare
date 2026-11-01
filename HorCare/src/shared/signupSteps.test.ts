import { describe, expect, it } from 'vitest';
import { firstIncompleteStep, SIGNUP_STEPS, signupStepIssue, type SignupData } from './signupSteps';

const ok: SignupData = {
  email: 'owner@example.com', password: 'secret123', firstName: 'สมชาย', lastName: 'ใจดี', phone: '081-234-5678',
  dormName: 'หอพักสุขใจ', elecRate: 8, waterRate: 18, roomRent: 3500, dueDay: 5,
};

describe('sign-up steps', () => {
  it('asks a few things per step, account first', () => {
    expect(SIGNUP_STEPS.map(s => s.id)).toEqual(['account', 'about', 'place', 'rates']);
  });

  it('a complete form passes every step', () => {
    for (const s of SIGNUP_STEPS) expect(signupStepIssue(s.id, ok)).toBeNull();
    expect(firstIncompleteStep(ok)).toBeNull();
  });

  it('account: a real-looking email and a password of 8+ characters', () => {
    expect(signupStepIssue('account', { ...ok, email: 'nope' })).toContain('อีเมล');
    expect(signupStepIssue('account', { ...ok, email: ' owner@example.com ' })).toBeNull();
    expect(signupStepIssue('account', { ...ok, password: '1234567' })).toContain('8');
  });

  it('about: both names and a 9–10 digit phone (dashes and spaces allowed)', () => {
    expect(signupStepIssue('about', { ...ok, lastName: '  ' })).toContain('นามสกุล');
    expect(signupStepIssue('about', { ...ok, phone: '0812' })).toContain('เบอร์');
    expect(signupStepIssue('about', { ...ok, phone: '02 123 4567' })).toBeNull();
    expect(signupStepIssue('about', { ...ok, phone: '0812345678901' })).toContain('เบอร์');
  });

  it('place needs a name; rates refuse negatives and impossible due days', () => {
    expect(signupStepIssue('place', { ...ok, dormName: '' })).not.toBeNull();
    expect(signupStepIssue('rates', { ...ok, roomRent: -1 })).not.toBeNull();
    expect(signupStepIssue('rates', { ...ok, dueDay: 0 })).toContain('1–31');
    expect(signupStepIssue('rates', { ...ok, dueDay: 32 })).toContain('1–31');
    expect(signupStepIssue('rates', { ...ok, roomRent: 0 })).toBeNull(); // free rooms are allowed
  });

  it('reports the first step that still needs work', () => {
    expect(firstIncompleteStep({ ...ok, phone: '', dormName: '' })).toBe('about');
  });
});
