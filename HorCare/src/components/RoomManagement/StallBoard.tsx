import { useMemo, useState } from 'react';
import { CalendarClock, Loader2, Pencil, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Room } from '../../types';
import { useRoomOccupancy } from '../../hooks/useRoomOccupancy';
import { apiPost, ApiError } from '../../utils/api';
import { addDays, todayTh } from '../../shared/market';
import type { Occupancy, RoomStatus } from '../../shared/roomOccupancy';
import { formatCurrency } from '../../utils/calculations';

const STATUS: Record<RoomStatus, { label: string; bg: string; line: string; ink: string }> = {
    vacant: { label: 'ว่าง', bg: '#F0FDF4', line: '#86EFAC', ink: '#166534' },
    reserved: { label: 'ติดจอง', bg: '#FFFBEB', line: '#FCD34D', ink: '#92400E' },
    occupied: { label: 'มีผู้เช่า', bg: '#EFF6FF', line: '#93C5FD', ink: '#1E40AF' },
};
const ORDER: RoomStatus[] = ['vacant', 'reserved', 'occupied'];

const ERRORS: Record<string, string> = {
    room_already_reserved: 'มีคนจองไว้แล้ว — รีเฟรชแล้วดูอีกครั้ง',
    room_leased: 'มีสัญญาเช่าอยู่ จองไม่ได้',
    room_not_found: 'ไม่พบหรือปิดใช้งานแล้ว',
    invalid_input: 'ข้อมูลไม่ครบหรือไม่ถูกต้อง: ใส่ชื่อ เบอร์โทร และวันจอง (ไม่เกิน 60 วัน)',
    reservation_not_active: 'การจองนี้ถูกยกเลิกหรือทำสัญญาไปแล้ว',
    forbidden: 'บัญชีนี้ไม่มีสิทธิ์จัดการการจอง',
    supabase_not_configured: 'ระบบจองยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์',
};
const errText = (e: unknown) => { const err = e as ApiError; return ERRORS[err.code] ?? err.message ?? 'ทำรายการไม่สำเร็จ'; };

/** The reservation id when the status comes from a booking made in HorCare (it can be cancelled from here). */
const reservationIdOf = (o: Occupancy | undefined) => o?.source === 'reservation' ? o.key.split(':')[1] ?? null : null;

interface Props {
    uid: string;
    buildingId: string;
    rooms: Room[];
    unitName: string;
    onEdit: (room: Room) => void;
}

/**
 * Every stall at a glance, by zone: ว่าง / ติดจอง / มีผู้เช่า (from contracts and bookings, the same status as the
 * plan and the round). Tap a stall to book it, cancel its booking, or edit it. Bookings tell the team (api/_leasing.ts).
 */
