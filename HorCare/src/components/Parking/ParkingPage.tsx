import { useEffect, useMemo, useState } from 'react';
import { Car, Bike, ParkingSquare, Plus, Pencil, Trash2, X } from 'lucide-react';
import { collection, doc, onSnapshot, writeBatch } from 'firebase/firestore';
import { toast } from 'react-hot-toast';
import { db } from '../../firebase/config';
import { logActivity } from '../../utils/auditLog';
import { formatCurrency } from '../../utils/calculations';
import { affectedRooms, cleanPlate, PARKING_KIND_LABELS, parkingSummary, roomParkingFor, spotCodes } from '../../shared/parking';
import type { ParkingKind, ParkingSpot, Room } from '../../types';

interface ParkingPageProps {
    uid: string;
    buildingId: string;
    rooms: Room[];
    /** false = read-only (staff without room.update) */
    canEdit: boolean;
}

type Filter = 'all' | 'vacant' | 'rented';

const KindIcon = ({ kind, size = 16 }: { kind: ParkingKind; size?: number }) =>
    kind === 'motorcycle' ? <Bike size={size} aria-hidden /> : kind === 'car' ? <Car size={size} aria-hidden /> : <ParkingSquare size={size} aria-hidden />;

/** ที่จอดรถ: the property's parking spaces, who rents each one, and the fee that goes on that room's bill. */
export default function ParkingPage({ uid, buildingId, rooms, canEdit }: ParkingPageProps) {
    const base = `users/${uid}/buildings/${buildingId}`;
    const [spots, setSpots] = useState<ParkingSpot[] | null>(null);
    const [filter, setFilter] = useState<Filter>('all');
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<ParkingSpot | null>(null);

    useEffect(() => {
        return onSnapshot(collection(db, `${base}/parking_spots`), snap => {
            setSpots(snap.docs.map(d => d.data() as ParkingSpot).sort((a, b) => a.code.localeCompare(b.code, 'th', { numeric: true })));
        }, () => setSpots([]));
    }, [base]);

    const summary = useMemo(() => parkingSummary(spots ?? []), [spots]);
    const shown = (spots ?? []).filter(s => filter === 'all' || (filter === 'vacant' ? !s.room_id : !!s.room_id));
    const activeRooms = useMemo(() => rooms.filter(r => r.is_active !== false).sort((a, b) => a.room_number.localeCompare(b.room_number, 'th', { numeric: true })), [rooms]);

    /** Write spots and re-derive the parking copy of every room they touch, in one batch. */
    const commit = async (changes: { before: ParkingSpot | null; after: ParkingSpot | null }[]) => {
        const all = new Map((spots ?? []).map(s => [s.id, s]));
        const batch = writeBatch(db);
        const touched = new Set<string>();
        for (const { before, after } of changes) {
            if (after) { batch.set(doc(db, `${base}/parking_spots/${after.id}`), after); all.set(after.id, after); }
            else if (before) { batch.delete(doc(db, `${base}/parking_spots/${before.id}`)); all.delete(before.id); }
            affectedRooms(before, after).forEach(r => touched.add(r));
        }
        const list = [...all.values()];
        for (const roomId of touched) {
            if (rooms.some(r => r.id === roomId)) batch.update(doc(db, `${base}/rooms/${roomId}`), { parking: roomParkingFor(list, roomId) });
        }
        await batch.commit();
    };

    const remove = async (s: ParkingSpot) => {
        if (!window.confirm(`ลบช่องจอด ${s.code}?${s.room_number ? ` (ห้อง ${s.room_number} จะไม่ถูกเก็บค่าที่จอดนี้แล้ว)` : ''}`)) return;
        try {
            await commit([{ before: s, after: null }]);
            logActivity({ action: 'DELETE', resourceType: 'parking_spot', resourceId: s.id, resourceLabel: s.code, propertyId: buildingId });
            toast.success(`ลบ ${s.code} แล้ว`);
        } catch (err) {
            toast.error(`ลบไม่สำเร็จ: ${(err as Error).message}`);
        }
    };

    return (
        <div className="pk-page">
            <div className="page-header">
                <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Car size={28} /> ที่จอดรถ</h1>
                <p className="page-subtitle">กำหนดช่องจอด ผูกกับห้อง แล้วค่าที่จอดจะเข้าบิลของห้องนั้นทุกเดือนเมื่อจดมิเตอร์</p>
            </div>

            <dl className="pk-stats">
                <div className="card pk-stat"><dt className="stat-label">ช่องจอดทั้งหมด</dt><dd className="stat-value">{summary.total}</dd></div>
                <div className="card pk-stat"><dt className="stat-label">มีผู้เช่า</dt><dd className="stat-value">{summary.rented}</dd></div>
                <div className="card pk-stat"><dt className="stat-label">ว่าง</dt><dd className="stat-value">{summary.vacant}</dd></div>
                <div className="card pk-stat"><dt className="stat-label">รายได้ต่อเดือน</dt><dd className="stat-value">฿{formatCurrency(summary.monthlyIncome)}</dd></div>
            </dl>

            <div className="pk-toolbar">
                <div className="seg" role="group" aria-label="กรอง">
                    {([['all', 'ทั้งหมด'], ['vacant', 'ว่าง'], ['rented', 'มีผู้เช่า']] as [Filter, string][]).map(([id, label]) => (
                        <button key={id} type="button" className={`seg-item${filter === id ? ' active' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
                    ))}
                </div>
                {canEdit && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> เพิ่มช่องจอด</button>}
            </div>

            {spots === null ? (
                <div className="pk-empty"><div className="loading-spinner" /></div>
            ) : spots.length === 0 ? (
                <div className="card pk-empty">
                    <Car size={32} aria-hidden />
                    <p>ยังไม่มีช่องจอด เพิ่มทีละหลายช่องได้ เช่น A-01 ถึง A-20</p>
                    {canEdit && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> เพิ่มช่องจอด</button>}
                </div>
            ) : (
                <ul className="pk-list">
                    {shown.map(s => (
                        <li key={s.id} className={`card pk-spot${s.room_id ? ' is-rented' : ''}`}>
                            <div className="pk-spot-code"><KindIcon kind={s.kind} /> {s.code}</div>
                            <div className="pk-spot-info">
                                <span>{PARKING_KIND_LABELS[s.kind]}{s.zone ? ` · ${s.zone}` : ''}</span>
                                <span className="pk-fee">฿{formatCurrency(s.monthly_fee)}/เดือน</span>
                            </div>
                            <div className="pk-spot-who">
                                {s.room_id ? (
                                    <>
                                        <span className="badge pk-room-badge">ห้อง {s.room_number}</span>
                                        {s.plate && <span className="pk-plate">{s.plate}</span>}
                                        {s.sticker_no && <span className="pk-sticker">สติกเกอร์ {s.sticker_no}</span>}
                                    </>
                                ) : <span className="badge badge-gray">ว่าง</span>}
                            </div>
                            {canEdit && (
                                <div className="pk-spot-actions">
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(s)} aria-label={`แก้ไข ${s.code}`}><Pencil size={15} /></button>
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(s)} aria-label={`ลบ ${s.code}`}><Trash2 size={15} /></button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {adding && (
                <AddSpotsDialog
                    existing={new Set((spots ?? []).map(s => s.code))}
                    onClose={() => setAdding(false)}
                    onAdd={async created => {
                        await commit(created.map(after => ({ before: null, after })));
                        logActivity({ action: 'CREATE', resourceType: 'parking_spot', resourceId: created[0].id, resourceLabel: `${created.length} ช่อง`, propertyId: buildingId });
                        toast.success(`เพิ่ม ${created.length} ช่องจอดแล้ว`);
                        setAdding(false);
                    }}
                />
            )}
            {editing && (
                <EditSpotDialog
                    spot={editing}
                    rooms={activeRooms}
                    taken={new Set((spots ?? []).filter(s => s.id !== editing.id).map(s => s.code))}
                    onClose={() => setEditing(null)}
                    onSave={async after => {
                        await commit([{ before: editing, after }]);
                        logActivity({ action: 'UPDATE', resourceType: 'parking_spot', resourceId: after.id, resourceLabel: after.code, propertyId: buildingId });
                        toast.success(`บันทึก ${after.code} แล้ว`);
                        setEditing(null);
                    }}
                />
            )}
        </div>
    );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
                <div className="modal-header pk-dialog-head">
                    <h2 className="modal-title">{title}</h2>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="ปิด"><X size={18} /></button>
                </div>
                {children}
            </div>
        </div>
    );
}

function KindSelect({ value, onChange }: { value: ParkingKind; onChange: (k: ParkingKind) => void }) {
    return (
        <select className="form-input" value={value} onChange={e => onChange(e.target.value as ParkingKind)}>
            {(Object.keys(PARKING_KIND_LABELS) as ParkingKind[]).map(k => <option key={k} value={k}>{PARKING_KIND_LABELS[k]}</option>)}
        </select>
    );
}

function AddSpotsDialog({ existing, onClose, onAdd }: { existing: Set<string>; onClose: () => void; onAdd: (spots: ParkingSpot[]) => Promise<void> }) {
    const [f, setF] = useState({ prefix: 'A-', from: 1, count: 10, kind: 'car' as ParkingKind, zone: '', fee: 500 });
    const [busy, setBusy] = useState(false);
    const codes = spotCodes(f.prefix, f.from, f.count);
    const clash = codes?.filter(c => existing.has(c)) ?? [];
    const ok = !!codes && clash.length === 0 && f.fee >= 0;

    const submit = async () => {
        if (!codes) return;
        setBusy(true);
        const now = new Date().toISOString();
        try {
            await onAdd(codes.map(code => ({
                id: doc(collection(db, '_')).id, code, kind: f.kind, zone: f.zone.trim() || undefined, monthly_fee: Math.max(0, Number(f.fee) || 0),
                room_id: null, room_number: null, plate: null, sticker_no: null, note: null, created_at: now, updated_at: now,
            } as ParkingSpot)));
        } catch (err) {
            toast.error(`เพิ่มไม่สำเร็จ: ${(err as Error).message}`);
            setBusy(false);
        }
    };

    return (
        <Dialog title="เพิ่มช่องจอด" onClose={onClose}>
            <div className="modal-body pk-fields">
                <div className="pk-row">
                    <label className="form-label">ตัวอักษรนำหน้า<input className="form-input mono" maxLength={10} value={f.prefix} onChange={e => setF({ ...f, prefix: e.target.value })} /></label>
                    <label className="form-label">เริ่มที่เลข<input className="form-input mono" type="number" min={0} value={f.from} onChange={e => setF({ ...f, from: Number(e.target.value) })} /></label>
                    <label className="form-label">จำนวนช่อง<input className="form-input mono" type="number" min={1} max={200} value={f.count} onChange={e => setF({ ...f, count: Number(e.target.value) })} /></label>
                </div>
                <div className="pk-row">
                    <label className="form-label">ประเภท<KindSelect value={f.kind} onChange={kind => setF({ ...f, kind })} /></label>
                    <label className="form-label">โซน (ถ้ามี)<input className="form-input" maxLength={40} value={f.zone} onChange={e => setF({ ...f, zone: e.target.value })} placeholder="เช่น ชั้นใต้ดิน" /></label>
                    <label className="form-label">ค่าเช่า/เดือน (บาท)<input className="form-input mono" type="number" min={0} value={f.fee} onChange={e => setF({ ...f, fee: Number(e.target.value) })} /></label>
                </div>
                <p className="form-hint">
                    {codes ? `จะสร้าง ${codes[0]}${codes.length > 1 ? ` ถึง ${codes[codes.length - 1]}` : ''} (${codes.length} ช่อง)` : 'จำนวนช่องต้องอยู่ระหว่าง 1–200'}
                </p>
                {clash.length > 0 && <p className="pk-error">มีช่องนี้อยู่แล้ว: {clash.slice(0, 5).join(', ')}{clash.length > 5 ? '…' : ''}</p>}
            </div>
            <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onClose}>ยกเลิก</button>
                <button type="button" className="btn btn-primary" disabled={!ok || busy} onClick={() => void submit()}>เพิ่ม</button>
            </div>
        </Dialog>
    );
}

function EditSpotDialog({ spot, rooms, taken, onClose, onSave }: {
    spot: ParkingSpot; rooms: Room[]; taken: Set<string>; onClose: () => void; onSave: (s: ParkingSpot) => Promise<void>;
}) {
    const [f, setF] = useState({
        code: spot.code, kind: spot.kind, zone: spot.zone ?? '', fee: spot.monthly_fee, room_id: spot.room_id ?? '',
        plate: spot.plate ?? '', sticker_no: spot.sticker_no ?? '', note: spot.note ?? '',
    });
    const [busy, setBusy] = useState(false);
    const code = f.code.trim();
    const plate = cleanPlate(f.plate);
    const problem = !code ? 'ใส่รหัสช่องจอด' : taken.has(code) ? `มีช่อง ${code} อยู่แล้ว` : plate === undefined ? 'ทะเบียนรถไม่ถูกต้อง' : !(f.fee >= 0) ? 'ค่าเช่าไม่ถูกต้อง' : null;

    const submit = async () => {
        const room = rooms.find(r => r.id === f.room_id) ?? null;
        setBusy(true);
        try {
            await onSave({
                ...spot, code: code.slice(0, 20), kind: f.kind, zone: f.zone.trim() || undefined, monthly_fee: Math.max(0, Number(f.fee) || 0),
                room_id: room?.id ?? null, room_number: room?.room_number ?? null,
                // a vacated spot forgets the last car
                plate: room ? plate ?? null : null, sticker_no: room ? f.sticker_no.trim() || null : null, note: f.note.trim() || null,
                updated_at: new Date().toISOString(),
            });
        } catch (err) {
            toast.error(`บันทึกไม่สำเร็จ: ${(err as Error).message}`);
            setBusy(false);
        }
    };

    return (
        <Dialog title={`ช่องจอด ${spot.code}`} onClose={onClose}>
            <div className="modal-body pk-fields">
                <div className="pk-row">
                    <label className="form-label">รหัสช่อง<input className="form-input mono" maxLength={20} value={f.code} onChange={e => setF({ ...f, code: e.target.value })} /></label>
                    <label className="form-label">ประเภท<KindSelect value={f.kind} onChange={kind => setF({ ...f, kind })} /></label>
                    <label className="form-label">ค่าเช่า/เดือน (บาท)<input className="form-input mono" type="number" min={0} value={f.fee} onChange={e => setF({ ...f, fee: Number(e.target.value) })} /></label>
                </div>
                <label className="form-label">โซน<input className="form-input" maxLength={40} value={f.zone} onChange={e => setF({ ...f, zone: e.target.value })} /></label>
                <label className="form-label">ห้องที่เช่า
                    <select className="form-input" value={f.room_id} onChange={e => setF({ ...f, room_id: e.target.value })}>
                        <option value="">— ว่าง —</option>
                        {rooms.map(r => <option key={r.id} value={r.id}>ห้อง {r.room_number}</option>)}
                    </select>
                </label>
                {f.room_id && (
                    <div className="pk-row">
                        <label className="form-label">ทะเบียนรถ<input className="form-input" maxLength={20} value={f.plate} onChange={e => setF({ ...f, plate: e.target.value })} placeholder="เช่น กข 1234" /></label>
                        <label className="form-label">เลขสติกเกอร์<input className="form-input mono" maxLength={20} value={f.sticker_no} onChange={e => setF({ ...f, sticker_no: e.target.value })} /></label>
                    </div>
                )}
                <label className="form-label">หมายเหตุ<input className="form-input" maxLength={200} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
                <p className="form-hint">ค่าที่จอดจะเข้าบิลห้องนี้ตั้งแต่การบันทึกมิเตอร์ครั้งถัดไป บิลที่บันทึกไปแล้วไม่เปลี่ยน</p>
                {problem && <p className="pk-error">{problem}</p>}
            </div>
            <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onClose}>ยกเลิก</button>
                <button type="button" className="btn btn-primary" disabled={!!problem || busy} onClick={() => void submit()}>บันทึก</button>
            </div>
        </Dialog>
    );
}
