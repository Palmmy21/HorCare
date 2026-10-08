import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { MANGO_HEADERS, buildMangoWorkbook, colIndex, excelDate, HEADER_ROW, FIRST_DATA_ROW } from './_mango-xlsx.js';
import { MANGO_TEMPLATE_BASE64 } from './_mango-template.js';
import { buildVouchers, emptyProfile, type MangoProfile, type ReceivableDoc } from '../src/shared/accounting.js';

const profile = (): MangoProfile => {
    const p = emptyProfile('p1');
    return {
        ...p, legal_entity_name: 'X', template_version: 't', property_ids: ['b1'],
        codes: { ...p.codes, ar_account: '1140102', project: '00202023', job: '001', book: null },
        revenue_accounts: { rent: '4120101' }, customers: { r1: { code: '0012' } },
        channels: { cash: { account: '1122208', option_code: '10002' } },
    };
};
const doc = (over: Partial<ReceivableDoc> = {}): ReceivableDoc => ({
    kind: 'bill', id: 'a', room_id: 'r1', room_number: 'A01', period: '2026-10', issued_at: '2026-10-05T03:00:00Z', status: 'issued',
    lines: [{ category: 'rent', amount_satang: 10000 }], total_satang: 10000, revision: 'r', customer_name: 'สมชาย ทดสอบ', customer_tel: '0812345678', ...over,
});
const vouchers = (p: MangoProfile, docs = [doc()]) =>
    buildVouchers({ profile: p, kind: 'invoice', from: '2026-10-01', to: '2026-10-31', docs, payments: [], exported: new Map() }).vouchers;
const read = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer); return wb.getWorksheet('My sheet')!; };
const cell = (ws: ExcelJS.Worksheet, row: number, col: string) => ws.getRow(row).getCell(colIndex(col) + 1);

describe('template', () => {
    it('is Mango\'s template with all sample customer data removed', async () => {
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(MANGO_TEMPLATE_BASE64, 'base64') as unknown as ArrayBuffer);
        const ws = wb.getWorksheet('My sheet')!;
        let leftovers = 0;
        ws.eachRow((row, n) => { if (n >= FIRST_DATA_ROW) row.eachCell(c => { if (c.value !== null && c.value !== '') leftovers++; }); });
        expect(leftovers).toBe(0);
        expect(ws.getRow(HEADER_ROW).actualCellCount).toBeGreaterThan(50);
    });
    it('has 55 columns A–BC with the customer\'s spelling and an empty AL', () => {
        expect(MANGO_HEADERS).toHaveLength(55);
        expect(MANGO_HEADERS[colIndex('T')]).toBe('Vender Code');
        expect(MANGO_HEADERS[colIndex('AL')]).toBe('');
        expect(colIndex('BC')).toBe(54);
    });
    it('excelDate is UTC midnight of the calendar date', () => {
        expect(excelDate('2026-10-05').toISOString()).toBe('2026-10-05T00:00:00.000Z');
    });
});

