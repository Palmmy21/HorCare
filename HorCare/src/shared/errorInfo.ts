// Normalises whatever a catch block receives (Error, Firebase/Firestore error, API error, string…) into
// the few fields the app reads, so callers never need `any`.
export interface ErrorInfo {
  message: string;
  code?: string;
  status?: number;
  /** Stripe's HTTP status on its errors. */
  statusCode?: number;
  name?: string;
}

export function errorInfo(e: unknown): ErrorInfo {
  if (typeof e === 'string') return { message: e };
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown };
    return {
      message: typeof o.message === 'string' ? o.message : '',
      code: typeof o.code === 'string' || typeof o.code === 'number' ? String(o.code) : undefined,
      status: typeof o.status === 'number' ? o.status : undefined,
      statusCode: typeof o.statusCode === 'number' ? o.statusCode : undefined,
      name: typeof o.name === 'string' ? o.name : undefined,
    };
  }
  return { message: '' };
}