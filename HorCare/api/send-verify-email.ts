import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin } from './_firebase.js';

export const config = { maxDuration: 15 };

const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const EMAIL_FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';

async function sendResendEmail(to: string, verifyLink: string): Promise<void> {
    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ยืนยันอีเมล HorCare</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header gradient -->
          <tr>
            <td style="background:linear-gradient(135deg,#6D28D9 0%,#4F46E5 100%);padding:40px 40px 36px;text-align:center;">
              <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:16px;padding:12px 20px;margin-bottom:16px;">
                <span style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px;">🏠 HorCare</span>
              </div>
              <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;line-height:1.3;">ยืนยันอีเมลของคุณ</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.75);font-size:14px;">เพียงขั้นตอนเดียวเพื่อรักษาความปลอดภัยบัญชีของคุณ</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">สวัสดี 👋</p>
              <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7;">
                ขอบคุณที่สมัครใช้งาน <strong>HorCare</strong> — ระบบจัดการหอพักครบวงจร<br/>
                กดปุ่มด้านล่างเพื่อยืนยันอีเมลของคุณ
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 32px;">
                    <a href="${verifyLink}"
                       style="display:inline-block;background:linear-gradient(135deg,#6D28D9,#4F46E5);color:#fff;text-decoration:none;font-size:16px;font-weight:700;padding:16px 40px;border-radius:14px;box-shadow:0 4px 16px rgba(109,40,217,0.35);letter-spacing:0.2px;">
                      ✅ ยืนยันอีเมล
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security note -->
              <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
                <p style="margin:0;color:#64748B;font-size:13px;line-height:1.6;">
                  🔒 <strong>หมายเหตุ:</strong> ลิงก์นี้ใช้ได้ครั้งเดียวและจะหมดอายุใน 24 ชั่วโมง<br/>
                  หากคุณไม่ได้สมัครบัญชีนี้ สามารถละเว้นอีเมลนี้ได้เลย
                </p>
              </div>

              <!-- Fallback link -->
              <p style="margin:0;color:#94A3B8;font-size:12px;line-height:1.6;">
                หากปุ่มไม่ทำงาน ให้คัดลอกลิงก์นี้วางในเบราว์เซอร์:<br/>
                <a href="${verifyLink}" style="color:#6D28D9;word-break:break-all;">${verifyLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:20px 40px;text-align:center;">
              <p style="margin:0;color:#94A3B8;font-size:12px;line-height:1.6;">
                © 2024 HorCare · ระบบจัดการหอพักครบวงจร<br/>
                อีเมลนี้ถูกส่งถึง <strong>${to}</strong>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: `HorCare <${EMAIL_FROM}>`,
            to: [to],
            subject: '✅ ยืนยันอีเมลของคุณ — HorCare',
            html,
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Resend API error ${res.status}: ${body}`);
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
        // Verify Firebase ID token
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);

        // Get user record from Firebase Auth
        const userRecord = await admin.auth().getUser(decoded.uid);

        if (userRecord.emailVerified) {
            res.status(200).json({ data: { alreadyVerified: true } });
            return;
        }

        if (!userRecord.email) {
            res.status(400).json({ error: 'User has no email address' });
            return;
        }

        // Generate Firebase email verification link
        const verifyLink = await admin.auth().generateEmailVerificationLink(userRecord.email, {
            url: `${req.headers.origin || 'https://horcare.vercel.app'}/?verified=1`,
        });

        // Send via Resend
        await sendResendEmail(userRecord.email, verifyLink);

        console.log(`send-verify-email: sent to ${userRecord.email} uid=${decoded.uid}`);
        res.status(200).json({ data: { sent: true } });

    } catch (err: unknown) {
        console.error('send-verify-email error:', err);
        const errMsg = (err as Error).message || '';
        if (errMsg.includes('TOO_MANY_ATTEMPTS_TRY_LATER') || errMsg.includes('too-many-requests')) {
            res.status(429).json({ error: 'TOO_MANY_ATTEMPTS: ส่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' });
        } else {
            res.status(500).json({ error: errMsg || 'Internal Server Error' });
        }
    }
}
