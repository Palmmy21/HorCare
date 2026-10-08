/**
 * Slip verification: compares what was read from a transfer slip with the bill and the
 * property's receiving accounts. Pure functions only — no AI, no database — so every rule
 * can be tested.
 *
 * IMPORTANT: this is evidence from a *picture*. A slip that passes every check is auto-approved
 * as "paid, not yet confirmed against the bank" (verification_status = unverified); only a real
 * bank transaction can confirm it (see the bank reconciliation phase).
 */
import type { SlipCheck, SlipChecks } from '../src/types/index.js';
import { bankByCode, digitsOnly, type Bank } from '../src/shared/banks.js';

export interface SlipDetails {
    amount: number | null;
    sender_name: string | null;
    receiver_name: string | null;
    /** As printed on the slip, usually masked: "xxx-x-x1234-x". */
    receiver_account: string | null;
    receiver_bank: string | null;
    sender_bank: string | null;
    /** ISO with +07:00, Thailand time. */
    datetime_iso: string | null;
    reference: string | null;
}

export interface ReceiverCandidate {
    id: string;
    name: string | null;
    /** Digits only. */
    number: string | null;
    label: string;
}

// ── Slip QR ───────────────────────────────────────────────────────────────────
/**
 * Thai slip QR payloads are EMVCo TLV strings. Tag "00" holds the transfer data:
 * sub-tag "01" = sending bank code (3 digits), sub-tag "02" = transaction reference.
 */
export function parseSlipQr(payload: string | null): { bank_code: string | null; reference: string | null } {
    const out = { bank_code: null as string | null, reference: null as string | null };
    if (!payload) return out;
    const readTlv = (s: string): Map<string, string> => {
        const map = new Map<string, string>();
        let i = 0;
        while (i + 4 <= s.length) {
            const id = s.slice(i, i + 2);
            const len = Number(s.slice(i + 2, i + 4));
            if (!/^\d{2}$/.test(id) || !Number.isInteger(len) || len < 0 || i + 4 + len > s.length) break;
            if (!map.has(id)) map.set(id, s.slice(i + 4, i + 4 + len));
            i += 4 + len;
        }
        return map;
    };
    try {
        const top = readTlv(payload.trim());
        const slip = top.get('00');
        if (!slip) return out;
        const sub = readTlv(slip);
        const bank = sub.get('01');
        const ref = sub.get('02');
        if (bank && /^\d{3}$/.test(bank)) out.bank_code = bank;
        if (ref && ref.length >= 6 && ref.length <= 40) out.reference = ref;
    } catch { /* malformed QR → nothing extracted */ }
    return out;
}

export const senderBankFromQr = (payload: string | null): Bank | undefined => bankByCode(parseSlipQr(payload).bank_code);

// ── Names ─────────────────────────────────────────────────────────────────────
// Titles are only removed from the START of a name (or as whole words), never from inside a word:
// stripping "นาย" everywhere would corrupt real names that contain those letters.
const TITLE_PREFIXES = [
    'เด็กหญิง', 'เด็กชาย', 'นางสาว', 'ห้างหุ้นส่วนจำกัด', 'น.ส.', 'นส.', 'ด.ช.', 'ด.ญ.', 'บจก.', 'หจก.', 'นาย', 'นาง', 'คุณ', 'บริษัท', 'บจก', 'หจก',
].sort((a, b) => b.length - a.length);
const DROP_WORDS = new Set([
    'จำกัด', 'มหาชน', 'mr', 'mrs', 'miss', 'ms', 'mstr', 'co', 'ltd', 'limited', 'company', 'corp', 'inc',
]);
const THAI = /[฀-๿]/;
const LATIN = /[a-z]/;

