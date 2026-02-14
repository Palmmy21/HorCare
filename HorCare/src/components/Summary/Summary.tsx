import { useState, useRef } from 'react';
import {
    Rocket, CheckCircle, XCircle, AlertTriangle,
    FileText, Send, Lock, Download, Eye, Printer
} from 'lucide-react';
import type { MonthlyBill, DormConfig } from '../../types';
import { formatCurrency, formatMonthThai } from '../../utils/calculations';
import InvoiceBill from './InvoiceBill';
import jsPDF from 'jspdf';

interface SummaryProps {
    bills: MonthlyBill[];
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
    const printRef = useRef<HTMLDivElement>(null);

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

    const generatePDF = () => {
        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.text(`HorCare - Bill Summary`, 20, 20);
        doc.setFontSize(12);
        doc.text(`Month: ${currentMonth}`, 20, 30);

        let y = 50;
        doc.setFontSize(10);

        // Header
        doc.text('Room', 20, y);
        doc.text('Elec', 50, y);
        doc.text('Water', 80, y);
        doc.text('Rent', 110, y);
        doc.text('Total', 140, y);
        y += 10;

        monthBills.forEach(bill => {
            doc.text(bill.room_number, 20, y);
            doc.text(bill.elec_bill.toString(), 50, y);
            doc.text(bill.water_bill.toString(), 80, y);
            doc.text(bill.room_rent.toString(), 110, y);
            doc.text(bill.total_bill.toString(), 140, y);
            y += 8;
        });

        y += 10;
        doc.setFontSize(12);
        doc.text(`Total Revenue: ${stats.totalRevenue} THB`, 20, y);

        doc.save(`bills_${currentMonth}.pdf`);
    };

    const handlePrintAll = () => {
        setShowAllInvoices(true);
        setTimeout(() => {
            window.print();
        }, 300);
    };

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
                    <button className="btn btn-outline btn-sm" onClick={generatePDF}>
                        <Download size={16} />
                        Export PDF
                    </button>
                </div>

                {monthBills.length === 0 ? (
                    <div className="empty-state">
                        <FileText size={48} />
                        <h3>ยังไม่มีข้อมูลบิล</h3>
                        <p>กรุณาจดมิเตอร์และบันทึกข้อมูลก่อน</p>
                    </div>
                ) : (
                    <div className="table-container">
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
                                            <button
                                                className="btn btn-outline btn-sm"
                                                onClick={() => setSelectedBill(bill)}
                                                title="ดูใบแจ้งยอด"
                                            >
                                                <Eye size={14} />
                                                ดูบิล
                                            </button>
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
                            <h3 className="modal-title">📄 ใบแจ้งยอด — ห้อง {selectedBill.room_number}</h3>
                            <button
                                className="btn btn-outline btn-sm btn-icon"
                                onClick={() => setSelectedBill(null)}
                            >
                                <XCircle size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <InvoiceBill
                                bill={selectedBill}
                                config={config}
                                billDate={billDate}
                            />
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setSelectedBill(null)}>
                                ปิด
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
                            <InvoiceBill
                                bill={bill}
                                config={config}
                                billDate={billDate}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
