import { useState, useRef } from 'react';
import {
    CheckCircle, XCircle, AlertTriangle,
    FileText, Send, Lock, Download, Eye, Printer, BarChart3,
    Home, Zap, Droplets, Banknote, ClipboardList, Calendar, MapPin,
    MessageCircle, Building2
} from 'lucide-react';
import app from '../../firebase/config';
import type { MonthlyBill, DormConfig, Room, BillLanguage } from '../../types';
import { formatCurrency, formatMonthThai, getEffectiveRates } from '../../utils/calculations';
import { LANGUAGE_OPTIONS } from '../../utils/i18n/billTranslations';
import InvoiceBill from './InvoiceBill';
import PrintBillSlip from './PrintBillSlip';
import MonthlyReport from './MonthlyReport';
import jsPDF from 'jspdf';
import { toPng } from 'html-to-image';
import html2canvas from 'html2canvas';
import { triggerFileDownload, dataUrlToBlob } from '../../utils/fileDownload';

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
    const [lineStatus, setLineStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
    const [lineResult, setLineResult] = useState<{ sent: number; skipped: number; message?: string; results?: string[] } | null>(null);
    const [remindStatus, setRemindStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
    const [remindResult, setRemindResult] = useState<{ sent: number; skipped: number; message?: string; results?: string[] } | null>(null);
    const [showLineUpgradeModal, setShowLineUpgradeModal] = useState(false);
    const [billDate, setBillDate] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    const [selectedBill, setSelectedBill] = useState<MonthlyBill | null>(null);
    const [previewLang, setPreviewLang] = useState<BillLanguage | null>(null);
    const [showAllInvoices, setShowAllInvoices] = useState(false);
    const [downloadingBillId, setDownloadingBillId] = useState<string | null>(null);
    const [isDownloadingAll, setIsDownloadingAll] = useState(false);
    const [downloadAllProgress, setDownloadAllProgress] = useState(0);
    const [captureTarget, setCaptureTarget] = useState<MonthlyBill | null>(null);
    const [showMonthlyReport, setShowMonthlyReport] = useState(false);
    const [isExportingReport, setIsExportingReport] = useState(false);
    const [preparedFiles, setPreparedFiles] = useState<File[]>([]);
    const [showShareModal, setShowShareModal] = useState(false);
    const printRef = useRef<HTMLDivElement>(null);
    const captureRef = useRef<HTMLDivElement>(null);
    const monthlyReportRef = useRef<HTMLDivElement>(null);
    const hiddenReportRef = useRef<HTMLDivElement>(null);

    const billCustomization = config.bill_customization;

    const monthBills = bills.filter(b => b.month === currentMonth);
    const isLocked = monthBills.some(b => b.is_locked);

    // Count rooms in this month's bills that have no LINE user linked
    const unlinkedLineCount = monthBills.filter(bill => {
        const room = rooms.find(r => r.id === bill.room_id);
        return !room?.line_user_id;
    }).length;

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

            const json = await res.json();
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            setLineResult(json.data);
            setLineStatus('done');
        } catch (error) {
            console.error('Send LINE bills error:', error);
            setLineStatus('error');
            alert(`ส่งบิลไม่สำเร็จ: ${(error as Error).message}`);
        }
    };

    const handleRemindManualBills = async () => {
        if (!uid || !buildingId) return;
        setRemindStatus('sending');
        setRemindResult(null);
        try {
            const { getAuth } = await import('firebase/auth');
            const auth = getAuth(app);
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error('Not authenticated');

            const res = await fetch('/api/remind-manual', {
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

            const json = await res.json();
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            setRemindResult(json.data);
            setRemindStatus('done');
        } catch (error) {
            console.error('Manual remind LINE bills error:', error);
            setRemindStatus('error');
            alert(`ทวงบิลไม่สำเร็จ: ${(error as Error).message}`);
        }
    };

    const handleCloseMonth = async () => {
        setIsSending(true);
        await onCloseMonth(currentMonth);
        setIsSending(false);
        setShowConfirm(false);
    };



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

    const captureAndDownload = async (bill: MonthlyBill, useShare: boolean = false): Promise<void> => {
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

        // Small delay to ensure SVG QR code and DOM styles are completely painted
        await new Promise(resolve => setTimeout(resolve, 150));

        const el = captureRef.current;
        if (!el) throw new Error('Capture element not mounted');

        let dataUrl: string;
        try {
            dataUrl = await toPng(el, {
                pixelRatio: 2,
                backgroundColor: '#ffffff',
                cacheBust: true,
                skipFonts: true,
            });
        } catch (toPngErr) {
            console.warn('toPng failed on mobile, attempting html2canvas fallback:', toPngErr);
            const canvas = await html2canvas(el, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true,
                logging: false,
            });
            dataUrl = canvas.toDataURL('image/png');
        }

        const fileName = `bill_${bill.room_number}_${currentMonth}.png`;
        const blob = dataUrlToBlob(dataUrl);

        const nav = navigator as any;
        if (useShare && nav.share && nav.canShare) {
            try {
                const file = new File([blob], fileName, { type: 'image/png' });
                if (nav.canShare({ files: [file] })) {
                    await nav.share({
                        files: [file],
                        title: `บิลห้อง ${bill.room_number}`,
                    });
                    return;
                }
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    console.error('Share failed, falling back to download:', err);
                }
            }
        }

        // Direct download using Blob & ObjectURL (reliable on Samsung Internet and Chrome Android)
        triggerFileDownload(blob, fileName);
    };

    const handleDownloadBill = async (bill: MonthlyBill) => {
        setDownloadingBillId(bill.id);
        try {
            // Direct download on device
            await captureAndDownload(bill, false);
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
        
        const nav = navigator as any;
        const canShareFiles = nav.share && nav.canShare && nav.canShare({
            files: [new File([''], 'test.png', { type: 'image/png' })]
        });

        const files: File[] = [];
        const failed: string[] = [];
        
        try {
            for (let i = 0; i < monthBills.length; i++) {
                try {
                    const bill = monthBills[i];
                    setCaptureTarget(bill);
                    await new Promise<void>((resolve, reject) => {
                        const deadline = Date.now() + 3000;
                        const check = () => {
                            if (captureRef.current) resolve();
                            else if (Date.now() > deadline) reject(new Error('Capture element not mounted'));
                            else requestAnimationFrame(check);
                        };
                        requestAnimationFrame(check);
                    });

                    await new Promise(r => setTimeout(r, 150));

                    const el = captureRef.current;
                    if (!el) throw new Error('Capture element not mounted');

                    let dataUrl: string;
                    try {
                        dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true, skipFonts: true });
                    } catch {
                        const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
                        dataUrl = canvas.toDataURL('image/png');
                    }
                    
                    const fileName = `bill_${bill.room_number}_${currentMonth}.png`;
                    const blob = dataUrlToBlob(dataUrl);

                    if (canShareFiles) {
                        files.push(new File([blob], fileName, { type: 'image/png' }));
                    } else {
                        triggerFileDownload(blob, fileName);
                    }
                } catch (err) {
                    console.error(`Download failed for room ${monthBills[i].room_number}:`, err);
                    failed.push(monthBills[i].room_number);
                }
                setCaptureTarget(null);
                setDownloadAllProgress(i + 1);
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            if (canShareFiles && files.length > 0) {
                setPreparedFiles(files);
                setShowShareModal(true);
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

    const handleShareAll = async () => {
        const nav = navigator as any;
        if (nav.share && nav.canShare && nav.canShare({ files: preparedFiles })) {
            try {
                await nav.share({
                    files: preparedFiles,
                    title: `บิลทั้งหมดรอบเดือน ${formatMonthThai(currentMonth)}`
                });
                setShowShareModal(false);
                setPreparedFiles([]);
                return;
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    console.warn('Share all failed, falling back to direct download:', err);
                }
            }
        }

        // Fallback: trigger downloads directly
        for (const file of preparedFiles) {
            triggerFileDownload(file, file.name);
            await new Promise(r => setTimeout(r, 250));
        }
        setShowShareModal(false);
        setPreparedFiles([]);
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
                {/* Row 1: Date input */}
                <div style={{ marginBottom: '1rem' }}>
                    <input
                        type="date"
                        className="form-input mono"
                        style={{ maxWidth: '180px' }}
                        value={billDate}
                        onChange={e => setBillDate(e.target.value)}
                    />
                    <p className="form-hint" style={{ marginTop: '0.25rem' }}>วันที่ที่จะแสดงในใบแจ้งยอด</p>
                </div>

                {/* Row 2: Action buttons */}
                {monthBills.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button className="btn btn-outline btn-sm" onClick={handlePrintAll}>
                            <Printer size={15} /> พิมพ์ใบแจ้งยอด
                        </button>
                        <button
                            className="btn btn-outline btn-sm"
                            onClick={handleDownloadAllBills}
                            disabled={isDownloadingAll || !!downloadingBillId}
                        >
                            <Download size={15} />
                            {isDownloadingAll
                                ? `ดาวน์โหลด ${downloadAllProgress}/${monthBills.length}...`
                                : 'ดาวน์โหลดทุกห้อง'}
                        </button>
                        {uid && buildingId && config.dorm_code && (
                            <>
                                <button
                                    className={`btn btn-sm ${canSendLine ? 'btn-line' : 'btn-outline'}`}
                                    onClick={canSendLine ? handleSendLineBills : () => setShowLineUpgradeModal(true)}
                                    disabled={canSendLine && (lineStatus === 'sending' || remindStatus === 'sending')}
                                    style={canSendLine ? undefined : { opacity: 0.75 }}
                                >
                                    {canSendLine ? <MessageCircle size={15} /> : <Lock size={15} />}
                                    {lineStatus === 'sending' ? 'กำลังส่ง...' : 'ส่งบิลผ่าน LINE'}
                                </button>
                                <button
                                    className={`btn btn-sm ${canSendLine ? 'btn-line' : 'btn-outline'}`}
                                    onClick={canSendLine ? handleRemindManualBills : () => setShowLineUpgradeModal(true)}
                                    disabled={canSendLine && (remindStatus === 'sending' || lineStatus === 'sending')}
                                    style={canSendLine ? { backgroundColor: '#EF4444', borderColor: '#EF4444' } : { opacity: 0.75 }}
                                >
                                    {canSendLine ? <AlertTriangle size={15} /> : <Lock size={15} />}
                                    {remindStatus === 'sending' ? 'กำลังทวง...' : 'ทวงบิลค้างชำระ'}
                                </button>
                            </>
                        )}
                        <button className="btn btn-primary btn-sm" onClick={() => setShowMonthlyReport(true)}>
                            <BarChart3 size={15} /> สรุปรายเดือน
                        </button>
                    </div>
                )}

                {/* Row 3: Status / warnings */}
                <div style={{ marginTop: '0.625rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    {lineStatus === 'done' && lineResult && (
                        <div className="line-send-result success">
                            <CheckCircle size={14} />
                            ส่งสำเร็จ {lineResult.sent} ห้อง
                            {lineResult.skipped > 0 && ` · ข้าม ${lineResult.skipped} ห้อง`}
                            {lineResult.results && lineResult.results.length > 0 && (
                                <span style={{ fontSize: '0.72rem', opacity: 0.85 }}> · {lineResult.results.join(' · ')}</span>
                            )}
                        </div>
                    )}
                    {lineStatus === 'error' && (
                        <div className="line-send-result error">
                            <XCircle size={14} /> เกิดข้อผิดพลาดในการส่งบิล กรุณาลองใหม่
                        </div>
                    )}
                    {remindStatus === 'done' && remindResult && (
                        <div className="line-send-result success">
                            <CheckCircle size={14} />
                            ทวงบิลสำเร็จ {remindResult.sent} ห้อง
                            {remindResult.skipped > 0 && ` · ข้าม ${remindResult.skipped} ห้อง`}
                            {remindResult.message && ` · ${remindResult.message}`}
                            {remindResult.results && remindResult.results.length > 0 && (
                                <span style={{ fontSize: '0.72rem', opacity: 0.85 }}> · {remindResult.results.join(' · ')}</span>
                            )}
                        </div>
                    )}
                    {remindStatus === 'error' && (
                        <div className="line-send-result error">
                            <XCircle size={14} /> เกิดข้อผิดพลาดในการทวงบิล กรุณาลองใหม่
                        </div>
                    )}
                    {canSendLine && unlinkedLineCount > 0 && lineStatus === 'idle' && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.35rem',
                            fontSize: '0.75rem', color: '#92400E',
                            background: '#FEF3C7', borderRadius: 6, padding: '0.25rem 0.6rem',
                            border: '1px solid #FDE68A',
                        }}>
                            <AlertTriangle size={12} />
                            {unlinkedLineCount} ห้องยังไม่ลงทะเบียน LINE จะถูกข้าม
                        </div>
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
                                        <th className="text-right">ส่วนกลาง</th>
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
                                            <td className="text-right mono">
                                                {hasBill && bill.common_fee ? (
                                                    <span style={{ color: 'var(--color-primary)' }}>+{formatCurrency(bill.common_fee)}</span>
                                                ) : <span className="text-muted">-</span>}
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
                                        <td colSpan={5} className="text-right font-bold">รวมทั้งสิ้น</td>
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
                                        {hasBill && bill.common_fee ? (
                                            <div className="summary-bill-card-row">
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Building2 size={14} color="#4F46E5" /> ส่วนกลาง</span>
                                                <span className="mono" style={{ color: 'var(--color-primary)' }}>+{formatCurrency(bill.common_fee)}</span>
                                            </div>
                                        ) : null}
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
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
                <div className={`card text-center ${isLocked ? 'saved' : ''}`} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: '400px', width: '100%' }}>
                    <h3 className="card-title mb-2 flex justify-center items-center gap-2">
                        <Send size={20} color={isLocked ? "var(--color-success)" : "#10B981"} />
                        ระบบส่งบิล
                    </h3>
                    <p className="text-muted mb-2" style={{ fontSize: '0.875rem' }}>
                        ล็อคข้อมูลบิลทั้งหมดของเดือนนี้ เพื่อป้องกันการแก้ไข
                    </p>
                    
                    {!isLocked ? (
                        <>
                            {!stats.isAllSaved && (
                                <p className="text-warning mb-4" style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>
                                    *กรุณาจดมิเตอร์ให้ครบทุกห้องก่อนส่งบิล
                                </p>
                            )}
                            <button
                                className="btn w-full mt-auto"
                                disabled={!stats.isAllSaved || isSending}
                                onClick={() => setShowConfirm(true)}
                                style={{ background: '#10B981', borderColor: '#10B981', color: 'white' }}
                            >
                                <Send size={18} />
                                ส่งบิล
                            </button>
                        </>
                    ) : (
                        <div>
                            <div className="text-success font-bold mb-3 flex justify-center items-center gap-2">
                                <CheckCircle size={18} /> ส่งบิลและปิดยอดเรียบร้อยแล้ว
                            </div>
                            <button
                                className="btn btn-outline btn-danger w-full"
                                onClick={async () => {
                                    if (confirm('คุณต้องการยกเลิกการปิดยอดใช่หรือไม่? (สถานะของบิลทั้งหมดจะกลับไปเป็น "รอบันทึก" และคุณจะสามารถแก้ไขได้)')) {
                                        await onUnlockMonth(currentMonth);
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
                        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <FileText size={18} /> ใบเรียกเก็บ — ห้อง {selectedBill.room_number}
                            </h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {(() => {
                                    const room = rooms.find(r => r.id === selectedBill.room_id);
                                    const activeLang = previewLang || room?.language || billCustomization?.default_language || 'th';
                                    return (
                                        <div style={{ display: 'flex', gap: '2px', background: '#F1F5F9', padding: '3px', borderRadius: '8px' }}>
                                            {LANGUAGE_OPTIONS.map(opt => (
                                                <button
                                                    key={opt.code}
                                                    type="button"
                                                    onClick={() => setPreviewLang(opt.code)}
                                                    title={`${opt.nativeName} (${opt.name})`}
                                                    style={{
                                                        border: 'none',
                                                        background: activeLang === opt.code ? '#ffffff' : 'transparent',
                                                        boxShadow: activeLang === opt.code ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                                                        padding: '2px 6px',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        fontSize: '12px',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '2px',
                                                        fontWeight: activeLang === opt.code ? 600 : 400
                                                    }}
                                                >
                                                    <span>{opt.flag}</span>
                                                    <span style={{ fontSize: '10px' }}>{opt.code.toUpperCase()}</span>
                                                </button>
                                            ))}
                                        </div>
                                    );
                                })()}
                                <button
                                    className="btn btn-outline btn-sm btn-icon"
                                    onClick={() => { setSelectedBill(null); setPreviewLang(null); }}
                                >
                                    <XCircle size={20} />
                                </button>
                            </div>
                        </div>
                        <div className="modal-body">
                            {(() => {
                                const room = rooms.find(r => r.id === selectedBill.room_id);
                                const rates = room ? getEffectiveRates(room, config) : null;
                                const activeLang = previewLang || room?.language || billCustomization?.default_language || 'th';
                                return (
                                    <InvoiceBill
                                        bill={selectedBill}
                                        config={config}
                                        billDate={billDate}
                                        effectiveElecRate={rates?.electricityRate}
                                        effectiveWaterConfig={rates?.waterConfig}
                                        billCustomization={billCustomization}
                                        language={activeLang}
                                    />
                                );
                            })()}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setSelectedBill(null); setPreviewLang(null); }}>
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

            {/* Hidden print area — compact Thai slip grid (2-up per row) */}
            {showAllInvoices && (
                <div className="print-only-area" ref={printRef}>
                    <div className="print-slip-grid">
                        {monthBills.map(bill => {
                            const room = rooms.find(r => r.id === bill.room_id);
                            const rates = room ? getEffectiveRates(room, config) : null;
                            const roomLang = room?.language || billCustomization?.default_language || 'th';
                            return (
                                <PrintBillSlip
                                    key={bill.id}
                                    bill={bill}
                                    config={config}
                                    billDate={billDate}
                                    effectiveElecRate={rates?.electricityRate}
                                    effectiveWaterConfig={rates?.waterConfig}
                                    billCustomization={billCustomization}
                                    language={roomLang}
                                />
                            );
                        })}
                    </div>
                </div>
            )}


            {/* Hidden capture area for bill image downloads */}
            <div style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '680px', pointerEvents: 'none', zIndex: -1 }}>
                {captureTarget && (() => {
                    const room = rooms.find(r => r.id === captureTarget.room_id);
                    const rates = room ? getEffectiveRates(room, config) : null;
                    const captureLang = previewLang || room?.language || billCustomization?.default_language || 'th';
                    return (
                        <InvoiceBill
                            ref={captureRef}
                            bill={captureTarget}
                            config={config}
                            billDate={billDate}
                            effectiveElecRate={rates?.electricityRate}
                            effectiveWaterConfig={rates?.waterConfig}
                            billCustomization={billCustomization}
                            language={captureLang}
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
                                    เริ่มต้นเพียง <strong style={{ color: '#8B5CF6' }}>฿399/เดือน</strong> สำหรับแพ็กเกจ HorCare
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
            {/* Share Multiple Bills Modal */}
            {showShareModal && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '400px', textAlign: 'center' }}>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <div style={{
                                width: '48px', height: '48px',
                                borderRadius: '50%',
                                background: 'rgba(16,185,129,0.1)',
                                color: '#10B981',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto 1rem auto'
                            }}>
                                <CheckCircle size={24} />
                            </div>
                            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-text, #111827)', marginBottom: '0.5rem' }}>
                                เตรียมรูปภาพสำเร็จ {preparedFiles.length} รูป
                            </h3>
                            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-light, #6B7280)' }}>
                                คุณสามารถบันทึกรูปลงอัลบั้มบนเครื่องได้ทันที
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                className="btn btn-outline"
                                onClick={() => {
                                    setShowShareModal(false);
                                    setPreparedFiles([]);
                                }}
                                style={{ flex: 1 }}
                            >
                                ยกเลิก
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleShareAll}
                                style={{ flex: 1, background: '#10B981', borderColor: '#10B981', color: '#fff' }}
                            >
                                <Download size={16} />
                                บันทึกลงเครื่อง
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
