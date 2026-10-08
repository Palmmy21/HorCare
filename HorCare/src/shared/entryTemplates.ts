// Guided journal entries: the owner says what happened ("paid a supplier", "opening balance"), and the lines are worked
// out here — VAT split, withholding tax, the balancing opening-balance line. They produce ordinary manual entries, so
// the same rules apply (balanced, immutable, reversible, period lock). Money is integer satang.
import type { EntryLine } from './ledger.js';

export const VAT_RATE = 7;
export const WHT_RATES = [1, 2, 3, 5] as const;

const round = (n: number) => Math.round(n);

export interface VatSplit { net_satang: number; vat_satang: number; gross_satang: number }

/** Split an amount into price and VAT. `inclusive`: the amount already contains VAT; `exclusive`: VAT is added on top. */
export function vatSplit(amountSatang: number, mode: 'inclusive' | 'exclusive', ratePct: number = VAT_RATE): VatSplit {
  if (mode === 'inclusive') {
    const vat = round((amountSatang * ratePct) / (100 + ratePct));
    return { net_satang: amountSatang - vat, vat_satang: vat, gross_satang: amountSatang };
  }
  const vat = round((amountSatang * ratePct) / 100);
  return { net_satang: amountSatang, vat_satang: vat, gross_satang: amountSatang + vat };
}

export const whtOf = (baseSatang: number, ratePct: number) => round((baseSatang * ratePct) / 100);

const line = (account: string, dr: number, cr: number, description: string, party: string | null = null): EntryLine => ({ account, dr_satang: dr, cr_satang: cr, description, party_id: party });

/**
 * An expense. Paid now (`counter` = cash / bank) or owed to a supplier (`counter` = payable account, `supplier` set).
 * With VAT, the VAT part goes to the input-VAT account instead of the expense.
 */
export function expenseLines(p: {
  expenseAccount: string; counterAccount: string; amountSatang: number; description: string; supplier?: string;
  vat?: { mode: 'inclusive' | 'exclusive'; ratePct?: number; account: string };
}): EntryLine[] {
  const s = p.vat ? vatSplit(p.amountSatang, p.vat.mode, p.vat.ratePct) : { net_satang: p.amountSatang, vat_satang: 0, gross_satang: p.amountSatang };
  return [
    line(p.expenseAccount, s.net_satang, 0, p.description),
    ...(p.vat && s.vat_satang > 0 ? [line(p.vat.account, s.vat_satang, 0, `ภาษีซื้อ ${p.vat.ratePct ?? VAT_RATE}% ${p.description}`)] : []),
    line(p.counterAccount, 0, s.gross_satang, p.description, p.supplier ?? null),
  ];
}

/**
 * Paying a supplier what is owed. With withholding tax the supplier receives less and the tax is owed to the Revenue
 * Department: Dr payable (full), Cr cash/bank (net of tax), Cr withholding-tax payable.
 */
export function payablePaymentLines(p: {
  payableAccount: string; payAccount: string; amountSatang: number; description: string; supplier?: string;
  wht?: { ratePct: number; baseSatang: number; account: string };
}): EntryLine[] {
  const tax = p.wht ? whtOf(p.wht.baseSatang, p.wht.ratePct) : 0;
  return [
    line(p.payableAccount, p.amountSatang, 0, p.description, p.supplier ?? null),
    line(p.payAccount, 0, p.amountSatang - tax, p.description),
    ...(p.wht && tax > 0 ? [line(p.wht.account, 0, tax, `หัก ณ ที่จ่าย ${p.wht.ratePct}% ${p.description}`)] : []),
  ];
}

/**
 * Opening balances: the balances carried in from before HorCare. Whatever the lines do not balance goes to the owner's
 * equity account, which is how an opening balance is normally completed.
 */
export function openingBalanceLines(rows: { account: string; debitSatang: number; creditSatang: number; party?: string }[], equityAccount: string): EntryLine[] {
  const lines = rows.filter(r => r.debitSatang > 0 || r.creditSatang > 0).map(r => line(r.account, r.debitSatang, r.creditSatang, 'ยอดยกมา', r.party ?? null));
  const diff = lines.reduce((s, l) => s + l.dr_satang - l.cr_satang, 0);
  if (diff > 0) lines.push(line(equityAccount, 0, diff, 'ยอดยกมา — ส่วนของเจ้าของ'));
  else if (diff < 0) lines.push(line(equityAccount, -diff, 0, 'ยอดยกมา — ส่วนของเจ้าของ'));
  return lines;
}