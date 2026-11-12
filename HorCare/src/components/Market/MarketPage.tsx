import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Store, Footprints, Check, X, Loader2, Copy, Plus, BellOff, ShieldCheck, CloudRain } from 'lucide-react';
import RevenueAudit from './RevenueAudit';
import MarketClosures from './MarketClosures';
import type { Permission } from '../../shared/permissions';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { useShopClosures, useWalkIns } from '../../hooks/useMarketData';
import { useBuildingRooms } from '../../hooks/useAccountingData';
import {
    CLOSURE_REASONS, CLOSURE_REASON_LABELS_TH, MAX_CLOSURE_DAYS, WALKIN_MAX_DAYS_AHEAD, WALKIN_STATUS_LABELS_TH, addDays, closuresOn, lotLabel, lotRequests, todayTh, upcomingClosures,
    type ClosureReason, type WalkIn,
} from '../../shared/market';

interface Props { ownerUid: string; buildingId: string }

const ERRORS: Record<string, string> = {
    invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบวันที่ ชื่อ และเบอร์โทร',
    forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
    already_requested: 'เบอร์นี้มีรายการวันนั้นอยู่แล้ว',
    day_full: 'วันนั้นเต็มแล้ว',
    invalid_lot: 'ล็อกนี้ไม่มีในตลาดแล้ว กรุณาเลือกใหม่',
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

/** The market's walk-in scan link and its QR: made for this market (no ids in it), replaceable if it leaks. */
function WalkInLinkCard({ ownerUid, buildingId }: Props) {
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [confirmRotate, setConfirmRotate] = useState(false);
    const [busy, setBusy] = useState(false);
    const load = async (rotate = false) => {
        setBusy(true);
        try {
            const r = await apiPost<{ url: string }>('market', { action: 'walkin_link', owner_uid: ownerUid, building_id: buildingId, rotate });
            setUrl(r.url); setFailed(false);
            if (rotate) toast.success('สร้างลิงก์ใหม่แล้ว ลิงก์ / QR เดิมใช้ไม่ได้แล้ว');
        } catch (e) {
            setFailed(true);
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'โหลดลิงก์ไม่สำเร็จ');
        }
        setBusy(false); setConfirmRotate(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { void load(); }, [ownerUid, buildingId]);
    const copy = () => url && navigator.clipboard?.writeText(url).then(() => toast.success('คัดลอกลิงก์แล้ว'), () => toast.error('คัดลอกไม่สำเร็จ'));
    const downloadQr = () => {
        const svg = document.getElementById('walkin-qr');
        if (!svg) return;
        const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'walk-in-qr.svg'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    return (
        <div style={card}>
            <strong>QR / ลิงก์ให้ขาจรแจ้งเข้าขาย</strong>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>
                พิมพ์ QR ติดหน้าตลาด หรือส่งลิงก์ทาง LINE ขาจรแจ้งวันและล็อกที่ต้องการได้ล่วงหน้าไม่เกิน {WALKIN_MAX_DAYS_AHEAD} วัน แล้วเชื่อม LINE ของตลาดเพื่อรับผลอนุมัติและคุยกับเจ้าหน้าที่
            </span>
            {failed && !url ? <button className="btn btn-outline btn-sm" onClick={() => void load()}>ลองโหลดลิงก์อีกครั้ง</button> : !url ? <Loader2 size={16} className="spin" /> : (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ background: '#fff', padding: 6, borderRadius: 8, border: '1px solid var(--color-gray-200)' }}>
                        <QRCodeSVG id="walkin-qr" value={url} size={120} level="M" includeMargin />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 220px', minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <input readOnly value={url} style={{ ...input, flex: 1, fontSize: '0.75rem' }} onFocus={e => e.currentTarget.select()} aria-label="ลิงก์แจ้งขาจร" />
                            <button className="btn btn-outline btn-sm" onClick={() => void copy()} aria-label="คัดลอกลิงก์"><Copy size={14} /></button>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button className="btn btn-outline btn-sm" onClick={downloadQr}>ดาวน์โหลด QR</button>
                            {!confirmRotate ? <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setConfirmRotate(true)}>สร้างลิงก์ใหม่</button> : (
                                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.8rem' }}>
                                    QR ที่พิมพ์ไว้จะใช้ไม่ได้ ยืนยัน?
                                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void load(true)}>ยืนยัน</button>
                                    <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setConfirmRotate(false)}>ยกเลิก</button>
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function WalkInsTab({ ownerUid, buildingId }: Props) {
    const { walkIns, loading, error } = useWalkIns(ownerUid, buildingId);
    const { rooms } = useBuildingRooms(ownerUid, buildingId);
    const today = todayTh();
    const [date, setDate] = useState(today);
    const [show, setShow] = useState(false);
    const [form, setForm] = useState({ name: '', phone: '', goods: '', lot: '' });
    const [busy, setBusy] = useState<string | null>(null);
    /** The lot staff chose for each pending request before approving ('' = none yet). */
    const [lotFor, setLotFor] = useState<Record<string, string>>({});

    const dates = useMemo(() => [...new Set(walkIns.filter(w => w.date >= today).map(w => w.date))], [walkIns, today]);
    const day = walkIns.filter(w => w.date === date);
    const asked = useMemo(() => lotRequests(walkIns, date), [walkIns, date]);
    const pending = walkIns.filter(w => w.date >= today && w.status === 'pending').length;

    const decide = async (w: WalkIn, status: 'approved' | 'rejected') => {
        setBusy(w.id);
        const lot = lotFor[w.id] ?? w.preferred_lot?.room_id ?? '';
        try {
            const r = await apiPost<{ line_notified?: boolean }>('market', { owner_uid: ownerUid, building_id: buildingId, action: 'walkin_decide', walkin_id: w.id, status, ...(status === 'approved' ? { lot_room_id: lot } : {}) });
            toast.success(r.line_notified ? 'บันทึกแล้ว และแจ้งผลทาง LINE แล้ว' : 'บันทึกแล้ว (ขาจรยังไม่ได้เชื่อม LINE — โทรแจ้งผลตามเบอร์)');
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ');
        }
        setBusy(null);
    };
    const add = async () => {
        setBusy('add');
        const ok = await call(ownerUid, buildingId, { action: 'walkin_add', date, name: form.name, phone: form.phone, goods: form.goods, preferred_room_id: form.lot || null });
        setBusy(null);
        if (ok) { toast.success('เพิ่มแล้ว'); setForm({ name: '', phone: '', goods: '', lot: '' }); setShow(false); }
    };
    const lotOptions = rooms.map(r => <option key={r.id} value={r.id}>ล็อก {r.room_number}{r.zone ? ` (${r.zone})` : ''}{asked.get(r.id) ? ` · ขอแล้ว ${asked.get(r.id)}` : ''}</option>);

    if (loading) return <Loader2 className="spin" />;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {error && <ReadError code={error} />}
            <WalkInLinkCard ownerUid={ownerUid} buildingId={buildingId} />

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
                    <select style={{ ...input, flex: '1 1 140px' }} value={form.lot} onChange={e => setForm({ ...form, lot: e.target.value })} aria-label="ล็อก">
                        <option value="">ยังไม่กำหนดล็อก</option>
                        {lotOptions}
                    </select>
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
                    <div style={{ fontSize: '0.8rem', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span>{w.status === 'approved' ? <>ได้: <b>{lotLabel(w.lot)}</b></> : <>ขอ: {lotLabel(w.preferred_lot)}</>}</span>
                        {(() => {
                            const id = (w.status === 'approved' ? w.lot : w.preferred_lot)?.room_id;
                            const n = id ? asked.get(id) ?? 0 : 0;
                            return n > 1 && w.status !== 'rejected' ? <span style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 6, padding: '0 6px', fontWeight: 700 }}>ล็อกซ้ำ {n} ราย</span> : null;
                        })()}
                        <span style={{ color: w.line_user_id ? '#15803D' : 'var(--color-gray-500)' }}>{w.line_user_id ? `LINE เชื่อมแล้ว${w.line_notified_at ? ' · แจ้งผลแล้ว' : ''}` : 'ยังไม่เชื่อม LINE'}</span>
                    </div>
                    {w.status === 'pending' && (
                        <label style={{ fontSize: '0.8rem', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            ล็อกที่ให้
                            <select style={{ ...input, flex: '1 1 160px' }} value={lotFor[w.id] ?? w.preferred_lot?.room_id ?? ''} onChange={e => setLotFor({ ...lotFor, [w.id]: e.target.value })}>
                                <option value="">แจ้งล็อกตอนมาถึง</option>
                                {lotOptions}
                            </select>
                        </label>
                    )}
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

type MarketTab = 'audit' | 'closures' | 'market_closures' | 'walkins';

/**
 * ตลาด: the revenue audit (ตรวจยอดรายได้), stalls' own closure notices, days the market itself shut, and walk-ins.
 * Each tab shows only for those who may use it (`permissions` null = the owner); the server checks again.
 */
export default function MarketPage({ ownerUid, buildingId, permissions = null, dormName }: Props & { permissions?: readonly Permission[] | null; dormName?: string }) {
    const can = (p: Permission) => permissions === null || permissions.includes(p);
    const tabs: { id: MarketTab; label: string; Icon: typeof Store; show: boolean }[] = [
        { id: 'audit', label: 'ตรวจยอดรายได้', Icon: ShieldCheck, show: can('finance.read') },
        { id: 'closures', label: 'ผู้ค้าแจ้งหยุด', Icon: Store, show: can('shop.read') },
        { id: 'market_closures', label: 'ตลาดหยุด', Icon: CloudRain, show: can('shop.read') },
        { id: 'walkins', label: 'ขาจร', Icon: Footprints, show: can('visitor.read') },
    ];
    const open = tabs.filter(t => t.show);
    const [tab, setTab] = useState<MarketTab>(open[0]?.id ?? 'closures');
    const current = open.some(t => t.id === tab) ? tab : open[0]?.id;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h1 style={{ margin: 0, fontSize: '1.4rem' }}>ตลาด</h1>
            <div className="market-tabs" role="tablist" aria-label="เมนูตลาด">
                {open.map(t => (
                    <button key={t.id} type="button" role="tab" aria-selected={current === t.id} className={current === t.id ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
                        onClick={() => setTab(t.id)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <t.Icon size={14} aria-hidden /> {t.label}
                    </button>
                ))}
            </div>
            {current === 'audit' && <RevenueAudit ownerUid={ownerUid} buildingId={buildingId} dormName={dormName} />}
            {current === 'closures' && <ClosuresTab ownerUid={ownerUid} buildingId={buildingId} />}
            {current === 'market_closures' && <MarketClosures ownerUid={ownerUid} buildingId={buildingId} canEdit={can('shop.update')} />}
            {current === 'walkins' && <WalkInsTab ownerUid={ownerUid} buildingId={buildingId} />}
            {open.length === 0 && <p style={{ color: 'var(--color-gray-500)' }}>บัญชีนี้ไม่มีสิทธิ์ใช้งานเมนูตลาด</p>}
        </div>
    );
}
