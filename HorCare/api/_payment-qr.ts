/**
 * The "pay to" side of bills sent over LINE: which bank account the QR points to, and the block
 * (QR + account details) shown inside a bill or fine. The account is the property's default active account;
 * its PromptPay id (if any) decides whether the QR is a standard PromptPay code or a bank-account code.
 */
import { db } from './_firebase.js';
import { bankByCode, formatAccountNumber, type BankAccount } from '../src/shared/banks.js';
import { paymentQrPayload } from '../src/shared/thaiQr.js';

/** Default active account first, otherwise the oldest active one; null when the property has none. */
export function pickPayAccount(accounts: BankAccount[]): BankAccount | null {
    const active = accounts.filter(a => a.status === 'active');
    return active.find(a => a.is_default) ?? [...active].sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
}

export async function loadPayAccount(ownerUid: string, buildingId: string): Promise<BankAccount | null> {
    const snap = await db.collection(`users/${ownerUid}/buildings/${buildingId}/bank_accounts`).get();
    return pickPayAccount(snap.docs.map(d => d.data() as BankAccount));
}

/** Public URL of the QR image LINE will fetch. */
export function qrImageUrl(account: BankAccount, amount: number, baseUrl: string): string {
    return `${baseUrl.replace(/\/$/, '')}/api/qr?p=${encodeURIComponent(paymentQrPayload(account, amount))}&s=400`;
}

/** The "pay to" block inside a LINE invoice. The QR is left out unless its URL is https (LINE refuses anything else). */
export interface InvoicePay { qrUrl?: string; bank: string; accountName: string; accountNumber: string }

export function invoicePay(account: BankAccount | null, total: number, baseUrl: string): InvoicePay | undefined {
    if (!account || !(total > 0)) return undefined;
    const url = qrImageUrl(account, total, baseUrl);
    return {
        ...(url.startsWith('https://') ? { qrUrl: url } : {}),
        bank: bankByCode(account.bank_code)?.name_th ?? account.bank_short,
        accountName: account.account_name,
        accountNumber: formatAccountNumber(account.account_number),
    };
}
