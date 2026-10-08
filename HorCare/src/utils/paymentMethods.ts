import type { PaymentMethod, PaymentVerification } from '../types';

export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'bank_transfer', 'qr_gateway', 'other'];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'เงินสด',
  bank_transfer: 'เงินโอน',
  qr_gateway: 'QR / Payment Gateway',
  other: 'อื่นๆ',
};

export const VERIFICATION_LABELS: Record<PaymentVerification, string> = {
  unverified: 'ยังไม่ยืนยันกับบัญชี',
  verified: 'ยืนยันแล้ว',
  rejected: 'ปฏิเสธ',
};

interface PaidLike {
  payment_method?: PaymentMethod;
  paid_method?: 'auto' | 'manual';
  slip_image?: boolean;
  slip_path?: string;
  slip_ref?: string;
}

/**
 * The method a paid item should be reported under. Items paid before this field
 * existed have no `payment_method`: bills confirmed by slip are bank transfers,
 * everything else is reported as "other" rather than guessed to be cash.
 */
export function resolvePaymentMethod(item: PaidLike): PaymentMethod {
  if (item.payment_method) return item.payment_method;
  if (item.paid_method === 'auto' || item.slip_image || item.slip_path || item.slip_ref) return 'bank_transfer';
  return 'other';
}

export interface PaymentRecordFields {
  payment_method: PaymentMethod;
  paid_at: string;
  paid_method: 'manual';
  paid_amount?: number;
  received_by?: string;
  bank_account?: string;
  bank_account_id?: string;
  transaction_ref?: string;
  verification_status?: PaymentVerification;
  payment_note?: string;
}

/** Drop empty strings/undefined so Firestore never receives `undefined`. */
export function compactFields<T extends object>(fields: T): T {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined && v !== ''),
  ) as T;
}