export default function StallBoard({ uid, buildingId, rooms, unitName, onEdit }: Props) {
    const active = useMemo(() => rooms.filter(r => r.is_active !== false), [rooms]);
    const { byRoom, reload, leasingAvailable } = useRoomOccupancy(uid, buildingId, active);
    const [status, setStatus] = useState<RoomStatus | 'all'>('all');
    const [zone, setZone] = useState<string>('all');
    const [q, setQ] = useState('');
    const [openId, setOpenId] = useState<string | null>(null);

    const statusOf = (r: Room): RoomStatus => byRoom[r.id]?.status ?? 'vacant';
    const counts = useMemo(() => {
        const c: Record<RoomStatus, number> = { vacant: 0, reserved: 0, occupied: 0 };
        for (const r of active) c[statusOf(r)]++;
        return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, byRoom]);
    const zones = useMemo(() => [...new Set(active.map(r => (r.zone ?? '').trim() || 'ไม่ระบุโซน'))].sort((a, b) => a.localeCompare(b, 'th')), [active]);
    const shown = active.filter(r =>
        (status === 'all' || statusOf(r) === status) &&
        (zone === 'all' || ((r.zone ?? '').trim() || 'ไม่ระบุโซน') === zone) &&
        (!q.trim() || `${r.room_number} ${r.business_type ?? ''} ${byRoom[r.id]?.detail ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));
    const byZone = zones.map(z => [z, shown.filter(r => ((r.zone ?? '').trim() || 'ไม่ระบุโซน') === z)] as const).filter(([, list]) => list.length > 0);
    const open = active.find(r => r.id === openId) ?? null;
    const pct = (n: number) => active.length ? Math.round((n / active.length) * 100) : 0;

    const chip = (on: boolean): React.CSSProperties => ({
        padding: '0.35rem 0.75rem', borderRadius: 999, border: `1px solid ${on ? 'var(--color-primary,#0F4C81)' : 'var(--color-gray-200,#DCE5EF)'}`,
        background: on ? 'var(--color-primary,#0F4C81)' : 'var(--color-white,#fff)', color: on ? '#fff' : 'inherit', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
    });

    return (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {/* how full the market is */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                <button type="button" onClick={() => setStatus('all')} style={{ ...tileBase, borderColor: status === 'all' ? 'var(--color-primary,#0F4C81)' : 'var(--color-gray-200,#DCE5EF)' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>ทั้งหมด</span>
                    <b style={{ fontSize: '1.4rem' }}>{active.length}</b><span style={{ fontSize: '0.72rem' }}>{unitName}</span>
                </button>
                {ORDER.map(s => (
                    <button type="button" key={s} onClick={() => setStatus(status === s ? 'all' : s)} aria-pressed={status === s}
                        style={{ ...tileBase, background: STATUS[s].bg, borderColor: status === s ? STATUS[s].ink : STATUS[s].line, color: STATUS[s].ink }}>
                        <span style={{ fontSize: '0.78rem' }}>{STATUS[s].label}</span>
                        <b style={{ fontSize: '1.4rem' }}>{counts[s]}</b><span style={{ fontSize: '0.72rem' }}>{pct(counts[s])}%</span>
                    </button>
                ))}
            </div>
            {active.length > 0 && (
                <div aria-hidden style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--color-gray-100)' }}>
                    {(['occupied', 'reserved', 'vacant'] as RoomStatus[]).map(s => <div key={s} style={{ width: `${pct(counts[s])}%`, background: STATUS[s].line }} />)}
                </div>
            )}
            {!leasingAvailable && (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-gray-600)', background: 'var(--color-gray-50)', borderRadius: 8, padding: '0.5rem 0.7rem' }}>
                    สถานะคิดจากข้อมูลผู้เช่า — ระบบจอง (หน้าปล่อยเช่า) ยังไม่พร้อมสำหรับบัญชีนี้ จึงยังจองจากหน้านี้ไม่ได้
                </div>
            )}

            {/* filters */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 0 }}>
                    <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-gray-400)' }} />
                    <input className="form-input" value={q} onChange={e => setQ(e.target.value)} placeholder={`ค้นหาเลข${unitName} สินค้า หรือชื่อ`} aria-label={`ค้นหา${unitName}`}
                        style={{ paddingLeft: '2rem', width: '100%', height: 36, boxSizing: 'border-box' }} />
                </div>
                {zones.length > 1 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" style={chip(zone === 'all')} onClick={() => setZone('all')}>ทุกโซน</button>
                        {zones.map(z => <button type="button" key={z} style={chip(zone === z)} onClick={() => setZone(zone === z ? 'all' : z)}>{z}</button>)}
                    </div>
                )}
            </div>

            {/* the board */}
            {shown.length === 0 ? <div style={{ color: 'var(--color-gray-500)', padding: '1rem 0' }}>ไม่มี{unitName}ที่ตรงกับตัวกรอง</div> : byZone.map(([z, list]) => (
                <section key={z}>
                    <h4 style={{ margin: '0 0 6px', fontSize: '0.88rem', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        {z} <span style={{ fontWeight: 400, color: 'var(--color-gray-500)', fontSize: '0.78rem' }}>
                            {list.length} {unitName} · ว่าง {list.filter(r => statusOf(r) === 'vacant').length}
                        </span>
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 6 }}>
                        {list.map(r => {
                            const s = statusOf(r);
                            const o = byRoom[r.id];
                            const who = s === 'vacant' ? '' : (o?.detail ?? '').split(' · ')[0];
                            return (
                                <button type="button" key={r.id} onClick={() => setOpenId(r.id)} title={o?.detail}
                                    style={{ textAlign: 'left', padding: '0.5rem 0.55rem', borderRadius: 10, border: `1.5px solid ${STATUS[s].line}`, background: STATUS[s].bg, color: STATUS[s].ink, cursor: 'pointer', minHeight: 66, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <b style={{ fontSize: '1rem', color: 'var(--color-gray-900,#102A43)' }}>{r.room_number}</b>
                                    <span style={{ fontSize: '0.7rem', fontWeight: 700 }}>{STATUS[s].label}{o?.override ? ' *' : ''}</span>
                                    {who && <span style={{ fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</span>}
                                </button>
                            );
                        })}
                    </div>
                </section>
            ))}
            <div style={{ fontSize: '0.72rem', color: 'var(--color-gray-500)' }}>สถานะคิดจากสัญญาเช่าและการจอง (เหมือนหน้าผังและหน้าเก็บเงิน) · * = แอดมินปรับสถานะเอง</div>

            {open && (
                <StallDialog key={open.id} uid={uid} buildingId={buildingId} room={open} occ={byRoom[open.id]} unitName={unitName} canBook={leasingAvailable}
                    onClose={() => setOpenId(null)} onChanged={() => { reload(); setOpenId(null); }} onEdit={() => { setOpenId(null); onEdit(open); }} />
            )}
        </div>
    );
}

const tileBase: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 0, alignItems: 'flex-start', padding: '0.55rem 0.8rem', borderRadius: 12,
    border: '1.5px solid', background: 'var(--color-white,#fff)', cursor: 'pointer', textAlign: 'left', font: 'inherit',
};

function StallDialog({ uid, buildingId, room, occ, unitName, canBook, onClose, onChanged, onEdit }: {
    uid: string; buildingId: string; room: Room; occ?: Occupancy; unitName: string; canBook: boolean;
    onClose: () => void; onChanged: () => void; onEdit: () => void;
}) {
    const today = todayTh();
    const status: RoomStatus = occ?.status ?? 'vacant';
    const reservationId = reservationIdOf(occ);
    const [form, setForm] = useState({ name: '', phone: '', until: addDays(today, 7), deposit: '', note: '' });
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const phoneOk = /^0\d{8,9}$/.test(form.phone.replace(/\D/g, ''));
    const ready = form.name.trim().length >= 2 && phoneOk && form.until >= today && !busy;

    const book = async () => {
        setBusy(true);
        try {
            await apiPost('leasing', {
                action: 'quick_reserve', owner_uid: uid, building_id: buildingId, room_id: room.id,
                name: form.name.trim(), phone: form.phone, reserved_until: form.until, deposit: Number(form.deposit) || 0, note: form.note.trim() || undefined,
            });
            toast.success(`จอง${unitName} ${room.room_number} แล้ว — แจ้งทีมงานแล้ว`);
            onChanged();
        } catch (e) { toast.error(errText(e)); setBusy(false); }
    };
    const cancel = async () => {
        if (!reservationId) return;
        setBusy(true);
        try {
            await apiPost('leasing', { action: 'reservation_cancel', owner_uid: uid, building_id: buildingId, reservation_id: reservationId, reason: reason.trim() || undefined });
            toast.success(`ยกเลิกจอง${unitName} ${room.room_number} แล้ว`);
            onChanged();
        } catch (e) { toast.error(errText(e)); setBusy(false); }
    };

    const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box' };
    return (
        <div role="dialog" aria-modal="true" aria-label={`${unitName} ${room.room_number}`} onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, padding: 12 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-white,#fff)', borderRadius: 16, width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 'auto', marginTop: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{unitName} {room.room_number}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>
                            {[room.zone, room.stall_size, room.business_type].filter(Boolean).join(' · ') || 'ยังไม่ระบุโซน/ขนาด'} · ค่าเช่า {formatCurrency(room.rent_amount || 0)}
                        </div>
                    </div>
                    <button type="button" className="btn-icon" onClick={onClose} aria-label="ปิด"><X size={18} /></button>
                </div>
                <div style={{ background: STATUS[status].bg, border: `1px solid ${STATUS[status].line}`, color: STATUS[status].ink, borderRadius: 10, padding: '0.55rem 0.75rem', fontSize: '0.88rem' }}>
                    <b>{STATUS[status].label}</b> — {occ?.detail ?? 'ไม่มีสัญญาหรือการจอง'}
                    {occ?.override && <div style={{ fontSize: '0.78rem' }}>แอดมินปรับสถานะเอง: {occ.override.reason}</div>}
                    {occ?.warning && <div style={{ fontSize: '0.78rem', marginTop: 2 }}>⚠️ {occ.warning}</div>}
                </div>

                {status === 'vacant' && canBook && (
                    <form onSubmit={e => { e.preventDefault(); if (ready) void book(); }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <b style={{ display: 'flex', gap: 6, alignItems: 'center' }}><CalendarClock size={16} /> จอง{unitName}นี้</b>
                        <input className="form-input" style={field} placeholder="ชื่อผู้จอง / ชื่อร้าน" maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                        <input className="form-input" style={field} placeholder="เบอร์โทร เช่น 0812345678" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required aria-invalid={form.phone !== '' && !phoneOk} />
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <label style={{ flex: '1 1 150px', fontSize: '0.8rem' }}>จองถึงวันที่
                                <input className="form-input" style={field} type="date" min={today} max={addDays(today, 60)} value={form.until} onChange={e => e.target.value && setForm({ ...form, until: e.target.value })} />
                            </label>
                            <label style={{ flex: '1 1 110px', fontSize: '0.8rem' }}>มัดจำ (บาท)
                                <input className="form-input" style={field} inputMode="decimal" placeholder="0" value={form.deposit} onChange={e => setForm({ ...form, deposit: e.target.value.replace(/[^\d.]/g, '') })} />
                            </label>
                        </div>
                        <input className="form-input" style={field} placeholder="หมายเหตุ (ไม่บังคับ)" maxLength={300} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
                        <button type="submit" className="btn btn-primary" disabled={!ready}>{busy ? <Loader2 size={16} className="spin" /> : `ยืนยันจอง${unitName} ${room.room_number}`}</button>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>เจ้าของ แอดมิน และทีมงานจะได้รับแจ้งเตือนทันที · การจองหมดอายุเองเมื่อเลยวันที่จอง · ทำสัญญาต่อได้ที่หน้า "ปล่อยเช่า"</span>
                    </form>
                )}

                {status === 'reserved' && reservationId && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span style={{ fontSize: '0.85rem' }}>ทำสัญญาเช่าจากการจองนี้ได้ที่หน้า "ปล่อยเช่า" หรือยกเลิกการจองเพื่อให้{unitName}ว่าง</span>
                        <input className="form-input" style={field} placeholder="เหตุผลที่ยกเลิก (ไม่บังคับ)" maxLength={300} value={reason} onChange={e => setReason(e.target.value)} />
                        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void cancel()} style={{ color: '#B91C1C', borderColor: '#FCA5A5' }}>
                            {busy ? <Loader2 size={16} className="spin" /> : 'ยกเลิกการจอง'}
                        </button>
                    </div>
                )}

                <button type="button" className="btn btn-outline btn-sm" onClick={onEdit} style={{ alignSelf: 'flex-start', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <Pencil size={14} /> แก้ไขข้อมูล{unitName} (เลข โซน ค่าเช่า)
                </button>
            </div>
        </div>
    );
}
