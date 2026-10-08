import { useState } from 'react';
import { X, UserPlus, Loader2, MessageCircle, Copy, Link2Off, Wrench, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { STAFF_ROLE_LABELS_TH, type StaffRole, type WorkStaff } from '../../shared/workOrders';

interface Props {
    ownerUid: string;
    buildingId: string;
    staff: WorkStaff[];
    onClose: () => void;
}

export default function StaffManagerModal({ ownerUid, buildingId, staff, onClose }: Props) {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [role, setRole] = useState<StaffRole>('technician');
    const [busy, setBusy] = useState<string | null>(null);
    const [codes, setCodes] = useState<Record<string, { code: string; expires_at: number }>>({});
    // Staff use their own LINE OA (not the tenant one)
    const lineOaId = import.meta.env.VITE_LINE_STAFF_OA_ID as string | undefined;

    const call = async (key: string, body: Record<string, unknown>, ok?: string) => {
        setBusy(key);
        try {
            const res = await apiPost<Record<string, unknown>>('work-orders', { owner_uid: ownerUid, building_id: buildingId, ...body });
            if (ok) toast.success(ok);
            return res;
        } catch (e) {
            const err = e as ApiError;
            toast.error(err.message && err.message !== err.code ? err.message : err.code === 'forbidden' ? 'คุณไม่มีสิทธิ์จัดการทีมงาน' : 'ดำเนินการไม่สำเร็จ');
            return null;
        } finally {
            setBusy(null);
        }
    };

    const add = async () => {
        if (!name.trim()) return;
        const r = await call('add', { action: 'staff_create', name: name.trim(), phone: phone.trim(), role }, 'เพิ่มพนักงานแล้ว');
        if (r) { setName(''); setPhone(''); }
    };

    const issueCode = async (s: WorkStaff) => {
        const r = await call(`code-${s.id}`, { action: 'staff_link_code', staff_id: s.id }) as { code: string; expires_at: number } | null;
        if (r) setCodes(prev => ({ ...prev, [s.id]: r }));
    };

    const copy = async (text: string) => {
        try { await navigator.clipboard.writeText(text); toast.success('คัดลอกแล้ว'); } catch { toast.error('คัดลอกไม่สำเร็จ'); }
    };

    const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="ทีมช่างและแม่บ้าน">
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="modal-title">ทีมช่างและแม่บ้าน</span>
                    <button className="btn-icon" onClick={onClose} aria-label="ปิด"><X size={18} /></button>
                </div>
                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div className="card" style={{ padding: '0.75rem' }}>
                        <div style={{ fontWeight: 700, marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center' }}><UserPlus size={15} /> เพิ่มพนักงาน</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                            <label style={field}><span className="form-label">ชื่อ</span>
                                <input className="form-input" maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
                            <label style={field}><span className="form-label">เบอร์โทร</span>
                                <input className="form-input" maxLength={20} inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} /></label>
                            <label style={field}><span className="form-label">หน้าที่</span>
                                <select className="form-input" value={role} onChange={e => setRole(e.target.value as StaffRole)}>
                                    <option value="technician">ช่าง</option><option value="housekeeping">แม่บ้าน</option>
                                </select></label>
                        </div>
                        <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={add} disabled={!name.trim() || busy === 'add'}>
                            {busy === 'add' ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} เพิ่ม
                        </button>
                    </div>

                    {staff.length === 0 ? (
                        <div style={{ fontSize: '0.875rem', color: 'var(--color-gray-500)' }}>ยังไม่มีพนักงาน — เพิ่มช่างหรือแม่บ้านก่อนมอบหมายงาน</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {staff.map(s => {
                                const code = codes[s.id];
                                const deep = code && lineOaId ? `https://line.me/R/oaMessage/${encodeURIComponent(lineOaId)}/?${encodeURIComponent(code.code)}` : null;
                                return (
                                    <div key={s.id} className="card" style={{ padding: '0.625rem 0.75rem', opacity: s.active ? 1 : 0.6 }}>
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                            {s.role === 'technician' ? <Wrench size={15} /> : <Sparkles size={15} />}
                                            <span style={{ fontWeight: 700 }}>{s.name}</span>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>{STAFF_ROLE_LABELS_TH[s.role]}{s.phone ? ` · ${s.phone}` : ''}</span>
                                            <span style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 700, color: s.line_user_id ? '#059669' : '#B45309', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                                <MessageCircle size={12} /> {s.line_user_id ? 'เชื่อม LINE แล้ว' : 'ยังไม่เชื่อม LINE'}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                                            {s.active && (
                                                <button className="btn btn-outline btn-sm" disabled={busy === `code-${s.id}`} onClick={() => void issueCode(s)}>
                                                    {busy === `code-${s.id}` ? <Loader2 size={13} className="spin" /> : <MessageCircle size={13} />} {s.line_user_id ? 'เชื่อมบัญชีใหม่' : 'สร้างรหัสเชื่อม LINE'}
                                                </button>
                                            )}
                                            {s.line_user_id && (
                                                <button className="btn btn-outline btn-sm" onClick={() => { if (confirm(`ยกเลิกการเชื่อม LINE ของ ${s.name}?`)) void call(`u-${s.id}`, { action: 'staff_unlink', staff_id: s.id }, 'ยกเลิกการเชื่อมแล้ว'); }}>
                                                    <Link2Off size={13} /> ยกเลิกเชื่อม
                                                </button>
                                            )}
                                            <button className="btn btn-outline btn-sm" onClick={() => void call(`a-${s.id}`, { action: 'staff_update_info', staff_id: s.id, active: !s.active }, s.active ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว')}>
                                                {s.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                                            </button>
                                        </div>
                                        {code && (
                                            <div style={{ marginTop: 8, padding: 8, background: 'var(--color-gray-50)', borderRadius: 8, fontSize: '0.8125rem' }}>
                                                <div>ให้ {s.name} ส่งรหัสนี้ในแชท LINE ของหอ (ใช้ได้ 24 ชม. ครั้งเดียว):</div>
                                                <div className="mono" style={{ fontSize: '1.125rem', fontWeight: 800, letterSpacing: '0.06em', margin: '4px 0' }}>{code.code}</div>
                                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                    <button className="btn btn-outline btn-sm" onClick={() => void copy(code.code)}><Copy size={12} /> คัดลอกรหัส</button>
                                                    {deep && <button className="btn btn-outline btn-sm" onClick={() => void copy(deep)}><Copy size={12} /> คัดลอกลิงก์ LINE</button>}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className="modal-footer"><button className="btn btn-outline" onClick={onClose}>ปิด</button></div>
            </div>
        </div>
    );
}
