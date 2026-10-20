/**
 * Shared by the LINE webhook and the web slip upload: given a slip image that already passed the
 * QR duplicate check, read it with AI, compare it with the bill and the property's receiving
 * accounts, and return what to write on the bill / fine.
 *
 * It never decides "paid" by itself beyond `autoApprove`, and an auto-approved slip is recorded
 * as `verification_status: 'unverified'` — a picture is not proof the money reached the bank.
 */
import { db } from './_firebase.js';
import { readSlipDetails } from './_slip-ai.js';
import {
    describeChecks, parseSlipQr, senderBankFromQr, verifySlip,
    type ReceiverCandidate, type SlipDetails, type SlipVerdict,
} from './_slip-verify.js';
import { bankAccountLabel, digitsOnly, type BankAccount } from '../src/shared/banks.js';

/** approved = paid now · mismatch = a check failed, tell the tenant what · review = could not check, owner decides. */
export type SlipOutcome = 'approved' | 'mismatch' | 'review';

export interface SlipEvaluation {
    autoApprove: boolean;
    outcome: SlipOutcome;
    /** Thai, tenant-facing: what on the slip does not match (empty unless outcome = mismatch). */
    problems: string[];
    qrPresent: boolean;
    details: SlipDetails | null;
    verdict: SlipVerdict | null;
    /** Extra fields to merge into the bill / fine document (never contains undefined). */
    fields: Record<string, unknown>;
    verifyNote: string;
    /** The amount read from the slip, for the "paid X baht" reply. */
    aiAmount: number | null;
    /**
     * Set when the slip is genuine and paid to the property, only for less than what is owed: the tenant
     * may choose to record it as a part payment (split payment). Baht.
     */
    splitAmount: number | null;
}

export async function loadReceiverCandidates(ownerUid: string, buildingId: string): Promise<{ candidates: ReceiverCandidate[]; accounts: BankAccount[] }> {
    const base = `users/${ownerUid}/buildings/${buildingId}`;
    const accSnap = await db.collection(`${base}/bank_accounts`).get();
    const accounts = accSnap.docs.map(d => d.data() as BankAccount).filter(a => a.status === 'active');
    const candidates: ReceiverCandidate[] = accounts.map(a => ({
        id: a.id, name: a.account_name, number: a.account_number, label: bankAccountLabel(a),
    }));
    // A transfer made to the account's PromptPay id shows the receiver's name and the masked phone / ID, not the
    // account number — so the id is a second way to recognise the same account (same candidate id).
    for (const a of accounts) {
        const id = a.promptpay_id ? digitsOnly(a.promptpay_id) : '';
        if (id) candidates.push({ id: a.id, name: a.account_name, number: id, label: bankAccountLabel(a) });
    }
    return { candidates, accounts };
}

