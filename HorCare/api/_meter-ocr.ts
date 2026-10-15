/**
 * POST /api/meter-ocr
 *
 * Reads a meter photo with the configured AI vision model (see _ai.ts) and returns what it saw: the room
 * number written near the meter, the dial reading and the meter type.
 *
 * With `multi: true` one photo may hold up to MAX_METERS_PER_PHOTO meters (a meter board): every meter is
 * returned with its serial number and where it is in the photo, so the client can match it to a room
 * by serial or by the room label (src/utils/meterBatch.ts).
 *
 * It only *reads*. It never touches meter records — the client shows the result
 * next to the photo and a person confirms it (see src/utils/meterBatch.ts).
 *
 * Body: { owner_uid, building_id, imageBase64, mimeType, multi? }
 * Needs `meter.record` on that property, and a Plus/Pro plan on the owner account.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { AiError, aiErrorHint, aiGenerate, extractJson } from './_ai.js';

export const config = { maxDuration: 60 };

export interface MeterOcrResult {
    room_number: string | null;
    reading: number | null;
    meter_type: 'electric' | 'water' | 'unknown';
    /** 0..1 */
    confidence: number;
    note: string;
}

/** A meter board photo is read up to this many meters; more than that and digits get too small to trust. */
export const MAX_METERS_PER_PHOTO = 12;

export interface MeterOcrItem extends MeterOcrResult {
    /** Serial / meter number printed on the meter (letters and digits only), or null. */
    serial: string | null;
    /** Where the meter is in the photo, as fractions of width / height: [x, y, w, h]; null if not given. */
    box: [number, number, number, number] | null;
}

const EMPTY: MeterOcrResult = { room_number: null, reading: null, meter_type: 'unknown', confidence: 0, note: '' };

export function isPlusOrAbove(license: string): boolean {
    if (license === 'active') return true;
    const m = license.match(/^(monthly|yearly)_(small|medium|large)$/);
    return !!m && (m[2] === 'medium' || m[2] === 'large');
}

/** Defensive parse: the model's output is untrusted input. Never throws. */
export function parseMeterOcr(raw: string): MeterOcrResult {
    // extractJson also copes with ```json fences some models add around the object.
    const obj = extractJson(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ...EMPTY, note: 'อ่านผลจาก AI ไม่สำเร็จ' };
    const parsed = obj as Record<string, unknown>;

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

/** Multi-meter output: { meters: [...] }. Untrusted; never throws; at most MAX_METERS_PER_PHOTO items. */
export function parseMeterOcrMulti(raw: string): { meters: MeterOcrItem[]; note: string } {
    const obj = extractJson(raw);
    const list = obj && typeof obj === 'object' && Array.isArray((obj as { meters?: unknown }).meters)
        ? (obj as { meters: unknown[] }).meters : null;
    if (!list) return { meters: [], note: 'อ่านผลจาก AI ไม่สำเร็จ' };
    const meters: MeterOcrItem[] = [];
    for (const m of list.slice(0, MAX_METERS_PER_PHOTO)) {
        if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
        const r = m as Record<string, unknown>;
        const base = parseMeterOcr(JSON.stringify(r));
        const serial = typeof r.serial === 'string' || typeof r.serial === 'number'
            ? String(r.serial).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30) : '';
        const b = Array.isArray(r.box) && r.box.length === 4 && r.box.every(v => typeof v === 'number' && Number.isFinite(v))
            ? (r.box as number[]).map(v => Math.min(1, Math.max(0, v))) as [number, number, number, number] : null;
        meters.push({ ...base, serial: serial.length >= 4 ? serial : null, box: b && b[2] > 0 && b[3] > 0 ? b : null });
    }
    const note = obj && typeof (obj as { note?: unknown }).note === 'string' ? String((obj as { note: string }).note).slice(0, 200) : '';
    return { meters, note: list.length > MAX_METERS_PER_PHOTO ? `รูปนี้มีมิเตอร์เกิน ${MAX_METERS_PER_PHOTO} ตัว อ่านเฉพาะ ${MAX_METERS_PER_PHOTO} ตัวแรก` : note };
}

async function readMeterBoard(imageBase64: string, mimeType: string): Promise<{ meters: MeterOcrItem[]; note: string }> {
    const prompt = `คุณคือผู้เชี่ยวชาญอ่านมิเตอร์ไฟฟ้าและมิเตอร์น้ำประปา รูปนี้อาจมีมิเตอร์หลายตัว (แผงมิเตอร์) ไม่เกิน ${MAX_METERS_PER_PHOTO} ตัว
แต่ละตัวมักมีเลขห้องเขียน/ติดสติกเกอร์ไว้ใกล้ๆ และมีเลขซีเรียล (หมายเลขมิเตอร์) พิมพ์อยู่บนตัวมิเตอร์

ตอบเป็น JSON เท่านั้น:
{
  "meters": [
    {
      "room_number": "<เลขห้องที่ติดกับมิเตอร์ตัวนี้ หรือ null ถ้าไม่เห็นชัด>",
      "serial": "<เลขซีเรียล/หมายเลขมิเตอร์ที่พิมพ์บนตัวมิเตอร์ หรือ null>",
      "reading": <เลขบนหน้าปัดหลักเป็นจำนวนเต็ม หรือ null>,
      "meter_type": "electric" | "water" | "unknown",
      "confidence": <0 ถึง 1>,
      "box": [<x ซ้าย>, <y บน>, <กว้าง>, <สูง>],
      "note": "<หมายเหตุสั้นๆ หรือ ''>"
    }
  ],
  "note": "<หมายเหตุของทั้งรูป หรือ ''>"
}

กฎ:
- ใส่ทุกมิเตอร์ที่เห็นในรูป เรียงจากซ้ายไปขวา บนลงล่าง ไม่เกิน ${MAX_METERS_PER_PHOTO} ตัว
- box เป็นสัดส่วนของรูป (0 ถึง 1) ครอบมิเตอร์ตัวนั้น
- ห้ามเดาเลขห้องหรือเลขซีเรียล ถ้าไม่ชัดให้เป็น null ห้ามเอาเลขห้องของมิเตอร์ข้างเคียงมาใส่
- อ่านเฉพาะเลขหน้าปัดหลัก ไม่นับเลขสีแดง/ทศนิยม
- มิเตอร์ที่เบลอหรือถูกบัง ให้ reading เป็น null และ confidence ต่ำกว่า 0.3
- ห้ามอธิบายเพิ่มนอก JSON`;
    const text = await aiGenerate({
        kind: 'vision', prompt, images: [{ base64: imageBase64, mimeType }], json: true, temperature: 0, maxTokens: 2500,
    });
    return parseMeterOcrMulti(text);
}

async function readMeter(imageBase64: string, mimeType: string): Promise<MeterOcrResult> {
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

    // Provider errors are logged server-side by _ai.ts; the client only gets a short code.
    const text = await aiGenerate({
        kind: 'vision', prompt, images: [{ base64: imageBase64, mimeType }], json: true, temperature: 0, maxTokens: 300,
    });
    return parseMeterOcr(text);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as { owner_uid?: string; building_id?: string; imageBase64?: string; mimeType?: string; multi?: boolean };

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
        res.status(200).json({ data: body.multi === true ? await readMeterBoard(body.imageBase64, mime) : await readMeter(body.imageBase64, mime) });
    } catch (err) {
        console.error('[meter-ocr]', (err as Error).message);
        const code = err instanceof AiError ? err.code : 'unexpected';
        res.status(502).json({ error: 'ocr_failed', detail: code, message: `${aiErrorHint(code)} (${code})` });
    }
}
