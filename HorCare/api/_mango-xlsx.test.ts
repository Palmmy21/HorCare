import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { MANGO_HEADERS, buildMangoWorkbook, colIndex, formatDate, HEADER_ROW, FIRST_DATA_ROW } from './_mango-xlsx.js';
import { buildVouchers, emptyProfile, type MangoProfile, type ReceivableDoc } from '../src/shared/accounting.js';

const profile = (): MangoProfile => {
    const p = emptyProfile('p1');
    return {
        ...p, legal_entity_name: 'X', template_version: 't', property_ids: ['b1'],
        codes: { ...p.codes, ar_account: '1140102', project: '00202023', job: '001', book: null },
        revenue_accounts: { rent: '4120101' }, customers: { r1: { code: '0012' } },
    };
};
const doc = (over: Partial<ReceivableDoc> = {}): ReceivableDoc => ({
    kind: 'bill', id: 'a', room_id: 'r1', room_number: 'A01', period: '2026-10', issued_at: '2026-10-05T03:00:00Z', status: 'issued',
    lines: [{ category: 'rent', amount_satang: 10000 }], total_satang: 10000, revision: 'r', ...over,
});
const vouchers = (p: MangoProfile, docs = [doc()]) =>
    buildVouchers({ profile: p, kind: 'invoice', from: '2026-10-01', to: '2026-10-31', docs, payments: [], exported: new Map() }).vouchers;
const read = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer); return wb.getWorksheet('My sheet')!; };

describe('layout', () => {
    it('has 55 columns A–BC with the customer\'s spelling and an empty AL', () => {
        expect(MANGO_HEADERS).toHaveLength(55);
        expect(MANGO_HEADERS[colIndex('A')]).toBe('Voucher no.');
        expect(MANGO_HEADERS[colIndex('T')]).toBe('Vender Code');
        expect(MANGO_HEADERS[colIndex('AL')]).toBe('');
        expect(MANGO_HEADERS[colIndex('AM')]).toBe('Customer Name');
        expect(MANGO_HEADERS[colIndex('BC')]).toBe('Branch No.');
        expect(colIndex('BC')).toBe(54);
    });
    it('formats dates as configured', () => {
        expect(formatDate('2026-10-05', 'dd/mm/yyyy')).toBe('05/10/2026');
        expect(formatDate('2026-10-05', 'dd/mm/yyyy_be')).toBe('05/10/2569');
        expect(formatDate('2026-10-05', 'yyyy-mm-dd')).toBe('2026-10-05');
    });
});

describe('workbook', () => {
    it('writes the header on row 7 and the voucher lines from row 8, with codes kept as text', async () => {
        const p = profile();
        const ws = await read(await buildMangoWorkbook(p, vouchers(p)));
        expect(ws.getRow(HEADER_ROW).getCell(1).value).toBe('Voucher no.');
        expect(ws.getRow(HEADER_ROW).getCell(colIndex('K') + 1).value).toBe('***Project Code/Site ID');
        const dr = ws.getRow(FIRST_DATA_ROW);
        const cr = ws.getRow(FIRST_DATA_ROW + 1);
        expect(dr.getCell(colIndex('I') + 1).value).toBe('1140102');
        expect(dr.getCell(colIndex('K') + 1).value).toBe('00202023');
        expect(dr.getCell(colIndex('L') + 1).value).toBe('001');
        expect(dr.getCell(colIndex('U') + 1).value).toBe('0012');
        expect(dr.getCell(colIndex('R') + 1).value).toBe(100);
        expect(dr.getCell(colIndex('S') + 1).value).toBeNull();
        expect(cr.getCell(colIndex('S') + 1).value).toBe(100);
        expect(cr.getCell(colIndex('R') + 1).value).toBeNull();
        expect(typeof dr.getCell(colIndex('K') + 1).value).toBe('string');
        expect(dr.getCell(colIndex('F') + 1).value).toBe('บันทึกตั้งลูกหนี้');
        expect(dr.getCell(colIndex('B') + 1).value).toBe('05/10/2026');
    });

    it('leaves fields Mango fills blank unless the profile gives a value (no hard-coded 06 / Y / GL / 2)', async () => {
        const p = profile();
        let ws = await read(await buildMangoWorkbook(p, vouchers(p)));
        for (const c of ['A', 'C', 'H', 'J', 'AK', 'AL', 'AM', 'AJ', 'T']) expect(ws.getRow(FIRST_DATA_ROW).getCell(colIndex(c) + 1).value).toBeNull();
        p.codes.book = '06'; p.codes.pu_cost_yn = 'Y'; p.codes.ac_type = 'GL'; p.codes.data_type = '2';
        ws = await read(await buildMangoWorkbook(p, vouchers(p)));
        const r = ws.getRow(FIRST_DATA_ROW);
        expect([r.getCell(3).value, r.getCell(8).value, r.getCell(10).value, r.getCell(colIndex('AK') + 1).value]).toEqual(['06', 'Y', 'GL', '2']);
    });

    it('header fields can be limited to the first line of each voucher', async () => {
        const p = profile(); p.options.header_on_every_line = false; p.options.voucher_no_from_horcare = true;
        const ws = await read(await buildMangoWorkbook(p, vouchers(p)));
        expect(ws.getRow(FIRST_DATA_ROW).getCell(1).value).toBe('IV-A01-2026-10');
        expect(ws.getRow(FIRST_DATA_ROW + 1).getCell(1).value).toBeNull();
        expect(ws.getRow(FIRST_DATA_ROW + 1).getCell(2).value).toBeNull();
        expect(ws.getRow(FIRST_DATA_ROW + 1).getCell(colIndex('I') + 1).value).toBe('4120101');
    });

    it('text that looks like a formula stays text (AT-16)', async () => {
        const p = profile();
        const v = vouchers(p);
        v[0].lines[0].description = '=HYPERLINK("http://x","y")';
        v[0].lines[1].description = '+SUM(1,2)';
        const ws = await read(await buildMangoWorkbook(p, v));
        const a = ws.getRow(FIRST_DATA_ROW).getCell(colIndex('O') + 1);
        expect(a.value).toBe('=HYPERLINK("http://x","y")');
        expect(a.type).toBe(ExcelJS.ValueType.String);
        expect(ws.getRow(FIRST_DATA_ROW + 1).getCell(colIndex('O') + 1).type).toBe(ExcelJS.ValueType.String);
    });

    it('does not truncate: 150 vouchers → 300 rows, one sheet, no extra sheets', async () => {
        const p = profile();
        const docs = Array.from({ length: 150 }, (_, i) => doc({ id: `d${i}`, room_number: `A${i}` }));
        const buf = await buildMangoWorkbook(p, vouchers(p, docs));
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
        expect(wb.worksheets).toHaveLength(1);
        expect(wb.worksheets[0].lastRow!.number).toBe(FIRST_DATA_ROW + 299);
    });

    it('amounts survive with two decimals', async () => {
        const p = profile();
        const ws = await read(await buildMangoWorkbook(p, vouchers(p, [doc({ lines: [{ category: 'rent', amount_satang: 123457 }], total_satang: 123457 })])));
        expect(ws.getRow(FIRST_DATA_ROW).getCell(colIndex('R') + 1).value).toBe(1234.57);
    });
});