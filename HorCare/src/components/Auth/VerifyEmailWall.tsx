import { useState } from 'react';
import { MailCheck, RefreshCw, LogOut, Send } from 'lucide-react';

interface VerifyEmailWallProps {
    email: string;
    onResend: () => Promise<void>;
    onRefresh: () => Promise<boolean>;
    onLogout: () => void;
}

/**
 * เต็มจอ กั้นการใช้งานจนกว่าผู้ใช้จะยืนยันอีเมล.
 * กันสมัครด้วยอีเมลปลอม + กันเปิดหลายบัญชีรับ trial ฟรีไม่จำกัด.
 */
export default function VerifyEmailWall({ email, onResend, onRefresh, onLogout }: VerifyEmailWallProps) {
    const [resending, setResending] = useState(false);
    const [checking, setChecking] = useState(false);
    const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

    const handleResend = async () => {
        setResending(true);
        setMsg(null);
        try {
            await onResend();
            setMsg({ text: '📨 ส่งอีเมลยืนยันใหม่แล้ว — เช็กกล่องจดหมาย (รวมถึง Junk/Spam)', tone: 'ok' });
        } catch (e: unknown) {
            const code = (e as { code?: string }).code;
            setMsg({
                text: code === 'auth/too-many-requests'
                    ? 'ส่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
                    : 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
                tone: 'err',
            });
        } finally {
            setResending(false);
        }
    };

    const handleRefresh = async () => {
        setChecking(true);
        setMsg(null);
        try {
            const verified = await onRefresh();
            if (!verified) {
                setMsg({ text: 'ยังไม่พบการยืนยัน — กดลิงก์ในอีเมลก่อน แล้วลองใหม่อีกครั้ง', tone: 'err' });
            }
            // ยืนยันแล้ว: state ใน useAuth จะอัปเดตเอง แล้ว gate นี้จะหายไป
        } catch {
            setMsg({ text: 'ตรวจสอบไม่สำเร็จ กรุณาลองใหม่', tone: 'err' });
        } finally {
            setChecking(false);
        }
    };

    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: '100vh', flexDirection: 'column', gap: '1.25rem',
            padding: '2rem', textAlign: 'center',
            background: 'linear-gradient(135deg, #0F0C29 0%, #302B63 50%, #24243E 100%)',
        }}>
            <div style={{
                width: 80, height: 80, borderRadius: '50%',
                background: 'rgba(59,130,246,0.15)', border: '2px solid rgba(59,130,246,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><MailCheck size={40} color="#60A5FA" /></div>

            <h2 style={{ color: '#fff', fontWeight: 800, fontSize: '1.6rem', margin: 0 }}>ยืนยันอีเมลของคุณ</h2>

            <p style={{ color: '#9CA3AF', maxWidth: '420px', lineHeight: 1.7, margin: 0 }}>
                เราได้ส่งลิงก์ยืนยันไปที่<br />
                <strong style={{ color: '#fff', wordBreak: 'break-all' }}>{email}</strong><br />
                กดลิงก์ในอีเมลเพื่อเปิดใช้งานบัญชี แล้วกด "ฉันยืนยันแล้ว"
            </p>

            {msg && (
                <div style={{
                    fontSize: '0.85rem', lineHeight: 1.5, maxWidth: '420px',
                    color: msg.tone === 'ok' ? '#34D399' : '#F87171',
                }}>{msg.text}</div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '0.5rem' }}>
                <button
                    onClick={handleRefresh}
                    disabled={checking}
                    style={{
                        background: 'linear-gradient(135deg, #3B82F6, #6366F1)',
                        border: 'none', padding: '0.875rem 2rem', borderRadius: '14px', color: '#fff',
                        fontWeight: 700, fontSize: '1rem', cursor: checking ? 'wait' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        boxShadow: '0 4px 24px rgba(59,130,246,0.4)', opacity: checking ? 0.7 : 1,
                    }}
                >
                    <RefreshCw size={18} className={checking ? 'spin' : ''} /> ฉันยืนยันแล้ว
                </button>
                <button
                    onClick={handleResend}
                    disabled={resending}
                    style={{
                        background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                        color: 'rgba(255,255,255,0.8)', padding: '0.875rem 1.5rem', borderRadius: '14px',
                        cursor: resending ? 'wait' : 'pointer', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: resending ? 0.7 : 1,
                    }}
                >
                    <Send size={16} /> ส่งอีเมลอีกครั้ง
                </button>
            </div>

            <button
                onClick={onLogout}
                style={{
                    background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
                    fontSize: '0.875rem', marginTop: '0.5rem',
                }}
            >
                <LogOut size={15} /> ออกจากระบบ
            </button>
        </div>
    );
}
