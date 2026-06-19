import { useState, useRef } from 'react';
import {
    CheckCircle, XCircle, AlertTriangle,
    FileText, Send, Lock, Download, Eye, Printer, BarChart3,
    Home, Zap, Droplets, Banknote, ClipboardList, Calendar, MapPin,
    MessageCircle
} from 'lucide-react';
import app from '../../firebase/config';
import type { MonthlyBill, DormConfig, Room } from '../../types';
import { formatCurrency, formatMonthThai, getEffectiveRates } from '../../utils/calculations';
import InvoiceBill from './InvoiceBill';
import MonthlyReport from './MonthlyReport';
import jsPDF from 'jspdf';
import { toPng } from 'html-to-image';

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
    onUnlockMonth: (month: string) => void;
    uid?: string;
    buildingId?: string;

    canSendLine?: boolean;
    onUpgrade?: () => void;
}

export default function Summary({
    bills,
    rooms,
    config,
    currentMonth,
    stats,
    onCloseMonth,
    onUnlockMonth,
    uid,
    buildingId,

    canSendLine = true,
    onUpgrade,
}: SummaryProps) {
    const [showConfirm, setShowConfirm] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [sendComplete, setSendComplete] = useState(false);
    const [lineStatus, setLineStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
    const [lineResult, setLineResult] = useState<{ sent: number; skipped: number } | null>(null);
    const [showLineUpgradeModal, setShowLineUpgradeModal] = useState(false);
    const [billDate, setBillDate] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    const [selectedBill, setSelectedBill] = useState<MonthlyBill | null>(null);
    const [showAllInvoices, setShowAllInvoices] = useState(false);
    const [downloadingBillId, setDownloadingBillId] = useState<string | null>(null);
    const [isDownloadingAll, setIsDownloadingAll] = useState(false);
    const [downloadAllProgress, setDownloadAllProgress] = useState(0);
    const [captureTarget, setCaptureTarget] = useState<MonthlyBill | null>(null);
    const [showMonthlyReport, setShowMonthlyReport] = useState(false);
    const [isExportingReport, setIsExportingReport] = useState(false);
    const printRef = useRef<HTMLDivElement>(null);
    const captureRef = useRef<HTMLDivElement>(null);
    const monthlyReportRef = useRef<HTMLDivElement>(null);
    const hiddenReportRef = useRef<HTMLDivElement>(null);

    const billCustomization = config.bill_customization;

    const monthBills = bills.filter(b => b.month === currentMonth);
    const isLocked = monthBills.some(b => b.is_locked);

    const handleSendLineBills = async () => {
        if (!uid || !buildingId) return;
        setLineStatus('sending');
        setLineResult(null);
        try {
            const { getAuth } = await import('firebase/auth');
            const auth = getAuth(app);
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error('Not authenticated');

            const res = await fetch('/api/send-line-bills', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    building_id: buildingId,
                    month: currentMonth
                })
            });

            if (!res.ok) throw new Error('Failed to send bills');
            const { data } = await res.json();
            setLineResult(data);
            setLineStatus('done');
        } catch (error) {
            console.error('Send LINE bills error:', error);
            setLineStatus('error');
        }
    };

    const handleCloseMonth = async () => {
        setIsSending(true);
        await onCloseMonth(currentMonth);
        setIsSending(false);
        setShowConfirm(false);
    };

    const handleSendBills = async () => {
        setIsSending(true);
        
        // Use handlePrintAll to "send" (print/save as PDF) the individual bills to tenants
        handlePrintAll();

        setIsSending(false);
        setSendComplete(true);
    };



    const generatePDFFromElement = async (element: HTMLElement, filename: string) => {
        const dataUrl = await toPng(element, {
            pixelRatio: 2,
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


    const generateMonthlyReportPDF = async () => {
        // Use the off-screen unconstrained copy — not the one inside the scrollable modal
        if (!hiddenReportRef.current) return;
        setIsExportingReport(true);
        try {
            await generatePDFFromElement(
                hiddenReportRef.current,
                `HorCare_MonthlyReport_${currentMonth}.pdf`
            );
        } catch (error) {
            console.error('Monthly Report PDF failed:', error);
            alert('เกิดข้อผิดพลาดในการสร้าง PDF');
        } finally {
            setIsExportingReport(false);
        }
    };

    const handlePrintAll = () => {
        setShowAllInvoices(true);
        setTimeout(() => {
            window.print();
        }, 300);
    };

    const captureAndDownload = async (bill: MonthlyBill): Promise<void> => {
        setCaptureTarget(bill);

        // Poll via rAF until React commits the hidden InvoiceBill, with a 3-second timeout
        await new Promise<void>((resolve, reject) => {
            const deadline = Date.now() + 3000;
            const check = () => {
                if (captureRef.current) {
                    resolve();
                } else if (Date.now() > deadline) {
                    reject(new Error('Capture element not mounted'));
                } else {
                    requestAnimationFrame(check);
                }
            };
            requestAnimationFrame(check);
        });

        const el = captureRef.current;
        if (!el) throw new Error('Capture element not mounted');

        const dataUrl = await toPng(el, {
            pixelRatio: 2,
            backgroundColor: '#ffffff',
        });

        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `bill_${bill.room_number}_${currentMonth}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const handleDownloadBill = async (bill: MonthlyBill) => {
        setDownloadingBillId(bill.id);
        try {
            await captureAndDownload(bill);
        } catch (err) {
            console.error('Download failed:', err);
            alert('ดาวน์โหลดไม่สำเร็จ กรุณาลองใช้ปุ่มพิมพ์แทน');
        } finally {
            setDownloadingBillId(null);
            setCaptureTarget(null);
        }
    };

    const handleDownloadAllBills = async () => {
        if (monthBills.length === 0) return;
        setIsDownloadingAll(true);
        setDownloadAllProgress(0);
        const failed: string[] = [];
        try {
            for (let i = 0; i < monthBills.length; i++) {
                try {
                    await captureAndDownload(monthBills[i]);
                } catch (err) {
                    console.error(`Download failed for room ${monthBills[i].room_number}:`, err);
                    failed.push(monthBills[i].room_number);
                }
                setCaptureTarget(null);
                setDownloadAllProgress(i + 1);
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        } finally {
            setIsDownloadingAll(false);
            setCaptureTarget(null);
            setDownloadAllProgress(0);
            if (failed.length > 0) {
                alert(`ดาวน์โหลดไม่สำเร็จ ${failed.length} ห้อง: ${failed.join(', ')}`);
            }
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><BarChart3 size={28} /> สรุปยอดรายเดือน</h1>
                <p className="page-subtitle">
                    รอบเดือน {formatMonthThai(currentMonth)}
                </p>
            </div>

            {/* Bill Date Selector */}
            <div className="card mb-6">
                <div className="card-header">
                    <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Calendar size={16} /> วันที่ในบิล</span>
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
                    {lineStatus === 'done' && lineResult && (
                        <div className="line-send-result success">
                            <CheckCircle size={15} />
                            ส่งสำเร็จ {lineResult.sent} ห้อง
                            {lineResult.skipped > 0 && ` · ข้าม ${lineResult.skipped} ห้อง (ยังไม่ลงทะเบียน LINE)`}
                        </div>
                    )}
                    {lineStatus === 'error' && (
                        <div className="line-send-result error">
                            <XCircle size={15} /> เกิดข้อผิดพลาด กรุณาลองใหม่
                        </div>
                    )}
                    {monthBills.length > 0 && (
                        <>
                            <button className="btn btn-outline" onClick={handlePrintAll}>
                                <Printer size={18} />
                                พิมพ์ใบแจ้งยอดทั้งหมด
                            </button>
                            <button
                                className="btn btn-outline"
                                onClick={handleDownloadAllBills}
                                disabled={isDownloadingAll || !!downloadingBillId}
                                title="ดาวน์โหลดบิลทุกห้องแบบแยกรูป"
                            >
                                <Download size={18} />
                                {isDownloadingAll
                                    ? `ดาวน์โหลด ${downloadAllProgress}/${monthBills.length}...`
                                    : 'ดาวน์โหลดทุกห้อง'}
                            </button>
                            {uid && buildingId && config.dorm_code && (
                                <button
                                    className={`btn ${canSendLine ? 'btn-line' : 'btn-outline'}`}
                                    onClick={canSendLine ? handleSendLineBills : () => setShowLineUpgradeModal(true)}
                                    disabled={canSendLine && lineStatus === 'sending'}
                                    title={canSendLine ? undefined : 'ฟีเจอร์นี้สำหรับผู้ใช้แพ็กเกจที่ชำระเงินแล้ว'}
                                    style={canSendLine ? undefined : { opacity: 0.75 }}
                                >
                                    {canSendLine ? <MessageCircle size={18} /> : <Lock size={18} />}
                                    {canSendLine
                                        ? (lineStatus === 'sending' ? 'กำลังส่ง...' : 'ส่งบิลผ่าน LINE')
                                        : 'ส่งบิลผ่าน LINE'}
                                </button>
                            )}
                            <button className="btn btn-primary" onClick={() => setShowMonthlyReport(true)}>
                                <BarChart3 size={18} />
                                สรุปรายเดือน
                            </button>
                        </>
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
                    <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ClipboardList size={18} /> รายการบิลทั้งหมด</span>
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
                                    {rooms.filter(r => r.is_active).map(room => {
                                        const bill = monthBills.find(b => b.room_id === room.id);
                                        const hasBill = !!bill;
                                        return (
                                        <tr key={room.id}>
                                            <td className="mono font-bold">{room.room_number}</td>
                                            <td className="text-center">
                                                {hasBill ? (
                                                    <>
                                                        <div className="mono">{bill.elec_units} หน่วย</div>
                                                        <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                            {formatCurrency(bill.elec_bill)}
                                                        </div>
                                                    </>
                                                ) : <div className="text-muted">-</div>}
                                            </td>
                                            <td className="text-center">
                                                {hasBill ? (
                                                    <>
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
                                                    </>
                                                ) : <div className="text-muted">-</div>}
                                            </td>
                                            <td className="text-right mono">
                                                {formatCurrency(hasBill ? bill.room_rent : (room.rent_type === 'semester' ? 0 : (room.rent_amount ?? config.room_rent)))}
                                            </td>
                                            <td className="text-right mono font-bold">
                                                {hasBill ? formatCurrency(bill.total_bill) : <span className="text-muted">-</span>}
                                            </td>
                                            <td className="text-center">
                                                {hasBill ? (
                                                    <div className="flex flex-col gap-1 items-center">
                                                        {bill.is_locked ? (
                                                            <span className="badge badge-success">
                                                                <Lock size={12} />
                                                                ปิดยอดแล้ว
                                                            </span>
                                                        ) : (
                                                            <span className="badge badge-success">
                                                                <CheckCircle size={12} />
                                                                พร้อมส่ง
                                                            </span>
                                                        )}
                                                        {bill.is_notified && (
                                                            <span className="badge" style={{ background: '#E8F5E9', color: '#059669', borderColor: '#bbf7d0' }}>
                                                                <MessageCircle size={12} />
                                                                ส่ง LINE แล้ว
                                                            </span>
                                                        )}
                                                    </div>
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
                                                        onClick={() => bill && setSelectedBill(bill)}
                                                        title="ดูใบแจ้งยอด"
                                                        disabled={!hasBill}
                                                    >
                                                        <Eye size={14} />
                                                        ดูบิล
                                                    </button>
                                                    <button
                                                        className="btn btn-outline btn-sm"
                                                        onClick={() => bill && handleDownloadBill(bill)}
                                                        title="ดาวน์โหลดรูปบิล"
                                                        disabled={!!downloadingBillId || isDownloadingAll || !hasBill}
                                                    >
                                                        {downloadingBillId === bill?.id
                                                            ? <span className="loading-spinner" style={{ width: 14, height: 14 }} />
                                                            : <Download size={14} />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                    })}
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
                            {rooms.filter(r => r.is_active).map(room => {
                                const bill = monthBills.find(b => b.room_id === room.id);
                                const hasBill = !!bill;
                                return (
                                <div key={room.id} className="summary-bill-card">
                                    <div className="summary-bill-card-header">
                                        <span className="mono font-bold" style={{ fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Home size={18} /> {room.room_number}</span>
                                        <div className="flex flex-wrap justify-end gap-1">
                                            {hasBill ? (
                                                <>
                                                    {bill.is_locked ? (
                                                        <span className="badge badge-success"><Lock size={12} /> ปิดยอด</span>
                                                    ) : (
                                                        <span className="badge badge-success"><CheckCircle size={12} /> พร้อมส่ง</span>
                                                    )}
                                                    {bill.is_notified && (
                                                        <span className="badge" style={{ background: '#E8F5E9', color: '#059669', borderColor: '#bbf7d0' }}>
                                                            <MessageCircle size={12} /> ส่งแล้ว
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                <span className="badge badge-warning"><AlertTriangle size={12} /> รอบันทึก</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="summary-bill-card-body">
                                        <div className="summary-bill-card-row">
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Zap size={14} color="#D97706" /> ไฟฟ้า</span>
                                            <span className="mono">{hasBill ? `${bill.elec_units} หน่วย = ${formatCurrency(bill.elec_bill)}` : '-'}</span>
                                        </div>
                                        <div className="summary-bill-card-row">
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Droplets size={14} color="#2563EB" /> น้ำประปา</span>
                                            <span className="mono">{hasBill ? `${bill.water_units} หน่วย = ${formatCurrency(bill.water_bill)}` : '-'}</span>
                                        </div>
                                        <div className="summary-bill-card-row">
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Home size={14} color="#16A34A" /> ค่าห้อง</span>
                                            <span className="mono">{formatCurrency(hasBill ? bill.room_rent : (room.rent_type === 'semester' ? 0 : (room.rent_amount ?? config.room_rent)))}</span>
                                        </div>
                                    </div>
                                    <div className="summary-bill-card-footer">
                                        <div className="summary-bill-card-total">
                                            <span>รวม</span>
                                            <span className="mono font-bold" style={{ color: 'var(--color-primary)', fontSize: '1.125rem' }}>
                                                {hasBill ? formatCurrency(bill.total_bill) : '-'}
                                            </span>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                className="btn btn-outline btn-sm flex-1"
                                                onClick={() => bill && setSelectedBill(bill)}
                                                disabled={!hasBill}
                                            >
                                                <Eye size={14} />
                                                ดู
                                            </button>
                                            <button
                                                className="btn btn-outline btn-sm flex-1"
                                                onClick={() => bill && handleDownloadBill(bill)}
                                                disabled={!!downloadingBillId || isDownloadingAll || !hasBill}

                                            >
                                                {downloadingBillId === bill?.id
                                                    ? <span className="loading-spinner" style={{ width: 14, height: 14 }} />
                                                    : <Download size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                            })}
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

            {/* Action Buttons */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {/* 1. Send Bills System */}
                <div className="card text-center" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div className="card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--primary-color)' }}>
                            <Send size={20} />
                            <h3 style={{ margin: 0 }}>ระบบส่งบิล</h3>
                        </div>
                        
                        <p className="text-muted mb-4" style={{ fontSize: '0.875rem' }}>
                            พิมพ์หรือบันทึกใบแจ้งหนี้ของทุกห้อง เพื่อส่งให้ผู้เช่า
                        </p>

                        {!stats.isAllSaved && !isLocked && (
                            <p className="text-warning mb-4" style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>
                                *กรุณาจดมิเตอร์ให้ครบทุกห้องก่อน ({stats.savedCount}/{stats.totalRooms} ห้อง)
                            </p>
                        )}
                        
                        {sendComplete ? (
                            <div className="text-success font-bold mb-4 flex justify-center items-center gap-2">
                                <CheckCircle size={18} /> พิมพ์บิลเรียบร้อยแล้ว!
                            </div>
                        ) : null}

                        <button
                            className={`btn ${stats.isAllSaved ? 'btn-primary' : 'btn-outline'}`}
                            onClick={handleSendBills}
                            disabled={isSending || !stats.isAllSaved}
                            style={{ width: '100%' }}
                        >
                            {isSending ? (
                                <>
                                    <span className="loading-spinner"></span>
                                    กำลังดำเนินการ...
                                </>
                            ) : (
                                <>
                                    <FileText size={18} />
                                    พิมพ์ใบแจ้งหนี้ทั้งหมด
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* 2. Close Month System */}
                <div className={`card text-center ${isLocked ? 'saved' : ''}`} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <h3 className="card-title mb-2 flex justify-center items-center gap-2">
                        <Lock size={20} color={isLocked ? "var(--color-success)" : "var(--color-warning)"} />
                        ระบบปิดยอดเดือน
                    </h3>
                    <p className="text-muted mb-2" style={{ fontSize: '0.875rem' }}>
                        ล็อคข้อมูลบิลทั้งหมดของเดือนนี้ เพื่อป้องกันการแก้ไข
                    </p>
                    
                    {!isLocked ? (
                        <>
                            {!stats.isAllSaved && (
                                <p className="text-warning mb-4" style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>
                                    *กรุณาจดมิเตอร์ให้ครบทุกห้องก่อนปิดยอด
                                </p>
                            )}
                            <button
                                className="btn btn-warning w-full mt-auto"
                                disabled={!stats.isAllSaved || isSending}
                                onClick={() => setShowConfirm(true)}
                                style={{ color: 'white' }}
                            >
                                <Lock size={18} />
                                ปิดยอดเดือนนี้
                            </button>
                        </>
                    ) : (
                        <div>
                            <div className="text-success font-bold mb-3 flex justify-center items-center gap-2">
                                <CheckCircle size={18} /> ปิดยอดเรียบร้อยแล้ว
                            </div>
                            <button
                                className="btn btn-outline btn-danger w-full"
                                onClick={async () => {
                                    if (confirm('คุณต้องการยกเลิกการปิดยอดใช่หรือไม่? (สถานะของบิลทั้งหมดจะกลับไปเป็น "รอบันทึก" และคุณจะสามารถแก้ไขได้)')) {
                                        await onUnlockMonth(currentMonth);
                                        setSendComplete(false);
                                    }
                                }}
                            >
                                <XCircle size={18} />
                                ยกเลิกการปิดยอด
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Invoice Modal */}
            {selectedBill && (
                <div className="modal-overlay" onClick={() => setSelectedBill(null)}>
                    <div className="modal invoice-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={18} /> ใบเรียกเก็บ — ห้อง {selectedBill.room_number}</h3>
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
                                        bill={selectedBill}
                                        config={config}
                                        billDate={billDate}
                                        effectiveElecRate={rates?.electricityRate}
                                        effectiveWaterConfig={rates?.waterConfig}
                                        billCustomization={billCustomization}
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
                                disabled={!!downloadingBillId || isDownloadingAll}

                            >
                                <Download size={18} />
                                {downloadingBillId === selectedBill.id ? 'กำลังดาวน์โหลด...' : 'ดาวน์โหลด'}
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
                            <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><AlertTriangle size={20} color="var(--color-warning)" /> ยืนยันการปิดยอด</h3>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginBottom: 'var(--space-4)' }}>
                                คุณกำลังจะปิดรอบเดือน <strong>{formatMonthThai(currentMonth)}</strong>
                            </p>
                            <div className="card" style={{ background: 'var(--color-gray-50)', padding: 'var(--space-4)' }}>
                                <p style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><MapPin size={16} /> จำนวนห้อง: <strong>{stats.totalRooms} ห้อง</strong></p>
                                <p style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Banknote size={16} /> ยอดรวม: <strong>{formatCurrency(stats.totalRevenue)}</strong></p>
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
                                        billCustomization={billCustomization}
                                    />
                                );
                            })()}
                        </div>
                    ))}
                </div>
            )}


            {/* Hidden capture area for bill image downloads */}
            <div style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '680px', pointerEvents: 'none', zIndex: -1 }}>
                {captureTarget && (() => {
                    const room = rooms.find(r => r.id === captureTarget.room_id);
                    const rates = room ? getEffectiveRates(room, config) : null;
                    return (
                        <InvoiceBill
                            ref={captureRef}
                            bill={captureTarget}
                            config={config}
                            billDate={billDate}
                            effectiveElecRate={rates?.electricityRate}
                            effectiveWaterConfig={rates?.waterConfig}
                            billCustomization={billCustomization}
                        />
                    );
                })()}
            </div>

            {/* Off-screen MonthlyReport for unconstrained PDF capture (no scroll/clip) */}
            {showMonthlyReport && (
                <div style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '900px', padding: '2rem', background: '#fff', pointerEvents: 'none', zIndex: -1 }}>
                    <MonthlyReport
                        ref={hiddenReportRef}
                        bills={bills}
                        currentMonth={currentMonth}
                        config={config}
                        billCustomization={billCustomization}
                    />
                </div>
            )}

            {/* Monthly Report Modal */}
            {showMonthlyReport && (
                <div className="modal-overlay" onClick={() => setShowMonthlyReport(false)}>
                    <div className="modal invoice-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '900px' }}>
                        <div className="modal-header">
                            <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><BarChart3 size={18} /> สรุปรายรับประจำเดือน</h3>
                            <button
                                className="btn btn-outline btn-sm btn-icon"
                                onClick={() => setShowMonthlyReport(false)}
                            >
                                <XCircle size={20} />
                            </button>
                        </div>
                        <div className="modal-body" style={{ maxHeight: '70vh', overflow: 'auto' }}>
                            <MonthlyReport
                                ref={monthlyReportRef}
                                bills={bills}
                                currentMonth={currentMonth}
                                config={config}
                                billCustomization={billCustomization}
                            />
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowMonthlyReport(false)}>
                                ปิด
                            </button>
                            <button
                                className="btn btn-outline"
                                onClick={generateMonthlyReportPDF}
                                disabled={isExportingReport}
                            >
                                <Download size={18} />
                                {isExportingReport ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลด PDF'}
                            </button>
                            <button className="btn btn-primary" onClick={() => window.print()}>
                                <Printer size={18} />
                                พิมพ์
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* LINE Upgrade Modal — shown when free plan user clicks "ส่งบิลผ่าน LINE" */}
            {showLineUpgradeModal && (
                <div
                    className="modal-overlay"
                    onClick={() => setShowLineUpgradeModal(false)}
                    style={{ zIndex: 600 }}
                >
                    <div
                        className="modal"
                        onClick={e => e.stopPropagation()}
                        style={{
                            maxWidth: '420px',
                            width: '92vw',
                            borderRadius: '20px',
                            overflow: 'hidden',
                            padding: 0,
                            border: 'none',
                        }}
                    >
                        {/* Modal Header — LINE green gradient */}
                        <div style={{
                            background: 'linear-gradient(135deg, #00B900 0%, #00C300 50%, #06D6A0 100%)',
                            padding: '2rem 1.75rem 1.5rem',
                            textAlign: 'center',
                            position: 'relative',
                        }}>
                            <button
                                onClick={() => setShowLineUpgradeModal(false)}
                                style={{
                                    position: 'absolute', top: '1rem', right: '1rem',
                                    background: 'rgba(255,255,255,0.2)', border: 'none',
                                    borderRadius: '50%', width: 32, height: 32,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'pointer', color: '#fff',
                                }}
                            >
                                <XCircle size={18} />
                            </button>
                            <div style={{
                                width: 72, height: 72, borderRadius: '50%',
                                background: 'rgba(255,255,255,0.2)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto 1rem',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                            }}>
                                <MessageCircle size={36} color="#fff" />
                            </div>
                            <h3 style={{ color: '#fff', fontWeight: 800, fontSize: '1.25rem', margin: '0 0 0.375rem' }}>
                                ส่งบิลผ่าน LINE
                            </h3>
                            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.875rem', margin: 0 }}>
                                ฟีเจอร์สำหรับแพ็กเกจที่ชำระเงินแล้วเท่านั้น
                            </p>
                        </div>

                        {/* Modal Body */}
                        <div style={{ padding: '1.5rem 1.75rem', background: 'var(--color-surface, #fff)' }}>
                            <p style={{ color: 'var(--color-text-muted, #6B7280)', fontSize: '0.9rem', lineHeight: 1.65, marginBottom: '1.25rem' }}>
                                การส่งบิลอัตโนมัติผ่าน LINE ช่วยให้คุณแจ้งยอดให้ผู้เช่าได้ง่าย ๆ เพียงปลายนิ้ว ไม่ต้องส่งทีละห้อง
                            </p>

                            {/* Feature list */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginBottom: '1.5rem' }}>
                                {[
                                    'ส่งบิลหาผู้เช่าทุกห้องพร้อมกันในคลิกเดียว',
                                    'แสดงรายละเอียดค่าน้ำ-ไฟ-ค่าห้องในข้อความ LINE',
                                    'ติดตามสถานะ "ส่งแล้ว" ในระบบได้ทันที',
                                ].map((feat, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
                                        <div style={{
                                            width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                                            background: 'linear-gradient(135deg, #00B900, #06D6A0)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            marginTop: '0.1rem',
                                        }}>
                                            <CheckCircle size={12} color="#fff" />
                                        </div>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--color-text, #111827)', lineHeight: 1.5 }}>{feat}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Pricing hint */}
                            <div style={{
                                background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(236,72,153,0.06))',
                                border: '1px solid rgba(139,92,246,0.2)',
                                borderRadius: '12px', padding: '0.875rem 1rem',
                                marginBottom: '1.25rem',
                                display: 'flex', alignItems: 'center', gap: '0.625rem',
                            }}>
                                <Zap size={18} color="#8B5CF6" style={{ flexShrink: 0 }} />
                                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text, #111827)', lineHeight: 1.5 }}>
                                    เริ่มต้นเพียง <strong style={{ color: '#8B5CF6' }}>฿79/เดือน</strong> สำหรับแพ็กเกจหอเล็ก
                                </span>
                            </div>

                            {/* Action buttons */}
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                <button
                                    className="btn btn-outline"
                                    onClick={() => setShowLineUpgradeModal(false)}
                                    style={{ flex: 1 }}
                                >
                                    ปิด
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => {
                                        setShowLineUpgradeModal(false);
                                        onUpgrade?.();
                                    }}
                                    style={{
                                        flex: 2,
                                        background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
                                        border: 'none',
                                        fontWeight: 700,
                                        boxShadow: '0 4px 16px rgba(139,92,246,0.35)',
                                    }}
                                >
                                    <Zap size={16} />
                                    ดูแพ็กเกจ
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
