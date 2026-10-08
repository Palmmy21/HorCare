/**
 * Writes Mango "journal import" workbooks.
 *
 * The file is built ON the customer's own template (api/_mango-template.ts: instruction rows 1–6, header
 * row 7, formatting to row 100, sample data removed) so colours, widths and header text are exactly
 * Mango's. Data starts at row 8. What the sample cannot settle comes from the profile and defaults to
 * the sample's behaviour: header fields repeat on every line, the customer code is on every line, the
 * reference columns stay empty, and the columns Mango fills are left blank unless the accountant says otherwise.
 *
 * Values are plain: text for codes (leading zeros survive; a string can never become a formula), real
 * dates for date columns, numbers only for Dr./Cr.
 *
 * NOT yet confirmed by a successful import into Mango — see the UAT checklist.
 */
import ExcelJS from 'exceljs';
import type { JournalLine, MangoProfile, Voucher } from '../src/shared/accounting.js';
import { fromSatang } from '../src/shared/accounting.js';
import { MANGO_TEMPLATE_BASE64 } from './_mango-template.js';

export const SHEET_NAME = 'My sheet';
export const HEADER_ROW = 7;
export const FIRST_DATA_ROW = 8;
/** The template formats rows up to here; rows beyond copy the style of the first data row. */
const TEMPLATE_LAST_ROW = 100;
const COLUMN_COUNT = 55;

/** Header text per column, A…BC — kept for validation/tests; the file's own header row comes from the template. */
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

/** Excel stores a calendar date as UTC midnight of that date. */
export function excelDate(isoDate: string): Date {
    return new Date(`${isoDate}T00:00:00.000Z`);
}

const DATE_FORMATS: Record<MangoProfile['options']['date_format'], string | null> = {
    template: null, // keep the format the template already has on the cell
    'dd/mm/yyyy': 'dd/mm/yyyy',
    'yyyy-mm-dd': 'yyyy-mm-dd',
};

const COL = {
    voucherNo: 'A', date: 'B', book: 'C', refNo: 'D', refDate: 'E', remark1: 'F', puCost: 'H', account: 'I', acType: 'J',
    project: 'K', job: 'L', department: 'M', costCode: 'N', description: 'O', detailRef: 'P', detailDate: 'Q', dr: 'R', cr: 'S',
    customer: 'U', option: 'AJ', dataType: 'AK', customerName: 'AM', customerTel: 'AQ',
} as const;

type CellValue = string | number | Date | null;

/** Cell values for one journal line; null = leave the cell empty. */
export function lineCells(profile: MangoProfile, v: Voucher, l: JournalLine, first: boolean): Record<string, CellValue> {
    const o = profile.options;
    const header = first || o.header_on_every_line;
    const refs = o.fill_reference_columns;
    const block = o.fill_customer_block;
    return {
        [COL.voucherNo]: header && o.voucher_no_from_horcare ? v.doc_ref : null,
        [COL.date]: header ? excelDate(v.voucher_date) : null,
        [COL.book]: header ? profile.codes.book : null,
        [COL.refNo]: header && refs ? v.doc_ref : null,
        [COL.refDate]: header && refs ? excelDate(v.voucher_date) : null,
        [COL.remark1]: header ? v.remark1 : null,
        [COL.puCost]: header ? profile.codes.pu_cost_yn : null,
        [COL.account]: l.account,
        [COL.acType]: header ? profile.codes.ac_type : null,
        [COL.project]: profile.codes.project,
        [COL.job]: profile.codes.job,
        [COL.department]: profile.codes.department,
        [COL.costCode]: profile.codes.cost_code,
        [COL.description]: l.description,
        [COL.detailRef]: refs ? l.ref_no : null,
        [COL.detailDate]: refs ? excelDate(l.ref_date) : null,
        [COL.dr]: l.dr_satang > 0 ? fromSatang(l.dr_satang) : null,
        [COL.cr]: l.cr_satang > 0 ? fromSatang(l.cr_satang) : null,
        [COL.customer]: l.customer_code,
        [COL.option]: l.option_code,
        [COL.dataType]: header ? profile.codes.data_type : null,
        [COL.customerName]: block ? (v.customer_name?.trim() || null) : null,
        [COL.customerTel]: block ? (v.customer_tel?.trim() || null) : null,
    };
}

export async function buildMangoWorkbook(profile: MangoProfile, vouchers: Voucher[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(MANGO_TEMPLATE_BASE64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(SHEET_NAME);
    if (!ws) throw new Error('mango template is missing its sheet');
    wb.creator = 'HorCare';

    const dateFmt = DATE_FORMATS[profile.options.date_format];
    const styleRow = ws.getRow(FIRST_DATA_ROW);

    let rowNo = FIRST_DATA_ROW;
    for (const v of vouchers) {
        v.lines.forEach((l, i) => {
            const row = ws.getRow(rowNo);
            if (rowNo > TEMPLATE_LAST_ROW) {
                for (let c = 1; c <= COLUMN_COUNT; c++) row.getCell(c).style = { ...styleRow.getCell(c).style };
                row.height = styleRow.height;
            }
            for (const [letters, value] of Object.entries(lineCells(profile, v, l, i === 0))) {
                if (value === null || value === undefined || value === '') continue;
                const cell = row.getCell(colIndex(letters) + 1);
                cell.value = value;
                if (value instanceof Date) {
                    if (dateFmt) cell.numFmt = dateFmt;
                    else if (!cell.numFmt || cell.numFmt === 'General') cell.numFmt = 'mm-dd-yy';
                } else if (typeof value === 'string') {
                    cell.numFmt = '@'; // text: keeps leading zeros, never evaluated
                }
            }
            rowNo++;
        });
    }
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
}
