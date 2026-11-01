/**
 * Real slip verification: the slip's QR (sending bank + transaction reference) is sent to a slip-verification
 * service, which asks the bank whether that transfer happened and returns what the BANK has on record — amount,
 * sender, receiver (masked account / PromptPay), time. A doctored image or a fake-slip app cannot pass this: the
 * bank either has no such transfer, or its amount / receiver differ from what the picture shows.
 *
 * Providers (set one in the environment; the first configured one is used, or force with SLIP_VERIFY_PROVIDER):
 *   SlipOK   — SLIPOK_API_KEY + SLIPOK_BRANCH_ID   https://slipok.com/api-documentation/
 *   EasySlip — EASYSLIP_API_KEY                     https://document.easyslip.com/en/v2/
 * Duplicate slips are caught by HorCare's own QR fingerprint, so the providers' logging / duplicate features are off.
 */
import type { SlipDetails } from './_slip-verify.js';

export type SlipProvider = 'slipok' | 'easyslip';

export type BankSlipResult =
    /** the bank has this transfer; `details` is the bank's record (authoritative) */
    | { status: 'verified'; provider: SlipProvider; details: SlipDetails }
    /** the bank has no such transfer: a fake, edited or wrong QR */
    | { status: 'not_found'; provider: SlipProvider }
    /** some banks release a transfer a few minutes after it happens */
    | { status: 'pending'; provider: SlipProvider }
    /** no provider configured, or it could not answer (quota, outage, network) — nothing is known */
    | { status: 'unavailable'; provider: SlipProvider | null; reason: string };

const TIMEOUT_MS = 12_000;

