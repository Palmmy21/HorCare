/**
 * Reads the details of a payment-slip photo with AI: amount, sender, receiver (name / masked
 * account / bank), date-time and reference.
 *
 * The result is only ever *evidence*: api/_slip-verify.ts compares it with the bill and the
 * property's receiving accounts, and any failure here returns null (→ the owner checks by eye).
 */
import { aiGenerate, extractJson } from './_ai.js';
import type { SlipDetails } from './_slip-verify.js';

const PROMPT = `อ่านรายละเอียดจากสลิปโอนเงินในรูปนี้ ตอบเป็น JSON เท่านั้น ห้ามเดาค่าที่มองไม่เห็นให้ใส่ null:
{
  "amount": <จำนวนเงินที่โอน เป็นตัวเลข เช่น 1500.00 (ไม่รวมค่าธรรมเนียม) หรือ null>,
  "sender_name": "<ชื่อผู้โอน ตามที่แสดงในสลิป หรือ null>",
  "receiver_name": "<ชื่อผู้รับ ตามที่แสดงในสลิป หรือ null>",
  "receiver_account": "<เลขบัญชี/พร้อมเพย์ของผู้รับ ตามที่แสดงในสลิปทุกตัวอักษร รวมตัว x หรือ * ที่ปิดบังไว้ เช่น xxx-x-x1234-x หรือ null>",
  "receiver_bank": "<ธนาคารของผู้รับ หรือ null>",
  "sender_bank": "<ธนาคารของผู้โอน หรือ null>",
  "datetime": "<วันที่และเวลาทำรายการ รูปแบบ YYYY-MM-DDTHH:mm เวลาไทย 24 ชั่วโมง ปีเป็น ค.ศ. หรือ null>",
  "reference": "<เลขที่รายการ/รหัสอ้างอิง หรือ null>"
}`;

const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, max) : null;
};

/** Accept a plain number or a clean numeric string like "1,500.00"; reject everything else. */
export function parseAmount(v: unknown): number | null {
    if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
    if (typeof v === 'string' && /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(v.trim())) {
        const n = Number(v.trim().replace(/,/g, ''));
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/**
 * Normalise a date-time the model returned into ISO with Thailand's offset. Accepts a Buddhist
 * Era year (2569 → 2026) and ignores any zone suffix the model added, since slips are Thai local time.
 */
export function parseSlipDatetime(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    let year = Number(m[1]);
    if (year > 2400) year -= 543;
    const [mo, d, h, mi, s] = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
    if (year < 2000 || year > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    // reject impossible dates such as 31 February (JS would silently roll them into March)
    const check = new Date(Date.UTC(year, mo - 1, d, h, mi, s));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    return `${year}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}+07:00`;
}

export function parseSlipDetails(raw: string): SlipDetails | null {
    const obj = extractJson(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const o = obj as Record<string, unknown>;
    return {
        amount: parseAmount(o.amount),
        sender_name: str(o.sender_name, 100),
        receiver_name: str(o.receiver_name, 100),
        receiver_account: str(o.receiver_account, 40),
        receiver_bank: str(o.receiver_bank, 60),
        sender_bank: str(o.sender_bank, 60),
        datetime_iso: parseSlipDatetime(o.datetime),
        reference: str(o.reference, 60),
    };
}

/** null when the AI is unavailable, errors, or returns nothing usable. Never throws. */
export async function readSlipDetails(base64: string, mimeType: string): Promise<SlipDetails | null> {
    try {
        const text = await aiGenerate({
            kind: 'vision', prompt: PROMPT, images: [{ base64, mimeType }], json: true, temperature: 0, maxTokens: 500,
        });
        return parseSlipDetails(text);
    } catch (err) {
        console.error('Slip reading failed:', (err as Error).message);
        return null;
    }
}