describe('workbook', () => {
    it('keeps the template\'s instruction rows and header, and its header text matches ours', async () => {
        const p = profile();
        const ws = await read(await buildMangoWorkbook(p, vouchers(p)));
        expect(ws.getRow(1).getCell(2).value).toBe('ช่องสีเทาแมงโก้กรอก');
        expect(ws.getRow(6).getCell(6).value).toBe('ต้องกรอก');
        MANGO_HEADERS.forEach((h, i) => { if (h) expect(ws.getRow(HEADER_ROW).getCell(i + 1).value).toBe(h); });
        expect(ws.name).toBe('My sheet');
    });

    it('writes balanced lines from row 8: text codes, real dates, numeric Dr./Cr., customer code on every line', async () => {
        const p = profile();
        const ws = await read(await buildMangoWorkbook(p, vouchers(p)));
        const [dr, cr] = [FIRST_DATA_ROW, FIRST_DATA_ROW + 1];
        expect(cell(ws, dr, 'I').value).toBe('1140102');
        expect(cell(ws, dr, 'K').value).toBe('00202023');
        expect(cell(ws, dr, 'L').value).toBe('001');
        expect(cell(ws, dr, 'U').value).toBe('0012');
        expect(cell(ws, cr, 'U').value).toBe('0012');
        expect(cell(ws, dr, 'R').value).toBe(100);
        expect(cell(ws, dr, 'S').value).toBeNull();
        expect(cell(ws, cr, 'S').value).toBe(100);
        expect(cell(ws, cr, 'R').value).toBeNull();
        expect(cell(ws, dr, 'F').value).toBe('บันทึกตั้งลูกหนี้');
        expect(cell(ws, dr, 'B').value).toEqual(excelDate('2026-10-05'));
        expect(cell(ws, dr, 'B').type).toBe(ExcelJS.ValueType.Date);
        expect(cell(ws, dr, 'B').numFmt).toBe('mm-dd-yy');
    });

    it('matches the sample: reference and customer-block columns stay empty until the profile turns them on', async () => {
        const p = profile();
        let ws = await read(await buildMangoWorkbook(p, vouchers(p)));
        for (const c of ['A', 'C', 'D', 'E', 'H', 'J', 'P', 'Q', 'T', 'AJ', 'AK', 'AL', 'AM', 'AQ']) expect(cell(ws, FIRST_DATA_ROW, c).value).toBeNull();
        p.options.fill_reference_columns = true; p.options.fill_customer_block = true;
        ws = await read(await buildMangoWorkbook(p, vouchers(p)));
        expect(cell(ws, FIRST_DATA_ROW, 'D').value).toBe('IV-A01-2026-10');
        expect(cell(ws, FIRST_DATA_ROW, 'P').value).toBe('IV-A01-2026-10');
        expect(cell(ws, FIRST_DATA_ROW, 'AM').value).toBe('สมชาย ทดสอบ');
        expect(cell(ws, FIRST_DATA_ROW + 1, 'AQ').value).toBe('0812345678');
    });

    it('fields Mango fills are only written when the accountant gives a value (no hard-coded 06 / Y / GL / 2)', async () => {
        const p = profile();
        p.codes.book = '06'; p.codes.pu_cost_yn = 'Y'; p.codes.ac_type = 'GL'; p.codes.data_type = '2';
        const ws = await read(await buildMangoWorkbook(p, vouchers(p)));
        expect([cell(ws, 8, 'C').value, cell(ws, 8, 'H').value, cell(ws, 8, 'J').value, cell(ws, 8, 'AK').value]).toEqual(['06', 'Y', 'GL', '2']);
        expect(cell(ws, 9, 'C').value).toBe('06'); // header fields repeat on every line by default, like the sample
    });

    it('receipt lines carry the option code only on the money-in line', async () => {
        const p = profile();
        const pay = {
            id: 'pay00001-x', room_id: 'r1', channel: 'cash', method: 'cash' as const, paid_at: '2026-10-07T03:00:00Z', gross_satang: 10000, verification: 'n/a' as const,
            status: 'active' as const, allocations: [{ target_kind: 'bill' as const, target_id: 'a', amount_satang: 10000 }], revision: 'p',
        };
        const v = buildVouchers({ profile: p, kind: 'receipt', from: '2026-10-01', to: '2026-10-31', docs: [doc()], payments: [pay], exported: new Map([['invoice:bill:a', 'r']]) }).vouchers;
        const ws = await read(await buildMangoWorkbook(p, v));
        expect(cell(ws, 8, 'I').value).toBe('1122208');
        expect(cell(ws, 8, 'AJ').value).toBe('10002');
        expect(cell(ws, 9, 'I').value).toBe('1140102');
        expect(cell(ws, 9, 'AJ').value).toBeNull();
        expect(cell(ws, 8, 'F').value).toBe('บันทึกตัดลูกหนี้');
    });

    it('header fields can be limited to the first line of each voucher', async () => {
        const p = profile(); p.options.header_on_every_line = false; p.options.voucher_no_from_horcare = true;
        const ws = await read(await buildMangoWorkbook(p, vouchers(p)));
        expect(cell(ws, 8, 'A').value).toBe('IV-A01-2026-10');
        expect(cell(ws, 9, 'A').value).toBeNull();
        expect(cell(ws, 9, 'B').value).toBeNull();
        expect(cell(ws, 9, 'I').value).toBe('4120101');
    });

    it('date display format can be overridden', async () => {
        const p = profile(); p.options.date_format = 'dd/mm/yyyy';
        expect(cell(await read(await buildMangoWorkbook(p, vouchers(p))), 8, 'B').numFmt).toBe('dd/mm/yyyy');
    });

    it('text that looks like a formula stays text (AT-16)', async () => {
        const p = profile();
        const v = vouchers(p);
        v[0].lines[0].description = '=HYPERLINK("http://x","y")';
        v[0].lines[1].description = '+SUM(1,2)';
        const ws = await read(await buildMangoWorkbook(p, v));
        expect(cell(ws, 8, 'O').value).toBe('=HYPERLINK("http://x","y")');
        expect(cell(ws, 8, 'O').type).toBe(ExcelJS.ValueType.String);
        expect(cell(ws, 9, 'O').type).toBe(ExcelJS.ValueType.String);
    });

    it('does not truncate past the template\'s 100 formatted rows (AT-15): 150 vouchers → 300 rows, one sheet', async () => {
        const p = profile();
        const docs = Array.from({ length: 150 }, (_, i) => doc({ id: `d${i}`, room_number: `A${i}` }));
        const buf = await buildMangoWorkbook(p, vouchers(p, docs));
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
        expect(wb.worksheets).toHaveLength(1);
        const ws = wb.worksheets[0];
        expect(ws.lastRow!.number).toBe(FIRST_DATA_ROW + 299);
        expect(cell(ws, FIRST_DATA_ROW + 299, 'S').value).toBe(100);
        expect(cell(ws, FIRST_DATA_ROW + 299, 'B').numFmt).toBe('mm-dd-yy');
    });

    it('amounts survive with two decimals', async () => {
        const p = profile();
        const ws = await read(await buildMangoWorkbook(p, vouchers(p, [doc({ lines: [{ category: 'rent', amount_satang: 123457 }], total_satang: 123457 })])));
        expect(cell(ws, 8, 'R').value).toBe(1234.57);
    });
});