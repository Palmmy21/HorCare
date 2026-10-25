import { forwardRef } from 'react';
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
    return `${thaiMonths[month - 1]} พ.ศ. ${thaiYear}`;
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
                color: '#000',
                fontFamily: 'var(--font-sans)',
                padding: '20mm 15mm',
                boxSizing: 'border-box' as const,
                fontSize: '15px',
                lineHeight: '1.5',
            },
            headerContainer: {
                position: 'relative' as const,
                marginBottom: '24px',
                textAlign: 'center' as const,
            },
            dateText: {
                position: 'absolute' as const,
                top: '0',
                right: '0',
                fontSize: '14px',
            },
            title: {
                fontSize: '24px',
                fontWeight: 'bold' as const,
                marginBottom: '8px',
            },
            subtitle: {
                fontSize: '18px',
                fontWeight: 'bold' as const,
                marginBottom: '4px',
            },
            addressText: {
                fontSize: '15px',
                marginBottom: '16px',
            },
            table: {
                width: '100%',
                borderCollapse: 'collapse' as const,
                border: '1px solid #000',
                marginBottom: '24px',
            },
            th: {
                border: '1px solid #000',
                padding: '8px 4px',
                textAlign: 'center' as const,
                fontWeight: 'bold' as const,
                background: '#f8f8f8',
            },
            td: {
                border: '1px solid #000',
                padding: '6px 8px',
            },
            tdCenter: {
                border: '1px solid #000',
                padding: '6px 8px',
                textAlign: 'center' as const,
            },
            tdRight: {
                border: '1px solid #000',
                padding: '6px 8px',
                textAlign: 'right' as const,
            },
            summaryBox: {
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '16px',
            },
            summaryTable: {
                width: '350px',
                borderCollapse: 'collapse' as const,
                border: '1px solid #000',
            },
            summaryTitle: {
                fontSize: '16px',
                fontWeight: 'bold' as const,
                marginBottom: '8px',
                textAlign: 'center' as const,
            },
            signatureArea: {
                display: 'flex',
                justifyContent: 'space-around',
                marginTop: '60px',
            },
            signatureBlock: {
                textAlign: 'center' as const,
                width: '200px',
            },
            signatureLine: {
                borderBottom: '1px dashed #000',
                height: '30px',
                marginBottom: '8px',
            },
            footer: {
                marginTop: '40px',
                fontSize: '12px',
                textAlign: 'center' as const,
                color: '#555',
            }
        };

        return (
            <div ref={ref} style={styles.page}>
                <div style={styles.headerContainer}>
                    <div style={styles.dateText}>วันที่พิมพ์: {formatThaiDateFull(new Date())}</div>
                    <div style={styles.title}>รายงานสรุปรายรับประจำเดือน</div>
                    <div style={styles.subtitle}>หอพัก: {dormName}</div>
                    <div style={styles.addressText}>
                        ประจำเดือน {formatThaiMonthFull(currentMonth)}
                        {billCustomization?.dorm_address ? ` | ${billCustomization.dorm_address}` : ''}
                        {billCustomization?.dorm_phone ? ` | โทร: ${billCustomization.dorm_phone}` : ''}
                    </div>
                </div>

                <table style={styles.table}>
                    <thead>
                        <tr>
                            <th style={{ ...styles.th, width: '40px' }}>ลำดับ</th>
                            <th style={styles.th}>ห้องพัก</th>
                            <th style={styles.th}>ไฟฟ้า (หน่วย)</th>
                            <th style={styles.th}>ค่าไฟฟ้า (บาท)</th>
                            <th style={styles.th}>น้ำประปา (หน่วย)</th>
                            <th style={styles.th}>ค่าน้ำประปา (บาท)</th>
                            <th style={styles.th}>ค่าเช่าห้อง (บาท)</th>
                            <th style={styles.th}>รวมเงิน (บาท)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {monthBills.map((bill, idx) => (
                            <tr key={bill.id}>
                                <td style={styles.tdCenter}>{idx + 1}</td>
                                <td style={styles.tdCenter}>{bill.room_number}</td>
                                <td style={styles.tdCenter}>{bill.elec_units}</td>
                                <td style={styles.tdRight}>{formatCurrency(bill.elec_bill)}</td>
                                <td style={styles.tdCenter}>{bill.water_units}</td>
                                <td style={styles.tdRight}>{formatCurrency(bill.water_bill)}</td>
                                <td style={styles.tdRight}>{formatCurrency(bill.room_rent)}</td>
                                <td style={{ ...styles.tdRight, fontWeight: 'bold' }}>{formatCurrency(bill.total_bill)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr style={{ fontWeight: 'bold', background: '#f8f8f8' }}>
                            <td colSpan={2} style={styles.tdCenter}>รวมทั้งสิ้น ({monthBills.length} ห้อง)</td>
                            <td style={styles.tdCenter}>{totalElecUnits.toLocaleString()}</td>
                            <td style={styles.tdRight}>{formatCurrency(totalElecBill)}</td>
                            <td style={styles.tdCenter}>{totalWaterUnits.toLocaleString()}</td>
                            <td style={styles.tdRight}>{formatCurrency(totalWaterBill)}</td>
                            <td style={styles.tdRight}>{formatCurrency(totalRoomRent)}</td>
                            <td style={styles.tdRight}>{formatCurrency(totalRevenue)}</td>
                        </tr>
                    </tfoot>
                </table>

                <div style={styles.summaryBox}>
                    <div style={{ flex: 1, paddingRight: '20px' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>หมายเหตุ:</div>
                        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px' }}>
                            <li>อัตราค่าไฟฟ้า: {config.electricity_rate} บาท/หน่วย</li>
                            <li>อัตราค่าน้ำประปา: {
                                config.water_config.type === 'normal'
                                    ? `${config.water_config.unit_rate} บาท/หน่วย`
                                    : `เหมา ${config.water_config.flat_price} บาท/${config.water_config.flat_limit_unit} หน่วย`
                            }</li>
                            <li>เอกสารนี้ใช้สำหรับสรุปยอดภายในเท่านั้น</li>
                        </ul>
                    </div>
                    <div>
                        <div style={styles.summaryTitle}>สรุปรายการรายรับ</div>
                        <table style={styles.summaryTable}>
                            <tbody>
                                <tr>
                                    <td style={styles.td}>ค่าไฟฟ้ารวม</td>
                                    <td style={styles.tdRight}>{formatCurrency(totalElecBill)} บาท</td>
                                </tr>
                                <tr>
                                    <td style={styles.td}>ค่าน้ำประปารวม</td>
                                    <td style={styles.tdRight}>{formatCurrency(totalWaterBill)} บาท</td>
                                </tr>
                                <tr>
                                    <td style={styles.td}>ค่าเช่าห้องพักรวม</td>
                                    <td style={styles.tdRight}>{formatCurrency(totalRoomRent)} บาท</td>
                                </tr>
                                <tr style={{ fontWeight: 'bold', background: '#f8f8f8' }}>
                                    <td style={styles.td}>รวมรายรับทั้งสิ้น</td>
                                    <td style={styles.tdRight}>{formatCurrency(totalRevenue)} บาท</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div style={styles.signatureArea}>
                    <div style={styles.signatureBlock}>
                        <div style={styles.signatureLine}></div>
                        <div>( ..................................................... )</div>
                        <div style={{ marginTop: '4px' }}>ผู้จัดทำรายงาน</div>
                    </div>
                    <div style={styles.signatureBlock}>
                        <div style={styles.signatureLine}></div>
                        <div>( ..................................................... )</div>
                        <div style={{ marginTop: '4px' }}>ผู้ตรวจสอบ</div>
                    </div>
                </div>
            </div>
        );
    }
);

MonthlyReport.displayName = 'MonthlyReport';
export default MonthlyReport;
