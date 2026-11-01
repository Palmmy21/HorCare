import { fromSatang } from '../shared/accounting';
import {
    ACCOUNT_TYPE_LABELS_TH, AGING_BUCKETS, accountLedger, balanceSheet, profitAndLoss, receivablesAging, trialBalance, trialTotals,
    type JournalEntry, type Ledger,
} from '../shared/ledger';
import type { Cell, SheetSpec } from './xlsxWriter';

export interface PackOptions {
    from: string;
    to: string;
    /** Room/stall number per party id, for the receivables sheet. */
    partyName?: Map<string, string>;
    generatedAt?: Date;
}

const KIND_TH: Record<JournalEntry['kind'], string> = { invoice: 'ใบแจ้งหนี้', receipt: 'รับเงิน', manual: 'บันทึกเอง', reversal: 'กลับรายการ', closing: 'ปิดบัญชีสิ้นปี' };
const b = fromSatang;

/**
 * Everything an accountant asks for at period end, as sheets of one workbook: cover, journal, general ledger,
 * trial balance, profit & loss, balance sheet and aged receivables. Figures come straight from the posted entries.
 */
export function accountantPack(ledger: Ledger, entries: JournalEntry[], opts: PackOptions): SheetSpec[] {
    const { from, to } = opts;
    const party = (id: string | null) => (id ? opts.partyName?.get(id) ?? id : '');
    const accountName = new Map(ledger.accounts.map(a => [a.code, a.name]));
    const inRange = entries
        .filter(e => e.date >= from && e.date <= to)
        .sort((x, y) => x.date.localeCompare(y.date) || x.posted_at.localeCompare(y.posted_at));

    // ── cover ──
    const trial = trialBalance(entries, ledger.accounts, to);
    const tt = trialTotals(trial);
    const cover: SheetSpec = {
        name: 'สรุป',
        widths: [28, 50],
        boldRows: [0],
        rows: [
            ['ชุดเอกสารบัญชีสำหรับผู้ทำบัญชี'],
            ['สมุดบัญชี', ledger.name || ledger.id],
            ['นิติบุคคล / เจ้าของ', ledger.legal_entity_name || ''],
            ['งวด', `${from} ถึง ${to}`],
            ['จำนวนรายการในงวด', inRange.length],
            ['งบทดลอง ณ สิ้นงวด', tt.dr_satang === tt.cr_satang ? 'สมดุล' : 'ไม่สมดุล — ตรวจสอบก่อนใช้'],
            ['ปิดงวดบัญชีถึง', ledger.locked_through ?? 'ยังไม่ปิด'],
            ['สร้างเมื่อ', (opts.generatedAt ?? new Date()).toLocaleString('th-TH')],
            [],
            ['หมายเหตุ', 'รายงานบริหารจาก HorCare (เกณฑ์คงค้าง) — ผู้ทำบัญชีควรตรวจทานก่อนจัดทำงบการเงินตามกฎหมาย'],
        ],
    };

    // ── journal (one row per line) ──
    const journal: Cell[][] = [['วันที่', 'เลขที่เอกสาร', 'ประเภท', 'คำอธิบาย', 'รหัสบัญชี', 'ชื่อบัญชี', 'รายละเอียด', 'ห้อง/แผง', 'เดบิต', 'เครดิต']];
    for (const e of inRange) {
        for (const l of e.lines) {
            journal.push([e.date, e.doc_ref, KIND_TH[e.kind], e.memo, l.account, accountName.get(l.account) ?? '', l.description, party(l.party_id),
                l.dr_satang ? b(l.dr_satang) : null, l.cr_satang ? b(l.cr_satang) : null]);
        }
    }
    const jDr = inRange.reduce((s, e) => s + e.lines.reduce((t, l) => t + l.dr_satang, 0), 0);
    const jCr = inRange.reduce((s, e) => s + e.lines.reduce((t, l) => t + l.cr_satang, 0), 0);
    journal.push(['รวม', '', '', '', '', '', '', '', b(jDr), b(jCr)]);

    // ── general ledger: every account that moved, opening → lines → closing ──
    const gl: Cell[][] = [['วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'ห้อง/แผง', 'เดบิต', 'เครดิต', 'คงเหลือ']];
    const glBold = [0];
    for (const a of ledger.accounts) {
        const led = accountLedger(entries, a, from, to);
        if (led.rows.length === 0 && led.opening_satang === 0) continue;
        glBold.push(gl.length);
        gl.push([`${a.code} ${a.name}`, '', ACCOUNT_TYPE_LABELS_TH[a.type]]);
        gl.push(['', '', 'ยอดยกมา', '', null, null, b(led.opening_satang)]);
        for (const r of led.rows) {
            gl.push([r.entry.date, r.entry.doc_ref, r.line.description || r.entry.memo, party(r.line.party_id),
                r.line.dr_satang ? b(r.line.dr_satang) : null, r.line.cr_satang ? b(r.line.cr_satang) : null, b(r.running_satang)]);
        }
        glBold.push(gl.length);
        gl.push(['', '', 'ยอดคงเหลือยกไป', '', null, null, b(led.closing_satang)]);
        gl.push([]);
    }

    // ── trial balance at period end ──
    const tb: Cell[][] = [['รหัส', 'ชื่อบัญชี', 'ประเภท', 'เดบิต', 'เครดิต', 'คงเหลือ']];
    for (const r of trial) tb.push([r.account.code, r.account.name, ACCOUNT_TYPE_LABELS_TH[r.account.type], b(r.dr_satang), b(r.cr_satang), b(r.balance_satang)]);
    tb.push(['รวม', '', '', b(tt.dr_satang), b(tt.cr_satang), tt.dr_satang === tt.cr_satang ? 'สมดุล' : 'ไม่สมดุล']);

    // ── profit and loss for the period ──
    const pnl = profitAndLoss(entries, ledger.accounts, from, to);
    const pl: Cell[][] = [[`งบกำไรขาดทุน ${from} ถึง ${to}`], ['รายได้']];
    const plBold = [0, 1];
    for (const r of pnl.revenue) pl.push([`  ${r.account.code} ${r.account.name}`, b(r.amount_satang)]);
    plBold.push(pl.length); pl.push(['รวมรายได้', b(pnl.revenue_satang)]);
    pl.push([]); plBold.push(pl.length); pl.push(['ค่าใช้จ่าย']);
    for (const r of pnl.expenses) pl.push([`  ${r.account.code} ${r.account.name}`, b(r.amount_satang)]);
    plBold.push(pl.length); pl.push(['รวมค่าใช้จ่าย', b(pnl.expense_satang)]);
    pl.push([]); plBold.push(pl.length); pl.push([pnl.net_satang >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ', b(pnl.net_satang)]);

    // ── balance sheet at period end ──
    const bs = balanceSheet(entries, ledger.accounts, to);
    const bsRows: Cell[][] = [[`งบดุล ณ ${to}`]];
    const bsBold = [0];
    const section = (title: string, rows: { account: { code: string; name: string }; balance_satang: number }[], total: number, totalLabel: string) => {
        bsBold.push(bsRows.length); bsRows.push([title]);
        for (const r of rows) bsRows.push([`  ${r.account.code} ${r.account.name}`, b(r.balance_satang)]);
        bsBold.push(bsRows.length); bsRows.push([totalLabel, b(total)]);
        bsRows.push([]);
    };
    section('สินทรัพย์', bs.assets, bs.assets_satang, 'รวมสินทรัพย์');
    section('หนี้สิน', bs.liabilities, bs.liabilities_satang, 'รวมหนี้สิน');
    section('ส่วนของเจ้าของ', bs.equity, bs.equity_satang, 'รวมส่วนของเจ้าของ');
    bsRows.push(['กำไร(ขาดทุน)สะสมที่ยังไม่ปิดบัญชี', b(bs.earnings_satang)]);
    bsBold.push(bsRows.length);
    bsRows.push(['รวมหนี้สินและส่วนของเจ้าของ', b(bs.liabilities_satang + bs.equity_satang + bs.earnings_satang)]);
    if (!bs.balanced) bsRows.push(['⚠ งบไม่สมดุล — ตรวจสอบรายการ']);

    // ── aged receivables at period end ──
    const aging = receivablesAging(entries, ledger.posting.ar_account, to);
    const ag: Cell[][] = [['ห้อง/แผง', ...AGING_BUCKETS.map(k => `${k} วัน`), 'รวม']];
    for (const r of aging) ag.push([party(r.party_id), ...AGING_BUCKETS.map(k => b(r.buckets[k])), b(r.total_satang)]);
    ag.push(['รวม', ...AGING_BUCKETS.map(k => b(aging.reduce((s, r) => s + r.buckets[k], 0))), b(aging.reduce((s, r) => s + r.total_satang, 0))]);

    return [
        cover,
        { name: 'สมุดรายวัน', rows: journal, widths: [11, 16, 11, 30, 10, 24, 30, 10, 14, 14], boldRows: [0, journal.length - 1] },
        { name: 'บัญชีแยกประเภท', rows: gl, widths: [26, 16, 34, 10, 14, 14, 14], boldRows: glBold },
        { name: 'งบทดลอง', rows: tb, widths: [10, 32, 14, 16, 16, 16], boldRows: [0, tb.length - 1] },
        { name: 'งบกำไรขาดทุน', rows: pl, widths: [44, 18], boldRows: plBold },
        { name: 'งบดุล', rows: bsRows, widths: [44, 18], boldRows: bsBold },
        { name: 'ลูกหนี้ตามอายุ', rows: ag, widths: [14, 14, 14, 14, 14, 16], boldRows: [0, ag.length - 1] },
    ];
}
