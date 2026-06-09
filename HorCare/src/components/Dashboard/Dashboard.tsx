import { useState, useMemo } from 'react';
import {
    Home, Zap, Droplets,
    TrendingUp, CheckCircle, Clock,
    BarChart3, CheckSquare, FileText, LineChart, Settings, ClipboardList,
    SlidersHorizontal, X, Wallet, CircleDollarSign, AlertCircle, ChevronRight,
} from 'lucide-react';
import type { DormConfig, MonthlyBill, PaymentStatus } from '../../types';
import { formatCurrency, formatMonthThai, getPreviousMonth } from '../../utils/calculations';
import { useDashboardPrefs, WIDGET_LABELS, type WidgetId } from '../../hooks/useDashboardPrefs';

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
    onGoToPayments?: () => void;
}

function statusOf(b: MonthlyBill): PaymentStatus {
    return b.payment_status ?? 'unpaid';
}

export default function Dashboard({ config, stats, currentMonth, recentBills, allBills = [], uid, onGoToPayments }: DashboardProps) {
    const [showCustomize, setShowCustomize] = useState(false);
    const { allWidgets, toggle, isEnabled } = useDashboardPrefs(uid);

    const totalElecUnits = recentBills.reduce((sum, b) => sum + b.elec_units, 0);
    const totalWaterUnits = recentBills.reduce((sum, b) => sum + b.water_units, 0);
    const totalElecBill = recentBills.reduce((sum, b) => sum + b.elec_bill, 0);
    const totalWaterBill = recentBills.reduce((sum, b) => sum + b.water_bill, 0);

    // ── Collection: projected (saved bills) vs actual (paid bills) for this month ──
    const collection = useMemo(() => {
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

    // ── 6-month revenue trend (projected vs collected per month) ──
    const trend = useMemo(() => {
        const months: string[] = [];
        let m = currentMonth;
        for (let i = 0; i < 6; i++) { months.unshift(m); m = getPreviousMonth(m); }
        const rows = months.map(month => {
            const saved = allBills.filter(b => b.month === month && b.is_saved);
            const projected = saved.reduce((s, b) => s + b.total_bill, 0);
            const collected = saved.filter(b => statusOf(b) === 'paid').reduce((s, b) => s + b.total_bill, 0);
            return { month, projected, collected };
        });
        const peak = Math.max(1, ...rows.map(r => r.projected));
        return { rows, peak };
    }, [allBills, currentMonth]);

    const hasTrend = trend.rows.some(r => r.projected > 0);

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <BarChart3 size={28} /> Dashboard
                    </h1>
                    <p className="page-subtitle">
                        ภาพรวมหอพัก — รอบเดือน {formatMonthThai(currentMonth)}
                    </p>
                </div>
                <button
                    className="btn btn-outline btn-sm"
                    onClick={() => setShowCustomize(true)}
                    title="ปรับแต่ง Dashboard"
                >
                    <SlidersHorizontal size={15} />
                    ปรับแต่ง
                </button>
            </div>

            {/* ── Collection overview (projected vs actual income) ── */}
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
                        {/* Donut: collection rate */}
                        <div className="collection-ring-wrap">
                            <div
                                className="collection-ring"
                                style={{ ['--rate' as string]: `${collection.rate}` }}
                            >
                                <div className="collection-ring-center">
                                    <span className="collection-ring-pct">{collection.rate}%</span>
                                    <span className="collection-ring-cap">เก็บได้</span>
                                </div>
                            </div>
                        </div>

                        {/* Figures */}
                        <div className="collection-figures">
                            <div className="collection-fig">
                                <span className="collection-fig-label"><TrendingUp size={14} /> รายได้คาดการณ์</span>
                                <span className="collection-fig-value">{formatCurrency(collection.projected)}</span>
                            </div>
                            <div className="collection-fig">
                                <span className="collection-fig-label" style={{ color: 'var(--color-success)' }}><CheckCircle size={14} /> รายได้จริง (เก็บแล้ว)</span>
                                <span className="collection-fig-value" style={{ color: 'var(--color-success)' }}>{formatCurrency(collection.collected)}</span>
                            </div>
                            <div className="collection-fig">
                                <span className="collection-fig-label" style={{ color: 'var(--color-danger)' }}><AlertCircle size={14} /> ค้างชำระ</span>
                                <span className="collection-fig-value" style={{ color: 'var(--color-danger)' }}>{formatCurrency(collection.outstanding)}</span>
                            </div>

                            {/* Stacked status bar */}
                            <div className="collection-statusbar">
                                {collection.total > 0 ? (
                                    <>
                                        <div className="collection-seg paid" style={{ flex: collection.paid || 0.0001 }} title={`จ่ายแล้ว ${collection.paid}`} />
                                        <div className="collection-seg pending" style={{ flex: collection.pending || 0.0001 }} title={`รอตรวจสอบ ${collection.pending}`} />
                                        <div className="collection-seg unpaid" style={{ flex: collection.unpaid || 0.0001 }} title={`ยังไม่จ่าย ${collection.unpaid}`} />
                                    </>
                                ) : (
                                    <div className="collection-seg empty" style={{ flex: 1 }} />
                                )}
                            </div>
                            <div className="collection-legend">
                                <span><i className="dot paid" /> จ่ายแล้ว {collection.paid}</span>
                                <span><i className="dot pending" /> รอตรวจสอบ {collection.pending}</span>
                                <span><i className="dot unpaid" /> ยังไม่จ่าย {collection.unpaid}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Progress Bar */}
            {isEnabled('progress') && (
                <div className="card mb-6">
                    <div className="progress-container">
                        <div className="progress-header">
                            <span className="progress-label">
                                {stats.isAllSaved ? (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <CheckSquare size={16} color="#10B981" /> จดครบทุกห้องแล้ว!
                                    </span>
                                ) : (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <FileText size={16} /> สถานะการจดมิเตอร์
                                    </span>
                                )}
                            </span>
                            <span className="progress-value">
                                {stats.savedCount}/{stats.totalRooms} ห้อง
                            </span>
                        </div>
                        <div className="progress-bar">
                            <div
                                className="progress-fill"
                                style={{ transform: `scaleX(${stats.progress / 100})` }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Stats Grid */}
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

            {/* Revenue trend — projected vs collected over the last 6 months */}
            {isEnabled('revenue_trend') && hasTrend && (
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <BarChart3 size={18} /> แนวโน้มรายได้ย้อนหลัง 6 เดือน
                        </span>
                        <div className="trend-legend">
                            <span><i className="dot projected" /> คาดการณ์</span>
                            <span><i className="dot collected" /> เก็บได้จริง</span>
                        </div>
                    </div>
                    <div className="trend-chart">
                        {trend.rows.map(r => {
                            const ph = Math.round((r.projected / trend.peak) * 100);
                            return (
                                <div key={r.month} className={`trend-col ${r.month === currentMonth ? 'current' : ''}`}>
                                    <div className="trend-bars" title={`${formatMonthThai(r.month)} · คาดการณ์ ${formatCurrency(r.projected)} · เก็บได้ ${formatCurrency(r.collected)}`}>
                                        <div className="trend-bar projected" style={{ height: `${ph}%` }}>
                                            <div className="trend-bar collected" style={{ height: `${r.projected > 0 ? (r.collected / r.projected) * 100 : 0}%` }} />
                                        </div>
                                    </div>
                                    <div className="trend-amount">{r.projected > 0 ? `฿${Math.round(r.projected / 1000)}k` : '–'}</div>
                                    <div className="trend-month">{formatMonthThai(r.month)}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Revenue Breakdown Chart */}
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
                            const elecPercent = total > 0 ? (totalElecBill / total) * 100 : 0;
                            const waterPercent = total > 0 ? (totalWaterBill / total) * 100 : 0;
                            const rentPercent = total > 0 ? (totalRoomRent / total) * 100 : 0;
                            return (
                                <>
                                    <div className="chart-bar-group">
                                        <div className="chart-bar-label"><span className="chart-dot elec"></span><span>ค่าไฟฟ้า</span></div>
                                        <div className="chart-bar-wrapper"><div className="chart-bar elec" style={{ width: `${elecPercent}%` }}></div></div>
                                        <div className="chart-bar-value">{formatCurrency(totalElecBill)}<span className="chart-percent">({elecPercent.toFixed(0)}%)</span></div>
                                    </div>
                                    <div className="chart-bar-group">
                                        <div className="chart-bar-label"><span className="chart-dot water"></span><span>ค่าน้ำ</span></div>
                                        <div className="chart-bar-wrapper"><div className="chart-bar water" style={{ width: `${waterPercent}%` }}></div></div>
                                        <div className="chart-bar-value">{formatCurrency(totalWaterBill)}<span className="chart-percent">({waterPercent.toFixed(0)}%)</span></div>
                                    </div>
                                    <div className="chart-bar-group">
                                        <div className="chart-bar-label"><span className="chart-dot rent"></span><span>ค่าห้อง</span></div>
                                        <div className="chart-bar-wrapper"><div className="chart-bar rent" style={{ width: `${rentPercent}%` }}></div></div>
                                        <div className="chart-bar-value">{formatCurrency(totalRoomRent)}<span className="chart-percent">({rentPercent.toFixed(0)}%)</span></div>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* Rate Configuration Summary */}
            {isEnabled('rate_config') && (
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Settings size={18} /> อัตราค่าบริการปัจจุบัน
                        </span>
                    </div>
                    <div className="settings-grid">
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

            {/* Recent Bills */}
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

            {/* Customize Panel */}
            {showCustomize && (
                <div className="modal-overlay" onClick={() => setShowCustomize(false)}>
                    <div className="modal dashboard-customize-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <SlidersHorizontal size={18} /> ปรับแต่ง Dashboard
                            </h3>
                            <button className="btn-icon" onClick={() => setShowCustomize(false)}>
                                <X size={18} />
                            </button>
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
