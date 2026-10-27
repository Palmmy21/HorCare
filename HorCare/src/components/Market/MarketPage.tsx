import { useMemo, useState } from 'react';
import { Store, Footprints, Check, X, Loader2, Copy, Plus, BellOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { useShopClosures, useWalkIns } from '../../hooks/useMarketData';
import { useBuildingRooms } from '../../hooks/useAccountingData';
import {
    CLOSURE_REASONS, CLOSURE_REASON_LABELS_TH, MAX_CLOSURE_DAYS, WALKIN_STATUS_LABELS_TH, addDays, closuresOn, todayTh, upcomingClosures,
    type ClosureReason, type WalkIn,
} from '../../shared/market';

interface Props { ownerUid: string; buildingId: string }

const ERRORS: Record<string, string> = {
    invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบวันที่ ชื่อ และเบอร์โทร',
    forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
    already_requested: 'เบอร์นี้มีรายการวันนั้นอยู่แล้ว',
    day_full: 'วันนั้นเต็มแล้ว',
    overlaps_existing: 'แผงนี้แจ้งหยุดช่วงวันนั้นไว้แล้ว',
    limit_reached: 'แผงนี้แจ้งหยุดล่วงหน้าครบ 10 รายการแล้ว',
};

/** Shown instead of an empty list when Firestore refuses the read, so it is not mistaken for "no submissions". */
function ReadError({ code }: { code: string }) {
    return (
        <div role="alert" style={{ ...card, background: '#FEE2E2', color: '#991B1B' }}>
            <strong>โหลดรายการไม่ได้ ({code})</strong>
            <span style={{ fontSize: '0.85rem' }}>
                {code === 'permission-denied'
                    ? 'บัญชีนี้ไม่มีสิทธิ์อ่านข้อมูลนี้ หรือยังไม่ได้ deploy Firestore rules ล่าสุด (firebase deploy --only firestore:rules)'
                    : 'ลองรีเฟรชหน้าอีกครั้ง'}
            </span>
        </div>
    );
}
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--color-white, #fff)' };
const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #C3D0DE)', borderRadius: 8, font: 'inherit', minWidth: 0, boxSizing: 'border-box' };
const dayLabel = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });

async function call(ownerUid: string, buildingId: string, body: Record<string, unknown>): Promise<boolean> {
    try {
        await apiPost('market', { owner_uid: ownerUid, building_id: buildingId, ...body });
        return true;
    } catch (e) {
        const err = e as ApiError;
        toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ');
        return false;
    }
}

