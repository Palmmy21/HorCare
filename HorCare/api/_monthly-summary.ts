/**
 * "ยอดรายเดือน": on the first day of a month (Thai time), each property's owner and finance staff are told how the
 * month just ended went — billed, collected, still unpaid. Called from the daily cron; safe to call every day and
 * more than once (a marker per month makes it run once).
 */
import { db } from './_firebase.js';
import { raiseAlert } from './_alerts.js';
import { thaiMonthLabel } from './_line.js';
import { todayTh } from '../src/shared/market.js';
import { monthFigures, type BillFacts } from '../src/shared/ownerCommands.js';

const baht = (n: number) => `฿${Math.round(n).toLocaleString('th-TH')}`;

/** 'YYYY-MM' of the month before the one `today` ('YYYY-MM-DD') is in. */
export function previousMonth(today: string): string {
    const [y, m] = today.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function monthlySummaryText(name: string, monthLabel: string, bills: BillFacts[], today: string): { title: string; body: string } {
    const f = monthFigures(bills, today);
    const rate = f.billed > 0 ? Math.round((f.collected / f.billed) * 100) : 0;
    return {
        title: `📊 ยอดเดือน${monthLabel} · ${name}`,
        body: `เก็บได้ ${baht(f.collected)} จาก ${baht(f.billed)} (${rate}%) · จ่ายแล้ว ${f.paid} จาก ${f.bills} บิล`
            + (f.unpaid + f.pending > 0 ? ` · ค้าง ${f.unpaid} รอตรวจ ${f.pending}` : ' · เก็บครบทุกบิล'),
    };
}

export async function sendMonthlySummaries(now: Date = new Date()): Promise<{ sent: number; skipped?: string }> {
    const today = todayTh(now);
    if (!today.endsWith('-01')) return { sent: 0, skipped: 'not_first_day' };
    const month = previousMonth(today);
    try {
        await db.doc(`monthly_summary_runs/${month}`).create({ started_at: now.toISOString() });
    } catch {
        return { sent: 0, skipped: 'already_sent' };
    }

    let sent = 0;
    const users = await db.collection('users').get();
    for (const u of users.docs) {
        if (u.data().status === 'banned') continue;
        const buildings = await db.collection(`users/${u.id}/buildings`).get();
        for (const b of buildings.docs) {
            try {
                const bills = (await db.collection(`users/${u.id}/buildings/${b.id}/bills`).where('month', '==', month).get())
                    .docs.map(d => d.data() as BillFacts).filter(x => x.is_saved !== false);
                if (bills.length === 0) continue;   // nothing was billed: nothing to report
                const cfg = (await db.doc(`users/${u.id}/buildings/${b.id}/data/config`).get()).data();
                const name = cfg?.bill_customization?.dorm_name || (b.data() as { name?: string }).name || 'ที่พัก';
                const { title, body } = monthlySummaryText(name, thaiMonthLabel(month), bills, today);
                const r = await raiseAlert({ ownerUid: u.id, buildingId: b.id, type: 'monthly_summary', title, body });
                sent += r.recipients;
            } catch (err) {
                console.error(`[monthly-summary] ${u.id}/${b.id} failed:`, (err as Error).message);
            }
        }
    }
    return { sent };
}
