// The tenant portal talks only to /api/portal (and the other APIs' portal actions), never to Firestore.
// The link in the address bar (?p=…) is the tenant's credential; the property PIN, when there is one,
// is kept for this browser tab and sent with every call.

const PIN_KEY = 'horcare_portal_pin';

/**
 * The portal link of this page: the value after ?p=, or — transitional — a signed older link
 * (?uid=&bid=&rid=&t=, see api/_portal-token.ts) packed the way the server accepts it. '' when there is neither.
 */
export function portalLink(): string {
  const p = new URLSearchParams(window.location.search);
  const packed = p.get('p');
  if (packed) return packed;
  const [uid, bid, rid, t] = ['uid', 'bid', 'rid', 't'].map(k => p.get(k) ?? '');
  return uid && bid && rid && t ? [uid, bid, rid, `h.${t}`].join('~') : '';
}

/** True for unsigned old `?uid=&bid=&rid=` links, which no longer open a portal. */
export function isLegacyPortalUrl(): boolean {
  const p = new URLSearchParams(window.location.search);
  return !p.has('p') && !p.has('t') && p.has('uid') && p.has('bid') && p.has('rid');
}

export function portalPin(): string {
  try { return sessionStorage.getItem(PIN_KEY) ?? ''; } catch { return ''; }
}

export function setPortalPin(pin: string) {
  try { if (pin) sessionStorage.setItem(PIN_KEY, pin); else sessionStorage.removeItem(PIN_KEY); } catch { /* private mode: asked again next time */ }
}

export class PortalError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** POST to an API route as this portal. Throws PortalError with the API's error code. */
export async function portalPost<T = Record<string, unknown>>(route: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, portal: portalLink(), pin: portalPin() || undefined }),
  });
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new PortalError(data.error ?? `http_${res.status}`, res.status);
  return data;
}

/** /api/portal actions. */
export const portalCall = <T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}) =>
  portalPost<T>('portal', { ...body, action });
