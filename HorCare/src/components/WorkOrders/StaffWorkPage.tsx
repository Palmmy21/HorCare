import { useCallback, useEffect, useRef, useState } from 'react';
import { Wrench, MapPin, Calendar, Loader2, Camera, CheckCircle2, AlertTriangle, PlayCircle, ThumbsUp } from 'lucide-react';
import { compressImage } from '../../utils/imageCompress';
import {
    PRIORITY_LABELS_TH, WORK_STATUS_LABELS_TH, WORK_TYPE_LABELS_TH, type Priority, type StaffWorkView,
} from '../../shared/workOrders';

/**
 * Mobile page a technician / housekeeper opens from the LINE job card (/?w=<link>).
 * No HorCare account: the link itself identifies the job and the person. Every request
 * is re-checked server-side by /api/work-orders.
 */

interface WorkImage { id: string; kind: string; data_url: string }
interface PendingPhoto { kind: 'before' | 'after'; base64: string }

const PRIORITY_COLOR: Record<Priority, string> = { low: '#64748B', normal: '#0284C7', high: '#D97706', urgent: '#DC2626' };

async function call<T>(link: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: T & { error?: string; message?: string } }> {
    const res = await fetch('/api/work-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link, ...body }),
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

export default function StaffWorkPage() {
    const link = new URLSearchParams(window.location.search).get('w') ?? '';
    const [job, setJob] = useState<StaffWorkView | null>(null);
    const [images, setImages] = useState<WorkImage[]>([]);
    const [state, setState] = useState<'loading' | 'ready' | 'gone'>(link ? 'loading' : 'gone');
    const [note, setNote] = useState('');
    const [photos, setPhotos] = useState<PendingPhoto[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [zoom, setZoom] = useState<string | null>(null);
    const beforeRef = useRef<HTMLInputElement>(null);
    const afterRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        const v = await call<{ work_order: StaffWorkView }>(link, { action: 'staff_view' });
        if (!v.ok) { setState('gone'); return; }
        setJob(v.data.work_order);
        setState('ready');
        const im = await call<{ images: WorkImage[] }>(link, { action: 'staff_images' });
        if (im.ok) setImages(im.data.images ?? []);
    }, [link]);

    useEffect(() => { if (link) void load(); }, [link, load]);

    const addPhoto = async (kind: 'before' | 'after', files: FileList | null) => {
        if (!files) return;
        for (const f of [...files]) {
            try { const { base64 } = await compressImage(f, 900); setPhotos(p => [...p, { kind, base64 }]); }
            catch { setError('อ่านรูปไม่ได้ กรุณาลองใหม่'); }
        }
    };

    const send = async (status?: 'accepted' | 'in_progress' | 'completed') => {
        setBusy(true);
        setError(null);
        const r = await call(link, {
            action: 'staff_update', status, note: note.trim() || undefined, images: photos,
        });
        setBusy(false);
        if (!r.ok) {
            setError(r.data.message ?? (r.status === 404 ? 'ลิงก์นี้ใช้ไม่ได้แล้ว' : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'));
            if (r.status === 404) setState('gone');
            return;
        }
        setNote('');
        setPhotos([]);
        await load();
    };

    const page: React.CSSProperties = { minHeight: '100dvh', background: '#F1F5F9', padding: '1rem', fontFamily: 'var(--font-sans)' };
    const card: React.CSSProperties = { maxWidth: 520, margin: '0 auto', background: '#fff', borderRadius: 18, padding: '1.25rem', boxShadow: '0 4px 20px rgba(15,23,42,0.08)' };

    if (state === 'loading') {
        return <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader2 size={32} className="spin" /></div>;
    }
    if (state === 'gone' || !job) {
        return (
            <div style={page}>
                <div style={{ ...card, textAlign: 'center' }}>
                    <AlertTriangle size={36} color="#D97706" />
                    <h2 style={{ margin: '0.5rem 0', fontSize: '1.15rem' }}>เปิดงานนี้ไม่ได้</h2>
                    <p style={{ color: '#64748B', fontSize: '0.9rem', margin: 0 }}>ลิงก์อาจหมดอายุ งานถูกปิดแล้ว หรือถูกมอบหมายให้คนอื่น กรุณาติดต่อผู้จัดการ</p>
                </div>
            </div>
        );
    }

    const editable = job.status === 'assigned' || job.status === 'accepted' || job.status === 'in_progress';
    const photoBtn = (kind: 'before' | 'after', ref: React.RefObject<HTMLInputElement | null>, label: string) => (
        <>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => ref.current?.click()}><Camera size={14} /> {label}</button>
            <input ref={ref} type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }}
                onChange={e => { void addPhoto(kind, e.target.files); e.target.value = ''; }} />
        </>
    );

    return (
        <div style={page}>
            <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#0369A1', fontWeight: 700, fontSize: '0.85rem' }}>
                    <Wrench size={16} /> {job.dorm_name || 'HorCare'} · สวัสดีคุณ {job.staff_name}
                </div>
                <h1 style={{ margin: '0.5rem 0 0.25rem', fontSize: '1.35rem', color: '#0F172A' }}>{job.area}</h1>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem 0.875rem', fontSize: '0.85rem', color: '#475569' }}>
                    <span>{WORK_TYPE_LABELS_TH[job.work_type]}</span>
                    <span style={{ color: PRIORITY_COLOR[job.priority], fontWeight: 700 }}>ความสำคัญ: {PRIORITY_LABELS_TH[job.priority]}</span>
                    {job.due_date && <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Calendar size={13} /> เสร็จภายใน {job.due_date}</span>}
                </div>
                <div style={{ marginTop: 10, display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 999, background: '#E0F2FE', color: '#0369A1', fontWeight: 700, fontSize: '0.8rem' }}>
                    {WORK_STATUS_LABELS_TH[job.status]}
                </div>

                <p style={{ whiteSpace: 'pre-wrap', color: '#1E293B', margin: '1rem 0' }}>{job.description}</p>
                {job.reopen_note && job.status !== 'completed' && (
                    <div style={{ padding: 10, borderRadius: 10, background: '#FEF3C7', color: '#92400E', fontSize: '0.85rem', marginBottom: 12 }}>
                        ผู้จัดการส่งกลับให้แก้ไข: {job.reopen_note}
                    </div>
                )}

                {images.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                        {images.map(i => (
                            <button key={i.id} type="button" onClick={() => setZoom(i.data_url)} style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}>
                                <img src={i.data_url} alt={i.kind} style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
                            </button>
                        ))}
                    </div>
                )}

                {editable ? (
                    <>
                        <label style={{ display: 'block', fontWeight: 700, fontSize: '0.85rem', marginBottom: 4 }}>หมายเหตุ</label>
                        <textarea className="form-input" rows={2} maxLength={500} style={{ width: '100%' }} value={note}
                            onChange={e => setNote(e.target.value)} placeholder="เช่น สั่งอะไหล่แล้ว / ซ่อมเสร็จแล้ว" />

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
                            {photoBtn('before', beforeRef, 'รูปก่อนทำ')}
                            {photoBtn('after', afterRef, 'รูปหลังทำ')}
                        </div>
                        {photos.length > 0 && (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                                {photos.map((p, i) => (
                                    <div key={i} style={{ position: 'relative', textAlign: 'center' }}>
                                        <img src={`data:image/jpeg;base64,${p.base64}`} alt={p.kind} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                                        <span style={{ fontSize: '0.65rem', color: '#64748B' }}>{p.kind === 'before' ? 'ก่อน' : 'หลัง'}</span>
                                        <button type="button" aria-label="เอารูปออก" onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                                            style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#DC2626', color: '#fff', cursor: 'pointer', lineHeight: 1 }}>×</button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {error && <div role="alert" style={{ color: '#DC2626', fontSize: '0.85rem', marginBottom: 8 }}>{error}</div>}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {job.status === 'assigned' && (
                                <button className="btn btn-primary" disabled={busy} onClick={() => void send('accepted')}>
                                    {busy ? <Loader2 size={16} className="spin" /> : <ThumbsUp size={16} />} รับงาน
                                </button>
                            )}
                            {job.status === 'accepted' && (
                                <button className="btn btn-primary" disabled={busy} onClick={() => void send('in_progress')}>
                                    {busy ? <Loader2 size={16} className="spin" /> : <PlayCircle size={16} />} เริ่มงาน
                                </button>
                            )}
                            {job.status === 'in_progress' && (
                                <button className="btn btn-success" disabled={busy} onClick={() => void send('completed')}>
                                    {busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} งานเสร็จแล้ว
                                </button>
                            )}
                            {(note.trim() || photos.length > 0) && job.status !== 'assigned' && (
                                <button className="btn btn-outline" disabled={busy} onClick={() => void send()}>บันทึกหมายเหตุ/รูป (ยังไม่เสร็จงาน)</button>
                            )}
                        </div>
                    </>
                ) : (
                    <div style={{ padding: 12, borderRadius: 10, background: '#ECFDF5', color: '#065F46', fontSize: '0.9rem' }}>
                        ส่งงานแล้ว รอผู้จัดการตรวจสอบ ขอบคุณค่ะ 🙏
                        {job.completion_note && <div style={{ marginTop: 6, color: '#047857' }}>หมายเหตุของคุณ: {job.completion_note}</div>}
                    </div>
                )}
            </div>

            {zoom && (
                <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <img src={zoom} alt="รูปงาน" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
                </div>
            )}
            <div style={{ textAlign: 'center', marginTop: 12, color: '#94A3B8', fontSize: '0.7rem' }}><MapPin size={11} style={{ verticalAlign: -1 }} /> HorCare Maintenance</div>
        </div>
    );
}
