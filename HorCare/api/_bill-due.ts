import { db } from './_firebase.js';
import { resolveDueDate, type DueBill } from '../src/shared/billDue.js';

/**
 * The due date of one bill by the property's settings and the room's own terms (src/shared/billDue.ts), for callers
 * that hold neither. '' when they cannot be read: buildBillFlex then works it out from the due day alone.
 */
export async function dueDateOfBill(ownerUid: string, buildingId: string, bill: DueBill & { room_id?: string }): Promise<string> {
    try {
        const base = `users/${ownerUid}/buildings/${buildingId}`;
        const [cfg, room] = await Promise.all([
            db.doc(`${base}/data/config`).get(),
            bill.room_id ? db.doc(`${base}/rooms/${bill.room_id}`).get() : null,
        ]);
        return resolveDueDate(bill, cfg.data()?.bill_customization, room?.data());
    } catch {
        return '';
    }
}
