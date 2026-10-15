import { auth } from '../firebase/config';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

/**
 * POST to a /api/<route> endpoint with the caller's Firebase ID token. The server
 * re-checks identity, role permissions and property access on every call.
 */
export async function apiPost<T = unknown>(route: string, body: unknown): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new ApiError(401, 'unauthenticated');
  const res = await fetch(`/api/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const raw = await res.text().catch(() => '');
  let data: { error?: string; message?: string } = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* not JSON: a platform/proxy error page */ }
  if (!res.ok) {
    // Non-JSON failures (Vercel crash page, dev-proxy error) carry the only clue in the body text, e.g. FUNCTION_INVOCATION_FAILED.
    const hint = raw && !data.error ? ` — ${raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}` : '';
    throw new ApiError(res.status, data.error ?? 'request_failed', data.message ?? `เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${res.status})${hint}`);
  }
  return data as T;
}
