import { useState, useRef } from 'react';
import {
  X, FileText, CheckCircle2, PenTool, Printer, Download, Save,
  Building2, Store, User, ShieldCheck, Check,
  ChevronLeft, ArrowRight, Share2, Plus, Trash2, Send,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';

import type { Room, DormConfig, TenantProfile, SignedContractData, ContractTemplate } from '../../types';
import { getWorkspaceTerms } from '../../utils/workspaceTerminology';
import { fetchPortalUrl } from '../../utils/portalLinks';
import type { ContractFormState } from '../../utils/contractTemplates';
import {
  buildInitialContractForm,
  generateVerificationCode,
  getAllContractTemplates,
  applyTemplateToForm,
} from '../../utils/contractTemplates';
import SignaturePad from './SignaturePad';
import ShareContractModal from './ShareContractModal';
import { PaperSheet } from '../Documents/PaperSheet';
import { ContractDocument } from '../Documents/ContractDocument';
import { downloadPaperPdf, printPaperPdf } from '../Documents/paperPdf';

interface ContractSignModalProps {
  room: Room;
  config: DormConfig;
  profile?: TenantProfile | null;
  onSaveContract: (contract: SignedContractData) => Promise<void>;
  onClose: () => void;
  uid?: string;
  buildingId?: string;
  initialStep?: Step;
}

type Step = 'details' | 'signing' | 'preview';
type SignerRole = 'lessor' | 'lessee';

export default function ContractSignModal({
  room,
  config,
  profile,
  onSaveContract,
  onClose,
  uid,
  buildingId,
  initialStep,
}: ContractSignModalProps) {
  const terms = getWorkspaceTerms(config.building_type);
  const printAreaRef = useRef<HTMLDivElement | null>(null);

  // Initialize form state
  const [form, setForm] = useState<ContractFormState>(() => {
    // If profile already has a signed contract, populate from it
    if (profile?.signed_contract) {
      const sc = profile.signed_contract;
      return {
        contract_number: sc.contract_number,
        contract_type: sc.contract_type,
        title: sc.title,
        lessor_name: sc.lessor_name,
        lessor_phone: sc.lessor_phone || '',
        lessor_id_card: sc.lessor_id_card || '',
        lessor_address: sc.lessor_address || '',
        lessor_signature: sc.lessor_signature,
        lessor_signed_at: sc.lessor_signed_at,

        lessee_name: sc.lessee_name,
        lessee_phone: sc.lessee_phone || '',
        lessee_id_card: sc.lessee_id_card || '',
        lessee_address: sc.lessee_address || '',
        lessee_business_type: sc.lessee_business_type || '',
        lessee_signature: sc.lessee_signature,
        lessee_signed_at: sc.lessee_signed_at,

        unit_number: sc.unit_number,
        zone_or_floor: sc.zone_or_floor || '',
        stall_or_room_size: sc.stall_or_room_size || '',
        rent_amount: sc.rent_amount,
        rent_cycle: sc.rent_cycle,
        deposit_amount: sc.deposit_amount,
        start_date: sc.start_date,
        end_date: sc.end_date || '',

        electricity_rate_desc: sc.electricity_rate_desc || '',
        water_rate_desc: sc.water_rate_desc || '',
        waste_fee_desc: sc.waste_fee_desc || '',

        clauses: sc.clauses || [],
        custom_terms: sc.custom_terms || '',
      };
    }
    return buildInitialContractForm(room, config, profile);
  });

  const [activeStep, setActiveStep] = useState<Step>(
    initialStep || (profile?.signed_contract ? 'preview' : 'details')
  );
  const [activeSigner, setActiveSigner] = useState<SignerRole>('lessee');
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [verificationCode] = useState<string>(() => profile?.signed_contract?.verification_code || generateVerificationCode());
  const [linkCopied, setLinkCopied] = useState(false);

  // Template state
  const [allTemplates, setAllTemplates] = useState<ContractTemplate[]>(() => getAllContractTemplates(config));
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() => form.template_id || allTemplates[0]?.id || '');
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // Share modal state
  const [showShareModal, setShowShareModal] = useState(false);
  const [savedContractForShare, setSavedContractForShare] = useState<SignedContractData | null>(null);

  // Switch template
  const handleSelectTemplate = (tplId: string) => {
    setSelectedTemplateId(tplId);
    const tpl = allTemplates.find(t => t.id === tplId);
    if (tpl) {
      setForm(prev => applyTemplateToForm(tpl, prev));
      toast.success(`เปลี่ยนเป็นเทมเพลต "${tpl.name}" แล้ว`);
    }
  };

  // Save current clauses & terms as new template
  const handleSaveNewTemplate = async () => {
    if (!newTemplateName.trim()) {
      toast.error('กรุณาระบุชื่อเทมเพลต');
      return;
    }
    const newTpl: ContractTemplate = {
      id: `tpl-${Date.now()}`,
      name: newTemplateName.trim(),
      contract_type: form.contract_type,
      title: form.title,
      default_rent_cycle: form.rent_cycle,
      electricity_rate_desc: form.electricity_rate_desc,
      water_rate_desc: form.water_rate_desc,
      waste_fee_desc: form.waste_fee_desc,
      clauses: [...form.clauses],
      custom_terms: form.custom_terms,
      created_at: new Date().toISOString(),
    };

    const updatedCustom = [...(config.contract_templates || []), newTpl];
    if (uid && buildingId) {
      try {
        await updateDoc(doc(db, `users/${uid}/buildings/${buildingId}/data`, 'config'), {
          contract_templates: updatedCustom,
        });
        config.contract_templates = updatedCustom;
      } catch (e) {
        console.warn('Could not save template to Firestore config:', e);
      }
    }

    const updatedAll = [...allTemplates, newTpl];
    setAllTemplates(updatedAll);
    setSelectedTemplateId(newTpl.id);
    setShowSaveTemplateModal(false);
    setNewTemplateName('');
    toast.success(`บันทึกเทมเพลต "${newTpl.name}" เรียบร้อยแล้ว! ✨`);
  };

  // Delete custom template
  const handleDeleteTemplate = async (tplId: string) => {
    if (window.confirm('คุณต้องการลบเทมเพลตนี้ใช่หรือไม่?')) {
      const updatedCustom = (config.contract_templates || []).filter(t => t.id !== tplId);
      if (uid && buildingId) {
        try {
          await updateDoc(doc(db, `users/${uid}/buildings/${buildingId}/data`, 'config'), {
            contract_templates: updatedCustom,
          });
          config.contract_templates = updatedCustom;
        } catch (e) {
          console.warn('Could not update Firestore config:', e);
        }
      }
      const updatedAll = allTemplates.filter(t => t.id !== tplId);
      setAllTemplates(updatedAll);
      setSelectedTemplateId(updatedAll[0]?.id || '');
      toast.success('ลบเทมเพลตเรียบร้อยแล้ว');
    }
  };

  // Field update handler
  const handleUpdateForm = (field: keyof ContractFormState, value: unknown) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  // Clause editing
  const handleClauseChange = (idx: number, text: string) => {
    setForm(prev => {
      const next = [...prev.clauses];
      next[idx] = text;
      return { ...prev, clauses: next };
    });
  };

  // Signature callbacks
  const handleSaveLessorSignature = (dataUrl: string) => {
    setForm(prev => ({
      ...prev,
      lessor_signature: dataUrl,
      lessor_signed_at: dataUrl ? new Date().toISOString() : undefined,
    }));
  };

  const handleSaveLesseeSignature = (dataUrl: string) => {
    setForm(prev => ({
      ...prev,
      lessee_signature: dataUrl,
      lessee_signed_at: dataUrl ? new Date().toISOString() : undefined,
    }));
  };

  // Generate signed contract object
  const buildSignedContractData = (): SignedContractData => {
    const isBothSigned = !!form.lessor_signature && !!form.lessee_signature;
    return {
      id: profile?.signed_contract?.id || `contract-${Date.now()}`,
      contract_number: form.contract_number,
      contract_type: form.contract_type,
      title: form.title,
      lessor_name: form.lessor_name,
      lessor_phone: form.lessor_phone,
      lessor_id_card: form.lessor_id_card,
      lessor_address: form.lessor_address,
      lessor_signature: form.lessor_signature,
      lessor_signed_at: form.lessor_signed_at,

      lessee_name: form.lessee_name,
      lessee_phone: form.lessee_phone,
      lessee_id_card: form.lessee_id_card,
      lessee_address: form.lessee_address,
      lessee_business_type: form.lessee_business_type,
      lessee_signature: form.lessee_signature,
      lessee_signed_at: form.lessee_signed_at,

      unit_number: form.unit_number,
      zone_or_floor: form.zone_or_floor,
      stall_or_room_size: form.stall_or_room_size,
      rent_amount: Number(form.rent_amount) || 0,
      rent_cycle: form.rent_cycle,
      deposit_amount: Number(form.deposit_amount) || 0,
      start_date: form.start_date,
      end_date: form.end_date,

      electricity_rate_desc: form.electricity_rate_desc,
      water_rate_desc: form.water_rate_desc,
      waste_fee_desc: form.waste_fee_desc,

      clauses: form.clauses,
      custom_terms: form.custom_terms,

      created_at: profile?.signed_contract?.created_at || new Date().toISOString(),
      verification_code: verificationCode,
      template_id: selectedTemplateId,
      status: isBothSigned ? 'signed' : (form.lessor_signature ? 'pending_lessee' : 'draft'),
    };
  };

  // Save to profile handler
  const handleSaveToProfile = async () => {
    setIsSaving(true);
    try {
      const contractData = buildSignedContractData();
      await onSaveContract(contractData);
      toast.success('บันทึกสัญญาเช่าดิจิทัลเรียบร้อยแล้ว 🎉', {
        duration: 3500,
        style: {
          background: 'linear-gradient(135deg, #15803D 0%, #22A35A 100%)',
          color: '#ffffff',
          fontWeight: 700,
          borderRadius: '12px',
        }
      });
    } catch (err) {
      console.error(err);
      toast.error('บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setIsSaving(false);
    }
  };

  // Save and share draft directly to tenant
  const handleSaveAndShareDraft = async () => {
    setIsSaving(true);
    try {
      const isBothSigned = !!form.lessor_signature && !!form.lessee_signature;
      const contractData: SignedContractData = {
        ...buildSignedContractData(),
        status: isBothSigned ? 'signed' : 'pending_lessee',
      };
      await onSaveContract(contractData);
      setSavedContractForShare(contractData);
      setShowShareModal(true);
      toast.success('บันทึกร่างสัญญาแล้ว พร้อมส่งให้ผู้เช่า 📤');
    } catch (err) {
      console.error(err);
      toast.error('บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setIsSaving(false);
    }
  };

  // Download PDF — A4 pages that break between paragraphs, never through a line
  const handleDownloadPDF = async () => {
    if (!printAreaRef.current) return;
    setIsExporting(true);
    const toastId = toast.loading('กำลังสร้าง PDF...');
    try {
      await downloadPaperPdf(printAreaRef.current, `สัญญา_${form.unit_number}_${form.lessee_name || 'ผู้เช่า'}.pdf`);
      toast.success('ดาวน์โหลด PDF สัญญาเรียบร้อยแล้ว!', { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error('สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่', { id: toastId });
    } finally {
      setIsExporting(false);
    }
  };

  // Print — the same PDF, so the paper copy matches the downloaded one
  const handlePrint = () => {
    if (!printAreaRef.current) return;
    printPaperPdf(printAreaRef.current).catch(err => {
      console.error(err);
      toast.error('เปิดหน้าพิมพ์ไม่สำเร็จ กรุณาลองใหม่');
    });
  };

  // Copy signing link
  const handleCopyLink = () => {
    if (!uid || !buildingId) return;
    // the room's portal link carries a server-side secret, so it is fetched rather than built here
    fetchPortalUrl(uid, buildingId, room.id, { sign: true })
      .then(url => navigator.clipboard.writeText(url))
      .then(() => {
        setLinkCopied(true);
        toast.success('คัดลอกลิงก์สำหรับส่งให้ผู้ค้า/ผู้เช่าเซ็นแล้ว!');
        setTimeout(() => setLinkCopied(false), 2500);
      })
      .catch(() => toast.error('คัดลอกลิงก์ไม่สำเร็จ กรุณาลองใหม่'));
  };

  // Helper date format
  const formatThaiDate = (isoStr?: string) => {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return isoStr;
    }
  };

  const isBothSigned = !!form.lessor_signature && !!form.lessee_signature;

  return (
    <>
      <div
        onClick={e => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(16, 42, 67, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#F4F7FB',
          width: '100%',
          maxWidth: '1000px',
          height: '92vh',
          maxHeight: '92vh',
          borderRadius: '20px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          overflow: 'hidden',
        }}
      >
        {/* Modal Top Header */}
        <div style={{
          padding: '1.25rem 1.75rem',
          background: '#FFFFFF',
          borderBottom: '1px solid var(--color-gray-200)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              background: terms.isMarket ? '#FDEBD3' : '#E7F0FA',
              width: 44,
              height: 44,
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              {terms.isMarket ? <Store size={22} color="#E8740C" /> : <PenTool size={22} color="#0A6CC2" />}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--color-gray-900)' }}>
                  {form.title}
                </h2>
                {isBothSigned ? (
                  <span style={{
                    background: 'rgba(34, 163, 90, 0.12)',
                    color: '#15803D',
                    border: '1px solid rgba(34, 163, 90, 0.3)',
                    padding: '0.15rem 0.55rem',
                    borderRadius: '999px',
                    fontSize: '0.725rem',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem'
                  }}>
                    <CheckCircle2 size={12} /> ลงนามครบถ้วน
                  </span>
                ) : (
                  <span style={{
                    background: 'rgba(245, 158, 46, 0.12)',
                    color: '#E8740C',
                    border: '1px solid rgba(245, 158, 46, 0.3)',
                    padding: '0.15rem 0.55rem',
                    borderRadius: '999px',
                    fontSize: '0.725rem',
                    fontWeight: 700
                  }}>
                    ร่างสัญญา / รอดำเนินการเซ็น
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)', marginTop: '2px' }}>
                {terms.unitPrefix}{form.unit_number} {form.zone_or_floor ? `(${form.zone_or_floor})` : ''} · เลขที่สัญญา: <span className="mono">{form.contract_number}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                handleCopyLink();
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.5rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid var(--color-gray-200)',
                background: '#FFFFFF',
                color: linkCopied ? '#15803D' : 'var(--color-gray-700)',
                fontSize: '0.825rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="คัดลอกลิงก์ส่งให้ผู้เช่าเซ็นผ่านมือถือ"
            >
              {linkCopied ? <Check size={14} /> : <Share2 size={14} />}
              {linkCopied ? 'คัดลอกแล้ว' : 'แชร์ลิงก์เซ็น'}
            </button>

            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onClose();
              }}
              style={{
                background: 'var(--color-gray-100)',
                border: 'none',
                width: 36,
                height: 36,
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--color-gray-600)',
                transition: 'all 0.15s',
              }}
              title="ปิดหน้าต่าง"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Step Navigation Tabs */}
        <div style={{
          display: 'flex',
          background: '#FFFFFF',
          borderBottom: '1px solid var(--color-gray-200)',
          padding: '0 1.75rem',
          gap: '1.5rem',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}>
          {[
            { id: 'details', label: '1. ข้อมูลสัญญา & คู่สัญญา', icon: FileText },
            { id: 'signing', label: '2. ลงลายมือชื่ออิเล็กทรอนิกส์', icon: PenTool },
            { id: 'preview', label: '3. ตรวจสอบเอกสาร & พิมพ์สัญญา', icon: ShieldCheck },
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeStep === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setActiveStep(tab.id as Step);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.85rem 0.25rem',
                  background: 'none',
                  border: 'none',
                  borderBottom: active ? '3px solid var(--color-primary, #0F4C81)' : '3px solid transparent',
                  color: active ? 'var(--color-primary, #0F4C81)' : 'var(--color-gray-500)',
                  fontWeight: active ? 700 : 500,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Modal Scrollable Content Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.75rem' }}>
          
          {/* ═════════ STEP 1: CONTRACT DETAILS ═════════ */}
          {activeStep === 'details' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* ── Template Selector & Creator Bar ── */}
              <div style={{
                background: '#FFFFFF',
                borderRadius: '16px',
                padding: '1rem 1.25rem',
                border: '1px solid #CFE2F6',
                boxShadow: '0 2px 8px rgba(10, 108, 194, 0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '1rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flex: 1, minWidth: '280px' }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: '10px',
                    background: 'rgba(10, 108, 194, 0.12)',
                    color: '#0A6CC2',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <FileText size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#08589F', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      📋 รูปแบบสัญญา (Contract Template)
                    </label>
                    <select
                      value={selectedTemplateId}
                      onChange={e => handleSelectTemplate(e.target.value)}
                      style={{
                        width: '100%',
                        marginTop: '0.25rem',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '10px',
                        border: '1.5px solid #CFE2F6',
                        backgroundColor: '#F2F7FC',
                        color: '#08589F',
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        outline: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <optgroup label="✨ เทมเพลตมาตรฐาน HorCare">
                        {allTemplates.filter(t => t.is_default).map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </optgroup>
                      {allTemplates.some(t => !t.is_default) && (
                        <optgroup label="⭐ เทมเพลตที่คุณสร้างเอง">
                          {allTemplates.filter(t => !t.is_default).map(t => (
                            <option key={t.id} value={t.id}>⭐ {t.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {/* Delete custom template button */}
                  {!allTemplates.find(t => t.id === selectedTemplateId)?.is_default && (
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(selectedTemplateId)}
                      style={{
                        padding: '0.5rem 0.85rem',
                        borderRadius: '10px',
                        border: '1px solid #FCA5A5',
                        background: '#FEF2F2',
                        color: '#DC2626',
                        fontSize: '0.8125rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                      }}
                      title="ลบเทมเพลตที่เลือกนี้"
                    >
                      <Trash2 size={14} /> ลบเทมเพลตนี้
                    </button>
                  )}

                  {/* Save current as new template */}
                  <button
                    type="button"
                    onClick={() => setShowSaveTemplateModal(true)}
                    style={{
                      padding: '0.5rem 0.95rem',
                      borderRadius: '10px',
                      border: '1px solid #CFE2F6',
                      background: '#FFFFFF',
                      color: '#0A6CC2',
                      fontSize: '0.8125rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                    }}
                  >
                    <Plus size={15} /> บันทึกเป็นเทมเพลตใหม่
                  </button>
                </div>
              </div>

              {/* Lessor & Lessee Card */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '1.25rem',
              }}>
                {/* Lessor Box */}
                <div className="card" style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: '#08589F', fontWeight: 700 }}>
                    <Building2 size={18} /> ฝ่ายผู้ให้เช่า (Lessor / ผู้ดูแล)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div className="form-group">
                      <label className="form-label">ชื่อผู้ให้เช่า / นิติบุคคล</label>
                      <input
                        type="text"
                        className="form-input"
                        value={form.lessor_name}
                        onChange={e => handleUpdateForm('lessor_name', e.target.value)}
                        placeholder="ชื่อตลาด หรือ ผู้จัดการหอพัก"
                      />
                    </div>
                    <div className="settings-grid">
                      <div className="form-group">
                        <label className="form-label">เบอร์โทรติดต่อ</label>
                        <input
                          type="text"
                          className="form-input"
                          value={form.lessor_phone}
                          onChange={e => handleUpdateForm('lessor_phone', e.target.value)}
                          placeholder="08X-XXX-XXXX"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">เลขประจำตัวประชาชน / ทะเบียน</label>
                        <input
                          type="text"
                          className="form-input mono"
                          value={form.lessor_id_card}
                          onChange={e => handleUpdateForm('lessor_id_card', e.target.value)}
                          placeholder="X-XXXX-XXXXX-XX-X"
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">ที่อยู่ผู้ให้เช่า</label>
                      <input
                        type="text"
                        className="form-input"
                        value={form.lessor_address}
                        onChange={e => handleUpdateForm('lessor_address', e.target.value)}
                        placeholder="ที่อยู่ตลาด หรือ สำนักงานหอพัก"
                      />
                    </div>
                  </div>
                </div>

                {/* Lessee Box */}
                <div className="card" style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: '#15803D', fontWeight: 700 }}>
                    <User size={18} /> ฝ่ายผู้เช่า / ผู้ค้า (Lessee)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div className="form-group">
                      <label className="form-label">ชื่อ-นามสกุล {terms.tenantLabel}</label>
                      <input
                        type="text"
                        className="form-input"
                        value={form.lessee_name}
                        onChange={e => handleUpdateForm('lessee_name', e.target.value)}
                        placeholder="ชื่อจริง นามสกุล"
                      />
                    </div>
                    <div className="settings-grid">
                      <div className="form-group">
                        <label className="form-label">เบอร์โทรศัพท์</label>
                        <input
                          type="text"
                          className="form-input"
                          value={form.lessee_phone}
                          onChange={e => handleUpdateForm('lessee_phone', e.target.value)}
                          placeholder="08X-XXX-XXXX"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">เลขประจำตัวประชาชน</label>
                        <input
                          type="text"
                          className="form-input mono"
                          value={form.lessee_id_card}
                          onChange={e => handleUpdateForm('lessee_id_card', e.target.value)}
                          placeholder="X-XXXX-XXXXX-XX-X"
                        />
                      </div>
                    </div>
                    {terms.isMarket && (
                      <div className="form-group">
                        <label className="form-label">ประเภทสินค้าที่จำหน่าย</label>
                        <input
                          type="text"
                          className="form-input"
                          value={form.lessee_business_type || ''}
                          onChange={e => handleUpdateForm('lessee_business_type', e.target.value)}
                          placeholder="เช่น ข้าวมันไก่, เสื้อผ้าแฟชั่น, ผักสด"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Unit & Rent terms */}
              <div className="card" style={{ padding: '1.25rem' }}>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-gray-800)' }}>
                  📍 ข้อมูลพื้นที่เช่าและอัตราค่าบริการ
                </h3>
                <div className="settings-grid" style={{ marginBottom: '0.85rem' }}>
                  <div className="form-group">
                    <label className="form-label">{terms.unitNumberLabel}</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.unit_number}
                      onChange={e => handleUpdateForm('unit_number', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{terms.groupLabel}</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.zone_or_floor}
                      onChange={e => handleUpdateForm('zone_or_floor', e.target.value)}
                      placeholder={terms.isMarket ? 'เช่น โซน A (อาหาร)' : 'เช่น ชั้น 2'}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">ขนาดพื้นที่</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.stall_or_room_size}
                      onChange={e => handleUpdateForm('stall_or_room_size', e.target.value)}
                      placeholder="เช่น 2x2 ม. หรือ 28 ตร.ม."
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{terms.rentLabel} (บาท)</label>
                    <input
                      type="number"
                      className="form-input mono"
                      value={form.rent_amount}
                      onChange={e => handleUpdateForm('rent_amount', Number(e.target.value))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">รอบคิดค่าเช่า</label>
                    <select
                      className="form-input"
                      value={form.rent_cycle}
                      onChange={e => handleUpdateForm('rent_cycle', e.target.value)}
                    >
                      <option value="daily">รายวัน (Daily)</option>
                      <option value="weekly">รายสัปดาห์ (Weekly)</option>
                      <option value="monthly">รายเดือน (Monthly)</option>
                      <option value="yearly">รายปี (Yearly)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{terms.depositLabel} (บาท)</label>
                    <input
                      type="number"
                      className="form-input mono"
                      value={form.deposit_amount}
                      onChange={e => handleUpdateForm('deposit_amount', Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="settings-grid">
                  <div className="form-group">
                    <label className="form-label">วันเริ่มสัญญา (เข้าใช้พื้นที่)</label>
                    <input
                      type="date"
                      className="form-input"
                      value={form.start_date}
                      onChange={e => handleUpdateForm('start_date', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">วันสิ้นสุดสัญญา</label>
                    <input
                      type="date"
                      className="form-input"
                      value={form.end_date}
                      onChange={e => handleUpdateForm('end_date', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Clauses */}
              <div className="card" style={{ padding: '1.25rem' }}>
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-gray-800)' }}>
                  📜 เงื่อนไขและข้อสัญญามาตรฐาน
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                  {form.clauses.map((clause, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-gray-400)', width: '20px' }}>
                        {idx + 1}.
                      </span>
                      <textarea
                        className="form-input"
                        rows={2}
                        style={{ flex: 1, fontSize: '0.825rem', lineHeight: 1.5 }}
                        value={clause.replace(/^\d+\.\s*/, '')}
                        onChange={e => handleClauseChange(idx, `${idx + 1}. ${e.target.value}`)}
                      />
                    </div>
                  ))}
                </div>

                <div className="form-group">
                  <label className="form-label">ข้อตกลงพิเศษเพิ่มเติม (Optional)</label>
                  <textarea
                    className="form-input"
                    rows={2}
                    value={form.custom_terms}
                    onChange={e => handleUpdateForm('custom_terms', e.target.value)}
                    placeholder="เช่น อนุญาตให้ติดป้ายไฟหน้าร้านได้, ผู้เช่าเป็นผู้รับผิดชอบค่ามิเตอร์น้ำ..."
                  />
                </div>
              </div>

              {/* Bottom Next Step Bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={handleSaveAndShareDraft}
                  disabled={isSaving}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    background: 'linear-gradient(135deg, #0A6CC2 0%, #08589F 100%)',
                    color: '#FFFFFF',
                    border: 'none',
                    padding: '0.75rem 1.25rem',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(10, 108, 194, 0.25)',
                  }}
                >
                  <Send size={15} /> บันทึก & ส่งร่างให้ผู้เช่าเซ็น
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setActiveStep('signing')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.75rem', borderRadius: '12px' }}
                >
                  ถัดไป: ไปหน้าลงลายมือชื่อ <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ═════════ STEP 2: DUAL SIGNING PAD ═════════ */}
          {activeStep === 'signing' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Signer Switcher Tabs */}
              <div style={{
                display: 'flex',
                background: 'var(--color-gray-100)',
                padding: '4px',
                borderRadius: '12px',
                maxWidth: '460px',
                margin: '0 auto',
                width: '100%'
              }}>
                <button
                  type="button"
                  onClick={() => setActiveSigner('lessee')}
                  style={{
                    flex: 1,
                    padding: '0.65rem 1rem',
                    border: 'none',
                    borderRadius: '9px',
                    background: activeSigner === 'lessee' ? '#FFFFFF' : 'transparent',
                    color: activeSigner === 'lessee' ? '#15803D' : 'var(--color-gray-600)',
                    fontWeight: activeSigner === 'lessee' ? 800 : 500,
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    boxShadow: activeSigner === 'lessee' ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem'
                  }}
                >
                  <User size={15} />
                  ฝ่าย{terms.tenantLabel}
                  {form.lessee_signature && <CheckCircle2 size={13} color="#15803D" />}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSigner('lessor')}
                  style={{
                    flex: 1,
                    padding: '0.65rem 1rem',
                    border: 'none',
                    borderRadius: '9px',
                    background: activeSigner === 'lessor' ? '#FFFFFF' : 'transparent',
                    color: activeSigner === 'lessor' ? '#08589F' : 'var(--color-gray-600)',
                    fontWeight: activeSigner === 'lessor' ? 800 : 500,
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    boxShadow: activeSigner === 'lessor' ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem'
                  }}
                >
                  <Building2 size={15} />
                  ฝ่ายผู้ให้เช่า
                  {form.lessor_signature && <CheckCircle2 size={13} color="#15803D" />}
                </button>
              </div>

              {/* Active Signer Pad */}
              {activeSigner === 'lessee' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <SignaturePad
                    label={`ลายมือชื่อฝ่าย${terms.tenantLabel} (Lessee Signature)`}
                    signerName={form.lessee_name || `ผู้เช่า / ผู้ค้า`}
                    subtitle="ใช้เมาส์ หรือนิ้วมือเพื่อลงนาม"
                    initialDataUrl={form.lessee_signature}
                    onSave={handleSaveLesseeSignature}
                    height={210}
                  />
                  {form.lessee_signed_at && (
                    <div style={{ fontSize: '0.8rem', color: '#15803D', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <CheckCircle2 size={14} /> ลงนามเมื่อ: {formatThaiDate(form.lessee_signed_at)}
                    </div>
                  )}
                </div>
              )}

              {activeSigner === 'lessor' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <SignaturePad
                    label="ลายมือชื่อฝ่ายผู้ให้เช่า (Lessor Signature)"
                    signerName={form.lessor_name || `ผู้จัดการ / ผู้ให้เช่า`}
                    subtitle="ใช้เมาส์ หรือนิ้วมือเพื่อลงนาม"
                    initialDataUrl={form.lessor_signature}
                    onSave={handleSaveLessorSignature}
                    height={210}
                  />
                  {form.lessor_signed_at && (
                    <div style={{ fontSize: '0.8rem', color: '#15803D', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <CheckCircle2 size={14} /> ลงนามเมื่อ: {formatThaiDate(form.lessor_signed_at)}
                    </div>
                  )}
                </div>
              )}

              {/* Dual Signature Summary Card */}
              <div className="card" style={{
                padding: '1.25rem',
                background: 'linear-gradient(135deg, rgba(239, 248, 242, 0.5), rgba(242, 247, 252, 0.5))',
                border: '1px solid rgba(34, 163, 90, 0.25)'
              }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-gray-800)', marginBottom: '0.75rem' }}>
                  สถานะการลงนามคู่สัญญา:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div style={{
                    padding: '0.75rem', borderRadius: '10px',
                    background: form.lessee_signature ? '#FFFFFF' : 'rgba(255,255,255,0.6)',
                    border: form.lessee_signature ? '1.5px solid #22A35A' : '1px dashed var(--color-gray-300)'
                  }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>ฝ่าย{terms.tenantLabel}</div>
                    <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-gray-800)' }}>{form.lessee_name || '—'}</div>
                    <div style={{ marginTop: '4px', fontSize: '0.75rem', color: form.lessee_signature ? '#15803D' : '#DC2626', fontWeight: 600 }}>
                      {form.lessee_signature ? '✓ ลงนามแล้ว' : '○ ยังไม่ได้ลงนาม'}
                    </div>
                  </div>

                  <div style={{
                    padding: '0.75rem', borderRadius: '10px',
                    background: form.lessor_signature ? '#FFFFFF' : 'rgba(255,255,255,0.6)',
                    border: form.lessor_signature ? '1.5px solid #22A35A' : '1px dashed var(--color-gray-300)'
                  }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>ฝ่ายผู้ให้เช่า</div>
                    <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-gray-800)' }}>{form.lessor_name || '—'}</div>
                    <div style={{ marginTop: '4px', fontSize: '0.75rem', color: form.lessor_signature ? '#15803D' : '#DC2626', fontWeight: 600 }}>
                      {form.lessor_signature ? '✓ ลงนามแล้ว' : '○ ยังไม่ได้ลงนาม'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Navigation button */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setActiveStep('details')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem', borderRadius: '12px' }}
                >
                  <ChevronLeft size={16} /> กลับไปแก้ไขข้อมูล
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={handleSaveAndShareDraft}
                    disabled={isSaving}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      background: 'linear-gradient(135deg, #0A6CC2 0%, #08589F 100%)',
                      color: '#FFFFFF',
                      border: 'none',
                      padding: '0.75rem 1.25rem',
                      borderRadius: '12px',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(10, 108, 194, 0.25)',
                    }}
                  >
                    <Send size={15} /> บันทึก & ส่งร่างให้ผู้เช่าเซ็น
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setActiveStep('preview')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.75rem', borderRadius: '12px' }}
                  >
                    ดูตัวอย่างสัญญา & บันทึก <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ═════════ STEP 3: OFFICIAL PREVIEW & EXPORT ═════════ */}
          {activeStep === 'preview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', alignItems: 'center' }}>
              
              {/* Action Ribbon */}
              <div style={{
                width: '100%',
                maxWidth: '780px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#FFFFFF',
                padding: '0.75rem 1.25rem',
                borderRadius: '12px',
                border: '1px solid var(--color-gray-200)',
                flexWrap: 'wrap',
                gap: '0.75rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setActiveStep('signing')}
                    className="btn btn-outline btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <PenTool size={14} /> แก้ไขลายเซ็น
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveStep('details')}
                    className="btn btn-outline btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <FileText size={14} /> แก้ไขข้อมูล
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={handleSaveAndShareDraft}
                    disabled={isSaving}
                    className="btn btn-sm"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      background: 'linear-gradient(135deg, #0A6CC2, #08589F)',
                      color: '#FFFFFF',
                      border: 'none',
                      fontWeight: 700,
                    }}
                    title="ส่งร่างสัญญาให้ผู้เช่าเซ็นออนไลน์"
                  >
                    <Send size={14} /> ส่งให้ผู้เช่าเซ็น
                  </button>
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="btn btn-outline btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    title="พิมพ์สัญญา"
                  >
                    <Printer size={15} /> พิมพ์
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadPDF}
                    disabled={isExporting}
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    title="ดาวน์โหลดเป็นไฟล์ PDF"
                  >
                    <Download size={15} /> {isExporting ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลด PDF'}
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveToProfile}
                    disabled={isSaving}
                    className="btn btn-primary btn-sm"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      background: 'linear-gradient(135deg, #15803D, #22A35A)',
                      border: 'none',
                      fontWeight: 700
                    }}
                    title="บันทึกสัญญาลงฐานข้อมูล"
                  >
                    <Save size={15} /> {isSaving ? 'กำลังบันทึก...' : 'บันทึกลงระบบ'}
                  </button>
                </div>
              </div>

              {/* ────────────────── A4 PAPER DOCUMENT (same page the tenant signs and the PDF) ────────────────── */}
              <div style={{ width: '100%', maxWidth: '820px' }}>
                <PaperSheet onSheet={el => { printAreaRef.current = el; }}>
                  <ContractDocument
                    c={{ ...form, verification_code: verificationCode }}
                    issuer={{
                      name: config.bill_customization?.dorm_name,
                      address: config.bill_customization?.dorm_address,
                      phone: config.bill_customization?.dorm_phone,
                      logo: config.bill_customization?.dorm_logo,
                    }}
                    unitWord={terms.unitPrefix.trim()}
                    tenantWord={terms.tenantLabel}
                  />
                </PaperSheet>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>

    {/* ── Dialog: Save as New Template ── */}
    {showSaveTemplateModal && (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(16, 42, 67, 0.65)',
          backdropFilter: 'blur(6px)',
          padding: '1rem',
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowSaveTemplateModal(false);
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '440px',
            backgroundColor: '#FFFFFF',
            borderRadius: '20px',
            padding: '1.5rem',
            boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 36, height: 36, borderRadius: '10px', background: '#E7F0FA', color: '#0A6CC2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Plus size={18} />
              </div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#102A43' }}>
                บันทึกเป็นเทมเพลตใหม่
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowSaveTemplateModal(false)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#557089' }}
            >
              <X size={18} />
            </button>
          </div>

          <p style={{ margin: 0, fontSize: '0.825rem', color: '#557089', lineHeight: 1.45 }}>
            ระบบจะบันทึกข้อกำหนด เงื่อนไข และอัตราค่าบริการของสัญญานี้ไว้ เพื่อให้ท่านสามารถเลือกใช้กับห้องหรือแผงอื่นได้อย่างสะดวกรวดเร็ว
          </p>

          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontWeight: 700, fontSize: '0.825rem' }}>
              ตั้งชื่อเทมเพลตสัญญา
            </label>
            <input
              type="text"
              className="form-input"
              autoFocus
              placeholder="เช่น สัญญาเช่าแผงตลาดรายเดือน (ค่ามัดจำ 2 เดือน)"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveNewTemplate();
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
            <button
              type="button"
              onClick={() => setShowSaveTemplateModal(false)}
              style={{
                padding: '0.625rem 1rem',
                borderRadius: '10px',
                border: '1px solid #C3D0DE',
                background: '#FFFFFF',
                color: '#3E5872',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleSaveNewTemplate}
              style={{
                padding: '0.625rem 1.25rem',
                borderRadius: '10px',
                border: 'none',
                background: 'linear-gradient(135deg, #0A6CC2, #08589F)',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(10, 108, 194, 0.25)',
              }}
            >
              บันทึกเทมเพลต
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Dialog: Share Draft to Tenant ── */}
    {showShareModal && savedContractForShare && (
      <ShareContractModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        contract={savedContractForShare}
        room={room}
        uid={uid || ''}
        buildingId={buildingId || ''}
        dormName={config.bill_customization?.dorm_name || 'HorCare'}
      />
    )}
  </>
  );
}
