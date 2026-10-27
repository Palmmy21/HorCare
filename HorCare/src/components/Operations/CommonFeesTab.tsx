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
  charge_cycle: 'monthly',
  charge_type: 'per_room',
  charge_month: 1,
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
    setForm({ 
      name: fee.name, 
      amount: fee.amount, 
      is_active: fee.is_active,
      charge_cycle: fee.charge_cycle || 'monthly',
      charge_type: fee.charge_type || 'per_room',
      charge_month: fee.charge_month || 1,
      note: fee.note ?? '' 
    });
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
        background: 'linear-gradient(135deg, #0A6CC2, #0F4C81)',
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
          <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '-0.5px' }}>
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
          border: '1.5px solid rgba(10, 108, 194,0.3)',
          background: 'rgba(10, 108, 194,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Building2 size={18} color="#0A6CC2" />
            <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--color-text)', margin: 0 }}>
              {editId ? 'แก้ไขรายการส่วนกลาง' : 'เพิ่มรายการส่วนกลาง'}
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <label style={{ gridColumn: '1 / -1', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ชื่อรายการ *
              <input
                className="form-input"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="เช่น ค่าอินเทอร์เน็ต, ค่าดูแลสวน"
                style={{ marginTop: '0.375rem', width: '100%' }}
              />
            </label>

            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              จำนวนเงิน (บาท/ห้อง) *
              <input
                className="form-input"
                type="number"
                min={0}
                value={form.amount || ''}
                onChange={e => setForm(f => ({ ...f, amount: +e.target.value || 0 }))}
                placeholder="0"
                style={{ marginTop: '0.375rem', width: '100%' }}
              />
            </label>

            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ประเภทการเก็บ *
              <select
                className="form-input"
                value={form.charge_type || 'per_room'}
                onChange={e => setForm(f => ({ ...f, charge_type: e.target.value as 'per_room' | 'per_person' }))}
                style={{ marginTop: '0.375rem', width: '100%' }}
              >
                <option value="per_room">เหมาต่อห้อง</option>
                <option value="per_person">คิดตามจำนวนคน</option>
              </select>
            </label>

            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              รอบการเรียกเก็บ *
              <select
                className="form-input"
                value={form.charge_cycle || 'monthly'}
                onChange={e => setForm(f => ({ ...f, charge_cycle: e.target.value as 'monthly' | 'yearly' }))}
                style={{ marginTop: '0.375rem', width: '100%' }}
              >
                <option value="monthly">รายเดือน (เรียกเก็บทุกบิล)</option>
                <option value="yearly">รายปี (เรียกเก็บเฉพาะเดือนที่กำหนด)</option>
              </select>
            </label>

            {form.charge_cycle === 'yearly' && (
              <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                เดือนที่เรียกเก็บ (สำหรับรายปี) *
                <select
                  className="form-input"
                  value={form.charge_month || 1}
                  onChange={e => setForm(f => ({ ...f, charge_month: parseInt(e.target.value, 10) }))}
                  style={{ marginTop: '0.375rem', width: '100%' }}
                >
                  <option value="1">มกราคม</option>
                  <option value="2">กุมภาพันธ์</option>
                  <option value="3">มีนาคม</option>
                  <option value="4">เมษายน</option>
                  <option value="5">พฤษภาคม</option>
                  <option value="6">มิถุนายน</option>
                  <option value="7">กรกฎาคม</option>
                  <option value="8">สิงหาคม</option>
                  <option value="9">กันยายน</option>
                  <option value="10">ตุลาคม</option>
                  <option value="11">พฤศจิกายน</option>
                  <option value="12">ธันวาคม</option>
                </select>
              </label>
            )}

            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              สถานะ
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  background: form.is_active ? 'rgba(34, 163, 90,0.1)' : 'rgba(85, 112, 137,0.08)',
                  border: `1.5px solid ${form.is_active ? 'rgba(34, 163, 90,0.35)' : 'rgba(85, 112, 137,0.2)'}`,
                  borderRadius: '10px', padding: '0.625rem 0.875rem',
                  color: form.is_active ? '#15803D' : '#557089',
                  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
                  transition: 'all 0.15s',
                  width: '100%'
                }}
              >
                {form.is_active
                  ? <><ToggleRight size={18} /> เปิดใช้งาน</>
                  : <><ToggleLeft size={18} /> ปิด</>
                }
              </button>
            </label>

            <label style={{ gridColumn: '1 / -1', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมายเหตุ
              <input
                className="form-input"
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="หมายเหตุเพิ่มเติม"
                style={{ marginTop: '0.375rem', width: '100%' }}
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
                borderLeft: `4px solid ${fee.is_active ? '#0A6CC2' : '#C3D0DE'}`,
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)' }}>
                          {fee.name}
                        </span>
                        <span style={{
                          fontSize: '0.8125rem', fontWeight: 700,
                          padding: '0.25rem 0.625rem', borderRadius: '6px',
                          background: fee.is_active ? 'rgba(10, 108, 194,0.12)' : 'rgba(85, 112, 137,0.1)',
                          color: fee.is_active ? '#0A6CC2' : '#557089',
                        }}>
                          {fee.is_active ? 'เปิดใช้งาน' : 'ปิด'}
                        </span>
                      </div>
                      {fee.note && (
                        <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>{fee.note}</div>
                      )}
                      <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                        {fee.charge_type === 'per_person' ? 'เรียกเก็บรายบุคคล (ตามจำนวนผู้เช่า)' : 'เหมาต่อห้อง'}
                        {' · '}
                        {fee.charge_cycle === 'yearly' ? `รายปี (เฉพาะบิลเดือน ${fee.charge_month})` : 'รายเดือน (ทุกบิล)'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{
                        fontSize: '1.25rem', fontWeight: 800,
                        color: fee.is_active ? '#0A6CC2' : '#8FA3B8',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        ฿{fmtBaht(fee.amount)}
                      </div>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div style={{ 
                    display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end', 
                    borderTop: '1px solid var(--color-border)', paddingTop: '0.875rem' 
                  }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => handleToggle(fee)}
                      title={fee.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      style={{
                        color: fee.is_active ? '#15803D' : '#557089',
                        background: fee.is_active ? 'rgba(34, 163, 90,0.1)' : 'rgba(85, 112, 137,0.08)',
                        border: `1px solid ${fee.is_active ? 'rgba(34, 163, 90,0.25)' : 'rgba(85, 112, 137,0.2)'}`,
                      }}
                    >
                      {fee.is_active ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(fee)} title="แก้ไข">
                      <Edit2 size={15} />
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => setDeleteId(fee.id)}
                      title="ลบ"
                      style={{ color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Total active fee info box */}
          {commonFees.some(f => f.is_active) && (
            <div style={{
              marginTop: '0.5rem', padding: '0.75rem 1rem',
              background: 'rgba(10, 108, 194,0.08)', border: '1px solid rgba(10, 108, 194,0.2)',
              borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '0.8125rem', color: '#0A6CC2', fontWeight: 600 }}>
                รวมค่าส่วนกลางที่เรียกเก็บต่อห้อง
              </span>
              <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0A6CC2', fontFamily: 'var(--font-mono)' }}>
                ฿{fmtBaht(activeTotal)} / เดือน
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
