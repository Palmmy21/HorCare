import { useState, useMemo, useEffect } from 'react';
import {
    Zap, Droplets, Home, CheckCircle2, Clock, Gauge, Send,
    SlidersHorizontal, X, ChevronRight, Bot,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { DormConfig, MonthlyBill, PaymentStatus, Expense, Room } from '../../types';
import { formatCurrency, formatMonthThai, getPreviousMonth } from '../../utils/calculations';
import { useDashboardPrefs, WIDGET_LABELS, type WidgetId } from '../../hooks/useDashboardPrefs';
import { getWorkspaceTerms } from '../../utils/workspaceTerminology';
import NongCarePanel from '../NongCare/NongCarePanel';
import RoomStatusDashboard from '../RoomManagement/RoomStatusDashboard';
import { BarChart, DonutChart, Legend } from '../Accounting/charts';
import { useCountUp } from '../../hooks/useCountUp';
import { useRoomOccupancy } from '../../hooks/useRoomOccupancy';
import { canOpenView } from '../../shared/viewAccess';
import type { Permission } from '../../shared/permissions';

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
    rooms?: Room[];
    /** Opens a room's tenant profile (Tenants page). Omitted when the account cannot open that page. */
    onOpenRoom?: (room: Room) => void;
    /** Staff permissions; null for the owner. */
    permissions?: readonly Permission[] | null;
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

const waterOf = (b: MonthlyBill) => (b.water_bill ?? 0) + (b.water_flat_amount ?? 0) + (b.water_excess_amount ?? 0);

/** Axis labels for the trend chart: values arrive in satang (chart convention), shown as compact baht. */
const axisBaht = (satang: number) => {
    const b = satang / 100;
    return b >= 1000 ? `${(b / 1000).toFixed(b >= 10_000 ? 0 : 1)}k` : String(Math.round(b));
};
const tipBaht = (satang: number) => formatCurrency(satang / 100);

export default function Dashboard({
    config, stats, currentMonth, recentBills, allBills = [],
    rooms, onOpenRoom, permissions = null,
    uid, buildingId, buildingName, onGoToPayments, license, onUpgrade
}: DashboardProps) {
    const [showCustomize, setShowCustomize] = useState(false);
    const [activeTab, setActiveTab] = useState<'overview' | 'ai'>('overview');
    const { allWidgets, toggle, isEnabled } = useDashboardPrefs(uid);
    const dormLogo = config?.bill_customization?.dorm_logo;
    const terms = getWorkspaceTerms(config?.building_type);
    const showRoomMap = isEnabled('room_status') && !!rooms && rooms.length > 0;
    const { byRoom: occupancy } = useRoomOccupancy(uid, buildingId, showRoomMap ? rooms! : [], {
        leasing: showRoomMap && canOpenView('leasing', permissions),
        tenants: showRoomMap && canOpenView('tenants', permissions),
    });

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
        let projected = 0, collected = 0, pendingAmt = 0, unpaidAmt = 0, paid = 0, pending = 0, unpaid = 0, notified = 0;
        const pendingRooms: string[] = [], unpaidRooms: string[] = [];
        for (const b of saved) {
            projected += b.total_bill;
            if (b.is_notified) notified++;
            const s = statusOf(b);
            if (s === 'paid') { collected += b.total_bill; paid++; }
            else if (s === 'pending') { pendingAmt += b.total_bill; pending++; pendingRooms.push(b.room_number); }
            else { unpaidAmt += b.total_bill; unpaid++; unpaidRooms.push(b.room_number); }
        }
        const byRoom = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true });
        pendingRooms.sort(byRoom);
        unpaidRooms.sort(byRoom);
        const outstanding = projected - collected;
        const rate = projected > 0 ? Math.round((collected / projected) * 100) : 0;
        return { projected, collected, outstanding, pendingAmt, unpaidAmt, paid, pending, unpaid, notified, pendingRooms, unpaidRooms, rate, total: saved.length, saved };
    }, [recentBills]);

    const netProfit = collection_.collected - totalExpense;

    // ── 6-month trend: revenue + expenses ────────────────────────────────────
    const trend = useMemo(() => {
        const months: string[] = [];
        let m = currentMonth;
        for (let i = 0; i < 6; i++) { months.unshift(m); m = getPreviousMonth(m); }
        return months.map(month => {
            const saved = allBills.filter(b => b.month === month && b.is_saved);
            const projected = saved.reduce((s, b) => s + b.total_bill, 0);
            const collected = saved.filter(b => statusOf(b) === 'paid').reduce((s, b) => s + b.total_bill, 0);
            const expense = expenses
                .filter(e => expenseMonth(e.date) === month)
                .reduce((s, e) => s + e.amount, 0);
            return { month, projected, collected, expense };
        });
    }, [allBills, expenses, currentMonth]);

    const hasTrend = trend.some(r => r.projected > 0 || r.expense > 0);
    const hasExpenseHistory = trend.some(r => r.expense > 0);

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

    const showMoney = isEnabled('collection');
    const showTodo = isEnabled('progress');
    const unit = terms.unitName;

    // Collection bar: the month's billed money split by where it stands
    const moneySegs = [
        { key: 'paid', label: 'จ่ายแล้ว', count: collection_.paid, amount: collection_.collected, rooms: [] as string[] },
        { key: 'pending', label: 'รอตรวจสลิป', count: collection_.pending, amount: collection_.pendingAmt, rooms: collection_.pendingRooms },
        { key: 'unpaid', label: 'ยังไม่จ่าย', count: collection_.unpaid, amount: collection_.unpaidAmt, rooms: collection_.unpaidRooms },
    ] as const;
    const roomList = (list: string[]) =>
        list.length <= 4 ? list.join(', ') : `${list.slice(0, 4).join(', ')} +${list.length - 4}`;

    // The billing cycle as steps: record meters → save bills → send via LINE. Each draws the same cycle bar.
    const cycleSteps = [
        ...(terms.usesMeters ? [{ key: 'meter', label: terms.meterRecordingLabel, done: stats.savedCount, of: stats.totalRooms }] : []),
        { key: 'sent', label: 'ส่งบิลทาง LINE แล้ว', done: collection_.notified, of: collection_.total },
    ].filter(s => s.of > 0);

    // Income mix of this cycle's saved bills, so it adds up to the expected total in the money panel
    const savedBills = collection_.saved;
    const mixRent = savedBills.reduce((s, b) => s + b.room_rent, 0);
    const mixElec = savedBills.reduce((s, b) => s + b.elec_bill, 0);
    const mixWater = savedBills.reduce((s, b) => s + waterOf(b), 0);
    const mixOther = Math.max(0, collection_.projected - mixRent - mixElec - mixWater);
    // Units for the key figures come from the same saved bills, so the strip and the mix agree
    const totalElecUnits = savedBills.reduce((sum, b) => sum + b.elec_units, 0);
    const totalWaterUnits = savedBills.reduce((sum, b) => sum + b.water_units, 0);
    // categorical slots in fixed order (validated for colour-blind separation as neighbours)
    const incomeParts = [
        { key: 'rent', label: 'ค่าห้อง', value: mixRent, color: 'var(--cat-1)' },
        { key: 'elec', label: 'ค่าไฟฟ้า', value: mixElec, color: 'var(--cat-2)' },
        { key: 'water', label: 'ค่าน้ำ', value: mixWater, color: 'var(--cat-3)' },
        ...(mixOther > 0 ? [{ key: 'other', label: 'ค่าส่วนกลาง/อื่น ๆ', value: mixOther, color: 'var(--cat-4)' }] : []),
    ];
    const incomeTotal = collection_.projected;
    const heroCollected = useCountUp(collection_.collected);

    return (
        <div className="dash">
            <header className="dash-head">
                <div className="dash-head-text">
                    <h1 className="dash-title">
                        {buildingName || config?.bill_customization?.dorm_name || `ภาพรวม${terms.facilityType}`}
                    </h1>
                    <p className="dash-subtitle">
                        ภาพรวม · รอบบิล {formatMonthThai(currentMonth)}
                        {terms.isMarket && <span className="dash-tag">ตลาด / แผงค้า</span>}
                    </p>
                </div>

                <div className="dash-head-side">
                    {/* Dorm logo at top-right (as requested); the name is already the page title */}
                    {dormLogo && (
                        <img className="dash-logo" src={dormLogo} alt={`โลโก้ ${buildingName || ''}`.trim()} />
                    )}
                    {activeTab === 'overview' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setShowCustomize(true)} aria-label="ปรับแต่ง Dashboard">
                            <SlidersHorizontal size={16} /> <span className="dash-hide-xs">ปรับแต่ง</span>
                        </button>
                    )}
                </div>
            </header>

            {/* ── Tabs ── */}
            <div className="seg" role="tablist" aria-label="มุมมอง Dashboard">
                <button role="tab" aria-selected={activeTab === 'overview'} className={`seg-item ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
                    ภาพรวม
                </button>
                <button role="tab" aria-selected={activeTab === 'ai'} className={`seg-item ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => setActiveTab('ai')}>
                    <Bot size={15} /> น้องแคร์ AI
                </button>
            </div>

            {activeTab === 'ai' ? (
                <NongCarePanel
                    contextData={aiContext}
                    isPro={license === 'active' || (license || '').includes('large')}
                    onUpgrade={onUpgrade || (() => {})}
                />
            ) : (
            <div className="dash-grid">
                {/* ── Money: how much is in, who still owes ── */}
                {showMoney && (
                    <section className={`panel money ${showTodo ? 'span-8' : 'span-12'}`} aria-labelledby="dash-money-title">
                        <div className="panel-head">
                            <h2 id="dash-money-title" className="panel-title">การเก็บเงินรอบนี้</h2>
                            {onGoToPayments && (
                                <button className="link-btn" onClick={onGoToPayments}>
                                    จัดการสลิป <ChevronRight size={15} />
                                </button>
                            )}
                        </div>

                        <div className="money-hero">
                            <span className="money-label">เก็บแล้ว</span>
                            <span className="money-value" aria-label={formatCurrency(collection_.collected)}>{formatCurrency(Math.round(heroCollected))}</span>
                            <span className="money-sub">
                                {collection_.total > 0 ? (
                                    <>จากยอดที่ต้องเก็บ {formatCurrency(collection_.projected)} · <strong>{collection_.rate}%</strong></>
                                ) : (
                                    <>ยังไม่มีบิลที่บันทึกในรอบนี้</>
                                )}
                            </span>
                        </div>

                        <div className="cycle-bar" role="img"
                            aria-label={moneySegs.map(s => `${s.label} ${s.count} ${unit} ${formatCurrency(s.amount)}`).join(', ')}>
                            {collection_.projected > 0
                                ? moneySegs.map(s => s.amount > 0 && (
                                    <span key={s.key} className={`cycle-seg ${s.key}`} style={{ flexGrow: s.amount }} />
                                ))
                                : <span className="cycle-seg empty" style={{ flexGrow: 1 }} />}
                        </div>

                        <ul className="money-rows">
                            {moneySegs.map(s => {
                                const body = (
                                    <>
                                        <span className={`status-dot ${s.key}`} aria-hidden />
                                        <span className="money-row-label">
                                            {s.label}
                                            {s.rooms.length > 0 && <span className="money-row-rooms">{unit} {roomList(s.rooms)}</span>}
                                        </span>
                                        <span className="money-row-count">{s.count} {unit}</span>
                                        <span className="money-row-amount">{formatCurrency(s.amount)}</span>
                                        {onGoToPayments && <ChevronRight size={16} className="money-row-go" aria-hidden />}
                                    </>
                                );
                                // Rows that still need action open the slips/payments page
                                return (
                                    <li key={s.key}>
                                        {s.rooms.length > 0 && onGoToPayments
                                            ? <button className="money-row money-row-link" onClick={onGoToPayments}>{body}</button>
                                            : <div className="money-row">{body}</div>}
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                )}

                {/* ── What's left to do this cycle ── */}
                {showTodo && (
                    <section className={`panel ${showMoney ? 'span-4' : 'span-12'}`} aria-labelledby="dash-todo-title">
                        <div className="panel-head">
                            <h2 id="dash-todo-title" className="panel-title">งานที่เหลือรอบนี้</h2>
                        </div>
                        {cycleSteps.length === 0 ? (
                            <p className="panel-note" style={{ marginTop: 0 }}>ยังไม่มี{unit}หรือบิลในรอบนี้</p>
                        ) : (
                            <ul className="todo-list">
                                {cycleSteps.map(s => {
                                    const Icon = s.key === 'meter' ? Gauge : Send;
                                    const done = s.done >= s.of;
                                    return (
                                        <li key={s.key}>
                                            <Icon size={17} aria-hidden />
                                            <span className="todo-label">{s.label}</span>
                                            <span className={`todo-value ${done ? 'done' : ''}`}>
                                                {done
                                                    ? <><CheckCircle2 size={15} /> ครบแล้ว</>
                                                    : <>{s.done}<span className="todo-of">/{s.of}</span></>}
                                            </span>
                                            <div className="cycle-bar cycle-bar-sm" role="progressbar" aria-valuemin={0} aria-valuemax={s.of} aria-valuenow={s.done}
                                                aria-label={`${s.label} ${s.done} จาก ${s.of}`}>
                                                {s.done > 0 && <span className="cycle-seg done" style={{ flexGrow: s.done }} />}
                                                {s.of - s.done > 0 && <span className="cycle-seg empty" style={{ flexGrow: s.of - s.done }} />}
                                            </div>
                                            {!done && <span className="todo-left">เหลือ {s.of - s.done} {unit}</span>}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>
                )}

                {/* ── Room status overview ── */}
                {showRoomMap && (
                    <div className="span-12">
                        <RoomStatusDashboard rooms={rooms!} occupancy={occupancy} onOpenRoom={onOpenRoom} buildingType={config?.building_type} />
                    </div>
                )}

                {/* ── Key figures ── */}
                {isEnabled('stats') && (
                    <section className="panel span-12 figures" aria-label="สถิติหลัก">
                        <div className="figure">
                            <span className="figure-label"><Home size={14} aria-hidden /> {terms.unitCountLabel}</span>
                            <span className="figure-value">{stats.totalRooms}</span>
                        </div>
                        <div className="figure">
                            <span className="figure-label"><Clock size={14} aria-hidden /> รายได้คาดการณ์</span>
                            <span className="figure-value">{formatCurrency(stats.totalRevenue)}</span>
                        </div>
                        <div className="figure">
                            <span className="figure-label"><Zap size={14} aria-hidden /> หน่วยไฟฟ้ารวม</span>
                            <span className="figure-value">{totalElecUnits.toLocaleString()}</span>
                            <span className="figure-sub">≈ {formatCurrency(mixElec)}</span>
                        </div>
                        <div className="figure">
                            <span className="figure-label"><Droplets size={14} aria-hidden /> หน่วยน้ำรวม</span>
                            <span className="figure-value">{totalWaterUnits.toLocaleString()}</span>
                            <span className="figure-sub">≈ {formatCurrency(mixWater)}</span>
                        </div>
                    </section>
                )}

                {/* ── Revenue vs Expense Trend ── */}
                {isEnabled('revenue_trend') && hasTrend && (
                    <section className="panel span-7" aria-labelledby="dash-trend-title">
                        <div className="panel-head panel-head-wrap">
                            <h2 id="dash-trend-title" className="panel-title">รายได้ย้อนหลัง 6 เดือน</h2>
                            <Legend items={[
                                { label: 'เก็บได้จริง', color: 'var(--series-1)' },
                                ...(hasExpenseHistory ? [{ label: 'ค่าใช้จ่าย', color: 'var(--series-2)' }] : []),
                                { label: 'ยอดที่ต้องเก็บ', color: 'var(--color-gray-500)', dashed: true },
                            ]} />
                        </div>
                        <BarChart
                            title="รายได้ที่เก็บได้จริงเทียบค่าใช้จ่ายและยอดที่ต้องเก็บ ย้อนหลัง 6 เดือน"
                            labels={trend.map(r => formatMonthThai(r.month))}
                            mode="grouped"
                            series={[
                                { key: 'collected', label: 'เก็บได้จริง', color: 'var(--series-1)' },
                                ...(hasExpenseHistory ? [{ key: 'expense', label: 'ค่าใช้จ่าย', color: 'var(--series-2)' }] : []),
                            ]}
                            values={[
                                trend.map(r => r.collected * 100),
                                ...(hasExpenseHistory ? [trend.map(r => r.expense * 100)] : []),
                            ]}
                            line={{ label: 'ยอดที่ต้องเก็บ', color: 'var(--color-gray-500)', area: true, values: trend.map(r => (r.projected > 0 ? r.projected * 100 : null)) }}
                            format={axisBaht}
                            formatTip={tipBaht}
                            highlight={trend.length - 1}
                            height={210}
                        />
                    </section>
                )}

                {/* ── Expense Summary & Net Profit ── */}
                {isEnabled('expense_summary') && (
                    <section className={`panel ${isEnabled('revenue_trend') && hasTrend ? 'span-5' : 'span-12'}`} aria-labelledby="dash-exp-title">
                        <div className="panel-head">
                            <h2 id="dash-exp-title" className="panel-title">ค่าใช้จ่าย & กำไร</h2>
                            <span className="panel-meta">{formatMonthThai(currentMonth)}</span>
                        </div>
                        <dl className="pl">
                            <div><dt>รายได้จริง</dt><dd>{formatCurrency(collection_.collected)}</dd></div>
                            <div><dt>ค่าใช้จ่าย</dt><dd>{totalExpense > 0 ? '−' : ''}{formatCurrency(totalExpense)}</dd></div>
                            <div className="pl-total">
                                <dt>กำไรสุทธิ</dt>
                                <dd className={netProfit < 0 ? 'neg' : ''}>{netProfit >= 0 ? '' : '−'}{formatCurrency(Math.abs(netProfit))}</dd>
                            </div>
                        </dl>

                        {expenseByCategory.length > 0 ? (
                            <div className="hbars">
                                <span className="hbars-caption">ค่าใช้จ่ายตามหมวด</span>
                                {expenseByCategory.map(([cat, amount]) => (
                                    <div key={cat} className="hbar">
                                        <span className="hbar-label" title={cat}>{cat}</span>
                                        <span className="hbar-track"><span className="hbar-fill expense" style={{ width: `${totalExpense > 0 ? (amount / totalExpense) * 100 : 0}%` }} /></span>
                                        <span className="hbar-value">{formatCurrency(amount)}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="panel-note">
                                ยังไม่มีค่าใช้จ่ายเดือนนี้{!buildingId && ' — บันทึกได้ที่หน้า "ระบบจัดการ"'}
                            </p>
                        )}
                    </section>
                )}

                {/* ── Revenue Breakdown ── */}
                {isEnabled('revenue_chart') && incomeTotal > 0 && (
                    <section className="panel span-6" aria-labelledby="dash-mix-title">
                        <div className="panel-head">
                            <h2 id="dash-mix-title" className="panel-title">รายได้มาจากไหน</h2>
                            <span className="panel-meta">บิลรอบนี้</span>
                        </div>
                        <DonutChart
                            items={incomeParts}
                            title="รายได้ของบิลรอบนี้แยกตามประเภท"
                            centerLabel="ทั้งหมด"
                            format={formatCurrency}
                        />
                    </section>
                )}

                {/* ── Rate Configuration Summary ── */}
                {isEnabled('rate_config') && (
                    <section className={`panel ${isEnabled('revenue_chart') && incomeTotal > 0 ? 'span-6' : 'span-12'}`} aria-labelledby="dash-rate-title">
                        <div className="panel-head">
                            <h2 id="dash-rate-title" className="panel-title">อัตราค่าบริการปัจจุบัน</h2>
                        </div>
                        <dl className="rates">
                            <div><dt>ค่าไฟฟ้า</dt><dd>{config.electricity_rate} <small>บาท/หน่วย</small></dd></div>
                            <div><dt>ค่าน้ำประปา</dt><dd>{config.water_config.unit_rate || config.water_config.excess_unit_rate} <small>บาท/หน่วย</small></dd></div>
                            <div><dt>ค่าเช่าเริ่มต้น</dt><dd>{formatCurrency(config.room_rent)}</dd></div>
                        </dl>
                    </section>
                )}

                {/* ── Recent Bills ── */}
                {isEnabled('recent_bills') && recentBills.length > 0 && (
                    <section className="panel panel-flush span-12" aria-labelledby="dash-bills-title">
                        <div className="panel-head">
                            <h2 id="dash-bills-title" className="panel-title">บิลล่าสุด</h2>
                        </div>
                        <div className="table-container">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>{unit}</th>
                                        <th className="text-right col-opt">ค่าไฟ</th>
                                        <th className="text-right col-opt">ค่าน้ำ</th>
                                        <th className="text-right">ยอดรวม</th>
                                        <th>การชำระ</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentBills.slice(0, 5).map(bill => {
                                        const s = statusOf(bill);
                                        return (
                                            <tr key={bill.id}>
                                                <td className="num">{bill.room_number}</td>
                                                <td className="text-right num col-opt">{formatCurrency(bill.elec_bill)}</td>
                                                <td className="text-right num col-opt">{formatCurrency(waterOf(bill))}</td>
                                                <td className="text-right num font-bold">{formatCurrency(bill.total_bill)}</td>
                                                <td>
                                                    {!bill.is_saved ? (
                                                        <span className="badge badge-gray">รอบันทึก</span>
                                                    ) : s === 'paid' ? (
                                                        <span className="badge badge-success"><CheckCircle2 size={12} /> จ่ายแล้ว</span>
                                                    ) : s === 'pending' ? (
                                                        <span className="badge badge-warning"><Clock size={12} /> รอตรวจ</span>
                                                    ) : (
                                                        <span className="badge badge-danger">ยังไม่จ่าย</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}
            </div>
            )}

            {/* ── Customize Panel ── */}
            {showCustomize && (
                <div className="modal-overlay" onClick={() => setShowCustomize(false)}>
                    <div className="modal dashboard-customize-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="dash-customize-title">
                        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                            <h3 id="dash-customize-title" className="modal-title" style={{ fontSize: '1.0625rem' }}>ปรับแต่ง Dashboard</h3>
                            <button className="btn-icon btn-ghost" onClick={() => setShowCustomize(false)} aria-label="ปิด"><X size={18} /></button>
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