function ClosuresTab({ ownerUid, buildingId }: Props) {
    const { closures, loading, error } = useShopClosures(ownerUid, buildingId);
    const { rooms } = useBuildingRooms(ownerUid, buildingId);
    const today = todayTh();
    const closedToday = useMemo(() => closuresOn(closures, today), [closures, today]);
    const upcoming = useMemo(() => upcomingClosures(closures, today), [closures, today]);
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState<{ room_id: string; from: string; to: string; reason: ClosureReason; note: string }>({ room_id: '', from: today, to: today, reason: 'personal', note: '' });

    const add = async () => {
        setBusy(true);
        const ok = await call(ownerUid, buildingId, { action: 'closure_add', room_id: form.room_id, from_date: form.from, to_date: form.to, reason: form.reason, note: form.note });
        setBusy(false);
        if (ok) { toast.success('บันทึกการแจ้งหยุดแล้ว'); setForm({ room_id: '', from: today, to: today, reason: 'personal', note: '' }); setShow(false); }
    };

    if (loading) return <Loader2 className="spin" />;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {error && <ReadError code={error} />}
            <div style={{ ...card, background: closedToday.length ? '#FDEBD3' : undefined }}>
                <strong><BellOff size={14} style={{ verticalAlign: -2 }} /> หยุดวันนี้ {closedToday.length} แผง</strong>
                <span style={{ fontSize: '0.9rem' }}>{closedToday.length ? closedToday.map(c => c.room_number).join(', ') : 'ทุกแผงเปิดตามปกติ'}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-gray-500)', flex: '1 1 220px' }}>ผู้ค้าแจ้งหยุดได้จากพอร์ทัลของแผงตัวเอง หรือเจ้าหน้าที่บันทึกแทนได้ที่นี่</p>
                <button className="btn btn-outline btn-sm" onClick={() => setShow(s => !s)} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Plus size={14} /> แจ้งหยุดแทนแผง</button>
            </div>
            {show && (
                <div style={{ ...card, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                    <select style={{ ...input, flex: '1 1 120px' }} value={form.room_id} onChange={e => setForm({ ...form, room_id: e.target.value })} aria-label="แผง">
                        <option value="">เลือกแผง</option>
                        {rooms.map(r => <option key={r.id} value={r.id}>แผง {r.room_number}</option>)}
                    </select>
                    <input type="date" style={input} min={today} max={addDays(today, 365)} value={form.from} aria-label="ตั้งแต่วันที่"
                        onChange={e => e.target.value && setForm({ ...form, from: e.target.value, to: e.target.value > form.to ? e.target.value : form.to })} />
                    <input type="date" style={input} min={form.from} max={addDays(form.from, MAX_CLOSURE_DAYS - 1)} value={form.to} aria-label="ถึงวันที่"
                        onChange={e => e.target.value && setForm({ ...form, to: e.target.value })} />
                    <select style={input} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value as ClosureReason })} aria-label="เหตุผล">
                        {CLOSURE_REASONS.map(r => <option key={r} value={r}>{CLOSURE_REASON_LABELS_TH[r]}</option>)}
                    </select>
                    <input style={{ ...input, flex: '1 1 160px' }} placeholder="หมายเหตุ (ถ้ามี)" maxLength={200} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
                    <button className="btn btn-primary btn-sm" disabled={busy || !form.room_id} onClick={() => void add()}>{busy ? <Loader2 size={14} className="spin" /> : 'บันทึก'}</button>
                </div>
            )}
            {upcoming.length === 0 ? <div style={{ color: 'var(--color-gray-500)' }}>ไม่มีการแจ้งหยุดที่กำลังจะมาถึง</div> : upcoming.map(c => (
                <div key={c.id} style={card}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <strong style={{ flex: 1 }}>แผง {c.room_number}</strong>
                        <span style={{ fontSize: '0.8rem' }}>{CLOSURE_REASON_LABELS_TH[c.reason]}</span>
                    </div>
                    <div style={{ fontSize: '0.9rem' }}>{dayLabel(c.from_date)}{c.to_date !== c.from_date ? ` – ${dayLabel(c.to_date)}` : ''}</div>
                    {c.note && <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-500)', overflowWrap: 'anywhere' }}>{c.note}</div>}
                    {c.ack_at ? <span style={{ fontSize: '0.75rem', color: '#166534' }}>รับทราบแล้วโดย {c.ack_by}</span> : (
                        <div><button className="btn btn-outline btn-sm" onClick={() => void call(ownerUid, buildingId, { action: 'closure_ack', closure_id: c.id })}>รับทราบ</button></div>
                    )}
                </div>
            ))}
        </div>
    );
}

