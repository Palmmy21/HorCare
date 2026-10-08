/**
 * Writes Mango "journal import" workbooks (sheet "My sheet", columns A–BC, header on row 7, data from row 8).
 *
 * The layout is taken from the two sample files the customer supplied. It is NOT yet confirmed
 * against a template Mango approved, so every choice the samples cannot settle (date format, whether
 * header fields repeat on each line, who fills Voucher no./Book/…) comes from the profile and defaults
 * to leaving the cell blank rather than guessing a value.
 *
 * Everything is written as plain values: text for codes/dates (leading zeros survive, and text that
 * starts with = + - @ can never become a formula), numbers only for Dr./Cr.
 */
import ExcelJS from 'exceljs';
import type { JournalLine, MangoProfile, Voucher } from '../src/shared/accounting.js';
import { fromSatang } from '../src/shared/accounting.js';

export const SHEET_NAME = 'My sheet';
export const HEADER_ROW = 7;
export const FIRST_DATA_ROW = 8;

/** Header text per column, in order A…BC. Spelling is kept exactly as in the customer's file. */
export const MANGO_HEADERS = [
    'Voucher no.', 'Voucher date', 'Book', 'Ref No.: (Header)', 'Ref. Date (Header)', 'Remark 1', 'Remark 2', 'PU Cost Y/N',
    'Account Code in MANGO', 'AC Type GL=Normal RV= Reverse', '***Project Code/Site ID', '***Job  Code', '***Department Code', 'Cost Code',
    'Description', 'Ref. no. (Detail)', 'Ref Date (Detail)', 'Dr.', 'Cr.', 'Vender Code', 'Customer Code', 'Tax', 'Tax No', 'Tax/WT Date',
    'Tax Description', 'Amount', 'Tax %', 'Tax Amount', 'Tax Type', 'Tax/Personal ID', 'Vendor / Customer Name', 'Branch no', 'Address 1', 'Address 2',
    'W/T No', 'Option pay & Receipt', 'Data Type', '',
    'Customer Name', 'Address', 'Address2', 'Address3', 'Tel No.', 'Fax No.', 'Contract', 'Cr Term', 'Maximum Amount', 'A/C AR', 'TAX ID', 'CARD ID',
    'E.Mail', 'Old Code', 'A/R Retention', 'Type Debtor', 'Branch No.',
] as const;

/** 0-based column index by Excel letters (A=0 … BC=54). */
export function colIndex(letters: string): number {
    return letters.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

export function formatDate(isoDate: string, fmt: MangoProfile['options']['date_format']): string {
    const [y, m, d] = isoDate.split('-');
    if (fmt === 'yyyy-mm-dd') return isoDate;
    return `${d}/${m}/${fmt === 'dd/mm/yyyy_be' ? String(Number(y) + 543) : y}`;
}

const COL = {
    voucherNo: 'A', date: 'B', book: 'C', refNo: 'D', refDate: 'E', remark1: 'F', puCost: 'H', account: 'I', acType: 'J',
    project: 'K', job: 'L', department: 'M', costCode: 'N', description: 'O', detailRef: 'P', detailDate: 'Q', dr: 'R', cr: 'S',
    customer: 'U', option: 'AJ', dataType: 'AK',
} as const;

/** Cell values for one journal line; null/undefined = leave the cell empty. */
export function lineCells(profile: MangoProfile, v: Voucher, l: JournalLine, first: boolean): Record<string, string | number | null> {
    const o = profile.options;
    const header = first || o.header_on_every_line;
    const date = (d: string) => formatDate(d, o.date_format);
    return {
        [COL.voucherNo]: header && o.voucher_no_from_horcare ? v.doc_ref : null,
        [COL.date]: header ? date(v.voucher_date) : null,
        [COL.book]: header ? profile.codes.book : null,
        [COL.refNo]: header ? v.doc_ref : null,
        [COL.refDate]: header ? date(v.voucher_date) : null,
        [COL.remark1]: header ? v.remark1 : null,
        [COL.puCost]: header ? profile.codes.pu_cost_yn : null,
        [COL.account]: l.account,
        [COL.acType]: header ? profile.codes.ac_type : null,
        [COL.project]: profile.codes.project,
        [COL.job]: profile.codes.job,
        [COL.department]: profile.codes.department,
        [COL.costCode]: profile.codes.cost_code,
        [COL.description]: l.description,
        [COL.detailRef]: l.ref_no,
        [COL.detailDate]: date(l.ref_date),
        [COL.dr]: l.dr_satang > 0 ? fromSatang(l.dr_satang) : null,
        [COL.cr]: l.cr_satang > 0 ? fromSatang(l.cr_satang) : null,
        [COL.customer]: l.customer_code,
        [COL.option]: l.option_code,
        [COL.dataType]: header ? profile.codes.data_type : null,
    };
}

export async function buildMangoWorkbook(profile: MangoProfile, vouchers: Voucher[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'HorCare';
    const ws = wb.addWorksheet(SHEET_NAME);

    const header = ws.getRow(HEADER_ROW);
    MANGO_HEADERS.forEach((h, i) => { if (h) header.getCell(i + 1).value = h; });
    header.font = { bold: true };

    let rowNo = FIRST_DATA_ROW;
    for (const v of vouchers) {
        v.lines.forEach((l, i) => {
            const row = ws.getRow(rowNo++);
            for (const [letters, value] of Object.entries(lineCells(profile, v, l, i === 0))) {
                if (value === null || value === undefined || value === '') continue;
                const cell = row.getCell(colIndex(letters) + 1);
                if (typeof value === 'number') {
                    cell.value = value;
                    cell.numFmt = '#,##0.00';
                } else {
                    cell.value = value; // plain string: never a formula
                    cell.numFmt = '@';
                }
            }
        });
    }
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
}
