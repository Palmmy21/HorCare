import { useState, useMemo, useEffect } from 'react';
import {
    Wallet, CheckCircle2, Clock, AlertCircle, Receipt, Search, Landmark,
    Image as ImageIcon, Check, RotateCcw, Loader2, X, TrendingUp,
    CalendarDays, User, Banknote, Download, CheckSquare, Square, TriangleAlert, AlertTriangle, ShieldCheck,
} from 'lucide-react';
import type { MonthlyBill, Room, DormConfig, PaymentStatus, Fine, PaymentMethod } from '../../types';
import PaymentMethodModal from './PaymentMethodModal';
import BankAccountsModal from './BankAccountsModal';
import ReconciliationModal from './ReconciliationModal';
import { useBankTransactions } from '../../hooks/useBankTransactions';
import BankLogo from './BankLogo';
import SlipChecksPanel from './SlipChecksPanel';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { maskAccountNumber } from '../../shared/banks';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, VERIFICATION_LABELS, resolvePaymentMethod, type PaymentRecordFields } from '../../utils/paymentMethods';
import { logActivity } from '../../utils/auditLog';
import { ref, getDownloadURL } from 'firebase/storage';
import { doc, getDoc, collection, query, onSnapshot, updateDoc } from 'firebase/firestore';
import { storage, db, auth } from '../../firebase/config';

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

const STATUS_META: Record<PaymentStatus, { label: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
    paid:    { label: 'จ่ายแล้ว',     color: '#059669', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)',  icon: CheckCircle2 },
    pending: { label: 'รอตรวจสอบ',   color: '#D97706', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)',  icon: Clock },
    unpaid:  { label: 'ยังไม่จ่าย',   color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   border: 'rgba(220,38,38,0.25)',  icon: AlertCircle },
};

type FilterKey = 'all' | PaymentStatus;

type PayableItem = {
  id: string;
  type: 'bill' | 'fine';
  room_number: string;
  room_id: string;
  month: string;
  total_amount: number;
  payment_status: PaymentStatus;
  slip_submitted_at?: string;
  slip_ref?: string;
  slip_amount?: number;
  slip_sender?: string;
  verify_note?: string;
  slip_image?: boolean;
  slip_path?: string;
  paid_at?: string;
  payment_method?: PaymentMethod;
  paid_amount?: number;
  received_by?: string;
  transaction_ref?: string;
  verification_status?: MonthlyBill['verification_status'];
  paid_method?: 'auto' | 'manual';
  bank_account_id?: string;
  bank_account?: string;
  // what was read from the slip and how it compared (set by the slip check)
  slip_receiver_name?: string;
  slip_receiver_account?: string;
  slip_datetime?: string;
  slip_account_id?: string;
  slip_checks?: MonthlyBill['slip_checks'];
  title: string;
  originalBill?: MonthlyBill;
  originalFine?: Fine;
};

