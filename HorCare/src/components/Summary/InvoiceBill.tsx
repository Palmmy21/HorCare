import { forwardRef } from 'react';
import type { MonthlyBill, DormConfig, WaterConfig, BillCustomization } from '../../types';
import { formatCurrency } from '../../utils/calculations';
import generatePayload from 'promptpay-qr';
import { QRCodeSVG } from 'qrcode.react';

interface InvoiceBillProps {
    bill: MonthlyBill;
    config: DormConfig;
    billDate: string; // YYYY-MM-DD format
    effectiveElecRate?: number;
    effectiveWaterConfig?: WaterConfig;
    billCustomization?: BillCustomization;
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
    ({ bill, config, billDate, effectiveElecRate, effectiveWaterConfig, billCustomization }, ref) => {
        const elecRate = effectiveElecRate ?? config.electricity_rate;
        const waterCfg = effectiveWaterConfig ?? config.water_config;
        const isWaterFlat = waterCfg.type === 'flat_rate_tier';
        const tenants = Math.max(1, bill.tenant_count || 1);
        const adjustedFlatLimit = (waterCfg.flat_limit_unit || 0) * tenants;

        const hasDormInfo = billCustomization && (
            billCustomization.dorm_name ||
            billCustomization.dorm_address ||
            billCustomization.dorm_phone
        );

        const footerText = billCustomization?.footer_text ||
            `กรุณาชำระภายในวันที่ ${billCustomization?.due_day || 5} ของทุกเดือน`;

        return (
            <div className="invoice-bill" ref={ref}>
                {/* Premium Header */}
                <div className="invoice-header">
                    <div>
                        {hasDormInfo ? (
                            <>
                                {billCustomization!.dorm_name && (
                                    <div className="invoice-dorm-name">{billCustomization!.dorm_name}</div>
                                )}
                                {billCustomization!.dorm_address && (
                                    <div className="invoice-address">{billCustomization!.dorm_address}</div>
                                )}
                                {billCustomization!.dorm_phone && (
                                    <div className="invoice-address">โทร. {billCustomization!.dorm_phone}</div>
                                )}
                            </>
                        ) : (
                            <div className="invoice-dorm-name">ใบแจ้งหนี้</div>
                        )}
                    </div>
                    <div className="invoice-details">
                        <h2 className="invoice-title">ใบแจ้งหนี้</h2>
                        <div className="invoice-meta">
                            <div>วันที่ออกบิล: {formatThaiDate(billDate)}</div>
                        </div>
                    </div>
                </div>

                {/* Room & Month Tags */}
                <div style={{ marginBottom: '32px' }}>
                    <div className="invoice-number-box">
                        <span className="invoice-number-label">ห้องพัก</span>
                        <span className="invoice-number-value">{bill.room_number}</span>
                    </div>
                    <div className="invoice-number-box" style={{ marginLeft: '12px' }}>
                        <span className="invoice-number-label">ประจำเดือน</span>
                        <span className="invoice-number-value">{formatThaiMonth(bill.month + '-01')}</span>
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
                            <td className="invoice-td text-right mono">{elecRate} บาท</td>
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
                                            ใช้ {bill.water_units} หน่วย (เหมา {adjustedFlatLimit} หน่วยแรก)
                                        </div>
                                        {tenants > 1 && (
                                            <div className="invoice-detail" style={{ color: 'var(--color-info, #3B82F6)' }}>
                                                พัก {tenants} คน (เหมา {waterCfg.flat_limit_unit}×{tenants}={adjustedFlatLimit} หน่วย, {waterCfg.flat_price?.toLocaleString()}×{tenants}={bill.water_flat_amount.toLocaleString()} บาท)
                                            </div>
                                        )}
                                    </td>
                                    <td className="invoice-td text-center mono">{bill.water_units} หน่วย</td>
                                    <td className="invoice-td text-right mono">{bill.water_flat_amount.toLocaleString()} บาท</td>
                                    <td className="invoice-td text-right mono">{bill.water_flat_amount.toLocaleString()}</td>
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
                                        <td className="invoice-td text-right mono">{waterCfg.excess_unit_rate} บาท</td>
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
                                <td className="invoice-td text-right mono">{waterCfg.unit_rate} บาท</td>
                                <td className="invoice-td text-right mono">{bill.water_bill.toLocaleString()}</td>
                            </tr>
                        )}

                        {/* ค่าส่วนกลาง */}
                        {bill.common_fee > 0 && (
                            <tr className="invoice-row">
                                <td className="invoice-td">
                                    <div style={{ fontWeight: 500 }}>ค่าส่วนกลาง</div>
                                    {bill.applied_common_fees && bill.applied_common_fees.length > 0 && (
                                        <div className="invoice-detail">
                                            {bill.applied_common_fees.map(f => f.name).join(', ')}
                                        </div>
                                    )}
                                </td>
                                <td className="invoice-td text-center">—</td>
                                <td className="invoice-td text-right">—</td>
                                <td className="invoice-td text-right mono">{bill.common_fee.toLocaleString()}</td>
                            </tr>
                        )}
                    </tbody>
                </table>

                {/* Summary Box */}
                <div className="invoice-summary-box">
                    <div className="invoice-summary-row total">
                        <span>รวมทั้งสิ้น</span>
                        <span className="value">{formatCurrency(bill.total_bill)}</span>
                    </div>
                </div>

                {/* QR Code + Footer Section */}
                <div className="invoice-bottom-section">
                    {/* QR Code */}
                    {billCustomization?.promptpay_number && (
                        <div className="invoice-qr-section">
                            <div className="invoice-qr-label">สแกนจ่ายผ่าน PromptPay</div>
                            <div style={{ background: '#fff', padding: '12px', borderRadius: '12px', display: 'inline-block' }}>
                                <QRCodeSVG 
                                    value={generatePayload(billCustomization.promptpay_number, { amount: bill.total_bill })}
                                    size={140}
                                    level="H"
                                    imageSettings={{
                                        src: "https://commons.wikimedia.org/wiki/Special:FilePath/PromptPay-logo.png",
                                        height: 20,
                                        width: 50,
                                        excavate: true,
                                    }}
                                />
                            </div>
                            {billCustomization.promptpay_name && (
                                <div style={{ fontSize: '13px', marginTop: '8px', textAlign: 'center', color: '#475569', fontWeight: 500 }}>
                                    {billCustomization.promptpay_name}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Footer */}
                    <div className="invoice-footer-msg">
                        {footerText}
                    </div>
                </div>
            </div>
        );
    }
);

InvoiceBill.displayName = 'InvoiceBill';
export default InvoiceBill;
