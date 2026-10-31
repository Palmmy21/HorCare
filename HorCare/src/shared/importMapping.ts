// Importing rooms (and their tenants) from any spreadsheet: which column is which field, and turning rows into
// clean records. Pure, shared by the import screen and /api/import-map (which asks the AI for the mapping).

export const IMPORT_FIELDS = [
    'room_number', 'floor', 'building_name', 'rent_amount', 'deposit_amount', 'area_sqm',
    'current_meter_elec', 'current_meter_water', 'tenant_name', 'phone', 'move_in_date', 'contract_end_date',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** column index → field (null = ignore the column) */
export type ColumnMapping = (ImportField | null)[];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
    room_number: 'เลขห้อง', floor: 'ชั้น', building_name: 'ตึก/อาคาร', rent_amount: 'ค่าเช่า', deposit_amount: 'เงินมัดจำ',
    area_sqm: 'พื้นที่ (ตร.ม.)', current_meter_elec: 'มิเตอร์ไฟล่าสุด', current_meter_water: 'มิเตอร์น้ำล่าสุด',
    tenant_name: 'ชื่อผู้เช่า', phone: 'เบอร์โทรผู้เช่า', move_in_date: 'วันเข้าอยู่', contract_end_date: 'วันสิ้นสุดสัญญา',
};

// Most specific first: 'มิเตอร์ไฟ' must win over 'ไฟ', 'วันสิ้นสุด' over 'วัน'.
const KEYWORDS: [ImportField, RegExp][] = [
    ['current_meter_elec', /มิเตอร์\s*ไฟ|เลข\s*ไฟ|elec|electric|kwh|หน่วยไฟ/i],
    ['current_meter_water', /มิเตอร์\s*น้ำ|เลข\s*น้ำ|water|ประปา/i],
    ['contract_end_date', /สิ้นสุด|หมดสัญญา|ครบสัญญา|end\s*date|contract\s*end|expire/i],
    ['move_in_date', /เข้าอยู่|ย้ายเข้า|วันเข้า|เริ่มสัญญา|move\s*-?in|start\s*date|check\s*-?in/i],
    ['deposit_amount', /มัดจำ|ประกัน|deposit/i],
    ['rent_amount', /ค่าเช่า|ค่าห้อง|ราคา|rent|price/i],
    ['area_sqm', /พื้นที่|ตร\.?ม|ขนาด|area|sq/i],
    ['phone', /โทร|มือถือ|เบอร์|phone|mobile|tel/i],
    ['tenant_name', /ผู้เช่า|คนเช่า|ผู้พัก|คนพัก|ผู้อยู่|ชื่อ|ลูกค้า|tenant|name|customer|resident/i],
    ['building_name', /ตึก|อาคาร|building|block/i],
    ['floor', /ชั้น|floor|level/i],
    ['room_number', /ห้อง|เลขที่|room|unit|no\.?$|แผง|stall/i],
];

/** A best guess from the headers alone (used when the AI is unavailable, and as a hint for it). */
export function guessMapping(headers: string[]): ColumnMapping {
    const used = new Set<ImportField>();
    return headers.map(h => {
        const t = h.trim();
        if (!t) return null;
        const hit = KEYWORDS.find(([field, re]) => !used.has(field) && re.test(t));
        if (!hit) return null;
        used.add(hit[0]);
        return hit[0];
    });
}

/**
 * A sample cell with its content hidden but its shape kept (digits → 9, letters → ก / a), so the AI can tell a phone
 * number from a date or a name without the tenant's real data leaving HorCare.
 */
export function maskCell(v: string): string {
    return v.slice(0, 40).replace(/[0-9]/g, '9').replace(/[฀-๿]/g, 'ก').replace(/[A-Za-z]/g, 'a');
}

/** The AI's answer → a valid mapping for these headers (unknown fields dropped, each field used once). */
export function cleanMapping(raw: unknown, columns: number): ColumnMapping | null {
    if (!raw || typeof raw !== 'object') return null;
    const list = Array.isArray(raw) ? raw : (raw as { mapping?: unknown }).mapping;
    if (!Array.isArray(list)) return null;
    const used = new Set<string>();
    const out: ColumnMapping = Array.from({ length: columns }, () => null);
    for (let i = 0; i < Math.min(columns, list.length); i++) {
        const f = list[i];
        if (typeof f === 'string' && (IMPORT_FIELDS as readonly string[]).includes(f) && !used.has(f)) {
            out[i] = f as ImportField;
            used.add(f);
        }
    }
    return out;
}

// ── values ───────────────────────────────────────────────────────────────────

