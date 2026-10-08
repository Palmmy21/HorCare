import { describe, expect, it } from 'vitest';
import { errorInfo } from './errorInfo';

describe('errorInfo', () => {
  it('reads Error, Firebase-style and API-style errors', () => {
    expect(errorInfo(new Error('boom')).message).toBe('boom');
    expect(errorInfo({ code: 'permission-denied', message: 'no' })).toMatchObject({ code: 'permission-denied', message: 'no' });
    expect(errorInfo({ status: 409, code: 'conflict', message: 'x' })).toMatchObject({ status: 409, code: 'conflict' });
    expect(errorInfo({ code: 6 }).code).toBe('6'); // gRPC numeric codes
    expect(errorInfo({ statusCode: 404, code: 'resource_missing' })).toMatchObject({ statusCode: 404 }); // Stripe
  });
  it('never throws on odd values', () => {
    expect(errorInfo('plain')).toEqual({ message: 'plain' });
    expect(errorInfo(null)).toEqual({ message: '' });
    expect(errorInfo(undefined)).toEqual({ message: '' });
    expect(errorInfo(42)).toEqual({ message: '' });
    expect(errorInfo({ message: 5 }).message).toBe('');
  });
});