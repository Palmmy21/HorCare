import { admin } from './_firebase.js';

/**
 * SlipOK slip-verification helpers.
 *
 * Free tier: 100 verifications/month — enough for a single dorm.
 * Sign up at https://slipok.com to get a Branch ID + API key, then set:
 *   SLIPOK_BRANCH_ID, SLIPOK_API_KEY   (Vercel env)
 *
 * Docs: https://slipok.com/api-documentation/
 */

export interface SlipVerifyResult {
    /** true = SlipOK confirmed the slip is a real, successful transfer */
    verified: boolean;
    amount?: number;        // THB transferred
    transRef?: string;      // bank transaction ref (SlipOK also rejects duplicates itself)
    senderName?: string;
    receiverName?: string;
    receiverAcc?: string;   // masked receiver account / proxy value
    sendingBank?: string;
    /** machine reason when not verified: 'no_config' | 'duplicate' | 'unreadable' | 'api_error' | 'quota' */
    reason?: string;
    /** human-readable note (Thai) for the owner / tenant */
    message?: string;
}

const SLIPOK_BASE = 'https://api.slipok.com/api/line/apikey';

/** Verify a slip image buffer through SlipOK. Never throws — returns reason on failure. */
export async function verifySlip(image: Buffer, contentType = 'image/jpeg'): Promise<SlipVerifyResult> {
    const branchId = process.env.SLIPOK_BRANCH_ID;
    const apiKey = process.env.SLIPOK_API_KEY;
    if (!branchId || !apiKey) {
        return { verified: false, reason: 'no_config', message: 'ยังไม่ได้ตั้งค่าระบบตรวจสลิปอัตโนมัติ' };
    }

    try {
        const form = new FormData();
        // SlipOK accepts the slip image via the `files` field (multipart)
        form.append('files', new Blob([new Uint8Array(image)], { type: contentType }), 'slip.jpg');
        form.append('log', 'true');

        const res = await fetch(`${SLIPOK_BASE}/${branchId}`, {
            method: 'POST',
            headers: { 'x-authorization': apiKey },
            body: form,
        });

        const json: any = await res.json().catch(() => ({}));

        // SlipOK error envelope: { success:false, code, message }
        if (!res.ok || json?.success === false) {
            const code = json?.code;
            // 1012 = slip already used (duplicate); 1013/1014 = invalid/unreadable; 1xxx quota etc.
            if (code === 1012) return { verified: false, reason: 'duplicate', message: 'สลิปนี้ถูกใช้ไปแล้ว' };
            if (code === 1010 || code === 1011) return { verified: false, reason: 'unreadable', message: 'อ่านสลิปไม่ได้ กรุณาส่งภาพให้ชัดขึ้น' };
            return {
                verified: false,
                reason: res.status === 429 ? 'quota' : 'api_error',
                message: json?.message || 'ตรวจสลิปไม่สำเร็จ',
            };
        }

        const d = json?.data ?? {};
        const amount = typeof d.amount === 'number' ? d.amount : Number(d.amount);
        return {
            verified: true,
            amount: Number.isFinite(amount) ? amount : undefined,
            transRef: d.transRef || d.transRefId || undefined,
            senderName: d.sender?.displayName || d.sender?.name || undefined,
            receiverName: d.receiver?.displayName || d.receiver?.name || undefined,
            receiverAcc: d.receiver?.account?.value || d.receiver?.proxy?.value || undefined,
            sendingBank: d.sendingBank || d.sender?.bank?.name || undefined,
        };
    } catch (err: any) {
        return { verified: false, reason: 'api_error', message: err?.message || 'เชื่อมต่อระบบตรวจสลิปไม่ได้' };
    }
}

/** last 4 significant digits of an account / promptpay number */
function last4(s?: string): string | null {
    if (!s) return null;
    const digits = s.replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * Decide whether a verified slip should auto-confirm the bill.
 * Returns { ok, note } — ok=false means keep it 'pending' for the owner to review.
 */
export function matchSlipToBill(
    slip: SlipVerifyResult,
    billTotal: number,
    ownerPromptpay?: string,
): { ok: boolean; note?: string } {
    if (!slip.verified) return { ok: false, note: slip.message };

    // Amount must cover the bill (allow 1 baht rounding tolerance)
    if (typeof slip.amount === 'number' && slip.amount + 1 < billTotal) {
        return { ok: false, note: `ยอดในสลิป ฿${slip.amount.toLocaleString()} น้อยกว่ายอดบิล ฿${billTotal.toLocaleString()}` };
    }

    // Soft receiver check: only reject if we can read a receiver number AND its last 4 differ
    const want = last4(ownerPromptpay);
    const got = last4(slip.receiverAcc);
    if (want && got && want !== got) {
        return { ok: false, note: `บัญชีผู้รับในสลิปไม่ตรงกับบัญชีหอ (ลงท้าย ${got})` };
    }

    return { ok: true };
}

/**
 * Best-effort upload of the slip image to Firebase Storage so the owner can view it.
 * Returns the storage path, or null if Storage isn't enabled (core flow still works).
 */
export async function uploadSlipImage(
    uid: string,
    buildingId: string,
    billId: string,
    image: Buffer,
    contentType = 'image/jpeg',
): Promise<string | null> {
    try {
        const ext = contentType.includes('png') ? 'png' : 'jpg';
        const path = `slips/${uid}/${buildingId}/${billId}-${Date.now()}.${ext}`;
        const bucket = admin.storage().bucket();
        await bucket.file(path).save(image, { contentType, resumable: false });
        return path;
    } catch (err) {
        console.error('Slip upload failed (Storage may be disabled):', (err as Error).message);
        return null;
    }
}
