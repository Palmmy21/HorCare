import { useState, useEffect } from 'react';
import {
  FileText, ShieldCheck, PenTool, CheckCircle2, Clock, Eye, Download,
  X, ArrowRight, Check, Sparkles,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { portalCall } from './portalApi';
import type { TenantProfile, Room, DormConfig, BillLanguage } from '../../types';
import SignaturePad from '../ESignature/SignaturePad';
import { PaperSheet } from '../Documents/PaperSheet';
import { DocumentViewer } from '../Documents/DocumentViewer';
import { ContractDocument } from '../Documents/ContractDocument';
import type { DocIssuer } from '../Documents/docFormat';
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

  const bc = config?.bill_customization;
  const issuer: DocIssuer = { name: bc?.dorm_name, address: bc?.dorm_address, phone: bc?.dorm_phone, logo: bc?.dorm_logo };
  const isSigned = !!contract.lessee_signature;
  const isPending = !isSigned;

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


  return (
    <div style={{ marginBottom: '1.25rem' }}>
      {/* ── CARD ON TENANT PORTAL ── */}
      {isPending ? (
        /* PENDING SIGNATURE CARD */
        <div
          style={{
            background: 'linear-gradient(135deg, #0A6CC2 0%, #08589F 60%, #08589F 100%)',
            borderRadius: '20px',
            padding: '1.25rem',
            color: '#FFFFFF',
            boxShadow: '0 10px 25px -5px rgba(8, 88, 159, 0.4)',
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
                    background: '#FDEBD3',
                    color: '#9A3412',
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
              color: '#08589F',
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
            border: '1.5px solid #A7DDBB',
            boxShadow: '0 4px 20px -2px rgba(34, 163, 90, 0.12)',
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
                  background: '#DCF2E4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#15803D',
                  flexShrink: 0,
                }}
              >
                <ShieldCheck size={20} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#102A43' }}>
                    สัญญาเช่าดิจิทัล (E-Signature)
                  </h4>
                  <span
                    style={{
                      background: '#DCF2E4',
                      color: '#15803D',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '0.15rem 0.5rem',
                      borderRadius: '999px',
                      border: '1px solid #A7DDBB',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.2rem',
                    }}
                  >
                    <CheckCircle2 size={11} /> ลงนามสมบูรณ์
                  </span>
                </div>
                <div style={{ fontSize: '0.775rem', color: '#557089', marginTop: '0.15rem' }}>
                  เลขที่: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{contract.contract_number}</span> • ตรวจสอบได้
                </div>
              </div>
            </div>

            <span
              style={{
                fontSize: '0.72rem',
                fontFamily: 'var(--font-mono)',
                background: '#EBF1F7',
                padding: '0.25rem 0.6rem',
                borderRadius: '8px',
                color: '#3E5872',
                border: '1px solid #C3D0DE',
              }}
            >
              {contract.verification_code || 'VERIFIED'}
            </span>
          </div>

          <div
            style={{
              padding: '0.65rem 0.85rem',
              background: '#F4F7FB',
              borderRadius: '10px',
              fontSize: '0.8rem',
              color: '#3E5872',
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
                background: 'linear-gradient(135deg, #0A6CC2 0%, #08589F 100%)',
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
              }}
              style={{
                background: '#F4F7FB',
                color: '#29435E',
                border: '1px solid #C3D0DE',
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
            backgroundColor: 'rgba(16, 42, 67, 0.75)',
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
                background: 'linear-gradient(135deg, #0A6CC2 0%, #08589F 100%)',
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
                backgroundColor: '#F4F7FB',
                borderBottom: '1px solid #DCE5EF',
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
                  color: modalStep === 'review' ? '#0A6CC2' : '#557089',
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
                  color: modalStep === 'sign' ? '#0A6CC2' : '#557089',
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
                  {/* the document exactly as it will be signed */}
                  <div style={{ background: '#E5E7EB', borderRadius: '14px', padding: '0.5rem' }}>
                    <PaperSheet>
                      <ContractDocument c={contract} issuer={issuer} />
                    </PaperSheet>
                  </div>

                  {/* Lessor signature status */}
                  {contract.lessor_signature && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: '#EFF8F2', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid #A7DDBB' }}>
                      <CheckCircle2 size={18} color="#15803D" />
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
                      background: 'linear-gradient(135deg, #0A6CC2 0%, #08589F 100%)',
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
                      boxShadow: '0 4px 14px rgba(10, 108, 194, 0.25)',
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
                      background: '#F2F7FC',
                      borderRadius: '14px',
                      border: '1px solid #CFE2F6',
                      fontSize: '0.825rem',
                      color: '#08589F',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <Sparkles size={16} color="#0A6CC2" />
                    <span>
                      ผู้ลงนาม: <strong>{contract.lessee_name}</strong> (ฝ่ายผู้เช่า)
                    </span>
                  </div>

                  {/* Digital Signature Pad */}
                  <div style={{ border: '1.5px solid #C3D0DE', borderRadius: '18px', overflow: 'hidden' }}>
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
                      background: '#F4F7FB',
                      borderRadius: '14px',
                      border: '1px solid #DCE5EF',
                      cursor: 'pointer',
                      fontSize: '0.825rem',
                      color: '#29435E',
                      lineHeight: 1.5,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                      style={{ marginTop: '0.2rem', width: 18, height: 18, accentColor: '#0A6CC2', cursor: 'pointer' }}
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
                        border: '1px solid #C3D0DE',
                        background: '#FFFFFF',
                        color: '#3E5872',
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
                            ? '#C3D0DE'
                            : 'linear-gradient(135deg, #15803D 0%, #22A35A 100%)',
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
                          !lesseeSignature || !agreeTerms || isSubmitting ? 'none' : '0 4px 14px rgba(34, 163, 90, 0.3)',
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

      {/* ── FULL CONTRACT (A4) ── */}
      {showPreviewModal && (
        <DocumentViewer
          title={`${contract.title} · ${contract.contract_number}`}
          filename={`${contract.contract_number}_${contract.lessee_name || 'contract'}`}
          onClose={() => setShowPreviewModal(false)}
        >
          <ContractDocument c={contract} issuer={issuer} />
        </DocumentViewer>
      )}
    </div>
  );
}
