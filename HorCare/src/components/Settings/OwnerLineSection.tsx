import { useEffect, useState } from 'react';
import { MessageCircle, Copy, Loader2, Link2Off } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { apiPost } from '../../utils/api';
import JoinQr from '../Common/JoinQr';
import { OWNER_HELP } from '../../shared/ownerCommands';

/** Settings → การเชื่อมต่อ: link this account to the team LINE OA — the admin menu, and figures (#ยอด #ค้าง #ห้องว่าง) for those who may see them. */
export default function OwnerLineSection({ ownerUid }: { ownerUid?: string }) {
    const [linked, setLinked] = useState<boolean | null>(null);
    const [code, setCode] = useState<{ code: string; expires_at: number } | null>(null);
    const [busy, setBusy] = useState(false);
    const oaId = import.meta.env.VITE_LINE_STAFF_OA_ID as string | undefined;

    useEffect(() => {
        if (!ownerUid) return;
        apiPost<{ linked: boolean }>('owner-line', { action: 'status', owner_uid: ownerUid })
            .then(r => setLinked(r.linked))
            .catch(() => setLinked(null));
    }, [ownerUid]);

    if (!ownerUid) return null;

    const issue = async () => {
        setBusy(true);
        try {
            setCode(await apiPost<{ code: string; expires_at: number }>('owner-line', { action: 'code', owner_uid: ownerUid }));
        } catch (err) {
            toast.error((err as { code?: string }).code === 'forbidden' ? 'บัญชีนี้ไม่มีสิทธิ์เชื่อม LINE ผู้ดูแล' : `สร้างรหัสไม่สำเร็จ: ${(err as Error).message}`);
        } finally {
            setBusy(false);
        }
    };
    const unlink = async () => {
        setBusy(true);
        try {
            await apiPost('owner-line', { action: 'unlink', owner_uid: ownerUid });
            setLinked(false);
            toast.success('เลิกเชื่อม LINE แล้ว');
        } catch (err) {
            toast.error(`ไม่สำเร็จ: ${(err as Error).message}`);
        } finally {
            setBusy(false);
        }
    };
    const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast.success('คัดลอกแล้ว'); } catch { toast.error('คัดลอกไม่สำเร็จ'); } };

    const addFriend = oaId ? `https://line.me/R/ti/p/${encodeURIComponent(oaId)}` : null;
    const sendCode = oaId && code ? `https://line.me/R/oaMessage/${encodeURIComponent(oaId)}/?${encodeURIComponent(code.code)}` : null;
    const minutesLeft = code ? Math.max(0, Math.ceil((code.expires_at - Date.now()) / 60000)) : 0;

    return (
        <div className="settings-section">
            <h3 className="settings-title">
                <MessageCircle size={20} color="#06C755" />
                เชื่อม LINE ผู้ดูแล
                {linked && <span className="badge badge-success" style={{ marginLeft: 'auto' }}>เชื่อมแล้ว</span>}
            </h3>
            <p className="form-hint" style={{ marginBottom: '1rem' }}>
                เชื่อมบัญชีนี้กับ LINE ของทีมงาน (HorCare Maintenance) เมนูใน LINE จะเปลี่ยนเป็นเมนูผู้ดูแล: งานทั้งหมด ทีมงาน และจดมิเตอร์
                บัญชีที่มีสิทธิ์ดูการเงินพิมพ์ <strong>#ยอด</strong> <strong>#ค้าง</strong> หรือ <strong>#ห้องว่าง</strong> ในแชทเพื่อดูสรุปได้ด้วย
            </p>

            {code ? (
                <div className="owner-line-code">
                    <div>
                        <JoinQr code={code.code} size={132} hint="สแกนด้วย LINE แล้วเชื่อมทันที" />
                        <div className="form-hint">ใช้ได้อีก {minutesLeft} นาที ครั้งเดียว</div>
                    </div>
                    <div className="listing-link-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(code.code)}><Copy size={14} aria-hidden /> คัดลอก</button>
                        {sendCode && <a className="btn btn-sm lp-line" href={sendCode} target="_blank" rel="noopener noreferrer">ส่งรหัสใน LINE</a>}
                    </div>
                </div>
            ) : null}

            <ol className="owner-line-steps">
                <li>{addFriend ? <>เพิ่มเพื่อน <a href={addFriend} target="_blank" rel="noopener noreferrer">LINE ของทีมงาน HorCare</a></> : 'เพิ่มเพื่อน LINE OA ของทีมงาน (ตั้งค่าในหน้าทีมงาน → การเชื่อมต่อ LINE)'}</li>
                <li>กด "สร้างรหัสเชื่อม LINE" แล้วส่งรหัส HCO- ในแชทนั้น</li>
                <li>เมนูด้านล่างของแชทจะเปลี่ยนเป็นเมนูผู้ดูแล</li>
            </ol>

            <div className="listing-actions">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void issue()}>
                    {busy && <Loader2 size={16} className="pp-spin" aria-hidden />} {linked ? 'เชื่อม LINE เพิ่มอีกเครื่อง' : 'สร้างรหัสเชื่อม LINE'}
                </button>
                {linked && (
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void unlink()}><Link2Off size={16} aria-hidden /> เลิกเชื่อมทั้งหมด</button>
                )}
            </div>

            <details className="owner-line-help">
                <summary>คำสั่งทั้งหมด</summary>
                <pre>{OWNER_HELP}</pre>
            </details>
        </div>
    );
}
