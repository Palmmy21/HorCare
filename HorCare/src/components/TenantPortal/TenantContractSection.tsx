import { useState, useEffect, useRef } from 'react';
import {
  FileText, ShieldCheck, PenTool, CheckCircle2, Clock, Eye, Download,
  X, ArrowRight, Check, Sparkles,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { toast } from 'react-hot-toast';

import { portalCall } from './portalApi';
import type { TenantProfile, Room, DormConfig, BillLanguage } from '../../types';
import SignaturePad from '../ESignature/SignaturePad';
import horcareLogo from '../../assets/horcare_logo.png';
import { errorInfo } from '../../shared/errorInfo';

interface TenantContractSectionProps {
  profile: TenantProfile | null;
  room?: Room;
  config: DormConfig | null;
  lang?: BillLanguage;
  /** Called after the tenant signed, so the page reloads the contract. */
  onSigned: () => void;
}

export default function TenantContractSection({
  profile,
  config,
  onSigned,
}: TenantContractSectionProps) {
  const contract = profile?.signed_contract;

  const [showSignModal, setShowSignModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [modalStep, setModalStep] = useState<'review' | 'sign'>('review');
  const [lesseeSignature, setLesseeSignature] = useState<string>('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const printAreaRef = useRef<HTMLDivElement | null>(null);

  // Auto open sign modal if URL contains action=sign
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'sign' && contract && !contract.lessee_signature) {
      setShowSignModal(true);
    }
  }, [contract]);

  if (!contract) {
    return null;
  }

  const isSigned = !!contract.lessee_signature;
  const isPending = !isSigned;
  const isMarket = contract.contract_type === 'market_stall';
  const unitLabel = isMarket ? 'แผงค้า' : 'ห้องพัก';

  const formatThaiDate = (isoStr?: string) => {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return isoStr;
    }
  };

  const handleSaveSignature = async () => {
    if (!lesseeSignature) {
      toast.error('กรุณาเซ็นชื่อก่อนกดยืนยัน');
      return;
    }
    if (!agreeTerms) {
      toast.error('กรุณากดยินยอมรับข้อตกลงและเงื่อนไขในสัญญา');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading('กำลังบันทึกลายมือชื่อและออกเอกสารรับรอง...');

    try {
      // The server signs the contract of THIS link's room and records the event; the page then reloads it.
      await portalCall('contract_sign', { signature: lesseeSignature });
      onSigned();

      toast.success('ลงนามสัญญาดิจิทัลสำเร็จเรียบร้อยแล้ว! 🎉', { id: toastId });
      setShowSignModal(false);
      setShowPreviewModal(true);
    } catch (errRaw) {
        const err = errorInfo(errRaw);
      console.error(errRaw);
      toast.error('เกิดข้อผิดพลาดในการบันทึก: ' + (err?.message || 'กรุณาลองใหม่'), { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!printAreaRef.current) return;
    setIsExporting(true);
    const toastId = toast.loading('กำลังประมวลผล PDF สัญญา...');

    try {
      const element = printAreaRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#FFFFFF',
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pdfHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
        heightLeft -= pdfHeight;
      }

      pdf.save(`${contract.contract_number}_${contract.lessee_name || 'contract'}.pdf`);
      toast.success('ดาวน์โหลดสัญญา PDF สำเร็จแล้ว 📄', { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error('ไม่สามารถส่งออก PDF ได้ กรุณาลองใหม่', { id: toastId });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      {/* ── CARD ON TENANT PORTAL ── */}
      {isPending ? (
        /* PENDING SIGNATURE CARD */
        <div
          style={{
            background: 'linear-gradient(135deg, #0284C7 0%, #0369A1 60%, #075985 100%)',
            borderRadius: '20px',
            padding: '1.25rem',
            color: '#FFFFFF',
            boxShadow: '0 10px 25px -5px rgba(3, 105, 161, 0.4)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Subtle background glow */}
          <div
            style={{
              position: 'absolute',
              top: -20,
              right: -20,
              width: 120,
              height: 120,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.12)',
              pointerEvents: 'none',
            }}
          />

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.2)',
                  backdropFilter: 'blur(8px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <PenTool size={20} color="#FFFFFF" />
              </div>
              <div>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    background: '#FEF3C7',
                    color: '#92400E',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '0.15rem 0.55rem',
                    borderRadius: '999px',
                    marginBottom: '0.2rem',
                  }}
                >
                  <Clock size={11} /> รอดำเนินการลงนาม
                </span>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.3 }}>
                  สัญญาเช่ารอคุณเซ็นออนไลน์
                </h3>
              </div>
            </div>
          </div>

          <p style={{ margin: '0.65rem 0 0.85rem', fontSize: '0.825rem', color: 'rgba(255, 255, 255, 0.9)', lineHeight: 1.45 }}>
            ทางโครงการได้ออกร่าง <strong>{contract.title}</strong> (เลขที่: {contract.contract_number}) ให้ท่านตรวจสอบข้อตกลงและลงนามดิจิทัล
          </p>

          <div
            style={{
              background: 'rgba(0, 0, 0, 0.15)',
              borderRadius: '12px',
              padding: '0.65rem 0.85rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1rem',
              fontSize: '0.8rem',
            }}
          >
            <div>
              <span style={{ opacity: 0.8 }}>ค่าเช่า:</span>{' '}
              <strong>฿{contract.rent_amount.toLocaleString()}</strong> /{' '}
              {contract.rent_cycle === 'daily' ? 'วัน' : contract.rent_cycle === 'weekly' ? 'สัปดาห์' : contract.rent_cycle === 'yearly' ? 'ปี' : 'เดือน'}
            </div>
            <div>
              <span style={{ opacity: 0.8 }}>มัดจำ:</span> <strong>฿{contract.deposit_amount.toLocaleString()}</strong>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setModalStep('review');
              setShowSignModal(true);
            }}
            style={{
              width: '100%',
              background: '#FFFFFF',
              color: '#0369A1',
              border: 'none',
              borderRadius: '14px',
              padding: '0.85rem 1rem',
              fontWeight: 800,
              fontSize: '0.95rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.15)',
              transition: 'all 0.15s ease',
            }}
          >
            <PenTool size={18} />
            ตรวจสอบข้อตกลงและลงนามสัญญา
          </button>
        </div>
      ) : (
        /* ALREADY SIGNED CARD */
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: '20px',
            padding: '1.25rem',
            border: '1.5px solid #86EFAC',
            boxShadow: '0 4px 20px -2px rgba(16, 185, 129, 0.12)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: '10px',
                  background: '#DCFCE7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#16A34A',
                  flexShrink: 0,
                }}
              >
                <ShieldCheck size={20} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#0F172A' }}>
                    สัญญาเช่าดิจิทัล (E-Signature)
                  </h4>
                  <span
                    style={{
                      background: '#DCFCE7',
                      color: '#16A34A',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '0.15rem 0.5rem',
                      borderRadius: '999px',
                      border: '1px solid #86EFAC',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.2rem',
                    }}
                  >
                    <CheckCircle2 size={11} /> ลงนามสมบูรณ์
                  </span>
                </div>
                <div style={{ fontSize: '0.775rem', color: '#64748B', marginTop: '0.15rem' }}>
                  เลขที่: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{contract.contract_number}</span> • ตรวจสอบได้
                </div>
              </div>
            </div>

            <span
              style={{
                fontSize: '0.72rem',
                fontFamily: 'var(--font-mono)',
                background: '#F1F5F9',
                padding: '0.25rem 0.6rem',
                borderRadius: '8px',
                color: '#475569',
                border: '1px solid #CBD5E1',
              }}
            >
              {contract.verification_code || 'VERIFIED'}
            </span>
          </div>

          <div
            style={{
              padding: '0.65rem 0.85rem',
              background: '#F8FAFC',
              borderRadius: '10px',
              fontSize: '0.8rem',
              color: '#475569',
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div>
              วันที่เริ่มสัญญา: <strong>{formatThaiDate(contract.start_date)}</strong>
            </div>
            <div>
              วันที่ลงนาม: <strong>{formatThaiDate(contract.lessee_signed_at)}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.625rem' }}>
            <button
              type="button"
              onClick={() => setShowPreviewModal(true)}
              style={{
                flex: 1,
                background: 'linear-gradient(135deg, #0284C7 0%, #0369A1 100%)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '12px',
                padding: '0.65rem',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem',
              }}
            >
              <Eye size={15} /> ดูเอกสารสัญญา A4
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPreviewModal(true);
                setTimeout(handleDownloadPDF, 400);
              }}
              style={{
                background: '#F8FAFC',
                color: '#334155',
                border: '1px solid #CBD5E1',
                borderRadius: '12px',
                padding: '0.65rem 1rem',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <Download size={15} /> PDF
            </button>
          </div>
        </div>
      )}

      {/* ── TENANT SIGNING MODAL ── */}
      {showSignModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(8px)',
            padding: '1rem',
            overflow: 'hidden',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSignModal(false);
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '680px',
              backgroundColor: '#FFFFFF',
              borderRadius: '24px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '92vh',
              overflow: 'hidden',
              animation: 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '1.25rem 1.5rem',
                background: 'linear-gradient(135deg, #0284C7 0%, #0369A1 100%)',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <PenTool size={20} color="#FFFFFF" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>
                    ลงนามสัญญาเช่าอิเล็กทรอนิกส์
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.85)', marginTop: '0.1rem' }}>
                    {contract.title} · เลขที่ {contract.contract_number}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSignModal(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  border: 'none',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#FFFFFF',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Step Tabs */}
            <div
              style={{
                display: 'flex',
                backgroundColor: '#F8FAFC',
                borderBottom: '1px solid #E2E8F0',
                padding: '0.5rem 1.5rem',
                gap: '1rem',
              }}
            >
              <button
                type="button"
                onClick={() => setModalStep('review')}
                style={{
                  flex: 1,
                  padding: '0.65rem 0.5rem',
                  border: 'none',
                  borderRadius: '10px',
                  background: modalStep === 'review' ? '#FFFFFF' : 'transparent',
                  color: modalStep === 'review' ? '#0284C7' : '#64748B',
                  fontWeight: modalStep === 'review' ? 800 : 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  boxShadow: modalStep === 'review' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                }}
              >
                <FileText size={15} /> 1. รายละเอียดสัญญา
              </button>
              <button
                type="button"
                onClick={() => setModalStep('sign')}
                style={{
                  flex: 1,
                  padding: '0.65rem 0.5rem',
                  border: 'none',
                  borderRadius: '10px',
                  background: modalStep === 'sign' ? '#FFFFFF' : 'transparent',
                  color: modalStep === 'sign' ? '#0284C7' : '#64748B',
                  fontWeight: modalStep === 'sign' ? 800 : 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  boxShadow: modalStep === 'sign' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                }}
              >
                <PenTool size={15} /> 2. ช่องลงนามดิจิทัล
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
              {modalStep === 'review' ? (
                /* REVIEW TERMS STEP */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* Parties Box */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                      gap: '0.75rem',
                      background: '#F8FAFC',
                      padding: '1rem',
                      borderRadius: '16px',
                      border: '1px solid #E2E8F0',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0369A1', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                        ฝ่ายผู้ให้เช่า
                      </div>
                      <div style={{ fontWeight: 800, fontSize: '0.925rem', color: '#0F172A' }}>
                        {contract.lessor_name}
                      </div>
                      {contract.lessor_phone && (
                        <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.1rem' }}>
                          โทร: {contract.lessor_phone}
                        </div>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#059669', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                        ฝ่ายผู้เช่า (ท่าน)
                      </div>
                      <div style={{ fontWeight: 800, fontSize: '0.925rem', color: '#0F172A' }}>
                        {contract.lessee_name}
                      </div>
                      {contract.lessee_phone && (
                        <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.1rem' }}>
                          โทร: {contract.lessee_phone}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Rent and Unit terms */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: '0.75rem',
                    }}
                  >
                    <div style={{ background: '#F1F5F9', padding: '0.75rem', borderRadius: '12px' }}>
                      <div style={{ fontSize: '0.725rem', color: '#64748B', fontWeight: 600 }}>{unitLabel}</div>
                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#0F172A' }}>{contract.unit_number}</div>
                    </div>
                    <div style={{ background: '#F1F5F9', padding: '0.75rem', borderRadius: '12px' }}>
                      <div style={{ fontSize: '0.725rem', color: '#64748B', fontWeight: 600 }}>ค่าเช่า</div>
                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#0284C7' }}>
                        ฿{contract.rent_amount.toLocaleString()}
                      </div>
                    </div>
                    <div style={{ background: '#F1F5F9', padding: '0.75rem', borderRadius: '12px' }}>
                      <div style={{ fontSize: '0.725rem', color: '#64748B', fontWeight: 600 }}>เงินประกัน/มัดจำ</div>
                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#0F172A' }}>
                        ฿{contract.deposit_amount.toLocaleString()}
                      </div>
                    </div>
                    <div style={{ background: '#F1F5F9', padding: '0.75rem', borderRadius: '12px' }}>
                      <div style={{ fontSize: '0.725rem', color: '#64748B', fontWeight: 600 }}>วันเริ่มสัญญา</div>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0F172A' }}>
                        {formatThaiDate(contract.start_date)}
                      </div>
                    </div>
                  </div>

                  {/* Utilities */}
                  {(contract.electricity_rate_desc || contract.water_rate_desc || contract.waste_fee_desc) && (
                    <div style={{ background: '#F8FAFC', padding: '0.85rem 1rem', borderRadius: '14px', border: '1px solid #E2E8F0', fontSize: '0.825rem' }}>
                      <div style={{ fontWeight: 800, color: '#334155', marginBottom: '0.35rem' }}>
                        อัตราค่าสาธารณูปโภคและบริการ:
                      </div>
                      {contract.electricity_rate_desc && <div>• ค่าไฟฟ้า: {contract.electricity_rate_desc}</div>}
                      {contract.water_rate_desc && <div>• ค่าน้ำประปา: {contract.water_rate_desc}</div>}
                      {contract.waste_fee_desc && <div>• ค่าบริการส่วนกลาง/ขยะ: {contract.waste_fee_desc}</div>}
                    </div>
                  )}

                  {/* Clauses */}
                  <div>
                    <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.925rem', fontWeight: 800, color: '#0F172A' }}>
                      ข้อกำหนดและเงื่อนไขสัญญา:
                    </h4>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '14px',
                        padding: '1rem',
                        fontSize: '0.825rem',
                        color: '#334155',
                        lineHeight: 1.55,
                      }}
                    >
                      {contract.clauses.map((clause, idx) => (
                        <div key={idx} style={{ paddingBottom: '0.35rem', borderBottom: idx < contract.clauses.length - 1 ? '1px dashed #E2E8F0' : 'none' }}>
                          {clause}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Additional terms */}
                  {contract.custom_terms && (
                    <div style={{ background: '#FEF3C7', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid #FCD34D', fontSize: '0.825rem', color: '#92400E' }}>
                      <strong>ข้อตกลงพิเศษเพิ่มเติม:</strong> {contract.custom_terms}
                    </div>
                  )}

                  {/* Lessor signature status */}
                  {contract.lessor_signature && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: '#F0FDF4', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid #BBF7D0' }}>
                      <CheckCircle2 size={18} color="#16A34A" />
                      <div style={{ fontSize: '0.825rem', color: '#166534' }}>
                        ฝ่ายผู้ให้เช่าได้ลงนามรับรองแล้วเมื่อ{' '}
                        <strong>{formatThaiDate(contract.lessor_signed_at)}</strong>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setModalStep('sign')}
                    style={{
                      background: 'linear-gradient(135deg, #0284C7 0%, #0369A1 100%)',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '14px',
                      padding: '0.875rem',
                      fontWeight: 800,
                      fontSize: '0.95rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.45rem',
                      boxShadow: '0 4px 14px rgba(2, 132, 199, 0.25)',
                    }}
                  >
                    อ่านครบถ้วนแล้ว ไปยังหน้าลงนาม <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                /* SIGNING PAD STEP */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div
                    style={{
                      padding: '0.85rem 1rem',
                      background: '#F0F9FF',
                      borderRadius: '14px',
                      border: '1px solid #BAE6FD',
                      fontSize: '0.825rem',
                      color: '#0369A1',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <Sparkles size={16} color="#0284C7" />
                    <span>
                      ผู้ลงนาม: <strong>{contract.lessee_name}</strong> (ฝ่ายผู้เช่า)
                    </span>
                  </div>

                  {/* Digital Signature Pad */}
                  <div style={{ border: '1.5px solid #CBD5E1', borderRadius: '18px', overflow: 'hidden' }}>
                    <SignaturePad
                      label="ลายมือชื่อผู้เช่า (Lessee Signature)"
                      subtitle="ใช้นิ้วมือ หรือ ปากกาสไตลัส วาดลายมือชื่อของท่านในกรอบนี้"
                      signerName={contract.lessee_name}
                      onSave={setLesseeSignature}
                      height={200}
                    />
                  </div>

                  {/* Legal Consent Checkbox */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.625rem',
                      padding: '0.85rem 1rem',
                      background: '#F8FAFC',
                      borderRadius: '14px',
                      border: '1px solid #E2E8F0',
                      cursor: 'pointer',
                      fontSize: '0.825rem',
                      color: '#334155',
                      lineHeight: 1.5,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                      style={{ marginTop: '0.2rem', width: 18, height: 18, accentColor: '#0284C7', cursor: 'pointer' }}
                    />
                    <span>
                      ข้าพเจ้าได้ตรวจสอบรายละเอียดและยอมรับข้อตกลงและเงื่อนไขทั้งหมดในสัญญานี้
                      และยินยอมลงลายมือชื่อแบบอิเล็กทรอนิกส์ที่มีผลผูกพันตาม พ.ร.บ. ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์
                    </span>
                  </label>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button
                      type="button"
                      onClick={() => setModalStep('review')}
                      style={{
                        padding: '0.875rem 1.25rem',
                        borderRadius: '14px',
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        color: '#475569',
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        cursor: 'pointer',
                      }}
                    >
                      ย้อนกลับ
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveSignature}
                      disabled={!lesseeSignature || !agreeTerms || isSubmitting}
                      style={{
                        flex: 1,
                        background:
                          !lesseeSignature || !agreeTerms || isSubmitting
                            ? '#CBD5E1'
                            : 'linear-gradient(135deg, #059669 0%, #10B981 100%)',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '14px',
                        padding: '0.875rem 1rem',
                        fontWeight: 800,
                        fontSize: '0.95rem',
                        cursor: !lesseeSignature || !agreeTerms || isSubmitting ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.45rem',
                        boxShadow:
                          !lesseeSignature || !agreeTerms || isSubmitting ? 'none' : '0 4px 14px rgba(16, 185, 129, 0.3)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isSubmitting ? (
                        <>กำลังบันทึกสัญญา...</>
                      ) : (
                        <>
                          <Check size={18} /> ยืนยันการลงนามสัญญาดิจิทัล
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── FULL CONTRACT A4 PREVIEW / PRINT MODAL ── */}
      {showPreviewModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            backdropFilter: 'blur(8px)',
            padding: '1rem',
            overflow: 'hidden',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPreviewModal(false);
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '860px',
              backgroundColor: '#F1F5F9',
              borderRadius: '20px',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '94vh',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: '1rem 1.5rem',
                backgroundColor: '#FFFFFF',
                borderBottom: '1px solid #E2E8F0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShieldCheck size={20} color="#16A34A" />
                <span style={{ fontWeight: 800, fontSize: '1rem', color: '#0F172A' }}>
                  เอกสารสัญญาเช่าฉบับสมบูรณ์ (A4 Preview)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={handleDownloadPDF}
                  disabled={isExporting}
                  style={{
                    background: 'linear-gradient(135deg, #0284C7 0%, #0369A1 100%)',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.5rem 1rem',
                    fontWeight: 700,
                    fontSize: '0.825rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <Download size={14} /> ดาวน์โหลด PDF
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(false)}
                  style={{
                    background: 'transparent',
                    border: '1px solid #CBD5E1',
                    borderRadius: '50%',
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#64748B',
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* A4 Printable Paper */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', justifyContent: 'center' }}>
              <div
                ref={printAreaRef}
                style={{
                  width: '100%',
                  maxWidth: '740px',
                  backgroundColor: '#FFFFFF',
                  padding: '2.5rem',
                  borderRadius: '4px',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                  color: '#1E293B',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '0.875rem',
                  lineHeight: 1.6,
                }}
              >
                {/* Header with Logo */}
                <div style={{ textAlign: 'center', marginBottom: '1.5rem', borderBottom: '2px solid #0F172A', paddingBottom: '1rem' }}>
                  <img
                    src={config?.bill_customization?.dorm_logo || horcareLogo}
                    alt="Logo"
                    style={{ height: '48px', objectFit: 'contain', marginBottom: '0.5rem' }}
                  />
                  <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0F172A' }}>
                    {contract.title}
                  </h2>
                  <div style={{ fontSize: '0.825rem', color: '#64748B', marginTop: '0.2rem' }}>
                    เลขที่สัญญา: <strong style={{ fontFamily: 'var(--font-mono)' }}>{contract.contract_number}</strong>
                  </div>
                </div>

                {/* Parties */}
                <div style={{ marginBottom: '1.25rem', textAlign: 'justify' }}>
                  สัญญาฉบับนี้ทำขึ้นเมื่อวันที่ <strong>{formatThaiDate(contract.start_date)}</strong> ระหว่าง{' '}
                  <strong>{contract.lessor_name}</strong> (ซึ่งต่อไปนี้เรียกว่า "ผู้ให้เช่า") ฝ่ายหนึ่ง กับ{' '}
                  <strong>{contract.lessee_name}</strong>
                  {contract.lessee_id_card ? ` (บัตรประชาชนเลขที่: ${contract.lessee_id_card})` : ''}
                  {contract.lessee_business_type ? ` ประกอบกิจการ: ${contract.lessee_business_type}` : ''}{' '}
                  (ซึ่งต่อไปนี้เรียกว่า "ผู้เช่า") อีกฝ่ายหนึ่ง โดยทั้งสองฝ่ายได้ตกลงทำสัญญาเช่า {unitLabel}{' '}
                  <strong>{contract.unit_number}</strong> {contract.zone_or_floor ? `(${contract.zone_or_floor})` : ''} โดยมีข้อความดังต่อไปนี้:
                </div>

                {/* Rates Table */}
                <div
                  style={{
                    backgroundColor: '#F8FAFC',
                    borderRadius: '8px',
                    padding: '0.875rem',
                    border: '1px solid #E2E8F0',
                    marginBottom: '1.25rem',
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                    <div>
                      • อัตราค่าเช่า: <strong>฿{contract.rent_amount.toLocaleString()} บาท/รอบ</strong>
                    </div>
                    <div>
                      • เงินประกันความเสียหาย: <strong>฿{contract.deposit_amount.toLocaleString()} บาท</strong>
                    </div>
                    <div>
                      • วันเริ่มต้นสัญญา: <strong>{formatThaiDate(contract.start_date)}</strong>
                    </div>
                    <div>
                      • วันสิ้นสุดสัญญา: <strong>{contract.end_date ? formatThaiDate(contract.end_date) : 'ไม่มีกำหนด'}</strong>
                    </div>
                  </div>
                </div>

                {/* Clauses */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>ข้อตกลงและเงื่อนไข:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', fontSize: '0.825rem' }}>
                    {contract.clauses.map((clause, idx) => (
                      <div key={idx} style={{ textAlign: 'justify' }}>{clause}</div>
                    ))}
                  </div>
                  {contract.custom_terms && (
                    <div style={{ marginTop: '0.65rem', fontStyle: 'italic', color: '#475569' }}>
                      * ข้อตกลงเพิ่มเติม: {contract.custom_terms}
                    </div>
                  )}
                </div>

                {/* Signatures */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '2rem',
                    marginTop: '2rem',
                    paddingTop: '1.5rem',
                    borderTop: '1px solid #E2E8F0',
                  }}
                >
                  {/* Lessor Sign */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.825rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                      ลงชื่อ.......................................................ผู้ให้เช่า
                    </div>
                    {contract.lessor_signature ? (
                      <img
                        src={contract.lessor_signature}
                        alt="Lessor Signature"
                        style={{ height: '54px', objectFit: 'contain', margin: '0 auto' }}
                      />
                    ) : (
                      <div style={{ height: '54px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: '0.75rem' }}>
                        (ลงนามดิจิทัล)
                      </div>
                    )}
                    <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: '0.25rem' }}>
                      ({contract.lessor_name})
                    </div>
                    {contract.lessor_signed_at && (
                      <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                        วันที่ {formatThaiDate(contract.lessor_signed_at)}
                      </div>
                    )}
                  </div>

                  {/* Lessee Sign */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.825rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                      ลงชื่อ.......................................................ผู้เช่า
                    </div>
                    {contract.lessee_signature ? (
                      <img
                        src={contract.lessee_signature}
                        alt="Lessee Signature"
                        style={{ height: '54px', objectFit: 'contain', margin: '0 auto' }}
                      />
                    ) : (
                      <div style={{ height: '54px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: '0.75rem' }}>
                        (รอดำเนินการลงนาม)
                      </div>
                    )}
                    <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: '0.25rem' }}>
                      ({contract.lessee_name})
                    </div>
                    {contract.lessee_signed_at && (
                      <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                        วันที่ {formatThaiDate(contract.lessee_signed_at)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Audit verification seal footer */}
                <div
                  style={{
                    marginTop: '2.5rem',
                    paddingTop: '0.75rem',
                    borderTop: '1px dashed #CBD5E1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.72rem',
                    color: '#64748B',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <ShieldCheck size={14} color="#16A34A" />
                    <span>
                      เอกสารนี้ลงนามอิเล็กทรอนิกส์ผ่านระบบ HorCare • Audit Code:{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)', color: '#0F172A' }}>
                        {contract.verification_code || 'VERIFIED'}
                      </strong>
                    </span>
                  </div>
                  <div>
                    <QRCodeCanvas
                      // the contract number and audit code only: a printed contract must not carry the tenant's portal link
                      value={`HorCare ${contract.contract_number} ${contract.verification_code || ''}`.trim()}
                      size={36}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
