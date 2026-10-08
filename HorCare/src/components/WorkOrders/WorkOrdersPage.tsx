import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ClipboardCheck, Plus, Search, Loader2, X, Camera, Users, CheckCircle2, RotateCcw, Send, Copy, AlertTriangle, Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { Room } from '../../types';
import { useWorkOrders } from '../../hooks/useWorkOrders';
import { apiPost, ApiError } from '../../utils/api';
import { compressImage } from '../../utils/imageCompress';
import StaffManagerModal from './StaffManagerModal';
import {
    PRIORITIES, PRIORITY_LABELS_TH, WORK_STATUS_LABELS_TH, WORK_TYPES, WORK_TYPE_LABELS_TH, isOverdue,
    type Priority, type WorkOrder, type WorkStaff, type WorkStatus, type WorkType,
} from '../../shared/workOrders';

interface Props { ownerUid: string; buildingId: string; rooms: Room[]; unitName: string }

type Tab = 'all' | 'todo' | 'active' | 'review' | 'closed';
const TAB_FILTER: Record<Tab, (o: WorkOrder) => boolean> = {
    all: () => true,
    todo: o => o.status === 'created',
    active: o => o.status === 'assigned' || o.status === 'accepted' || o.status === 'in_progress',
    review: o => o.status === 'completed',
    closed: o => o.status === 'closed',
};

const STATUS_COLOR: Record<WorkStatus, string> = {
    created: '#6B7280', assigned: '#2563EB', accepted: '#7C3AED', in_progress: '#D97706', completed: '#0D9488', closed: '#059669',
};
const PRIORITY_COLOR: Record<Priority, string> = { low: '#64748B', normal: '#0284C7', high: '#D97706', urgent: '#DC2626' };