const compact = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export async function evaluateSlip(input: {
    ownerUid: string;
    buildingId: string;
    /** Base64 (no header) of the compressed slip, or null if it could not be prepared. */
    imageBase64: string | null;
    mimeType: string;
    qrPayload: string | null;
    expectedAmount: number;
    billCreatedAt?: string | null;
    /** Paid plans only (AI reading is a paid feature). */
    isPro: boolean;
}): Promise<SlipEvaluation> {
    const qrPresent = !!input.qrPayload;
    // Only "not a reused slip" is known here — never word it as if the payment itself was checked.
    const legacyNote = qrPresent ? 'AI ยังไม่ได้ตรวจยอด/ชื่อ — โปรดตรวจสลิปด้วยตา' : 'อ่าน QR ไม่ได้ — โปรดตรวจสลิปด้วยตา';
    const none: SlipEvaluation = {
        autoApprove: false, outcome: 'review', problems: [], qrPresent, details: null, verdict: null, fields: {}, verifyNote: legacyNote, aiAmount: null, splitAmount: null,
    };

    if (!input.isPro || !input.imageBase64 || !qrPresent) return none;

    const details = await readSlipDetails(input.imageBase64, input.mimeType);
    if (!details) return none;

    const { candidates } = await loadReceiverCandidates(input.ownerUid, input.buildingId);
    const verdict = verifySlip({
        details, qrPresent, duplicate: false, expectedAmount: input.expectedAmount, candidates, billCreatedAt: input.billCreatedAt,
    });

    const qr = parseSlipQr(input.qrPayload);
    const matched = verdict.matched_candidate_id ? candidates.find(c => c.id === verdict.matched_candidate_id) : undefined;

    const fields: Record<string, unknown> = compact({
        slip_amount: details.amount,
        slip_ai_amount: details.amount,
        slip_sender: details.sender_name,
        slip_bank: details.sender_bank ?? senderBankFromQr(input.qrPayload)?.short,
        slip_receiver_name: details.receiver_name,
        slip_receiver_account: details.receiver_account,
        slip_datetime: details.datetime_iso,
        slip_account_id: matched?.id,
        transaction_ref: qr.reference ?? details.reference,
        slip_checks: verdict.checks,
    });
    if (verdict.auto_approve) {
        Object.assign(fields, compact({
            payment_method: 'bank_transfer',
            paid_method: 'auto',
            paid_amount: input.expectedAmount,
            // Slip evidence only — not yet matched to a real bank transaction.
            verification_status: 'unverified',
            bank_account_id: matched?.id,
            bank_account: matched?.label,
        }));
    }

    const summary = describeChecks(verdict.checks);
    const problems = slipProblems(verdict, details, input.expectedAmount);
    const c = verdict.checks;
    const splitAmount = !verdict.auto_approve && c.amount === 'fail' && !!matched && c.datetime !== 'fail'
        && details.amount != null && details.amount > 0 && details.amount < input.expectedAmount
        ? details.amount : null;
    // remembered on the bill so the "split payment" button can be checked against this exact slip
    if (splitAmount != null) fields.slip_split_amount = splitAmount;
    return {
        autoApprove: verdict.auto_approve,
        outcome: verdict.auto_approve ? 'approved' : problems.length ? 'mismatch' : 'review',
        problems: verdict.auto_approve ? [] : problems,
        qrPresent,
        details, verdict, fields,
        aiAmount: details.amount,
        splitAmount,
        verifyNote: verdict.auto_approve
            ? `อนุมัติอัตโนมัติจากสลิป (ยังไม่ยืนยันกับบัญชีธนาคาร) — ${summary}`
            : `ตรวจสลิปแล้ว — ${summary} · โปรดตรวจด้วยตา`,
    };
}

const baht = (n: number) => `฿${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;

/** What a failed check means for the tenant, in Thai. Unreadable ('unknown') checks are not problems. */
function slipProblems(verdict: SlipVerdict, details: SlipDetails, expectedAmount: number): string[] {
    const c = verdict.checks;
    const out: string[] = [];
    if (c.amount === 'fail') out.push(`ยอดในสลิป ${baht(details.amount ?? 0)} ไม่ตรงกับยอดที่ต้องชำระ ${baht(expectedAmount)}`);
    if (c.receiver_name === 'fail' || c.receiver_account === 'fail') out.push('ชื่อ/บัญชีผู้รับในสลิปไม่ใช่บัญชีของหอพัก');
    if (c.datetime === 'fail') out.push('สลิปนี้โอนก่อนออกบิล อาจเป็นสลิปเก่า');
    return out;
}

/** The reply sent to the tenant after a slip is evaluated. Never claims a check that was not made. */
export function tenantSlipReply(roomNumber: string, e: SlipEvaluation): string {
    if (e.outcome === 'approved') {
        const amount = e.aiAmount != null ? ` ${baht(e.aiAmount)}` : '';
        return `✅ ได้รับยอดชำระ${amount} เรียบร้อยแล้วค่ะ\n\nAI ตรวจยอดเงินและชื่อผู้รับตรงกับบิลห้อง ${roomNumber} แล้ว สถานะเปลี่ยนเป็น "จ่ายแล้ว" ขอบคุณค่ะ`;
    }
    if (e.outcome === 'mismatch') {
        const list = e.problems.map(p => `- ${p}`).join('\n');
        return `❌ สลิปห้อง ${roomNumber} ไม่ตรงกับบิลค่ะ\n\n${list}\n\nระบบยังไม่ได้รับยอดนี้ กรุณาตรวจสอบแล้วส่งสลิปที่ถูกต้องอีกครั้ง หรือติดต่อเจ้าของหอค่ะ`;
    }
    return e.qrPresent
        ? `[ระบบ] รับสลิปห้อง ${roomNumber} แล้วค่ะ\n\nระบบยังตรวจยอดอัตโนมัติไม่ได้ เจ้าของหอจะตรวจสอบและยืนยันยอดให้อีกครั้งค่ะ`
        : `[ระบบ] รับสลิปห้อง ${roomNumber} แล้วค่ะ\n\nระบบอ่าน QR ในสลิปไม่ชัด เจ้าของหอจะตรวจสอบให้นะคะ\n(ถ้าเป็นไปได้ ส่งภาพสลิปที่ชัดขึ้นจะตรวจไวกว่าค่ะ)`;
}