export function slipProvider(env: NodeJS.ProcessEnv = process.env): SlipProvider | null {
    const slipok = !!(env.SLIPOK_API_KEY && env.SLIPOK_BRANCH_ID);
    const easyslip = !!env.EASYSLIP_API_KEY;
    const forced = env.SLIP_VERIFY_PROVIDER?.toLowerCase();
    if (forced === 'slipok') return slipok ? 'slipok' : null;
    if (forced === 'easyslip') return easyslip ? 'easyslip' : null;
    return slipok ? 'slipok' : easyslip ? 'easyslip' : null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** SlipOK gives Thailand date + time; EasySlip gives ISO. Both become ISO with +07:00. */
function thaiIso(date: string | null, time: string | null): string | null {
    if (!date || !/^\d{8}$/.test(date)) return null;
    const t = time && /^\d{2}:\d{2}(:\d{2})?$/.test(time) ? (time.length === 5 ? `${time}:00` : time) : '00:00:00';
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${t}+07:00`;
}

interface Party { displayName?: unknown; name?: unknown; account?: { value?: unknown }; proxy?: { value?: unknown } }

/** SlipOK's record → SlipDetails. Exported for tests. */
export function fromSlipOk(d: Record<string, unknown>, bankShort: (code: string | null) => string | null): SlipDetails {
    const sender = (d.sender ?? {}) as Party, receiver = (d.receiver ?? {}) as Party;
    return {
        amount: num(d.amount),
        sender_name: str(sender.displayName) ?? str(sender.name),
        receiver_name: str(receiver.displayName) ?? str(receiver.name),
        // a PromptPay transfer shows the masked phone / ID instead of an account number
        receiver_account: str(receiver.account?.value) ?? str(receiver.proxy?.value),
        receiver_bank: bankShort(str(d.receivingBank)),
        sender_bank: bankShort(str(d.sendingBank)),
        datetime_iso: str(d.transTimestamp) ?? thaiIso(str(d.transDate), str(d.transTime)),
        reference: str(d.transRef),
    };
}

interface EsParty { bank?: { short?: unknown }; account?: { name?: { th?: unknown; en?: unknown }; bank?: { account?: unknown }; proxy?: { account?: unknown } } }

/** EasySlip's record (data.rawSlip) → SlipDetails. Exported for tests. */
export function fromEasySlip(raw: Record<string, unknown>): SlipDetails {
    const sender = (raw.sender ?? {}) as EsParty, receiver = (raw.receiver ?? {}) as EsParty;
    const amount = raw.amount as { amount?: unknown } | number | undefined;
    return {
        amount: typeof amount === 'object' && amount ? num(amount.amount) : num(amount),
        sender_name: str(sender.account?.name?.th) ?? str(sender.account?.name?.en),
        receiver_name: str(receiver.account?.name?.th) ?? str(receiver.account?.name?.en),
        receiver_account: str(receiver.account?.bank?.account) ?? str(receiver.account?.proxy?.account),
        receiver_bank: str(receiver.bank?.short),
        sender_bank: str(sender.bank?.short),
        datetime_iso: str(raw.date),
        reference: str(raw.transRef),
    };
}

async function post(url: string, headers: Record<string, string>, body: unknown, fetchImpl: typeof fetch): Promise<{ status: number; json: Record<string, unknown> }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return { status: res.status, json };
    } finally {
        clearTimeout(timer);
    }
}

/** Ask the bank (through the configured provider) about the transfer behind a slip's QR. Never throws. */
export async function verifyBankSlip(
    qrPayload: string | null,
    opts: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv; bankShort?: (code: string | null) => string | null } = {},
): Promise<BankSlipResult> {
    const env = opts.env ?? process.env;
    const provider = slipProvider(env);
    if (!provider) return { status: 'unavailable', provider: null, reason: 'not_configured' };
    if (!qrPayload) return { status: 'unavailable', provider, reason: 'no_qr' };
    const fetchImpl = opts.fetchImpl ?? fetch;
    const bankShort = opts.bankShort ?? (() => null);

    try {
        if (provider === 'slipok') {
            const { status, json } = await post(
                `https://api.slipok.com/api/line/apikey/${encodeURIComponent(env.SLIPOK_BRANCH_ID!)}`,
                { 'x-authorization': env.SLIPOK_API_KEY! },
                { data: qrPayload, log: false },
                fetchImpl,
            );
            const data = (json.data ?? {}) as Record<string, unknown>;
            if (status < 300 && json.success === true && data.success !== false) {
                return { status: 'verified', provider, details: fromSlipOk(data, bankShort) };
            }
            const code = Number(json.code ?? data.code);
            if (code === 1011 || code === 1008) return { status: 'not_found', provider };   // no such transfer / not a payment QR
            if (code === 1010) return { status: 'pending', provider };                        // the bank releases it later
            return { status: 'unavailable', provider, reason: `slipok_${Number.isFinite(code) ? code : status}` }; // quota, outage, auth…
        }

        const { status, json } = await post(
            'https://api.easyslip.com/v2/verify/bank',
            { Authorization: `Bearer ${env.EASYSLIP_API_KEY}` },
            { payload: qrPayload },
            fetchImpl,
        );
        const data = (json.data ?? {}) as Record<string, unknown>;
        const raw = (data.rawSlip ?? data) as Record<string, unknown>;
        if (status < 300 && json.success === true && raw.transRef) {
            return { status: 'verified', provider, details: fromEasySlip(raw) };
        }
        const code = String((json.error as { code?: unknown } | undefined)?.code ?? '');
        // SLIP_NOT_FOUND: no such transfer · VALIDATION_ERROR: "Invalid bank slip format or verification failed" (a QR that is not a real slip)
        if (code === 'SLIP_NOT_FOUND' || code === 'VALIDATION_ERROR') return { status: 'not_found', provider };
        if (code === 'SLIP_PENDING') return { status: 'pending', provider };
        return { status: 'unavailable', provider, reason: `easyslip_${code || status}` };
    } catch (err) {
        return { status: 'unavailable', provider, reason: (err as Error).name === 'AbortError' ? 'timeout' : 'network' };
    }
}
