import { admin } from './_firebase.js';
import { createHash } from 'crypto';
import { Jimp } from 'jimp';
import * as jsQRns from 'jsqr';

// jsqr ships a CJS `module.exports = jsQR` with an ESM-style `export default`
// in its .d.ts — normalize so it resolves to the callable under any bundler.
const jsQR = ((jsQRns as any).default ?? jsQRns) as
    (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;

/**
 * Free, unlimited slip handling — no third-party verification API.
 *
 * Every Thai bank transfer slip carries a QR code whose payload is unique to
 * that transaction (it embeds the sending bank + a transaction reference). We
 * decode it locally (pure-JS, runs in the serverless function) and use the
 * payload as a fingerprint to reject duplicate / reused slips — the single most
 * common cheat. The owner confirms the amount from the slip image in the app.
 *
 * This is NOT bank-grade verification (a photoshopped slip with a novel QR could
 * pass), but it is free and scales to any dorm size, and it blocks slip reuse.
 */

export interface SlipQR {
    payload: string | null;   // decoded QR text, or null if no QR was found
    looksLikeSlip: boolean;    // loose heuristic — used only for the status note
}

/** Decode the QR embedded in a slip image. Never throws. */
export async function decodeSlipQR(image: Buffer): Promise<SlipQR> {
    try {
        const img = await Jimp.read(image);
        // Cap very large images so jsQR stays fast; keep aspect ratio.
        if (img.bitmap.width > 1400) {
            img.resize({ w: 1400 });
        }
        const { data, width, height } = img.bitmap;
        const code = jsQR(
            new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
            width,
            height,
        );
        const payload = code?.data?.trim() || null;
        return { payload, looksLikeSlip: payload ? isThaiSlipQR(payload) : false };
    } catch {
        return { payload: null, looksLikeSlip: false };
    }
}

/**
 * Loose sanity check that a decoded QR is a Thai bank slip rather than some
 * random QR (e.g. a website link). Slip-verify payloads are EMVCo TLV strings
 * starting with the "00" version tag and contain a long numeric reference.
 * Intentionally lenient — it only flavours the status note, never rejects.
 */
export function isThaiSlipQR(payload: string): boolean {
    const digits = payload.replace(/\D/g, '');
    return /^00\d{2}/.test(payload) && digits.length >= 18;
}

/** Stable fingerprint of a slip's QR payload — used as the dedup key. */
export function slipFingerprint(payload: string): string {
    return createHash('sha256').update(payload.trim()).digest('hex').slice(0, 32);
}

/**
 * ย่อ + บีบอัดสลิปเป็น data URL (base64 JPEG) เพื่อเก็บลง Firestore โดยตรง.
 *
 * ทำไมไม่ใช้ Firebase Storage: ตอนนี้ Storage บังคับแพลน Blaze (ผูกบัตร) สำหรับ
 * bucket ใหม่ ซึ่งขัดกับเป้าหมาย "ฟรี". การเก็บภาพที่ย่อแล้วเป็น base64 ใน Firestore
 * (Spark ฟรี 1GB) ทำให้เจ้าของเปิดดูสลิปบนเว็บได้ทันทีโดยไม่ต้องเปิดบริการเสริมใดๆ.
 *
 * คุมขนาดให้ต่ำกว่าลิมิตเอกสาร Firestore (~1MB) ด้วยการลดความกว้าง/คุณภาพเป็นชั้นๆ.
 * คืน null ถ้าบีบแล้วยังใหญ่เกินหรืออ่านภาพไม่ได้ (flow ที่เหลือยังทำงาน — แค่ไม่มีรูป).
 */
export async function compressSlipToDataUrl(image: Buffer): Promise<string | null> {
    try {
        const img = await Jimp.read(image);
        // ไล่จากใหญ่/คมไปเล็ก/บีบ — resize ลดขนาดอย่างเดียวจึงทำต่อเนื่องได้
        const attempts = [
            { w: 800, q: 62 },
            { w: 640, q: 52 },
            { w: 520, q: 42 },
        ];
        for (const { w, q } of attempts) {
            if (img.bitmap.width > w) img.resize({ w });
            const buf = await img.getBuffer('image/jpeg', { quality: q });
            const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
            if (dataUrl.length < 950_000) return dataUrl;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Best-effort upload of the slip image to Firebase Storage so the owner can view
 * it. Returns the storage path, or null if Storage isn't enabled (the rest of
 * the flow still works — the owner just can't see the picture).
 *
 * NOTE: kept for backward compatibility with slips stored before the switch to
 * inline base64 (see compressSlipToDataUrl). New slips no longer use Storage.
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
