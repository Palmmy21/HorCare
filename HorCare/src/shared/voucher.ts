import type { JournalEntry, Ledger } from './ledger.js';

const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** 0 – 999,999 in Thai words (เอ็ด for a trailing 1, ยี่สิบ for 20s). */
function belowMillion(n: number): string {
    const ds = String(n).split('').map(Number);
    let out = '';
    ds.forEach((d, i) => {
        const place = ds.length - 1 - i;
        if (d === 0) return;
        if (place === 0 && d === 1 && ds.length > 1) out += 'เอ็ด';
        else if (place === 1 && d === 1) out += 'สิบ';
        else if (place === 1 && d === 2) out += 'ยี่สิบ';
        else out += DIGITS[d] + PLACES[place];
    });
    return out;
}

function intWords(n: number): string {
    if (n === 0) return 'ศูนย์';
    const millions = Math.floor(n / 1_000_000);
    const rest = n % 1_000_000;
    return (millions ? intWords(millions) + 'ล้าน' : '') + (rest ? belowMillion(rest) : '');
}

/** An amount as written on Thai vouchers and receipts: 1250.50 → "หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์". */
export function bahtText(satang: number): string {
    const neg = satang < 0;
    const abs = Math.abs(Math.round(satang));
    const baht = Math.floor(abs / 100), st = abs % 100;
    const words = st === 0 ? `${intWords(baht)}บาทถ้วน` : `${baht ? `${intWords(baht)}บาท` : ''}${intWords(st)}สตางค์`;
    return (neg ? 'ลบ' : '') + words;
}

export type VoucherKind = 'receipt' | 'payment' | 'general';
export const VOUCHER_TITLES: Record<VoucherKind, string> = { receipt: 'ใบสำคัญรับ', payment: 'ใบสำคัญจ่าย', general: 'ใบสำคัญทั่วไป' };

/** Cash and bank accounts of a ledger: the ones its receipt channels post to, plus the chart's cash/bank accounts. */
export function cashAccounts(ledger: Ledger): Set<string> {
    const set = new Set(Object.values(ledger.posting.channels));
    for (const a of ledger.accounts) if (a.type === 'asset' && /เงินสด|เงินฝาก|ธนาคาร/.test(a.name)) set.add(a.code);
    return set;
}

/**
 * Which voucher an entry is printed on: money coming in to cash/bank → receipt voucher, money going out of
 * cash/bank → payment voucher, anything else (invoices, accruals, closing) → general (journal) voucher.
 */
export function voucherKind(entry: JournalEntry, cash: Set<string>): VoucherKind {
    const inflow = entry.lines.reduce((s, l) => s + (cash.has(l.account) ? l.dr_satang - l.cr_satang : 0), 0);
    if (inflow > 0) return 'receipt';
    if (inflow < 0) return 'payment';
    return 'general';
}