export function normalizeName(raw: string): string[] {
    const cleaned = raw.toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, ' ').replace(/[-_/(),]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];
    const out: string[] = [];
    cleaned.split(' ').forEach((token, i) => {
        let t = token;
        if (i === 0) {
            const prefix = TITLE_PREFIXES.find(p => t.startsWith(p));
            if (prefix) t = t.slice(prefix.length);
        }
        t = t.replace(/\.+$/g, '').replace(/^\.+/g, '');
        if (!t || DROP_WORDS.has(t)) return;
        out.push(t);
    });
    return out;
}

/** Strip the trailing mask some slips print after a truncated name ("somchai j***"). */
const unmask = (t: string) => t.replace(/[*•]+$/g, '');

/**
 * Compare a name printed on a slip (often shortened / masked) with the account holder's name.
 * 'unknown' when the two cannot be compared at all (e.g. Thai vs English spelling).
 */
export function compareNames(slipName: string | null, accountName: string | null): SlipCheck {
    if (!slipName || !accountName) return 'unknown';
    const s = normalizeName(slipName).map(unmask).filter(t => t && !/^x+$/.test(t));
    const a = normalizeName(accountName);
    if (s.length === 0 || a.length === 0) return 'unknown';

    const sThai = THAI.test(s.join('')), sLatin = LATIN.test(s.join(''));
    const aThai = THAI.test(a.join('')), aLatin = LATIN.test(a.join(''));
    if ((sThai && !sLatin && !aThai && aLatin) || (sLatin && !sThai && !aLatin && aThai)) return 'unknown';

    if (s.join('') === a.join('')) return 'pass';
    // first name equal, and any surname text on the slip is the start of the real surname
    if (s[0] === a[0]) {
        if (s.length === 1) return s[0].length >= 3 ? 'pass' : 'fail';
        const slipSurname = s[s.length - 1];
        return a.slice(1).some(t => t.startsWith(slipSurname)) ? 'pass' : 'fail';
    }
    // slip only shows one name token (first or last)
    if (s.length === 1 && s[0].length >= 3 && a.includes(s[0])) return 'pass';
    return 'fail';
}

// ── Account numbers ───────────────────────────────────────────────────────────
/**
 * Compare a (usually masked) account number from a slip with a real one. Visible digits must
 * match in place when the lengths agree; otherwise every visible run of 3+ digits must appear in
 * the real number. 'unknown' when the slip shows fewer than 3 digits.
 */
export function compareAccount(slipAccount: string | null, number: string | null): SlipCheck {
    if (!slipAccount || !number) return 'unknown';
    const real = digitsOnly(number);
    if (real.length < 6) return 'unknown';
    const compact = slipAccount.replace(/[\s-]/g, '');
    const visibleDigits = digitsOnly(compact);
    if (visibleDigits.length < 3) return 'unknown';

    if (compact.length === real.length && /^[\dxX*•]+$/.test(compact)) {
        for (let i = 0; i < compact.length; i++) {
            if (/\d/.test(compact[i]) && compact[i] !== real[i]) return 'fail';
        }
        return 'pass';
    }
    const runs = compact.match(/\d{3,}/g) ?? [];
    if (runs.length === 0) return 'unknown';
    return runs.every(r => real.includes(r)) ? 'pass' : 'fail';
}

// ── Date / time ───────────────────────────────────────────────────────────────
export const SLIP_MAX_AGE_MS = 30 * 86400_000;
export const SLIP_FUTURE_TOLERANCE_MS = 10 * 60_000;
const BILL_EARLY_TOLERANCE_MS = 3 * 86400_000;

export function checkDatetime(iso: string | null, billCreatedAt: string | null | undefined, now: number): SlipCheck {
    if (!iso) return 'unknown';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return 'unknown';
    if (t > now + SLIP_FUTURE_TOLERANCE_MS) return 'fail';        // from the future
    if (now - t > SLIP_MAX_AGE_MS) return 'fail';                 // stale — likely an old slip
    if (billCreatedAt) {
        const b = Date.parse(billCreatedAt);
        if (Number.isFinite(b) && t < b - BILL_EARLY_TOLERANCE_MS) return 'fail'; // paid long before the bill existed
    }
    return 'pass';
}