function WalkInsTab({ ownerUid, buildingId }: Props) {
    const { walkIns, loading, error } = useWalkIns(ownerUid, buildingId);
    const today = todayTh();
    const [date, setDate] = useState(today);
    const [show, setShow] = useState(false);
    const [form, setForm] = useState({ name: '', phone: '', goods: '' });
    const [busy, setBusy] = useState<string | null>(null);

    const link = `${window.location.origin}/?walkin=1&uid=${encodeURIComponent(ownerUid)}&bid=${encodeURIComponent(buildingId)}`;
    const dates = useMemo(() => [...new Set(walkIns.filter(w => w.date >= today).map(w => w.date))], [walkIns, today]);
    const day = walkIns.filter(w => w.date === date);
    const pending = walkIns.filter(w => w.date >= today && w.status === 'pending').length;

    const decide = async (w: WalkIn, status: 'approved' | 'rejected') => {
        setBusy(w.id);
        await call(ownerUid, buildingId, { action: 'walkin_decide', walkin_id: w.id, status });
        setBusy(null);
    };
    const add = async () => {
        setBusy('add');
        const ok = await call(ownerUid, buildingId, { action: 'walkin_add', date, ...form });
        setBusy(null);
        if (ok) { toast.success('เพิ่มแล้ว'); setForm({ name: '', phone: '', goods: '' }); setShow(false); }
    };
    const copy = () => navigator.clipboard?.writeText(link).then(() => toast.success('คัดลอกลิงก์แล้ว'), () => toast.error('คัดลอกไม่สำเร็จ'));

    if (loading) return <Loader2 className="spin" />;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {error && <ReadError code={error} />}
            <div style={card}>
                <strong>ลิงก์ให้ขาจรแจ้งล่วงหน้า</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>ส่งลิงก์นี้ให้ขาจรทาง LINE หรือพิมพ์เป็น QR ที่หน้าตลาด แจ้งได้ล่วงหน้าไม่เกิน 14 วัน</span>
                <div style={{ display: 'flex', gap: 6 }}>
                    <input readOnly value={link} style={{ ...input, flex: 1, fontSize: '0.75rem' }} onFocus={e => e.currentTarget.select()} aria-label="ลิงก์แจ้งขาจร" />
                    <button className="btn btn-outline btn-sm" onClick={() => void copy()} aria-label="คัดลอกลิงก์"><Copy size={14} /></button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="date" value={date} min={today} max={addDays(today, 14)} onChange={e => e.target.value && setDate(e.target.value)} style={input} aria-label="วันที่" />
                {dates.filter(d => d !== date).slice(0, 4).map(d => <button key={d} className="btn btn-outline btn-sm" onClick={() => setDate(d)}>{dayLabel(d)}</button>)}
                <span style={{ flex: 1 }} />
                <button className="btn btn-outline btn-sm" onClick={() => setShow(s => !s)} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Plus size={14} /> เพิ่มเอง</button>
            </div>
            {pending > 0 && <div style={{ fontSize: '0.85rem', color: '#9A3412' }}>มี {pending} รายการรอพิจารณา</div>}

            {show && (
                <div style={{ ...card, flexDirection: 'row', flexWrap: 'wrap' }}>
                    <input style={{ ...input, flex: '1 1 140px' }} placeholder="ชื่อ" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={60} />
                    <input style={{ ...input, flex: '1 1 130px' }} placeholder="เบอร์โทร" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                    <input style={{ ...input, flex: '1 1 160px' }} placeholder="สินค้าที่ขาย" value={form.goods} onChange={e => setForm({ ...form, goods: e.target.value })} maxLength={100} />
                    <button className="btn btn-primary btn-sm" disabled={busy === 'add'} onClick={() => void add()}>{busy === 'add' ? <Loader2 size={14} className="spin" /> : 'บันทึก (อนุมัติทันที)'}</button>
                </div>
            )}

            <strong style={{ fontSize: '0.9rem' }}>{dayLabel(date)} · {day.filter(w => w.status === 'approved').length} อนุมัติ</strong>
            {day.length === 0 ? <div style={{ color: 'var(--color-gray-500)' }}>ยังไม่มีขาจรแจ้งวันนี้</div> : day.map(w => (
                <div key={w.id} style={{ ...card, opacity: w.status === 'rejected' ? 0.55 : 1 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <strong style={{ flex: 1, overflowWrap: 'anywhere' }}>{w.name}</strong>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>{WALKIN_STATUS_LABELS_TH[w.status]}</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', overflowWrap: 'anywhere' }}>{w.goods} · <a href={`tel:${w.phone}`}>{w.phone}</a></div>
                    {w.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-primary btn-sm" disabled={busy === w.id} onClick={() => void decide(w, 'approved')} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Check size={14} /> อนุมัติ</button>
                            <button className="btn btn-outline btn-sm" disabled={busy === w.id} onClick={() => void decide(w, 'rejected')} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><X size={14} /> ไม่อนุมัติ</button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

export default function MarketPage({ ownerUid, buildingId }: Props) {
    const [tab, setTab] = useState<'closures' | 'walkins'>('closures');
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h1 style={{ margin: 0, fontSize: '1.4rem' }}>ร้านค้า & ขาจร</h1>
            <div style={{ display: 'flex', gap: 6 }}>
                <button className={tab === 'closures' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setTab('closures')} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Store size={14} /> แจ้งหยุด</button>
                <button className={tab === 'walkins' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setTab('walkins')} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Footprints size={14} /> ขาจร</button>
            </div>
            {tab === 'closures' ? <ClosuresTab ownerUid={ownerUid} buildingId={buildingId} /> : <WalkInsTab ownerUid={ownerUid} buildingId={buildingId} />}
        </div>
    );
}
