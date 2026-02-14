import { forwardRef } from 'react';
import type { MonthlyBill, DormConfig } from '../../types';
import { formatCurrency } from '../../utils/calculations';

interface InvoiceBillProps {
    bill: MonthlyBill;
    config: DormConfig;
    billDate: string; // YYYY-MM-DD format
}

function formatThaiDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const thaiMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const thaiYear = year + 543;
    return `${day} ${thaiMonths[month - 1]} ${thaiYear}`;
}

function formatThaiMonth(dateStr: string): string {
    const [year, month] = dateStr.split('-').map(Number);
    const thaiMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const thaiYear = year + 543;
    return `${thaiMonths[month - 1]} ${thaiYear}`;
}

const InvoiceBill = forwardRef<HTMLDivElement, InvoiceBillProps>(
    ({ bill, config, billDate }, ref) => {
        const isWaterFlat = config.water_config.type === 'flat_rate_tier';

        return (
            <div className="invoice-bill" ref={ref}>
                {/* Header */}
                <div className="invoice-header">
                    <h2 className="invoice-title">ใบเรียกเก็บค่าบริการ</h2>
                    <div className="invoice-meta">
                        <div className="invoice-meta-row">
                            <span className="invoice-meta-label">ห้องพัก</span>
                            <span className="invoice-meta-value invoice-room-number">{bill.room_number}</span>
                        </div>
                        <div className="invoice-meta-row">
                            <span className="invoice-meta-label">ประจำเดือน</span>
                            <span className="invoice-meta-value">{formatThaiMonth(bill.month + '-01')}</span>
                        </div>
                        <div className="invoice-meta-row">
                            <span className="invoice-meta-label">วันที่ออกบิล</span>
                            <span className="invoice-meta-value">{formatThaiDate(billDate)}</span>
                        </div>
                    </div>
                </div>

                {/* Bill Table */}
                <table className="invoice-table">
                    <thead>
                        <tr>
                            <th className="invoice-th">รายการ</th>
                            <th className="invoice-th text-center">หน่วยที่ใช้</th>
                            <th className="invoice-th text-right">ค่าต่อหน่วย</th>
                            <th className="invoice-th text-right">จำนวนเงิน (บาท)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* ค่าเช่าห้อง */}
                        <tr className="invoice-row">
                            <td className="invoice-td">
                                <div style={{ fontWeight: 500 }}>ค่าเช่าห้องพัก</div>
                                {bill.room_rent === 0 && (
                                    <div className="invoice-detail">รายเทอม (ไม่คิดค่าเช่ารายเดือน)</div>
                                )}
                            </td>
                            <td className="invoice-td text-center">—</td>
                            <td className="invoice-td text-right">—</td>
                            <td className="invoice-td text-right mono">{bill.room_rent > 0 ? bill.room_rent.toLocaleString() : '0'}</td>
                        </tr>

                        {/* ค่าไฟฟ้า */}
                        <tr className="invoice-row">
                            <td className="invoice-td">
                                <div style={{ fontWeight: 500 }}>ค่าไฟฟ้า</div>
                                <div className="invoice-detail">
                                    เลขเดือนก่อน {bill.prev_elec.toLocaleString()} → เดือนนี้ {bill.curr_elec.toLocaleString()}
                                </div>
                            </td>
                            <td className="invoice-td text-center mono">{bill.elec_units} หน่วย</td>
                            <td className="invoice-td text-right mono">{config.electricity_rate} บาท</td>
                            <td className="invoice-td text-right mono">{bill.elec_bill.toLocaleString()}</td>
                        </tr>

                        {/* ค่าน้ำประปา */}
                        {isWaterFlat ? (
                            <>
                                {/* แบบเหมาจ่าย: แถวเหมาจ่าย */}
                                <tr className="invoice-row">
                                    <td className="invoice-td">
                                        <div style={{ fontWeight: 500 }}>ค่าน้ำประปา (เหมาจ่าย)</div>
                                        <div className="invoice-detail">
                                            เลขเดือนก่อน {bill.prev_water.toLocaleString()} → เดือนนี้ {bill.curr_water.toLocaleString()}
                                        </div>
                                        <div className="invoice-detail">
                                            ใช้ {bill.water_units} หน่วย (เหมา {config.water_config.flat_limit_unit} หน่วยแรก)
                                        </div>
                                    </td>
                                    <td className="invoice-td text-center mono">{bill.water_units} หน่วย</td>
                                    <td className="invoice-td text-right mono">{config.water_config.flat_price?.toLocaleString()} บาท</td>
                                    <td className="invoice-td text-right mono">{(config.water_config.flat_price || 0).toLocaleString()}</td>
                                </tr>
                                {/* ถ้ามีส่วนเกิน ให้แยกแถว */}
                                {bill.water_excess_units > 0 && (
                                    <tr className="invoice-row">
                                        <td className="invoice-td">
                                            <div style={{ fontWeight: 500, color: 'var(--color-warning, #F59E0B)' }}>
                                                ค่าน้ำส่วนเกิน
                                            </div>
                                            <div className="invoice-detail">
                                                ใช้เกินจากเหมา {bill.water_excess_units} หน่วย
                                            </div>
                                        </td>
                                        <td className="invoice-td text-center mono">{bill.water_excess_units} หน่วย</td>
                                        <td className="invoice-td text-right mono">{config.water_config.excess_unit_rate} บาท</td>
                                        <td className="invoice-td text-right mono">{bill.water_excess_amount.toLocaleString()}</td>
                                    </tr>
                                )}
                            </>
                        ) : (
                            /* แบบคิดตามจริง */
                            <tr className="invoice-row">
                                <td className="invoice-td">
                                    <div style={{ fontWeight: 500 }}>ค่าน้ำประปา</div>
                                    <div className="invoice-detail">
                                        เลขเดือนก่อน {bill.prev_water.toLocaleString()} → เดือนนี้ {bill.curr_water.toLocaleString()}
                                    </div>
                                </td>
                                <td className="invoice-td text-center mono">{bill.water_units} หน่วย</td>
                                <td className="invoice-td text-right mono">{config.water_config.unit_rate} บาท</td>
                                <td className="invoice-td text-right mono">{bill.water_bill.toLocaleString()}</td>
                            </tr>
                        )}
                    </tbody>
                    <tfoot>
                        <tr className="invoice-total-row">
                            <td colSpan={3} className="invoice-td invoice-total-label">รวมทั้งสิ้น</td>
                            <td className="invoice-td invoice-total-value text-right mono">
                                {formatCurrency(bill.total_bill)}
                            </td>
                        </tr>
                    </tfoot>
                </table>

                {/* Footer */}
                <div className="invoice-footer">
                    <p>กรุณาชำระภายในวันที่กำหนด ขอบคุณค่ะ/ครับ</p>
                </div>
            </div>
        );
    }
);

InvoiceBill.displayName = 'InvoiceBill';
export default InvoiceBill;
