// Thai QR Payment (EMVCo merchant-presented, tag 29 "credit transfer") payloads.
//
// Three ways to name the receiver inside tag 29, in order of how widely banking apps accept them:
//   • PromptPay mobile number  — sub-tag 01 (0066 + number without the leading 0)
//   • PromptPay national / tax ID — sub-tag 02 (13 digits)
//   • bank account            — sub-tag 04 (3-digit bank code + account number)
// The first two are the standard PromptPay QR every Thai banking app scans. Sub-tag 04 follows the
// community-documented layout of the Thai QR Payment spec (thai-qr-payment.js.org, saladpuk/PromptPay);
// it has NOT been verified against real banking apps, so a bank account is only used when no PromptPay ID is set.

import { digitsOnly } from './banks.js';

export const PROMPTPAY_AID = 'A000000677010111';

export type QrReceiver =
  | { kind: 'mobile'; id: string }
  | { kind: 'national_id'; id: string }
  | { kind: 'bank_account'; bankCode: string; accountNumber: string };

const tlv = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, '0')}${value}`;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over the whole payload including the "6304" prefix. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** 10-digit mobile starting with 0, or a 13-digit national/tax ID. Returns the digits or null. */
export function cleanPromptPayId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const d = digitsOnly(raw);
  return /^0\d{9}$/.test(d) || /^\d{13}$/.test(d) ? d : null;
}

export const promptPayKind = (id: string): 'mobile' | 'national_id' => (id.length === 13 ? 'national_id' : 'mobile');

/** Shown instead of the full number: 081-xxx-5678 / 1-xxxx-xxxxx-12-3 style masking (first 3 and last 2–4 digits). */
export function maskPromptPayId(id: string): string {
  if (id.length === 13) return `${id.slice(0, 1)}-xxxx-xxxxx-${id.slice(10, 12)}-${id.slice(12)}`;
  return id.length === 10 ? `${id.slice(0, 3)}-xxx-${id.slice(6)}` : id;
}

function receiverField(r: QrReceiver): string {
  if (r.kind === 'mobile') return tlv('01', `0066${r.id.replace(/^0/, '')}`);
  if (r.kind === 'national_id') return tlv('02', r.id);
  return tlv('04', `${r.bankCode}${r.accountNumber}`);
}

/**
 * The text a Thai banking app reads from the QR. With an amount the code is "dynamic" (point of initiation 12)
 * and the app pre-fills it; without, it is static (11) and the payer types the amount.
 */
export function buildThaiQrPayload(receiver: QrReceiver, amount?: number): string {
  if (receiver.kind === 'bank_account' && (!/^\d{3}$/.test(receiver.bankCode) || !/^\d{6,20}$/.test(receiver.accountNumber))) {
    throw new Error('invalid bank account for QR');
  }
  if ((receiver.kind === 'mobile' && !/^0\d{9}$/.test(receiver.id)) || (receiver.kind === 'national_id' && !/^\d{13}$/.test(receiver.id))) {
    throw new Error('invalid PromptPay id');
  }
  const hasAmount = typeof amount === 'number' && Number.isFinite(amount) && amount > 0;
  const body = [
    tlv('00', '01'),
    tlv('01', hasAmount ? '12' : '11'),
    tlv('29', tlv('00', PROMPTPAY_AID) + receiverField(receiver)),
    tlv('58', 'TH'),
    tlv('53', '764'),
    ...(hasAmount ? [tlv('54', (amount as number).toFixed(2))] : []),
    '6304',
  ].join('');
  return body + crc16(body);
}

/** True if the text is one of our payloads: right header, a tag 29 with the PromptPay AID, valid CRC. */
export function isValidThaiQrPayload(payload: string): boolean {
  if (typeof payload !== 'string' || payload.length < 40 || payload.length > 200 || !payload.startsWith('000201')) return false;
  if (!/^[0-9A-Za-z.]+$/.test(payload)) return false;
  if (payload.slice(-8, -4) !== '6304') return false;
  if (crc16(payload.slice(0, -4)) !== payload.slice(-4)) return false;
  return payload.includes(`0016${PROMPTPAY_AID}`);
}

/** What a bank account (optionally with a PromptPay ID) should be paid through. PromptPay wins when set. */
export function receiverForAccount(a: { bank_code: string; account_number: string; promptpay_id?: string | null }): QrReceiver {
  const id = a.promptpay_id ? cleanPromptPayId(a.promptpay_id) : null;
  if (id) return { kind: promptPayKind(id), id };
  return { kind: 'bank_account', bankCode: a.bank_code, accountNumber: digitsOnly(a.account_number) };
}

export function paymentQrPayload(a: { bank_code: string; account_number: string; promptpay_id?: string | null }, amount?: number): string {
  return buildThaiQrPayload(receiverForAccount(a), amount);
}
