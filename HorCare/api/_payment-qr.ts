/**
 * The "pay to" side of bills sent over LINE: which bank account the QR points to, and the messages
 * (QR image + account details) that follow a bill. The account is the property's default active account;
 * its PromptPay id (if any) decides whether the QR is a standard PromptPay code or a bank-account code.
 */
import { db } from './_firebase.js';
import { t } from './_translations.js';
import { bankByCode, formatAccountNumber, type BankAccount } from '../src/shared/banks.js';
import { paymentQrPayload } from '../src/shared/thaiQr.js';
import type { BillLanguage } from '../src/types/index.js';

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

/** The QR image and the account it pays, to send right after a bill. Empty when there is nothing to pay or no account. */
export function paymentQrMessages(account: BankAccount | null, total: number, baseUrl: string, lang: BillLanguage = 'th'): object[] {
    if (!account || !(total > 0)) return [];
    const url = qrImageUrl(account, total, baseUrl);
    const bank = bankByCode(account.bank_code);
    const amount = total.toLocaleString('th-TH', { minimumFractionDigits: 2 });
    return [
        { type: 'image', originalContentUrl: url, previewImageUrl: url },
        {
            type: 'text',
            text: `💳 ${t('scan_promptpay', lang)}\n🏦 ${bank?.name_th ?? account.bank_short}\n👤 ${account.account_name}\n🔢 ${formatAccountNumber(account.account_number)}\n💰 ฿${amount}\n\n${t('flex_send_slip', lang)}`,
        },
    ];
}
