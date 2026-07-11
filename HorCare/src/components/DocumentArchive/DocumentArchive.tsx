import React, { useState, useRef, useEffect } from 'react';
import { FileText, Download, Printer, Archive, Lock } from 'lucide-react';
import type { MonthlyBill, DormConfig, Room } from '../../types';
import { formatCurrency, formatMonthThai, getCurrentMonth, getPreviousMonth, getEffectiveRates } from '../../utils/calculations';
import MonthlyReport from '../Summary/MonthlyReport';
import PrintBillSlip from '../Summary/PrintBillSlip';
import jsPDF from 'jspdf';
import { toPng } from 'html-to-image';

interface DocumentArchiveProps {
    bills: MonthlyBill[];
    rooms: Room[];
    config: DormConfig;
    isPaid: boolean;
    onUpgrade?: () => void;
}

export default function DocumentArchive({ bills, rooms, config, isPaid, onUpgrade }: DocumentArchiveProps) {
    const [months, setMonths] = useState<string[]>([]);
    
    useEffect(() => {
        const mList = [];
        let m = getCurrentMonth();
        for (let i = 0; i < 6; i++) {
            mList.push(m);
            m = getPreviousMonth(m);
        }
        setMonths(mList);
    }, []);

    const [isExporting, setIsExporting] = useState<string | null>(null);
    const hiddenReportRef = useRef<HTMLDivElement>(null);
    const [printingMonth, setPrintingMonth] = useState<string | null>(null);
    const [hiddenMonth, setHiddenMonth] = useState<string>(getCurrentMonth());
    
    const generatePDFFromElement = async (element: HTMLElement, filename: string) => {
        const dataUrl = await toPng(element, {
            pixelRatio: 3,
            backgroundColor: '#ffffff',
        });

        const img = new Image();
        img.src = dataUrl;
        await new Promise<void>(resolve => { img.onload = () => resolve(); });

        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = pdfWidth;
        const imgHeight = (img.height * imgWidth) / img.width;

        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(dataUrl, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;

        while (heightLeft >= 0) {
            position = heightLeft - imgHeight;
            pdf.addPage();
            pdf.addImage(dataUrl, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pdfHeight;
        }

        pdf.save(filename);
    };

    const handleDownloadReport = async (month: string) => {
        setHiddenMonth(month);
        setIsExporting(month);
        // wait for react to render the hidden component with the new month
        setTimeout(async () => {
            if (hiddenReportRef.current) {
                try {
                    await generatePDFFromElement(hiddenReportRef.current, `HorCare_MonthlyReport_${month}.pdf`);
                } catch (e) {
                    console.error("PDF generation error", e);
                    alert("เกิดข้อผิดพลาดในการสร้าง PDF");
                }
            }
            setIsExporting(null);
        }, 500);
    };

    const handlePrintBills = (month: string) => {
        setPrintingMonth(month);
        setTimeout(() => {
            window.print();
        }, 500);
    };

    if (!isPaid) {
        return (
            <div className="card text-center" style={{ padding: '4rem 2rem', marginTop: '2rem', maxWidth: '600px', margin: '2rem auto' }}>
                <Lock size={56} color="var(--color-warning)" style={{ margin: '0 auto 1.5rem' }} />
                <h3 className="card-title mb-3" style={{ fontSize: '1.5rem' }}>ระบบคลังเอกสารย้อนหลัง</h3>
                <p className="text-muted mb-6" style={{ fontSize: '1rem', lineHeight: 1.6 }}>
                    ฟีเจอร์นี้สำหรับเจ้าของหอที่ต้องการดึงเอกสารสรุปยอดและใบบิลย้อนหลัง 6 เดือน<br/>
                    สงวนสิทธิ์เฉพาะแพ็กเกจแบบชำระเงินเท่านั้น
                </p>
                <button className="btn btn-primary" onClick={onUpgrade} style={{ fontSize: '1rem', padding: '0.75rem 2rem' }}>
                    ดูแพ็กเกจเพื่ออัปเกรด
                </button>
            </div>
        );
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Archive size={28} /> คลังเอกสารย้อนหลัง
                    </h1>
                    <p className="page-subtitle">ดูสรุปยอดและพิมพ์บิลย้อนหลังสูงสุด 6 เดือน</p>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.25rem' }}>
                {months.map(month => {
                    const monthBills = bills.filter(b => b.month === month);
                    const totalRevenue = monthBills.reduce((sum, b) => sum + b.total_bill, 0);
                    const hasData = monthBills.length > 0;
                    
                    return (
                        <div key={month} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
                                    {formatMonthThai(month)}
                                </h3>
                                <span className="badge" style={{ background: hasData ? '#ECFDF5' : '#F3F4F6', color: hasData ? '#059669' : '#6B7280', fontWeight: 600 }}>
                                    {hasData ? `${monthBills.length} ห้อง` : 'ไม่มีข้อมูล'}
                                </span>
                            </div>
                            
                            <div style={{ flex: 1, marginBottom: '1.5rem' }}>
                                <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>ยอดรวมทั้งสิ้น</div>
                                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: hasData ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                                    {formatCurrency(totalRevenue)}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    className="btn btn-outline btn-sm"
                                    style={{ flex: 1 }}
                                    disabled={!hasData || isExporting === month}
                                    onClick={() => handleDownloadReport(month)}
                                >
                                    {isExporting === month ? (
                                        <>
                                            <span className="loading-spinner" style={{ width: 14, height: 14 }}></span> โหลด...
                                        </>
                                    ) : (
                                        <>
                                            <Download size={16} /> สรุปยอด
                                        </>
                                    )}
                                </button>
                                <button
                                    className="btn btn-primary btn-sm"
                                    style={{ flex: 1 }}
                                    disabled={!hasData || isExporting === month}
                                    onClick={() => handlePrintBills(month)}
                                >
                                    <Printer size={16} /> พิมพ์บิล
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Hidden areas for rendering PDFs and Printing */}
            <div style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '900px', padding: '2rem', background: '#fff', pointerEvents: 'none', zIndex: -1 }}>
                <MonthlyReport
                    ref={hiddenReportRef}
                    bills={bills}
                    currentMonth={hiddenMonth}
                    config={config}
                    billCustomization={config.bill_customization}
                />
            </div>

            {/* Hidden Print Area */}
            {printingMonth && (
                <div className="print-only-area">
                    <div className="print-slip-grid">
                        {bills.filter(b => b.month === printingMonth).map((bill) => {
                            const room = rooms.find(r => r.id === bill.room_id);
                            const rates = room ? getEffectiveRates(room, config) : null;
                            return (
                                <PrintBillSlip
                                    key={bill.id}
                                    bill={bill}
                                    config={config}
                                    billDate={`${printingMonth}-25`}
                                    effectiveElecRate={rates?.electricityRate}
                                    effectiveWaterConfig={rates?.waterConfig}
                                    billCustomization={config.bill_customization}
                                />
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
