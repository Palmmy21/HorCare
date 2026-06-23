import type { MonthlyBill, DormConfig, WaterConfig, BillCustomization } from '../../types';

interface Props {
    bill: MonthlyBill;
    config: DormConfig;
    billDate: string;
    effectiveElecRate?: number;
    effectiveWaterConfig?: WaterConfig;
    billCustomization?: BillCustomization;
}

const THAI_MONTHS = [
    'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม',
];
function thaiMonth(m: string) {
    const [y, mo] = m.split('-').map(Number);
    return `${THAI_MONTHS[mo - 1]} ${y + 543}`;
}
function thaiDate(d: string) {
    const [y, m, day] = d.split('-').map(Number);
    return `${day} ${THAI_MONTHS[m - 1]} ${y + 543}`;
}
function n(v: number) { return v.toLocaleString('th-TH'); }

export default function PrintBillSlip({ bill, config, billDate, effectiveElecRate, effectiveWaterConfig, billCustomization }: Props) {
    const elecRate = effectiveElecRate ?? config.electricity_rate;
    const waterCfg = effectiveWaterConfig ?? config.water_config;
    const dormName = billCustomization?.dorm_name || 'ใบแจ้งหนี้';
    const phone    = billCustomization?.dorm_phone || '';
    const address  = billCustomization?.dorm_address || '';
    const footer   = billCustomization?.footer_text || `กรุณาชำระภายในวันที่ ${billCustomization?.due_day ?? 5} ของทุกเดือน`;
    const isFlat   = waterCfg.type === 'flat_rate_tier';
    const tenants  = Math.max(1, bill.tenant_count || 1);

    const tdL: React.CSSProperties = { textAlign: 'left', padding: '2px 4px', fontSize: 11, lineHeight: 1.4, verticalAlign: 'top' };
    const tdR: React.CSSProperties = { ...tdL, textAlign: 'right', whiteSpace: 'nowrap' };
    const divLine: React.CSSProperties = { borderTop: '1px solid #000', margin: '3px 0' };

    return (
        <div className="print-slip-box">
            {/* Header */}
            <div style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: 4, marginBottom: 4 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{dormName}</div>
                {address && <div style={{ fontSize: 10, color: '#333' }}>{address}</div>}
                {phone && <div style={{ fontSize: 10, color: '#333' }}>โทร. {phone}</div>}
                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>ใบแจ้งหนี้ / ใบเสร็จรับเงิน</div>
            </div>

            {/* Room + date */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 4 }}>
                <tbody>
                    <tr>
                        <td style={tdL}><b>ห้อง:</b> {bill.room_number}</td>
                        <td style={tdR}><b>เดือน:</b> {thaiMonth(bill.month)}</td>
                    </tr>
                    <tr>
                        <td style={tdL} colSpan={2}><b>วันที่ออกบิล:</b> {thaiDate(billDate)}</td>
                    </tr>
                    {tenants > 1 && (
                        <tr>
                            <td style={tdL} colSpan={2}><b>จำนวนผู้เช่า:</b> {tenants} คน</td>
                        </tr>
                    )}
                </tbody>
            </table>

            <div style={divLine} />

            {/* Items */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        <th style={{ ...tdL, fontWeight: 700, borderBottom: '1px solid #000' }}>รายการ</th>
                        <th style={{ ...tdR, fontWeight: 700, borderBottom: '1px solid #000' }}>จำนวนเงิน</th>
                    </tr>
                </thead>
                <tbody>
                    {/* ค่าเช่า */}
                    <tr>
                        <td style={tdL}>
                            ค่าเช่าห้อง
                            {bill.room_rent === 0 && <span style={{ fontSize: 9, color: '#555' }}> (รายเทอม)</span>}
                        </td>
                        <td style={tdR}>{n(bill.room_rent)}</td>
                    </tr>

                    {/* ค่าไฟ */}
                    <tr>
                        <td style={tdL}>
                            ค่าไฟฟ้า ({n(bill.elec_units)} หน่วย × {elecRate})
                            <div style={{ fontSize: 9, color: '#555' }}>{n(bill.prev_elec)} → {n(bill.curr_elec)}</div>
                        </td>
                        <td style={tdR}>{n(bill.elec_bill)}</td>
                    </tr>

                    {/* ค่าน้ำ */}
                    {isFlat ? (
                        <>
                            <tr>
                                <td style={tdL}>
                                    ค่าน้ำ (เหมา {n(bill.water_flat_amount)} บ.)
                                    <div style={{ fontSize: 9, color: '#555' }}>{n(bill.prev_water)} → {n(bill.curr_water)} · {n(bill.water_units)} หน่วย</div>
                                </td>
                                <td style={tdR}>{n(bill.water_flat_amount)}</td>
                            </tr>
                            {bill.water_excess_units > 0 && (
                                <tr>
                                    <td style={tdL}>ค่าน้ำส่วนเกิน ({n(bill.water_excess_units)} × {waterCfg.excess_unit_rate})</td>
                                    <td style={tdR}>{n(bill.water_excess_amount)}</td>
                                </tr>
                            )}
                        </>
                    ) : (
                        <tr>
                            <td style={tdL}>
                                ค่าน้ำ ({n(bill.water_units)} หน่วย × {waterCfg.unit_rate})
                                <div style={{ fontSize: 9, color: '#555' }}>{n(bill.prev_water)} → {n(bill.curr_water)}</div>
                            </td>
                            <td style={tdR}>{n(bill.water_bill)}</td>
                        </tr>
                    )}
                </tbody>
            </table>

            <div style={{ borderTop: '2px solid #000', margin: '4px 0' }} />

            {/* Total */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                    <tr>
                        <td style={{ ...tdL, fontWeight: 700, fontSize: 12 }}>รวมทั้งสิ้น</td>
                        <td style={{ ...tdR, fontWeight: 700, fontSize: 13 }}>{n(bill.total_bill)} บาท</td>
                    </tr>
                </tbody>
            </table>

            <div style={divLine} />

            {/* Footer */}
            <div style={{ fontSize: 9, color: '#444', marginTop: 3, lineHeight: 1.4 }}>{footer}</div>

            {/* Signature line */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <div style={{ textAlign: 'center', fontSize: 9 }}>
                    <div style={{ borderTop: '1px solid #000', width: 80, marginBottom: 2 }} />
                    ลายเซ็นผู้รับเงิน
                </div>
            </div>
        </div>
    );
}
