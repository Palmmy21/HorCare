import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_firebase.js';
import { errorInfo } from '../src/shared/errorInfo.js';

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
    // Vercel Cron only. This job reads every account and messages them, so a user's sign-in token is not enough;
    // fail closed when CRON_SECRET is not configured.
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
        res.status(401).send('Unauthorized');
        return;
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
                // One notice per account, expiry date and stage: a re-run (retry, manual trigger) sends nothing twice.
                // The two "expired" days share a stage so the user gets that notice once.
                const stage = roundedDays <= 0 ? 'expired' : `d${roundedDays}`;
                const noticeRef = db.collection('expiry_notices').doc(`${doc.id}_${accessUntil}_${stage}`);
                try {
                    await noticeRef.create({ uid: doc.id, access_until: accessUntil, stage, sent_at: new Date(now).toISOString() });
                } catch {
                    skippedCount++;
                    continue; // already sent
                }
                try {
                    await lineSupportPush(lineSupportId, message);
                    notifiedCount++;
                    console.log(`Notified user ${doc.id} (days remaining: ${roundedDays})`);
                } catch (errRaw) {
                    const err = errorInfo(errRaw);
                    console.error(`Failed to notify user ${doc.id}:`, err.message);
                    await noticeRef.delete().catch(() => undefined); // let the next run try again
                    skippedCount++;
                }
            }
        }

        res.status(200).json({ ok: true, notifiedCount, skippedCount });
    } catch (errRaw) {
        const err = errorInfo(errRaw);
        console.error('cron-check-expiry failed:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
}
