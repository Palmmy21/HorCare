/**
 * Reads ONE shipping-label photo with the configured AI vision model (see _ai.ts): carrier, tracking
 * number, recipient name and the room number in the address.
 *
 * It only *reads*. The client fills the "receive parcel" form with the result and a person picks /
 * confirms the room before saving — the parcel is never bound to a room by the server from a label.
 */
import { aiGenerate, extractJson } from './_ai.js';
import type { ParcelLabelOcr } from '../src/shared/parcels.js';

const EMPTY: ParcelLabelOcr = { carrier: null, tracking_number: null, recipient_name: null, recipient_phone: null, room_number: null, confidence: 0 };

const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    const t = String(v).trim();
    return t && t.toLowerCase() !== 'null' ? t.slice(0, max) : null;
};

/** Defensive parse: the model's output is untrusted input. Never throws. */
export function parseParcelLabel(raw: string): ParcelLabelOcr {
    const obj = extractJson(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ...EMPTY };
    const p = obj as Record<string, unknown>;
    // Tracking numbers are letters/digits only; drop the spaces/dashes labels print for readability.
    const tracking = str(p.tracking_number, 80)?.replace(/[\s-]/g, '').toUpperCase() ?? null;
    let confidence = typeof p.confidence === 'number' && Number.isFinite(p.confidence) ? p.confidence : 0;
    confidence = Math.min(1, Math.max(0, confidence));
    // a phone is digits and the x / * a label masks with; anything else is not a phone
    const phone = str(p.recipient_phone, 30)?.replace(/[^\dxX*+]/g, '') ?? null;
    // the name: drop a "ผู้รับ:" / "To:" the model may have kept
    const name = str(p.recipient_name, 80)?.replace(/^(ผู้รับ|ชื่อผู้รับ|ถึง|to|receiver|recipient|ship\s*to)\s*[:：]?\s*/i, '').trim() || null;
    return {
        carrier: str(p.carrier, 40),
        tracking_number: tracking && /^[A-Z0-9]{6,60}$/.test(tracking) ? tracking : null,
        recipient_name: name,
        recipient_phone: phone && /\d{4}/.test(phone) && phone.length >= 6 ? phone : null,
        room_number: str(p.room_number, 20),
        confidence,
    };
}

export async function readParcelLabel(imageBase64: string, mimeType: string): Promise<ParcelLabelOcr> {
    const prompt = `คุณคือผู้ช่วยอ่านใบปะหน้าพัสดุ (shipping label) ในประเทศไทย เจ้าหน้าที่หอพักถ่ายรูปพัสดุที่มาส่ง

ตอบเป็น JSON เท่านั้น:
{
  "carrier": "<ชื่อบริษัทขนส่ง เช่น Kerry Express, Flash Express, J&T Express, Thailand Post, Shopee Express (SPX), Lazada Express, Best Express, SCG Express, DHL หรือ null>",
  "tracking_number": "<เลขพัสดุ/เลขติดตาม (มักอยู่ใต้บาร์โค้ด) หรือ null>",
  "recipient_name": "<ชื่อ-นามสกุลผู้รับตามที่พิมพ์ (ไม่ใช่ผู้ส่ง) หรือ null>",
  "recipient_phone": "<เบอร์โทรผู้รับตามที่พิมพ์ รวมตัวที่ถูกปิดด้วย x หรือ * เช่น '08x-xxx-1234' หรือ null>",
  "room_number": "<เลขห้องของผู้รับที่อยู่ในที่อยู่ เช่น 'ห้อง 305' ให้ตอบ '305' หรือ null>",
  "confidence": <0 ถึง 1>
}

กฎ:
- ใช้ข้อมูลฝั่ง "ผู้รับ" เท่านั้น ห้ามใช้ชื่อหรือที่อยู่ของผู้ส่ง
- ชื่อผู้รับสำคัญที่สุด: มักอยู่หลังคำว่า "ผู้รับ", "ชื่อผู้รับ", "ถึง", "To", "Receiver", "Ship to" หรือเป็นบรรทัดแรกของที่อยู่ผู้รับ (ตัวอักษรใหญ่/หนา) ตอบชื่อเต็มตามที่พิมพ์ ทั้งภาษาไทยและอังกฤษ ไม่ต้องแปล ไม่ต้องใส่คำว่า "ผู้รับ:"
- ฝั่งผู้ส่งมักมีคำว่า "ผู้ส่ง", "From", "Sender" หรือชื่อร้านค้า — ห้ามนำมาตอบเป็นผู้รับ
- room_number คือเลขห้องเท่านั้น ห้ามตอบบ้านเลขที่ ซอย หรือรหัสไปรษณีย์ ถ้าไม่แน่ใจให้เป็น null
- ห้ามเดา ถ้าอ่านไม่ออกให้เป็น null
- ถ้าไม่ใช่ใบปะหน้าพัสดุ ให้ทุกช่องเป็น null และ confidence ต่ำกว่า 0.3
- ห้ามอธิบายเพิ่มนอก JSON`;

    const text = await aiGenerate({
        kind: 'vision', prompt, images: [{ base64: imageBase64, mimeType }], json: true, temperature: 0, maxTokens: 400,
    });
    return parseParcelLabel(text);
}

/**
 * The name on the label did not clearly match a tenant (another spelling, English vs Thai, a nickname): ask the text
 * model which tenant it is, from the property's own list. Only names and room numbers are sent (no phones). Returns a
 * room number that is in the list and a confidence of at least 0.75 — else null. Never throws.
 */
export async function aiPickRecipient(labelName: string, tenants: { room_number: string; full_name?: string | null; nickname?: string | null }[]): Promise<{ room_number: string; confidence: number } | null> {
    const list = tenants.filter(t => t.full_name || t.nickname).slice(0, 400);
    if (!labelName.trim() || list.length === 0) return null;
    const lines = list.map(t => `${t.room_number}: ${t.full_name ?? ''}${t.nickname ? ` (ชื่อเล่น ${t.nickname})` : ''}`).join('\n');
    const prompt = `ชื่อผู้รับบนใบปะหน้าพัสดุ: "${labelName.slice(0, 80)}"

รายชื่อผู้เช่า (เลขห้อง: ชื่อ):
${lines}

ผู้รับคือผู้เช่าคนไหน? ชื่ออาจสะกดต่างกัน เป็นภาษาอังกฤษ/ไทย ใช้ชื่อเล่น หรือมีคำนำหน้า
ตอบ JSON เท่านั้น: {"room_number": "<เลขห้องจากรายชื่อ หรือ null ถ้าไม่แน่ใจ>", "confidence": <0 ถึง 1>}
ห้ามเดา ถ้ามีหลายคนที่เป็นไปได้หรือไม่ตรงชัดเจน ให้ room_number เป็น null`;
    try {
        const raw = await aiGenerate({ kind: 'text', prompt, json: true, temperature: 0, maxTokens: 80 });
        const obj = extractJson(raw) as { room_number?: unknown; confidence?: unknown } | null;
        const room = typeof obj?.room_number === 'string' || typeof obj?.room_number === 'number' ? String(obj.room_number).trim() : '';
        const confidence = typeof obj?.confidence === 'number' && Number.isFinite(obj.confidence) ? Math.min(1, Math.max(0, obj.confidence)) : 0;
        if (!room || confidence < 0.75 || !list.some(t => t.room_number === room)) return null;
        return { room_number: room, confidence };
    } catch (err) {
        console.warn('[parcel-ocr] ai match failed:', (err as Error).message);
        return null;
    }
}