export default function PaymentsPage({ bills, rooms, config, currentMonth, onMonthChange, onUpdatePayment, uid, buildingId }: PaymentsPageProps) {
    const [fines, setFines] = useState<Fine[]>([]);
    
    useEffect(() => {
        if (!uid || !buildingId) return;
        const q = query(collection(db, `users/${uid}/buildings/${buildingId}/fines`));
        const unsub = onSnapshot(q, snap => {
            setFines(snap.docs.map(d => ({ ...d.data(), id: d.id } as Fine)));
        });
        return unsub;
    }, [uid, buildingId]);

    const [filter, setFilter] = useState<FilterKey>('all');
    const [methodFilter, setMethodFilter] = useState<'all' | PaymentMethod>('all');
    // Items waiting for the user to choose how they were paid (one = single, many = bulk).
    const [payModal, setPayModal] = useState<PayableItem[] | null>(null);
    const [search, setSearch] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [slipView, setSlipView] = useState<{ url?: string; loading: boolean; error?: string; item: PayableItem } | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkProcessing, setBulkProcessing] = useState(false);
    const [showAccounts, setShowAccounts] = useState(false);
  const [showRecon, setShowRecon] = useState(false);
    const { accounts, activeAccounts, loading: accountsLoading } = useBankAccounts(uid ?? null, buildingId ?? null);
  const { transactions: bankTxs, loading: bankTxsLoading } = useBankTransactions(uid ?? null, buildingId ?? null);
  const reconPending = bankTxs.filter(t => t.status !== 'reconciled').length;
    const accountById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
    // Only the account owner (not staff) manages receiving accounts; the server enforces this too.
    const canManageAccounts = !!uid && auth.currentUser?.uid === uid;

    const dormName = config.bill_customization?.dorm_name || 'หอพัก';

    const monthItems = useMemo(() => {
        const items: PayableItem[] = [];
        const list = bills.filter(b => b.month === currentMonth && b.is_saved);
        list.forEach(b => items.push({
            id: b.id, type: 'bill', room_number: b.room_number, room_id: b.room_id, month: b.month,
            total_amount: b.total_bill, payment_status: b.payment_status || 'unpaid',
            slip_submitted_at: b.slip_submitted_at, slip_ref: b.slip_ref, slip_amount: b.slip_amount,
            slip_sender: b.slip_sender, verify_note: b.verify_note, slip_image: b.slip_image, slip_path: b.slip_path,
            paid_at: b.paid_at, payment_method: b.payment_method, paid_amount: b.paid_amount, received_by: b.received_by,
            transaction_ref: b.transaction_ref, verification_status: b.verification_status, paid_method: b.paid_method,
            bank_account_id: b.bank_account_id, bank_account: b.bank_account,
            slip_receiver_name: b.slip_receiver_name, slip_receiver_account: b.slip_receiver_account, slip_datetime: b.slip_datetime,
            slip_account_id: b.slip_account_id, slip_checks: b.slip_checks,
            title: 'บิลค่าเช่า', originalBill: b
        }));

        const fineList = fines.filter(f => f.date.startsWith(currentMonth));
        fineList.forEach(f => items.push({
            id: f.id, type: 'fine', room_number: f.room_number, room_id: f.room_id, month: f.date.substring(0,7),
            total_amount: f.amount, payment_status: f.status || 'unpaid',
            slip_submitted_at: f.slip_submitted_at, slip_ref: f.slip_ref, slip_amount: f.slip_amount,
            slip_sender: f.slip_sender, verify_note: f.verify_note, slip_image: f.slip_image,
            paid_at: f.paid_at, payment_method: f.payment_method, paid_amount: f.paid_amount, received_by: f.received_by,
            transaction_ref: f.transaction_ref, verification_status: f.verification_status, paid_method: f.paid_method,
            bank_account_id: f.bank_account_id, bank_account: f.bank_account,
            slip_receiver_name: f.slip_receiver_name, slip_receiver_account: f.slip_receiver_account, slip_datetime: f.slip_datetime,
            slip_account_id: f.slip_account_id, slip_checks: f.slip_checks,
            title: 'ค่าปรับ: ' + f.reason, originalFine: f
        }));

        const orderOf = new Map(rooms.map((r, i) => [r.id, i]));
        return items.sort((a, b) =>
            (orderOf.get(a.room_id) ?? 999) - (orderOf.get(b.room_id) ?? 999) ||
            a.room_number.localeCompare(b.room_number, undefined, { numeric: true }) ||
            a.type.localeCompare(b.type)
        );
    }, [bills, fines, rooms, currentMonth]);

    const stats = useMemo(() => {
        let paid = 0, pending = 0, unpaid = 0, collected = 0, outstanding = 0;
        for (const b of monthItems) {
            const s = b.payment_status;
            if (s === 'paid') { paid++; collected += b.total_amount; }
            else { outstanding += b.total_amount; if (s === 'pending') pending++; else unpaid++; }
        }
        return { paid, pending, unpaid, collected, outstanding, total: monthItems.length };
    }, [monthItems]);

    // Collected money split by how it arrived. Total = cash + transfer + gateway + other.
    const methodTotals = useMemo(() => {
        const totals: Record<PaymentMethod, { amount: number; count: number }> = {
            cash: { amount: 0, count: 0 }, bank_transfer: { amount: 0, count: 0 },
            qr_gateway: { amount: 0, count: 0 }, other: { amount: 0, count: 0 },
        };
        for (const b of monthItems) {
            if (b.payment_status !== 'paid') continue;
            const m = resolvePaymentMethod(b);
            totals[m].amount += b.paid_amount ?? b.total_amount;
            totals[m].count++;
        }
        return totals;
    }, [monthItems]);

    // Bank transfers split by the account the money went to (accounts without an id are grouped together).
    const accountTotals = useMemo(() => {
        const map = new Map<string, { key: string; short: string | null; label: string; amount: number; count: number }>();
        for (const b of monthItems) {
            if (b.payment_status !== 'paid' || resolvePaymentMethod(b) !== 'bank_transfer') continue;
            const acc = b.bank_account_id ? accountById.get(b.bank_account_id) : undefined;
            const key = acc?.id ?? (b.bank_account ? `text:${b.bank_account}` : 'unspecified');
            const row = map.get(key) ?? {
                key, short: acc?.bank_short ?? null,
                label: acc ? `${acc.nickname || acc.bank_short} · ${maskAccountNumber(acc.account_number).slice(-4)}` : (b.bank_account || 'ไม่ระบุบัญชี'),
                amount: 0, count: 0,
            };
            row.amount += b.paid_amount ?? b.total_amount;
            row.count++;
            map.set(key, row);
        }
        return [...map.values()].sort((a, b) => b.amount - a.amount);
    }, [monthItems, accountById]);

    const filtered = monthItems.filter(b => {
        if (filter !== 'all' && b.payment_status !== filter) return false;
        if (methodFilter !== 'all' && (b.payment_status !== 'paid' || resolvePaymentMethod(b) !== methodFilter)) return false;
        if (search && !b.room_number.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    const overdueItems = useMemo(() => {
        const items: PayableItem[] = [];
        bills.filter(b => b.is_saved && b.month < currentMonth && (b.payment_status || 'unpaid') !== 'paid').forEach(b => {
           items.push({ id: b.id, type: 'bill', room_number: b.room_number, room_id: b.room_id, month: b.month, total_amount: b.total_bill, payment_status: b.payment_status || 'unpaid', title: 'บิลค่าเช่า' });
        });
        fines.filter(f => f.date.substring(0,7) < currentMonth && (f.status || 'unpaid') !== 'paid').forEach(f => {
           items.push({ id: f.id, type: 'fine', room_number: f.room_number, room_id: f.room_id, month: f.date.substring(0,7), total_amount: f.amount, payment_status: f.status || 'unpaid', title: 'ค่าปรับ: ' + f.reason });
        });
        return items.sort((a, b) => a.month.localeCompare(b.month));
    }, [bills, fines, currentMonth]);

    const selectableItems = filtered.filter(b => b.payment_status !== 'paid');
    const allSelected = selectableItems.length > 0 && selectableItems.every(b => selected.has(b.id));
    const toggleSelectAll = () => {
        if (allSelected) setSelected(new Set());
        else setSelected(new Set(selectableItems.map(b => b.id)));
    };
    const toggleSelect = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // Bulk confirm: pick one method for every selected item, then write them all.
    const bulkConfirmPaid = () => {
        const items = [...selected].map(id => filtered.find(x => x.id === id)).filter((x): x is PayableItem => !!x);
        if (items.length > 0) setPayModal(items);
    };

    /** Persist a confirmed payment for every item, with the method details the user entered. */
    const applyPayment = async (items: PayableItem[], fields: PaymentRecordFields) => {
        const bulk = items.length > 1;
        setBulkProcessing(bulk);
        if (!bulk) setProcessingId(items[0].id);
        try {
            await Promise.all(items.map(async item => {
                const record = { ...fields, paid_amount: fields.paid_amount ?? item.total_amount };
                if (item.type === 'bill') {
                    await onUpdatePayment(item.id, { ...record, payment_status: 'paid' });
                    void notifyTenantPaid(item.originalBill!);
                } else {
                    await updateDoc(doc(db, `users/${uid}/buildings/${buildingId}/fines/${item.id}`), { ...record, status: 'paid' });
                    logActivity({
                        action: 'PAYMENT_MODIFY', resourceType: 'payment', resourceId: item.id,
                        resourceLabel: `Room ${item.room_number} ${item.title}`,
                        before: { status: item.payment_status },
                        after: { status: 'paid', payment_method: record.payment_method, paid_amount: record.paid_amount },
                    });
                }
            }));
            setSelected(new Set());
            setPayModal(null);
        } finally {
            setBulkProcessing(false);
            setProcessingId(null);
        }
    };

    const exportCSV = () => {
        const THAI_STATUS: Record<PaymentStatus, string> = { paid: 'จ่ายแล้ว', pending: 'รอตรวจสอบ', unpaid: 'ยังไม่จ่าย' };
        const rows = [
            ['เดือน', 'ห้อง', 'ประเภท', 'รายการ', 'ค่าไฟ (หน่วย)', 'ค่าไฟ (บาท)', 'ค่าน้ำ (หน่วย)', 'ค่าน้ำ (บาท)', 'ค่าเช่า (บาท)', 'ค่าส่วนกลาง (บาท)', 'รวม (บาท)', 'สถานะ', 'ยอดสลิป', 'วันที่ชำระ', 'วิธีชำระเงิน', 'ยอดที่รับ', 'ผู้รับเงิน', 'เลขอ้างอิง'],
            ...monthItems.map(b => [
                monthLabel(b.month),
                b.room_number,
                b.type === 'bill' ? 'บิลรายเดือน' : 'ค่าปรับ',
                b.title,
                b.type === 'bill' ? b.originalBill?.elec_units : '',
                b.type === 'bill' ? b.originalBill?.elec_bill : '',
                b.type === 'bill' ? b.originalBill?.water_units : '',
                b.type === 'bill' ? b.originalBill?.water_bill : '',
                b.type === 'bill' ? b.originalBill?.room_rent : '',
                b.type === 'bill' ? (b.originalBill?.common_fee || 0) : '',
                b.total_amount,
                THAI_STATUS[b.payment_status],
                b.slip_amount ?? '',
                b.paid_at ? new Date(b.paid_at).toLocaleDateString('th-TH') : '',
                b.payment_status === 'paid' ? PAYMENT_METHOD_LABELS[resolvePaymentMethod(b)] : '',
                b.payment_status === 'paid' ? (b.paid_amount ?? b.total_amount) : '',
                b.received_by ?? '',
                b.transaction_ref ?? b.slip_ref ?? '',
            ]),
        ];
        const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `payments_${currentMonth}_${dormName}.csv`;
        a.click();
        logActivity({ action: 'EXPORT', resourceType: 'payment', resourceLabel: `Payments ${currentMonth}`, note: `${monthItems.length} rows` });
    };

    const notifyTenantPaid = async (b: MonthlyBill) => {
        if (!uid || !buildingId) return;
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) return;
            await fetch('/api/notify-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ building_id: buildingId, bill_id: b.id }),
            });
        } catch (err) {
            console.warn('notify-payment failed:', err);
        }
    };

    const confirmPaid = (item: PayableItem) => setPayModal([item]);

    const undoPaid = async (item: PayableItem) => {
        if (!confirm(`ยกเลิกสถานะจ่ายของห้อง ${item.room_number}?`)) return;
        setProcessingId(item.id);
        try {
            const status = item.slip_submitted_at ? 'pending' : 'unpaid';
            if (item.type === 'bill') {
                await onUpdatePayment(item.id, { payment_status: status, paid_at: '', paid_method: 'manual' });
            } else {
                await updateDoc(doc(db, `users/${uid}/buildings/${buildingId}/fines/${item.id}`), { status, paid_at: '', paid_method: 'manual' });
                logActivity({
                    action: 'PAYMENT_MODIFY', resourceType: 'payment', resourceId: item.id,
                    resourceLabel: `Room ${item.room_number} ${item.title}`,
                    before: { status: 'paid', payment_method: item.payment_method }, after: { status }, note: 'undo paid',
                });
            }
        } finally { setProcessingId(null); }
    };

    const openSlip = async (item: PayableItem) => {
        if (!item.slip_image && !item.slip_path) return;
        setSlipView({ loading: true, item });
        try {
            if (item.slip_image && uid && buildingId) {
                const snap = await getDoc(doc(db, `users/${uid}/buildings/${buildingId}/slip_images/${item.id}`));
                const url = snap.data()?.data_url as string | undefined;
                if (url) { setSlipView({ url, loading: false, item }); return; }
            }
            if (item.slip_path) {
                const url = await getDownloadURL(ref(storage, item.slip_path));
                setSlipView({ url, loading: false, item });
                return;
            }
            setSlipView({ loading: false, error: 'ไม่พบรูปสลิป', item });
        } catch {
            setSlipView({ loading: false, error: 'โหลดรูปสลิปไม่ได้', item });
        }
    };

    const statCards = [
        { label: 'เก็บได้แล้ว', value: `฿${stats.collected.toLocaleString()}`, sub: `${stats.paid} รายการ`, icon: TrendingUp, color: '#059669', bg: 'rgba(16,185,129,0.1)' },
        { label: 'ค้างชำระ', value: `฿${stats.outstanding.toLocaleString()}`, sub: `${stats.unpaid + stats.pending} รายการ`, icon: Wallet, color: '#DC2626', bg: 'rgba(220,38,38,0.08)' },
        { label: 'รอตรวจสลิป', value: `${stats.pending}`, sub: 'รายการ', icon: Clock, color: '#D97706', bg: 'rgba(245,158,11,0.1)' },
        { label: 'ทั้งหมด', value: `${stats.total}`, sub: 'รายการ', icon: Receipt, color: '#6366F1', bg: 'rgba(99,102,241,0.1)' },
    ];

    const filterTabs: { key: FilterKey; label: string; count: number }[] = [
        { key: 'all', label: 'ทั้งหมด', count: stats.total },
        { key: 'unpaid', label: 'ยังไม่จ่าย', count: stats.unpaid },
        { key: 'pending', label: 'รอตรวจสอบ', count: stats.pending },
        { key: 'paid', label: 'จ่ายแล้ว', count: stats.paid },
    ];

    return (
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                    <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-gray-800)', margin: 0 }}>
                        <Wallet size={24} color="#6366F1" /> การชำระเงิน / สลิป
                    </h1>
                    <p style={{ margin: '0.25rem 0 0', color: 'var(--color-gray-500)', fontSize: '0.875rem' }}>
                        {dormName} · รอบ {monthLabel(currentMonth)}
                    </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                        className="btn btn-outline btn-sm"
                        onClick={() => setShowAccounts(true)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
                        title="จัดการบัญชีธนาคารที่รับเงินโอน"
                    >
                        <Landmark size={15} /> บัญชีรับเงิน{activeAccounts.length > 0 ? ` (${activeAccounts.length})` : ''}
                    </button>
                    <button
                        className="btn btn-outline btn-sm"
                        onClick={() => setShowRecon(true)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
                        title="กระทบยอดกับรายการเงินเข้าบัญชีจริง"
                    >
                        <ShieldCheck size={15} /> กระทบยอด{reconPending > 0 ? ` (${reconPending})` : ''}
                    </button>
                    {monthItems.length > 0 && (
                        <button
                            className="btn btn-outline btn-sm"
                            onClick={exportCSV}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
                            title="ดาวน์โหลดข้อมูลการชำระเงินเป็น CSV"
                        >
                            <Download size={15} /> Export CSV
                        </button>
                    )}
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
            </div>

            {overdueItems.length > 0 && (
                <div style={{
                    background: 'rgba(239,68,68,0.07)', border: '1.5px solid rgba(239,68,68,0.25)',
                    borderRadius: 'var(--radius-lg)', padding: '0.875rem 1rem',
                    marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                }}>
                    <TriangleAlert size={18} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />
                    <div>
                        <div style={{ fontWeight: 700, color: '#B91C1C', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                            มีรายการค้างชำระจากเดือนก่อน ({overdueItems.length} รายการ)
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {overdueItems.map(b => (
                                <span key={b.id} style={{
                                    fontSize: '0.75rem', fontWeight: 600,
                                    background: 'rgba(239,68,68,0.12)', color: '#B91C1C',
                                    borderRadius: 6, padding: '0.15rem 0.5rem',
                                }}>
                                    ห้อง {b.room_number} · {b.type === 'fine' ? '(ค่าปรับ)' : monthLabel(b.month)} · ฿{b.total_amount.toLocaleString()}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            )}

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

            {stats.paid > 0 && (
                <div className="card" style={{ padding: '0.875rem 1rem', marginBottom: '1.25rem' }}>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-gray-700)', marginBottom: '0.5rem' }}>
                        รายรับแยกตามวิธีชำระ
                        <span style={{ fontWeight: 500, color: 'var(--color-gray-500)' }}> · รวม ฿{stats.collected.toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem' }}>
                        {PAYMENT_METHODS.map(m => {
                            const on = methodFilter === m;
                            return (
                                <button
                                    key={m} type="button" aria-pressed={on}
                                    onClick={() => { setMethodFilter(on ? 'all' : m); if (!on) setFilter('paid'); }}
                                    style={{
                                        textAlign: 'left', cursor: 'pointer', padding: '0.5rem 0.75rem', borderRadius: 10,
                                        border: `1.5px solid ${on ? '#6366F1' : 'var(--color-gray-200)'}`,
                                        background: on ? 'rgba(99,102,241,0.08)' : 'transparent',
                                    }}
                                >
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>{PAYMENT_METHOD_LABELS[m]} · {methodTotals[m].count} รายการ</div>
                                    <div style={{ fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--color-gray-800)' }}>฿{methodTotals[m].amount.toLocaleString()}</div>
                                </button>
                            );
                        })}
                    </div>
                    {accountTotals.length > 0 && (
                        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-gray-600)' }}>เงินโอนแยกตามบัญชี</div>
                            {accountTotals.map(r => (
                                <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem' }}>
                                    <BankLogo short={r.short} size={22} />
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                                    <span style={{ color: 'var(--color-gray-500)' }}>{r.count} รายการ</span>
                                    <b className="mono">฿{r.amount.toLocaleString()}</b>
                                </div>
                            ))}
                        </div>
                    )}
                    {methodFilter !== 'all' && (
                        <button className="btn btn-outline btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => setMethodFilter('all')}>
                            <X size={12} /> ล้างตัวกรองวิธีชำระ ({PAYMENT_METHOD_LABELS[methodFilter]})
                        </button>
                    )}
                </div>
            )}

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

            {selectableItems.length > 0 && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
                    marginBottom: '0.75rem', padding: '0.625rem 0.875rem',
                    background: selected.size > 0 ? 'rgba(99,102,241,0.07)' : 'var(--color-gray-50)',
                    borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)',
                    transition: 'background 0.2s',
                }}>
                    <button
                        onClick={toggleSelectAll}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--color-gray-600)', fontSize: '0.8125rem', fontWeight: 600, padding: 0 }}
                    >
                        {allSelected ? <CheckSquare size={17} color="#6366F1" /> : <Square size={17} />}
                        {allSelected ? 'ยกเลิกเลือกทั้งหมด' : 'เลือกทั้งหมด'}
                    </button>
                    {selected.size > 0 && (
                        <>
                            <span style={{ fontSize: '0.8125rem', color: '#6366F1', fontWeight: 700 }}>เลือกแล้ว {selected.size} รายการ</span>
                            <button
                                onClick={bulkConfirmPaid}
                                disabled={bulkProcessing}
                                style={{
                                    marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                                    padding: '0.4rem 0.875rem', borderRadius: 'var(--radius-md)', border: 'none',
                                    background: '#059669', color: '#fff', fontWeight: 700, fontSize: '0.8125rem', cursor: 'pointer',
                                    opacity: bulkProcessing ? 0.6 : 1,
                                }}
                            >
                                {bulkProcessing ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                                ยืนยันจ่ายทั้งหมด ({selected.size})
                            </button>
                        </>
                    )}
                </div>
            )}

            {monthItems.length === 0 ? (
                <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-gray-500)' }}>
                    <Receipt size={40} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
                    <div>ยังไม่มีรายการในรอบ {monthLabel(currentMonth)}</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                    {filtered.map(b => {
                        const s = b.payment_status;
                        const meta = STATUS_META[s];
                        const busy = processingId === b.id;
                        const isSelectable = s !== 'paid';
                        const isSelected = selected.has(b.id);
                        return (
                            <div key={b.id} className="card" style={{ padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap', outline: isSelected ? '2px solid #6366F1' : 'none', outlineOffset: -1 }}>
                                {isSelectable ? (
                                    <button onClick={() => toggleSelect(b.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, color: isSelected ? '#6366F1' : 'var(--color-gray-300)' }}>
                                        {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                                    </button>
                                ) : (
                                    <span style={{ width: 18, flexShrink: 0 }} />
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 180 }}>
                                    <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--color-gray-100)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <span style={{ fontSize: '0.65rem', color: 'var(--color-gray-400)', lineHeight: 1 }}>ห้อง</span>
                                        <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--color-gray-800)', lineHeight: 1.2 }}>{b.room_number}</span>
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 2 }}>
                                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-gray-500)', background: 'var(--color-gray-100)', padding: '0.1rem 0.4rem', borderRadius: 4 }}>
                                            {b.type === 'bill' ? 'บิลรายเดือน' : <span style={{display: 'inline-flex', alignItems: 'center', gap: 2}}><AlertTriangle size={11}/> ค่าปรับ</span>}
                                          </span>
                                        </div>
                                        <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--color-gray-800)', fontFamily: 'var(--font-mono)' }}>฿{b.total_amount.toLocaleString()}</div>
                                        {b.slip_submitted_at && (
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 2, fontSize: '0.72rem', color: 'var(--color-gray-500)' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Receipt size={11} />ส่งสลิปแล้ว</span>
                                                {b.slip_ref && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#059669', fontWeight: 700 }}><CheckCircle2 size={11} />QR Verified</span>}
                                                {b.slip_amount != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Banknote size={11} />฿{b.slip_amount.toLocaleString()}</span>}
                                                {b.slip_sender && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><User size={11} />{b.slip_sender}</span>}
                                            </div>
                                        )}
                                        {b.slip_checks && <div style={{ marginTop: 4 }}><SlipChecksPanel checks={b.slip_checks} compact /></div>}
                                        {s === 'pending' && b.verify_note && (() => {
                                            const good = b.verify_note.startsWith('ตรวจ QR ผ่าน');
                                            return (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.72rem', color: good ? '#059669' : '#D97706', marginTop: 2 }}>
                                                    {good ? <CheckCircle2 size={11} /> : <TriangleAlert size={11} />}
                                                    {b.verify_note}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`, borderRadius: 999, padding: '0.25rem 0.7rem', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                    <meta.icon size={13} /> {meta.label}
                                </span>
                                {s === 'paid' && (
                                    <span
                                        title={[b.received_by && `ผู้รับ: ${b.received_by}`, b.transaction_ref && `อ้างอิง: ${b.transaction_ref}`,
                                            b.verification_status && VERIFICATION_LABELS[b.verification_status]].filter(Boolean).join(' · ') || undefined}
                                        style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-gray-600)', background: 'var(--color-gray-100)', borderRadius: 999, padding: '0.2rem 0.55rem', whiteSpace: 'nowrap' }}
                                    >
                                        {resolvePaymentMethod(b) === 'bank_transfer' && (() => {
                                            const acc = b.bank_account_id ? accountById.get(b.bank_account_id) : undefined;
                                            return acc ? <span style={{ marginRight: 5, verticalAlign: 'middle', display: 'inline-flex' }}><BankLogo short={acc.bank_short} size={16} /></span> : null;
                                        })()}
                                        {PAYMENT_METHOD_LABELS[resolvePaymentMethod(b)]}
                                        {b.verification_status === 'verified' ? ' ✓' : ''}
                                    </span>
                                )}
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

            {payModal && (
                <PaymentMethodModal
                    labels={payModal.map(i => `ห้อง ${i.room_number} · ${i.title}`)}
                    amount={payModal.length === 1 ? payModal[0].total_amount : undefined}
                    defaultMethod={payModal.length === 1 && (payModal[0].slip_image || payModal[0].slip_path) ? 'bank_transfer' : 'cash'}
                    defaultReference={payModal.length === 1 ? (payModal[0].slip_ref ?? '') : ''}
                    receiverName={auth.currentUser?.displayName || auth.currentUser?.email || ''}
                    accounts={activeAccounts}
                    defaultAccountId={payModal.length === 1 ? payModal[0].slip_account_id : undefined}
                    onConfirm={fields => applyPayment(payModal, fields)}
                    onClose={() => setPayModal(null)}
                />
            )}

            {showAccounts && uid && buildingId && (
                <BankAccountsModal
                    ownerUid={uid} buildingId={buildingId} accounts={accounts} loading={accountsLoading}
                    canManage={canManageAccounts} onClose={() => setShowAccounts(false)}
                />
            )}

            {showRecon && uid && buildingId && (
                <ReconciliationModal
                    ownerUid={uid} buildingId={buildingId} accounts={activeAccounts} transactions={bankTxs} loading={bankTxsLoading}
                    onClose={() => setShowRecon(false)}
                />
            )}

            {slipView && (
                <>
                    <div onClick={() => setSlipView(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 300, backdropFilter: 'blur(4px)' }} />
                    <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 301, background: 'var(--color-white)', borderRadius: 'var(--radius-xl)', padding: '1rem', width: 'min(440px, 92vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: 'var(--shadow-xl)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                            <strong style={{ color: 'var(--color-gray-800)' }}>สลิปห้อง {slipView.item.room_number}</strong>
                            <button className="btn btn-outline btn-sm btn-icon" onClick={() => setSlipView(null)}><X size={16} /></button>
                        </div>
                        {slipView.loading ? (
                            <div style={{ padding: '3rem', textAlign: 'center' }}><Loader2 size={28} className="spin" style={{ color: '#6366F1' }} /></div>
                        ) : slipView.error ? (
                            <div style={{ padding: '2rem', textAlign: 'center', color: '#DC2626', fontSize: '0.875rem' }}>{slipView.error}</div>
                        ) : (
                            <img src={slipView.url} alt="payment slip" style={{ width: '100%', borderRadius: 'var(--radius-md)', display: 'block' }} />
                        )}
                        {slipView.item.slip_checks && (
                            <SlipChecksPanel
                                checks={slipView.item.slip_checks}
                                expectedAmount={slipView.item.total_amount}
                                read={{
                                    amount: slipView.item.slip_amount, sender: slipView.item.slip_sender, receiverName: slipView.item.slip_receiver_name,
                                    receiverAccount: slipView.item.slip_receiver_account, datetime: slipView.item.slip_datetime,
                                }}
                            />
                        )}
                        {slipView.item.verify_note && (
                            <p style={{ margin: '10px 0 0', fontSize: '0.78rem', color: 'var(--color-gray-600)' }}>{slipView.item.verify_note}</p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
