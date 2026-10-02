import { useCallback, useEffect, useState } from 'react';
import { X, Link2, Copy, Check, QrCode, Loader2, Ban, MessageCircle, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import type { Room } from '../../types';
import { apiPost, ApiError } from '../../utils/api';

interface InvitationModalProps {
    ownerUid: string;
    buildingId: string;
    room: Room;
    tenantName?: string;
    unitName: string;
    onClose: () => void;
}

interface InvitationRow {
    id: string;
    room_id: string;
    room_number: string;
    tenant_name: string;
    status: 'active' | 'used' | 'revoked';
    one_time: boolean;
    use_count: number;
    max_uses: number;
    expires_at: number;
    created_at: string;
}

interface CreatedInvite { code: string; expires_at: number; one_time: boolean }

const TTL_OPTIONS = [
    { hours: 24, label: '24 ชั่วโมง' },
    { hours: 72, label: '3 วัน' },
    { hours: 168, label: '7 วัน' },
    { hours: 720, label: '30 วัน' },
];

const ERRORS: Record<string, string> = {
    tenant_required: 'ระบุชื่อผู้เช่า หรือบันทึกโปรไฟล์ผู้เช่าของห้องนี้ก่อน',
    room_already_registered: 'ห้องนี้มีผู้ลงทะเบียน LINE แล้ว — ติ๊ก "แทนที่ผู้ลงทะเบียนเดิม" หากต้องการเปลี่ยนคน',
    forbidden: 'คุณไม่มีสิทธิ์สร้างรหัสเชิญ',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
    room_not_found: 'ไม่พบห้องนี้',
};

function statusOf(i: InvitationRow): { label: string; color: string } {
    if (i.status === 'revoked') return { label: 'ยกเลิกแล้ว', color: '#6B7280' };
    if (i.status === 'used') return { label: 'ใช้แล้ว', color: '#059669' };
    if (i.expires_at <= Date.now()) return { label: 'หมดอายุ', color: '#D97706' };
    return { label: 'ใช้งานได้', color: '#2563EB' };
}

export default function InvitationModal({ ownerUid, buildingId, room, tenantName, unitName, onClose }: InvitationModalProps) {
    const [name, setName] = useState(tenantName ?? '');
    const [ttl, setTtl] = useState(72);
    const [oneTime, setOneTime] = useState(true);
    const [replace, setReplace] = useState(false);
    const [creating, setCreating] = useState(false);
    const [created, setCreated] = useState<CreatedInvite | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [history, setHistory] = useState<InvitationRow[] | null>(null);
    const [copied, setCopied] = useState<'code' | 'link' | null>(null);

    const lineOaId = import.meta.env.VITE_LINE_OA_ID as string | undefined;
    // LINE opens a chat with the OA and pre-fills the code; the tenant only has to press send.
    const link = created && lineOaId
        ? `https://line.me/R/oaMessage/${encodeURIComponent(lineOaId)}/?${encodeURIComponent(created.code)}`
        : null;

    const loadHistory = useCallback(async () => {
        try {
            const { invitations } = await apiPost<{ invitations: InvitationRow[] }>('invitations', {
                action: 'list', owner_uid: ownerUid, building_id: buildingId,
            });
            setHistory(invitations.filter(i => i.room_id === room.id));
        } catch {
            setHistory([]);
        }
    }, [ownerUid, buildingId, room.id]);

    useEffect(() => { void loadHistory(); }, [loadHistory]);

    const create = async () => {
        setCreating(true);
        setError(null);
        try {
            const res = await apiPost<CreatedInvite>('invitations', {
                action: 'create', owner_uid: ownerUid, building_id: buildingId, room_id: room.id,
                tenant_name: name.trim() || undefined, expires_in_hours: ttl, one_time: oneTime, replace_existing: replace,
            });
            setCreated(res);
            void loadHistory();
        } catch (e) {
            const err = e as ApiError;
            setError(ERRORS[err.code] ?? err.message ?? 'สร้างรหัสเชิญไม่สำเร็จ');
        } finally {
            setCreating(false);
        }
    };

    const revoke = async (id: string) => {
        if (!confirm('ยกเลิกรหัสเชิญนี้? ผู้เช่าจะใช้รหัสนี้ลงทะเบียนไม่ได้อีก')) return;
        try {
            await apiPost('invitations', { action: 'revoke', owner_uid: ownerUid, building_id: buildingId, invitation_id: id });
            toast.success('ยกเลิกรหัสเชิญแล้ว');
            void loadHistory();
        } catch {
            toast.error('ยกเลิกไม่สำเร็จ');
        }
    };

    const copy = async (what: 'code' | 'link') => {
        const text = what === 'code' ? created?.code : link;
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setCopied(what);
            setTimeout(() => setCopied(null), 2000);
        } catch {
            toast.error('คัดลอกไม่สำเร็จ');
        }
    };

    const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem' };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal" style={{ maxWidth: 520 }} role="dialog" aria-modal="true" aria-label="สร้างรหัสเชิญผู้เช่า">
                <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Link2 size={20} /> เชิญผู้เช่า — {unitName} {room.room_number}
                    </span>
                    <button className="btn-icon" onClick={onClose} aria-label="ปิด"><X size={18} /></button>
                </div>

                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {!created ? (
                        <>
                            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-gray-600)' }}>
                                รหัสเชิญผูกกับ{unitName}นี้โดยตรง ผู้เช่าไม่ต้องพิมพ์เลข{unitName}เอง จึงไม่เสี่ยงผูกผิด{unitName}
                            </p>
                            <label style={field}>
                                <span className="form-label">ชื่อผู้เช่า</span>
                                <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="ชื่อ-นามสกุล" />
                            </label>
                            <label style={field}>
                                <span className="form-label">อายุของรหัส</span>
                                <select className="form-input" value={ttl} onChange={e => setTtl(Number(e.target.value))}>
                                    {TTL_OPTIONS.map(o => <option key={o.hours} value={o.hours}>{o.label}</option>)}
                                </select>
                            </label>
                            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
                                <input type="checkbox" checked={oneTime} onChange={e => setOneTime(e.target.checked)} />
                                ใช้ได้ครั้งเดียว (แนะนำ)
                            </label>
                            {room.line_user_id && (
                                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
                                    <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
                                    แทนที่ผู้ลงทะเบียน LINE เดิมของ{unitName}นี้
                                </label>
                            )}
                            {error && <div role="alert" style={{ color: '#DC2626', fontSize: '0.8125rem' }}>{error}</div>}
                        </>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', alignItems: 'center' }}>
                            <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-600)', textAlign: 'center' }}>
                                รหัสนี้แสดงครั้งเดียว · หมดอายุ {new Date(created.expires_at).toLocaleString('th-TH')}
                                {created.one_time ? ' · ใช้ได้ครั้งเดียว' : ''}
                            </div>
                            <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.08em' }}>{created.code}</div>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                                <button className="btn btn-outline btn-sm" onClick={() => copy('code')}>
                                    {copied === 'code' ? <Check size={14} /> : <Copy size={14} />} คัดลอกรหัส
                                </button>
                                {link && (
                                    <>
                                        <button className="btn btn-outline btn-sm" onClick={() => copy('link')}>
                                            {copied === 'link' ? <Check size={14} /> : <Link2 size={14} />} คัดลอกลิงก์
                                        </button>
                                        <a className="btn btn-line btn-sm" href={`https://line.me/R/msg/text/?${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer">
                                            <MessageCircle size={14} /> ส่งทาง LINE
                                        </a>
                                    </>
                                )}
                            </div>
                            {link ? (
                                <div style={{ padding: 10, background: '#fff', borderRadius: 12 }} aria-label="QR Code สำหรับลงทะเบียน">
                                    <QRCodeSVG value={link} size={168} />
                                </div>
                            ) : (
                                <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)', display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                                    <QrCode size={14} /> ยังไม่ได้ตั้งค่า LINE OA — ให้ผู้เช่าพิมพ์รหัสนี้ในแชท LINE ของหอ
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                            <span className="form-label" style={{ fontWeight: 700 }}>ประวัติรหัสเชิญของ{unitName}นี้</span>
                            <button className="btn-icon btn-sm" onClick={() => void loadHistory()} aria-label="รีเฟรช"><RefreshCw size={13} /></button>
                        </div>
                        {history === null ? (
                            <Loader2 size={16} className="spin" />
                        ) : history.length === 0 ? (
                            <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)' }}>ยังไม่มีรหัสเชิญ</div>
                        ) : (
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                                {history.slice(0, 8).map(i => {
                                    const st = statusOf(i);
                                    return (
                                        <li key={i.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}>
                                            <span style={{ color: st.color, fontWeight: 700, minWidth: 72 }}>{st.label}</span>
                                            <span style={{ flex: 1, color: 'var(--color-gray-600)' }}>
                                                {i.tenant_name} · {new Date(i.created_at).toLocaleDateString('th-TH')}
                                            </span>
                                            {st.label === 'ใช้งานได้' && (
                                                <button className="btn btn-outline btn-sm" onClick={() => revoke(i.id)}>
                                                    <Ban size={12} /> ยกเลิก
                                                </button>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-outline" onClick={onClose}>ปิด</button>
                    {!created ? (
                        <button className="btn btn-primary" onClick={create} disabled={creating}>
                            {creating ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />} สร้างรหัสเชิญ
                        </button>
                    ) : (
                        <button className="btn btn-primary" onClick={() => setCreated(null)}>สร้างรหัสใหม่</button>
                    )}
                </div>
            </div>
        </div>
    );
}
