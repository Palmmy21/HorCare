// ตรวจยอดรายได้ตลาด — revenue assurance for markets.
//
// For one month (and optionally one zone) it answers three questions an owner actually asks:
//   1. How much SHOULD we have received?   ยอดพึงประเมิน → ยอดพึงเก็บ (after reasons that are fine)
//   2. How much DID we receive?            เก็บได้จริง (recorded), and the cash actually counted at day close
//   3. Where did the difference go?        every baht of the gap put in one bucket, each with what it may mean
//                                          and what to do — the buckets always add up to the gap exactly
//
// Two kinds of stall are covered:
//   • monthly rent stalls, billed with the normal monthly bills (Firestore)
//   • daily / weekly stalls under a stall plan, collected on the round (charges, payments, attendance, day closes)
// Pure: the server loads the data and calls `auditRevenue`; the screen draws the result; the tests check the money.
// All money inside is integer satang. Dates are Thai calendar days ("YYYY-MM-DD").

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface AuditStall {
    id: string;
    number: string;
    zone: string;
    /** The stall's set monthly rent, satang (Room.rent_amount). */
    rent_satang: number;
    /** Rented according to contracts / the tenant profile on the month's last day (or today). */
    occupied: boolean;
    tenant?: string | null;
}

export interface AuditBill {
    id: string;
    room_id: string;
    /** satang */
    rent_satang: number;
    total_satang: number;
    /** Sum of negative hand adjustments (discounts), as a positive number, satang. */
    discount_satang: number;
    discount_labels: string[];
    /** The rent was prorated for a move-in / move-out this month. */
    prorated: boolean;
    status: 'paid' | 'pending' | 'unpaid';
    /** What was received against it, satang. */
    paid_satang: number;
    /** Amount on a slip waiting for the owner to confirm, satang. */
    pending_slip_satang: number;
    paid_method?: string | null;
}

export interface AuditPlan {
    room_id: string;
    mode: 'weekly_advance' | 'daily_actual';
    unit: 'day' | 'week';
    /** Per day or per week, satang; null = the resolved market rate (`fallback_day_satang`). */
    rate_satang: number | null;
    fallback_day_satang?: number | null;
    open_days: number[];
    starts_on: string;
    ends_on: string | null;
}

export interface AuditCharge {
    id: string;
    kind: 'stall_week' | 'stall_day' | 'walk_in' | 'extra' | 'stay';
    room_id: string | null;
    period_start: string;
    period_end: string;
    amount_satang: number;
    paid_satang: number;
    status: 'open' | 'paid' | 'void';
}

export interface AuditPayment {
    charge_id: string;
    amount_satang: number;
    method: 'cash' | 'transfer';
    kind: 'payment' | 'deposit' | 'refund';
    received_by_name: string;
    received_at: string;
}

export interface AuditAttendance { room_id: string; visit_date: string; present: boolean; marked_by_name: string }

export interface AuditDayClose {
    close_date: string;
    expected_cash_satang: number;
    counted_cash_satang: number;
    closed_by_name: string;
}

export interface AuditVendorClosure { room_id: string; from_date: string; to_date: string; status: 'active' | 'cancelled' }

/** The market itself closed (power cut, flood, an event): everyone, or some zones. */
export interface AuditMarketClosure {
    from_date: string;
    to_date: string;
    /** null = the whole market. */
    zones: string[] | null;
    /** Monthly rent is reduced pro rata for these days. Daily / weekly stalls never pay for days the market was shut. */
    waive_rent: boolean;
    reason_label: string;
}

export interface AuditWalkIn { date: string; approved: number; charged: number }

export interface AuditInput {
    /** 'YYYY-MM' */
    month: string;
    /** Days after this are not over yet: nothing is expected from them. */
    today: string;
    zone?: string | null;
    stalls: AuditStall[];
    bills: AuditBill[];
    plans: AuditPlan[];
    charges: AuditCharge[];
    payments: AuditPayment[];
    attendance: AuditAttendance[];
    day_closes: AuditDayClose[];
    vendor_closures: AuditVendorClosure[];
    market_closures: AuditMarketClosure[];
    walk_ins: AuditWalkIn[];
    /** The round data could not be read (not set up): daily stalls are left out, and the report says so. */
    collections_available: boolean;
}

// ── Output ──────────────────────────────────────────────────────────────────

/** Reasons the expected amount is lower than the full rent — legitimate, shown so nobody has to ask. */
export type ExcusedKey = 'prorate' | 'vendor_closure' | 'market_closure';
/** Where money went between "should have collected" and "collected". */
export type GapKey =
    | 'not_billed' | 'billed_low' | 'discount' | 'unpaid' | 'partial' | 'pending_slip'
    | 'not_recorded' | 'absent_unreported' | 'voided' | 'unexplained';

export const EXCUSED_LABELS: Record<ExcusedKey, string> = {
    prorate: 'คิดค่าเช่าตามวัน (ย้ายเข้า/ออกกลางเดือน)',
    vendor_closure: 'ผู้ค้าแจ้งหยุดล่วงหน้า',
    market_closure: 'ตลาดหยุด (ไฟดับ น้ำท่วม ฯลฯ)',
};

