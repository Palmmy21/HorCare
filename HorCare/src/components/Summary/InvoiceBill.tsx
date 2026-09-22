import { forwardRef } from 'react';
import type { MonthlyBill, DormConfig, WaterConfig, BillCustomization, BillLanguage } from '../../types';
import { formatCurrency } from '../../utils/calculations';
import { t, tBilingual, formatBillDate, formatBillMonth, formatDueNotice } from '../../utils/i18n/billTranslations';
import generatePayload from 'promptpay-qr';
import { QRCodeSVG } from 'qrcode.react';
import { PROMPTPAY_LOGO_DATA_URI } from '../../assets/promptpayLogo';

interface InvoiceBillProps {
    bill: MonthlyBill;
    config: DormConfig;
    billDate: string; // YYYY-MM-DD format
    effectiveElecRate?: number;
    effectiveWaterConfig?: WaterConfig;
    billCustomization?: BillCustomization;
    language?: BillLanguage;
    bilingualMode?: boolean;
    secondaryLanguage?: BillLanguage;
}

const InvoiceBill = forwardRef<HTMLDivElement, InvoiceBillProps>(
    ({ bill, config, billDate, effectiveElecRate, effectiveWaterConfig, billCustomization, language, bilingualMode, secondaryLanguage }, ref) => {
        const lang: BillLanguage = language ?? billCustomization?.default_language ?? 'th';
        const isBilingual: boolean = bilingualMode ?? billCustomization?.bilingual_mode ?? false;
        const secLang: BillLanguage = secondaryLanguage ?? billCustomization?.secondary_language ?? 'en';

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

        const defaultFooter = formatDueNotice(billCustomization?.due_day || 5, lang, isBilingual, secLang);
        const footerText = billCustomization?.footer_text || defaultFooter;

        const phoneLabel = isBilingual ? 'โทร. / Tel.' : (lang === 'en' ? 'Tel.' : (lang === 'zh' ? '电话:' : 'โทร.'));

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
                                    <div className="invoice-address">{phoneLabel} {billCustomization!.dorm_phone}</div>
                                )}
                            </>
                        ) : (
                            <div className="invoice-dorm-name">{tBilingual('invoice_title', lang, isBilingual, secLang)}</div>
                        )}
                    </div>
                    <div className="invoice-details">
                        <h2 className="invoice-title">{tBilingual('invoice_title', lang, isBilingual, secLang)}</h2>
                        <div className="invoice-meta">
                            <div>{tBilingual('bill_date', lang, isBilingual, secLang)}: {formatBillDate(billDate, lang)}</div>
                        </div>
                    </div>
                </div>

                {/* Room & Month Tags */}
                <div style={{ marginBottom: '32px' }}>
                    <div className="invoice-number-box">
                        <span className="invoice-number-label">{tBilingual('room', lang, isBilingual, secLang)}</span>
                        <span className="invoice-number-value">{bill.room_number}</span>
                    </div>
                    <div className="invoice-number-box" style={{ marginLeft: '12px' }}>
                        <span className="invoice-number-label">{tBilingual('month', lang, isBilingual, secLang)}</span>
                        <span className="invoice-number-value">{formatBillMonth(bill.month + '-01', lang)}</span>
                    </div>
                </div>

                {/* Bill Table */}
                <table className="invoice-table">
                    <thead>
                        <tr>
                            <th className="invoice-th">{tBilingual('item', lang, isBilingual, secLang)}</th>
                            <th className="invoice-th text-center">{tBilingual('units_used', lang, isBilingual, secLang)}</th>
                            <th className="invoice-th text-right">{tBilingual('rate_per_unit', lang, isBilingual, secLang)}</th>
                            <th className="invoice-th text-right">{tBilingual('amount_thb', lang, isBilingual, secLang)}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* ค่าเช่าห้อง */}
                        <tr className="invoice-row">
                            <td className="invoice-td">
                                <div style={{ fontWeight: 500 }}>{tBilingual('room_rent', lang, isBilingual, secLang)}</div>
                                {bill.room_rent === 0 && (
                                    <div className="invoice-detail">{tBilingual('semester_rent', lang, isBilingual, secLang)}</div>
                                )}
                            </td>
                            <td className="invoice-td text-center">—</td>
                            <td className="invoice-td text-right">—</td>
                            <td className="invoice-td text-right mono">{bill.room_rent > 0 ? bill.room_rent.toLocaleString() : '0'}</td>
                        </tr>

                        {/* ค่าไฟฟ้า */}
                        <tr className="invoice-row">
                            <td className="invoice-td">
                                <div style={{ fontWeight: 500 }}>{tBilingual('electricity', lang, isBilingual, secLang)}</div>
                                <div className="invoice-detail">
                                    {t('prev_reading', lang)} {bill.prev_elec.toLocaleString()} → {t('curr_reading', lang)} {bill.curr_elec.toLocaleString()}
                                </div>
                            </td>
                            <td className="invoice-td text-center mono">{bill.elec_units} {t('unit_label', lang)}</td>
                            <td className="invoice-td text-right mono">{elecRate} {t('baht_label', lang)}</td>
                            <td className="invoice-td text-right mono">{bill.elec_bill.toLocaleString()}</td>
                        </tr>

                        {/* ค่าน้ำประปา */}
                        {isWaterFlat ? (
                            <>
                                {/* แบบเหมาจ่าย: แถวเหมาจ่าย */}
                                <tr className="invoice-row">
                                    <td className="invoice-td">
                                        <div style={{ fontWeight: 500 }}>{tBilingual('water_flat', lang, isBilingual, secLang)}</div>
                                        <div className="invoice-detail">
                                            {t('prev_reading', lang)} {bill.prev_water.toLocaleString()} → {t('curr_reading', lang)} {bill.curr_water.toLocaleString()}
                                        </div>
                                        <div className="invoice-detail">
                                            {t('units_used', lang)} {bill.water_units} {t('unit_label', lang)} ({adjustedFlatLimit} {t('unit_label', lang)})
                                        </div>
                                        {tenants > 1 && (
                                            <div className="invoice-detail" style={{ color: 'var(--color-info, #3B82F6)' }}>
                                                {tenants} {t('person_unit', lang)} ({waterCfg.flat_limit_unit}×{tenants}={adjustedFlatLimit} {t('unit_label', lang)}, {waterCfg.flat_price?.toLocaleString()}×{tenants}={bill.water_flat_amount.toLocaleString()} {t('baht_label', lang)})
                                            </div>
                                        )}
                                    </td>
                                    <td className="invoice-td text-center mono">{bill.water_units} {t('unit_label', lang)}</td>
                                    <td className="invoice-td text-right mono">{bill.water_flat_amount.toLocaleString()} {t('baht_label', lang)}</td>
                                    <td className="invoice-td text-right mono">{bill.water_flat_amount.toLocaleString()}</td>
                                </tr>
                                {/* ถ้ามีส่วนเกิน ให้แยกแถว */}
                                {bill.water_excess_units > 0 && (
                                    <tr className="invoice-row">
                                        <td className="invoice-td">
                                            <div style={{ fontWeight: 500, color: 'var(--color-warning, #F59E0B)' }}>
                                                {tBilingual('water_excess', lang, isBilingual, secLang)}
                                            </div>
                                            <div className="invoice-detail">
                                                {t('water_excess_detail', lang)} {bill.water_excess_units} {t('unit_label', lang)}
                                            </div>
                                        </td>
                                        <td className="invoice-td text-center mono">{bill.water_excess_units} {t('unit_label', lang)}</td>
                                        <td className="invoice-td text-right mono">{waterCfg.excess_unit_rate} {t('baht_label', lang)}</td>
                                        <td className="invoice-td text-right mono">{bill.water_excess_amount.toLocaleString()}</td>
                                    </tr>
                                )}
                            </>
                        ) : (
                            /* แบบคิดตามจริง */
                            <tr className="invoice-row">
                                <td className="invoice-td">
                                    <div style={{ fontWeight: 500 }}>{tBilingual('water', lang, isBilingual, secLang)}</div>
                                    <div className="invoice-detail">
                                        {t('prev_reading', lang)} {bill.prev_water.toLocaleString()} → {t('curr_reading', lang)} {bill.curr_water.toLocaleString()}
                                    </div>
                                </td>
                                <td className="invoice-td text-center mono">{bill.water_units} {t('unit_label', lang)}</td>
                                <td className="invoice-td text-right mono">{waterCfg.unit_rate} {t('baht_label', lang)}</td>
                                <td className="invoice-td text-right mono">{bill.water_bill.toLocaleString()}</td>
                            </tr>
                        )}

                        {/* ค่าส่วนกลาง */}
                        {bill.common_fee > 0 && (
                            <tr className="invoice-row">
                                <td className="invoice-td">
                                    <div style={{ fontWeight: 500 }}>{tBilingual('common_fee', lang, isBilingual, secLang)}</div>
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
                        <span>{tBilingual('total_amount', lang, isBilingual, secLang)}</span>
                        <span className="value">{formatCurrency(bill.total_bill)}</span>
                    </div>
                </div>

                {/* QR Code + Footer Section */}
                <div className="invoice-bottom-section">
                    {/* QR Code */}
                    {billCustomization?.promptpay_number && (
                        <div className="invoice-qr-section">
                            <div className="invoice-qr-label">{tBilingual('scan_promptpay', lang, isBilingual, secLang)}</div>
                            <div style={{ background: '#fff', padding: '12px', borderRadius: '12px', display: 'inline-block' }}>
                                <QRCodeSVG 
                                    value={generatePayload(billCustomization.promptpay_number, { amount: bill.total_bill })}
                                    size={140}
                                    level="H"
                                    imageSettings={{
                                        src: PROMPTPAY_LOGO_DATA_URI,
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
