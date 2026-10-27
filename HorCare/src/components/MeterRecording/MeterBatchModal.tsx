import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    X, Upload, Loader2, CheckCircle2, AlertTriangle, Trash2, RefreshCw, ShieldCheck, Zap, Droplets, Settings2, Save,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { Room } from '../../types';
import { apiPost, ApiError } from '../../utils/api';
import { compressImage } from '../../utils/imageCompress';
import {
    DEFAULT_METER_SETTINGS, FLAG_LABELS_TH, canBulkConfirm, canConfirm, computeFlags, groupConfirmed,
    isBlocking, matchMeter, parseReading, serialsToLearn,
    type BatchItem, type MeterFlag, type MeterSettings, type MeterType, type RoomMeterContext, type RoomReadings,
} from '../../utils/meterBatch';

const MAX_BATCH_IMAGES = 100;
const CONCURRENCY = 3;
/** Same limit as the API (api/_meter-ocr.ts MAX_METERS_PER_PHOTO). */
const MAX_METERS_PER_PHOTO = 12;
/** Meter boards need more pixels per digit than a single close-up. */
const PHOTO_MAX_SIDE = 2048;

interface OcrMeter {
    room_number: string | null; serial: string | null; reading: number | null; meter_type: MeterType;
    confidence: number; note: string; box: [number, number, number, number] | null;
}
interface OcrResponse { data: { meters: OcrMeter[]; note: string } }