const ERRORS: Record<string, string> = {
    forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
    invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบช่องที่กรอก',
    invalid_image: 'รูปไม่ถูกต้องหรือใหญ่เกินไป',
    room_not_found: 'ไม่พบห้องนี้',
    staff_not_found: 'ไม่พบพนักงานหรือถูกปิดใช้งานแล้ว',
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const todayStr = () => new Date().toISOString().slice(0, 10);

function describeNotify(n: Record<string, string> | null): { text: string; warn: boolean } {
    if (!n) return { text: 'มอบหมายแล้ว', warn: false };
    if (n.line === 'sent') return { text: 'มอบหมายแล้ว และส่งงานทาง LINE แล้ว', warn: false };
    if (n.line === 'failed') return { text: 'มอบหมายแล้ว แต่ส่ง LINE ไม่สำเร็จ — ใช้ "ส่งลิงก์ใหม่"', warn: true };
    return { text: 'มอบหมายแล้ว แต่พนักงานยังไม่ได้เชื่อม LINE — ส่งลิงก์ให้เอง', warn: true };
}

// ── Create modal ─────────────────────────────────────────────────────────────
function CreateModal({ ownerUid, buildingId, rooms, unitName, staff, onClose }: Props & { staff: WorkStaff[]; onClose: () => void }) {
    const [roomId, setRoomId] = useState('');
    const [area, setArea] = useState('');
    const [type, setType] = useState<WorkType>('repair');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<Priority>('normal');
    const [due, setDue] = useState('');
    const [staffId, setStaffId] = useState('');
    const [images, setImages] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const activeRooms = useMemo(
        () => rooms.filter(r => r.is_active !== false).sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })),
        [rooms],
    );
    const activeStaff = staff.filter(s => s.active);
    const canSubmit = !busy && description.trim().length > 0 && (roomId !== '' || area.trim().length > 0);

    const addPhotos = async (files: FileList | null) => {
        if (!files) return;
        for (const f of [...files].slice(0, 3 - images.length)) {
            try { const { base64 } = await compressImage(f, 900); setImages(prev => (prev.length < 3 ? [...prev, base64] : prev)); }
            catch { toast.error('อ่านรูปไม่ได้'); }
        }
    };

    const submit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        setError(null);
        try {
            const res = await apiPost<{ link: string | null; notify: Record<string, string> | null }>('work-orders', {
                action: 'create', owner_uid: ownerUid, building_id: buildingId,
                room_id: roomId || undefined, area: roomId ? undefined : area.trim(),
                work_type: type, description: description.trim(), priority, due_date: due || undefined,
                images, assign_staff_id: staffId || undefined,
            });
            if (staffId) {
                const d = describeNotify(res.notify);
                if (d.warn) toast(d.text, { icon: '⚠️', duration: 6000 }); else toast.success(d.text);
            } else toast.success('สร้างใบงานแล้ว');
            onClose();
        } catch (e) {
            const err = e as ApiError;
            setError(ERRORS[err.code] ?? err.message ?? 'สร้างใบงานไม่สำเร็จ');
        } finally {
            setBusy(false);
        }
    };

    const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div className="modal" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="สร้างใบงาน">
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="modal-title">สร้างใบงาน</span>
                    <button className="btn-icon" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>
                </div>
                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                        <label style={field}><span className="form-label">{unitName}</span>
                            <select className="form-input" value={roomId} onChange={e => setRoomId(e.target.value)}>
                                <option value="">— พื้นที่ส่วนกลาง —</option>
                                {activeRooms.map(r => <option key={r.id} value={r.id}>{r.room_number}</option>)}
                            </select></label>
                        {!roomId && (
                            <label style={field}><span className="form-label">พื้นที่ *</span>
                                <input className="form-input" maxLength={60} placeholder="เช่น ลิฟต์, ลานจอดรถ" value={area} onChange={e => setArea(e.target.value)} /></label>
                        )}
                        <label style={field}><span className="form-label">ประเภทงาน</span>
                            <select className="form-input" value={type} onChange={e => setType(e.target.value as WorkType)}>
                                {WORK_TYPES.map(t => <option key={t} value={t}>{WORK_TYPE_LABELS_TH[t]}</option>)}
                            </select></label>
                        <label style={field}><span className="form-label">ความสำคัญ</span>
                            <select className="form-input" value={priority} onChange={e => setPriority(e.target.value as Priority)}>
                                {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS_TH[p]}</option>)}
                            </select></label>
                        <label style={field}><span className="form-label">กำหนดเสร็จ</span>
                            <input className="form-input" type="date" min={todayStr()} value={due} onChange={e => setDue(e.target.value)} /></label>
                    </div>
                    <label style={field}><span className="form-label">รายละเอียด *</span>
                        <textarea className="form-input" rows={3} maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} /></label>

                    <div style={field}>
                        <span className="form-label">รูปประกอบ (สูงสุด 3 รูป)</span>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            {images.map((b, i) => (
                                <div key={i} style={{ position: 'relative' }}>
                                    <img src={`data:image/jpeg;base64,${b}`} alt={`รูป ${i + 1}`} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
                                    <button type="button" aria-label="เอารูปออก" onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                                        style={{ position: 'absolute', top: -6, right: -6, borderRadius: '50%', border: 'none', background: '#DC2626', color: '#fff', width: 18, height: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
                                </div>
                            ))}
                            {images.length < 3 && (
                                <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}><Camera size={14} /> เพิ่มรูป</button>
                            )}
                            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                                onChange={e => { void addPhotos(e.target.files); e.target.value = ''; }} />
                        </div>
                    </div>

                    <label style={field}>
                        <span className="form-label">มอบหมายให้ (ส่งงานทาง LINE ทันที)</span>
                        <select className="form-input" value={staffId} onChange={e => setStaffId(e.target.value)}>
                            <option value="">— ยังไม่มอบหมาย —</option>
                            {activeStaff.map(s => <option key={s.id} value={s.id}>{s.name}{s.line_user_id ? '' : ' (ยังไม่เชื่อม LINE)'}</option>)}
                        </select>
                    </label>
                    {error && <div role="alert" style={{ color: '#DC2626', fontSize: '0.8125rem' }}>{error}</div>}
                </div>
                <div className="modal-footer">
                    <button className="btn btn-outline" onClick={onClose} disabled={busy}>ยกเลิก</button>
                    <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
                        {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} {staffId ? 'สร้างและส่งงาน' : 'สร้างใบงาน'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Detail modal ─────────────────────────────────────────────────────────────
interface WorkImage { id: string; kind: string; data_url: string; created_at: string }

function DetailModal({ order, staff, ownerUid, buildingId, onClose }: { order: WorkOrder; staff: WorkStaff[]; ownerUid: string; buildingId: string; onClose: () => void }) {
    const [images, setImages] = useState<WorkImage[] | null>(null);
    const [assignTo, setAssignTo] = useState(order.assigned_staff_id ?? '');
    const [busy, setBusy] = useState<string | null>(null);
    const [link, setLink] = useState<string | null>(null);
    const [zoom, setZoom] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        getDocs(query(collection(db, `users/${ownerUid}/buildings/${buildingId}/work_order_images`), where('work_order_id', '==', order.id)))
            .then(s => { if (!cancelled) setImages(s.docs.map(d => d.data() as WorkImage).sort((a, b) => a.created_at.localeCompare(b.created_at))); })
            .catch(() => { if (!cancelled) setImages([]); });
        return () => { cancelled = true; };
    }, [ownerUid, buildingId, order.id, order.image_count]);

    const act = async (key: string, body: Record<string, unknown>, okMsg?: string) => {
        setBusy(key);
        try {
            const res = await apiPost<{ link?: string; notify?: Record<string, string> }>('work-orders', { owner_uid: ownerUid, building_id: buildingId, work_order_id: order.id, ...body });
            if (res.link) setLink(res.link);
            if (res.notify) { const d = describeNotify(res.notify); if (d.warn) toast(d.text, { icon: '⚠️', duration: 6000 }); else toast.success(d.text); }
            else if (okMsg) toast.success(okMsg);
            return true;
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ');
            return false;
        } finally {
            setBusy(null);
        }
    };

    const reopen = () => {
        const note = window.prompt('เหตุผลที่ส่งกลับให้แก้ไข (จำเป็น)');
        if (note && note.trim()) void act('reopen', { action: 'reopen', note: note.trim() }, 'ส่งกลับให้แก้ไขแล้ว');
    };

    const canAssign = order.status === 'created' || order.status === 'assigned' || order.status === 'accepted';
    const kindLabel: Record<string, string> = { issue: 'รูปปัญหา', before: 'ก่อนทำ', after: 'หลังทำ' };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal" style={{ maxWidth: 600 }} role="dialog" aria-modal="true" aria-label="รายละเอียดใบงาน">
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <div className="modal-title">{order.area} · {WORK_TYPE_LABELS_TH[order.work_type]}</div>
                        <div style={{ fontSize: '0.8125rem', color: STATUS_COLOR[order.status], fontWeight: 700 }}>{WORK_STATUS_LABELS_TH[order.status]}</div>
                    </div>
                    <button className="btn-icon" onClick={onClose} aria-label="ปิด"><X size={18} /></button>
                </div>
                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{order.description}</p>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-600)', display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem' }}>
                        <span style={{ color: PRIORITY_COLOR[order.priority], fontWeight: 700 }}>ความสำคัญ: {PRIORITY_LABELS_TH[order.priority]}</span>
                        <span>กำหนดเสร็จ: {order.due_date ?? 'ไม่ระบุ'}</span>
                        <span>ผู้รับผิดชอบ: {order.assigned_staff_name ?? '—'}</span>
                        <span>สร้างโดย {order.created_by_name}</span>
                    </div>
                    {order.reopen_note && order.status === 'in_progress' && (
                        <div style={{ padding: 8, borderRadius: 8, background: 'rgba(245,158,11,0.12)', fontSize: '0.8125rem' }}>ส่งกลับแก้ไข: {order.reopen_note}</div>
                    )}
                    {order.completion_note && <div style={{ fontSize: '0.8125rem' }}><b>หมายเหตุตอนเสร็จงาน:</b> {order.completion_note}</div>}

                    {images === null ? <Loader2 size={16} className="spin" /> : images.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {images.map(i => (
                                <button key={i.id} type="button" onClick={() => setZoom(i.data_url)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'zoom-in', textAlign: 'center' }}>
                                    <img src={i.data_url} alt={kindLabel[i.kind] ?? i.kind} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                                    <span style={{ fontSize: '0.68rem', color: 'var(--color-gray-500)' }}>{kindLabel[i.kind] ?? i.kind}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {canAssign && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
                                <span className="form-label">{order.status === 'created' ? 'มอบหมายให้' : 'เปลี่ยนผู้รับผิดชอบ'}</span>
                                <select className="form-input" value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                                    <option value="">— เลือกพนักงาน —</option>
                                    {staff.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}{s.line_user_id ? '' : ' (ยังไม่เชื่อม LINE)'}</option>)}
                                </select>
                            </label>
                            <button className="btn btn-primary btn-sm" disabled={!assignTo || busy === 'assign'} onClick={() => void act('assign', { action: 'assign', staff_id: assignTo })}>
                                {busy === 'assign' ? <Loader2 size={14} className="spin" /> : <Send size={14} />} ส่งงาน
                            </button>
                        </div>
                    )}
                    {order.assigned_staff_id && (order.status === 'assigned' || order.status === 'accepted' || order.status === 'in_progress') && (
                        <div>
                            <button className="btn btn-outline btn-sm" disabled={busy === 'resend'}
                                onClick={() => { if (confirm('ออกลิงก์ใหม่ให้พนักงาน? ลิงก์เดิมจะใช้ไม่ได้อีก')) void act('resend', { action: 'resend_link' }); }}>
                                {busy === 'resend' ? <Loader2 size={14} className="spin" /> : <Send size={14} />} ส่งลิงก์ใหม่
                            </button>
                        </div>
                    )}
                    {link && (
                        <div style={{ padding: 8, borderRadius: 8, background: 'var(--color-gray-50)', fontSize: '0.78rem', wordBreak: 'break-all' }}>
                            ลิงก์ของพนักงาน (ใช้ส่งเองได้):
                            <div className="mono" style={{ margin: '4px 0' }}>{link}</div>
                            <button className="btn btn-outline btn-sm" onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success('คัดลอกแล้ว'))}><Copy size={12} /> คัดลอก</button>
                        </div>
                    )}

                    {order.status === 'completed' && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button className="btn btn-success btn-sm" disabled={busy === 'verify'} onClick={() => void act('verify', { action: 'verify' }, 'ตรวจแล้ว ปิดงานเรียบร้อย')}>
                                {busy === 'verify' ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} ตรวจแล้ว ปิดงาน
                            </button>
                            <button className="btn btn-outline btn-sm" onClick={reopen}><RotateCcw size={14} /> ส่งกลับให้แก้ไข</button>
                        </div>
                    )}

                    <div>
                        <div className="form-label" style={{ fontWeight: 700, marginBottom: 4 }}>ประวัติ</div>
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: 'var(--color-gray-600)' }}>
                            {[...order.events].reverse().map((e, i) => (
                                <li key={i}>
                                    <span style={{ color: 'var(--color-gray-400)' }}>{fmt(e.at)}</span> · {e.by.replace(/^staff:/, 'พนักงาน ')} ·{' '}
                                    {e.type === 'created' ? 'สร้างใบงาน' : e.type === 'assigned' ? `มอบหมายให้ ${e.note}` : e.type === 'note' ? `หมายเหตุ: ${e.note}` : `${WORK_STATUS_LABELS_TH[e.status!]}${e.note ? ` — ${e.note}` : ''}`}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
            {zoom && (
                <div onClick={e => { e.stopPropagation(); setZoom(null); }} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <img src={zoom} alt="รูปงาน" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
                </div>
            )}
        </div>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function WorkOrdersPage(props: Props) {
    const { ownerUid, buildingId } = props;
    const { orders, staff, loading, error } = useWorkOrders(ownerUid, buildingId);
    const [tab, setTab] = useState<Tab>('all');
    const [search, setSearch] = useState('');
    const [creating, setCreating] = useState(false);
    const [managing, setManaging] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);

    const today = todayStr();
    const counts = {
        todo: orders.filter(TAB_FILTER.todo).length,
        review: orders.filter(TAB_FILTER.review).length,
        overdue: orders.filter(o => isOverdue(o, today)).length,
    };
    const filtered = orders.filter(o => {
        if (!TAB_FILTER[tab](o)) return false;
        if (search) {
            const q = search.toLowerCase();
            if (!`${o.area} ${o.description} ${o.assigned_staff_name ?? ''} ${WORK_TYPE_LABELS_TH[o.work_type]}`.toLowerCase().includes(q)) return false;
        }
        return true;
    });
    const open = orders.find(o => o.id === openId) ?? null;

    const tabs: { id: Tab; label: string; n?: number }[] = [
        { id: 'all', label: 'ทั้งหมด' }, { id: 'todo', label: 'ยังไม่มอบหมาย', n: counts.todo },
        { id: 'active', label: 'กำลังดำเนินการ' }, { id: 'review', label: 'รอตรวจ', n: counts.review }, { id: 'closed', label: 'ปิดแล้ว' },
    ];

    return (
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
            <div className="page-header">
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ClipboardCheck size={28} /> ใบงานช่าง/แม่บ้าน</h1>
                    <p className="page-subtitle">
                        สั่งงานผ่าน LINE ติดตามสถานะ และตรวจงานก่อนปิด
                        {counts.overdue > 0 && <span style={{ color: '#B45309', fontWeight: 700 }}> · เลยกำหนด {counts.overdue} งาน</span>}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-outline" onClick={() => setManaging(true)}><Users size={16} /> ทีมงาน ({staff.filter(s => s.active).length})</button>
                    <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> สร้างใบงาน</button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ display: 'inline-flex', background: 'var(--color-gray-100)', borderRadius: 'var(--radius-md)', padding: 3, gap: 3, flexWrap: 'wrap' }}>
                    {tabs.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)} aria-pressed={tab === t.id}
                            style={{
                                border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '0.4rem 0.8rem', fontSize: '0.8125rem', fontWeight: 600,
                                background: tab === t.id ? 'var(--color-white)' : 'transparent', color: tab === t.id ? 'var(--color-gray-800)' : 'var(--color-gray-500)',
                                boxShadow: tab === t.id ? 'var(--shadow-sm)' : 'none',
                            }}>{t.label}{t.n ? <span style={{ opacity: 0.6 }}> ({t.n})</span> : null}</button>
                    ))}
                </div>
                <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                    <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-gray-400)' }} />
                    <input className="form-input" style={{ width: '100%', paddingLeft: '2rem' }} placeholder="ค้นหา ห้อง / รายละเอียด / พนักงาน" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
            </div>

            {loading ? (
                <div style={{ padding: '3rem', textAlign: 'center' }}><Loader2 size={26} className="spin" /></div>
            ) : error ? (
                <div className="card" role="alert" style={{ padding: '2rem', textAlign: 'center', color: '#DC2626' }}>{error}</div>
            ) : filtered.length === 0 ? (
                <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-gray-500)' }}>
                    <ClipboardCheck size={36} style={{ opacity: 0.4, margin: '0 auto 0.5rem' }} />
                    <div>{orders.length === 0 ? 'ยังไม่มีใบงาน — กด "สร้างใบงาน" เพื่อสั่งงานช่างหรือแม่บ้าน' : 'ไม่พบใบงานที่ตรงกับตัวกรอง'}</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {filtered.map(o => {
                        const late = isOverdue(o, today);
                        return (
                            <button key={o.id} type="button" onClick={() => setOpenId(o.id)} className="card"
                                style={{ padding: '0.75rem 1rem', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderColor: late ? 'rgba(245,158,11,0.5)' : undefined }}>
                                <span style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, background: PRIORITY_COLOR[o.priority] }} aria-label={`ความสำคัญ ${PRIORITY_LABELS_TH[o.priority]}`} />
                                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <b>{o.area}</b>
                                        <span style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>{WORK_TYPE_LABELS_TH[o.work_type]}</span>
                                        {late && <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#B45309', display: 'inline-flex', gap: 3, alignItems: 'center' }}><AlertTriangle size={12} /> เลยกำหนด</span>}
                                    </div>
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.description}</div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--color-gray-500)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                        <span>{o.assigned_staff_name ? `ผู้รับผิดชอบ: ${o.assigned_staff_name}` : 'ยังไม่มอบหมาย'}</span>
                                        {o.due_date && <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}><Clock size={11} /> {o.due_date}</span>}
                                    </div>
                                </div>
                                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: STATUS_COLOR[o.status] }}>{WORK_STATUS_LABELS_TH[o.status]}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {creating && <CreateModal {...props} staff={staff} onClose={() => setCreating(false)} />}
            {managing && <StaffManagerModal ownerUid={ownerUid} buildingId={buildingId} staff={staff} onClose={() => setManaging(false)} />}
            {open && <DetailModal order={open} staff={staff} ownerUid={ownerUid} buildingId={buildingId} onClose={() => setOpenId(null)} />}
        </div>
    );
}
