import { useState, useMemo } from 'react';
import {
    Wallet, CheckCircle2, Clock, AlertCircle, Receipt, Search,
    Image as ImageIcon, Check, RotateCcw, Loader2, X, TrendingUp,
    CalendarDays, User, Banknote,
} from 'lucide-react';
import type { MonthlyBill, Room, DormConfig, PaymentStatus } from '../../types';
import { ref, getDownloadURL } from 'firebase/storage';
import { doc, getDoc } from 'firebase/firestore';
import { storage, db } from '../../firebase/config';

interface PaymentsPageProps {
    bills: MonthlyBill[];
    rooms: Room[];
    config: DormConfig;
    currentMonth: string;             // 'YYYY-MM'
    onMonthChange: (month: string) => void;
    onUpdatePayment: (billId: string, fields: Partial<MonthlyBill>) => Promise<void>;
    uid?: string;
    buildingId?: string;
}

const THAI_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function monthLabel(m: string): string {
    const [y, mo] = m.split('-');
    return `${THAI_MONTHS[parseInt(mo)]} ${parseInt(y) + 543}`;
}
function statusOf(b: MonthlyBill): PaymentStatus {
    return b.payment_status ?? 'unpaid';
}
const STATUS_META: Record<PaymentStatus, { label: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
    paid:    { label: 'จ่ายแล้ว',     color: '#059669', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)',  icon: CheckCircle2 },
    pending: { label: 'รอตรวจสอบ',   color: '#D97706', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)',  icon: Clock },
    unpaid:  { label: 'ยังไม่จ่าย',   color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   border: 'rgba(220,38,38,0.25)',  icon: AlertCircle },
};

type FilterKey = 'all' | PaymentStatus;

