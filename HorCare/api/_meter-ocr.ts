/**
 * POST /api/meter-ocr
 *
 * Reads ONE meter photo with Gemini Vision and returns what it saw: the room
 * number written near the meter, the dial reading and the meter type.
 *
 * It only *reads*. It never touches meter records — the client shows the result
 * next to the photo and a person confirms it (see src/utils/meterBatch.ts).
 *
 * Body: { owner_uid, building_id, imageBase64, mimeType }
 * Needs `meter.record` on that property, and a Plus/Pro plan on the owner account.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';

export const config = { maxDuration: 30 };

export interface MeterOcrResult {
    room_number: string | null;
    reading: number | null;
    meter_type: 'electric' | 'water' | 'unknown';
    /** 0..1 */
    confidence: number;
    note: string;
}

const EMPTY: MeterOcrResult = { room_number: null, reading: null, meter_type: 'unknown', confidence: 0, note: '' };

function isPlusOrAbove(license: string): boolean {
    if (license === 'active') return true;
    const m = license.match(/^(monthly|yearly)_(small|medium|large)$/);
    return !!m && (m[2] === 'medium' || m[2] === 'large');
}

/** Defensive parse: the model's output is untrusted input. Never throws. */
export function parseMeterOcr(raw: string): MeterOcrResult {
    let parsed: Record<string, unknown>;
    try {
        const obj = JSON.parse(raw.trim());
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ...EMPTY, note: 'อ่านผลจาก AI ไม่สำเร็จ' };
        parsed = obj as Record<string, unknown>;
    } catch {
        return { ...EMPTY, note: 'อ่านผลจาก AI ไม่สำเร็จ' };
    }

    const room = typeof parsed.room_number === 'string' || typeof parsed.room_number === 'number'
        ? String(parsed.room_number).trim().slice(0, 20) : '';
    const reading = typeof parsed.reading === 'number' && Number.isFinite(parsed.reading) && parsed.reading >= 0
        ? Math.round(parsed.reading) : null;
    const type = parsed.meter_type === 'electric' || parsed.meter_type === 'water' ? parsed.meter_type : 'unknown';
    let confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? parsed.confidence : 0;
    confidence = Math.min(1, Math.max(0, confidence));
    return {
        room_number: room || null,
        reading,
        meter_type: type,
        confidence,
        note: typeof parsed.note === 'string' ? parsed.note.slice(0, 200) : '',
    };
}

async function callGemini(imageBase64: string, mimeType: string): Promise<MeterOcrResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

    const prompt = `คุณคือผู้เชี่ยวชาญอ่านมิเตอร์ไฟฟ้าและมิเตอร์น้ำประปา พนักงานถ่ายรูปมิเตอร์ของแต่ละห้อง
โดยมักมีเลขห้องเขียนหรือติดสติกเกอร์ไว้ใกล้มิเตอร์

ตอบเป็น JSON เท่านั้น:
{
  "room_number": "<เลขห้องที่เห็นในรูป เป็นข้อความ หรือ null ถ้าไม่เห็นเลขห้องชัดเจน>",
  "reading": <เลขบนหน้าปัดหลักเป็นจำนวนเต็ม หรือ null ถ้าอ่านไม่ได้>,
  "meter_type": "electric" | "water" | "unknown",
  "confidence": <0 ถึง 1 ความมั่นใจรวมของค่า reading และ room_number>,
  "note": "<หมายเหตุสั้นๆ เช่น รูปพร่ามัว หรือ ''>"
}

กฎ:
- ห้ามเดาเลขห้อง ถ้าไม่เห็นให้ room_number เป็น null
- อ่านเฉพาะเลขหน้าปัดหลัก ไม่นับเลขสีแดง/ทศนิยม
- ถ้าไม่ใช่รูปมิเตอร์หรือมืด/เบลอมาก ให้ reading เป็น null และ confidence ต่ำกว่า 0.3
- ห้ามอธิบายเพิ่มนอก JSON`;

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json' },
        }),
    });
    if (!resp.ok) throw new Error(`Gemini API error ${resp.status}`);
    const data = await resp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
    if (data.error) throw new Error(`Gemini: ${data.error.message}`);
    return parseMeterOcr(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as { owner_uid?: string; building_id?: string; imageBase64?: string; mimeType?: string };

    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId: body.building_id, permission: 'meter.record' });
    if (!ctx) return;
    if (!body.building_id || !(await buildingExists(ctx.ownerUid, body.building_id))) {
        res.status(404).json({ error: 'property_not_found' });
        return;
    }

    // The plan belongs to the organization (owner), not the staff member calling.
    const owner = await db.doc(`users/${ctx.ownerUid}`).get();
    if (!isPlusOrAbove(owner.data()?.license ?? 'free')) {
        res.status(403).json({ error: 'feature_locked', message: 'ฟีเจอร์นี้สำหรับแพ็กเกจ Plus และ Pro เท่านั้น' });
        return;
    }

    if (typeof body.imageBase64 !== 'string' || body.imageBase64.length === 0) {
        res.status(400).json({ error: 'imageBase64 is required' });
        return;
    }
    if (body.imageBase64.length > 6_000_000) {
        res.status(400).json({ error: 'image_too_large', message: 'รูปใหญ่เกิน กรุณาลดขนาดก่อน' });
        return;
    }
    const mime = typeof body.mimeType === 'string' && /^image\/(jpeg|png|webp)$/.test(body.mimeType) ? body.mimeType : 'image/jpeg';

    try {
        res.status(200).json({ data: await callGemini(body.imageBase64, mime) });
    } catch (err) {
        console.error('[meter-ocr]', (err as Error).message);
        res.status(502).json({ error: 'ocr_failed', message: 'AI อ่านรูปไม่สำเร็จ กรุณาลองใหม่' });
    }
}
