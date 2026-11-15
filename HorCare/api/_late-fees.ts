import { db } from './_firebase.js';
import { isLateFeeActive, lateFeeAmount, lateFeeFineId } from '../src/shared/lateFee.js';
import type { LateFeeConfig } from '../src/types/index.js';

/**
 * Keep the late-fee fine of one unpaid bill up to date (called by the daily remind-bills cron).
 * One fine per bill (`fines/late_<billId>`): created when the bill passes its due date + grace days, and for per-day
 * fees its amount grows each day until the bill is paid. A fine the tenant has already paid or sent a slip for is
 * never changed. Returns the fee now owed (0 = none).
 */
export async function upsertLateFee(
    buildingPath: string,
    bill: { id: string; room_id: string; room_number: string; month: string },
    cfg: LateFeeConfig | undefined,
    /** the bill's due date, 'YYYY-MM-DD' (resolveDueDate) */
    dueDate: string,
    today: string,
): Promise<number> {
    if (!isLateFeeActive(cfg)) return 0;
    const fee = lateFeeAmount(cfg, dueDate, today);
    const ref = db.doc(`${buildingPath}/fines/${lateFeeFineId(bill.id)}`);
    const snap = await ref.get();
    if (fee <= 0) {
        // not late (any more): the due date moved — set on the bill, or counted from the issue date — so a late fee
        // this cron charged earlier is withdrawn, unless the tenant already paid it or sent a slip for it
        const old = snap.data() as { status?: string; source?: string } | undefined;
        if (old && old.source === 'late_fee' && old.status !== 'paid' && old.status !== 'pending') await ref.delete();
        return 0;
    }
    const now = new Date().toISOString();
    if (!snap.exists) {
        await ref.set({
            id: ref.id,
            room_id: bill.room_id,
            room_number: bill.room_number,
            reason: `ค่าปรับชำระล่าช้า บิลรอบ ${bill.month}`,
            amount: fee,
            date: today,
            status: 'unpaid',
            source: 'late_fee',
            bill_id: bill.id,
            created_at: now,
            updated_at: now,
        });
        return fee;
    }
    const existing = snap.data() as { status?: string; amount?: number };
    if (existing.status === 'paid' || existing.status === 'pending') return Number(existing.amount) || 0;
    if (Number(existing.amount) !== fee) await ref.update({ amount: fee, updated_at: now });
    return fee;
}