export default function PaymentsPage({ bills, rooms, config, currentMonth, onMonthChange, onUpdatePayment, uid, buildingId }: PaymentsPageProps) {
    const [filter, setFilter] = useState<FilterKey>('all');
    const [search, setSearch] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [slipView, setSlipView] = useState<{ url?: string; loading: boolean; error?: string; bill: MonthlyBill } | null>(null);

    const dormName = config.bill_customization?.dorm_name || 'หอพัก';

    // Saved bills for the selected month, joined with room ordering
    const monthBills = useMemo(() => {
        const list = bills.filter(b => b.month === currentMonth && b.is_saved);
        const orderOf = new Map(rooms.map((r, i) => [r.id, i]));
        return list.sort((a, b) =>
            (orderOf.get(a.room_id) ?? 999) - (orderOf.get(b.room_id) ?? 999) ||
            a.room_number.localeCompare(b.room_number, undefined, { numeric: true })
        );
    }, [bills, rooms, currentMonth]);

    const stats = useMemo(() => {
        let paid = 0, pending = 0, unpaid = 0, collected = 0, outstanding = 0;
        for (const b of monthBills) {
            const s = statusOf(b);
            if (s === 'paid') { paid++; collected += b.total_bill; }
            else { outstanding += b.total_bill; if (s === 'pending') pending++; else unpaid++; }
        }
        return { paid, pending, unpaid, collected, outstanding, total: monthBills.length };
    }, [monthBills]);

    const filtered = monthBills.filter(b => {
        if (filter !== 'all' && statusOf(b) !== filter) return false;
        if (search && !b.room_number.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    const confirmPaid = async (b: MonthlyBill) => {
        setProcessingId(b.id);
        try {
            await onUpdatePayment(b.id, { payment_status: 'paid', paid_at: new Date().toISOString(), paid_method: 'manual' });
        } finally { setProcessingId(null); }
    };
    const undoPaid = async (b: MonthlyBill) => {
        if (!confirm(`ยกเลิกสถานะจ่ายของห้อง ${b.room_number}?`)) return;
        setProcessingId(b.id);
        try {
            await onUpdatePayment(b.id, { payment_status: b.slip_submitted_at ? 'pending' : 'unpaid', paid_at: '', paid_method: 'manual' });
        } finally { setProcessingId(null); }
    };

    const openSlip = async (b: MonthlyBill) => {
        if (!b.slip_image && !b.slip_path) return;
        setSlipView({ loading: true, bill: b });
        try {
            // New slips: base64 image stored inline in Firestore (free, no Storage needed)
            if (b.slip_image && uid && buildingId) {
                const snap = await getDoc(doc(db, `users/${uid}/buildings/${buildingId}/slip_images/${b.id}`));
                const url = snap.data()?.data_url as string | undefined;
                if (url) { setSlipView({ url, loading: false, bill: b }); return; }
            }
            // Legacy slips: image in Firebase Storage
            if (b.slip_path) {
                const url = await getDownloadURL(ref(storage, b.slip_path));
                setSlipView({ url, loading: false, bill: b });
                return;
            }
            setSlipView({ loading: false, error: 'ไม่พบรูปสลิป', bill: b });
        } catch {
            setSlipView({ loading: false, error: 'โหลดรูปสลิปไม่ได้', bill: b });
        }
    };

    const statCards = [
        { label: 'เก็บได้แล้ว', value: `฿${stats.collected.toLocaleString()}`, sub: `${stats.paid} ห้อง`, icon: TrendingUp, color: '#059669', bg: 'rgba(16,185,129,0.1)' },
        { label: 'ค้างชำระ', value: `฿${stats.outstanding.toLocaleString()}`, sub: `${stats.unpaid + stats.pending} ห้อง`, icon: Wallet, color: '#DC2626', bg: 'rgba(220,38,38,0.08)' },
        { label: 'รอตรวจสลิป', value: `${stats.pending}`, sub: 'ห้อง', icon: Clock, color: '#D97706', bg: 'rgba(245,158,11,0.1)' },
        { label: 'ทั้งหมด', value: `${stats.total}`, sub: 'ห้องที่มีบิล', icon: Receipt, color: '#6366F1', bg: 'rgba(99,102,241,0.1)' },
    ];

    const filterTabs: { key: FilterKey; label: string; count: number }[] = [
        { key: 'all', label: 'ทั้งหมด', count: stats.total },
        { key: 'unpaid', label: 'ยังไม่จ่าย', count: stats.unpaid },
        { key: 'pending', label: 'รอตรวจสอบ', count: stats.pending },
        { key: 'paid', label: 'จ่ายแล้ว', count: stats.paid },
    ];

    return (
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                    <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-gray-800)', margin: 0 }}>
                        <Wallet size={24} color="#6366F1" /> การชำระเงิน / สลิป
                    </h1>
                    <p style={{ margin: '0.25rem 0 0', color: 'var(--color-gray-500)', fontSize: '0.875rem' }}>
                        {dormName} · รอบ {monthLabel(currentMonth)}
                    </p>
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'var(--color-white)', border: '1px solid var(--color-gray-200)', borderRadius: 'var(--radius-md)', padding: '0.5rem 0.75rem' }}>
                    <CalendarDays size={16} color="var(--color-gray-500)" />
                    <input
                        type="month"
                        value={currentMonth}
                        onChange={e => e.target.value && onMonthChange(e.target.value)}
                        style={{ border: 'none', background: 'transparent', fontSize: '0.875rem', color: 'var(--color-gray-800)', outline: 'none' }}
                    />
                </label>
            </div>

            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {statCards.map(s => (
                    <div key={s.label} className="card" style={{ padding: '1.1rem', display: 'flex', gap: '0.85rem', alignItems: 'center' }}>
                        <div style={{ width: 44, height: 44, borderRadius: 12, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <s.icon size={22} color={s.color} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--color-gray-800)', lineHeight: 1.1, fontFamily: 'var(--font-mono)' }}>{s.value}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>{s.label} · {s.sub}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Filter + search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <div style={{ display: 'inline-flex', background: 'var(--color-gray-100)', borderRadius: 'var(--radius-md)', padding: 3, gap: 3, flexWrap: 'wrap' }}>
                    {filterTabs.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setFilter(t.key)}
                            style={{
                                border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                padding: '0.4rem 0.8rem', fontSize: '0.8125rem', fontWeight: 600,
                                background: filter === t.key ? 'var(--color-white)' : 'transparent',
                                color: filter === t.key ? 'var(--color-gray-800)' : 'var(--color-gray-500)',
                                boxShadow: filter === t.key ? 'var(--shadow-sm)' : 'none',
                            }}
                        >
                            {t.label} <span style={{ opacity: 0.6 }}>({t.count})</span>
                        </button>
                    ))}
                </div>
                <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
                    <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-gray-400)' }} />
                    <input
                        placeholder="ค้นหาเลขห้อง..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ width: '100%', padding: '0.5rem 0.5rem 0.5rem 2rem', fontSize: '0.875rem', border: '1px solid var(--color-gray-200)', borderRadius: 'var(--radius-md)', outline: 'none' }}
                    />
                </div>
            </div>

            {/* List */}
            {monthBills.length === 0 ? (
                <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-gray-500)' }}>
                    <Receipt size={40} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
                    <div>ยังไม่มีบิลที่บันทึกแล้วในรอบ {monthLabel(currentMonth)}</div>
                    <div style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>ออกบิลในเมนู "จดมิเตอร์" ก่อน แล้วสถานะการจ่ายจะมาแสดงที่นี่</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                    {filtered.map(b => {
                        const s = statusOf(b);
                        const meta = STATUS_META[s];
                        const busy = processingId === b.id;
                        return (
                            <div key={b.id} className="card" style={{ padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                                {/* Room + amount */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 180 }}>
                                    <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--color-gray-100)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <span style={{ fontSize: '0.65rem', color: 'var(--color-gray-400)', lineHeight: 1 }}>ห้อง</span>
                                        <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--color-gray-800)', lineHeight: 1.2 }}>{b.room_number}</span>
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--color-gray-800)', fontFamily: 'var(--font-mono)' }}>฿{b.total_bill.toLocaleString()}</div>
                                        {/* Slip meta */}
                                        {b.slip_submitted_at && (
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 2, fontSize: '0.72rem', color: 'var(--color-gray-500)' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Receipt size={11} />ส่งสลิปแล้ว</span>
                                                {b.slip_ref && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#059669', fontWeight: 700 }}><CheckCircle2 size={11} />QR ✓ ไม่ซ้ำ</span>}
                                                {b.slip_amount != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Banknote size={11} />฿{b.slip_amount.toLocaleString()}</span>}
                                                {b.slip_sender && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><User size={11} />{b.slip_sender}</span>}
                                            </div>
                                        )}
                                        {s === 'pending' && b.verify_note && (() => {
                                            const good = b.verify_note.startsWith('ตรวจ QR ผ่าน');
                                            return <div style={{ fontSize: '0.72rem', color: good ? '#059669' : '#D97706', marginTop: 2 }}>{good ? '✓' : '⚠'} {b.verify_note}</div>;
                                        })()}
                                    </div>
                                </div>

                                {/* Status badge */}
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`, borderRadius: 999, padding: '0.25rem 0.7rem', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                    <meta.icon size={13} /> {meta.label}
                                </span>

                                {/* Actions */}
                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                    {(b.slip_image || b.slip_path) && (
                                        <button className="btn btn-outline btn-sm" onClick={() => openSlip(b)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                            <ImageIcon size={14} /> ดูสลิป
                                        </button>
                                    )}
                                    {s !== 'paid' ? (
                                        <button className="btn btn-sm" onClick={() => confirmPaid(b)} disabled={busy}
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#059669', color: '#fff', border: 'none' }}>
                                            {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} ยืนยันจ่าย
                                        </button>
                                    ) : (
                                        <button className="btn btn-outline btn-sm" onClick={() => undoPaid(b)} disabled={busy}
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-gray-500)' }}>
                                            {busy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />} ยกเลิก
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {filtered.length === 0 && (
                        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-gray-400)', fontSize: '0.875rem' }}>
                            ไม่มีห้องในหมวด "{filterTabs.find(t => t.key === filter)?.label}"
                        </div>
                    )}
                </div>
            )}

            {/* Slip viewer modal */}
            {slipView && (
                <>
                    <div onClick={() => setSlipView(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 300, backdropFilter: 'blur(4px)' }} />
                    <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 301, background: 'var(--color-white)', borderRadius: 'var(--radius-xl)', padding: '1rem', width: 'min(440px, 92vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: 'var(--shadow-xl)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                            <strong style={{ color: 'var(--color-gray-800)' }}>สลิปห้อง {slipView.bill.room_number}</strong>
                            <button className="btn btn-outline btn-sm btn-icon" onClick={() => setSlipView(null)}><X size={16} /></button>
                        </div>
                        {slipView.loading ? (
                            <div style={{ padding: '3rem', textAlign: 'center' }}><Loader2 size={28} className="spin" style={{ color: '#6366F1' }} /></div>
                        ) : slipView.error ? (
                            <div style={{ padding: '2rem', textAlign: 'center', color: '#DC2626', fontSize: '0.875rem' }}>{slipView.error}</div>
                        ) : (
                            <img src={slipView.url} alt="payment slip" style={{ width: '100%', borderRadius: 'var(--radius-md)', display: 'block' }} />
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
