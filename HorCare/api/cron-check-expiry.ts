import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';

export const config = { maxDuration: 60 };

// Function to send LINE message using the Support Channel Token
async function lineSupportPush(to: string, text: string): Promise<void> {
    const token = process.env.LINE_SUPPORT_ACCESS_TOKEN;
    if (!token) {
        console.warn('LINE_SUPPORT_ACCESS_TOKEN is not set');
        return;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                to,
                messages: [{ type: 'text', text }]
            }),
        });
        if (res.ok) return;

        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt === 2) {
            const detail = await res.text().catch(() => '');
            throw new Error(`LINE Support push ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`);
        }
        const wait = Number(res.headers.get('retry-after')) * 1000 || 400 * (attempt + 1);
        await new Promise(r => setTimeout(r, wait));
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Security check: only allow cron requests
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
        // Also allow manual trigger for testing if authenticated with Firebase admin token
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).send('Unauthorized');
            return;
        }
        try {
            const idToken = authHeader.split('Bearer ')[1];
            await admin.auth().verifyIdToken(idToken);
        } catch {
            res.status(401).send('Unauthorized');
            return;
        }
    }

    try {
        const now = Date.now();
        const usersSnap = await db.collection('users').get();
        let notifiedCount = 0;
        let skippedCount = 0;

        for (const doc of usersSnap.docs) {
            const user = doc.data();
            const accessUntil = user.access_until as number | undefined;
            const lineSupportId = user.line_support_user_id as string | undefined;

            if (!accessUntil || !lineSupportId) {
                continue;
            }

            const daysRemaining = (accessUntil - now) / (1000 * 60 * 60 * 24);
            
            let message = '';
            
            // Note: Since cron runs daily, we round the days to check conditions
            const roundedDays = Math.ceil(daysRemaining);

            if (roundedDays === 3) {
                message = `⚠️ แจ้งเตือนจาก HorCare\nแพ็กเกจของคุณจะหมดอายุในอีก 3 วัน\nกรุณาต่ออายุเพื่อใช้งานระบบได้อย่างต่อเนื่องครับ`;
            } else if (roundedDays === 1) {
                message = `🚨 แจ้งเตือนจาก HorCare\nแพ็กเกจของคุณจะหมดอายุในวันพรุ่งนี้!\nกรุณาต่ออายุเพื่อป้องกันการระงับการใช้งานครับ`;
            } else if (roundedDays === 0 || roundedDays === -1) {
                // If it just expired today or yesterday
                message = `❌ แจ้งเตือนจาก HorCare\nแพ็กเกจของคุณหมดอายุแล้วครับ\nขณะนี้ระบบได้ระงับการเข้าถึงบางฟีเจอร์ กรุณาต่ออายุเพื่อกลับมาใช้งานตามปกติครับ`;
            }

            if (message) {
                try {
                    await lineSupportPush(lineSupportId, message);
                    notifiedCount++;
                    console.log(`Notified user ${doc.id} (days remaining: ${roundedDays})`);
                } catch (err: any) {
                    console.error(`Failed to notify user ${doc.id}:`, err.message);
                    skippedCount++;
                }
            }
        }

        res.status(200).json({ ok: true, notifiedCount, skippedCount });
    } catch (err: any) {
        console.error('cron-check-expiry failed:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
}