/** '3,500', '฿3500.00', '3 500 บาท' → 3500. Empty → null; not a number → undefined. */
export function parseAmount(v: string): number | null | undefined {
    const t = v.replace(/[฿,\s]|บาท|thb/gi, '');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');
const validYmd = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return y >= 1900 && y <= 2200 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * A date in the forms Thai sheets use → 'YYYY-MM-DD': ISO, D/M/YYYY (Buddhist years over 2400 converted), or an Excel
 * day number. Empty → null; anything else → undefined.
 */
export function parseSheetDate(v: string): string | null | undefined {
    const t = v.trim();
    if (!t) return null;
    let y: number, m: number, d: number;
    let match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) { [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]; }
    else if ((match = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
        [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
        if (y < 100) y += y >= 50 ? 2500 : 2000; // 2-digit years: 67 → 2567 (BE), 24 → 2024
    } else if (/^\d{4,5}(\.\d+)?$/.test(t)) {
        // Excel serial day (1900 system): 45000 → 2023-03-15
        const serial = Math.floor(Number(t));
        if (serial < 20000 || serial > 80000) return undefined;
        const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
        return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    } else return undefined;
    if (y > 2400) y -= 543;
    return validYmd(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : undefined;
}

export function parsePhone(v: string): string | null | undefined {
    const digits = v.replace(/[\s\-().]/g, '').replace(/^\+66/, '0').replace(/^66(?=\d{9}$)/, '0');
    if (!digits) return null;
    // Excel drops the leading 0 of a phone stored as a number
    const fixed = /^[689]\d{8}$/.test(digits) ? `0${digits}` : digits;
    return /^0\d{8,9}$/.test(fixed) ? fixed : undefined;
}

export interface ImportRecord {
    line: number;            // row number in the sheet (1 = headers)
    room_number: string;
    floor?: string;
    building_name?: string;
    rent_amount?: number;
    deposit_amount?: number;
    area_sqm?: number;
    current_meter_elec?: number;
    current_meter_water?: number;
    tenant?: { full_name: string; phone: string; move_in_date?: string; contract_end_date?: string };
}

export interface ImportProblem { line: number; message: string }

/** Rows → records ready to save, plus the rows that need fixing (with the reason, in Thai). */
export function toImportRecords(rows: string[][], mapping: ColumnMapping): { records: ImportRecord[]; problems: ImportProblem[] } {
    const col = (f: ImportField) => mapping.indexOf(f);
    const records: ImportRecord[] = [];
    const problems: ImportProblem[] = [];
    const seen = new Set<string>();
    if (col('room_number') < 0) return { records, problems: [{ line: 1, message: 'ยังไม่ได้เลือกคอลัมน์ "เลขห้อง"' }] };

    rows.slice(1).forEach((r, i) => {
        const line = i + 2;
        const get = (f: ImportField) => (col(f) >= 0 ? (r[col(f)] ?? '').trim() : '');
        const room = get('room_number').replace(/\.0+$/, '').slice(0, 20);
        if (!room) return; // blank / subtotal rows
        if (seen.has(room)) { problems.push({ line, message: `เลขห้อง ${room} ซ้ำในไฟล์` }); return; }

        const rec: ImportRecord = { line, room_number: room };
        const bad: string[] = [];
        for (const f of ['rent_amount', 'deposit_amount', 'area_sqm', 'current_meter_elec', 'current_meter_water'] as const) {
            const n = parseAmount(get(f));
            if (n === undefined) bad.push(IMPORT_FIELD_LABELS[f]);
            else if (n !== null) rec[f] = n;
        }
        if (get('floor')) rec.floor = get('floor').replace(/\.0+$/, '').slice(0, 20);
        if (get('building_name')) rec.building_name = get('building_name').slice(0, 40);

        const name = get('tenant_name').replace(/\s+/g, ' ').slice(0, 100);
        const phone = parsePhone(get('phone'));
        const moveIn = parseSheetDate(get('move_in_date'));
        const end = parseSheetDate(get('contract_end_date'));
        if (phone === undefined) bad.push('เบอร์โทร');
        if (moveIn === undefined) bad.push('วันเข้าอยู่');
        if (end === undefined) bad.push('วันสิ้นสุดสัญญา');
        if (bad.length) { problems.push({ line, message: `ห้อง ${room}: อ่าน${bad.join(', ')}ไม่ได้` }); return; }
        if (name) rec.tenant = { full_name: name, phone: phone ?? '', ...(moveIn ? { move_in_date: moveIn } : {}), ...(end ? { contract_end_date: end } : {}) };

        seen.add(room);
        records.push(rec);
    });
    return { records, problems };
}
