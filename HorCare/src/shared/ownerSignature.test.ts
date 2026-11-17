import { describe, expect, it } from 'vitest';
import { cleanSignatureImage, MAX_OWNER_SIGNATURE_CHARS, ownerSignaturePath, parseOwnerSignature } from './ownerSignature';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('owner signature', () => {
  it('lives under the owner, not a property', () => {
    expect(ownerSignaturePath('u1')).toBe('users/u1/owner_signature/current');
  });

  it('accepts only an image data URL of reasonable size', () => {
    expect(cleanSignatureImage(PNG)).toBe(PNG);
    expect(cleanSignatureImage('')).toBeNull();
    expect(cleanSignatureImage('https://evil.example/x.png')).toBeNull();
    expect(cleanSignatureImage('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(cleanSignatureImage(`data:image/png;base64,${'A'.repeat(MAX_OWNER_SIGNATURE_CHARS)}`)).toBeNull();
  });

  it('reads back the stored document, dropping a broken one', () => {
    expect(parseOwnerSignature({ image: PNG, signer_name: '  สมชาย ', updated_at: '2026-11-18T00:00:00Z' }))
      .toEqual({ image: PNG, signer_name: 'สมชาย', updated_at: '2026-11-18T00:00:00Z' });
    expect(parseOwnerSignature({ image: PNG, signer_name: '' })).toEqual({ image: PNG, updated_at: '' });
    expect(parseOwnerSignature({ image: 'nope' })).toBeNull();
    expect(parseOwnerSignature(undefined)).toBeNull();
  });
});
