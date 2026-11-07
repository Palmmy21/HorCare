import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, MessageCircle, Unplug } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';

interface Status {
    connected: boolean;
    oa_id?: string;
    display_name?: string;
    webhook_url?: string;
    webhook_active?: boolean;
    encryption_ready?: boolean;
}

const ERRORS: Record<string, string> = {
    invalid_input: 'Channel secret ต้องเป็นตัวอักษร 32 ตัว และต้องกรอก Access token',
    invalid_token: 'LINE ไม่ยอมรับ Channel access token นี้',
    invalid_secret: 'Channel secret ไม่ตรงกับ OA นี้',
    webhook_failed: 'ตั้งค่า webhook ไม่สำเร็จ กรุณาลองใหม่',
    shared_oa: 'บัญชีนี้เป็น OA กลางของ HorCare ใช้เชื่อมเป็นของทีมไม่ได้',
    oa_taken: 'OA นี้ถูกเชื่อมกับทีมอื่นอยู่',
    encryption_not_configured: 'ระบบยังไม่พร้อมเก็บข้อมูลลับ กรุณาติดต่อทีมงาน HorCare',
    forbidden: 'เฉพาะเจ้าของบัญชีเท่านั้นที่เชื่อม OA ได้',
};

const errorText = (e: ApiError) => (e.code === 'rooms_linked'
    ? 'ยังมีผู้เช่าผูกกับ OA นี้อยู่ ต้องย้ายหรือยกเลิกการผูกทุกห้องก่อน'
    : ERRORS[e.code] ?? e.message ?? 'ดำเนินการไม่สำเร็จ');

/** A team connects its own LINE Official Account; new tenants then register and get their bills there. */
export default function LineOaCard({ ownerUid, buildingId }: { ownerUid: string; buildingId?: string }) {
    const [status, setStatus] = useState<Status | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [secret, setSecret] = useState('');
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            setStatus(await apiPost<Status>('line-oa', { action: 'status', owner_uid: ownerUid, building_id: buildingId }));
        } catch (e) {
            if ((e as ApiError).code === 'forbidden') setForbidden(true);
        }
    }, [ownerUid, buildingId]);

    useEffect(() => { void load(); }, [load]);

    const connect = async () => {
        setBusy(true);
        try {
            const res = await apiPost<Status>('line-oa', { action: 'connect', owner_uid: ownerUid, building_id: buildingId, channel_secret: secret, access_token: token });
            setStatus(res);
            setSecret('');
            setToken('');
            toast.success(`เชื่อม ${res.oa_id} แล้ว`);
        } catch (e) {
            toast.error(errorText(e as ApiError));
        } finally {
            setBusy(false);
        }
    };

    const disconnect = async () => {
        if (!confirm('ยกเลิกการเชื่อม OA ของทีม? ผู้เช่าใหม่จะกลับไปใช้ OA กลางของ HorCare')) return;
        setBusy(true);
        try {
            await apiPost('line-oa', { action: 'disconnect', owner_uid: ownerUid, building_id: buildingId });
            toast.success('ยกเลิกการเชื่อมแล้ว');
            await load();
        } catch (e) {
            toast.error(errorText(e as ApiError));
        } finally {
            setBusy(false);
        }
    };

    if (forbidden) return null;

    return (
        <div className="card mb-6">
            <div className="card-header">
                <div>
                    <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><MessageCircle size={18} /> LINE OA ของทีม</div>
                    <p className="card-subtitle">ผู้เช่าลงทะเบียน คุยแชท และรับบิลผ่าน OA ของคุณเอง แทน OA กลางของ HorCare</p>
                </div>
            </div>
            {!status ? <Loader2 size={18} className="spin" /> : status.connected ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', fontSize: '0.875rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#15803D', fontWeight: 700 }}>
                        <Check size={16} /> เชื่อมแล้ว: {status.display_name} ({status.oa_id})
                    </div>
                    {status.webhook_active === false && (
                        <div role="alert" style={{ display: 'flex', gap: '0.5rem', color: '#B45309' }}>
                            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                            <span>ยังต้องเปิด “Use webhook” ใน LINE Developers Console ของ OA นี้ ไม่อย่างนั้นระบบจะไม่ได้รับข้อความจากผู้เช่า</span>
                        </div>
                    )}
                    <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-gray-500)' }}>
                        QR ที่พิมพ์ไว้จะพาไป OA นี้อัตโนมัติ ไม่ต้องพิมพ์ใหม่ ผู้เช่าที่อยู่บน OA กลางยังรับบิลได้ตามเดิม จนกว่าจะสแกนใหม่และแอดมินอนุมัติ
                    </p>
                    <div><button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void disconnect()}><Unplug size={14} /> ยกเลิกการเชื่อม</button></div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                    <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-gray-600)' }}>
                        คัดลอกจาก LINE Developers Console ของ OA คุณ ระบบจะตั้ง webhook ให้อัตโนมัติ
                    </p>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span className="form-label">Channel secret (แท็บ Basic settings)</span>
                        <input className="form-input" type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span className="form-label">Channel access token แบบ long-lived (แท็บ Messaging API)</span>
                        <input className="form-input" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} />
                    </label>
                    <div>
                        <button className="btn btn-primary btn-sm" disabled={busy || !secret || !token} onClick={() => void connect()}>
                            {busy ? <Loader2 size={14} className="spin" /> : <MessageCircle size={14} />} เชื่อม OA
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