// ── Verdict ───────────────────────────────────────────────────────────────────
export interface SlipVerdict {
    checks: SlipChecks;
    matched_candidate_id: string | null;
    /** All the evidence a picture can give says this payment is genuine and for this bill. */
    auto_approve: boolean;
}

export function verifySlip(input: {
    details: SlipDetails | null;
    qrPresent: boolean;
    duplicate: boolean;
    expectedAmount: number;
    candidates: ReceiverCandidate[];
    billCreatedAt?: string | null;
    now?: number;
}): SlipVerdict {
    const { details, candidates } = input;
    const now = input.now ?? Date.now();

    const amount: SlipCheck = details?.amount == null ? 'unknown' : details.amount === input.expectedAmount ? 'pass' : 'fail';
    const datetime = checkDatetime(details?.datetime_iso ?? null, input.billCreatedAt, now);

    // Judge each receiving account separately; the slip only has to match ONE of them.
    const perCandidate = candidates.map(c => ({
        c,
        name: compareNames(details?.receiver_name ?? null, c.name),
        account: compareAccount(details?.receiver_account ?? null, c.number),
    }));
    const ok = perCandidate.filter(p => (p.name === 'pass' || p.account === 'pass') && p.name !== 'fail' && p.account !== 'fail');
    // Prefer a candidate that matched on both name and number.
    const best = ok.sort((x, y) => Number(y.name === 'pass') + Number(y.account === 'pass') - Number(x.name === 'pass') - Number(x.account === 'pass'))[0];

    const summarise = (pick: (p: (typeof perCandidate)[number]) => SlipCheck): SlipCheck => {
        if (best) return pick(best);
        if (perCandidate.length === 0) return 'unknown';
        if (perCandidate.some(p => pick(p) === 'fail')) return 'fail';
        return 'unknown';
    };

    const checks: SlipChecks = {
        amount,
        receiver_name: summarise(p => p.name),
        receiver_account: summarise(p => p.account),
        datetime,
        duplicate: input.duplicate ? 'fail' : 'pass',
        qr: input.qrPresent ? 'pass' : 'unknown',
    };

    // With no receiving account on file there is nothing to compare names against (older setups):
    // fall back to amount + QR + not-duplicate as before.
    const receiverOk = candidates.length === 0 || !!best;
    const auto_approve = amount === 'pass' && input.qrPresent && !input.duplicate && receiverOk && datetime !== 'fail';
    return { checks, matched_candidate_id: best?.c.id ?? null, auto_approve };
}

const CHECK_LABELS: Record<keyof SlipChecks, string> = {
    amount: 'ยอดเงิน', receiver_name: 'ชื่อผู้รับ', receiver_account: 'เลขบัญชีผู้รับ', datetime: 'วันที่-เวลา', duplicate: 'สลิปซ้ำ', qr: 'QR สลิป',
};

/** One-line Thai summary for the owner, e.g. "ผ่าน: ยอดเงิน, ชื่อผู้รับ · ไม่ผ่าน: วันที่-เวลา". */
export function describeChecks(checks: SlipChecks): string {
    const keys = Object.keys(CHECK_LABELS) as (keyof SlipChecks)[];
    const pass = keys.filter(k => checks[k] === 'pass' && k !== 'duplicate').map(k => CHECK_LABELS[k]);
    const fail = keys.filter(k => checks[k] === 'fail').map(k => k === 'duplicate' ? 'สลิปซ้ำ' : CHECK_LABELS[k]);
    const unknown = keys.filter(k => checks[k] === 'unknown' && k !== 'duplicate').map(k => CHECK_LABELS[k]);
    return [
        pass.length ? `ผ่าน: ${pass.join(', ')}` : '',
        fail.length ? `ไม่ผ่าน: ${fail.join(', ')}` : '',
        unknown.length ? `อ่านไม่ได้/เทียบไม่ได้: ${unknown.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
}
