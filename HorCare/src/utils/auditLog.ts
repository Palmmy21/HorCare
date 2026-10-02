import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { AuditAction, AuditEntry, AuditResourceType } from '../shared/audit';

// Client side of the Activity Log. Entries are append-only: Firestore rules allow
// `create` for the signed-in owner/member (with matching user_id/organization_id)
// and deny every update and delete. Server routes write through api/_audit.ts.

export interface AuditContext {
    organizationId: string;   // owner uid
    userId: string;
    userName: string;
    role: string;
    propertyId: string | null;
}

let context: AuditContext | null = null;

/** Called by App whenever the signed-in user / active property changes. Pass null on logout. */
export function setAuditContext(next: AuditContext | null) {
    context = next;
}

export interface ActivityInput {
    action: AuditAction;
    resourceType: AuditResourceType;
    resourceId?: string | null;
    resourceLabel?: string | null;
    before?: unknown;
    after?: unknown;
    note?: string | null;
    /** Override the property (defaults to the active one). */
    propertyId?: string | null;
}

/** Firestore rejects `undefined`; round-trip through JSON to drop it. */
function clean(value: unknown): unknown {
    if (value === undefined) return null;
    try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

/**
 * Fire-and-forget. Logging must never block or break the action it describes, so
 * every failure is swallowed (and a no-op when nobody is signed in, e.g. maid sessions).
 */
export function logActivity(input: ActivityInput): void {
    void logActivityAsync(input);
}

/** Same as logActivity but resolves once the write settled — use before signing out. */
export async function logActivityAsync(input: ActivityInput): Promise<void> {
    const ctx = context;
    if (!ctx) return;
    try {
        const now = Date.now();
        const eventId = crypto.randomUUID();
        const entry: AuditEntry = {
            event_id: eventId,
            organization_id: ctx.organizationId,
            property_id: input.propertyId === undefined ? ctx.propertyId : input.propertyId,
            user_id: ctx.userId,
            user_name: ctx.userName,
            role: ctx.role,
            action: input.action,
            resource_type: input.resourceType,
            resource_id: input.resourceId ?? null,
            resource_label: input.resourceLabel ?? null,
            timestamp: new Date(now).toISOString(),
            timestamp_ms: now,
            ip_address: null, // not knowable in the browser; server-written events record it
            user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
            before: clean(input.before),
            after: clean(input.after),
            note: input.note ?? null,
        };
        await setDoc(doc(db, `users/${ctx.organizationId}/audit_logs`, eventId), entry)
            .catch(err => console.warn('[audit] write failed:', err?.code ?? err));
    } catch (err) {
        console.warn('[audit] failed:', err);
    }
}

/** Shallow diff of the keys present in `updates`: returns only the ones that changed. */
export function diffFields<T extends object>(
    current: T | undefined,
    updates: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
    const before: Partial<T> = {};
    const after: Partial<T> = {};
    for (const key of Object.keys(updates) as (keyof T)[]) {
        const prev = current?.[key];
        const next = updates[key];
        if (JSON.stringify(prev) !== JSON.stringify(next)) {
            before[key] = prev;
            after[key] = next;
        }
    }
    return Object.keys(after).length > 0 ? { before, after } : null;
}
