/**
 * Reads the transferred amount from a payment-slip photo with AI.
 *
 * The result is only ever a *suggestion*: callers auto-approve a payment only when this
 * number equals the bill exactly, and any failure returns null (→ owner checks by eye).
 */
import { aiGenerate, extractJson } from './_ai.js';

const PROMPT = `ดึงตัวเลข "จำนวนเงินที่โอน" จากสลิปโอนเงินนี้ (ไม่ต้องรวมค่าธรรมเนียม)
ตอบเป็น JSON เท่านั้น:
{
  "amount": <ตัวเลขทศนิยม เช่น 1500.00 หรือ null ถ้าอ่านไม่ได้>
}`;

/** Accept a plain number or a clean numeric string like "1,500.00"; reject everything else. */
export function parseSlipAmount(raw: string): number | null {
    const obj = extractJson(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const v = (obj as { amount?: unknown }).amount;
    if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
    if (typeof v === 'string' && /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(v.trim())) {
        const n = Number(v.trim().replace(/,/g, ''));
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/** null when the AI is unavailable, errors, or the amount can't be read. Never throws. */
export async function readSlipAmount(base64: string, mimeType: string): Promise<number | null> {
    try {
        const text = await aiGenerate({
            kind: 'vision', prompt: PROMPT, images: [{ base64, mimeType }], json: true, temperature: 0, maxTokens: 120,
        });
        return parseSlipAmount(text);
    } catch (err) {
        console.error('Slip auto-verification failed:', (err as Error).message);
        return null;
    }
}
