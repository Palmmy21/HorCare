import { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { Expense, Vendor } from '../../types';
import { Receipt, Plus, Edit2, Trash2, Check, AlertTriangle } from 'lucide-react';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}
function fmtBaht(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const EXPENSE_CATEGORIES = ['ค่าซ่อม', 'ค่าวัสดุ', 'ค่าแรง', 'ค่าไฟ/น้ำ', 'ค่าทำความสะอาด', 'ค่าใช้จ่ายทั่วไป', 'อื่นๆ'];

type ExpenseForm = Omit<Expense, 'id' | 'created_at'>;
const EMPTY_EXPENSE: ExpenseForm = {
  date: new Date().toISOString().slice(0, 10),
  amount: 0, category: 'ค่าซ่อม', description: '', vendor_id: '', vendor_name: '', note: '',
};

interface Props { uid: string; buildingId: string; }

export default function ExpensesTab({ uid, buildingId }: Props) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseForm>(EMPTY_EXPENSE);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));

  const col = `users/${uid}/buildings/${buildingId}/expenses`;
  const vCol = `users/${uid}/buildings/${buildingId}/vendors`;

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(collection(db, col),
      snap => {
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as Expense));
        docs.sort((a, b) => b.date.localeCompare(a.date));
        setExpenses(docs);
        setLoading(false);
      },
      (err) => { console.error('expenses:', err); setLoading(false); },
    );
    return unsub;
  }, [col]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, vCol),
      snap => { setVendors(snap.docs.map(d => ({ ...d.data(), id: d.id } as Vendor))); },
      (err) => console.error('vendors (expenses tab):', err),
    );
    return unsub;
  }, [vCol]);

  const handleVendorChange = (vendorId: string) => {
    const v = vendors.find(x => x.id === vendorId);
    setForm(f => ({ ...f, vendor_id: vendorId, vendor_name: v?.name ?? '' }));
  };

  const openAdd = () => { setForm({ ...EMPTY_EXPENSE, date: new Date().toISOString().slice(0, 10) }); setEditId(null); setSaveError(''); setShowForm(true); };
  const openEdit = (e: Expense) => {
    setForm({ date: e.date, amount: e.amount, category: e.category, description: e.description, vendor_id: e.vendor_id ?? '', vendor_name: e.vendor_name ?? '', note: e.note ?? '' });
    setEditId(e.id); setSaveError(''); setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.description.trim() || form.amount <= 0) return;
    setSaving(true); setSaveError('');
    const now = new Date().toISOString();
    try {
      if (editId) {
        await updateDoc(doc(db, col, editId), { ...form, updated_at: now });
      } else {
        await addDoc(collection(db, col), { ...form, created_at: now });
      }
      setShowForm(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg.includes('permission') ? 'ไม่มีสิทธิ์บันทึก' : `บันทึกไม่สำเร็จ: ${msg}`);
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, col, id));
    setDeleteId(null);
  };

  const filtered = expenses.filter(e => e.date.startsWith(filterMonth));
  const totalFiltered = filtered.reduce((s, e) => s + e.amount, 0);
  const months = [...new Set(expenses.map(e => e.date.slice(0, 7)))].sort().reverse();

  return (
    <div>
      {/* Month picker + total */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select className="form-input" value={filterMonth}
          onChange={e => setFilterMonth(e.target.value)}
          style={{ width: 'auto' }}>
          {months.length === 0 && <option value={filterMonth}>{filterMonth}</option>}
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{
          flex: 1, background: 'linear-gradient(135deg,#4F46E5,#7C3AED)', color: '#fff',
          borderRadius: '10px', padding: '0.5rem 1rem', textAlign: 'right',
        }}>
          <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>รวมเดือนนี้</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, fontFamily: 'monospace' }}>
            ฿{fmtBaht(totalFiltered)}
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          <Plus size={15} /> เพิ่มรายจ่าย
        </button>
      </div>

      {showForm && (
        <div className="card mb-4" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', marginBottom: '1rem', color: 'var(--color-text)' }}>
            {editId ? 'แก้ไขรายจ่าย' : 'เพิ่มรายจ่าย'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              วันที่
              <input className="form-input" type="date" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                style={{ marginTop: '0.375rem', width: '100%' }} />
            </label>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              จำนวนเงิน (บาท) *
              <input className="form-input" type="number" min={0} value={form.amount || ''}
                onChange={e => setForm(f => ({ ...f, amount: +e.target.value || 0 }))}
                placeholder="0" style={{ marginTop: '0.375rem', width: '100%' }} />
            </label>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมวดหมู่
              <select className="form-input" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                style={{ marginTop: '0.375rem', width: '100%' }}>
                {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ผู้รับเหมา/ร้าน
              <select className="form-input" value={form.vendor_id}
                onChange={e => handleVendorChange(e.target.value)}
                style={{ marginTop: '0.375rem', width: '100%' }}>
                <option value="">—</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              รายละเอียด *
              <input className="form-input" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="เช่น เปลี่ยนหลอดไฟห้อง 101" style={{ marginTop: '0.375rem', width: '100%' }} />
            </label>
            <label style={{ gridColumn: '1 / -1', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมายเหตุ
              <input className="form-input" value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="เลขที่ใบเสร็จ, หมายเหตุเพิ่มเติม" style={{ marginTop: '0.375rem', width: '100%' }} />
            </label>
          </div>
          {saveError && (
            <div style={{ marginTop: '0.75rem', padding: '0.625rem 0.875rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: '8px', fontSize: '0.8125rem', color: '#DC2626', fontWeight: 600 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><AlertTriangle size={14} /> {saveError}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.625rem', marginTop: '0.75rem' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave}
              disabled={saving || !form.description.trim() || form.amount <= 0}>
              <Check size={14} /> {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>ยกเลิก</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <div className="loading-spinner" style={{ width: 32, height: 32 }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <Receipt size={48} />
          <h3>ไม่มีรายจ่ายในเดือนนี้</h3>
          <p>เพิ่มรายการค่าใช้จ่ายของหอพัก</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {filtered.map(e => (
            <div key={e.id} className="card" style={{ padding: '0.875rem 1.125rem' }}>
              {deleteId === e.id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.875rem', color: '#DC2626', fontWeight: 600, flex: 1 }}>ยืนยันลบรายการนี้?</span>
                  <button className="btn btn-sm" onClick={() => handleDelete(e.id)}
                    style={{ background: '#DC2626', color: '#fff', border: 'none' }}>ลบ</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setDeleteId(null)}>ยกเลิก</button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)' }}>{e.description}</span>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', background: 'var(--color-gray-100,#F3F4F6)', padding: '0.25rem 0.625rem', borderRadius: '6px' }}>
                          {e.category}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{fmtDate(e.date)}</span>
                        {e.vendor_name && <span style={{ fontSize: '0.875rem', color: '#4F46E5', fontWeight: 600 }}>{e.vendor_name}</span>}
                        {e.note && <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{e.note}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#DC2626', fontFamily: 'monospace' }}>
                        ฿{fmtBaht(e.amount)}
                      </div>
                    </div>
                  </div>
                  <div style={{ 
                    display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end', 
                    borderTop: '1px solid var(--color-border)', paddingTop: '0.875rem' 
                  }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(e)} title="แก้ไข"><Edit2 size={15} /></button>
                    <button className="btn btn-sm" onClick={() => setDeleteId(e.id)} title="ลบ"
                      style={{ color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
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