export const GAP_LABELS: Record<GapKey, string> = {
    not_billed: 'มีผู้ค้าแต่ไม่ได้ออกบิล',
    billed_low: 'ค่าเช่าในบิลต่ำกว่าที่ตั้งไว้',
    discount: 'ส่วนลด / ลดหย่อนในบิล',
    unpaid: 'ออกบิลแล้วยังไม่จ่าย',
    partial: 'จ่ายไม่ครบ',
    pending_slip: 'ส่งสลิปแล้ว รอตรวจ',
    not_recorded: 'วันที่ควรเก็บแต่ไม่มีบันทึก',
    absent_unreported: 'บันทึกว่าไม่มาขาย โดยไม่มีการแจ้งหยุด',
    voided: 'ยกเลิกรายการเก็บเงิน',
    unexplained: 'ไม่ทราบสาเหตุ',
};

export interface StallLine {
    room_id: string;
    number: string;
    zone: string;
    tenant: string | null;
    kind: 'monthly' | 'daily' | 'vacant';
    potential_satang: number;
    excused_satang: number;
    expected_satang: number;
    billed_satang: number;
    collected_satang: number;
    gap_satang: number;
    /** What the gap of this stall is made of. */
    gaps: Partial<Record<GapKey, number>>;
    notes: string[];
}

export interface ZoneLine {
    zone: string;
    stalls: number;
    rented: number;
    potential_satang: number;
    expected_satang: number;
    collected_satang: number;
    gap_satang: number;
    /** collected / expected, 0–1 (1 when nothing was expected). */
    rate: number;
}

export interface CollectorLine {
    name: string;
    collected_satang: number;
    cash_satang: number;
    transfer_satang: number;
    payments: number;
    absent_marks: number;
    absent_unreported: number;
    day_closes: number;
    short_satang: number;
}

export type Severity = 'high' | 'medium' | 'info';

export interface Finding {
    id: string;
    severity: Severity;
    title: string;
    amount_satang: number;
    /** What is going on, in one or two sentences. */
    detail: string;
    /** Likely causes, most likely first. */
    causes: string[];
    /** What to do, in order. */
    actions: string[];
    /** Stall numbers involved (capped for display). */
    stalls: string[];
}

export interface AuditReport {
    month: string;
    zone: string | null;
    /** Last day counted: the month's end, or today for the current month. */
    through: string;
    stalls_total: number;
    stalls_rented: number;
    /** What the rented stalls would bring at their full rate. */
    potential_satang: number;
    excused: Record<ExcusedKey, number>;
    /** ยอดพึงเก็บ: potential minus the excused reasons. */
    expected_satang: number;
    billed_satang: number;
    collected_satang: number;
    gap_satang: number;
    gaps: Record<GapKey, number>;
    /** Vacant stalls at their set rent: not money lost, money not earned. */
    vacancy_satang: number;
    /** Cash counted at day close minus cash recorded (negative = short). */
    cash_difference_satang: number;
    zones: ZoneLine[];
    collectors: CollectorLine[];
    findings: Finding[];
    stalls: StallLine[];
    notes: string[];
}

