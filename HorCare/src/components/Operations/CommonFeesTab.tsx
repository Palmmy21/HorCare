import { useState } from 'react';
import type { CommonFee } from '../../types';
import { Building2, Plus, Edit2, Trash2, Check, X, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';

function fmtBaht(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

type FeeForm = Omit<CommonFee, 'id' | 'created_at' | 'updated_at'>;

const EMPTY_FORM: FeeForm = {
  name: '',
  amount: 0,
  is_active: true,
  note: '',
};

interface Props {
  uid: string;
  buildingId: string;
  commonFees: CommonFee[];
  onAdd: (data: Omit<CommonFee, 'id' | 'created_at'>) => Promise<void>;
  onUpdate: (feeId: string, updates: Partial<CommonFee>) => Promise<void>;
  onDelete: (feeId: string) => Promise<void>;
}

export default function CommonFeesTab({ commonFees, onAdd, onUpdate, onDelete }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FeeForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const activeTotal = commonFees
    .filter(f => f.is_active)
    .reduce((s, f) => s + f.amount, 0);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setEditId(null);
    setSaveError('');
    setShowForm(true);
  };

  const openEdit = (fee: CommonFee) => {
    setForm({ name: fee.name, amount: fee.amount, is_active: fee.is_active, note: fee.note ?? '' });
    setEditId(fee.id);
    setSaveError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || form.amount <= 0) return;
    setSaving(true);
    setSaveError('');
    try {
      if (editId) {
        await onUpdate(editId, form);
      } else {
        await onAdd({ ...form });
      }
      setShowForm(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg.includes('permission') ? 'ไม่มีสิทธิ์บันทึก' : `บันทึกไม่สำเร็จ: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (fee: CommonFee) => {
    await onUpdate(fee.id, { is_active: !fee.is_active });
  };

  const handleDelete = async (id: string) => {
    await onDelete(id);
    setDeleteId(null);
  };

  return (
    <div>
      {/* Header card */}
      <div style={{
        background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
        borderRadius: '16px', padding: '1.25rem 1.5rem',
        marginBottom: '1.25rem', color: '#fff',
        display: 'flex', alignItems: 'center', gap: '1rem',
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: '12px',
          background: 'rgba(255,255,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Building2 size={26} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.8rem', opacity: 0.8, marginBottom: '0.2rem' }}>
            ค่าบริการส่วนกลาง (ที่เปิดใช้งาน)
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '-0.5px' }}>
            ฿{fmtBaht(activeTotal)}
          </div>
          <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.125rem' }}>
            ต่อห้อง / เดือน · {commonFees.filter(f => f.is_active).length}/{commonFees.length} รายการเปิดใช้งาน
          </div>
        </div>
        <button
          className="btn btn-sm"
          onClick={openAdd}
          style={{
            background: 'rgba(255,255,255,0.2)', border: '1.5px solid rgba(255,255,255,0.35)',
            color: '#fff', flexShrink: 0,
          }}
        >
          <Plus size={15} /> เพิ่มรายการ
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card mb-4" style={{
          padding: '1.25rem',
          border: '1.5px solid rgba(79,70,229,0.3)',
          background: 'rgba(79,70,229,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Building2 size={18} color="#4F46E5" />
            <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--color-text)', margin: 0 }}>
              {editId ? 'แก้ไขรายการส่วนกลาง' : 'เพิ่มรายการส่วนกลาง'}
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <label style={{ gridColumn: '1/-1', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ชื่อรายการ *
              <input
                className="form-input"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="เช่น ค่าอินเทอร์เน็ต, ค่าดูแลสวน"
                style={{ marginTop: '0.25rem' }}
              />
            </label>

            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              จำนวนเงิน (บาท/ห้อง) *
              <input
                className="form-input"
                type="number"
                min={0}
                value={form.amount || ''}
                onChange={e => setForm(f => ({ ...f, amount: +e.target.value || 0 }))}
                placeholder="0"
                style={{ marginTop: '0.25rem' }}
              />
            </label>

            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              สถานะ
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  background: form.is_active ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.08)',
                  border: `1.5px solid ${form.is_active ? 'rgba(16,185,129,0.35)' : 'rgba(107,114,128,0.2)'}`,
                  borderRadius: '10px', padding: '0.5rem 0.75rem',
                  color: form.is_active ? '#059669' : '#6B7280',
                  fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {form.is_active
                  ? <><ToggleRight size={18} /> เปิดใช้งาน</>
                  : <><ToggleLeft size={18} /> ปิด</>
                }
              </button>
            </label>

            <label style={{ gridColumn: '1/-1', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมายเหตุ
              <input
                className="form-input"
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="หมายเหตุเพิ่มเติม"
                style={{ marginTop: '0.25rem' }}
              />
            </label>
          </div>

          {saveError && (
            <div style={{
              marginTop: '0.75rem', padding: '0.625rem 0.875rem',
              background: '#FEE2E2', border: '1px solid #FCA5A5',
              borderRadius: '8px', fontSize: '0.8125rem', color: '#DC2626', fontWeight: 600,
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><AlertTriangle size={14} /> {saveError}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.625rem', marginTop: '0.875rem' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={saving || !form.name.trim() || form.amount <= 0}
            >
              <Check size={14} /> {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>
              <X size={14} /> ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* Fee list */}
      {commonFees.length === 0 ? (
        <div className="empty-state">
          <Building2 size={48} />
          <h3>ยังไม่มีรายการค่าส่วนกลาง</h3>
          <p>เพิ่มรายการที่ต้องเก็บจากทุกห้อง เช่น ค่าอินเทอร์เน็ต ค่าดูแลส่วนกลาง</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {/* Active items first, then inactive */}
          {[...commonFees].sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0)).map(fee => (
            <div
              key={fee.id}
              className="card"
              style={{
                padding: '0.875rem 1.125rem',
                borderLeft: `4px solid ${fee.is_active ? '#4F46E5' : '#D1D5DB'}`,
                opacity: fee.is_active ? 1 : 0.6,
                transition: 'opacity 0.2s',
              }}
            >
              {deleteId === fee.id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.875rem', color: '#DC2626', fontWeight: 600, flex: 1 }}>
                    ยืนยันลบรายการ "{fee.name}"?
                  </span>
                  <button
                    className="btn btn-sm"
                    onClick={() => handleDelete(fee.id)}
                    style={{ background: '#DC2626', color: '#fff', border: 'none' }}
                  >
                    ลบ
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setDeleteId(null)}>ยกเลิก</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text)' }}>
                        {fee.name}
                      </span>
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 700,
                        padding: '0.1rem 0.45rem', borderRadius: '5px',
                        background: fee.is_active ? 'rgba(79,70,229,0.12)' : 'rgba(107,114,128,0.1)',
                        color: fee.is_active ? '#4F46E5' : '#6B7280',
                      }}>
                        {fee.is_active ? 'เปิดใช้งาน' : 'ปิด'}
                      </span>
                    </div>
                    {fee.note && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{fee.note}</div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
                      เรียกเก็บจากทุกห้อง
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{
                      fontSize: '1.15rem', fontWeight: 800,
                      color: fee.is_active ? '#4F46E5' : '#9CA3AF',
                      fontFamily: 'monospace',
                    }}>
                      ฿{fmtBaht(fee.amount)}
                    </div>
                    <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.375rem', justifyContent: 'flex-end' }}>
                      {/* Toggle active */}
                      <button
                        className="btn btn-sm"
                        onClick={() => handleToggle(fee)}
                        title={fee.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                        style={{
                          color: fee.is_active ? '#059669' : '#6B7280',
                          background: fee.is_active ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.08)',
                          border: `1px solid ${fee.is_active ? 'rgba(16,185,129,0.25)' : 'rgba(107,114,128,0.2)'}`,
                          padding: '0.2rem 0.4rem',
                        }}
                      >
                        {fee.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => openEdit(fee)}
                        style={{ padding: '0.2rem 0.4rem' }}
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => setDeleteId(fee.id)}
                        style={{
                          color: '#DC2626', background: 'rgba(220,38,38,0.08)',
                          border: '1px solid rgba(220,38,38,0.2)', padding: '0.2rem 0.4rem',
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Total active fee info box */}
          {commonFees.some(f => f.is_active) && (
            <div style={{
              marginTop: '0.5rem', padding: '0.75rem 1rem',
              background: 'rgba(79,70,229,0.08)', border: '1px solid rgba(79,70,229,0.2)',
              borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '0.8125rem', color: '#4F46E5', fontWeight: 600 }}>
                รวมค่าส่วนกลางที่เรียกเก็บต่อห้อง
              </span>
              <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#4F46E5', fontFamily: 'monospace' }}>
                ฿{fmtBaht(activeTotal)} / เดือน
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
