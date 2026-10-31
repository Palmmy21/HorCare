// Owner commands over LINE (#ยอด, #ค้าง, #ห้องว่าง): parsing, the month's figures, and the reply text. Pure.

export type OwnerCommand = 'summary' | 'unpaid' | 'vacant' | 'help' | 'unlink';

export const OWNER_LINK_CODE_RE = /^HCO-[A-HJ-NP-Z2-9]{8}$/;
export const isOwnerLinkCode = (t: string): boolean => OWNER_LINK_CODE_RE.test(t.trim().toUpperCase());

const ALIASES: Record<string, OwnerCommand> = {
    'ยอด': 'summary', 'สรุป': 'summary', 'summary': 'summary',
    'ค้าง': 'unpaid', 'ค้างชำระ': 'unpaid', 'unpaid': 'unpaid',
    'ห้องว่าง': 'vacant', 'ว่าง': 'vacant', 'vacant': 'vacant',
    'ช่วย': 'help', 'คำสั่ง': 'help', 'help': 'help',
    'ยกเลิก': 'unlink', 'เลิกเชื่อม': 'unlink', 'unlink': 'unlink',
};

/** A '#…' message → its command (unknown '#…' → help). Anything not starting with '#' → null (not for us). */
export function parseOwnerCommand(text: string): OwnerCommand | null {
    const t = text.trim();
    if (!t.startsWith('#')) return null;
    const word = t.slice(1).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    return ALIASES[word] ?? 'help';
}

export const OWNER_HELP =
    'คำสั่งสำหรับเจ้าของ HorCare 📋\n\n' +
    '#ยอด — สรุปยอดเก็บเงินเดือนนี้ และยอดที่เข้าวันนี้\n' +
    '#ค้าง — ห้องที่ยังไม่จ่ายเดือนนี้\n' +
    '#ห้องว่าง — ห้องที่ว่างตอนนี้\n' +
    '#ยกเลิก — เลิกเชื่อม LINE นี้กับบัญชี HorCare';

export interface BillFacts {
    room_number: string;
    total_bill: number;
    payment_status?: string;
    paid_amount?: number;
    paid_at?: string;
    is_saved?: boolean;
}

export interface MonthFigures {
    billed: number; collected: number; collectedToday: number;
    bills: number; paid: number; pending: number; unpaid: number;
}

/** ISO timestamp → Thai calendar day 'YYYY-MM-DD'. */
export function thaiDay(iso: string): string {
    const t = new Date(new Date(iso).getTime() + 7 * 3600_000);
    return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
}

export function monthFigures(bills: BillFacts[], today: string): MonthFigures {
    const saved = bills.filter(b => b.is_saved !== false);
    const f: MonthFigures = { billed: 0, collected: 0, collectedToday: 0, bills: saved.length, paid: 0, pending: 0, unpaid: 0 };
    for (const b of saved) {
        const total = Number(b.total_bill) || 0;
        f.billed += total;
        if (b.payment_status === 'paid') {
            const got = typeof b.paid_amount === 'number' ? b.paid_amount : total;
            f.paid++;
            f.collected += got;
            if (b.paid_at && thaiDay(b.paid_at) === today) f.collectedToday += got;
        } else if (b.payment_status === 'pending') f.pending++;
        else f.unpaid++;
    }
    return f;
}

const baht = (n: number) => `฿${Math.round(n).toLocaleString('th-TH')}`;

export function formatSummary(name: string, monthLabel: string, f: MonthFigures): string {
    const pct = f.billed > 0 ? Math.round((f.collected / f.billed) * 100) : 0;
    return [
        `🏢 ${name} · ${monthLabel}`,
        `เก็บแล้ว ${baht(f.collected)} จาก ${baht(f.billed)} (${pct}%)`,
        `วันนี้เข้า ${baht(f.collectedToday)}`,
        `จ่ายแล้ว ${f.paid} · รอตรวจสลิป ${f.pending} · ยังไม่จ่าย ${f.unpaid} (จาก ${f.bills} บิล)`,
    ].join('\n');
}

export function formatUnpaid(name: string, bills: BillFacts[], max = 30): string {
    const open = bills.filter(b => b.is_saved !== false && b.payment_status !== 'paid')
        .sort((a, b) => a.room_number.localeCompare(b.room_number, 'th', { numeric: true }));
    if (open.length === 0) return `🏢 ${name}\nจ่ายครบทุกห้องแล้ว 🎉`;
    const lines = open.slice(0, max).map(b => `• ${b.room_number}  ${baht(b.total_bill)}${b.payment_status === 'pending' ? ' (รอตรวจสลิป)' : ''}`);
    const total = open.reduce((s, b) => s + (Number(b.total_bill) || 0), 0);
    return [`🏢 ${name} · ค้าง ${open.length} ห้อง รวม ${baht(total)}`, ...lines, ...(open.length > max ? [`…และอีก ${open.length - max} ห้อง`] : [])].join('\n');
}

export function formatVacant(name: string, rooms: { number: string }[], max = 40): string {
    if (rooms.length === 0) return `🏢 ${name}\nไม่มีห้องว่าง เต็มทุกห้อง 🎉`;
    const list = rooms.slice(0, max).map(r => r.number).join(', ');
    return `🏢 ${name} · ว่าง ${rooms.length} ห้อง\n${list}${rooms.length > max ? ` …และอีก ${rooms.length - max}` : ''}`;
}
