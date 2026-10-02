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
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'request_failed', data.message);
  return data as T;
}
