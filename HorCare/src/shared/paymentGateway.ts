// Foundation for HorCare's own payment gateway (and any third-party one): the rules every provider shares.
//
// A "payment intent" is HorCare's record of "this tenant should pay this much for this bill, through this provider".
// The provider (a bank, a PromptPay aggregator, HorCare's own gateway) produces a QR / pay link for the intent and later
// tells HorCare it was paid through a signed webhook. Nothing here talks to a provider: it is the state machine, the
// reference format and the shapes a provider plugs into, so a real gateway can be added without touching billing.
// Money is integer satang.

export const INTENT_STATUSES = ['created', 'pending', 'paid', 'expired', 'failed', 'cancelled', 'refunded', 'needs_review'] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const INTENT_STATUS_LABELS_TH: Record<IntentStatus, string> = {
  created: 'สร้างแล้ว', pending: 'รอชำระ', paid: 'ชำระแล้ว', expired: 'หมดอายุ', failed: 'ไม่สำเร็จ', cancelled: 'ยกเลิก', refunded: 'คืนเงินแล้ว',
  needs_review: 'รอตรวจสอบ (ยอดไม่ตรง)',
};

/** What an intent pays for. `charge` = a daily / weekly collection charge (stay, stall, walk-in). */
export const TARGET_KINDS = ['bill', 'fine', 'charge'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const DEFAULT_INTENT_TTL_MIN = 30;
export const MAX_INTENT_TTL_MIN = 24 * 60;

/** users/{owner}/buildings/{b}/payment_intents/{id} */
export interface PaymentIntent {
  id: string;
  owner_uid: string;
  building_id: string;
  room_id: string | null;
  target: { kind: TargetKind; id: string };
  amount_satang: number;
  currency: 'THB';
  status: IntentStatus;
  provider: string;
  /** Short code that travels with the money (QR reference 1); how a webhook finds this intent. */
  reference: string;
  /** The provider's own id for the charge, once it has one. */
  provider_ref: string | null;
  qr_payload: string | null;
  pay_url: string | null;
  created_at: string;
  created_by: string;
  expires_at: string;
  paid_at?: string;
  /** Provider's transaction id of the payment that settled it. */
  provider_txn_id?: string;
  /** Fee the provider kept, if it reports one; the property receives amount − fee. */
  fee_satang?: number;
  /** Set on needs_review: what actually arrived. */
  received_satang?: number;
  payment_id?: string;
  failure_reason?: string;
}

// ── lifecycle ───────────────────────────────────────────────────────────────

const NEXT: Record<IntentStatus, IntentStatus[]> = {
  created: ['pending', 'paid', 'cancelled', 'expired', 'failed', 'needs_review'],
  pending: ['paid', 'expired', 'failed', 'cancelled', 'needs_review'],
  paid: ['refunded'],
  expired: ['paid', 'needs_review'],   // money can arrive after the QR expired: it is still the tenant's money
  failed: [],
  cancelled: ['paid', 'needs_review'],  // same: a tenant who paid just as it was cancelled
  refunded: [],
  needs_review: ['paid', 'refunded', 'cancelled'],
};

export const canTransition = (from: IntentStatus, to: IntentStatus): boolean => NEXT[from].includes(to);
/** Intents that can still be paid by a customer scanning their QR. */
export const isOpen = (s: IntentStatus): boolean => s === 'created' || s === 'pending';
export const isFinal = (s: IntentStatus): boolean => s === 'failed' || s === 'refunded';

/** Open intents past their expiry are treated as expired (the stored status is updated when next touched). */
export function effectiveStatus(i: Pick<PaymentIntent, 'status' | 'expires_at'>, now: number = Date.now()): IntentStatus {
  return isOpen(i.status) && Date.parse(i.expires_at) <= now ? 'expired' : i.status;
}

export function intentExpiry(ttlMinutes: number | undefined, now: number = Date.now()): string {
  const ttl = ttlMinutes === undefined ? DEFAULT_INTENT_TTL_MIN : Math.min(Math.max(Math.round(ttlMinutes), 1), MAX_INTENT_TTL_MIN);
  return new Date(now + ttl * 60_000).toISOString();
}

// ── reference ───────────────────────────────────────────────────────────────

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** "HC" + 10 characters: upper-case letters and digits only, no look-alikes, short enough for a PromptPay bill-payment reference. */
export const REFERENCE_RE = /^HC[A-HJ-NP-Z2-9]{10}$/;

/** A fresh reference from random bytes (the caller supplies them so this stays pure and testable). */
export function makeReference(randomBytes: ArrayLike<number>): string {
  let out = 'HC';
  for (let i = 0; i < 10; i++) out += REF_ALPHABET[(randomBytes[i] ?? 0) % REF_ALPHABET.length];
  return out;
}

export const isReference = (s: unknown): s is string => typeof s === 'string' && REFERENCE_RE.test(s);

// ── what a provider must do ─────────────────────────────────────────────────

/** A provider's webhook, reduced to the facts HorCare acts on. Everything provider-specific is parsed away. */
export interface ProviderEvent {
  /** Unique per delivery attempt's subject (not per retry): the same event retried has the same id. */
  event_id: string;
  /** Our reference, as printed in the QR / sent when the charge was created. */
  reference: string;
  status: 'paid' | 'failed' | 'expired' | 'refunded';
  amount_satang: number;
  paid_at?: string;
  provider_txn_id?: string;
  fee_satang?: number;
}

export interface ChargeRequest {
  intent_id: string;
  reference: string;
  amount_satang: number;
  expires_at: string;
  description: string;
}
export interface ChargeResult { provider_ref: string | null; qr_payload: string | null; pay_url: string | null }

/** Contract for a gateway. Implementations live in api/_gateways/ and are registered in api/_gateway-registry.ts. */
export interface PaymentProvider {
  /** Stable id stored on every intent ("sandbox", "horcare", …). */
  id: string;
  label: string;
  createCharge(req: ChargeRequest): Promise<ChargeResult>;
  /**
   * Check the webhook's signature and parse it. Must THROW when the signature is wrong or the body is malformed;
   * returns null for a valid webhook that HorCare has no use for (e.g. a heartbeat).
   */
  verifyWebhook(rawBody: Uint8Array, headers: Record<string, string | string[] | undefined>): ProviderEvent | null;
  /** Optional: ask the provider for the current state (reconciliation of intents whose webhook never arrived). */
  fetchStatus?(reference: string): Promise<ProviderEvent | null>;
  /** Optional: send money back. */
  refund?(reference: string, amountSatang: number): Promise<{ ok: boolean; provider_ref?: string }>;
}

// ── settling ────────────────────────────────────────────────────────────────

export type SettleDecision =
  | { action: 'settle' }
  | { action: 'review'; reason: 'amount_mismatch' | 'after_cancel'; received_satang: number }
  | { action: 'mark'; status: Extract<IntentStatus, 'failed' | 'expired' | 'refunded'> }
  | { action: 'ignore'; reason: 'already_applied' | 'not_applicable' };

/**
 * What a verified provider event should do to an intent. The amount must match exactly: a short or over payment is
 * never silently applied, it goes to review for the owner to settle by hand (refund or top-up).
 */
export function decideSettlement(intent: Pick<PaymentIntent, 'status' | 'amount_satang' | 'expires_at'>, ev: Pick<ProviderEvent, 'status' | 'amount_satang'>): SettleDecision {
  if (ev.status === 'paid') {
    if (intent.status === 'paid' || intent.status === 'refunded') return { action: 'ignore', reason: 'already_applied' };
    if (ev.amount_satang !== intent.amount_satang) return { action: 'review', reason: 'amount_mismatch', received_satang: ev.amount_satang };
    if (intent.status === 'cancelled') return { action: 'review', reason: 'after_cancel', received_satang: ev.amount_satang };
    if (!canTransition(intent.status, 'paid')) return { action: 'ignore', reason: 'not_applicable' };
    return { action: 'settle' };
  }
  const to = ev.status === 'failed' ? 'failed' : ev.status === 'expired' ? 'expired' : 'refunded';
  if (intent.status === to) return { action: 'ignore', reason: 'already_applied' };
  if (!canTransition(intent.status, to)) return { action: 'ignore', reason: 'not_applicable' };
  return { action: 'mark', status: to };
}

/** What the property actually receives after the provider's fee. */
export const netAmount = (amountSatang: number, feeSatang: number | undefined): number => Math.max(0, amountSatang - (feeSatang ?? 0));
