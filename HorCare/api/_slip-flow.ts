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

export interface SlipEvaluation {
    autoApprove: boolean;
    details: SlipDetails | null;
    verdict: SlipVerdict | null;
    /** Extra fields to merge into the bill / fine document (never contains undefined). */
    fields: Record<string, unknown>;
    verifyNote: string;
    /** The amount read from the slip, for the "paid X baht" reply. */
    aiAmount: number | null;
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
    const legacyNote = qrPresent ? 'ตรวจ QR ผ่าน (ไม่ซ้ำ) — รอเจ้าของยืนยันยอด' : 'อ่าน QR ไม่ได้ — โปรดตรวจสลิปด้วยตา';
    const none: SlipEvaluation = { autoApprove: false, details: null, verdict: null, fields: {}, verifyNote: legacyNote, aiAmount: null };

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
    return {
        autoApprove: verdict.auto_approve,
        details, verdict, fields,
        aiAmount: details.amount,
        verifyNote: verdict.auto_approve
            ? `อนุมัติอัตโนมัติจากสลิป (ยังไม่ยืนยันกับบัญชีธนาคาร) — ${summary}`
            : `ตรวจสลิปแล้ว — ${summary} · โปรดตรวจด้วยตา`,
    };
}
