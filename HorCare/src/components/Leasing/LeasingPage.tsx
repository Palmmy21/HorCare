import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Loader2, Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { useBuildingRooms } from '../../hooks/useAccountingData';
import { addDays, todayTh } from '../../shared/market';
import { fromSatang } from '../../shared/accounting';
import {
    LEAD_SOURCES, LEAD_SOURCE_LABELS_TH, LEAD_STATUSES, LEAD_STATUS_LABELS_TH, LEASE_STATUS_LABELS_TH, RESERVATION_STATUS_LABELS_TH,
    canMoveLead, depositsHeld, isReservationLapsed, leaseAlert, renewalDefaults, type Lead, type LeadStatus, type Lease, type Reservation,
} from '../../shared/leasing';

interface Props { ownerUid: string; buildingId: string }
interface Overview { leads: Lead[]; reservations: Reservation[]; leases: Lease[] }
type Tab = 'leads' | 'reservations' | 'leases';

const ERRORS: Record<string, string> = {
    supabase_not_configured: 'ยังไม่ได้ตั้งค่า Supabase บนเซิร์ฟเวอร์ (ดู supabase/README.md)',
    invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบช่องที่กรอก (วันที่ เบอร์โทร จำนวนเงิน)',
    room_not_found: 'ไม่พบห้อง/แผงนี้ หรือถูกปิดใช้งาน',
    room_already_reserved: 'ห้องนี้ถูกจองอยู่แล้ว',
    room_leased: 'ห้องนี้มีสัญญาเช่าอยู่',
    room_has_active_lease: 'ห้องนี้มีสัญญาที่กำลังเช่าอยู่ — สิ้นสุดสัญญาเดิมก่อน',
    lead_closed: 'ผู้สนใจรายนี้ปิดเรื่องแล้ว',
    invalid_transition: 'เปลี่ยนสถานะนี้ไม่ได้',
    already_renewed: 'สัญญานี้ต่อสัญญาไปแล้ว',
    not_started_yet: 'ยังไม่ถึงวันเริ่มสัญญา',
    reservation_not_active: 'การจองนี้ไม่ได้ใช้งานแล้ว',
    changed_meanwhile: 'มีคนแก้รายการนี้ไปก่อน — โหลดใหม่แล้วลองอีกครั้ง',
    forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
};

const baht = (s: number) => fromSatang(s).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const day = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: '0.75rem', background: 'var(--color-white, #fff)', display: 'flex', flexDirection: 'column', gap: 6 };
const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #C3D0DE)', borderRadius: 8, font: 'inherit', minWidth: 0, boxSizing: 'border-box' };
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6 };

