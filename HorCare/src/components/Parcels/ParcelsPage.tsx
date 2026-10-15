import { useMemo, useRef, useState } from 'react';
import {
    Package, Plus, Search, Loader2, X, Camera, Bell, CheckCircle2, MapPin, Clock, MessageCircle, AlertTriangle, Image as ImageIcon, ScanText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { Room } from '../../types';
import { useParcels } from '../../hooks/useParcels';
import { apiPost, ApiError } from '../../utils/api';
import { compressImage } from '../../utils/imageCompress';
import {
    CARRIERS, PARCEL_STATUS_LABELS_TH, REMIND_AFTER_DAYS, matchCarrier, matchLabelRoom,
    type Parcel, type ParcelLabelOcr, type ParcelStatus,
} from '../../shared/parcels';

interface ParcelsPageProps {
    ownerUid: string;
    buildingId: string;
    rooms: Room[];
    unitName: string;
}

type Tab = 'open' | 'history' | 'all';

const STATUS_COLOR: Record<ParcelStatus, string> = {
    received: '#6B7280', tenant_notified: '#2563EB', waiting_pickup: '#D97706', picked_up: '#059669',
};

const ERRORS: Record<string, string> = {
    duplicate_tracking: 'เลขพัสดุนี้ถูกบันทึกไว้แล้วและยังไม่ได้รับ',
    room_not_found: 'ไม่พบห้องนี้',
    invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบช่องที่กรอก',
    invalid_image: 'รูปไม่ถูกต้องหรือใหญ่เกินไป',
    forbidden: 'คุณไม่มีสิทธิ์จัดการพัสดุของสถานที่นี้',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
    invalid_transition: 'เปลี่ยนสถานะนี้ไม่ได้',
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86400_000);

// ── Add-parcel modal ─────────────────────────────────────────────────────────
function AddParcelModal({ ownerUid, buildingId, rooms, unitName, onClose }: ParcelsPageProps & { onClose: () => void }) {
    const [roomId, setRoomId] = useState('');
    const [roomSearch, setRoomSearch] = useState('');
    const [carrier, setCarrier] = useState<string>(CARRIERS[0]);
    const [customCarrier, setCustomCarrier] = useState('');
    const [tracking, setTracking] = useState('');
    const [recipient, setRecipient] = useState('');
    const [storage, setStorage] = useState('');
    const [note, setNote] = useState('');
    const [image, setImage] = useState<{ base64: string; preview: string; file: File } | null>(null);
    const [ocr, setOcr] = useState<{ state: 'reading' | 'done' | 'error'; text: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const active = useMemo(
        () => rooms.filter(r => r.is_active !== false).sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })),
        [rooms],
    );
    const shown = active.filter(r => !roomSearch || r.room_number.toLowerCase().includes(roomSearch.toLowerCase()));
    const room = active.find(r => r.id === roomId);
    const finalCarrier = carrier === '__other' ? customCarrier.trim() : carrier;
    const canSubmit = !busy && !!roomId && finalCarrier.length > 0;

    const pickPhoto = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast.error('กรุณาเลือกไฟล์รูปภาพ'); return; }
        try {
            const { base64 } = await compressImage(file, 900);
            setImage({ base64, preview: `data:image/jpeg;base64,${base64}`, file });
        } catch {
            toast.error('อ่านรูปไม่ได้');
            return;
        }
        void readLabel(file);
    };

    // OCR the shipping label and fill in what is still empty. Suggestions only — staff confirm before saving.
    const readLabel = async (file: File) => {
        setOcr({ state: 'reading', text: 'กำลังอ่านใบปะหน้า…' });
        try {
            const { base64 } = await compressImage(file, 1600); // sharper than the stored photo: small print and barcodes
            const { data } = await apiPost<{ data: ParcelLabelOcr }>('parcels', {
                action: 'read_label', owner_uid: ownerUid, building_id: buildingId, image_base64: base64,
            });
            const filled: string[] = [];
            if (data.tracking_number && !tracking.trim()) { setTracking(data.tracking_number); filled.push('เลขพัสดุ'); }
            if (data.recipient_name && !recipient.trim()) { setRecipient(data.recipient_name); filled.push('ชื่อผู้รับ'); }
            if (data.carrier) {
                const known = matchCarrier(data.carrier);
                if (known) setCarrier(known);
                else { setCarrier('__other'); setCustomCarrier(data.carrier.slice(0, 40)); }
                filled.push('ขนส่ง');
            }
            let roomNote = '';
            if (data.room_number) {
                const hit = matchLabelRoom(data.room_number, active);
                if (hit && !roomId) { setRoomId(hit.id); setRoomSearch(''); filled.push(unitName); }
                if (!hit) roomNote = ` · ใบปะหน้าระบุ${unitName} "${data.room_number}" แต่ไม่พบในระบบ — กรุณาเลือกเอง`;
                else if (roomId && hit.id !== roomId) roomNote = ` · ใบปะหน้าระบุ${unitName} ${hit.room_number} ไม่ตรงกับที่เลือกไว้`;
            }
            const low = data.confidence < 0.5 ? ' (ความมั่นใจต่ำ)' : '';
            setOcr(filled.length || roomNote
                ? { state: 'done', text: `เติมจากใบปะหน้าแล้ว: ${filled.join(', ') || '—'}${low} — ตรวจสอบก่อนบันทึก${roomNote}` }
                : { state: 'error', text: 'อ่านข้อมูลจากใบปะหน้าไม่ได้ — กรอกเองได้ หรือถ่ายใหม่ให้เห็นใบปะหน้าชัดๆ' });
        } catch (e) {
            const err = e as ApiError;
            setOcr({ state: 'error', text: err.message || 'อ่านใบปะหน้าไม่สำเร็จ' });
        }
    };

    const submit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        setError(null);
        try {
            const res = await apiPost<{ notify: Record<string, string> }>('parcels', {
                action: 'create', owner_uid: ownerUid, building_id: buildingId, room_id: roomId, carrier: finalCarrier,
                tracking_number: tracking, recipient_name: recipient, storage_location: storage, note,
                image_base64: image?.base64,
            });
            const line = res.notify?.line;
            toast.success(line === 'sent' ? 'บันทึกแล้ว และแจ้งผู้เช่าทาง LINE แล้ว' : 'บันทึกพัสดุแล้ว');
            if (line === 'skipped') toast(`${unitName}นี้ยังไม่ได้เชื่อม LINE — ผู้เช่าจะเห็นในพอร์ทัลเท่านั้น`, { icon: '⚠️' });
            if (line === 'failed') toast.error('ส่ง LINE ไม่สำเร็จ — กด "แจ้งอีกครั้ง" ภายหลังได้');
            onClose();
        } catch (e) {
            const err = e as ApiError;
            setError(ERRORS[err.code] ?? err.message ?? 'บันทึกไม่สำเร็จ');
        } finally {
            setBusy(false);
        }
    };

    const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div className="modal" style={{ maxWidth: 520 }} role="dialog" aria-modal="true" aria-label="รับพัสดุใหม่">
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="modal-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Package size={20} /> รับพัสดุใหม่</span>
                    <button className="btn-icon" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>
                </div>
                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                    <div style={field}>
                        <span className="form-label">{unitName}ผู้รับ *</span>
                        <input className="form-input" placeholder={`ค้นหาเลข${unitName}`} value={roomSearch} onChange={e => setRoomSearch(e.target.value)} />
                        <div role="listbox" aria-label={`เลือก${unitName}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto', padding: 2 }}>
                            {shown.length === 0 && <span style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)' }}>ไม่พบ{unitName}</span>}
                            {shown.map(r => {
                                const on = r.id === roomId;
                                return (
                                    <button key={r.id} type="button" role="option" aria-selected={on} onClick={() => setRoomId(r.id)}
                                        style={{
                                            padding: '0.3rem 0.65rem', borderRadius: 8, cursor: 'pointer', fontSize: '0.8125rem', fontWeight: on ? 700 : 500,
                                            border: `1.5px solid ${on ? '#6366F1' : 'var(--color-gray-200)'}`,
                                            background: on ? 'rgba(99,102,241,0.1)' : 'transparent', color: 'var(--color-gray-800)',
                                            display: 'inline-flex', gap: 4, alignItems: 'center',
                                        }}>
                                        {r.room_number}{r.line_user_id && <MessageCircle size={11} color="#06C755" aria-label="เชื่อม LINE แล้ว" />}
                                    </button>
                                );
                            })}
                        </div>
                        {room && !room.line_user_id && (
                            <span style={{ fontSize: '0.75rem', color: '#B45309' }}>{unitName} {room.room_number} ยังไม่ได้เชื่อม LINE — จะแจ้งผ่านพอร์ทัลเท่านั้น</span>
                        )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem' }}>
                        <label style={field}>
                            <span className="form-label">บริษัทขนส่ง *</span>
                            <select className="form-input" value={carrier} onChange={e => setCarrier(e.target.value)}>
                                {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                                <option value="__other">อื่นๆ (ระบุเอง)</option>
                            </select>
                            {carrier === '__other' && <input className="form-input" maxLength={40} placeholder="ชื่อขนส่ง" value={customCarrier} onChange={e => setCustomCarrier(e.target.value)} />}
                        </label>
                        <label style={field}>
                            <span className="form-label">เลขพัสดุ (Tracking)</span>
                            <input className="form-input mono" maxLength={60} value={tracking} onChange={e => setTracking(e.target.value)} />
                        </label>
                        <label style={field}>
                            <span className="form-label">ชื่อผู้รับบนใบปะหน้า</span>
                            <input className="form-input" maxLength={80} value={recipient} onChange={e => setRecipient(e.target.value)} />
                        </label>
                        <label style={field}>
                            <span className="form-label">ที่เก็บพัสดุ</span>
                            <input className="form-input" maxLength={60} placeholder="เช่น ชั้นวาง A" value={storage} onChange={e => setStorage(e.target.value)} />
                        </label>
                    </div>
                    <label style={field}>
                        <span className="form-label">หมายเหตุ</span>
                        <input className="form-input" maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
                    </label>

                    <div style={field}>
                        <span className="form-label">รูปพัสดุ / ใบปะหน้า</span>
                        {image ? (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                <img src={image.preview} alt="รูปพัสดุ" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10 }} />
                                <button type="button" className="btn btn-outline btn-sm" disabled={ocr?.state === 'reading'} onClick={() => void readLabel(image.file)}>
                                    <ScanText size={14} /> อ่านใบปะหน้าอีกครั้ง
                                </button>
                                <button type="button" className="btn btn-outline btn-sm" onClick={() => { setImage(null); setOcr(null); }}>เอาออก</button>
                            </div>
                        ) : (
                            <>
                                <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => fileRef.current?.click()}>
                                    <Camera size={14} /> ถ่ายรูปใบปะหน้า / เลือกรูป
                                </button>
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>ระบบจะอ่านขนส่ง เลขพัสดุ ชื่อผู้รับ และเลข{unitName}ให้อัตโนมัติ</span>
                            </>
                        )}
                        {ocr && (
                            <span role="status" style={{
                                fontSize: '0.75rem', display: 'inline-flex', gap: 4, alignItems: 'center',
                                color: ocr.state === 'error' ? '#B45309' : ocr.state === 'done' ? '#047857' : 'var(--color-gray-500)',
                            }}>
                                {ocr.state === 'reading' && <Loader2 size={12} className="spin" />}{ocr.text}
                            </span>
                        )}
                        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                            onChange={e => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
                    </div>

                    {error && <div role="alert" style={{ color: '#DC2626', fontSize: '0.8125rem' }}>{error}</div>}
                </div>
                <div className="modal-footer">
                    <button className="btn btn-outline" onClick={onClose} disabled={busy}>ยกเลิก</button>
                    <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
                        {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} บันทึกและแจ้งผู้เช่า
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ParcelsPage(props: ParcelsPageProps) {
    const { ownerUid, buildingId, unitName } = props;
    const { parcels, loading, error } = useParcels(ownerUid, buildingId);
    const [tab, setTab] = useState<Tab>('open');
    const [search, setSearch] = useState('');
    const [adding, setAdding] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [photo, setPhoto] = useState<{ id: string; url?: string; loading: boolean } | null>(null);

    const openCount = parcels.filter(p => p.status !== 'picked_up').length;
    const overdueCount = parcels.filter(p => p.status !== 'picked_up' && daysSince(p.received_at) >= REMIND_AFTER_DAYS).length;

    const filtered = parcels.filter(p => {
        if (tab === 'open' && p.status === 'picked_up') return false;
        if (tab === 'history' && p.status !== 'picked_up') return false;
        if (search) {
            const q = search.toLowerCase();
            const hay = `${p.room_number} ${p.tenant_name ?? ''} ${p.recipient_name ?? ''} ${p.tracking_number ?? ''} ${p.carrier}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const act = async (p: Parcel, body: Record<string, unknown>, okMsg: string) => {
        setBusyId(p.id);
        try {
            await apiPost('parcels', { owner_uid: ownerUid, building_id: buildingId, parcel_id: p.id, ...body });
            toast.success(okMsg);
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ');
        } finally {
            setBusyId(null);
        }
    };

    const handOver = (p: Parcel) => {
        const who = window.prompt(`ชื่อผู้มารับพัสดุ ห้อง ${p.room_number} (เว้นว่างได้)`, p.tenant_name ?? '');
        if (who === null) return; // cancelled
        void act(p, { action: 'update_status', status: 'picked_up', picked_up_by_name: who.trim() || undefined }, 'บันทึกการส่งมอบแล้ว');
    };

    const showPhoto = async (p: Parcel) => {
        setPhoto({ id: p.id, loading: true });
        try {
            const snap = await getDoc(doc(db, `users/${ownerUid}/buildings/${buildingId}/parcel_images/${p.id}`));
            setPhoto({ id: p.id, url: snap.data()?.data_url as string | undefined, loading: false });
        } catch {
            setPhoto({ id: p.id, loading: false });
        }
    };

    const tabs: { id: Tab; label: string; count?: number }[] = [
        { id: 'open', label: 'ยังไม่ได้รับ', count: openCount },
        { id: 'history', label: 'ประวัติ' },
        { id: 'all', label: 'ทั้งหมด' },
    ];

    return (
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
            <div className="page-header">
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Package size={28} /> พัสดุ</h1>
                    <p className="page-subtitle">
                        รับพัสดุแทน{props.unitName}และแจ้งผู้เช่าอัตโนมัติ
                        {overdueCount > 0 && <span style={{ color: '#B45309', fontWeight: 700 }}> · ค้างรับเกิน {REMIND_AFTER_DAYS} วัน {overdueCount} ชิ้น</span>}
                    </p>
                </div>
                <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> รับพัสดุใหม่</button>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ display: 'inline-flex', background: 'var(--color-gray-100)', borderRadius: 'var(--radius-md)', padding: 3, gap: 3 }}>
                    {tabs.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)} aria-pressed={tab === t.id}
                            style={{
                                border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '0.4rem 0.8rem', fontSize: '0.8125rem', fontWeight: 600,
                                background: tab === t.id ? 'var(--color-white)' : 'transparent',
                                color: tab === t.id ? 'var(--color-gray-800)' : 'var(--color-gray-500)',
                                boxShadow: tab === t.id ? 'var(--shadow-sm)' : 'none',
                            }}>
                            {t.label}{t.count !== undefined && <span style={{ opacity: 0.6 }}> ({t.count})</span>}
                        </button>
                    ))}
                </div>
                <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                    <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-gray-400)' }} />
                    <input className="form-input" style={{ width: '100%', paddingLeft: '2rem' }} placeholder={`ค้นหา ${unitName} / ชื่อ / เลขพัสดุ`} value={search} onChange={e => setSearch(e.target.value)} />
                </div>
            </div>

            {loading ? (
                <div style={{ padding: '3rem', textAlign: 'center' }}><Loader2 size={26} className="spin" /></div>
            ) : error ? (
                <div className="card" role="alert" style={{ padding: '2rem', textAlign: 'center', color: '#DC2626' }}>{error}</div>
            ) : filtered.length === 0 ? (
                <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-gray-500)' }}>
                    <Package size={36} style={{ opacity: 0.4, margin: '0 auto 0.5rem' }} />
                    <div>{parcels.length === 0 ? 'ยังไม่มีพัสดุ — กด "รับพัสดุใหม่" เมื่อมีพัสดุมาถึง' : 'ไม่พบพัสดุที่ตรงกับตัวกรอง'}</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                    {filtered.map(p => {
                        const overdue = p.status !== 'picked_up' && daysSince(p.received_at) >= REMIND_AFTER_DAYS;
                        const busy = busyId === p.id;
                        const line = p.notify_channels?.line;
                        return (
                            <div key={p.id} className="card" style={{ padding: '0.875rem 1rem', display: 'flex', gap: '0.875rem', flexWrap: 'wrap', alignItems: 'flex-start', borderColor: overdue ? 'rgba(245,158,11,0.5)' : undefined }}>
                                <div style={{ width: 52, height: 52, borderRadius: 12, background: 'var(--color-gray-100)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <span style={{ fontSize: '0.62rem', color: 'var(--color-gray-400)', lineHeight: 1 }}>{unitName}</span>
                                    <span style={{ fontWeight: 800, color: 'var(--color-gray-800)' }}>{p.room_number}</span>
                                </div>
                                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <span style={{ fontWeight: 700 }}>{p.carrier}</span>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: STATUS_COLOR[p.status], display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                            {p.status === 'picked_up' ? <CheckCircle2 size={12} /> : <Clock size={12} />}{PARCEL_STATUS_LABELS_TH[p.status]}
                                        </span>
                                        {overdue && <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#B45309', display: 'inline-flex', gap: 3, alignItems: 'center' }}><AlertTriangle size={12} /> ค้าง {daysSince(p.received_at)} วัน</span>}
                                    </div>
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-600)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.875rem' }}>
                                        {p.tenant_name && <span>ผู้เช่า: {p.tenant_name}</span>}
                                        {p.recipient_name && <span>ชื่อบนพัสดุ: {p.recipient_name}</span>}
                                        {p.tracking_number && <span className="mono">{p.tracking_number}</span>}
                                        {p.storage_location && <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}><MapPin size={12} />{p.storage_location}</span>}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', marginTop: 2 }}>
                                        รับ {fmt(p.received_at)} โดย {p.received_by_name}
                                        {p.picked_up_at && <> · ส่งมอบ {fmt(p.picked_up_at)} ({p.picked_up_by_name})</>}
                                        {line && p.status !== 'picked_up' && <> · LINE: {line === 'sent' ? 'ส่งแล้ว' : line === 'skipped' ? 'ยังไม่เชื่อม' : 'ส่งไม่สำเร็จ'}</>}
                                    </div>
                                    {p.note && <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>หมายเหตุ: {p.note}</div>}
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {p.has_image && <button className="btn btn-outline btn-sm" onClick={() => void showPhoto(p)}><ImageIcon size={13} /> รูป</button>}
                                    {p.status !== 'picked_up' && (
                                        <>
                                            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void act(p, { action: 'renotify' }, 'ส่งการแจ้งเตือนอีกครั้งแล้ว')}><Bell size={13} /> แจ้งอีกครั้ง</button>
                                            {p.status !== 'waiting_pickup' && (
                                                <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void act(p, { action: 'update_status', status: 'waiting_pickup' }, 'ย้ายไป "รอรับ" แล้ว')}>รอรับ</button>
                                            )}
                                            <button className="btn btn-success btn-sm" disabled={busy} onClick={() => handOver(p)}>
                                                {busy ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />} ส่งมอบแล้ว
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {adding && <AddParcelModal {...props} onClose={() => setAdding(false)} />}

            {photo && (
                <div onClick={() => setPhoto(null)} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    {photo.loading ? <Loader2 size={30} className="spin" color="#fff" />
                        : photo.url ? <img src={photo.url} alt="รูปพัสดุ" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
                        : <span style={{ color: '#fff' }}>โหลดรูปไม่ได้</span>}
                </div>
            )}
        </div>
    );
}