// ── Date helpers ────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
export const monthDays = (month: string): string[] => {
    const [y, m] = month.split('-').map(Number);
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`);
};
const dow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const thDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10);

/** Days of `dates` covered by a market closure that applies to `zone`. */
function marketClosedDays(closures: AuditMarketClosure[], zone: string, dates: string[], rentOnly: boolean): Set<string> {
    const out = new Set<string>();
    for (const c of closures) {
        if (rentOnly && !c.waive_rent) continue;
        if (c.zones && c.zones.length > 0 && !c.zones.includes(zone)) continue;
        for (const d of dates) if (d >= c.from_date && d <= c.to_date) out.add(d);
    }
    return out;
}

function vendorClosedDays(closures: AuditVendorClosure[], roomId: string, dates: string[]): Set<string> {
    const out = new Set<string>();
    for (const c of closures) {
        if (c.status !== 'active' || c.room_id !== roomId) continue;
        for (const d of dates) if (d >= c.from_date && d <= c.to_date) out.add(d);
    }
    return out;
}

const emptyGaps = (): Record<GapKey, number> => ({
    not_billed: 0, billed_low: 0, discount: 0, unpaid: 0, partial: 0, pending_slip: 0, not_recorded: 0, absent_unreported: 0, voided: 0, unexplained: 0,
});

const baht = (s: number) => `฿${Math.round(s / 100).toLocaleString('th-TH')}`;

// ── The audit ───────────────────────────────────────────────────────────────

export function auditRevenue(input: AuditInput): AuditReport {
    const all = monthDays(input.month);
    const through = all[all.length - 1] <= input.today ? all[all.length - 1] : input.today;
    const days = all.filter(d => d <= through);
    const elapsed = all.length === 0 ? 0 : days.length / all.length;
    const zoneFilter = input.zone ?? null;
    const stalls = input.stalls.filter(s => !zoneFilter || s.zone === zoneFilter);
    const stallIds = new Set(stalls.map(s => s.id));
    const billOf = new Map<string, AuditBill>();
    for (const b of input.bills) if (stallIds.has(b.room_id)) billOf.set(b.room_id, b);
    const planOf = new Map<string, AuditPlan>();
    for (const p of input.plans) if (stallIds.has(p.room_id)) planOf.set(p.room_id, p);
    const notes: string[] = [];

    // round data, by stall
    const chargesOf = new Map<string, AuditCharge[]>();
    const monthStart = all[0], monthEnd = all[all.length - 1];
    for (const c of input.charges) {
        if (!c.room_id || !stallIds.has(c.room_id)) continue;
        if (c.kind !== 'stall_day' && c.kind !== 'stall_week') continue;
        if (c.period_start < monthStart || c.period_start > monthEnd) continue;
        const list = chargesOf.get(c.room_id) ?? [];
        list.push(c);
        chargesOf.set(c.room_id, list);
    }
    const attendanceOf = new Map<string, AuditAttendance[]>();
    for (const a of input.attendance) {
        if (!stallIds.has(a.room_id) || a.visit_date < monthStart || a.visit_date > monthEnd) continue;
        const list = attendanceOf.get(a.room_id) ?? [];
        list.push(a);
        attendanceOf.set(a.room_id, list);
    }

    const lines: StallLine[] = [];
    const excused: Record<ExcusedKey, number> = { prorate: 0, vendor_closure: 0, market_closure: 0 };
    const gaps = emptyGaps();
    let vacancy = 0;
    const absentByMarker = new Map<string, { marks: number; unreported: number }>();

    for (const s of stalls) {
        const plan = planOf.get(s.id);
        const bill = billOf.get(s.id);
        const line: StallLine = {
            room_id: s.id, number: s.number, zone: s.zone, tenant: s.tenant ?? null, kind: 'vacant',
            potential_satang: 0, excused_satang: 0, expected_satang: 0, billed_satang: 0, collected_satang: 0, gap_satang: 0, gaps: {}, notes: [],
        };
        const addGap = (k: GapKey, v: number) => { if (v <= 0) return; line.gaps[k] = (line.gaps[k] ?? 0) + v; };

        if (plan && input.collections_available) {
            // ── a daily / weekly stall under a plan ──
            line.kind = 'daily';
            const dayRate = plan.unit === 'day' ? (plan.rate_satang ?? plan.fallback_day_satang ?? 0) : 0;
            const weekRate = plan.unit === 'week' ? (plan.rate_satang ?? 0) : 0;
            const perDay = plan.unit === 'day' ? dayRate : Math.round(weekRate / Math.max(1, plan.open_days.length));
            const openDays = days.filter(d => d >= plan.starts_on && (!plan.ends_on || d <= plan.ends_on) && plan.open_days.includes(dow(d)));
            const marketShut = marketClosedDays(input.market_closures, s.zone, openDays, false);
            const vendorShut = vendorClosedDays(input.vendor_closures, s.id, openDays);
            line.potential_satang = openDays.length * perDay;
            const mClosed = openDays.filter(d => marketShut.has(d)).length;
            const vClosed = openDays.filter(d => !marketShut.has(d) && vendorShut.has(d)).length;
            excused.market_closure += mClosed * perDay;
            excused.vendor_closure += vClosed * perDay;
            line.excused_satang = (mClosed + vClosed) * perDay;
            const tradingDays = openDays.filter(d => !marketShut.has(d) && !vendorShut.has(d));
            line.expected_satang = tradingDays.length * perDay;

            // a weekly charge can straddle two months: only its share of days inside this month counts here
            const share = (c: AuditCharge) => {
                if (c.kind !== 'stall_week' || c.period_end <= c.period_start) return 1;
                const span = all.filter(d => d >= c.period_start && d <= c.period_end).length;
                const total = Math.round((Date.parse(`${c.period_end}T00:00:00Z`) - Date.parse(`${c.period_start}T00:00:00Z`)) / 86_400_000) + 1;
                return total > 0 ? span / total : 1;
            };
            const charges = (chargesOf.get(s.id) ?? []).map(c => {
                const f = share(c);
                return f === 1 ? c : { ...c, amount_satang: Math.round(c.amount_satang * f), paid_satang: Math.round(c.paid_satang * f) };
            });
            const live = charges.filter(c => c.status !== 'void');
            line.billed_satang = live.reduce((t, c) => t + c.amount_satang, 0);
            line.collected_satang = live.reduce((t, c) => t + c.paid_satang, 0);

            if (plan.mode === 'daily_actual') {
                // every trading day ends up as exactly one of: charged · voided · marked absent · nothing recorded
                const marks = attendanceOf.get(s.id) ?? [];
                const chargedDays = new Set(live.map(c => c.period_start));
                const voidedDays = new Set(charges.filter(c => c.status === 'void').map(c => c.period_start));
                let absentNoNotice = 0, notRecorded = 0, voidedCount = 0;
                for (const d of tradingDays) {
                    if (chargedDays.has(d)) continue;
                    if (voidedDays.has(d)) { voidedCount++; continue; }
                    const mark = marks.find(m => m.visit_date === d);
                    if (mark && !mark.present) {
                        absentNoNotice++;
                        const k = mark.marked_by_name || 'ไม่ทราบชื่อ';
                        const a = absentByMarker.get(k) ?? { marks: 0, unreported: 0 };
                        a.marks++; a.unreported++;
                        absentByMarker.set(k, a);
                    } else {
                        notRecorded++;
                    }
                }
                addGap('voided', voidedCount * perDay);
                addGap('absent_unreported', absentNoNotice * perDay);
                addGap('not_recorded', notRecorded * perDay);
                if (voidedCount > 0) line.notes.push(`ยกเลิกรายการเก็บเงิน ${voidedCount} วัน`);
                if (absentNoNotice > 0) line.notes.push(`ไม่มาขาย ${absentNoNotice} วันโดยไม่แจ้งหยุด`);
                if (notRecorded > 0) line.notes.push(`${notRecorded} วันไม่มีบันทึกการเก็บเงินหรือการมาขาย`);
            } else if (line.billed_satang < line.expected_satang) {
                // weekly: what should have been charged but was not — voided charges first, the rest was never issued
                const missing = line.expected_satang - line.billed_satang;
                const voided = Math.min(missing, charges.filter(c => c.status === 'void').reduce((t, c) => t + c.amount_satang, 0));
                addGap('voided', voided);
                addGap('not_recorded', missing - voided);
                if (missing - voided > 0) line.notes.push('บางสัปดาห์ยังไม่ได้ออกรายการเก็บเงิน');
            }
            const open = Math.max(0, line.billed_satang - line.collected_satang);
            const partialOf = live.filter(c => c.paid_satang > 0 && c.paid_satang < c.amount_satang).reduce((t, c) => t + (c.amount_satang - c.paid_satang), 0);
            addGap('partial', Math.min(partialOf, open));
            addGap('unpaid', open - Math.min(partialOf, open));
        } else if (s.occupied || bill) {
            // ── a monthly rent stall ──
            line.kind = 'monthly';
            const full = s.rent_satang;
            const shut = marketClosedDays(input.market_closures, s.zone, all, true);
            const waived = all.length > 0 ? Math.round(full * shut.size / all.length) : 0;
            line.potential_satang = full;
            excused.market_closure += waived;
            let excusedHere = waived;
            if (!s.occupied && bill) line.notes.push('ระบบบอกว่าแผงว่าง แต่มีบิลของเดือนนี้');

            if (!bill) {
                line.expected_satang = full - excusedHere;
                line.excused_satang = excusedHere;
                addGap('not_billed', line.expected_satang);
                line.notes.push('ยังไม่ได้ออกบิลเดือนนี้');
            } else {
                // utilities and fees on the bill are due as billed; only the rent line is checked against the stall's rent
                const other = Math.max(0, bill.total_satang - bill.rent_satang + bill.discount_satang);
                const shortRent = Math.max(0, full - waived - bill.rent_satang);
                if (bill.prorated && shortRent > 0) {
                    excused.prorate += shortRent;
                    excusedHere += shortRent;
                }
                // a rent billed ABOVE the set rent (raised, not yet updated on the stall) is what is due
                const rentDue = bill.prorated ? bill.rent_satang : Math.max(full - waived, bill.rent_satang);
                line.excused_satang = excusedHere;
                line.expected_satang = rentDue + other;
                line.potential_satang = Math.max(full, rentDue + excusedHere) + other;
                line.billed_satang = bill.total_satang;
                line.collected_satang = bill.paid_satang;
                if (!bill.prorated) addGap('billed_low', shortRent);
                addGap('discount', bill.discount_satang);
                if (shortRent > 0 && !bill.prorated) line.notes.push(`ค่าเช่าในบิล ${baht(bill.rent_satang)} ต่ำกว่าที่ตั้งไว้ ${baht(full)}`);
                if (bill.discount_satang > 0) line.notes.push(`ส่วนลด ${baht(bill.discount_satang)}${bill.discount_labels.length ? ` (${bill.discount_labels.join(', ')})` : ''}`);
                const open = Math.max(0, bill.total_satang - bill.paid_satang);
                if (open > 0) {
                    if (bill.status === 'pending' && bill.pending_slip_satang > 0) {
                        const p = Math.min(open, bill.pending_slip_satang);
                        addGap('pending_slip', p);
                        if (open > p) addGap(bill.paid_satang > 0 ? 'partial' : 'unpaid', open - p);
                    } else if (bill.paid_satang > 0) {
                        addGap('partial', open);
                        line.notes.push(`จ่ายแล้ว ${baht(bill.paid_satang)} จาก ${baht(bill.total_satang)}`);
                    } else {
                        addGap('unpaid', open);
                    }
                }
            }
        } else {
            vacancy += Math.round(s.rent_satang * elapsed);
        }

        // whatever is left after the named reasons (rounding, overpayment, data that does not line up)
        line.gap_satang = line.expected_satang - line.collected_satang;
        const named = Object.values(line.gaps).reduce((t, v) => t + (v ?? 0), 0);
        const rest = line.gap_satang - named;
        if (rest !== 0) line.gaps.unexplained = (line.gaps.unexplained ?? 0) + rest;
        for (const [k, v] of Object.entries(line.gaps) as [GapKey, number][]) gaps[k] += v;
        lines.push(line);
    }

    const sum = (f: (l: StallLine) => number) => lines.reduce((t, l) => t + f(l), 0);
    const potential = sum(l => l.potential_satang);
    const expected = sum(l => l.expected_satang);
    const billed = sum(l => l.billed_satang);
    const collected = sum(l => l.collected_satang);

    // ── zones ──
    const zoneNames = [...new Set(stalls.map(s => s.zone))].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
    const zones: ZoneLine[] = zoneNames.map(z => {
        const ls = lines.filter(l => l.zone === z);
        const e = ls.reduce((t, l) => t + l.expected_satang, 0);
        const c = ls.reduce((t, l) => t + l.collected_satang, 0);
        return {
            zone: z, stalls: ls.length, rented: ls.filter(l => l.kind !== 'vacant').length,
            potential_satang: ls.reduce((t, l) => t + l.potential_satang, 0), expected_satang: e, collected_satang: c, gap_satang: e - c,
            rate: e > 0 ? c / e : 1,
        };
    });

    // ── people who collect ──
    const stallCharges = new Map<string, AuditCharge>();
    for (const list of chargesOf.values()) for (const c of list) stallCharges.set(c.id, c);
    const people = new Map<string, CollectorLine>();
    const person = (name: string) => {
        const k = name || 'ไม่ทราบชื่อ';
        let p = people.get(k);
        if (!p) { p = { name: k, collected_satang: 0, cash_satang: 0, transfer_satang: 0, payments: 0, absent_marks: 0, absent_unreported: 0, day_closes: 0, short_satang: 0 }; people.set(k, p); }
        return p;
    };
    if (input.collections_available) {
        for (const pay of input.payments) {
            if (!stallCharges.has(pay.charge_id)) continue;
            const d = thDay(pay.received_at);
            if (d < monthStart || d > monthEnd) continue;
            const p = person(pay.received_by_name);
            const amt = pay.kind === 'refund' ? -Math.abs(pay.amount_satang) : pay.amount_satang;
            p.collected_satang += amt;
            if (pay.method === 'cash') p.cash_satang += amt; else p.transfer_satang += amt;
            p.payments++;
        }
        for (const [name, a] of absentByMarker) { const p = person(name); p.absent_marks += a.marks; p.absent_unreported += a.unreported; }
    }
    let cashDifference = 0;
    const shortDays: string[] = [];
    if (input.collections_available && !zoneFilter) {
        for (const dc of input.day_closes) {
            if (dc.close_date < monthStart || dc.close_date > monthEnd) continue;
            const diff = dc.counted_cash_satang - dc.expected_cash_satang;
            cashDifference += diff;
            const p = person(dc.closed_by_name);
            p.day_closes++;
            if (diff < 0) { p.short_satang += -diff; shortDays.push(dc.close_date); }
        }
    }
    const collectors = [...people.values()].sort((a, b) => b.collected_satang - a.collected_satang);

    // ── what it may mean, and what to do ──
    const findings: Finding[] = [];
    const stallsWith = (k: GapKey) => lines.filter(l => (l.gaps[k] ?? 0) > 0).sort((a, b) => (b.gaps[k] ?? 0) - (a.gaps[k] ?? 0));
    const nums = (ls: StallLine[]) => ls.slice(0, 40).map(l => l.number);
    const add = (f: Finding) => { if (f.amount_satang > 0 || f.stalls.length > 0) findings.push(f); };

    {
        const ls = stallsWith('not_billed');
        add({
            id: 'not_billed', severity: 'high', title: `มีผู้ค้า ${ls.length} แผงที่ยังไม่ได้ออกบิลเดือนนี้`, amount_satang: gaps.not_billed,
            detail: 'ตามสัญญาหรือข้อมูลผู้ค้า แผงเหล่านี้มีคนเช่าอยู่ แต่ไม่มีบิลของเดือนนี้ในระบบ เงินส่วนนี้จึงไม่ถูกเรียกเก็บเลย',
            causes: ['ลืมออกบิล หรือออกบิลไม่ครบทุกแผง', 'ผู้ค้าย้ายออกไปแล้วแต่ยังไม่ได้ปิดสัญญา/ข้อมูลผู้ค้า', 'มีการเก็บเงินสดนอกระบบโดยไม่ออกบิล (ควรตรวจสอบ)'],
            actions: ['ออกบิลให้แผงเหล่านี้ที่หน้า "สรุปบิล"', 'แผงที่ย้ายออกแล้ว: ปิดสัญญาหรือแก้วันย้ายออกในข้อมูลผู้ค้า', 'สุ่มถามผู้ค้า 2–3 แผงว่าจ่ายเงินให้ใครไปแล้วหรือยัง'],
            stalls: nums(ls),
        });
    }
    {
        const ls = stallsWith('billed_low');
        add({
            id: 'billed_low', severity: 'high', title: `ค่าเช่าในบิลต่ำกว่าค่าเช่าที่ตั้งไว้ ${ls.length} แผง`, amount_satang: gaps.billed_low,
            detail: 'ค่าเช่าที่ออกในบิลน้อยกว่าค่าเช่าที่ตั้งไว้ของแผง โดยไม่ใช่การคิดตามวันจากการย้ายเข้า/ออก',
            causes: ['มีคนแก้ค่าเช่าในบิลให้ต่ำลง', 'ค่าเช่าที่ตั้งไว้ของแผงสูงเกินจริง (ตกลงราคาใหม่แต่ไม่ได้แก้ข้อมูลแผง)', 'ให้ส่วนลดด้วยการแก้ค่าเช่าแทนการใส่เป็นส่วนลด'],
            actions: ['เปิดบิลของแผงเหล่านี้ ดูว่าใครแก้และเมื่อไร (หน้า "ความปลอดภัย" → ประวัติการใช้งาน)', 'ถ้าตกลงราคาใหม่จริง ให้แก้ค่าเช่าของแผงให้ตรง', 'ถ้าเป็นส่วนลด ให้ใส่เป็นรายการส่วนลดพร้อมเหตุผล เพื่อให้ตรวจย้อนได้'],
            stalls: nums(ls),
        });
    }
    {
        const ls = stallsWith('discount');
        add({
            id: 'discount', severity: 'medium', title: `ให้ส่วนลด ${ls.length} แผง`, amount_satang: gaps.discount,
            detail: 'บิลเหล่านี้มีรายการส่วนลดที่ใส่ด้วยมือ ทำให้ยอดเรียกเก็บลดลง',
            causes: ['ส่วนลดที่ตกลงกันจริง (ผู้ค้าเก่า ช่วงโปรโมชัน ชดเชยความเสียหาย)', 'ส่วนลดที่ไม่ได้รับอนุมัติ'],
            actions: ['ตรวจว่าทุกส่วนลดมีเหตุผลและผู้อนุมัติ', 'กำหนดให้ส่วนลดเกินจำนวนหนึ่งต้องให้เจ้าของอนุมัติ'],
            stalls: nums(ls),
        });
    }
    {
        const ls = stallsWith('unpaid');
        add({
            id: 'unpaid', severity: gaps.unpaid > expected * 0.1 ? 'high' : 'medium', title: `ค้างจ่าย ${ls.length} แผง`, amount_satang: gaps.unpaid,
            detail: 'ออกบิลหรือรายการเก็บเงินแล้ว แต่ยังไม่มีการบันทึกรับเงิน',
            causes: ['ผู้ค้ายังไม่จ่ายจริง', 'ผู้ค้าจ่ายเงินสดให้คนเก็บแล้ว แต่ไม่ได้บันทึกในระบบ (เสี่ยงทุจริต)', 'โอนเข้าบัญชีแล้วแต่ยังไม่ได้กดรับชำระ'],
            actions: ['ส่งบิลเตือนทาง LINE ให้แผงที่ค้าง', 'โทรถามแผงที่ค้างนานว่าจ่ายไปแล้วหรือยัง และจ่ายให้ใคร', 'เทียบรายการโอนในบัญชีธนาคาร (หน้า "การชำระเงิน" → กระทบยอด)'],
            stalls: nums(ls),
        });
    }
    {
        const ls = stallsWith('partial');
        add({
            id: 'partial', severity: 'medium', title: `จ่ายไม่ครบ ${ls.length} แผง`, amount_satang: gaps.partial,
            detail: 'มีการรับเงินแล้วแต่ไม่ครบยอดบิล',
            causes: ['ผู้ค้าขอแบ่งจ่าย', 'ผู้ค้าจ่ายไม่ตรงยอด (หักเอง ปัดเศษ)', 'คนเก็บบันทึกยอดต่ำกว่าที่ได้รับจริง'],
            actions: ['ตามเก็บส่วนที่เหลือ', 'ถ้าจ่ายเงินสด ให้ขอดูใบเสร็จที่ผู้ค้าได้รับเทียบกับยอดที่บันทึก'],
            stalls: nums(ls),
        });
    }
    {
        const ls = stallsWith('pending_slip');
        add({
            id: 'pending_slip', severity: 'info', title: `สลิปรอตรวจ ${ls.length} แผง`, amount_satang: gaps.pending_slip,
            detail: 'ผู้ค้าส่งสลิปแล้ว แต่ยังไม่ได้ยืนยันยอด เมื่อยืนยันแล้วยอดนี้จะนับเป็นเงินที่เก็บได้',
            causes: ['ยังไม่มีคนตรวจสลิป', 'ระบบอ่านสลิปไม่ได้ ต้องตรวจด้วยตา'],
            actions: ['ตรวจและยืนยันสลิปที่หน้า "การชำระเงิน"'],
            stalls: nums(ls),
        });
    }
    {
        const ls = stallsWith('not_recorded');
        add({
            id: 'not_recorded', severity: 'high', title: `${ls.length} แผงมีวันที่ควรเก็บเงินแต่ไม่มีบันทึกใด ๆ`, amount_satang: gaps.not_recorded,
            detail: 'เป็นวันที่แผงควรมาขาย ไม่มีการแจ้งหยุดและตลาดไม่ได้หยุด แต่ไม่มีทั้งรายการเก็บเงินและการบันทึกว่าไม่มา',
            causes: ['คนเก็บไม่ได้เดินเก็บแผงนั้น หรือลืมบันทึก', 'เก็บเงินสดแล้วแต่ไม่ได้บันทึก (เสี่ยงทุจริตสูง)', 'แผงเลิกขายแล้วแต่ยังมีแผนการเก็บเงินค้างอยู่'],
            actions: ['ให้คนเก็บบันทึกทุกแผงทุกวัน (เก็บแล้ว / ไม่มา) ในหน้ารอบเก็บเงิน', 'สุ่มถามผู้ค้าในวันดังกล่าวว่าจ่ายเงินไปหรือไม่', 'แผงที่เลิกขาย: ปิดแผนการเก็บเงินของแผง'],
            stalls: nums(ls),
        });
    }
    {
        const ls = stallsWith('absent_unreported');
        const top = collectors.filter(c => c.absent_unreported > 0).sort((a, b) => b.absent_unreported - a.absent_unreported);
        const totalMarks = top.reduce((t, c) => t + c.absent_unreported, 0);
        const lead = top[0] && totalMarks >= 6 && top[0].absent_unreported / totalMarks >= 0.7 && top.length > 1 ? top[0] : null;
        add({
            id: 'absent_unreported', severity: lead ? 'high' : 'medium', title: `บันทึกว่า "ไม่มาขาย" ${ls.length} แผง โดยผู้ค้าไม่ได้แจ้งหยุด`, amount_satang: gaps.absent_unreported,
            detail: lead
                ? `${lead.name} เป็นคนบันทึก ${lead.absent_unreported} จาก ${totalMarks} ครั้ง สูงกว่าคนอื่นมาก ควรตรวจสอบ`
                : 'วันที่ผู้ค้าแจ้งหยุดล่วงหน้าจะไม่นับเป็นรายได้ที่หายไป แต่วันที่บันทึกว่าไม่มาโดยไม่มีการแจ้ง ควรตรวจสอบ',
            causes: ['ผู้ค้าไม่มาจริงโดยไม่แจ้ง', 'ผู้ค้ามาขายและจ่ายเงินสดแล้ว แต่คนเก็บบันทึกว่าไม่มา (เสี่ยงทุจริต)'],
            actions: ['ให้ผู้ค้าแจ้งหยุดผ่าน LINE ทุกครั้ง จะได้แยกได้ทันทีว่าวันไหนหยุดจริง', 'สุ่มตรวจแผงที่ถูกบันทึกว่าไม่มาบ่อย ๆ ด้วยการไปดูหน้างานหรือถามแผงข้าง ๆ', 'สลับคนเก็บเงินในโซนนั้นชั่วคราวแล้วเทียบผล'],
            stalls: nums(ls),
        });
    }
    {
        const ls = stallsWith('voided');
        add({
            id: 'voided', severity: 'medium', title: `ยกเลิกรายการเก็บเงิน ${ls.length} แผง`, amount_satang: gaps.voided,
            detail: 'มีการยกเลิกรายการเก็บเงินที่ออกไปแล้ว ทำให้ยอดที่ควรได้หายไป',
            causes: ['ออกรายการผิดแล้วยกเลิก (ปกติ)', 'ยกเลิกหลังรับเงินสดไปแล้ว (เสี่ยงทุจริต)'],
            actions: ['ดูเหตุผลการยกเลิกและผู้ยกเลิกในประวัติการใช้งาน', 'ให้การยกเลิกทำได้เฉพาะผู้จัดการ'],
            stalls: nums(ls),
        });
    }
    if (cashDifference < 0) {
        add({
            id: 'cash_short', severity: 'high', title: `เงินสดขาดตอนปิดยอด ${shortDays.length} วัน`, amount_satang: -cashDifference,
            detail: 'เงินสดที่นับได้ตอนปิดยอดรายวัน น้อยกว่าเงินสดที่บันทึกรับในระบบ หมายความว่าเงินถูกบันทึกแล้วแต่ไม่ถึงมือ',
            causes: ['ทอนเงินผิด หรือนับผิด', 'มีเงินสดหายระหว่างเก็บจนถึงส่ง', 'นำเงินสดไปใช้ก่อนส่ง'],
            actions: ['ตรวจวันที่ขาด: ' + shortDays.slice(0, 10).join(', '), 'ให้ส่งเงินสดและนับต่อหน้า 2 คนทุกวัน', 'ส่งเสริมให้ผู้ค้าโอนแทนเงินสด (ตรวจย้อนได้ทุกบาท)'],
            stalls: [],
        });
    }
    {
        const ghost = lines.filter(l => l.notes.some(n => n.startsWith('ระบบบอกว่าแผงว่าง')));
        if (ghost.length > 0) add({
            id: 'vacant_with_bill', severity: 'medium', title: `แผงที่ระบบบอกว่าว่าง แต่มีบิล ${ghost.length} แผง`, amount_satang: 0,
            detail: 'ข้อมูลสัญญาไม่ตรงกับการเรียกเก็บจริง ถ้ามีแผงลักษณะนี้ อาจมีแผงอื่นที่มีคนขายจริงแต่ระบบยังบอกว่าว่าง และไม่ถูกเรียกเก็บ',
            causes: ['ยังไม่ได้บันทึกสัญญา/ข้อมูลผู้ค้าของแผง', 'ผู้ค้าเช่าต่อโดยไม่ได้ทำสัญญาใหม่'],
            actions: ['บันทึกข้อมูลผู้ค้าหรือสัญญาของแผงเหล่านี้', 'เดินตรวจแผงว่างทั้งหมด 1 รอบ ว่ามีคนขายอยู่หรือไม่'],
            stalls: nums(ghost),
        });
    }
    {
        // rent set well below the zone's usual rent
        const low: StallLine[] = [];
        for (const z of zoneNames) {
            const rents = stalls.filter(s => s.zone === z && s.rent_satang > 0).map(s => s.rent_satang).sort((a, b) => a - b);
            if (rents.length < 5) continue;
            const median = rents[Math.floor(rents.length / 2)];
            for (const s of stalls) if (s.zone === z && s.rent_satang > 0 && s.rent_satang < median * 0.7) { const l = lines.find(x => x.room_id === s.id); if (l && l.kind !== 'vacant') low.push(l); }
        }
        if (low.length > 0) add({
            id: 'rent_below_zone', severity: 'info', title: `ค่าเช่าต่ำกว่าแผงอื่นในโซนเดียวกันมาก ${low.length} แผง`, amount_satang: 0,
            detail: 'ค่าเช่าที่ตั้งไว้ต่ำกว่าค่ากลางของโซนเกิน 30% ไม่ได้แปลว่าผิด แต่ควรรู้ว่ามีเหตุผล',
            causes: ['แผงเล็กกว่า หรือทำเลด้อยกว่า', 'ตกลงราคาพิเศษไว้', 'ตั้งค่าเช่าผิด'],
            actions: ['ตรวจค่าเช่าของแผงเหล่านี้ในหน้า "จัดการแผง"'],
            stalls: nums(low),
        });
    }
    for (const w of input.walk_ins) {
        if (w.date < monthStart || w.date > monthEnd || zoneFilter) continue;
        const missing = w.approved - w.charged;
        if (missing <= 0) continue;
        const f = findings.find(x => x.id === 'walkin_uncharged');
        if (f) { f.amount_satang += 0; f.stalls.push(`${w.date} (${missing})`); f.title = `ขาจรได้รับอนุมัติแต่ไม่มีรายการเก็บเงิน ${f.stalls.length} วัน`; }
        else findings.push({
            id: 'walkin_uncharged', severity: 'medium', title: 'ขาจรได้รับอนุมัติแต่ไม่มีรายการเก็บเงิน 1 วัน', amount_satang: 0,
            detail: 'วันดังกล่าวมีขาจรได้รับอนุมัติให้เข้าขายมากกว่าจำนวนรายการเก็บค่าที่ขาจร',
            causes: ['ขาจรไม่มาจริง', 'เก็บเงินขาจรแล้วไม่ได้บันทึก'],
            actions: ['บันทึกค่าที่ขาจรทุกรายในหน้ารอบเก็บเงิน', 'เทียบรายชื่อขาจรที่อนุมัติกับเงินที่ส่ง'],
            stalls: [`${w.date} (${missing})`],
        });
    }
    if (gaps.unexplained !== 0) {
        add({
            id: 'unexplained', severity: Math.abs(gaps.unexplained) > expected * 0.02 ? 'medium' : 'info',
            title: gaps.unexplained > 0 ? 'ส่วนต่างที่ยังไม่ทราบสาเหตุ' : 'เก็บได้มากกว่ายอดพึงเก็บ', amount_satang: Math.abs(gaps.unexplained),
            detail: gaps.unexplained > 0 ? 'ส่วนที่เหลือหลังแยกสาเหตุทั้งหมดแล้ว มักมาจากข้อมูลที่บันทึกไม่ตรงกัน' : 'มีการรับเงินเกินยอดบิล เช่น จ่ายล่วงหน้าหรือจ่ายซ้ำ',
            causes: ['บันทึกยอดรับไม่ตรงบิล', 'ปัดเศษ', 'จ่ายล่วงหน้า / จ่ายซ้ำ'],
            actions: ['ดูรายแผงในตารางด้านล่าง คอลัมน์ "ส่วนต่าง"'],
            stalls: nums(lines.filter(l => (l.gaps.unexplained ?? 0) !== 0)),
        });
    }
    if (!input.collections_available) notes.push('ยังอ่านข้อมูลรอบเก็บเงินรายวันไม่ได้ จึงคิดเฉพาะแผงรายเดือน');
    if (through < monthEnd) notes.push(`เดือนนี้ยังไม่จบ คิดถึงวันที่ ${Number(through.slice(8))} (แผงรายวันคิดเฉพาะวันที่ผ่านมาแล้ว แผงรายเดือนคิดเต็มเดือน)`);

    const order: Record<Severity, number> = { high: 0, medium: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity] || b.amount_satang - a.amount_satang);

    return {
        month: input.month, zone: zoneFilter, through,
        stalls_total: stalls.length, stalls_rented: lines.filter(l => l.kind !== 'vacant').length,
        potential_satang: potential, excused, expected_satang: expected, billed_satang: billed, collected_satang: collected,
        gap_satang: expected - collected, gaps, vacancy_satang: vacancy, cash_difference_satang: cashDifference,
        zones, collectors, findings,
        stalls: lines.sort((a, b) => b.gap_satang - a.gap_satang || a.number.localeCompare(b.number, 'th', { numeric: true })),
        notes,
    };
}

/** The report as a CSV an accountant can open (UTF-8 with BOM so Excel shows Thai). */
export function auditCsv(r: AuditReport): string {
    const head = ['แผง', 'โซน', 'ผู้ค้า', 'ประเภท', 'ยอดเต็ม', 'หักเหตุผลที่ยอมรับได้', 'ยอดพึงเก็บ', 'ออกบิล', 'เก็บได้', 'ส่วนต่าง', 'สาเหตุ'];
    const b = (s: number) => (s / 100).toFixed(2);
    const kind = { monthly: 'รายเดือน', daily: 'รายวัน/สัปดาห์', vacant: 'ว่าง' } as const;
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = r.stalls.map(l => [
        l.number, l.zone, l.tenant ?? '', kind[l.kind], b(l.potential_satang), b(l.excused_satang), b(l.expected_satang), b(l.billed_satang), b(l.collected_satang), b(l.gap_satang),
        (Object.entries(l.gaps) as [GapKey, number][]).filter(([, v]) => v !== 0).map(([k, v]) => `${GAP_LABELS[k]} ${b(v)}`).join('; '),
    ].map(String).map(esc).join(','));
    return '﻿' + [head.join(','), ...rows].join('\n');
}
