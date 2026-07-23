import { useState } from 'react';
import type { Fine, PaymentStatus, Room } from '../../types';
import toast from 'react-hot-toast';
import { AlertTriangle, Plus, Edit2, Trash2, Check, X, Filter, MessageCircle, Loader2 } from 'lucide-react';
import { auth } from '../../firebase/config';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}
function fmtBaht(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

type FineForm = Omit<Fine, 'id' | 'created_at' | 'updated_at'>;

const EMPTY_FORM: FineForm = {
  room_id: '',
  room_number: '',
  reason: '',
  amount: 0,
  date: new Date().toISOString().slice(0, 10),
  status: 'unpaid',
  note: '',
};

interface Props {
  uid: string;
  buildingId: string;
  rooms: Room[];
  fines: Fine[];
  onAdd: (data: Omit<Fine, 'id' | 'created_at'>) => Promise<void>;
  onUpdate: (fineId: string, updates: Partial<Fine>) => Promise<void>;
  onDelete: (fineId: string) => Promise<void>;
}

export default function FinesTab({ uid, buildingId, rooms, fines, onAdd, onUpdate, onDelete }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FineForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<PaymentStatus | 'all'>('all');
  const [filterRoomId, setFilterRoomId] = useState('');
  const [sendingLineId, setSendingLineId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const activeRooms = rooms.filter(r => r.is_active !== false);

  const handleRoomChange = (roomId: string) => {
    const r = activeRooms.find(x => x.id === roomId);
    setForm(f => ({ ...f, room_id: roomId, room_number: r?.room_number ?? '' }));
  };

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, date: new Date().toISOString().slice(0, 10) });
    setEditId(null);
    setSaveError('');
    setShowForm(true);
  };

  const openEdit = (f: Fine) => {
    setForm({
      room_id: f.room_id,
      room_number: f.room_number,
      reason: f.reason,
      amount: f.amount,
      date: f.date,
      status: f.status,
      note: f.note ?? '',
    });
    setEditId(f.id);
    setSaveError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.room_id || !form.reason.trim() || form.amount <= 0) return;
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

  const handleUpdateStatus = async (fineId: string, newStatus: Fine['status']) => {
    setProcessingId(fineId);
    await onUpdate(fineId, { status: newStatus });
    setProcessingId(null);
  };

  const handleDelete = async (id: string) => {
    await onDelete(id);
    setDeleteId(null);
  };

  const handleSendLine = async (fine: Fine) => {
    if (!uid || !buildingId) return;
    setSendingLineId(fine.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      
      const res = await fetch('/api/send-line-fine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ building_id: buildingId, fine_id: fine.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send LINE notification');
      toast.success('ส่งแจ้งเตือนผ่าน LINE เรียบร้อยแล้ว');
    } catch (e: any) {
      toast.error(`ไม่สามารถส่ง LINE ได้: ${e.message}`);
    } finally {
      setSendingLineId(null);
    }
  };

  const filtered = fines.filter(f => {
    if (filterStatus !== 'all' && f.status !== filterStatus) return false;
    if (filterRoomId && f.room_id !== filterRoomId) return false;
    return true;
  });

  const totalUnpaid = fines.filter(f => f.status === 'unpaid').reduce((s, f) => s + f.amount, 0);
  const totalPending = fines.filter(f => f.status === 'pending').reduce((s, f) => s + f.amount, 0);
  const totalPaid = fines.filter(f => f.status === 'paid').reduce((s, f) => s + f.amount, 0);

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{
          background: 'linear-gradient(135deg, #DC2626, #EF4444)',
          borderRadius: '14px', padding: '1rem 1.25rem', color: '#fff',
          boxShadow: '0 4px 12px rgba(220,38,38,0.2)'
        }}>
          <div style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '0.375rem' }}>ค้างชำระ</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '-0.5px' }}>
            ฿{fmtBaht(totalUnpaid)}
          </div>
          <div style={{ fontSize: '0.8125rem', opacity: 0.8, marginTop: '0.25rem' }}>
            {fines.filter(f => f.status === 'unpaid').length} รายการ
          </div>
        </div>
        <div style={{
          background: 'linear-gradient(135deg, #F59E0B, #D97706)',
          borderRadius: '14px', padding: '1rem 1.25rem', color: '#fff',
          boxShadow: '0 4px 12px rgba(245,158,11,0.2)'
        }}>
          <div style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '0.375rem' }}>รอตรวจสอบ</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '-0.5px' }}>
            ฿{fmtBaht(totalPending)}
          </div>
          <div style={{ fontSize: '0.8125rem', opacity: 0.8, marginTop: '0.25rem' }}>
            {fines.filter(f => f.status === 'pending').length} รายการ
          </div>
        </div>
        <div style={{
          background: 'linear-gradient(135deg, #059669, #10B981)',
          borderRadius: '14px', padding: '1rem 1.25rem', color: '#fff',
          boxShadow: '0 4px 12px rgba(16,185,129,0.2)'
        }}>
          <div style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '0.375rem' }}>ชำระแล้ว</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '-0.5px' }}>
            ฿{fmtBaht(totalPaid)}
          </div>
          <div style={{ fontSize: '0.8125rem', opacity: 0.8, marginTop: '0.25rem' }}>
            {fines.filter(f => f.status === 'paid').length} รายการ
          </div>
        </div>
      </div>

      {/* Filters + Add button */}
      <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={15} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        <select
          className="form-input"
          value={filterRoomId}
          onChange={e => setFilterRoomId(e.target.value)}
          style={{ width: 'auto', flex: 1, minWidth: 100 }}
        >
          <option value="">ทุกห้อง</option>
          {activeRooms.map(r => <option key={r.id} value={r.id}>ห้อง {r.room_number}</option>)}
        </select>
        <select
          className="form-input"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as PaymentStatus | 'all')}
          style={{ width: 'auto' }}
        >
          <option value="all">ทุกสถานะ</option>
          <option value="unpaid">ค้างชำระ</option>
          <option value="pending">รอตรวจสอบ</option>
          <option value="paid">ชำระแล้ว</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={openAdd} style={{ flexShrink: 0 }}>
          <Plus size={15} /> เพิ่มค่าปรับ
        </button>
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="card mb-4" style={{ padding: '1.25rem', border: '1.5px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <AlertTriangle size={18} color="#EF4444" />
            <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--color-text)', margin: 0 }}>
              {editId ? 'แก้ไขค่าปรับ' : 'เพิ่มค่าปรับ'}
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ห้อง *
              <select
                className="form-input"
                value={form.room_id}
                onChange={e => handleRoomChange(e.target.value)}
                style={{ marginTop: '0.375rem', width: '100%' }}
              >
                <option value="">— เลือกห้อง —</option>
                {activeRooms.map(r => <option key={r.id} value={r.id}>ห้อง {r.room_number}</option>)}
              </select>
            </label>

            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              วันที่
              <input
                className="form-input"
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                style={{ marginTop: '0.375rem', width: '100%' }}
              />
            </label>

            <label style={{ gridColumn: '1 / -1', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              เหตุผล / รายละเอียด *
              <input
                className="form-input"
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="เช่น ทำประตูห้องพักเสียหาย"
                style={{ marginTop: '0.375rem', width: '100%' }}
              />
            </label>

            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              จำนวนเงิน (บาท) *
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
              สถานะ
              <select
                className="form-input"
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as PaymentStatus }))}
                style={{ marginTop: '0.375rem', width: '100%' }}
              >
                <option value="unpaid">ค้างชำระ</option>
                <option value="pending">รอตรวจสอบ</option>
                <option value="paid">ชำระแล้ว</option>
              </select>
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
              disabled={saving || !form.room_id || !form.reason.trim() || form.amount <= 0}
              style={{ background: 'linear-gradient(135deg, #DC2626, #EF4444)', borderColor: 'transparent' }}
            >
              <Check size={14} /> {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>
              <X size={14} /> ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <AlertTriangle size={48} />
          <h3>ไม่มีรายการค่าปรับ</h3>
          <p>{filterStatus === 'all' && !filterRoomId ? 'กดปุ่มเพิ่มค่าปรับเพื่อเริ่มต้น' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {filtered.map(fine => (
            <div
              key={fine.id}
              className="card"
              style={{
                padding: '0.875rem 1.125rem',
                borderLeft: `4px solid ${fine.status === 'unpaid' ? '#EF4444' : fine.status === 'pending' ? '#F59E0B' : '#10B981'}`,
              }}
            >
              {deleteId === fine.id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.875rem', color: '#DC2626', fontWeight: 600, flex: 1 }}>
                    ยืนยันลบรายการนี้?
                  </span>
                  <button
                    className="btn btn-sm"
                    onClick={() => handleDelete(fine.id)}
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        {/* Room badge */}
                        <span style={{
                          background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                          color: '#fff', fontSize: '0.8125rem', fontWeight: 700,
                          padding: '0.25rem 0.625rem', borderRadius: '6px',
                        }}>
                          ห้อง {fine.room_number}
                        </span>
                        {/* Status badge */}
                        <span style={{
                          fontSize: '0.8125rem', fontWeight: 700,
                          padding: '0.25rem 0.625rem', borderRadius: '6px',
                          background: fine.status === 'unpaid' ? 'rgba(239,68,68,0.12)' : fine.status === 'pending' ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
                          color: fine.status === 'unpaid' ? '#DC2626' : fine.status === 'pending' ? '#D97706' : '#059669',
                          border: `1px solid ${fine.status === 'unpaid' ? 'rgba(239,68,68,0.3)' : fine.status === 'pending' ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}`,
                        }}>
                          {fine.status === 'unpaid' ? 'ค้างชำระ' : fine.status === 'pending' ? 'รอตรวจสอบ' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><Check size={14} /> ชำระแล้ว</span>}
                        </span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)', marginBottom: '0.375rem' }}>
                        {fine.reason}
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                        <span>{fmtDate(fine.date)}</span>
                        {fine.note && <span>· {fine.note}</span>}
                      </div>
                    </div>
                    
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{
                        fontSize: '1.25rem', fontWeight: 800,
                        color: fine.status === 'unpaid' ? '#DC2626' : fine.status === 'pending' ? '#D97706' : '#059669',
                        fontFamily: 'monospace',
                      }}>
                        ฿{fmtBaht(fine.amount)}
                      </div>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div style={{ 
                    display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end', 
                    borderTop: '1px solid var(--color-border)', paddingTop: '0.875rem' 
                  }}>
                    {fine.status !== 'paid' ? (
                      <>
                        <button
                          className="btn btn-sm"
                          onClick={() => handleSendLine(fine)}
                          disabled={sendingLineId === fine.id}
                          title="ส่งแจ้งเตือนผ่าน LINE"
                          style={{ color: '#2563EB', background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.25)' }}
                        >
                          {sendingLineId === fine.id ? <Loader2 size={15} className="spin" /> : <MessageCircle size={15} />} ส่ง LINE
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => handleUpdateStatus(fine.id, 'paid')}
                          disabled={processingId === fine.id}
                          title="ทำเครื่องหมายว่าชำระแล้ว"
                          style={{ color: '#059669', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)' }}
                        >
                          {processingId === fine.id ? <Loader2 size={15} className="spin" /> : <Check size={15} />} ชำระแล้ว
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-sm"
                        onClick={() => handleUpdateStatus(fine.id, 'unpaid')}
                        disabled={processingId === fine.id}
                        title="ย้อนกลับเป็นค้างชำระ"
                        style={{ color: '#6B7280', background: 'rgba(107,114,128,0.08)', border: '1px solid rgba(107,114,128,0.2)' }}
                      >
                        {processingId === fine.id ? <Loader2 size={15} className="spin" /> : 'ยกเลิกการชำระ'}
                      </button>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(fine)} title="แก้ไข">
                      <Edit2 size={15} />
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => setDeleteId(fine.id)}
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
        </div>
      )}
    </div>
  );
}
