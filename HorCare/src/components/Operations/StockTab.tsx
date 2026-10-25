import { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { StockItem } from '../../types';
import { Package, Plus, Edit2, Trash2, Check, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

const STOCK_CATEGORIES = ['ไฟฟ้า', 'ประปา', 'ทั่วไป', 'ทำความสะอาด', 'เครื่องมือ', 'อะไหล่', 'อื่นๆ'];
type StockForm = Omit<StockItem, 'id' | 'created_at' | 'updated_at'>;
const EMPTY_STOCK: StockForm = { name: '', category: 'ทั่วไป', quantity: 0, unit: 'ชิ้น', min_quantity: 0, note: '' };

interface Props { uid: string; buildingId: string; }

export default function StockTab({ uid, buildingId }: Props) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<StockForm>(EMPTY_STOCK);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [adjId, setAdjId] = useState<string | null>(null);
  const [adjDelta, setAdjDelta] = useState('');

  const col = `users/${uid}/buildings/${buildingId}/stock`;

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(collection(db, col),
      snap => {
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as StockItem));
        docs.sort((a, b) => a.name.localeCompare(b.name, 'th'));
        setItems(docs);
        setLoading(false);
      },
      (err) => { console.error('stock:', err); setLoading(false); },
    );
    return unsub;
  }, [col]);

  const openAdd = () => { setForm(EMPTY_STOCK); setEditId(null); setSaveError(''); setShowForm(true); };
  const openEdit = (it: StockItem) => {
    setForm({ name: it.name, category: it.category, quantity: it.quantity, unit: it.unit, min_quantity: it.min_quantity, note: it.note ?? '' });
    setEditId(it.id); setSaveError(''); setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setSaveError('');
    const now = new Date().toISOString();
    try {
      if (editId) {
        await updateDoc(doc(db, col, editId), { ...form, updated_at: now });
      } else {
        await addDoc(collection(db, col), { ...form, created_at: now, updated_at: now });
      }
      setShowForm(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg.includes('permission') ? 'ไม่มีสิทธิ์บันทึก' : `บันทึกไม่สำเร็จ: ${msg}`);
    } finally { setSaving(false); }
  };

  const handleAdjust = async (it: StockItem) => {
    const delta = parseInt(adjDelta, 10);
    if (isNaN(delta)) return;
    const next = Math.max(0, it.quantity + delta);
    await updateDoc(doc(db, col, it.id), { quantity: next, updated_at: new Date().toISOString() });
    setAdjId(null); setAdjDelta('');
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, col, id));
    setDeleteId(null);
  };

  const lowStock = items.filter(it => it.quantity <= it.min_quantity && it.min_quantity > 0);

  return (
    <div>
      {lowStock.length > 0 && (
        <div style={{
          background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '12px',
          padding: '0.75rem 1rem', marginBottom: '1rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          fontSize: '0.875rem', color: '#D97706', fontWeight: 600,
        }}>
          <AlertTriangle size={16} />
          สต็อกใกล้หมด {lowStock.length} รายการ: {lowStock.map(it => it.name).join(', ')}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          <Plus size={15} /> เพิ่มรายการ
        </button>
      </div>

      {showForm && (
        <div className="card mb-4" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', marginBottom: '1rem', color: 'var(--color-text)' }}>
            {editId ? 'แก้ไขรายการ' : 'เพิ่มรายการสต็อก'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <label style={{ gridColumn: '1 / -1', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ชื่อรายการ *
              <input className="form-input" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="เช่น หลอด LED, ท่อ PVC" style={{ marginTop: '0.375rem', width: '100%' }} />
            </label>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมวดหมู่
              <select className="form-input" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                style={{ marginTop: '0.375rem', width: '100%' }}>
                {STOCK_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หน่วย
              <input className="form-input" value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="ชิ้น, กล่อง, เมตร" style={{ marginTop: '0.375rem', width: '100%' }} />
            </label>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              จำนวนปัจจุบัน
              <input className="form-input" type="number" min={0} value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: +e.target.value || 0 }))}
                style={{ marginTop: '0.375rem', width: '100%' }} />
            </label>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              แจ้งเตือนเมื่อเหลือ (ขั้นต่ำ)
              <input className="form-input" type="number" min={0} value={form.min_quantity}
                onChange={e => setForm(f => ({ ...f, min_quantity: +e.target.value || 0 }))}
                style={{ marginTop: '0.375rem', width: '100%' }} />
            </label>
            <label style={{ gridColumn: '1 / -1', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมายเหตุ
              <input className="form-input" value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="ยี่ห้อ, แหล่งซื้อ..." style={{ marginTop: '0.375rem', width: '100%' }} />
            </label>
          </div>
          {saveError && (
            <div style={{ marginTop: '0.75rem', padding: '0.625rem 0.875rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: '8px', fontSize: '0.8125rem', color: '#DC2626', fontWeight: 600 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><AlertTriangle size={14} /> {saveError}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.625rem', marginTop: '0.75rem' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !form.name.trim()}>
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
      ) : items.length === 0 ? (
        <div className="empty-state">
          <Package size={48} />
          <h3>ยังไม่มีรายการสต็อก</h3>
          <p>เพิ่มวัสดุ/อุปกรณ์เพื่อติดตามปริมาณ</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {items.map(it => {
            const isLow = it.min_quantity > 0 && it.quantity <= it.min_quantity;
            return (
              <div key={it.id} className="card" style={{
                padding: '1rem 1.125rem',
                border: isLow ? '1px solid #FDE68A' : undefined,
                background: isLow ? 'rgba(254,243,199,0.3)' : undefined,
              }}>
                {deleteId === it.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.875rem', color: '#DC2626', fontWeight: 600, flex: 1 }}>ยืนยันลบ "{it.name}"?</span>
                    <button className="btn btn-sm" onClick={() => handleDelete(it.id)}
                      style={{ background: '#DC2626', color: '#fff', border: 'none' }}>ลบ</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setDeleteId(null)}>ยกเลิก</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)' }}>{it.name}</span>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', background: 'var(--color-gray-100,#F3F4F6)', padding: '0.25rem 0.625rem', borderRadius: '6px' }}>
                            {it.category}
                          </span>
                          {isLow && (
                            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#D97706', background: '#FEF3C7', padding: '0.25rem 0.625rem', borderRadius: '6px' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><AlertTriangle size={14} /> ใกล้หมด</span>
                            </span>
                          )}
                        </div>
                        {it.note && <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: '0.375rem 0 0' }}>{it.note}</p>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: '1.75rem', fontWeight: 800, color: isLow ? '#D97706' : 'var(--color-text)', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                          {it.quantity}
                        </div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>{it.unit}</div>
                      </div>
                    </div>

                    <div style={{ 
                      display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end', 
                      borderTop: '1px solid var(--color-border)', paddingTop: '0.875rem' 
                    }}>
                      {adjId === it.id ? (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', width: '100%', justifyContent: 'flex-end' }}>
                          <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>ปรับจำนวน (+ หรือ -):</span>
                          <input
                            type="number"
                            value={adjDelta}
                            onChange={e => setAdjDelta(e.target.value)}
                            placeholder="เช่น 5 หรือ -2"
                            className="form-input"
                            style={{ width: 120 }}
                          />
                          <button className="btn btn-primary btn-sm" onClick={() => handleAdjust(it)} disabled={!adjDelta}>
                            <Check size={15} /> ยืนยัน
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setAdjId(null); setAdjDelta(''); }}>ยกเลิก</button>
                        </div>
                      ) : (
                        <>
                          <button className="btn btn-secondary btn-sm"
                            onClick={() => { setAdjId(it.id); setAdjDelta(''); }}>
                            <ChevronUp size={15} /> / <ChevronDown size={15} /> ปรับจำนวน
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEdit(it)} title="แก้ไข"><Edit2 size={15} /></button>
                          <button className="btn btn-sm" onClick={() => setDeleteId(it.id)} title="ลบ"
                            style={{ color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
