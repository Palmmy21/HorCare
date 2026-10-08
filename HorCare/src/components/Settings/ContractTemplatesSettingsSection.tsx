import { useState } from 'react';
import {
  FileText, Plus, Trash2, Edit3, Copy, X, ShieldCheck, Sparkles
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { DormConfig, ContractTemplate } from '../../types';
import { DEFAULT_CONTRACT_TEMPLATES } from '../../utils/contractTemplates';

interface ContractTemplatesSettingsSectionProps {
  config: DormConfig;
  onSaveConfig: (updated: DormConfig) => void;
  onUpdateTemplates?: (templates: ContractTemplate[]) => void;
}

export default function ContractTemplatesSettingsSection({
  config,
  onSaveConfig,
  onUpdateTemplates,
}: ContractTemplatesSettingsSectionProps) {
  const customTemplates = config.contract_templates || [];

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Template Editor form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'residential' | 'market_stall' | 'commercial'>('residential');
  const [formTitle, setFormTitle] = useState('');
  const [formCycle, setFormCycle] = useState<'monthly' | 'daily' | 'weekly' | 'yearly'>('monthly');
  const [formClauses, setFormClauses] = useState<string[]>([]);
  const [formCustomTerms, setFormCustomTerms] = useState('');

  // Open modal for creating new template
  const handleOpenCreate = () => {
    setEditingId(null);
    setFormName('');
    setFormType('residential');
    setFormTitle('สัญญาเช่าห้องพักและทรัพย์สิน');
    setFormCycle('monthly');
    setFormClauses([
      '1. วัตถุประสงค์: ผู้เช่าตกลงใช้สถานที่เช่านี้ตามวัตถุประสงค์ที่กำหนดไว้เท่านั้น ห้ามนำไปใช้ในทางที่ผิดกฎหมาย',
      '2. การชำระค่าเช่า: ผู้เช่าตกลงชำระค่าเช่าและค่าบริการตามกำหนดเวลาที่ระบุในสัญญา',
      '3. เงินมัดจำ/ประกัน: เงินประกันสัญญาจะได้รับคืนเมื่อสิ้นสุดสัญญาหลังจากหักค่าเสียหายหรือหนี้ค้างชำระ (ถ้ามี)',
      '4. การดูแลรักษาทรัพย์สิน: ผู้เช่าต้องดูแลรักษาทรัพย์สินให้อยู่ในสภาพเรียบร้อยและพร้อมใช้งาน',
      '5. การบอกเลิกสัญญา: ผู้ที่ประสงค์จะบอกเลิกสัญญาต้องแจ้งให้อีกฝ่ายทราบล่วงหน้าเป็นลายลักษณ์อักษร',
    ]);
    setFormCustomTerms('');
    setShowModal(true);
  };

  // Open modal for editing existing custom template
  const handleOpenEdit = (template: ContractTemplate) => {
    setEditingId(template.id);
    setFormName(template.name);
    setFormType(template.contract_type || 'residential');
    setFormTitle(template.title);
    setFormCycle(template.default_rent_cycle || 'monthly');
    setFormClauses([...template.clauses]);
    setFormCustomTerms(template.custom_terms || '');
    setShowModal(true);
  };

  // Duplicate from system preset or existing template
  const handleDuplicate = (template: ContractTemplate) => {
    setEditingId(null);
    setFormName(`${template.name} (คัดลอก)`);
    setFormType(template.contract_type || 'residential');
    setFormTitle(template.title);
    setFormCycle(template.default_rent_cycle || 'monthly');
    setFormClauses([...template.clauses]);
    setFormCustomTerms(template.custom_terms || '');
    setShowModal(true);
    toast.success(`คัดลอกเนื้อหาจาก "${template.name}" แล้ว`);
  };

  // Save template
  const handleSaveTemplate = () => {
    if (!formName.trim()) {
      toast.error('กรุณาระบุชื่อเทมเพลต');
      return;
    }
    if (!formTitle.trim()) {
      toast.error('กรุณาระบุหัวข้อสัญญา');
      return;
    }
    if (formClauses.filter(c => c.trim()).length === 0) {
      toast.error('กรุณาระบุข้อกำหนดสัญญาอย่างน้อย 1 ข้อ');
      return;
    }

    const cleanClauses = formClauses.filter(c => c.trim());

    let updatedTemplates: ContractTemplate[];

    if (editingId) {
      // Update existing
      updatedTemplates = customTemplates.map(t => {
        if (t.id === editingId) {
          return {
            ...t,
            name: formName.trim(),
            contract_type: formType,
            title: formTitle.trim(),
            default_rent_cycle: formCycle,
            clauses: cleanClauses,
            custom_terms: formCustomTerms.trim(),
            updated_at: new Date().toISOString(),
          };
        }
        return t;
      });
      toast.success(`อัปเดตเทมเพลต "${formName}" เรียบร้อยแล้ว ✨`);
    } else {
      // Create new
      const newTpl: ContractTemplate = {
        id: `tpl-user-${Date.now()}`,
        name: formName.trim(),
        contract_type: formType,
        title: formTitle.trim(),
        default_rent_cycle: formCycle,
        clauses: cleanClauses,
        custom_terms: formCustomTerms.trim(),
        created_at: new Date().toISOString(),
      };
      updatedTemplates = [...customTemplates, newTpl];
      toast.success(`สร้างเทมเพลต "${formName}" สำเร็จแล้ว 🎉`);
    }

    const updatedConfig: DormConfig = {
      ...config,
      contract_templates: updatedTemplates,
    };
    onSaveConfig(updatedConfig);
    if (onUpdateTemplates) onUpdateTemplates(updatedTemplates);
    setShowModal(false);
  };

  // Delete custom template
  const handleDeleteTemplate = (templateId: string, name: string) => {
    if (window.confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบเทมเพลต "${name}"?`)) {
      const updatedTemplates = customTemplates.filter(t => t.id !== templateId);
      const updatedConfig: DormConfig = {
        ...config,
        contract_templates: updatedTemplates,
      };
      onSaveConfig(updatedConfig);
      if (onUpdateTemplates) onUpdateTemplates(updatedTemplates);
      toast.success('ลบเทมเพลตเรียบร้อยแล้ว');
    }
  };

  // Add a clause row
  const handleAddClause = () => {
    const nextNum = formClauses.length + 1;
    setFormClauses([...formClauses, `${nextNum}. `]);
  };

  // Update clause text
  const handleClauseChange = (idx: number, text: string) => {
    const next = [...formClauses];
    next[idx] = text;
    setFormClauses(next);
  };

  // Remove clause row
  const handleRemoveClause = (idx: number) => {
    const next = formClauses.filter((_, i) => i !== idx);
    setFormClauses(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '2rem' }}>
      {/* ── Header Ribbon ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0284C7 0%, #0369A1 100%)',
          borderRadius: '20px',
          padding: '1.5rem 1.75rem',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          boxShadow: '0 8px 24px -4px rgba(2, 132, 199, 0.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.2)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FileText size={26} color="#FFFFFF" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
              เทมเพลตสัญญาเช่าดิจิทัล (Contract & E-Sign Templates)
            </h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.9)', lineHeight: 1.4 }}>
              สร้างและปรับแต่งสัญญาเช่ามาตรฐานสำหรับหอพัก แผงตลาด หรืออาคารพาณิชย์ ส่งให้ผู้เช่าเซ็นออนไลน์ได้ทันที
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleOpenCreate}
          style={{
            background: '#FFFFFF',
            color: '#0369A1',
            border: 'none',
            borderRadius: '12px',
            padding: '0.75rem 1.25rem',
            fontWeight: 800,
            fontSize: '0.9rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            transition: 'transform 0.15s',
          }}
        >
          <Plus size={18} /> สร้างเทมเพลตใหม่
        </button>
      </div>

      {/* ── Section 1: Custom Templates ── */}
      <div className="settings-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 className="settings-title" style={{ margin: 0 }}>
            <Sparkles size={18} color="#0284C7" />
            เทมเพลตที่คุณสร้างเอง ({customTemplates.length})
          </h3>
        </div>

        {customTemplates.length === 0 ? (
          <div
            style={{
              padding: '2rem',
              backgroundColor: '#F8FAFC',
              borderRadius: '16px',
              border: '1.5px dashed #CBD5E1',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: '#E0F2FE',
                color: '#0284C7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FileText size={22} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1E293B' }}>
                ยังไม่มีเทมเพลตที่กำหนดเอง
              </div>
              <div style={{ fontSize: '0.825rem', color: '#64748B', marginTop: '0.2rem' }}>
                คุณสามารถสร้างเทมเพลตใหม่ขึ้นมาเอง หรือคลิก "นำไปเป็นแม่แบบ" จากเทมเพลตมาตรฐานด้านล่างเพื่อปรับแต่ง
              </div>
            </div>
            <button
              type="button"
              onClick={handleOpenCreate}
              style={{
                background: '#0284C7',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '10px',
                padding: '0.55rem 1rem',
                fontWeight: 700,
                fontSize: '0.825rem',
                cursor: 'pointer',
                marginTop: '0.5rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <Plus size={15} /> สร้างเทมเพลตแรกของคุณ
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
            {customTemplates.map((tpl) => (
              <div
                key={tpl.id}
                style={{
                  background: '#FFFFFF',
                  borderRadius: '16px',
                  padding: '1.25rem',
                  border: '1px solid #E2E8F0',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '1rem',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span
                      style={{
                        padding: '0.2rem 0.55rem',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        background: tpl.contract_type === 'market_stall' ? '#FEF3C7' : tpl.contract_type === 'commercial' ? '#E0E7FF' : '#E0F2FE',
                        color: tpl.contract_type === 'market_stall' ? '#92400E' : tpl.contract_type === 'commercial' ? '#3730A3' : '#0369A1',
                      }}
                    >
                      {tpl.contract_type === 'market_stall' ? 'แผงค้าตลาด' : tpl.contract_type === 'commercial' ? 'พื้นที่พาณิชย์' : 'หอพัก/อพาร์ตเมนต์'}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                      {tpl.clauses.length} ข้อสัญญา
                    </span>
                  </div>

                  <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0F172A' }}>
                    {tpl.name}
                  </h4>
                  <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.25rem' }}>
                    หัวข้อ: {tpl.title}
                  </div>
                  {tpl.custom_terms && (
                    <div style={{ fontSize: '0.75rem', color: '#475569', fontStyle: 'italic', marginTop: '0.4rem', lineClamp: 2 }}>
                      * {tpl.custom_terms}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid #F1F5F9', paddingTop: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={() => handleDuplicate(tpl)}
                    style={{
                      background: 'transparent',
                      border: '1px solid #CBD5E1',
                      borderRadius: '8px',
                      padding: '0.4rem 0.65rem',
                      fontSize: '0.775rem',
                      fontWeight: 600,
                      color: '#475569',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                    title="คัดลอกเทมเพลตนี้"
                  >
                    <Copy size={13} /> คัดลอก
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(tpl)}
                    style={{
                      background: '#F0F9FF',
                      border: '1px solid #BAE6FD',
                      borderRadius: '8px',
                      padding: '0.4rem 0.75rem',
                      fontSize: '0.775rem',
                      fontWeight: 700,
                      color: '#0284C7',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    <Edit3 size={13} /> แก้ไข
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTemplate(tpl.id, tpl.name)}
                    style={{
                      background: '#FEF2F2',
                      border: '1px solid #FCA5A5',
                      borderRadius: '8px',
                      padding: '0.4rem 0.65rem',
                      fontSize: '0.775rem',
                      fontWeight: 600,
                      color: '#DC2626',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                    title="ลบเทมเพลตนี้"
                  >
                    <Trash2 size={13} /> ลบ
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 2: Built-in System Templates ── */}
      <div className="settings-section">
        <h3 className="settings-title" style={{ marginBottom: '1rem' }}>
          <ShieldCheck size={18} color="#10B981" />
          เทมเพลตมาตรฐาน HorCare (System Presets)
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {DEFAULT_CONTRACT_TEMPLATES.map((tpl) => (
            <div
              key={tpl.id}
              style={{
                background: '#F8FAFC',
                borderRadius: '16px',
                padding: '1.25rem',
                border: '1px solid #E2E8F0',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '1rem',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span
                    style={{
                      padding: '0.2rem 0.55rem',
                      borderRadius: '6px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      background: '#E2E8F0',
                      color: '#475569',
                    }}
                  >
                    มาตรฐานระบบ
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                    {tpl.clauses.length} ข้อสัญญา
                  </span>
                </div>

                <h4 style={{ margin: 0, fontSize: '0.975rem', fontWeight: 800, color: '#0F172A' }}>
                  {tpl.name}
                </h4>
                <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.25rem' }}>
                  หัวข้อ: {tpl.title}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #E2E8F0', paddingTop: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => handleDuplicate(tpl)}
                  style={{
                    background: '#FFFFFF',
                    border: '1.5px solid #BAE6FD',
                    borderRadius: '8px',
                    padding: '0.45rem 0.85rem',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: '#0284C7',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <Copy size={13} /> นำไปเป็นแม่แบบปรับแต่ง
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Modal: Create / Edit Template ── */}
      {showModal && (
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
            if (e.target === e.currentTarget) setShowModal(false);
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
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
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
                  <FileText size={20} color="#FFFFFF" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>
                    {editingId ? 'แก้ไขเทมเพลตสัญญา' : 'สร้างเทมเพลตสัญญาใหม่'}
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.85)', marginTop: '0.1rem' }}>
                    กำหนดข้อสัญญาและเงื่อนไขเริ่มต้นที่ต้องการ
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
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

            {/* Form Body */}
            <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="settings-grid">
                <div className="form-group">
                  <label className="form-label">ชื่อเทมเพลต (Template Name) *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="เช่น สัญญาแผงตลาดสดโซน A"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">ประเภทอสังหาฯ / ธุรกิจ</label>
                  <select
                    className="form-input"
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as typeof formType)}
                  >
                    <option value="residential">หอพัก / อพาร์ตเมนต์ (Residential)</option>
                    <option value="market_stall">แผงค้าและล็อกตลาด (Market Stall)</option>
                    <option value="commercial">พื้นที่และอาคารพาณิชย์ (Commercial)</option>
                  </select>
                </div>
              </div>

              <div className="settings-grid">
                <div className="form-group">
                  <label className="form-label">หัวข้อสัญญาบนหัวเอกสาร (Title) *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="เช่น สัญญาเช่าแผงค้าและล็อกจำหน่ายสินค้า"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">รอบการเก็บค่าเช่าเริ่มต้น</label>
                  <select
                    className="form-input"
                    value={formCycle}
                    onChange={(e) => setFormCycle(e.target.value as typeof formCycle)}
                  >
                    <option value="monthly">รายเดือน (Monthly)</option>
                    <option value="daily">รายวัน (Daily)</option>
                    <option value="weekly">รายสัปดาห์ (Weekly)</option>
                    <option value="yearly">รายปี (Yearly)</option>
                  </select>
                </div>
              </div>

              {/* Clauses Section */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
                  <label className="form-label" style={{ margin: 0, fontWeight: 800 }}>
                    ข้อกำหนดและเงื่อนไขสัญญา ({formClauses.length} ข้อ)
                  </label>
                  <button
                    type="button"
                    onClick={handleAddClause}
                    style={{
                      background: '#F0F9FF',
                      border: '1px solid #BAE6FD',
                      borderRadius: '8px',
                      padding: '0.35rem 0.75rem',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: '#0284C7',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    <Plus size={14} /> เพิ่มข้อสัญญา
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  {formClauses.map((clause, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748B', width: '22px', paddingTop: '0.45rem' }}>
                        {idx + 1}.
                      </span>
                      <textarea
                        className="form-input"
                        rows={2}
                        value={clause.replace(/^\d+\.\s*/, '')}
                        onChange={(e) => handleClauseChange(idx, `${idx + 1}. ${e.target.value}`)}
                        style={{ flex: 1, fontSize: '0.85rem', lineHeight: 1.5 }}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveClause(idx)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#DC2626',
                          cursor: 'pointer',
                          padding: '0.45rem',
                        }}
                        title="ลบข้อสัญญานี้"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Additional terms */}
              <div className="form-group">
                <label className="form-label">ข้อตกลงพิเศษเพิ่มเติมเริ่มต้น (Optional)</label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={formCustomTerms}
                  onChange={(e) => setFormCustomTerms(e.target.value)}
                  placeholder="เช่น ห้ามสูบบุหรี่ในบริเวณแผงค้า, ผู้เช่าต้องเปิดร้านไม่น้อยกว่า 24 วัน/เดือน..."
                />
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '1rem 1.5rem',
                backgroundColor: '#F8FAFC',
                borderTop: '1px solid #E2E8F0',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
              }}
            >
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{
                  padding: '0.65rem 1.25rem',
                  borderRadius: '12px',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#475569',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSaveTemplate}
                style={{
                  padding: '0.65rem 1.5rem',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #0284C7, #0369A1)',
                  color: '#FFFFFF',
                  fontWeight: 800,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(2, 132, 199, 0.25)',
                }}
              >
                {editingId ? 'บันทึกการแก้ไข' : 'บันทึกเทมเพลตใหม่'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