export default function LeasingPage({ ownerUid, buildingId }: Props) {
    const [data, setData] = useState<Overview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>('leads');
    const [busy, setBusy] = useState<string | null>(null);
    const { rooms } = useBuildingRooms(ownerUid, buildingId);
    const today = todayTh();

    const load = useCallback(async () => {
        try {
            setData(await apiPost<Overview>('leasing', { owner_uid: ownerUid, building_id: buildingId, action: 'overview' }));
            setError(null);
        } catch (e) { const err = e as ApiError; setError(ERRORS[err.code] ?? err.message ?? 'โหลดข้อมูลไม่สำเร็จ'); }
    }, [ownerUid, buildingId]);
    useEffect(() => { void load(); }, [load]);

    const act = async (key: string, body: Record<string, unknown>, ok: string): Promise<boolean> => {
        setBusy(key);
        try {
            await apiPost('leasing', { owner_uid: ownerUid, building_id: buildingId, ...body });
            toast.success(ok); await load(); return true;
        } catch (e) { const err = e as ApiError; toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ'); return false; }
        finally { setBusy(null); }
    };

    const leadName = useMemo(() => new Map((data?.leads ?? []).map(l => [l.id, l.name])), [data]);
    const expiring = useMemo(() => (data?.leases ?? []).filter(l => leaseAlert(l, today) !== null).sort((a, b) => a.end_date.localeCompare(b.end_date)), [data, today]);

    // ── forms ────────────────────────────────────────────────────────────────
    const [leadForm, setLeadForm] = useState({ name: '', phone: '', source: 'walk_in', budget: '', note: '' });
    const [showLead, setShowLead] = useState(false);
    const addLead = async () => {
        const ok = await act('lead', { action: 'lead_create', name: leadForm.name, phone: leadForm.phone, source: leadForm.source, budget: leadForm.budget ? Number(leadForm.budget) : undefined, note: leadForm.note }, 'เพิ่มผู้สนใจแล้ว');
        if (ok) { setShowLead(false); setLeadForm({ name: '', phone: '', source: 'walk_in', budget: '', note: '' }); }
    };

    const [reserveFor, setReserveFor] = useState<Lead | null>(null);
    const [rv, setRv] = useState({ room_id: '', deposit: '', until: addDays(today, 7) });
    const reserve = async () => {
        if (!reserveFor) return;
        const ok = await act('reserve', { action: 'reserve', lead_id: reserveFor.id, room_id: rv.room_id, deposit: rv.deposit ? Number(rv.deposit) : 0, reserved_until: rv.until }, 'จองห้องแล้ว');
        if (ok) { setReserveFor(null); setTab('reservations'); }
    };

    const [convertFor, setConvertFor] = useState<Reservation | null>(null);
    const [lt, setLt] = useState({ tenant_name: '', tenant_phone: '', start_date: today, end_date: addDays(today, 364), rent: '', deposit: '' });
    const openConvert = (r: Reservation) => {
        const lead = data?.leads.find(l => l.id === r.lead_id);
        setLt({ tenant_name: lead?.name ?? '', tenant_phone: lead?.phone ?? '', start_date: today, end_date: addDays(today, 364), rent: '', deposit: String(r.deposit_satang / 100 || '') });
        setConvertFor(r);
    };
    const convert = async () => {
        if (!convertFor) return;
        const ok = await act('convert', { action: 'convert', reservation_id: convertFor.id, tenant_name: lt.tenant_name, tenant_phone: lt.tenant_phone || undefined, start_date: lt.start_date, end_date: lt.end_date, rent: Number(lt.rent), deposit: Number(lt.deposit || 0) }, 'ทำสัญญาแล้ว');
        if (ok) { setConvertFor(null); setTab('leases'); }
    };

    const [showLease, setShowLease] = useState(false);
    const [nl, setNl] = useState({ room_id: '', tenant_name: '', tenant_phone: '', start_date: today, end_date: addDays(today, 364), rent: '', deposit: '' });
    const addLease = async () => {
        const ok = await act('lease', { action: 'lease_create', room_id: nl.room_id, tenant_name: nl.tenant_name, tenant_phone: nl.tenant_phone || undefined, start_date: nl.start_date, end_date: nl.end_date, rent: Number(nl.rent), deposit: Number(nl.deposit || 0) }, 'บันทึกสัญญาแล้ว');
        if (ok) setShowLease(false);
    };

    const moveLead = (l: Lead, to: LeadStatus) => {
        let reason: string | undefined;
        if (to === 'lost') { const r = window.prompt('เหตุผลที่ไม่สำเร็จ (ไม่บังคับ)'); if (r === null) return; reason = r; }
        void act('m:' + l.id, { action: 'lead_move', lead_id: l.id, status: to, lost_reason: reason }, 'อัปเดตสถานะแล้ว');
    };
    const cancelReservation = (r: Reservation) => {
        const reason = window.prompt('เหตุผลที่ยกเลิกการจอง (ไม่บังคับ)');
        if (reason === null) return;
        void act('c:' + r.id, { action: 'reservation_cancel', reservation_id: r.id, reason }, 'ยกเลิกการจองแล้ว');
    };
    const renew = (l: Lease) => {
        const d = renewalDefaults(l);
        if (window.confirm(`ต่อสัญญาห้อง ${l.room_number}: ${day(d.start_date)} – ${day(d.end_date)} ค่าเช่าเท่าเดิม (${baht(d.rent_satang)})?`)) void act('r:' + l.id, { action: 'lease_renew', lease_id: l.id }, 'สร้างสัญญาต่ออายุแล้ว (รอเริ่ม)');
    };
    const endLease = (l: Lease) => {
        const early = window.confirm(`เลิกสัญญาห้อง ${l.room_number} ก่อนกำหนดหรือไม่?\nกด OK = เลิกก่อนกำหนด (ต้องระบุเหตุผล) · กด Cancel = สิ้นสุดตามสัญญา`);
        let reason: string | undefined;
        if (early) { reason = window.prompt('เหตุผลที่เลิกสัญญา (จำเป็น)') ?? undefined; if (!reason?.trim()) return; }
        else if (!window.confirm(`ยืนยันสิ้นสุดสัญญาห้อง ${l.room_number} วันนี้?`)) return;
        void act('e:' + l.id, { action: 'lease_end', lease_id: l.id, ended_on: today, terminated: early, reason }, 'บันทึกการสิ้นสุดสัญญาแล้ว');
    };

    const roomOptions = rooms.map(r => <option key={r.id} value={r.id}>{r.room_number}</option>);
    const tabs: [Tab, string][] = [['leads', `ผู้สนใจ (${data?.leads.filter(l => l.status !== 'won' && l.status !== 'lost').length ?? 0})`], ['reservations', `การจอง (${data?.reservations.filter(r => r.status === 'active').length ?? 0})`], ['leases', `สัญญาเช่า (${data?.leases.filter(l => l.status === 'active').length ?? 0})`]];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                    <h1 style={{ margin: 0, fontSize: '1.4rem' }}>ปล่อยเช่า</h1>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>จากผู้สนใจ → จองห้อง → สัญญาเช่า → ต่อสัญญา / สิ้นสุดสัญญา</p>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => void load()} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><RefreshCw size={14} /> โหลดใหม่</button>
            </div>

            {error && <div style={{ ...card, borderColor: '#DC2626', color: '#B91C1C' }}>{error}</div>}
            {!data && !error && <Loader2 className="spin" />}

            {data && (
                <>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ ...card, flex: '1 1 160px' }}><span style={{ fontSize: '0.75rem' }}>ห้องที่มีสัญญา</span><strong style={{ fontSize: '1.3rem' }}>{data.leases.filter(l => l.status === 'active').length}</strong></div>
                        <div style={{ ...card, flex: '1 1 160px' }}><span style={{ fontSize: '0.75rem' }}>เงินมัดจำที่ถือไว้</span><strong style={{ fontSize: '1.3rem' }}>{baht(depositsHeld(data.leases))}</strong></div>
                        <div style={{ ...card, flex: '1 1 160px', background: expiring.length ? '#FDEBD3' : undefined }}>
                            <span style={{ fontSize: '0.75rem' }}>สัญญาใกล้หมด / หมดแล้ว</span><strong style={{ fontSize: '1.3rem' }}>{expiring.length}</strong>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={tab === id ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>{label}</button>)}
                    </div>

                    {tab === 'leads' && (
                        <>
                            <div><button className="btn btn-primary btn-sm" onClick={() => setShowLead(s => !s)} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Plus size={14} /> เพิ่มผู้สนใจ</button></div>
                            {showLead && (
                                <div style={card}>
                                    <div style={row}>
                                        <input style={input} placeholder="ชื่อ" value={leadForm.name} onChange={e => setLeadForm({ ...leadForm, name: e.target.value })} maxLength={100} />
                                        <input style={input} placeholder="เบอร์โทร" inputMode="tel" value={leadForm.phone} onChange={e => setLeadForm({ ...leadForm, phone: e.target.value })} />
                                        <select style={input} value={leadForm.source} onChange={e => setLeadForm({ ...leadForm, source: e.target.value })}>{LEAD_SOURCES.map(s => <option key={s} value={s}>{LEAD_SOURCE_LABELS_TH[s]}</option>)}</select>
                                        <input style={input} type="number" min="0" placeholder="งบต่อเดือน (บาท)" value={leadForm.budget} onChange={e => setLeadForm({ ...leadForm, budget: e.target.value })} />
                                    </div>
                                    <input style={input} placeholder="หมายเหตุ" value={leadForm.note} onChange={e => setLeadForm({ ...leadForm, note: e.target.value })} maxLength={1000} />
                                    <div><button className="btn btn-primary btn-sm" disabled={busy === 'lead' || !leadForm.name.trim() || !leadForm.phone.trim()} onClick={() => void addLead()}>บันทึก</button></div>
                                </div>
                            )}
                            {data.leads.length === 0 ? <div style={{ color: 'var(--color-gray-500)' }}>ยังไม่มีผู้สนใจ</div> : data.leads.map(l => (
                                <div key={l.id} style={{ ...card, opacity: l.status === 'lost' ? 0.6 : 1 }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <strong style={{ flex: 1, overflowWrap: 'anywhere' }}>{l.name}</strong>
                                        <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>{LEAD_STATUS_LABELS_TH[l.status]}</span>
                                    </div>
                                    <div style={{ fontSize: '0.82rem', color: 'var(--color-gray-500)' }}>
                                        {l.phone && <a href={`tel:${l.phone}`}>{l.phone}</a>} · {LEAD_SOURCE_LABELS_TH[l.source]}{l.budget_satang ? ` · งบ ${baht(l.budget_satang)}` : ''}{l.lost_reason ? ` · ${l.lost_reason}` : ''}
                                    </div>
                                    {l.note && <div style={{ fontSize: '0.85rem', overflowWrap: 'anywhere' }}>{l.note}</div>}
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                        {(['contacted', 'viewing', 'lost', 'new'] as LeadStatus[]).filter(to => canMoveLead(l.status, to)).map(to => (
                                            <button key={to} className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => moveLead(l, to)}>{to === 'new' ? 'เปิดเรื่องใหม่' : `→ ${LEAD_STATUS_LABELS_TH[to]}`}</button>
                                        ))}
                                        {(l.status === 'new' || l.status === 'contacted' || l.status === 'viewing') && <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => { setReserveFor(l); setRv({ room_id: l.interested_room_id ?? '', deposit: '', until: addDays(today, 7) }); }}>จองห้อง</button>}
                                    </div>
                                </div>
                            ))}
                        </>
                    )}

                    {tab === 'reservations' && (data.reservations.length === 0 ? <div style={{ color: 'var(--color-gray-500)' }}>ยังไม่มีการจอง</div> : data.reservations.map(r => {
                        const lapsed = isReservationLapsed(r, today);
                        return (
                            <div key={r.id} style={{ ...card, borderColor: lapsed ? '#F59E2E' : undefined, opacity: r.status === 'active' ? 1 : 0.6 }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <strong style={{ flex: 1 }}>ห้อง {r.room_number} · {leadName.get(r.lead_id) ?? '-'}</strong>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>{lapsed ? 'เลยกำหนดจอง' : RESERVATION_STATUS_LABELS_TH[r.status]}</span>
                                </div>
                                <div style={{ fontSize: '0.82rem', color: 'var(--color-gray-500)' }}>มัดจำจอง {baht(r.deposit_satang)} · จองถึง {day(r.reserved_until)}{r.cancel_reason ? ` · ${r.cancel_reason}` : ''}</div>
                                {lapsed && <div style={{ fontSize: '0.8rem', color: '#9A3412', display: 'flex', gap: 4, alignItems: 'center' }}><AlertTriangle size={13} /> เลยกำหนดแล้ว ห้องยังถูกกันไว้ — ทำสัญญาหรือยกเลิกการจอง</div>}
                                {r.status === 'active' && (
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => openConvert(r)}>ทำสัญญา</button>
                                        <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => cancelReservation(r)}>ยกเลิกการจอง</button>
                                    </div>
                                )}
                            </div>
                        );
                    }))}

                    {tab === 'leases' && (
                        <>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                <button className="btn btn-primary btn-sm" onClick={() => setShowLease(s => !s)} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Plus size={14} /> บันทึกสัญญา (ผู้เช่าเดิม)</button>
                                <span style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>สัญญาใหม่จากการจองให้ทำที่แท็บ “การจอง”</span>
                            </div>
                            {showLease && (
                                <div style={card}>
                                    <div style={row}>
                                        <select style={input} value={nl.room_id} onChange={e => setNl({ ...nl, room_id: e.target.value })} aria-label="ห้อง"><option value="">เลือกห้อง…</option>{roomOptions}</select>
                                        <input style={input} placeholder="ชื่อผู้เช่า" value={nl.tenant_name} onChange={e => setNl({ ...nl, tenant_name: e.target.value })} maxLength={100} />
                                        <input style={input} placeholder="เบอร์โทร" inputMode="tel" value={nl.tenant_phone} onChange={e => setNl({ ...nl, tenant_phone: e.target.value })} />
                                        <label style={{ fontSize: '0.78rem' }}>เริ่ม<input style={{ ...input, width: '100%' }} type="date" value={nl.start_date} onChange={e => setNl({ ...nl, start_date: e.target.value })} /></label>
                                        <label style={{ fontSize: '0.78rem' }}>สิ้นสุด<input style={{ ...input, width: '100%' }} type="date" value={nl.end_date} onChange={e => setNl({ ...nl, end_date: e.target.value })} /></label>
                                        <input style={input} type="number" min="0" placeholder="ค่าเช่า/เดือน" value={nl.rent} onChange={e => setNl({ ...nl, rent: e.target.value })} />
                                        <input style={input} type="number" min="0" placeholder="เงินมัดจำ" value={nl.deposit} onChange={e => setNl({ ...nl, deposit: e.target.value })} />
                                    </div>
                                    <div><button className="btn btn-primary btn-sm" disabled={busy === 'lease' || !nl.room_id || !nl.tenant_name.trim() || !nl.rent} onClick={() => void addLease()}>บันทึก</button></div>
                                </div>
                            )}
                            {data.leases.length === 0 ? <div style={{ color: 'var(--color-gray-500)' }}>ยังไม่มีสัญญา</div> : data.leases.map(l => {
                                const alert = leaseAlert(l, today);
                                return (
                                    <div key={l.id} style={{ ...card, borderColor: alert ? '#F59E2E' : undefined, opacity: l.status === 'ended' || l.status === 'terminated' ? 0.6 : 1 }}>
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                            <strong style={{ flex: 1, overflowWrap: 'anywhere' }}>ห้อง {l.room_number} · {l.tenant_name}</strong>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>{LEASE_STATUS_LABELS_TH[l.status]}</span>
                                        </div>
                                        <div style={{ fontSize: '0.82rem', color: 'var(--color-gray-500)' }}>{day(l.start_date)} – {day(l.end_date)} · ค่าเช่า {baht(l.rent_satang)} · มัดจำ {baht(l.deposit_satang)}{l.renewal_of ? ' · ต่อสัญญา' : ''}{l.end_reason ? ` · ${l.end_reason}` : ''}</div>
                                        {alert && <div style={{ fontSize: '0.8rem', color: '#9A3412', display: 'flex', gap: 4, alignItems: 'center' }}><CalendarClock size={13} /> {alert === 'expired' ? 'เลยวันสิ้นสุดสัญญาแล้ว' : 'ใกล้สิ้นสุดสัญญา'}</div>}
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                            {l.status === 'active' && <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => renew(l)}>ต่อสัญญา</button>}
                                            {l.status === 'active' && <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => endLease(l)}>สิ้นสุดสัญญา</button>}
                                            {l.status === 'scheduled' && l.start_date <= today && <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void act('a:' + l.id, { action: 'lease_activate', lease_id: l.id }, 'เริ่มสัญญาแล้ว')}>เริ่มสัญญา</button>}
                                        </div>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </>
            )}

            {reserveFor && (
                <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setReserveFor(null); }}>
                    <div className="modal" style={{ maxWidth: 440 }} role="dialog" aria-modal="true" aria-label="จองห้อง">
                        <div className="modal-header"><span className="modal-title">จองห้องให้ {reserveFor.name}</span></div>
                        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <select style={input} value={rv.room_id} onChange={e => setRv({ ...rv, room_id: e.target.value })} aria-label="ห้อง"><option value="">เลือกห้อง…</option>{roomOptions}</select>
                            <input style={input} type="number" min="0" placeholder="เงินมัดจำจอง (บาท)" value={rv.deposit} onChange={e => setRv({ ...rv, deposit: e.target.value })} />
                            <label style={{ fontSize: '0.8rem' }}>จองถึงวันที่ (ไม่เกิน 60 วัน)<input style={{ ...input, width: '100%' }} type="date" min={today} max={addDays(today, 60)} value={rv.until} onChange={e => setRv({ ...rv, until: e.target.value })} /></label>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-primary btn-sm" disabled={busy === 'reserve' || !rv.room_id} onClick={() => void reserve()}>{busy === 'reserve' ? <Loader2 size={14} className="spin" /> : 'ยืนยันการจอง'}</button>
                                <button className="btn btn-outline btn-sm" onClick={() => setReserveFor(null)}>ปิด</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {convertFor && (
                <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setConvertFor(null); }}>
                    <div className="modal" style={{ maxWidth: 480 }} role="dialog" aria-modal="true" aria-label="ทำสัญญา">
                        <div className="modal-header"><span className="modal-title">ทำสัญญาเช่าห้อง {convertFor.room_number}</span></div>
                        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <input style={input} placeholder="ชื่อผู้เช่า" value={lt.tenant_name} onChange={e => setLt({ ...lt, tenant_name: e.target.value })} maxLength={100} />
                            <input style={input} placeholder="เบอร์โทร" inputMode="tel" value={lt.tenant_phone} onChange={e => setLt({ ...lt, tenant_phone: e.target.value })} />
                            <div style={row}>
                                <label style={{ fontSize: '0.78rem' }}>เริ่ม<input style={{ ...input, width: '100%' }} type="date" value={lt.start_date} onChange={e => setLt({ ...lt, start_date: e.target.value })} /></label>
                                <label style={{ fontSize: '0.78rem' }}>สิ้นสุด<input style={{ ...input, width: '100%' }} type="date" value={lt.end_date} onChange={e => setLt({ ...lt, end_date: e.target.value })} /></label>
                            </div>
                            <div style={row}>
                                <input style={input} type="number" min="0" placeholder="ค่าเช่า/เดือน (บาท)" value={lt.rent} onChange={e => setLt({ ...lt, rent: e.target.value })} />
                                <input style={input} type="number" min="0" placeholder="เงินมัดจำสัญญา (บาท)" value={lt.deposit} onChange={e => setLt({ ...lt, deposit: e.target.value })} />
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-primary btn-sm" disabled={busy === 'convert' || !lt.tenant_name.trim() || !lt.rent} onClick={() => void convert()}>{busy === 'convert' ? <Loader2 size={14} className="spin" /> : 'บันทึกสัญญา'}</button>
                                <button className="btn btn-outline btn-sm" onClick={() => setConvertFor(null)}>ปิด</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// keep LEAD_STATUSES referenced for exhaustive label coverage in builds
void LEAD_STATUSES;
