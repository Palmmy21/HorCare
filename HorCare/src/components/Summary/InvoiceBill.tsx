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
        const waterRateDisplay = config.water_config.type === 'normal'
            ? config.water_config.unit_rate || 0
            : config.water_config.flat_price || 0;

        const isWaterFlat = config.water_config.type === 'flat_rate_tier';

        return (
            <div className="invoice-bill" ref={ref}>
                {/* Header */}
                <div className="invoice-header">
                    <h2 className="invoice-title">ใบแจ้งยอด</h2>
                    <div className="invoice-meta">
                        <div className="invoice-meta-row">
                            <span className="invoice-meta-label">ห้อง</span>
                            <span className="invoice-meta-value invoice-room-number">{bill.room_number}</span>
                        </div>
                        <div className="invoice-meta-row">
                            <span className="invoice-meta-label">เดือน</span>
                            <span className="invoice-meta-value">{formatThaiMonth(bill.month + '-01')}</span>
                        </div>
                        <div className="invoice-meta-row">
                            <span className="invoice-meta-label">วันที่</span>
                            <span className="invoice-meta-value">{formatThaiDate(billDate)}</span>
                        </div>
                    </div>
                </div>

                {/* Bill Table */}
                <table className="invoice-table">
                    <thead>
                        <tr>
                            <th className="invoice-th">จำนวน</th>
                            <th className="invoice-th">รายการ</th>
                            <th className="invoice-th text-right">หน่วยละ</th>
                            <th className="invoice-th text-right">จำนวนเงิน</th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* ค่าเช่า */}
                        <tr className="invoice-row">
                            <td className="invoice-td text-center">1</td>
                            <td className="invoice-td">ค่าเช่า</td>
                            <td className="invoice-td text-right">—</td>
                            <td className="invoice-td text-right mono">{bill.room_rent > 0 ? bill.room_rent.toLocaleString() : '—'}</td>
                        </tr>

                        {/* ค่าไฟฟ้า */}
                        <tr className="invoice-row">
                            <td className="invoice-td text-center">{bill.elec_units}</td>
                            <td className="invoice-td">
                                ค่าไฟฟ้า
                                <span className="invoice-detail">
                                    ({bill.prev_elec.toLocaleString()} → {bill.curr_elec.toLocaleString()})
                                </span>
                            </td>
                            <td className="invoice-td text-right mono">{config.electricity_rate}</td>
                            <td className="invoice-td text-right mono">{bill.elec_bill.toLocaleString()}</td>
                        </tr>

                        {/* ค่าน้ำประปา */}
                        <tr className="invoice-row">
                            <td className="invoice-td text-center">{bill.water_units}</td>
                            <td className="invoice-td">
                                ค่าน้ำประปา
                                <span className="invoice-detail">
                                    ({bill.prev_water.toLocaleString()} → {bill.curr_water.toLocaleString()})
                                    {isWaterFlat && bill.water_excess_units > 0
                                        ? ` เกิน ${bill.water_excess_units} หน่วย`
                                        : isWaterFlat ? ' (เหมาจ่าย)' : ''
                                    }
                                </span>
                            </td>
                            <td className="invoice-td text-right mono">
                                {isWaterFlat
                                    ? `${waterRateDisplay}`
                                    : `${waterRateDisplay}`
                                }
                            </td>
                            <td className="invoice-td text-right mono">{bill.water_bill.toLocaleString()}</td>
                        </tr>
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
                    <p>กรุณาชำระภายในวันที่กำหนด</p>
                </div>
            </div>
        );
    }
);

InvoiceBill.displayName = 'InvoiceBill';
export default InvoiceBill;
