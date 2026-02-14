import {
    Home, Zap, Droplets,
    TrendingUp, CheckCircle, Clock
} from 'lucide-react';
import type { DormConfig, MonthlyBill } from '../../types';
import { formatCurrency, formatMonthThai } from '../../utils/calculations';

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
}

export default function Dashboard({ config, stats, currentMonth, recentBills }: DashboardProps) {
    // Calculate total electricity and water units and bills
    const totalElecUnits = recentBills.reduce((sum, b) => sum + b.elec_units, 0);
    const totalWaterUnits = recentBills.reduce((sum, b) => sum + b.water_units, 0);
    const totalElecBill = recentBills.reduce((sum, b) => sum + b.elec_bill, 0);
    const totalWaterBill = recentBills.reduce((sum, b) => sum + b.water_bill, 0);

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">📊 Dashboard</h1>
                <p className="page-subtitle">
                    ภาพรวมหอพัก — รอบเดือน {formatMonthThai(currentMonth)}
                </p>
            </div>

            {/* Progress Bar */}
            <div className="card mb-6">
                <div className="progress-container">
                    <div className="progress-header">
                        <span className="progress-label">
                            {stats.isAllSaved ? '✅ จดครบทุกห้องแล้ว!' : '📝 สถานะการจดมิเตอร์'}
                        </span>
                        <span className="progress-value">
                            {stats.savedCount}/{stats.totalRooms} ห้อง
                        </span>
                    </div>
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{ width: `${stats.progress}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="stats-grid">
                <div className="stat-card primary">
                    <div className="stat-icon primary">
                        <Home size={24} />
                    </div>
                    <div className="stat-label">จำนวนห้องทั้งหมด</div>
                    <div className="stat-value">{stats.totalRooms}</div>
                </div>

                <div className="stat-card success">
                    <div className="stat-icon success">
                        <TrendingUp size={24} />
                    </div>
                    <div className="stat-label">รายได้คาดการณ์</div>
                    <div className="stat-value">{formatCurrency(stats.totalRevenue)}</div>
                </div>

                <div className="stat-card warning">
                    <div className="stat-icon warning">
                        <Zap size={24} />
                    </div>
                    <div className="stat-label">หน่วยไฟฟ้ารวม</div>
                    <div className="stat-value">{totalElecUnits.toLocaleString()}</div>
                    <div className="stat-subvalue">≈ {formatCurrency(totalElecBill)}</div>
                </div>

                <div className="stat-card primary">
                    <div className="stat-icon primary">
                        <Droplets size={24} />
                    </div>
                    <div className="stat-label">หน่วยน้ำรวม</div>
                    <div className="stat-value">{totalWaterUnits.toLocaleString()}</div>
                    <div className="stat-subvalue">≈ {formatCurrency(totalWaterBill)}</div>
                </div>
            </div>

            {/* Revenue Breakdown Chart */}
            {stats.totalRevenue > 0 && (
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-title">📈 สัดส่วนรายได้</span>
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
                                        <div className="chart-bar-label">
                                            <span className="chart-dot elec"></span>
                                            <span>ค่าไฟฟ้า</span>
                                        </div>
                                        <div className="chart-bar-wrapper">
                                            <div
                                                className="chart-bar elec"
                                                style={{ width: `${elecPercent}%` }}
                                            ></div>
                                        </div>
                                        <div className="chart-bar-value">
                                            {formatCurrency(totalElecBill)}
                                            <span className="chart-percent">({elecPercent.toFixed(0)}%)</span>
                                        </div>
                                    </div>
                                    <div className="chart-bar-group">
                                        <div className="chart-bar-label">
                                            <span className="chart-dot water"></span>
                                            <span>ค่าน้ำ</span>
                                        </div>
                                        <div className="chart-bar-wrapper">
                                            <div
                                                className="chart-bar water"
                                                style={{ width: `${waterPercent}%` }}
                                            ></div>
                                        </div>
                                        <div className="chart-bar-value">
                                            {formatCurrency(totalWaterBill)}
                                            <span className="chart-percent">({waterPercent.toFixed(0)}%)</span>
                                        </div>
                                    </div>
                                    <div className="chart-bar-group">
                                        <div className="chart-bar-label">
                                            <span className="chart-dot rent"></span>
                                            <span>ค่าห้อง</span>
                                        </div>
                                        <div className="chart-bar-wrapper">
                                            <div
                                                className="chart-bar rent"
                                                style={{ width: `${rentPercent}%` }}
                                            ></div>
                                        </div>
                                        <div className="chart-bar-value">
                                            {formatCurrency(totalRoomRent)}
                                            <span className="chart-percent">({rentPercent.toFixed(0)}%)</span>
                                        </div>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* Rate Configuration Summary */}
            <div className="card mt-6">
                <div className="card-header">
                    <span className="card-title">⚙️ อัตราค่าบริการปัจจุบัน</span>
                </div>
                <div className="settings-grid">
                    <div>
                        <div className="stat-label">ค่าไฟฟ้า</div>
                        <div className="stat-value" style={{ fontSize: '1.25rem' }}>
                            {config.electricity_rate} บาท/หน่วย
                        </div>
                    </div>
                    <div>
                        <div className="stat-label">ค่าน้ำเหมาจ่าย</div>
                        <div className="stat-value" style={{ fontSize: '1.25rem' }}>
                            {config.water_config.flat_price} บาท ({config.water_config.flat_limit_unit} หน่วย)
                        </div>
                    </div>
                    <div>
                        <div className="stat-label">ค่าน้ำส่วนเกิน</div>
                        <div className="stat-value" style={{ fontSize: '1.25rem' }}>
                            {config.water_config.excess_unit_rate} บาท/หน่วย
                        </div>
                    </div>
                    <div>
                        <div className="stat-label">ค่าเช่าห้อง</div>
                        <div className="stat-value" style={{ fontSize: '1.25rem' }}>
                            {formatCurrency(config.room_rent)}
                        </div>
                    </div>
                </div>
            </div>

            {/* Recent Bills */}
            {recentBills.length > 0 && (
                <div className="card mt-6">
                    <div className="card-header">
                        <span className="card-title">📋 รายการล่าสุด</span>
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
                                                <span className="badge badge-success">
                                                    <CheckCircle size={12} />
                                                    บันทึกแล้ว
                                                </span>
                                            ) : (
                                                <span className="badge badge-gray">
                                                    <Clock size={12} />
                                                    รอบันทึก
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
