/**
 * POST /api/read-meter
 *
 * รับรูปมิเตอร์ (base64 JPEG/PNG) และส่งให้ Gemini Vision อ่านค่า
 * เฉพาะผู้ใช้ระดับ Plus (medium) และ Pro (large) เท่านั้น
 *
 * Request body (JSON):
 *   { imageBase64: string, mimeType: 'image/jpeg' | 'image/png' }
 *
 * Response:
 *   { reading: number | null, meterType: 'electric' | 'water' | 'unknown',
 *     confidence: 'high' | 'low', note: string }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';

// ── Plan helpers (inline — ไม่ import จาก src เพราะ API ไม่ bundle React) ──
function isPlusOrAbove(license: string): boolean {
    if (license === 'active') return true;
    const match = license.match(/^(monthly|yearly)_(small|medium|large)$/);
    if (!match) return false;
    return match[2] === 'medium' || match[2] === 'large';
}

// ── Gemini Vision call ────────────────────────────────────────────────────────
interface GeminiResult {
    reading: number | null;
    meterType: 'electric' | 'water' | 'unknown';
    confidence: 'high' | 'low';
    note: string;
}

async function callGeminiVision(
    imageBase64: string,
    mimeType: string,
): Promise<GeminiResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');

    // ใช้ gemini-2.5-flash-lite
    const model = 'gemini-2.5-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const prompt = `คุณคือผู้เชี่ยวชาญอ่านค่ามิเตอร์ไฟฟ้าและมิเตอร์น้ำประปา

ดูรูปและตอบ JSON ตามรูปแบบนี้เท่านั้น (ห้ามอธิบายเพิ่ม):
{
  "reading": <ตัวเลขที่อ่านได้ เป็น integer หรือ null ถ้าอ่านไม่ได้>,
  "meterType": "<"electric" ถ้าเป็นมิเตอร์ไฟ | "water" ถ้าเป็นมิเตอร์น้ำ | "unknown" ถ้าไม่แน่ใจ>",
  "confidence": "<"high" ถ้ามั่นใจ | "low" ถ้าไม่แน่ใจ เช่น รูปพร่ามัว>",
  "note": "<หมายเหตุสั้นๆ ถ้ามีปัญหา เช่น 'รูปพร่ามัว' หรือ '' ถ้าไม่มี>"
}

กฎการอ่าน:
- อ่านเฉพาะตัวเลขบนหน้าปัทม์หลัก (ตัวเลขดำบนพื้นขาว หรือ LCD)
- ไม่นับตัวเลขสีแดงหรือตัวเลขทศนิยมหลังจุด (ถ้ามี)
- ถ้ารูปมืด เบลอ หรือไม่ใช่รูปมิเตอร์ ให้ใส่ reading: null และ confidence: "low"`;

    const body = {
        contents: [{
            parts: [
                { text: prompt },
                {
                    inline_data: {
                        mime_type: mimeType,
                        data: imageBase64,
                    },
                },
            ],
        }],
        generationConfig: {
            temperature: 0,          // ต้องการผลที่แน่นอน ไม่ creative
            maxOutputTokens: 150,    // ตอบสั้นๆ JSON เท่านั้น
            responseMimeType: 'application/json',
        },
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Gemini API error ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json() as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        error?: { message?: string };
    };

    if (data.error) throw new Error(`Gemini: ${data.error.message}`);

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    // Parse JSON response
    try {
        const parsed = JSON.parse(rawText.trim()) as Partial<GeminiResult>;
        return {
            reading: typeof parsed.reading === 'number' ? Math.round(parsed.reading) : null,
            meterType: (['electric', 'water', 'unknown'].includes(parsed.meterType ?? ''))
                ? (parsed.meterType as GeminiResult['meterType'])
                : 'unknown',
            confidence: parsed.confidence === 'high' ? 'high' : 'low',
            note: typeof parsed.note === 'string' ? parsed.note.slice(0, 200) : '',
        };
    } catch {
        // ถ้า parse JSON ไม่ได้ — fallback
        return { reading: null, meterType: 'unknown', confidence: 'low', note: 'อ่านผลจาก AI ไม่สำเร็จ' };
    }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        // ── Auth ──────────────────────────────────────────────────────────────
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        const uid = decoded.uid;

        // ── Plan check (Plus / Pro only) ──────────────────────────────────────
        const userDoc = await db.collection('users').doc(uid).get();
        const license: string = userDoc.data()?.license ?? 'free';
        if (!isPlusOrAbove(license)) {
            res.status(403).json({ error: 'feature_locked', message: 'ฟีเจอร์นี้สำหรับแพ็กเกจ Plus และ Pro เท่านั้น' });
            return;
        }

        // ── Validate input ────────────────────────────────────────────────────
        const { imageBase64, mimeType } = (req.body ?? {}) as {
            imageBase64?: string;
            mimeType?: string;
        };

        if (!imageBase64 || typeof imageBase64 !== 'string') {
            res.status(400).json({ error: 'imageBase64 is required' });
            return;
        }

        const safeMime = mimeType?.startsWith('image/') ? mimeType : 'image/jpeg';

        // ── Size guard: base64 ของ 4MB จริงๆ ≈ 5.5MB string ────────────────
        if (imageBase64.length > 6_000_000) {
            res.status(400).json({ error: 'image_too_large', message: 'รูปใหญ่เกิน กรุณาลดขนาดก่อน' });
            return;
        }

        // ── Call Gemini ───────────────────────────────────────────────────────
        const result = await callGeminiVision(imageBase64, safeMime);

        // Log usage (best-effort, ไม่ block response)
        db.collection('users').doc(uid).collection('meter_ocr_log')
            .add({
                at: admin.firestore.FieldValue.serverTimestamp(),
                meterType: result.meterType,
                confidence: result.confidence,
                success: result.reading !== null,
            })
            .catch(() => { /* best-effort */ });

        res.status(200).json({ data: result });

    } catch (err: any) {
        console.error('[read-meter] error:', err?.message ?? err);
        res.status(500).json({ error: 'internal_error', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
    }
}