/** A crop of the photo around one meter (CSS only), or the whole photo when the AI gave no box. */
function cropStyle(url: string | undefined, box: BatchItem['box']): React.CSSProperties {
    if (!url) return {};
    if (!box) return { backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' };
    const [x, y, w, h] = box;
    const pos = (start: number, size: number) => (size >= 1 ? 0 : (start / (1 - size)) * 100);
    return { backgroundImage: `url(${url})`, backgroundSize: `${100 / w}% ${100 / h}%`, backgroundPosition: `${pos(x, w)}% ${pos(y, h)}%`, backgroundRepeat: 'no-repeat' };
}

export interface BatchSaveResult { bills: number; drafts: number; failed: string[] }

interface MeterBatchModalProps {
    ownerUid: string;
    buildingId: string;
    rooms: Room[];
    monthLabel: string;
    getContext: (roomId: string, type: 'electric' | 'water') => RoomMeterContext | undefined;
    /** Persist confirmed readings. Only ever called with human-confirmed values. */
    onSave: (readings: RoomReadings[], meta: { overriddenCount: number }) => Promise<BatchSaveResult>;
    onClose: () => void;
}

const STATUS_META: Record<BatchItem['status'], { label: string; color: string }> = {
    processing: { label: 'กำลังประมวลผล', color: '#557089' },
    review_required: { label: 'รอตรวจสอบ', color: '#E8740C' },
    confirmed: { label: 'ยืนยันแล้ว', color: '#0A6CC2' },
    saved: { label: 'บันทึกแล้ว', color: '#15803D' },
    error: { label: 'ผิดพลาด', color: '#DC2626' },
};

const ERROR_TEXT: Record<string, string> = {
    feature_locked: 'ฟีเจอร์นี้สำหรับแพ็กเกจ Plus และ Pro เท่านั้น',
    forbidden: 'คุณไม่มีสิทธิ์บันทึกมิเตอร์ของสถานที่นี้',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
};

let seq = 0;

export default function MeterBatchModal({ ownerUid, buildingId, rooms, monthLabel, getContext, onSave, onClose }: MeterBatchModalProps) {
    const [items, setItems] = useState<BatchItem[]>([]);
    const [settings, setSettings] = useState<MeterSettings>(DEFAULT_METER_SETTINGS);
    const [showSettings, setShowSettings] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [zoom, setZoom] = useState<string | null>(null);
    // Save readings with no flag at all straight away; anything flagged waits for a person.
    const [autoSave, setAutoSave] = useState(true);
    const autoDone = useRef(new Set<string>());
    const autoSavePending = useRef(false);

    const files = useRef(new Map<string, File>());
    const previews = useRef(new Map<string, string>());
    const queue = useRef<string[]>([]);
    const running = useRef(0);
    const alive = useRef(true);

    const activeRooms = useMemo(
        () => rooms.filter(r => r.is_active !== false).sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })),
        [rooms],
    );

    useEffect(() => {
        const p = previews.current;
        alive.current = true;
        return () => { alive.current = false; p.forEach(url => URL.revokeObjectURL(url)); p.clear(); };
    }, []);

    const patch = useCallback((id: string, changes: Partial<BatchItem>) => {
        setItems(prev => prev.map(i => (i.id === id ? { ...i, ...changes } : i)));
    }, []);

    // ── OCR queue (3 at a time) ──────────────────────────────────────────────
    const pump = useCallback(() => {
        while (running.current < CONCURRENCY && queue.current.length > 0) {
            const id = queue.current.shift()!;
            const file = files.current.get(id);
            if (!file) continue;
            running.current++;
            void (async () => {
                try {
                    const { base64, mimeType } = await compressImage(file, PHOTO_MAX_SIDE);
                    const { data } = await apiPost<OcrResponse>('meter-ocr', {
                        owner_uid: ownerUid, building_id: buildingId, imageBase64: base64, mimeType, multi: true,
                    });
                    if (!alive.current) return;
                    if (data.meters.length === 0) {
                        patch(id, { status: 'error', error: data.note || 'ไม่พบมิเตอร์ในรูปนี้' });
                        return;
                    }
                    // one photo → one item per meter on it
                    setItems(prev => prev.flatMap(i => {
                        if (i.id !== id) return [i];
                        return data.meters.map((mt, k): BatchItem => {
                            const m = matchMeter(rooms, mt.room_number, mt.serial, mt.meter_type);
                            return {
                                id: `${id}-${k + 1}`, photoId: id,
                                fileName: data.meters.length > 1 ? `${i.fileName} · ตัวที่ ${k + 1}/${data.meters.length}` : i.fileName,
                                previewUrl: i.previewUrl, status: 'review_required', ocrRoom: mt.room_number, serial: mt.serial, box: mt.box,
                                roomId: m.kind === 'matched' ? m.roomId : null, matchedBy: m.kind === 'matched' ? m.by : undefined,
                                meterType: mt.meter_type, reading: mt.reading === null ? '' : String(mt.reading), confidence: mt.confidence,
                                note: [mt.note, k === 0 ? data.note : ''].filter(Boolean).join(' · ') || undefined,
                            };
                        });
                    }));
                } catch (e) {
                    if (!alive.current) return;
                    const err = e as ApiError;
                    patch(id, { status: 'error', error: ERROR_TEXT[err.code] ?? err.message ?? 'อ่านรูปไม่สำเร็จ' });
                } finally {
                    running.current--;
                    if (alive.current) pump();
                }
            })();
        }
    }, [ownerUid, buildingId, rooms, patch]);

    const addFiles = (list: FileList | null) => {
        if (!list) return;
        const images = [...list].filter(f => f.type.startsWith('image/'));
        const skippedType = list.length - images.length;
        const room = MAX_BATCH_IMAGES - new Set(items.map(i => i.photoId ?? i.id)).size;
        const accepted = images.slice(0, Math.max(0, room));
        if (skippedType > 0) toast.error(`ข้าม ${skippedType} ไฟล์ที่ไม่ใช่รูปภาพ`);
        if (images.length > accepted.length) toast.error(`รับได้สูงสุด ${MAX_BATCH_IMAGES} รูปต่อชุด — ข้าม ${images.length - accepted.length} รูป`);
        if (accepted.length === 0) return;

        const fresh: BatchItem[] = accepted.map(f => {
            const id = `m${++seq}`;
            files.current.set(id, f);
            const previewUrl = URL.createObjectURL(f);
            previews.current.set(id, previewUrl);
            queue.current.push(id);
            return { id, fileName: f.name, previewUrl, status: 'processing', ocrRoom: null, roomId: null, meterType: 'unknown', reading: '', confidence: 0 };
        });
        setItems(prev => [...prev, ...fresh]);
        pump();
    };

    const retry = (id: string) => {
        patch(id, { status: 'processing', error: undefined });
        queue.current.push(id);
        pump();
    };

    const remove = (id: string) => {
        // several meters can share a photo: free it only when its last meter goes
        const photo = items.find(i => i.id === id)?.photoId ?? id;
        if (!items.some(i => i.id !== id && (i.photoId ?? i.id) === photo)) {
            files.current.delete(photo);
            const url = previews.current.get(photo);
            if (url) URL.revokeObjectURL(url);
            previews.current.delete(photo);
            queue.current = queue.current.filter(q => q !== photo);
        }
        setItems(prev => prev.filter(i => i.id !== id));
        setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    };

    // Editing anything on a confirmed item sends it back for review — a confirmation
    // always refers to exactly the values the person saw.
    const edit = (id: string, changes: Partial<BatchItem>) => {
        const cur = items.find(i => i.id === id);
        patch(id, {
            ...changes,
            ...('roomId' in changes ? { matchedBy: undefined } : {}), // a person chose the room
            ...(cur?.status === 'confirmed' ? { status: 'review_required' as const, overridden: false } : {}),
        });
    };

    // ── Validation ───────────────────────────────────────────────────────────
    const flags = useMemo(() => computeFlags(items, rooms, getContext, settings), [items, rooms, getContext, settings]);

    const confirmItem = (id: string) => {
        const f = flags[id] ?? [];
        if (!canConfirm(f)) return;
        patch(id, { status: 'confirmed', overridden: f.length > 0 });
    };

    const bulkConfirmable = items.filter(i => i.status === 'review_required' && canBulkConfirm(flags[i.id] ?? []));
    const confirmClean = () => {
        const ids = new Set(bulkConfirmable.map(i => i.id));
        setItems(prev => prev.map(i => (ids.has(i.id) ? { ...i, status: 'confirmed', overridden: false } : i)));
        toast.success(`ยืนยัน ${ids.size} รายการที่ผ่านเกณฑ์`);
    };
    const confirmSelected = () => {
        // Selection never bypasses a flag: warnings still need an individual look.
        const ids = new Set([...selected].filter(id => {
            const it = items.find(i => i.id === id);
            return it?.status === 'review_required' && canBulkConfirm(flags[id] ?? []);
        }));
        const skipped = selected.size - ids.size;
        setItems(prev => prev.map(i => (ids.has(i.id) ? { ...i, status: 'confirmed', overridden: false } : i)));
        setSelected(new Set());
        if (skipped > 0) toast(`ข้าม ${skipped} รายการที่มีคำเตือน — ตรวจแล้วกดยืนยันทีละรายการ`, { icon: '⚠️' });
    };

    // ── Save ─────────────────────────────────────────────────────────────────
    const toSave = groupConfirmed(items);
    const confirmedItems = items.filter(i => i.status === 'confirmed');
    const save = async (auto = false) => {
        if (toSave.length === 0) return;
        setSaving(true);
        try {
            const overriddenCount = confirmedItems.filter(i => i.overridden).length;
            const r = await onSave(toSave, { overriddenCount });
            const failed = new Set(r.failed);
            const isSaved = (i: BatchItem) => i.status === 'confirmed' && !(i.roomId && failed.has(i.roomId));
            const after = items.map(i => (isSaved(i) ? { ...i, status: 'saved' as const } : i));
            setItems(prev => prev.map(i => (isSaved(i) ? { ...i, status: 'saved' } : i)));
            // remember each meter's serial on its room, so next month it is matched even without a readable label
            const learn = serialsToLearn(after, rooms);
            await Promise.all(learn.map(l => updateDoc(doc(db, `users/${ownerUid}/buildings/${buildingId}/rooms/${l.roomId}`), { [l.field]: l.serial || null })
                .catch(() => undefined)));
            const parts = [r.bills > 0 && `บันทึกบิล ${r.bills} ห้อง`, r.drafts > 0 && `เก็บเป็นร่าง ${r.drafts} ห้อง (รอค่าอีกชนิด)`].filter(Boolean);
            toast.success(`${auto ? 'บันทึกอัตโนมัติ: ' : ''}${parts.join(' · ') || 'บันทึกแล้ว'}`);
            if (r.failed.length > 0) toast.error(`บันทึกไม่สำเร็จ ${r.failed.length} ห้อง`);
        } catch {
            toast.error('บันทึกไม่สำเร็จ กรุณาลองใหม่');
        } finally {
            setSaving(false);
        }
    };

    // ── Auto-save: once every photo is read (duplicates need the whole batch), confirm and save the clean ones ──
    const processingCount = items.filter(i => i.status === 'processing').length;
    useEffect(() => {
        if (!autoSave || saving || processingCount > 0) return;
        const clean = items.filter(i => i.status === 'review_required' && !autoDone.current.has(i.id) && canBulkConfirm(flags[i.id] ?? []));
        if (clean.length === 0) return;
        const ids = new Set(clean.map(i => i.id));
        ids.forEach(id => autoDone.current.add(id));
        autoSavePending.current = true;
        setItems(prev => prev.map(i => (ids.has(i.id) ? { ...i, status: 'confirmed', overridden: false } : i)));
    }, [autoSave, saving, processingCount, items, flags]);
    useEffect(() => {
        if (!autoSavePending.current || saving || toSave.length === 0) return;
        autoSavePending.current = false;
        void save(true);
    });

    const close = () => {
        const pending = items.some(i => i.status === 'review_required' || i.status === 'confirmed' || i.status === 'processing');
        if (pending && !window.confirm('ยังมีรายการที่ยังไม่ได้บันทึก ปิดแล้วจะสูญหาย — ปิดเลย?')) return;
        onClose();
    };

    const zoomItem = zoom ? items.find(i => i.id === zoom) : undefined;
    const zoomUrl = zoomItem?.previewUrl;

    const counts = {
        processing: items.filter(i => i.status === 'processing').length,
        review: items.filter(i => i.status === 'review_required').length,
        confirmed: confirmedItems.length,
        saved: items.filter(i => i.status === 'saved').length,
    };

    const chip = (f: MeterFlag) => (
        <span key={f} style={{
            fontSize: '0.7rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: 6,
            background: isBlocking(f) ? 'rgba(220,38,38,0.12)' : 'rgba(245, 158, 46,0.15)',
            color: isBlocking(f) ? '#B91C1C' : '#C2410C',
        }}>{FLAG_LABELS_TH[f]}</span>
    );

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) close(); }}>
            <div className="modal" style={{ maxWidth: 980, width: '100%' }} role="dialog" aria-modal="true" aria-label="อ่านมิเตอร์ด้วย AI เป็นชุด">
                <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    <div>
                        <div className="modal-title" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <Zap size={20} /> อ่านมิเตอร์ด้วย AI เป็นชุด
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)', marginTop: 2 }}>
                            รอบ {monthLabel} · {autoSave
                                ? 'ค่าที่ไม่มีปัญหาเลยบันทึกอัตโนมัติ — ที่มีธงเตือนรอคุณตรวจ'
                                : 'AI เป็นเพียงผู้เสนอค่า — ไม่มีอะไรถูกบันทึกจนกว่าคุณจะยืนยัน'}
                        </div>
                    </div>
                    <button className="btn-icon" onClick={close} aria-label="ปิด"><X size={18} /></button>
                </div>

                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <label
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                        style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '1.25rem',
                            border: '2px dashed var(--color-gray-300)', borderRadius: 14, cursor: 'pointer', textAlign: 'center',
                        }}
                    >
                        <Upload size={26} />
                        <span style={{ fontWeight: 700 }}>เลือกหรือลากรูปมิเตอร์มาวาง</span>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)' }}>
                            ไฟและน้ำปนกันได้ · ถ่ายทั้งแผงในรูปเดียวได้ สูงสุด {MAX_METERS_PER_PHOTO} มิเตอร์ต่อรูป · สูงสุด {MAX_BATCH_IMAGES} รูปต่อชุด ({new Set(items.map(i => i.photoId ?? i.id)).size}/{MAX_BATCH_IMAGES})
                        </span>
                        <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                            onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
                    </label>

                    {items.length > 0 && (
                        <>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', fontSize: '0.8125rem' }}>
                                <span>กำลังประมวลผล <b>{counts.processing}</b></span>·
                                <span>รอตรวจ <b>{counts.review}</b></span>·
                                <span>ยืนยันแล้ว <b>{counts.confirmed}</b></span>·
                                <span>บันทึกแล้ว <b>{counts.saved}</b></span>
                                <label style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                    <input type="checkbox" checked={autoSave} onChange={e => setAutoSave(e.target.checked)} /> บันทึกอัตโนมัติเมื่อไม่มีปัญหา
                                </label>
                                <button className="btn btn-outline btn-sm" onClick={() => setShowSettings(s => !s)}>
                                    <Settings2 size={14} /> เกณฑ์ตรวจสอบ
                                </button>
                            </div>

                            {showSettings && (
                                <div className="card" style={{ padding: '0.75rem 1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem' }}>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        <span className="form-label">ความมั่นใจขั้นต่ำของ AI (%)</span>
                                        <input className="form-input mono" inputMode="numeric" value={Math.round(settings.minConfidence * 100)}
                                            onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) setSettings(s => ({ ...s, minConfidence: Math.min(100, Math.max(0, n)) / 100 })); }} />
                                    </label>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        <span className="form-label">เตือนเมื่อใช้เกินกี่เท่าของเดือนก่อน</span>
                                        <input className="form-input mono" inputMode="decimal" value={settings.jumpRatio}
                                            onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) setSettings(s => ({ ...s, jumpRatio: n })); }} />
                                    </label>
                                </div>
                            )}

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <button className="btn btn-success btn-sm" disabled={bulkConfirmable.length === 0} onClick={confirmClean}>
                                    <ShieldCheck size={14} /> ยืนยันที่ผ่านเกณฑ์ทั้งหมด ({bulkConfirmable.length})
                                </button>
                                <button className="btn btn-outline btn-sm" disabled={selected.size === 0} onClick={confirmSelected}>
                                    ยืนยันที่เลือก ({selected.size})
                                </button>
                                <button className="btn btn-primary btn-sm" disabled={toSave.length === 0 || saving} onClick={() => void save(false)} style={{ marginLeft: 'auto' }}>
                                    {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} บันทึกลงมิเตอร์ ({toSave.length} ห้อง)
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {items.map(item => {
                                    const f = flags[item.id] ?? [];
                                    const st = STATUS_META[item.status];
                                    const locked = item.status === 'saved';
                                    const ctx = item.roomId && item.meterType !== 'unknown' ? getContext(item.roomId, item.meterType) : undefined;
                                    const reading = parseReading(item.reading);
                                    const units = ctx && reading !== null && reading >= ctx.previous ? reading - ctx.previous : null;
                                    return (
                                        <div key={item.id} className="card" style={{ padding: '0.625rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                            {item.status === 'review_required' && canBulkConfirm(f) && (
                                                <input type="checkbox" aria-label="เลือก" checked={selected.has(item.id)}
                                                    onChange={e => setSelected(prev => { const n = new Set(prev); if (e.target.checked) n.add(item.id); else n.delete(item.id); return n; })} />
                                            )}
                                            <button type="button" onClick={() => setZoom(item.id)} aria-label="ขยายรูป" style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}>
                                                <div role="img" aria-label={item.fileName}
                                                    style={{ width: 88, height: 88, borderRadius: 10, display: 'block', backgroundColor: 'var(--color-gray-100)', ...cropStyle(item.previewUrl, item.box) }} />
                                            </button>

                                            <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                    <span style={{ fontWeight: 700, fontSize: '0.8125rem', color: st.color, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                                        {item.status === 'processing' && <Loader2 size={13} className="spin" />}
                                                        {item.status === 'saved' && <CheckCircle2 size={13} />}
                                                        {st.label}
                                                    </span>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{item.fileName}</span>
                                                    {item.status !== 'processing' && item.status !== 'error' && (
                                                        <span style={{ fontSize: '0.75rem', color: item.confidence < settings.minConfidence ? '#C2410C' : 'var(--color-gray-500)' }}>
                                                            AI มั่นใจ {Math.round(item.confidence * 100)}%
                                                        </span>
                                                    )}
                                                </div>

                                                {item.status === 'error' && (
                                                    <div role="alert" style={{ color: '#DC2626', fontSize: '0.8125rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                                                        <AlertTriangle size={14} /> {item.error}
                                                    </div>
                                                )}

                                                {item.status !== 'processing' && item.status !== 'error' && (
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem' }}>
                                                        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                            <span className="form-label">
                                                                ห้อง{item.ocrRoom ? ` (ป้าย "${item.ocrRoom}")` : ''}
                                                                {item.matchedBy === 'serial' ? ' · จับคู่จากเลขซีเรียล' : ''}
                                                            </span>
                                                            <select className="form-input" disabled={locked} value={item.roomId ?? ''}
                                                                onChange={e => edit(item.id, { roomId: e.target.value || null })}>
                                                                <option value="">— เลือกห้อง —</option>
                                                                {activeRooms.map(r => <option key={r.id} value={r.id}>{r.room_number}</option>)}
                                                            </select>
                                                        </label>
                                                        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                            <span className="form-label">ชนิด</span>
                                                            <select className="form-input" disabled={locked} value={item.meterType}
                                                                onChange={e => edit(item.id, { meterType: e.target.value as MeterType })}>
                                                                <option value="unknown">ไม่ทราบ</option>
                                                                <option value="electric">มิเตอร์ไฟ</option>
                                                                <option value="water">มิเตอร์น้ำ</option>
                                                            </select>
                                                        </label>
                                                        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                            <span className="form-label" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                                {item.meterType === 'water' ? <Droplets size={12} /> : <Zap size={12} />} ค่ามิเตอร์
                                                            </span>
                                                            <input className="form-input mono" inputMode="numeric" disabled={locked} value={item.reading}
                                                                onChange={e => { if (/^\d*$/.test(e.target.value)) edit(item.id, { reading: e.target.value }); }} />
                                                        </label>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-600)', alignSelf: 'end' }}>
                                                            {ctx ? <>เดือนก่อน <b className="mono">{ctx.previous.toLocaleString()}</b>{units !== null && <> · ใช้ <b className="mono">{units.toLocaleString()}</b> หน่วย</>}</> : null}
                                                        </div>
                                                    </div>
                                                )}

                                                {f.length > 0 && !locked && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{f.map(chip)}</div>}
                                                {item.serial && <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>เลขซีเรียล <span className="mono">{item.serial}</span></div>}
                                                {item.note && <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>AI: {item.note}</div>}
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
                                                {item.status === 'review_required' && (
                                                    <button className="btn btn-sm btn-primary" disabled={!canConfirm(f)} onClick={() => confirmItem(item.id)}
                                                        title={!canConfirm(f) ? 'แก้ปัญหาสีแดงก่อนจึงจะยืนยันได้' : undefined}>
                                                        {f.length > 0 ? 'ตรวจแล้ว ยืนยัน' : 'ยืนยัน'}
                                                    </button>
                                                )}
                                                {item.status === 'confirmed' && (
                                                    <button className="btn btn-sm btn-outline" onClick={() => patch(item.id, { status: 'review_required', overridden: false })}>ยกเลิกยืนยัน</button>
                                                )}
                                                {item.status === 'error' && (
                                                    <button className="btn btn-sm btn-outline" onClick={() => retry(item.id)}><RefreshCw size={13} /> ลองใหม่</button>
                                                )}
                                                {!locked && (
                                                    <button className="btn btn-sm btn-outline" onClick={() => remove(item.id)} aria-label="ลบรูปนี้"><Trash2 size={13} /></button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {zoomUrl && (
                <div onClick={e => { e.stopPropagation(); setZoom(null); }}
                    style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%' }}>
                        <img src={zoomUrl} alt="รูปมิเตอร์ต้นฉบับ" style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 12, display: 'block' }} />
                        {zoomItem?.box && (
                            // the meter this row is about, on the full photo
                            <div style={{
                                position: 'absolute', border: '3px solid #F59E2E', borderRadius: 6, boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                                left: `${zoomItem.box[0] * 100}%`, top: `${zoomItem.box[1] * 100}%`, width: `${zoomItem.box[2] * 100}%`, height: `${zoomItem.box[3] * 100}%`,
                            }} />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
