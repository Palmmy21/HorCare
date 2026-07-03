import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin } from './_firebase.js';

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

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY not set');

        // Use gemini-2.5-flash for general reasoning
        const model = 'gemini-2.5-flash'; 
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const systemPrompt = `คุณคือ "น้องแคร์" (Nong Care) ผู้ช่วยอัจฉริยะด้านการเงินและภาษีสำหรับเจ้าของหอพัก
คุณได้รับข้อมูลสถิติของหอพัก (Context) ในรูปแบบ JSON ดังนี้:
${JSON.stringify(context, null, 2)}

กฎการตอบ:
- ตอบเป็นภาษาไทยด้วยน้ำเสียงสุภาพ เป็นมืออาชีพ
- ห้ามใช้ Emoji เด็ดขาดในข้อความตอบกลับ
- วิเคราะห์ข้อมูลจาก Context เพื่อตอบคำถามเรื่อง รายรับ รายจ่าย กำไร และภาษีเบื้องต้น
- หากคำถามไม่อยู่ในข้อมูล ให้แนะนำตามหลักการจัดการหอพักทั่วไป
- ใช้ Markdown ในการจัดรูปแบบ (เช่น ตัวหนา, bullet points) เพื่อให้อ่านง่าย`;

        const body = {
            contents: [
                {
                    role: 'user',
                    parts: [{ text: systemPrompt + '\n\nคำถามจากเจ้าของหอพัก: ' + prompt }]
                }
            ],
            generationConfig: {
                temperature: 0.7,
            },
        };

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Gemini API error: ${errText}`);
        }

        const data = await resp.json() as any;
        if (data.error) throw new Error(`Gemini: ${data.error.message}`);

        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'ขออภัยค่ะ น้องแคร์ไม่สามารถประมวลผลคำถามนี้ได้ในขณะนี้';

        return res.status(200).json({ reply });

    } catch (err: any) {
        console.error('Nong Care Error:', err);
        return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
}
