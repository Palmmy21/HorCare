/**
 * What someone typed in the "เบอร์โทร หรือ อีเมล" box on the admin / staff sign-in.
 * An email signs in to an administrator account directly; a Thai phone number (0812345678, 081-234-5678, +66812345678)
 * is tried as an administrator's phone first, then as a housekeeper's.
 */
export type LoginId = { kind: 'email'; email: string } | { kind: 'phone'; phone: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseLoginId(raw: string): LoginId | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.includes('@')) return EMAIL_RE.test(v) ? { kind: 'email', email: v.toLowerCase() } : null;
  if (!/^[0-9+\-\s().]+$/.test(v)) return null;
  let d = v.replace(/\D/g, '');
  if (d.startsWith('66') && (d.length === 11 || d.length === 10)) d = `0${d.slice(2)}`;
  return /^0\d{8,9}$/.test(d) ? { kind: 'phone', phone: d } : null;
}
