import type { MonthlyBill, DormConfig, WaterConfig, BillCustomization, BillLanguage } from '../../types';
import { t, tBilingual, formatBillDate, formatBillMonth, formatDueNotice } from '../../utils/i18n/billTranslations';

interface Props {
    bill: MonthlyBill;
    config: DormConfig;
    billDate: string;
    effectiveElecRate?: number;
    effectiveWaterConfig?: WaterConfig;
    billCustomization?: BillCustomization;
    language?: BillLanguage;
    bilingualMode?: boolean;
    secondaryLanguage?: BillLanguage;
}

function n(v: number) { return v.toLocaleString('th-TH'); }

export default function PrintBillSlip({ bill, config, billDate, effectiveElecRate, effectiveWaterConfig, billCustomization, language, bilingualMode, secondaryLanguage }: Props) {
    const lang: BillLanguage = language ?? billCustomization?.default_language ?? 'th';
    const isBilingual: boolean = bilingualMode ?? billCustomization?.bilingual_mode ?? false;
    const secLang: BillLanguage = secondaryLanguage ?? billCustomization?.secondary_language ?? 'en';

    const elecRate = effectiveElecRate ?? config.electricity_rate;
    const waterCfg = effectiveWaterConfig ?? config.water_config;
    const dormName = billCustomization?.dorm_name || tBilingual('invoice_or_receipt', lang, isBilingual, secLang);
    const phone    = billCustomization?.dorm_phone || '';
    const address  = billCustomization?.dorm_address || '';
    const defaultFooter = formatDueNotice(billCustomization?.due_day ?? 5, lang, isBilingual, secLang);
    const footer   = billCustomization?.footer_text || defaultFooter;
    const isFlat   = waterCfg.type === 'flat_rate_tier';
    const tenants  = Math.max(1, bill.tenant_count || 1);

    const tdL: React.CSSProperties = { textAlign: 'left', padding: '2px 4px', fontSize: 11, lineHeight: 1.4, verticalAlign: 'top' };
    const tdR: React.CSSProperties = { ...tdL, textAlign: 'right', whiteSpace: 'nowrap' };
    const divLine: React.CSSProperties = { borderTop: '1px solid #000', margin: '3px 0' };

    const phonePrefix = isBilingual ? 'โทร. / Tel.' : (lang === 'en' ? 'Tel.' : (lang === 'zh' ? '电话:' : 'โทร.'));
    const signLabel = isBilingual ? 'ลายเซ็นผู้รับเงิน / Authorized Signature' : (lang === 'en' ? 'Authorized Signature' : (lang === 'zh' ? '收款人签名' : (lang === 'my' ? 'ငွေလက်ခံသူ လက်မှတ်' : 'ลายเซ็นผู้รับเงิน')));

    return (
        <div className="print-slip-box">
            {/* Header */}
            <div style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: 4, marginBottom: 4 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{dormName}</div>
                {address && <div style={{ fontSize: 10, color: '#333' }}>{address}</div>}
                {phone && <div style={{ fontSize: 10, color: '#333' }}>{phonePrefix} {phone}</div>}
                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>
                    {tBilingual('invoice_or_receipt', lang, isBilingual, secLang)}
                </div>
            </div>

            {/* Room + date */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 4 }}>
                <tbody>
                    <tr>
                        <td style={tdL}><b>{tBilingual('room', lang, isBilingual, secLang)}:</b> {bill.room_number}</td>
                        <td style={tdR}><b>{tBilingual('month', lang, isBilingual, secLang)}:</b> {formatBillMonth(bill.month + '-01', lang)}</td>
                    </tr>
                    <tr>
                        <td style={tdL} colSpan={2}><b>{tBilingual('bill_date', lang, isBilingual, secLang)}:</b> {formatBillDate(billDate, lang)}</td>
                    </tr>
                    {tenants > 1 && (
                        <tr>
                            <td style={tdL} colSpan={2}><b>{tBilingual('tenant_count', lang, isBilingual, secLang)}:</b> {tenants} {t('person_unit', lang)}</td>
                        </tr>
                    )}
                </tbody>
            </table>

            <div style={divLine} />

            {/* Items */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        <th style={{ ...tdL, fontWeight: 700, borderBottom: '1px solid #000' }}>{tBilingual('item', lang, isBilingual, secLang)}</th>
                        <th style={{ ...tdR, fontWeight: 700, borderBottom: '1px solid #000' }}>{tBilingual('amount_thb', lang, isBilingual, secLang)}</th>
                    </tr>
                </thead>
                <tbody>
                    {/* ค่าเช่า */}
                    <tr>
                        <td style={tdL}>
                            {tBilingual('room_rent', lang, isBilingual, secLang)}
                            {bill.room_rent === 0 && <span style={{ fontSize: 9, color: '#555' }}> ({tBilingual('semester_rent', lang, isBilingual, secLang)})</span>}
                        </td>
                        <td style={tdR}>{n(bill.room_rent)}</td>
                    </tr>

                    {/* ค่าไฟ */}
                    <tr>
                        <td style={tdL}>
                            {tBilingual('electricity', lang, isBilingual, secLang)} ({n(bill.elec_units)} {t('unit_label', lang)} × {elecRate})
                            <div style={{ fontSize: 9, color: '#555' }}>{n(bill.prev_elec)} → {n(bill.curr_elec)}</div>
                        </td>
                        <td style={tdR}>{n(bill.elec_bill)}</td>
                    </tr>

                    {/* ค่าน้ำ */}
                    {isFlat ? (
                        <>
                            <tr>
                                <td style={tdL}>
                                    {tBilingual('water_flat', lang, isBilingual, secLang)} ({n(bill.water_flat_amount)} {t('baht_label', lang)})
                                    <div style={{ fontSize: 9, color: '#555' }}>{n(bill.prev_water)} → {n(bill.curr_water)} · {n(bill.water_units)} {t('unit_label', lang)}</div>
                                </td>
                                <td style={tdR}>{n(bill.water_flat_amount)}</td>
                            </tr>
                            {bill.water_excess_units > 0 && (
                                <tr>
                                    <td style={tdL}>{tBilingual('water_excess', lang, isBilingual, secLang)} ({n(bill.water_excess_units)} × {waterCfg.excess_unit_rate})</td>
                                    <td style={tdR}>{n(bill.water_excess_amount)}</td>
                                </tr>
                            )}
                        </>
                    ) : (
                        <tr>
                            <td style={tdL}>
                                {tBilingual('water', lang, isBilingual, secLang)} ({n(bill.water_units)} {t('unit_label', lang)} × {waterCfg.unit_rate})
                                <div style={{ fontSize: 9, color: '#555' }}>{n(bill.prev_water)} → {n(bill.curr_water)}</div>
                            </td>
                            <td style={tdR}>{n(bill.water_bill)}</td>
                        </tr>
                    )}

                    {/* ค่าส่วนกลาง */}
                    {bill.common_fee ? (
                        <tr>
                            <td style={tdL}>
                                {tBilingual('common_fee', lang, isBilingual, secLang)}
                                {bill.applied_common_fees && bill.applied_common_fees.length > 0 && (
                                    <div style={{ fontSize: 9, color: '#555' }}>
                                        {bill.applied_common_fees.map(f => f.name).join(', ')}
                                    </div>
                                )}
                            </td>
                            <td style={tdR}>{n(bill.common_fee)}</td>
                        </tr>
                    ) : null}
                </tbody>
            </table>

            <div style={{ borderTop: '2px solid #000', margin: '4px 0' }} />

            {/* Total */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                    <tr>
                        <td style={{ ...tdL, fontWeight: 700, fontSize: 12 }}>{tBilingual('total_amount', lang, isBilingual, secLang)}</td>
                        <td style={{ ...tdR, fontWeight: 700, fontSize: 13 }}>{n(bill.total_bill)} {t('baht_label', lang)}</td>
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
                    {signLabel}
                </div>
            </div>
        </div>
    );
}
