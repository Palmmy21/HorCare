import { useState, useRef, useCallback } from 'react';
import {
    Rocket, CheckCircle, XCircle, AlertTriangle,
    FileText, Send, Lock, Download, Eye, Printer
} from 'lucide-react';
import type { MonthlyBill, DormConfig, Room } from '../../types';
import { formatCurrency, formatMonthThai, getEffectiveRates } from '../../utils/calculations';
import InvoiceBill from './InvoiceBill';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface SummaryProps {
    bills: MonthlyBill[];
    rooms: Room[];
    config: DormConfig;
    currentMonth: string;
    stats: {
        savedCount: number;
        totalRooms: number;
        totalRevenue: number;
        isAllSaved: boolean;
        progress: number;
    };
    onCloseMonth: (month: string) => void;
}

export default function Summary({
    bills,
    rooms,
    config,
    currentMonth,
    stats,
    onCloseMonth
}: SummaryProps) {
    const [showConfirm, setShowConfirm] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [sendComplete, setSendComplete] = useState(false);
    const [billDate, setBillDate] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    const [selectedBill, setSelectedBill] = useState<MonthlyBill | null>(null);
    const [showAllInvoices, setShowAllInvoices] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const printRef = useRef<HTMLDivElement>(null);
    const invoiceRef = useRef<HTMLDivElement>(null);

    const monthBills = bills.filter(b => b.month === currentMonth);
    const isLocked = monthBills.some(b => b.is_locked);

    const handleCloseMonth = async () => {
        setIsSending(true);

        // Simulate sending process
        await new Promise(resolve => setTimeout(resolve, 1500));

        onCloseMonth(currentMonth);
        setIsSending(false);
        setSendComplete(true);
        setShowConfirm(false);
    };

    const [isExporting, setIsExporting] = useState(false);
    const reportRef = useRef<HTMLDivElement>(null);

    const generatePDF = async () => {
        if (!reportRef.current) return;

        setIsExporting(true);
        try {
            const canvas = await html2canvas(reportRef.current, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff'
            });

            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();
            const imgWidth = pdfWidth;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;

            let heightLeft = imgHeight;
            let position = 0;

            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pdfHeight;

            while (heightLeft >= 0) {
                position = heightLeft - imgHeight;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pdfHeight;
            }

            pdf.save(`HorCare_Summary_${currentMonth}.pdf`);
        } catch (error) {
            console.error('PDF Generation failed:', error);
            alert('เกิดข้อผิดพลาดในการสร้าง PDF');
        } finally {
            setIsExporting(false);
        }
    };

    const handlePrintAll = () => {
        setShowAllInvoices(true);
        setTimeout(() => {
            window.print();
        }, 300);
    };

    const handleDownloadBill = useCallback(async (bill: MonthlyBill) => {
        setIsDownloading(true);
        // Briefly show the bill in the modal so we can capture it
        setSelectedBill(bill);
        // Wait for render
        await new Promise(resolve => setTimeout(resolve, 400));

        const el = invoiceRef.current;
        if (!el) {
            setIsDownloading(false);
            return;
        }

        try {
            const canvas = await html2canvas(el, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff'
            });
            const link = document.createElement('a');
            link.download = `bill_${bill.room_number}_${currentMonth}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (err) {
            console.error('Download failed:', err);
        } finally {
            setIsDownloading(false);
        }
    }, [currentMonth]);

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">📊 สรุปยอดรายเดือน</h1>
                <p className="page-subtitle">
                    รอบเดือน {formatMonthThai(currentMonth)}
                </p>
            </div>

            {/* Bill Date Selector */}
            <div className="card mb-6">
                <div className="card-header">
                    <span className="card-title">📅 วันที่ในบิล</span>
                </div>
                <div className="flex gap-4 items-center" style={{ flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <input
                            type="date"
                            className="form-input mono"
                            style={{ maxWidth: '200px' }}
                            value={billDate}
                            onChange={e => setBillDate(e.target.value)}
                        />
                        <p className="form-hint">วันที่ที่จะแสดงในใบแจ้งยอด</p>
                    </div>
                    {monthBills.length > 0 && (
                        <button className="btn btn-outline" onClick={handlePrintAll}>
                            <Printer size={18} />
                            🖨️ พิมพ์ใบแจ้งยอดทั้งหมด
                        </button>
                    )}
                </div>
            </div>

            {/* Status Card */}
            <div className={`card mb-6 ${isLocked ? 'saved' : ''}`}>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="card-title flex items-center gap-2">
                            {isLocked ? (
                                <>
                                    <Lock size={20} color="#16A34A" />
                                    เดือนนี้ปิดยอดแล้ว
                                </>
                            ) : stats.isAllSaved ? (
                                <>
                                    <CheckCircle size={20} color="#16A34A" />
                                    จดครบทุกห้องแล้ว พร้อมส่งบิล!
                                </>
                            ) : (
                                <>
                                    <AlertTriangle size={20} color="#F59E0B" />
                                    ยังจดไม่ครบ ({stats.savedCount}/{stats.totalRooms} ห้อง)
                                </>
                            )}
                        </h3>
                    </div>
                    <div className="stat-value text-success">
                        {formatCurrency(stats.totalRevenue)}
                    </div>
                </div>
            </div>

            {/* Summary Table */}
            <div className="card mb-6">
                <div className="card-header">
                    <span className="card-title">📋 รายการบิลทั้งหมด</span>
                    <button className="btn btn-outline btn-sm" onClick={generatePDF} disabled={isExporting}>
                        <Download size={16} />
                        {isExporting ? 'สร้าง PDF...' : 'Export PDF'}
                    </button>
                </div>

                {monthBills.length === 0 ? (
                    <div className="empty-state">
                        <FileText size={48} />
                        <h3>ยังไม่มีข้อมูลบิล</h3>
                        <p>กรุณาจดมิเตอร์และบันทึกข้อมูลก่อน</p>
                    </div>
                ) : (
                    <>
                        {/* Desktop Table */}
                        <div className="table-container summary-table-desktop">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>ห้อง</th>
                                        <th className="text-center">ไฟฟ้า</th>
                                        <th className="text-center">น้ำประปา</th>
                                        <th className="text-right">ค่าห้อง</th>
                                        <th className="text-right">ยอดรวม</th>
                                        <th className="text-center">สถานะ</th>
                                        <th className="text-center">ใบแจ้งยอด</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {monthBills.map(bill => (
                                        <tr key={bill.id}>
                                            <td className="mono font-bold">{bill.room_number}</td>
                                            <td className="text-center">
                                                <div className="mono">{bill.elec_units} หน่วย</div>
                                                <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                    {formatCurrency(bill.elec_bill)}
                                                </div>
                                            </td>
                                            <td className="text-center">
                                                <div className="mono">{bill.water_units} หน่วย</div>
                                                <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                    {bill.water_excess_units > 0
                                                        ? `เกิน ${bill.water_excess_units} หน่วย`
                                                        : 'เหมาจ่าย'
                                                    }
                                                </div>
                                                <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                    {formatCurrency(bill.water_bill)}
                                                </div>
                                            </td>
                                            <td className="text-right mono">{formatCurrency(bill.room_rent)}</td>
                                            <td className="text-right mono font-bold">{formatCurrency(bill.total_bill)}</td>
                                            <td className="text-center">
                                                {bill.is_locked ? (
                                                    <span className="badge badge-success">
                                                        <Lock size={12} />
                                                        ปิดยอดแล้ว
                                                    </span>
                                                ) : bill.is_saved ? (
                                                    <span className="badge badge-success">
                                                        <CheckCircle size={12} />
                                                        พร้อมส่ง
                                                    </span>
                                                ) : (
                                                    <span className="badge badge-warning">
                                                        <AlertTriangle size={12} />
                                                        รอบันทึก
                                                    </span>
                                                )}
                                            </td>
                                            <td className="text-center">
                                                <div className="flex gap-2 justify-center">
                                                    <button
                                                        className="btn btn-outline btn-sm"
                                                        onClick={() => setSelectedBill(bill)}
                                                        title="ดูใบแจ้งยอด"
                                                    >
                                                        <Eye size={14} />
                                                        ดูบิล
                                                    </button>
                                                    <button
                                                        className="btn btn-outline btn-sm"
                                                        onClick={() => handleDownloadBill(bill)}
                                                        title="ดาวน์โหลดใบแจ้งยอด"
                                                        disabled={isDownloading}
                                                    >
                                                        <Download size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr style={{ background: 'var(--color-gray-50)' }}>
                                        <td colSpan={4} className="text-right font-bold">รวมทั้งสิ้น</td>
                                        <td className="text-right mono font-bold" style={{ fontSize: '1.125rem', color: 'var(--color-primary)' }}>
                                            {formatCurrency(stats.totalRevenue)}
                                        </td>
                                        <td colSpan={2}></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {/* Mobile Cards */}
                        <div className="summary-cards-mobile">
                            {monthBills.map(bill => (
                                <div key={bill.id} className="summary-bill-card">
                                    <div className="summary-bill-card-header">
                                        <span className="mono font-bold" style={{ fontSize: '1.125rem' }}>🏠 {bill.room_number}</span>
                                        {bill.is_locked ? (
                                            <span className="badge badge-success"><Lock size={12} /> ปิดยอด</span>
                                        ) : bill.is_saved ? (
                                            <span className="badge badge-success"><CheckCircle size={12} /> พร้อมส่ง</span>
                                        ) : (
                                            <span className="badge badge-warning"><AlertTriangle size={12} /> รอบันทึก</span>
                                        )}
                                    </div>
                                    <div className="summary-bill-card-body">
                                        <div className="summary-bill-card-row">
                                            <span>⚡ ไฟฟ้า</span>
                                            <span className="mono">{bill.elec_units} หน่วย = {formatCurrency(bill.elec_bill)}</span>
                                        </div>
                                        <div className="summary-bill-card-row">
                                            <span>💧 น้ำประปา</span>
                                            <span className="mono">{bill.water_units} หน่วย = {formatCurrency(bill.water_bill)}</span>
                                        </div>
                                        <div className="summary-bill-card-row">
                                            <span>🏠 ค่าห้อง</span>
                                            <span className="mono">{formatCurrency(bill.room_rent)}</span>
                                        </div>
                                    </div>
                                    <div className="summary-bill-card-footer">
                                        <div className="summary-bill-card-total">
                                            <span>รวม</span>
                                            <span className="mono font-bold" style={{ color: 'var(--color-primary)', fontSize: '1.125rem' }}>
                                                {formatCurrency(bill.total_bill)}
                                            </span>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                className="btn btn-outline btn-sm"
                                                onClick={() => setSelectedBill(bill)}
                                            >
                                                <Eye size={14} /> ดูบิล
                                            </button>
                                            <button
                                                className="btn btn-outline btn-sm"
                                                onClick={() => handleDownloadBill(bill)}
                                                disabled={isDownloading}
                                            >
                                                <Download size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            <div className="summary-total-card">
                                <span className="font-bold">รวมทั้งสิ้น</span>
                                <span className="mono font-bold" style={{ fontSize: '1.25rem', color: 'var(--color-primary)' }}>
                                    {formatCurrency(stats.totalRevenue)}
                                </span>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Magic Button */}
            {!isLocked && (
                <div className="magic-button-container">
                    {sendComplete ? (
                        <div className="text-success font-bold" style={{ fontSize: '1.25rem' }}>
                            ✅ ส่งบิลและปิดยอดเรียบร้อยแล้ว!
                        </div>
                    ) : (
                        <>
                            <p className="text-muted mb-4">
                                {stats.isAllSaved
                                    ? 'ทุกห้องพร้อมแล้ว! กดปุ่มด้านล่างเพื่อส่งบิลและปิดยอดเดือน'
                                    : 'กรุณาจดมิเตอร์และบันทึกให้ครบทุกห้องก่อน'
                                }
                            </p>
                            <button
                                className="magic-button"
                                disabled={!stats.isAllSaved || isSending}
                                onClick={() => setShowConfirm(true)}
                            >
                                {isSending ? (
                                    <>
                                        <span className="loading-spinner"></span>
                                        กำลังส่ง...
                                    </>
                                ) : (
                                    <>
                                        <Rocket size={24} />
                                        🚀 ปิดยอดเดือน
                                    </>
                                )}
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Invoice Modal */}
            {selectedBill && (
                <div className="modal-overlay" onClick={() => setSelectedBill(null)}>
                    <div className="modal invoice-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">📄 ใบเรียกเก็บ — ห้อง {selectedBill.room_number}</h3>
                            <button
                                className="btn btn-outline btn-sm btn-icon"
                                onClick={() => setSelectedBill(null)}
                            >
                                <XCircle size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            {(() => {
                                const room = rooms.find(r => r.id === selectedBill.room_id);
                                const rates = room ? getEffectiveRates(room, config) : null;
                                return (
                                    <InvoiceBill
                                        ref={invoiceRef}
                                        bill={selectedBill}
                                        config={config}
                                        billDate={billDate}
                                        effectiveElecRate={rates?.electricityRate}
                                        effectiveWaterConfig={rates?.waterConfig}
                                    />
                                );
                            })()}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setSelectedBill(null)}>
                                ปิด
                            </button>
                            <button
                                className="btn btn-outline"
                                onClick={() => handleDownloadBill(selectedBill)}
                                disabled={isDownloading}
                            >
                                <Download size={18} />
                                {isDownloading ? 'กำลังดาวน์โหลด...' : 'ดาวน์โหลด'}
                            </button>
                            <button className="btn btn-primary" onClick={() => {
                                setShowAllInvoices(false);
                                setTimeout(() => window.print(), 100);
                            }}>
                                <Printer size={18} />
                                พิมพ์
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmation Modal */}
            {showConfirm && (
                <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">⚠️ ยืนยันการปิดยอด</h3>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginBottom: 'var(--space-4)' }}>
                                คุณกำลังจะปิดรอบเดือน <strong>{formatMonthThai(currentMonth)}</strong>
                            </p>
                            <div className="card" style={{ background: 'var(--color-gray-50)', padding: 'var(--space-4)' }}>
                                <p>📍 จำนวนห้อง: <strong>{stats.totalRooms} ห้อง</strong></p>
                                <p>💰 ยอดรวม: <strong>{formatCurrency(stats.totalRevenue)}</strong></p>
                            </div>
                            <p className="text-muted mt-4" style={{ fontSize: '0.875rem' }}>
                                หลังจากปิดยอดแล้ว จะไม่สามารถแก้ไขข้อมูลเดือนนี้ได้
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowConfirm(false)}>
                                <XCircle size={18} />
                                ยกเลิก
                            </button>
                            <button className="btn btn-success" onClick={handleCloseMonth}>
                                <Send size={18} />
                                ยืนยัน ส่งบิลเลย!
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Hidden print area for all invoices */}
            {showAllInvoices && (
                <div className="print-only-area" ref={printRef}>
                    {monthBills.map(bill => (
                        <div key={bill.id} className="invoice-print-page">
                            {(() => {
                                const room = rooms.find(r => r.id === bill.room_id);
                                const rates = room ? getEffectiveRates(room, config) : null;
                                return (
                                    <InvoiceBill
                                        bill={bill}
                                        config={config}
                                        billDate={billDate}
                                        effectiveElecRate={rates?.electricityRate}
                                        effectiveWaterConfig={rates?.waterConfig}
                                    />
                                );
                            })()}
                        </div>
                    ))}
                </div>
            )}
            {/* Hidden Report Table for PDF Capture */}
            <div style={{ position: 'absolute', top: -9999, left: -9999, width: '210mm', background: 'white', padding: '40px', color: 'black', fontFamily: 'Sarabun, sans-serif' }} ref={reportRef}>
                <h2 style={{ textAlign: 'center', marginBottom: '10px', fontSize: '24px' }}>รายงานสรุปยอดหอพัก</h2>
                <p style={{ textAlign: 'center', marginBottom: '20px', fontSize: '16px' }}>ประจำเดือน: {formatMonthThai(currentMonth)}</p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid #000' }}>
                            <th style={{ padding: '10px', textAlign: 'left' }}>ห้อง</th>
                            <th style={{ padding: '10px', textAlign: 'right' }}>ค่าไฟ</th>
                            <th style={{ padding: '10px', textAlign: 'right' }}>ค่าน้ำ</th>
                            <th style={{ padding: '10px', textAlign: 'right' }}>ค่าห้อง</th>
                            <th style={{ padding: '10px', textAlign: 'right' }}>รวม</th>
                        </tr>
                    </thead>
                    <tbody>
                        {monthBills.map(bill => (
                            <tr key={bill.id} style={{ borderBottom: '1px solid #ddd' }}>
                                <td style={{ padding: '10px' }}>{bill.room_number}</td>
                                <td style={{ padding: '10px', textAlign: 'right' }}>
                                    <div style={{ fontWeight: 'bold' }}>{formatCurrency(bill.elec_bill)}</div>
                                    <div style={{ fontSize: '12px', color: '#666' }}>{bill.elec_units} หน่วย</div>
                                </td>
                                <td style={{ padding: '10px', textAlign: 'right' }}>
                                    <div style={{ fontWeight: 'bold' }}>{formatCurrency(bill.water_bill)}</div>
                                    <div style={{ fontSize: '12px', color: '#666' }}>{bill.water_units} หน่วย</div>
                                </td>
                                <td style={{ padding: '10px', textAlign: 'right' }}>{formatCurrency(bill.room_rent)}</td>
                                <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold', fontSize: '16px' }}>{formatCurrency(bill.total_bill)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr style={{ borderTop: '2px solid #000' }}>
                            <td colSpan={4} style={{ padding: '15px', textAlign: 'right', fontWeight: 'bold', fontSize: '18px' }}>รวมทั้งสิ้น</td>
                            <td style={{ padding: '15px', textAlign: 'right', fontWeight: 'bold', fontSize: '18px' }}>{formatCurrency(stats.totalRevenue)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}
