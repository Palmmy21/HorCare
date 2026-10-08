import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_firebase.js';
import { notify } from './_notify.js';
import { isDueForReminder, type Parcel } from '../src/shared/parcels.js';

/**
 * Daily job (see vercel.json): remind tenants about parcels that have waited for
 * REMIND_AFTER_DAYS, then every REMIND_EVERY_DAYS, up to MAX_REMINDERS.
 * Moves "tenant_notified" parcels to "waiting_pickup" on the first reminder.
 */
export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // fail closed, same as the other cron routes
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
        res.status(401).send('Unauthorized');
        return;
    }

    try {
        // Needs the collection-group index declared in firestore.indexes.json (parcels.status).
        const snap = await db.collectionGroup('parcels').where('status', 'in', ['tenant_notified', 'waiting_pickup']).get();
        const now = Date.now();
        let reminded = 0, skipped = 0, failed = 0;

        for (const d of snap.docs) {
            const parts = d.ref.path.split('/');
            // users/{uid}/buildings/{bid}/parcels/{id}
            if (parts.length !== 6 || parts[0] !== 'users' || parts[2] !== 'buildings') continue;
            const p = d.data() as Parcel;
            if (!isDueForReminder(p, now)) { skipped++; continue; }

            const days = Math.floor((now - Date.parse(p.received_at)) / 86400_000);
            const result = await notify({
                event: 'parcel.overdue', ownerUid: parts[1], buildingId: parts[3], roomId: p.room_id,
                data: { carrier: p.carrier, storage_location: p.storage_location, days },
            });
            if (!result.delivered) { failed++; continue; }
            await d.ref.update({
                status: 'waiting_pickup',
                last_reminded_at: new Date(now).toISOString(),
                reminder_count: (p.reminder_count ?? 0) + 1,
            });
            reminded++;
        }
        res.status(200).json({ reminded, skipped, failed });
    } catch (err) {
        console.error('[remind-parcels]', (err as Error).message);
        res.status(500).json({ error: 'internal_error' });
    }
}
