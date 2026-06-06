import { forwardRef } from 'react';
import { Zap, Droplets, Home, Banknote } from 'lucide-react';
import type { MonthlyBill, DormConfig, BillCustomization } from '../../types';
import { formatCurrency } from '../../utils/calculations';

interface MonthlyReportProps {
    bills: MonthlyBill[];
    currentMonth: string;
    config: DormConfig;
    billCustomization?: BillCustomization;
}

function formatThaiMonthFull(monthStr: string): string {
    const [year, month] = monthStr.split('-').map(Number);
    const thaiMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const thaiYear = year + 543;
    return `${thaiMonths[month - 1]} ${thaiYear}`;
}

function formatThaiDateFull(date: Date): string {
    const thaiMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const day = date.getDate();
    const month = date.getMonth();
    const year = date.getFullYear() + 543;
    return `${day} ${thaiMonths[month]} ${year}`;
}

const MonthlyReport = forwardRef<HTMLDivElement, MonthlyReportProps>(
    ({ bills, currentMonth, config, billCustomization }, ref) => {
        const monthBills = bills
            .filter(b => b.month === currentMonth)
            .sort((a, b) => a.room_number.localeCompare(b.room_number));

        const totalElecUnits = monthBills.reduce((s, b) => s + b.elec_units, 0);
        const totalWaterUnits = monthBills.reduce((s, b) => s + b.water_units, 0);
        const totalElecBill = monthBills.reduce((s, b) => s + b.elec_bill, 0);
        const totalWaterBill = monthBills.reduce((s, b) => s + b.water_bill, 0);
        const totalRoomRent = monthBills.reduce((s, b) => s + b.room_rent, 0);
        const totalRevenue = monthBills.reduce((s, b) => s + b.total_bill, 0);

        const dormName = billCustomization?.dorm_name || 'หอพัก';

        const styles = {
            page: {
                width: '210mm',
                minHeight: '297mm',
                background: '#fff',
                color: '#1a1a1a',
                fontFamily: '"Sarabun", "Noto Sans Thai", sans-serif',
                padding: '20mm 15mm',
                boxSizing: 'border-box' as const,
                fontSize: '13px',
                lineHeight: '1.6',
            },
            header: {
                textAlign: 'center' as const,
                marginBottom: '24px',
                borderBottom: '2px solid #1a1a1a',
                paddingBottom: '16px',
            },
            dormName: {
                fontSize: '22px',
                fontWeight: 800,
                marginBottom: '4px',
                letterSpacing: '0.5px',
            },
            dormAddress: {
                fontSize: '12px',
                color: '#555',
                marginBottom: '2px',
            },
            reportTitle: {
                fontSize: '18px',
                fontWeight: 700,
                marginTop: '12px',
                marginBottom: '4px',
            },
            reportSubtitle: {
                fontSize: '13px',
                color: '#666',
            },
            table: {
                width: '100%',
                borderCollapse: 'collapse' as const,
                fontSize: '12.5px',
                marginBottom: '20px',
            },
            th: {
                padding: '12px 10px',
                textAlign: 'left' as const,
                borderBottom: '2px solid #e2e8f0',
                background: '#f8fafc',
                fontWeight: 600,
                fontSize: '12.5px',
                color: '#475569',
                textTransform: 'uppercase' as const,
                whiteSpace: 'nowrap' as const,
            },
            thRight: {
                padding: '12px 10px',
                textAlign: 'right' as const,
                borderBottom: '2px solid #e2e8f0',
                background: '#f8fafc',
                fontWeight: 600,
                fontSize: '12.5px',
                color: '#475569',
                textTransform: 'uppercase' as const,
                whiteSpace: 'nowrap' as const,
            },
            thCenter: {
                padding: '12px 10px',
                textAlign: 'center' as const,
                borderBottom: '2px solid #e2e8f0',
                background: '#f8fafc',
                fontWeight: 600,
                fontSize: '12.5px',
                color: '#475569',
                textTransform: 'uppercase' as const,
                whiteSpace: 'nowrap' as const,
            },
            td: {
                padding: '8px',
                borderBottom: '1px solid #e5e5e5',
            },
            tdRight: {
                padding: '8px',
                borderBottom: '1px solid #e5e5e5',
                textAlign: 'right' as const,
                fontVariantNumeric: 'tabular-nums' as const,
            },
            tdCenter: {
                padding: '8px',
                borderBottom: '1px solid #e5e5e5',
                textAlign: 'center' as const,
                fontVariantNumeric: 'tabular-nums' as const,
            },
            totalRow: {
                borderTop: '2px solid #333',
                fontWeight: 700,
                fontSize: '14px',
            },
            totalLabel: {
                padding: '12px 8px',
                textAlign: 'right' as const,
            },
            totalValue: {
                padding: '12px 8px',
                textAlign: 'right' as const,
                fontSize: '16px',
                fontVariantNumeric: 'tabular-nums' as const,
            },
            summaryGrid: {
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '16px',
                marginTop: '24px',
                padding: '16px',
                background: '#f8f8f8',
                borderRadius: '8px',
                border: '1px solid #e5e5e5',
            },
            summaryItem: {
                textAlign: 'center' as const,
            },
            summaryLabel: {
                fontSize: '11px',
                color: '#888',
                marginBottom: '4px',
            },
            summaryValue: {
                fontSize: '16px',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums' as const,
            },
            footer: {
                marginTop: '32px',
                paddingTop: '16px',
                borderTop: '1px solid #ddd',
                fontSize: '11px',
                color: '#999',
                textAlign: 'center' as const,
            },
            breakdownGrid: {
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '12px',
                marginTop: '16px',
                padding: '14px 16px',
                background: '#fafafa',
                borderRadius: '8px',
                border: '1px solid #eee',
            },
            breakdownItem: {
                textAlign: 'center' as const,
            },
            breakdownLabel: {
                fontSize: '11px',
                color: '#888',
                marginBottom: '2px',
            },
            breakdownValue: {
                fontSize: '14px',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums' as const,
            },
        };

        return (
            <div ref={ref} style={styles.page}>
                {/* Header */}
                <div style={styles.header}>
                    <div style={styles.dormName}>{dormName}</div>
                    {billCustomization?.dorm_address && (
                        <div style={styles.dormAddress}>{billCustomization.dorm_address}</div>
                    )}
                    {billCustomization?.dorm_phone && (
                        <div style={styles.dormAddress}>โทร. {billCustomization.dorm_phone}</div>
                    )}
                    <div style={styles.reportTitle}>สรุปรายรับประจำเดือน</div>
                    <div style={styles.reportSubtitle}>
                        เดือน {formatThaiMonthFull(currentMonth)} | ออกเอกสาร {formatThaiDateFull(new Date())}
                    </div>
                </div>

                {/* Table */}
                <table style={styles.table}>
                    <thead>
                        <tr>
                            <th style={{ ...styles.th, width: '50px' }}>#</th>
                            <th style={styles.th}>ห้อง</th>
                            <th style={styles.thCenter}>ไฟฟ้า (หน่วย)</th>
                            <th style={styles.thRight}>ค่าไฟ</th>
                            <th style={styles.thCenter}>น้ำ (หน่วย)</th>
                            <th style={styles.thRight}>ค่าน้ำ</th>
                            <th style={styles.thRight}>ค่าห้อง</th>
                            <th style={styles.thRight}>รวม</th>
                        </tr>
                    </thead>
                    <tbody>
                        {monthBills.map((bill, idx) => (
                            <tr key={bill.id} style={idx % 2 === 1 ? { background: '#fafafa' } : {}}>
                                <td style={styles.td}>{idx + 1}</td>
                                <td style={{ ...styles.td, fontWeight: 600 }}>{bill.room_number}</td>
                                <td style={styles.tdCenter}>{bill.elec_units}</td>
                                <td style={styles.tdRight}>{bill.elec_bill.toLocaleString()}</td>
                                <td style={styles.tdCenter}>{bill.water_units}</td>
                                <td style={styles.tdRight}>{bill.water_bill.toLocaleString()}</td>
                                <td style={styles.tdRight}>{bill.room_rent.toLocaleString()}</td>
                                <td style={{ ...styles.tdRight, fontWeight: 600 }}>{bill.total_bill.toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr style={styles.totalRow}>
                            <td colSpan={2} style={styles.totalLabel}>
                                รวม ({monthBills.length} ห้อง)
                            </td>
                            <td style={{ ...styles.totalLabel, textAlign: 'center' }}>
                                {totalElecUnits.toLocaleString()}
                            </td>
                            <td style={styles.totalLabel}>
                                {totalElecBill.toLocaleString()}
                            </td>
                            <td style={{ ...styles.totalLabel, textAlign: 'center' }}>
                                {totalWaterUnits.toLocaleString()}
                            </td>
                            <td style={styles.totalLabel}>
                                {totalWaterBill.toLocaleString()}
                            </td>
                            <td style={styles.totalLabel}>
                                {totalRoomRent.toLocaleString()}
                            </td>
                            <td style={styles.totalValue}>
                                {formatCurrency(totalRevenue)}
                            </td>
                        </tr>
                    </tfoot>
                </table>

                {/* Revenue Breakdown */}
                <div style={styles.breakdownGrid}>
                    <div style={styles.breakdownItem}>
                        <div style={{ ...styles.breakdownLabel, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}><Zap size={14} color="#D97706" /> ค่าไฟฟ้ารวม</div>
                        <div style={{ ...styles.breakdownValue, color: '#D97706' }}>
                            {formatCurrency(totalElecBill)}
                        </div>
                    </div>
                    <div style={styles.breakdownItem}>
                        <div style={{ ...styles.breakdownLabel, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}><Droplets size={14} color="#2563EB" /> ค่าน้ำรวม</div>
                        <div style={{ ...styles.breakdownValue, color: '#2563EB' }}>
                            {formatCurrency(totalWaterBill)}
                        </div>
                    </div>
                    <div style={styles.breakdownItem}>
                        <div style={{ ...styles.breakdownLabel, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}><Home size={14} color="#16A34A" /> ค่าห้องรวม</div>
                        <div style={{ ...styles.breakdownValue, color: '#16A34A' }}>
                            {formatCurrency(totalRoomRent)}
                        </div>
                    </div>
                    <div style={styles.breakdownItem}>
                        <div style={{ ...styles.breakdownLabel, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}><Banknote size={14} color="#7C3AED" /> รายรับทั้งสิ้น</div>
                        <div style={{ ...styles.breakdownValue, color: '#7C3AED', fontSize: '18px' }}>
                            {formatCurrency(totalRevenue)}
                        </div>
                    </div>
                </div>

                {/* Stats Summary */}
                <div style={styles.summaryGrid}>
                    <div style={styles.summaryItem}>
                        <div style={styles.summaryLabel}>จำนวนห้อง</div>
                        <div style={styles.summaryValue}>{monthBills.length} ห้อง</div>
                    </div>
                    <div style={styles.summaryItem}>
                        <div style={styles.summaryLabel}>หน่วยไฟฟ้ารวม</div>
                        <div style={styles.summaryValue}>{totalElecUnits.toLocaleString()} หน่วย</div>
                    </div>
                    <div style={styles.summaryItem}>
                        <div style={styles.summaryLabel}>หน่วยน้ำรวม</div>
                        <div style={styles.summaryValue}>{totalWaterUnits.toLocaleString()} หน่วย</div>
                    </div>
                </div>

                {/* Footer */}
                <div style={styles.footer}>
                    <p>เอกสารนี้สร้างโดยระบบ HorCare — {dormName}</p>
                    <p>อัตราค่าไฟ {config.electricity_rate} บาท/หน่วย | ค่าน้ำ {
                        config.water_config.type === 'normal'
                            ? `${config.water_config.unit_rate} บาท/หน่วย`
                            : `เหมา ${config.water_config.flat_price} บาท/${config.water_config.flat_limit_unit} หน่วย`
                    }</p>
                </div>
            </div>
        );
    }
);

MonthlyReport.displayName = 'MonthlyReport';
export default MonthlyReport;
