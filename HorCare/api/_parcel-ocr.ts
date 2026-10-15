/**
 * Reads ONE shipping-label photo with the configured AI vision model (see _ai.ts): carrier, tracking
 * number, recipient name and the room number in the address.
 *
 * It only *reads*. The client fills the "receive parcel" form with the result and a person picks /
 * confirms the room before saving — the parcel is never bound to a room by the server from a label.
 */
import { aiGenerate, extractJson } from './_ai.js';
import type { ParcelLabelOcr } from '../src/shared/parcels.js';

const EMPTY: ParcelLabelOcr = { carrier: null, tracking_number: null, recipient_name: null, room_number: null, confidence: 0 };

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
    return {
        carrier: str(p.carrier, 40),
        tracking_number: tracking && /^[A-Z0-9]{6,60}$/.test(tracking) ? tracking : null,
        recipient_name: str(p.recipient_name, 80),
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
  "recipient_name": "<ชื่อผู้รับ (ไม่ใช่ผู้ส่ง) หรือ null>",
  "room_number": "<เลขห้องของผู้รับที่อยู่ในที่อยู่ เช่น 'ห้อง 305' ให้ตอบ '305' หรือ null>",
  "confidence": <0 ถึง 1>
}

กฎ:
- ใช้ข้อมูลฝั่ง "ผู้รับ" เท่านั้น ห้ามใช้ชื่อหรือที่อยู่ของผู้ส่ง
- room_number คือเลขห้องเท่านั้น ห้ามตอบบ้านเลขที่ ซอย หรือรหัสไปรษณีย์ ถ้าไม่แน่ใจให้เป็น null
- ห้ามเดา ถ้าอ่านไม่ออกให้เป็น null
- ถ้าไม่ใช่ใบปะหน้าพัสดุ ให้ทุกช่องเป็น null และ confidence ต่ำกว่า 0.3
- ห้ามอธิบายเพิ่มนอก JSON`;

    const text = await aiGenerate({
        kind: 'vision', prompt, images: [{ base64: imageBase64, mimeType }], json: true, temperature: 0, maxTokens: 300,
    });
    return parseParcelLabel(text);
}
