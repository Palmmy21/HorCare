import { useState } from 'react';
import {
    Home, Zap, Droplets,
    TrendingUp, CheckCircle, Clock,
    BarChart3, CheckSquare, FileText, LineChart, Settings, ClipboardList,
    SlidersHorizontal, X
} from 'lucide-react';
import type { DormConfig, MonthlyBill } from '../../types';
import { formatCurrency, formatMonthThai } from '../../utils/calculations';
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
    uid?: string;
}

export default function Dashboard({ config, stats, currentMonth, recentBills, uid }: DashboardProps) {
    const [showCustomize, setShowCustomize] = useState(false);
    const { allWidgets, toggle, isEnabled } = useDashboardPrefs(uid);

    const totalElecUnits = recentBills.reduce((sum, b) => sum + b.elec_units, 0);
    const totalWaterUnits = recentBills.reduce((sum, b) => sum + b.water_units, 0);
    const totalElecBill = recentBills.reduce((sum, b) => sum + b.elec_bill, 0);
    const totalWaterBill = recentBills.reduce((sum, b) => sum + b.water_bill, 0);

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
                                    <th className="text-center">สถานะ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentBills.slice(0, 5).map(bill => (
                                    <tr key={bill.id}>
                                        <td className="mono">{bill.room_number}</td>
                                        <td className="text-right mono">{formatCurrency(bill.elec_bill)}</td>
                                        <td className="text-right mono">{formatCurrency(bill.water_bill)}</td>
                                        <td className="text-right mono font-bold">{formatCurrency(bill.total_bill)}</td>
                                        <td className="text-center">
                                            {bill.is_saved ? (
                                                <span className="badge badge-success"><CheckCircle size={12} /> บันทึกแล้ว</span>
                                            ) : (
                                                <span className="badge badge-gray"><Clock size={12} /> รอบันทึก</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
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
