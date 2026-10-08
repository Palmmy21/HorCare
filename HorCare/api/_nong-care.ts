import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin } from './_firebase.js';
import { AiError, aiGenerate } from './_ai.js';

import { errorInfo } from '../src/shared/errorInfo.js';

// ── Plan helper ──
function isPro(license: string): boolean {
    if (license === 'active') return true;
    const match = license.match(/^(monthly|yearly)_(small|medium|large)$/);
    if (!match) return false;
    // Pro is the 'large' plan
    return match[2] === 'large';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        const uid = decodedToken.uid;

        const userSnap = await admin.firestore().collection('users').doc(uid).get();
        if (!userSnap.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = userSnap.data();
        const license = userData?.license || 'free';
        
        if (!isPro(license)) {
            return res.status(403).json({ error: 'Nong Care AI is available for Pro plan only.' });
        }

        const { prompt, context } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const systemPrompt = `คุณคือ "น้องแคร์" (Nong Care) ผู้ช่วยอัจฉริยะด้านการเงินและภาษีสำหรับเจ้าของหอพัก
คุณได้รับข้อมูลสถิติของหอพัก (Context) ในรูปแบบ JSON ดังนี้:
${JSON.stringify(context, null, 2)}

กฎการตอบ:
- ตอบเป็นภาษาไทยด้วยน้ำเสียงสุภาพ เป็นมืออาชีพ
- ห้ามใช้ Emoji เด็ดขาดในข้อความตอบกลับ
- วิเคราะห์ข้อมูลจาก Context เพื่อตอบคำถามเรื่อง รายรับ รายจ่าย กำไร และภาษีเบื้องต้น
- หากคำถามไม่อยู่ในข้อมูล ให้แนะนำตามหลักการจัดการหอพักทั่วไป
- ใช้ Markdown ในการจัดรูปแบบ (เช่น ตัวหนา, bullet points) เพื่อให้อ่านง่าย`;

        // Uses the configured text model (OpenRouter or Gemini — see _ai.ts). An empty answer
        // falls back to an apology; any other failure is reported as before.
        const answer = await aiGenerate({
            kind: 'text', system: systemPrompt, prompt: 'คำถามจากเจ้าของหอพัก: ' + prompt, temperature: 0.7,
        }).catch(err => {
            if (err instanceof AiError && err.code === 'empty_response') return null;
            throw err;
        });
        const reply = answer ?? 'ขออภัยค่ะ น้องแคร์ไม่สามารถประมวลผลคำถามนี้ได้ในขณะนี้';

        return res.status(200).json({ reply });

    } catch (errRaw) {
        const err = errorInfo(errRaw);
        console.error('Nong Care Error:', errRaw);
        return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
}
