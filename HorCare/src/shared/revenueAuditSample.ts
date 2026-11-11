// A worked example for the revenue audit: a 300-stall market whose zone A has 64 stalls rented at ฿3,000 a month —
// ฿192,000 should come in, ฿140,000 did. Used by the "ข้อมูลตัวอย่าง" view (nothing is read or written) and by the tests,
// so every number on the demo screen is the engine's own answer.
import type { AuditBill, AuditInput, AuditStall } from './revenueAudit.js';

const S = (baht: number) => Math.round(baht * 100);

export function sampleAuditInput(month = '2026-10', today = '2026-11-11'): AuditInput {
    const stalls: AuditStall[] = [];
    const bills: AuditBill[] = [];
    const names = ['สมศรี', 'มานะ', 'ประเสริฐ', 'วันดี', 'บุญมี', 'สมพร', 'จันทร์เพ็ญ', 'ทองดี', 'สุดา', 'ชัยวัฒน์'];

    // ── zone A: 100 stalls, 64 rented, monthly rent ฿3,000 ──
    for (let i = 1; i <= 100; i++) {
        const id = `A${String(i).padStart(3, '0')}`;
        const rented = i <= 64;
        stalls.push({ id, number: id, zone: 'โซน A', rent_satang: S(3000), occupied: rented, tenant: rented ? `${names[i % names.length]} (${id})` : null });
        if (!rented) continue;
        // A001–A004: never billed this month (฿12,000)
        if (i <= 4) continue;
        const bill: AuditBill = {
            id: `bill-${id}`, room_id: id, rent_satang: S(3000), total_satang: S(3000), discount_satang: 0, discount_labels: [],
            prorated: false, status: 'paid', paid_satang: S(3000), pending_slip_satang: 0, paid_method: 'manual',
        };
        if (i <= 7) {                       // A005–A007: a ฿1,000 discount each (฿3,000)
            bill.discount_satang = S(1000); bill.discount_labels = ['ลดพิเศษ']; bill.total_satang = S(2000); bill.paid_satang = S(2000);
        } else if (i <= 9) {                // A008–A009: rent typed as ฿2,000 instead of ฿3,000 (฿2,000)
            bill.rent_satang = S(2000); bill.total_satang = S(2000); bill.paid_satang = S(2000);
        } else if (i === 10) {              // A010: moved in mid-month, half a month's rent (fine: ฿1,500)
            bill.rent_satang = S(1500); bill.total_satang = S(1500); bill.paid_satang = S(1500); bill.prorated = true;
        } else if (i <= 18) {               // A011–A018: billed, not paid (฿24,000)
            bill.status = 'unpaid'; bill.paid_satang = 0;
        } else if (i <= 20) {               // A019–A020: paid ฿2,000 of ฿3,000 (฿2,000)
            bill.status = 'unpaid'; bill.paid_satang = S(2000);
        } else if (i === 21) {              // A021: paid ฿1,500 of ฿3,000 (฿1,500)
            bill.status = 'unpaid'; bill.paid_satang = S(1500);
        } else if (i <= 23) {               // A022–A023: slip sent, waiting to be checked (฿6,000)
            bill.status = 'pending'; bill.paid_satang = 0; bill.pending_slip_satang = S(3000);
        }
        bills.push(bill);
    }
    // a stall the system calls vacant that was billed anyway
    bills.push({
        id: 'bill-C080', room_id: 'C080', rent_satang: S(2500), total_satang: S(2500), discount_satang: 0, discount_labels: [],
        prorated: false, status: 'paid', paid_satang: S(2500), pending_slip_satang: 0,
    });

    // ── zone B: 120 stalls, daily stalls at ฿100 / day, open every day ──
    const plans: AuditInput['plans'] = [];
    const charges: AuditInput['charges'] = [];
    const payments: AuditInput['payments'] = [];
    const attendance: AuditInput['attendance'] = [];
    const days = Array.from({ length: 31 }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
    const collector = (n: number) => (n % 3 === 0 ? 'สมชาย (คนเก็บ)' : 'วิไล (คนเก็บ)');
    for (let i = 1; i <= 120; i++) {
        const id = `B${String(i).padStart(3, '0')}`;
        const daily = i <= 30;
        stalls.push({ id, number: id, zone: 'โซน B', rent_satang: S(3000), occupied: daily, tenant: daily ? `${names[(i + 3) % names.length]} (${id})` : null });
        if (!daily) continue;
        plans.push({ room_id: id, mode: 'daily_actual', unit: 'day', rate_satang: S(100), open_days: [0, 1, 2, 3, 4, 5, 6], starts_on: '2026-01-01', ends_on: null });
        days.forEach((d, di) => {
            if (d >= '2026-10-14' && d <= '2026-10-15') return;                    // market shut (flood): no charge, excused
            if (i === 1 && di < 5) return;                                          // B001 told the market it is closed 1–5
            if (i >= 2 && i <= 6 && (di === 20 || di === 21)) {                               // B002–B006 marked absent, no notice
                attendance.push({ room_id: id, visit_date: d, present: false, marked_by_name: 'สมชาย (คนเก็บ)' });
                return;
            }
            if (i === 7 && di === 25) return;                                       // B007 nothing recorded on the 26th
            const cid = `ch-${id}-${d}`;
            charges.push({ id: cid, kind: 'stall_day', room_id: id, period_start: d, period_end: d, amount_satang: S(100), paid_satang: S(100), status: 'paid' });
            payments.push({ charge_id: cid, amount_satang: S(100), method: 'cash', kind: 'payment', received_by_name: collector(i), received_at: `${d}T03:00:00Z` });
        });
    }
    // ── zone C: 80 stalls, nothing rented (to show vacancy) ──
    for (let i = 1; i <= 80; i++) {
        const id = `C${String(i).padStart(3, '0')}`;
        stalls.push({ id, number: id, zone: 'โซน C', rent_satang: S(2500), occupied: false });
    }

    return {
        month, today, zone: null, stalls, bills, plans, charges, payments, attendance,
        day_closes: [
            { close_date: '2026-10-21', expected_cash_satang: S(2500), counted_cash_satang: S(2200), closed_by_name: 'สมชาย (คนเก็บ)' },
            { close_date: '2026-10-22', expected_cash_satang: S(2500), counted_cash_satang: S(2500), closed_by_name: 'วิไล (คนเก็บ)' },
        ],
        vendor_closures: [{ room_id: 'B001', from_date: '2026-10-01', to_date: '2026-10-05', status: 'active' }],
        market_closures: [{ from_date: '2026-10-14', to_date: '2026-10-15', zones: ['โซน B'], waive_rent: false, reason_label: 'น้ำท่วม' }],
        walk_ins: [{ date: '2026-10-18', approved: 6, charged: 4 }],
        collections_available: true,
    };
}
