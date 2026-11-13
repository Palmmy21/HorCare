import { useEffect, useState } from 'react';
import { Copy, Link2Off, Loader2, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import JoinQr from '../Common/JoinQr';

/**
 * "POS Care ทาง LINE": link this HorCare account to the HorCare Staff OA (a one-time HCP- code), so the person can open
 * the collector's screen straight from LINE. Shown on the collection screen (which collectors can open) and in Settings.
 */
export default function PosLineCard({ ownerUid, compact = false }: { ownerUid: string; compact?: boolean }) {
    const [state, setState] = useState<{ linked: boolean; can_use: boolean } | null>(null);
    const [code, setCode] = useState<{ code: string; expires_at: number; oa_id: string | null } | null>(null);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(!compact);
    const oaId = (import.meta.env.VITE_LINE_POS_OA_ID as string | undefined) ?? code?.oa_id ?? null;

    useEffect(() => {
        apiPost<{ linked: boolean; can_use: boolean }>('pos', { action: 'status', owner_uid: ownerUid }).then(setState).catch(() => setState(null));
    }, [ownerUid]);

    if (!state?.can_use) return null;

    const issue = async () => {
        setBusy(true);
        try { setCode(await apiPost('pos', { action: 'link_code', owner_uid: ownerUid })); }
        catch (e) { toast.error((e as ApiError).code === 'forbidden' ? 'บัญชีนี้ไม่มีสิทธิ์เก็บเงิน' : 'สร้างรหัสไม่สำเร็จ'); }
        finally { setBusy(false); }
    };
    const unlink = async () => {
        setBusy(true);
        try { await apiPost('pos', { action: 'unlink', owner_uid: ownerUid }); setState({ ...state, linked: false }); toast.success('เลิกเชื่อมแล้ว'); }
        catch { toast.error('ไม่สำเร็จ'); } finally { setBusy(false); }
    };
    const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast.success('คัดลอกแล้ว'); } catch { toast.error('คัดลอกไม่สำเร็จ'); } };
    const minutes = code ? Math.max(0, Math.ceil((code.expires_at - Date.now()) / 60000)) : 0;
    const sendLink = oaId && code ? `https://line.me/R/oaMessage/${encodeURIComponent(oaId)}/?${encodeURIComponent(code.code)}` : null;

    return (
        <div className="pos-link-card">
            <button type="button" className="pos-link-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
                <Smartphone size={18} aria-hidden />
                <span><strong>POS Care ทาง LINE</strong><small>{state.linked ? 'เชื่อมแล้ว · เปิดหน้าเก็บเงินจาก LINE HorCare Staff ได้เลย' : 'เปิดหน้าเก็บเงินจาก LINE ไม่ต้องเข้าระบบทุกครั้ง'}</small></span>
                {state.linked && <span className="badge badge-success">เชื่อมแล้ว</span>}
            </button>
            {open && (
                <div className="pos-link-body">
                    <ol>
                        <li>{oaId ? <>เพิ่มเพื่อน <a href={`https://line.me/R/ti/p/${encodeURIComponent(oaId)}`} target="_blank" rel="noopener noreferrer">LINE HorCare Staff</a></> : 'เพิ่มเพื่อน LINE HorCare Staff'}</li>
                        <li>กด "สร้างรหัส" แล้วสแกน QR ด้วย LINE (ใช้ได้ 15 นาที) — หรือส่งรหัส HCP- ในแชทนั้น</li>
                        <li>กด "เปิด POS Care" ในเมนูของแชท</li>
                    </ol>
                    {code && (
                        <div className="pos-link-code">
                            <JoinQr code={code.code} size={132} hint="สแกนด้วย LINE แล้วเชื่อมทันที" />
                            <small>ใช้ได้อีก {minutes} นาที ครั้งเดียว</small>
                            <div className="pos-link-actions">
                                <button type="button" className="btn btn-outline btn-sm" onClick={() => void copy(code.code)}><Copy size={14} aria-hidden /> คัดลอก</button>
                                {sendLink && <a className="btn btn-primary btn-sm" href={sendLink} target="_blank" rel="noopener noreferrer">ส่งรหัสใน LINE</a>}
                            </div>
                        </div>
                    )}
                    <div className="pos-link-actions">
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void issue()}>{busy ? <Loader2 size={14} className="spin" aria-hidden /> : null} {state.linked ? 'เชื่อมอีกเครื่อง' : 'สร้างรหัส'}</button>
                        {state.linked && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void unlink()}><Link2Off size={14} aria-hidden /> เลิกเชื่อม</button>}
                    </div>
                </div>
            )}
        </div>
    );
}
