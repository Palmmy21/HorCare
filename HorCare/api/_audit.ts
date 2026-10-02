import type { VercelRequest } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import type { AuditAction, AuditEntry, AuditResourceType } from '../src/shared/audit.js';

export interface AuditInput {
    ownerUid: string;
    propertyId?: string | null;
    userId: string;
    userName?: string;
    role: string;
    action: AuditAction;
    resourceType: AuditResourceType;
    resourceId?: string | null;
    resourceLabel?: string | null;
    before?: unknown;
    after?: unknown;
    note?: string | null;
    req?: VercelRequest;
}

/** Firestore rejects `undefined`; round-trip through JSON to drop it. */
function clean<T>(value: T): T | null {
    if (value === undefined) return null;
    try { return JSON.parse(JSON.stringify(value)) as T; } catch { return null; }
}

export function clientIp(req?: VercelRequest): string | null {
    if (!req) return null;
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    return first || (req.socket?.remoteAddress ?? null);
}

/**
 * Append an event to users/{ownerUid}/audit_logs. Never throws: an audit failure
 * must not turn a successful business action into an error for the caller.
 * Security rules make this collection append-only for every client.
 */
export async function writeAudit(input: AuditInput): Promise<void> {
    try {
        const now = Date.now();
        const eventId = randomUUID();
        const entry: AuditEntry = {
            event_id: eventId,
            organization_id: input.ownerUid,
            property_id: input.propertyId ?? null,
            user_id: input.userId,
            user_name: input.userName ?? '',
            role: input.role,
            action: input.action,
            resource_type: input.resourceType,
            resource_id: input.resourceId ?? null,
            resource_label: input.resourceLabel ?? null,
            timestamp: new Date(now).toISOString(),
            timestamp_ms: now,
            ip_address: clientIp(input.req),
            user_agent: (input.req?.headers['user-agent'] as string | undefined) ?? null,
            before: clean(input.before),
            after: clean(input.after),
            note: input.note ?? null,
        };
        await db.collection(`users/${input.ownerUid}/audit_logs`).doc(eventId).set(entry);
    } catch (err) {
        console.error('writeAudit failed:', (err as Error).message);
    }
}
