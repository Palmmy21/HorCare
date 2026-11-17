// The owner's e-signature: drawn once, then printed on every document the organisation issues (ใบแจ้งหนี้, ใบเสร็จ,
// สรุปยอด, ใบสำคัญ, and offered for the lessor's side of a contract). Stored at users/{ownerUid}/owner_signature/current.
// Only the owner writes it; staff and the tenant portal only read it (Firestore rules / api/_portal). Pure.

export const OWNER_SIGNATURE_COLLECTION = 'owner_signature';
export const OWNER_SIGNATURE_DOC = 'current';
export const ownerSignaturePath = (ownerUid: string) => `users/${ownerUid}/${OWNER_SIGNATURE_COLLECTION}/${OWNER_SIGNATURE_DOC}`;

/** A drawn signature is mostly transparent PNG (tens of KB); this keeps the document far below Firestore's 1 MiB. */
export const MAX_OWNER_SIGNATURE_CHARS = 300_000;
const PNG_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export interface OwnerSignature {
  /** data URL of the drawn signature */
  image: string;
  /** the name printed under it, when the owner gave one */
  signer_name?: string;
  updated_at: string;
}

/** A usable signature image, or null. */
export function cleanSignatureImage(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > MAX_OWNER_SIGNATURE_CHARS || !PNG_DATA_URL.test(value)) return null;
  return value;
}

/** The stored document as read back (null when missing or broken). */
export function parseOwnerSignature(data: unknown): OwnerSignature | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const image = cleanSignatureImage(d.image);
  if (!image) return null;
  const name = typeof d.signer_name === 'string' ? d.signer_name.trim().slice(0, 120) : '';
  return { image, ...(name ? { signer_name: name } : {}), updated_at: typeof d.updated_at === 'string' ? d.updated_at : '' };
}
