import { useState, useMemo, useEffect } from 'react';
import {
    Home, Zap, Droplets,
    TrendingUp, TrendingDown, CheckCircle, Clock,
    BarChart3, CheckSquare, FileText, LineChart, Settings, ClipboardList,
    SlidersHorizontal, X, Wallet, CircleDollarSign, AlertCircle, ChevronRight,
    Receipt, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { DormConfig, MonthlyBill, PaymentStatus, Expense } from '../../types';
import { formatCurrency, formatMonthThai, getPreviousMonth } from '../../utils/calculations';
import { useDashboardPrefs, WIDGET_LABELS, type WidgetId } from '../../hooks/useDashboardPrefs';
import NongCarePanel from '../NongCare/NongCarePanel';
import { Bot } from 'lucide-react';

interface DashboardProps {
    config: DormConfig;
    stats: {
        savedCount: number;
        totalRooms: number;
        totalRevenue: number;
        isAllSaved: boolean;
        progress: number;
    };
    currentMonth: string;
    recentBills: MonthlyBill[];
    allBills?: MonthlyBill[];
    uid?: string;
    buildingId?: string;
    buildingName?: string;
    onGoToPayments?: () => void;
    license?: string;
    onUpgrade?: () => void;
}

function statusOf(b: MonthlyBill): PaymentStatus {
    return b.payment_status ?? 'unpaid';
}

// Map expense month from YYYY-MM-DD date to YYYY-MM
function expenseMonth(dateStr: string): string {
    return dateStr.slice(0, 7);
}

export default function Dashboard({
    config, stats, currentMonth, recentBills, allBills = [],
    uid, buildingId, buildingName, onGoToPayments, license, onUpgrade
}: DashboardProps) {
    const [showCustomize, setShowCustomize] = useState(false);
    const [activeTab, setActiveTab] = useState<'overview' | 'ai'>('overview');
    const { allWidgets, toggle, isEnabled } = useDashboardPrefs(uid);

    // ── Fetch expenses (last 6+ months) ──────────────────────────────────────
    const [expenses, setExpenses] = useState<Expense[]>([]);
    useEffect(() => {
        if (!uid || !buildingId) return;
        const unsub = onSnapshot(
            collection(db, `users/${uid}/buildings/${buildingId}/expenses`),
            snap => setExpenses(snap.docs.map(d => ({ ...d.data(), id: d.id } as Expense))),
            () => {},
        );
        return unsub;
    }, [uid, buildingId]);

    const totalElecUnits = recentBills.reduce((sum, b) => sum + b.elec_units, 0);
    const totalWaterUnits = recentBills.reduce((sum, b) => sum + b.water_units, 0);
    const totalElecBill = recentBills.reduce((sum, b) => sum + b.elec_bill, 0);
    const totalWaterBill = recentBills.reduce((sum, b) => sum + (b.water_bill ?? 0) + (b.water_flat_amount ?? 0) + (b.water_excess_amount ?? 0), 0);

    // ── Expense stats for current month ──────────────────────────────────────
    const currentMonthExpenses = useMemo(
        () => expenses.filter(e => expenseMonth(e.date) === currentMonth),
        [expenses, currentMonth],
    );
    const totalExpense = currentMonthExpenses.reduce((s, e) => s + e.amount, 0);

    // Category breakdown of expenses this month
    const expenseByCategory = useMemo(() => {
        const map: Record<string, number> = {};
        for (const e of currentMonthExpenses) {
            map[e.category] = (map[e.category] ?? 0) + e.amount;
        }
        return Object.entries(map).sort((a, b) => b[1] - a[1]);
    }, [currentMonthExpenses]);

    // ── Collection stats ──────────────────────────────────────────────────────
    const collection_ = useMemo(() => {
        const saved = recentBills.filter(b => b.is_saved);
        let projected = 0, collected = 0, paid = 0, pending = 0, unpaid = 0;
        for (const b of saved) {
            projected += b.total_bill;
            const s = statusOf(b);
            if (s === 'paid') { collected += b.total_bill; paid++; }
            else if (s === 'pending') pending++;
            else unpaid++;
        }
        const outstanding = projected - collected;
        const rate = projected > 0 ? Math.round((collected / projected) * 100) : 0;
        return { projected, collected, outstanding, paid, pending, unpaid, rate, total: saved.length };
    }, [recentBills]);

    const netProfit = collection_.collected - totalExpense;

    // ── 6-month trend: revenue + expenses ────────────────────────────────────
    const trend = useMemo(() => {
        const months: string[] = [];
        let m = currentMonth;
        for (let i = 0; i < 6; i++) { months.unshift(m); m = getPreviousMonth(m); }
        const rows = months.map(month => {
            const saved = allBills.filter(b => b.month === month && b.is_saved);
            const projected = saved.reduce((s, b) => s + b.total_bill, 0);
            const collected = saved.filter(b => statusOf(b) === 'paid').reduce((s, b) => s + b.total_bill, 0);
            const expense = expenses
                .filter(e => expenseMonth(e.date) === month)
                .reduce((s, e) => s + e.amount, 0);
            return { month, projected, collected, expense, net: collected - expense };
        });
        const peak = Math.max(1, ...rows.map(r => Math.max(r.projected, r.expense)));
        return { rows, peak };
    }, [allBills, expenses, currentMonth]);

    const hasTrend = trend.rows.some(r => r.projected > 0 || r.expense > 0);

    // Prepare context for AI
    const aiContext = useMemo(() => ({
        month: currentMonth,
        buildingName: buildingName || 'ไม่ระบุ',
        totalRooms: stats.totalRooms,
        savedRooms: stats.savedCount,
        collection: {
            projected: collection_.projected,
            collected: collection_.collected,
            outstanding: collection_.outstanding,
            paidCount: collection_.paid,
            pendingCount: collection_.pending,
            unpaidCount: collection_.unpaid
        },
        expenses: currentMonthExpenses.map(e => ({ item: e.description, amount: e.amount, category: e.category })),
        netProfit: netProfit
    }), [currentMonth, buildingName, stats, collection_, currentMonthExpenses, netProfit]);

    return (
        <div>
            <div className="page-header">
                <div>
                    {/* ชื่อหอพัก — แสดงโดดเด่นให้ผู้ใช้รู้สึกเป็นเจ้าของ */}
                    {buildingName && (
                        <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(168,85,247,0.12))',
                            border: '1px solid rgba(139,92,246,0.3)',
                            borderRadius: '20px',
                            padding: '0.25rem 0.75rem',
                            marginBottom: '0.4rem',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            color: '#A78BFA',
                            letterSpacing: '0.01em',
                        }}>
                            <Home size={12} style={{ opacity: 0.8 }} />
                            {buildingName}
                        </div>
                    )}
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <BarChart3 size={28} /> Dashboard
                    </h1>
                    <p className="page-subtitle">
                        ภาพรวมหอพัก — รอบเดือน {formatMonthThai(currentMonth)}
                    </p>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => setShowCustomize(true)} style={{ visibility: activeTab === 'overview' ? 'visible' : 'hidden' }}>
                    <SlidersHorizontal size={15} /> ปรับแต่ง
                </button>
            </div>

            {/* ── Tabs ── */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-gray-200)', paddingBottom: '0.5rem' }}>
                <button 
                    onClick={() => setActiveTab('overview')}
                    style={{ 
                        background: activeTab === 'overview' ? 'var(--color-primary)' : 'transparent', 
                        color: activeTab === 'overview' ? '#fff' : 'var(--color-gray-600)',
                        border: 'none', padding: '0.5rem 1rem', borderRadius: '999px', fontWeight: 600, cursor: 'pointer',
                        transition: 'var(--transition-fast)'
                    }}
                >
                    ภาพรวมหอพัก
                </button>
                <button 
                    onClick={() => setActiveTab('ai')}
                    style={{ 
                        background: activeTab === 'ai' ? 'var(--color-primary)' : 'transparent', 
                        color: activeTab === 'ai' ? '#fff' : 'var(--color-gray-600)',
                        border: 'none', padding: '0.5rem 1rem', borderRadius: '999px', fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '0.375rem',
                        transition: 'var(--transition-fast)'
                    }}
                >
                    <Bot size={16} /> น้องแคร์ AI
                </button>
            </div>

            {activeTab === 'ai' ? (
                <NongCarePanel 
                    contextData={aiContext} 
                    isPro={license === 'active' || (license || '').includes('large')} 
                    onUpgrade={onUpgrade || (() => {})} 
                />
            ) : (
                <>
            {/* ── Collection overview ── */}
            {isEnabled('collection') && (
                <div className="collection-panel card mb-6">
                    <div className="collection-head">
                        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <CircleDollarSign size={18} /> การเก็บเงินรอบนี้
                        </span>
                        {onGoToPayments && (
                            <button className="collection-link" onClick={onGoToPayments}>
                                จัดการสลิป <ChevronRight size={14} />
                            </button>
                        )}
                    </div>
                    <div className="collection-body">
                        <div className="collection-ring-wrap">
                            <div className="collection-ring" style={{ ['--rate' as string]: `${collection_.rate}` }}>
                                <div className="collection-ring-center">
                                    <span className="collection-ring-pct">{collection_.rate}%</span>
                                    <span className="collection-ring-cap">เก็บได้</span>
                                </div>
                            </div>
                        </div>
                        <div className="collection-figures">
                            <div className="collection-fig">
                                <span className="collection-fig-label"><TrendingUp size={14} /> รายได้คาดการณ์</span>
                                <span className="collection-fig-value">{formatCurrency(collection_.projected)}</span>
                            </div>
                            <div className="collection-fig">
                                <span className="collection-fig-label" style={{ color: 'var(--color-success)' }}><CheckCircle size={14} /> รายได้จริง (เก็บแล้ว)</span>
                                <span className="collection-fig-value" style={{ color: 'var(--color-success)' }}>{formatCurrency(collection_.collected)}</span>
                            </div>
                            <div className="collection-fig">
                                <span className="collection-fig-label" style={{ color: 'var(--color-danger)' }}><AlertCircle size={14} /> ค้างชำระ</span>
                                <span className="collection-fig-value" style={{ color: 'var(--color-danger)' }}>{formatCurrency(collection_.outstanding)}</span>
                            </div>
                            <div className="collection-statusbar">
                                {collection_.total > 0 ? (
                                    <>
                                        <div className="collection-seg paid" style={{ flex: collection_.paid || 0.0001 }} />
                                        <div className="collection-seg pending" style={{ flex: collection_.pending || 0.0001 }} />
                                        <div className="collection-seg unpaid" style={{ flex: collection_.unpaid || 0.0001 }} />
                                    </>
                                ) : <div className="collection-seg empty" style={{ flex: 1 }} />}
                            </div>
                            <div className="collection-legend">
                                <span><i className="dot paid" /> จ่ายแล้ว {collection_.paid}</span>
                                <span><i className="dot pending" /> รอตรวจสอบ {collection_.pending}</span>
                                <span><i className="dot unpaid" /> ยังไม่จ่าย {collection_.unpaid}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Progress Bar ── */}
            {isEnabled('progress') && (
                <div className="card mb-6">
                    <div className="progress-container">
                        <div className="progress-header">
                            <span className="progress-label">
                                {stats.isAllSaved ? (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <CheckSquare size={16} color="#10B981" /> จดครบทุกห้องแล้ว!
                                    </span>
                                ) : (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <FileText size={16} /> สถานะการจดมิเตอร์
                                    </span>
                                )}
                            </span>
                            <span className="progress-value">{stats.savedCount}/{stats.totalRooms} ห้อง</span>
                        </div>
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ transform: `scaleX(${stats.progress / 100})` }} />
                        </div>
                    </div>
                </div>
            )}

            {/* ── Stats Grid ── */}
            {isEnabled('stats') && (
                <div className="stats-grid">
                    <div className="stat-card primary">
                        <div className="stat-icon primary"><Home size={24} /></div>
                        <div className="stat-label">จำนวนห้องทั้งหมด</div>
                        <div className="stat-value">{stats.totalRooms}</div>
                    </div>
                    <div className="stat-card success">
                        <div className="stat-icon success"><TrendingUp size={24} /></div>
                        <div className="stat-label">รายได้คาดการณ์</div>
                        <div className="stat-value">{formatCurrency(stats.totalRevenue)}</div>
                    </div>
                    <div className="stat-card warning">
                        <div className="stat-icon warning"><Zap size={24} /></div>
                        <div className="stat-label">หน่วยไฟฟ้ารวม</div>
                        <div className="stat-value">{totalElecUnits.toLocaleString()}</div>
                        <div className="stat-subvalue">≈ {formatCurrency(totalElecBill)}</div>
                    </div>
                    <div className="stat-card primary">
                        <div className="stat-icon primary"><Droplets size={24} /></div>
                        <div className="stat-label">หน่วยน้ำรวม</div>
                        <div className="stat-value">{totalWaterUnits.toLocaleString()}</div>
                        <div className="stat-subvalue">≈ {formatCurrency(totalWaterBill)}</div>
                    </div>
                </div>
            )}

            {/* ── Expense Summary & Net Profit ── */}
            {isEnabled('expense_summary') && (
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Receipt size={18} /> ค่าใช้จ่าย & กำไร — {formatMonthThai(currentMonth)}
                        </span>
                    </div>

                    {/* 3-column summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: expenseByCategory.length > 0 ? '1rem' : 0 }}>
                        <div style={{ background: '#F0FDF4', borderRadius: '12px', padding: '0.875rem', border: '1px solid #BBF7D0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: '#059669', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.375rem' }}>
                                <ArrowUpRight size={14} /> รายได้จริง
                            </div>
                            <div style={{ fontWeight: 800, fontSize: '1.0625rem', color: 'var(--color-gray-800)' }}>{formatCurrency(collection_.collected)}</div>
                        </div>
                        <div style={{ background: 'var(--color-danger-ultra-light)', borderRadius: '12px', padding: '0.875rem', border: '1px solid var(--color-danger-light)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--color-danger)', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.375rem' }}>
                                <ArrowDownRight size={14} /> ค่าใช้จ่าย
                            </div>
                            <div style={{ fontWeight: 800, fontSize: '1.0625rem', color: 'var(--color-gray-800)' }}>{formatCurrency(totalExpense)}</div>
                        </div>
                        <div style={{
                            background: netProfit >= 0 ? 'var(--color-primary-ultra-light)' : 'var(--color-danger-ultra-light)',
                            borderRadius: '12px', padding: '0.875rem',
                            border: `1px solid ${netProfit >= 0 ? 'var(--color-primary-light)' : 'var(--color-danger-light)'}`,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: netProfit >= 0 ? 'var(--color-primary)' : 'var(--color-danger)', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.375rem' }}>
                                {netProfit >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                กำไรสุทธิ
                            </div>
                            <div style={{ fontWeight: 800, fontSize: '1.0625rem', color: netProfit >= 0 ? 'var(--color-primary)' : 'var(--color-danger)' }}>
                                {netProfit >= 0 ? '' : '−'}{formatCurrency(Math.abs(netProfit))}
                            </div>
                        </div>
                    </div>

                    {/* Expense breakdown by category */}
                    {expenseByCategory.length > 0 && (
                        <div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                                ค่าใช้จ่ายตามหมวด
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                                {expenseByCategory.map(([cat, amount]) => {
                                    const pct = totalExpense > 0 ? (amount / totalExpense) * 100 : 0;
                                    return (
                                        <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                                            <span style={{ fontSize: '0.8125rem', color: 'var(--color-gray-700)', width: 120, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>
                                            <div style={{ flex: 1, height: 8, background: 'var(--color-gray-200)', borderRadius: 4, overflow: 'hidden' }}>
                                                <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#F87171,#EF4444)', borderRadius: 4, transition: 'width 0.4s' }} />
                                            </div>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-gray-700)', width: 80, textAlign: 'right', flexShrink: 0 }}>{formatCurrency(amount)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {currentMonthExpenses.length === 0 && !buildingId && (
                        <p style={{ fontSize: '0.8125rem', color: '#9CA3AF', margin: 0, textAlign: 'center' }}>
                            ยังไม่มีค่าใช้จ่ายเดือนนี้ — บันทึกได้ที่หน้า "ระบบจัดการ"
                        </p>
                    )}
                    {currentMonthExpenses.length === 0 && buildingId && (
                        <p style={{ fontSize: '0.8125rem', color: '#9CA3AF', margin: 0, textAlign: 'center' }}>
                            ยังไม่มีค่าใช้จ่ายเดือนนี้
                        </p>
                    )}
                </div>
            )}

            {/* ── Revenue vs Expense Trend ── */}
            {isEnabled('revenue_trend') && hasTrend && (
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <BarChart3 size={18} /> รายได้ vs ค่าใช้จ่าย ย้อนหลัง 6 เดือน
                        </span>
                        <div className="trend-legend">
                            <span><i className="dot projected" /> คาดการณ์</span>
                            <span><i className="dot collected" /> เก็บได้จริง</span>
                            <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#F87171', marginRight: 2 }} /> ค่าใช้จ่าย</span>
                        </div>
                    </div>
                    <div className="trend-chart">
                        {trend.rows.map(r => {
                            const ph = Math.round((r.projected / trend.peak) * 100);
                            const eh = Math.round((r.expense / trend.peak) * 100);
                            const hasData = r.projected > 0 || r.expense > 0;
                            return (
                                <div key={r.month} className={`trend-col ${r.month === currentMonth ? 'current' : ''}`}>
                                    <div className="trend-bars" style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 3 }}
                                        title={`${formatMonthThai(r.month)} · คาดการณ์ ${formatCurrency(r.projected)} · เก็บได้ ${formatCurrency(r.collected)} · ค่าใช้จ่าย ${formatCurrency(r.expense)}`}>
                                        {/* Revenue bar (projected + collected overlay) */}
                                        <div style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                                            <div className="trend-bar projected" style={{ height: `${ph}%`, width: '100%' }}>
                                                <div className="trend-bar collected" style={{ height: `${r.projected > 0 ? (r.collected / r.projected) * 100 : 0}%` }} />
                                            </div>
                                        </div>
                                        {/* Expense bar */}
                                        <div style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                                            <div style={{
                                                width: '100%', height: `${eh}%`,
                                                background: 'linear-gradient(to top, #EF4444, #F87171)',
                                                borderRadius: '3px 3px 0 0', minHeight: eh > 0 ? 2 : 0,
                                                opacity: 0.85,
                                            }} />
                                        </div>
                                    </div>
                                    <div className="trend-amount">{hasData ? `฿${Math.round(r.projected / 1000)}k` : '–'}</div>
                                    <div className="trend-month">{formatMonthThai(r.month)}</div>
                                    {/* Net profit label */}
                                    {(r.collected > 0 || r.expense > 0) && (
                                        <div style={{
                                            fontSize: '0.6rem', fontWeight: 700, textAlign: 'center', marginTop: '0.1rem',
                                            color: r.net >= 0 ? '#059669' : '#DC2626',
                                        }}>
                                            {r.net >= 0 ? '+' : ''}{Math.round(r.net / 1000)}k
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Revenue Breakdown Chart ── */}
            {isEnabled('revenue_chart') && stats.totalRevenue > 0 && (
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <LineChart size={18} /> สัดส่วนรายได้
                        </span>
                    </div>
                    <div className="chart-container">
                        {(() => {
                            const totalRoomRent = recentBills.reduce((sum, b) => sum + b.room_rent, 0);
                            const total = totalElecBill + totalWaterBill + totalRoomRent;
                            const elecPct   = total > 0 ? (totalElecBill   / total) * 100 : 0;
                            const waterPct  = total > 0 ? (totalWaterBill  / total) * 100 : 0;
                            const rentPct   = total > 0 ? (totalRoomRent   / total) * 100 : 0;
                            const expPct    = total > 0 ? (totalExpense     / total) * 100 : 0;
                            return (
                                <>
                                    <div className="chart-bar-group">
                                        <div className="chart-bar-label"><span className="chart-dot rent" /><span>ค่าห้อง</span></div>
                                        <div className="chart-bar-wrapper"><div className="chart-bar rent" style={{ width: `${rentPct}%` }} /></div>
                                        <div className="chart-bar-value">{formatCurrency(totalRoomRent)}<span className="chart-percent">({rentPct.toFixed(0)}%)</span></div>
                                    </div>
                                    <div className="chart-bar-group">
                                        <div className="chart-bar-label"><span className="chart-dot elec" /><span>ค่าไฟฟ้า</span></div>
                                        <div className="chart-bar-wrapper"><div className="chart-bar elec" style={{ width: `${elecPct}%` }} /></div>
                                        <div className="chart-bar-value">{formatCurrency(totalElecBill)}<span className="chart-percent">({elecPct.toFixed(0)}%)</span></div>
                                    </div>
                                    <div className="chart-bar-group">
                                        <div className="chart-bar-label"><span className="chart-dot water" /><span>ค่าน้ำ</span></div>
                                        <div className="chart-bar-wrapper"><div className="chart-bar water" style={{ width: `${waterPct}%` }} /></div>
                                        <div className="chart-bar-value">{formatCurrency(totalWaterBill)}<span className="chart-percent">({waterPct.toFixed(0)}%)</span></div>
                                    </div>
                                    {totalExpense > 0 && (
                                        <div className="chart-bar-group">
                                            <div className="chart-bar-label">
                                                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#EF4444', marginRight: 6 }} />
                                                <span style={{ color: '#DC2626' }}>ค่าใช้จ่าย</span>
                                            </div>
                                            <div className="chart-bar-wrapper">
                                                <div style={{ height: '100%', width: `${expPct}%`, background: 'linear-gradient(90deg,#F87171,#EF4444)', borderRadius: 4 }} />
                                            </div>
                                            <div className="chart-bar-value" style={{ color: '#DC2626' }}>{formatCurrency(totalExpense)}<span className="chart-percent">({expPct.toFixed(0)}%)</span></div>
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* ── Rate Configuration Summary ── */}
            {isEnabled('rate_config') && (
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Settings size={18} /> อัตราค่าบริการปัจจุบัน
                        </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                        <div>
                            <div className="stat-label">ค่าไฟฟ้า</div>
                            <div className="stat-value" style={{ fontSize: '1.25rem' }}>{config.electricity_rate} บาท/หน่วย</div>
                        </div>
                        <div>
                            <div className="stat-label">ค่าน้ำประปา</div>
                            <div className="stat-value" style={{ fontSize: '1.25rem' }}>
                                {config.water_config.unit_rate || config.water_config.excess_unit_rate} บาท/หน่วย
                            </div>
                        </div>
                        <div>
                            <div className="stat-label">ค่าเช่าห้องเริ่มต้น</div>
                            <div className="stat-value" style={{ fontSize: '1.25rem' }}>{formatCurrency(config.room_rent)}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Recent Bills ── */}
            {isEnabled('recent_bills') && recentBills.length > 0 && (
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <ClipboardList size={18} /> รายการล่าสุด
                        </span>
                    </div>
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>ห้อง</th>
                                    <th className="text-right">ค่าไฟ</th>
                                    <th className="text-right">ค่าน้ำ</th>
                                    <th className="text-right">ยอดรวม</th>
                                    <th className="text-center">การชำระ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentBills.slice(0, 5).map(bill => {
                                    const s = statusOf(bill);
                                    return (
                                        <tr key={bill.id}>
                                            <td className="mono">{bill.room_number}</td>
                                            <td className="text-right mono">{formatCurrency(bill.elec_bill)}</td>
                                            <td className="text-right mono">{formatCurrency(bill.water_bill)}</td>
                                            <td className="text-right mono font-bold">{formatCurrency(bill.total_bill)}</td>
                                            <td className="text-center">
                                                {!bill.is_saved ? (
                                                    <span className="badge badge-gray"><Clock size={12} /> รอบันทึก</span>
                                                ) : s === 'paid' ? (
                                                    <span className="badge badge-success"><CheckCircle size={12} /> จ่ายแล้ว</span>
                                                ) : s === 'pending' ? (
                                                    <span className="badge badge-warning"><Clock size={12} /> รอตรวจสอบ</span>
                                                ) : (
                                                    <span className="badge badge-danger"><Wallet size={12} /> ยังไม่จ่าย</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            </>
            )}

            {/* ── Customize Panel ── */}
            {showCustomize && (
                <div className="modal-overlay" onClick={() => setShowCustomize(false)}>
                    <div className="modal dashboard-customize-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <SlidersHorizontal size={18} /> ปรับแต่ง Dashboard
                            </h3>
                            <button className="btn-icon" onClick={() => setShowCustomize(false)}><X size={18} /></button>
                        </div>
                        <div className="modal-body">
                            <p className="customize-hint">เลือกส่วนที่ต้องการแสดงบน Dashboard</p>
                            <div className="widget-toggle-list">
                                {allWidgets.map((id: WidgetId) => (
                                    <label key={id} className="widget-toggle-row">
                                        <div className="widget-toggle-info">
                                            <span className="widget-toggle-label">{WIDGET_LABELS[id]}</span>
                                        </div>
                                        <div
                                            className={`toggle-switch ${isEnabled(id) ? 'active' : ''}`}
                                            onClick={() => toggle(id)}
                                            role="switch"
                                            aria-checked={isEnabled(id)}
                                        >
                                            <div className="toggle-thumb" />
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-primary" onClick={() => setShowCustomize(false)}>เสร็จสิ้น</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
