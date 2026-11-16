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
import { bankByCode, bankFromText, digitsOnly, type Bank } from '../src/shared/banks.js';

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
    /** Every reference-like code printed on the slip (a slip may show more than one); compared with the QR's. */
    references?: string[];
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

export function parseSlipQr(payload: string | null): { bank_code: string | null; reference: string | null } {
    const out = { bank_code: null as string | null, reference: null as string | null };
    if (!payload) return out;
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

// ── Is the QR a genuine slip QR, and does it belong to THIS slip? ─────────────────
/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — the checksum every Thai QR ends with. */
export function crc16(text: string): number {
    let crc = 0xFFFF;
    for (const byte of Buffer.from(text, 'utf8')) {
        crc ^= byte << 8;
        for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc;
}

export interface SlipQrInfo {
    /**
     * bank = the "slip verify" QR every Thai bank prints on a transfer slip · truemoney = TrueMoney Wallet's own ·
     * payment = a QR to pay INTO (PromptPay, a bill's QR) · other = any other QR (a link, Wi-Fi, a parcel label).
     */
    kind: 'bank' | 'truemoney' | 'payment' | 'other';
    /** The checksum at the end of the QR matches its contents: the payload was made by a bank app, not typed or altered. */
    crc_ok: boolean;
    /** Sending bank, 3-digit Bank of Thailand code (bank slips). */
    bank_code: string | null;
    reference: string | null;
    /** The day the transfer was made when the QR carries it (YYYY-MM-DD): many banks start the reference with the date. */
    ref_date: string | null;
}

const validDay = (y: number, m: number, d: number): string | null => {
    if (y < 2015 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCMonth() === m - 1 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
};

/**
 * Take a decoded QR apart. A slip QR is `00 <transfer data> [51 TH] 91 <CRC>`: the CRC covers everything up to and
 * including "9104". Some bank apps drop the CRC's leading zeros (and shorten its length), so it is compared as a number.
 */
export function inspectSlipQr(payload: string | null): SlipQrInfo | null {
    const p = payload?.trim();
    if (!p) return null;
    const info: SlipQrInfo = { kind: 'other', crc_ok: false, bank_code: null, reference: null, ref_date: null };
    if (p.startsWith('000201')) return { ...info, kind: 'payment' };

    // walk the top level by hand: the CRC is the last tag and its length cannot be trusted
    let i = 0, root: string | null = null, crc: string | null = null, crcAt = -1;
    while (i + 4 <= p.length) {
        const id = p.slice(i, i + 2);
        if (id === '91') { crcAt = i; crc = p.slice(i + 4); break; }
        const len = Number(p.slice(i + 2, i + 4));
        if (!/^\d{2}$/.test(id) || !Number.isInteger(len) || i + 4 + len > p.length) return info;
        if (id === '00' && root === null) root = p.slice(i + 4, i + 4 + len);
        i += 4 + len;
    }
    if (root === null) return info;
    const sub = readTlv(root);
    const trueMoney = sub.get('00') === '01' && sub.get('01') === '01' && !!sub.get('03');
    const ref = trueMoney ? sub.get('03')! : sub.get('02');
    if (!ref || ref.length < 6 || ref.length > 40) return info;

    info.kind = trueMoney ? 'truemoney' : 'bank';
    info.reference = ref;
    if (trueMoney) {
        const d = sub.get('04');
        if (d && /^\d{8}$/.test(d)) info.ref_date = validDay(Number(d.slice(4)), Number(d.slice(2, 4)), Number(d.slice(0, 2)));
    } else {
        const bank = sub.get('01');
        if (bank && /^\d{3}$/.test(bank)) info.bank_code = bank;
        const m = ref.match(/^(20\d{2})(\d{2})(\d{2})/);
        if (m) info.ref_date = validDay(Number(m[1]), Number(m[2]), Number(m[3]));
    }
    info.crc_ok = crc !== null && /^[0-9a-fA-F]{1,4}$/.test(crc) && parseInt(crc, 16) === crc16(`${p.slice(0, crcAt)}9104`);
    return info;
}

const refKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

/** The reference in the QR is one of the codes printed on the slip (allowing a character the reader got wrong). */
export function sameReference(qrRef: string, printed: string): boolean {
    const a = refKey(qrRef), b = refKey(printed);
    if (a.length < 6 || b.length < 6) return false;
    if (a === b || nearSame(a, b)) return true;
    // a slip may print the reference with a prefix / suffix around it, or only its tail
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= 8 && long.includes(short);
}

/**
 * The QR check: a real slip QR (right format, checksum intact) whose contents agree with what is PRINTED on the
 * same slip — reference, sending bank, day. A fake-slip app or an edited picture usually carries a QR that is made
 * up, or lifted from another slip, and one of these gives it away.
 *
 * This still cannot prove the money arrived (only the bank can); 'fail' means "do not trust this picture".
 */
export function checkSlipQr(info: SlipQrInfo | null, details: SlipDetails | null): { check: SlipCheck; issues: string[] } {
    if (!info) return { check: 'unknown', issues: [] };
    if (info.kind === 'payment') return { check: 'fail', issues: ['QR ในรูปเป็น QR สำหรับ "รับเงิน" ไม่ใช่ QR ของสลิปโอนเงิน'] };
    if (info.kind === 'other') return { check: 'fail', issues: ['QR ในรูปไม่ใช่ QR ของสลิปโอนเงิน'] };
    const issues: string[] = [];
    if (!info.crc_ok) issues.push('รหัสตรวจสอบ (CRC) ของ QR ไม่ถูกต้อง — QR อาจถูกแก้ไขหรือสร้างขึ้นเอง');

    const printed = [...(details?.references ?? []), details?.reference].filter((r): r is string => !!r && refKey(r).length >= 6);
    if (info.reference && printed.length && !printed.some(r => sameReference(info.reference!, r))) {
        issues.push(`เลขอ้างอิงใน QR (${info.reference}) ไม่ตรงกับเลขอ้างอิงที่พิมพ์บนสลิป (${printed[0]})`);
    }
    const qrBank = bankByCode(info.bank_code), slipBank = bankFromText(details?.sender_bank);
    if (qrBank && slipBank && qrBank.code !== slipBank.code) {
        issues.push(`ธนาคารผู้โอนใน QR (${qrBank.short}) ไม่ตรงกับที่แสดงบนสลิป (${slipBank.short})`);
    }
    if (info.ref_date && details?.datetime_iso) {
        // the slip's own day in Thailand; a day either side is allowed (a transfer around midnight)
        const slipDay = Date.parse(`${details.datetime_iso.slice(0, 10)}T00:00:00Z`), qrDay = Date.parse(`${info.ref_date}T00:00:00Z`);
        if (Number.isFinite(slipDay) && Math.abs(slipDay - qrDay) > 86400_000) {
            issues.push(`วันที่ในรหัสของ QR (${info.ref_date}) ไม่ตรงกับวันที่บนสลิป (${details.datetime_iso.slice(0, 10)})`);
        }
    }
    return { check: issues.length ? 'fail' : 'pass', issues };
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

/**
 * The same word allowing for a slip read off a picture: one wrong / missing character in a word of 5+, two in 10+.
 * (A tone mark or a vowel misread by the reader must not turn the property's own account into "someone else".)
 */
export function nearSame(x: string, y: string): boolean {
    if (x === y) return true;
    const allowed = Math.min(x.length, y.length) >= 10 ? 2 : Math.min(x.length, y.length) >= 5 ? 1 : 0;
    if (!allowed || Math.abs(x.length - y.length) > allowed) return false;
    let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
    for (let i = 1; i <= x.length; i++) {
        const cur = [i];
        for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[y.length] <= allowed;
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

    if (nearSame(s.join(''), a.join(''))) return 'pass';
    // first name equal, and any surname text on the slip is the start of the real surname
    if (nearSame(s[0], a[0])) {
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
// Late payment is normal, so a slip is never "too old" by age alone. The only date rule is against
// reusing an old slip: one dated before the bill was issued (beyond a few days' early payment)
// cannot be for this bill. A slip dated in the future cannot be genuine.
export const SLIP_FUTURE_TOLERANCE_MS = 10 * 60_000;
const BILL_EARLY_TOLERANCE_MS = 3 * 86400_000;

export function checkDatetime(iso: string | null, billCreatedAt: string | null | undefined, now: number): SlipCheck {
    if (!iso) return 'unknown';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return 'unknown';
    if (t > now + SLIP_FUTURE_TOLERANCE_MS) return 'fail';        // from the future
    if (billCreatedAt) {
        const b = Date.parse(billCreatedAt);
        if (Number.isFinite(b) && t < b - BILL_EARLY_TOLERANCE_MS) return 'fail'; // paid before the bill existed — an old slip
    }
    return 'pass';
}

// ── Verdict ───────────────────────────────────────────────────────────────────
export interface SlipVerdict {
    checks: SlipChecks;
    matched_candidate_id: string | null;
    /**
     * One of the receiver's name / number matches an account of the property and the other does not (a PromptPay
     * number that is not on file, a name the reader got wrong): not approved on its own, and not called a mismatch.
     */
    receiver_conflict?: boolean;
    /** Thai, for the owner: why the slip's QR is not trusted (empty unless checks.qr = fail). */
    qr_issues?: string[];
    /** All the evidence a picture can give says this payment is genuine and for this bill. */
    auto_approve: boolean;
}

export function verifySlip(input: {
    details: SlipDetails | null;
    qrPresent: boolean;
    /**
     * The decoded QR. When given, the QR is inspected (format, checksum, agreement with the printed slip) instead of
     * merely being present.
     */
    qrPayload?: string | null;
    duplicate: boolean;
    expectedAmount: number;
    candidates: ReceiverCandidate[];
    billCreatedAt?: string | null;
    now?: number;
}): SlipVerdict {
    const { details, candidates } = input;
    const now = input.now ?? Date.now();

    // to the satang: 3116.4 on the bill and 3116.40 on the slip are the same money however the numbers were stored
    const amount: SlipCheck = details?.amount == null ? 'unknown' : Math.abs(details.amount - input.expectedAmount) < 0.005 ? 'pass' : 'fail';
    const datetime = checkDatetime(details?.datetime_iso ?? null, input.billCreatedAt, now);

    // Judge each receiving account separately; the slip only has to match ONE of them. An account is known by its
    // number AND its PromptPay id (candidates sharing an id): the number on the slip may be either one.
    const byAccount = new Map<string, ReceiverCandidate[]>();
    for (const c of candidates) byAccount.set(c.id, [...(byAccount.get(c.id) ?? []), c]);
    const perCandidate = [...byAccount.values()].map(group => {
        const numbers = group.map(c => compareAccount(details?.receiver_account ?? null, c.number));
        return {
            c: group[0],
            name: compareNames(details?.receiver_name ?? null, group.find(c => c.name)?.name ?? null),
            account: (numbers.includes('pass') ? 'pass' : numbers.every(n => n === 'fail') ? 'fail' : 'unknown') as SlipCheck,
        };
    });
    const ok = perCandidate.filter(p => (p.name === 'pass' || p.account === 'pass') && p.name !== 'fail' && p.account !== 'fail');
    // half a match (see receiver_conflict): shown as it is, left to the owner
    const half = ok.length ? undefined : perCandidate.find(p => p.name === 'pass' || p.account === 'pass');
    // Prefer a candidate that matched on both name and number.
    const best = ok.sort((x, y) => Number(y.name === 'pass') + Number(y.account === 'pass') - Number(x.name === 'pass') - Number(x.account === 'pass'))[0];

    const summarise = (pick: (p: (typeof perCandidate)[number]) => SlipCheck): SlipCheck => {
        if (best) return pick(best);
        if (half) return pick(half);
        if (perCandidate.length === 0) return 'unknown';
        if (perCandidate.some(p => pick(p) === 'fail')) return 'fail';
        return 'unknown';
    };

    const qr = input.qrPayload !== undefined
        ? checkSlipQr(inspectSlipQr(input.qrPayload), details)
        : { check: (input.qrPresent ? 'pass' : 'unknown') as SlipCheck, issues: [] };

    const checks: SlipChecks = {
        amount,
        receiver_name: summarise(p => p.name),
        receiver_account: summarise(p => p.account),
        datetime,
        duplicate: input.duplicate ? 'fail' : 'pass',
        qr: qr.check,
    };

    // The receiver's name / account must match one of the property's accounts: with none on file there is
    // nothing to check the name against, so the slip waits for the owner instead of being approved.
    const receiverOk = !!best;
    const auto_approve = amount === 'pass' && qr.check === 'pass' && !input.duplicate && receiverOk && datetime !== 'fail';
    return { checks, matched_candidate_id: best?.c.id ?? null, receiver_conflict: !best && !!half, qr_issues: qr.issues, auto_approve };
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
