import { useState, useEffect } from 'react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { Vendor, StockItem, Asset, AssetCondition, Expense } from '../../types';
import type { Room } from '../../types';
import {
  HardHat, Package, Layers, Receipt, Plus, Edit2, Trash2, Check,
  Phone, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

function fmtBaht(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ─── Shared small components ─────────────────────────────────────────────────

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
      <span style={{ fontSize: '0.75rem', color: '#9CA3AF', minWidth: 72 }}>{label}</span>
      <span style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  uid: string;
  buildingId: string;
  rooms: Room[];
}

type Tab = 'vendors' | 'stock' | 'assets' | 'expenses';

// ─── Main page ───────────────────────────────────────────────────────────────

export default function OperationsPage({ uid, buildingId, rooms }: Props) {
  const [tab, setTab] = useState<Tab>('vendors');

  const tabs: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'vendors',  label: 'ผู้รับเหมา', Icon: HardHat },
    { id: 'stock',    label: 'สต็อก',      Icon: Package },
    { id: 'assets',   label: 'ทรัพย์สิน',  Icon: Layers  },
    { id: 'expenses', label: 'ค่าใช้จ่าย', Icon: Receipt },
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">ระบบจัดการ</h1>
        <p className="page-subtitle">ผู้รับเหมา · สต็อกวัสดุ · ทรัพย์สิน · ค่าใช้จ่าย</p>
      </div>

      {/* Tab bar */}
      <div className="card mb-6" style={{ padding: '0.5rem', display: 'flex', gap: '0.25rem' }}>
        {tabs.map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: '0.625rem 0.5rem', borderRadius: '10px', cursor: 'pointer',
                border: active ? '1.5px solid var(--color-primary, #8B5CF6)' : '1.5px solid transparent',
                background: active ? 'rgba(139,92,246,0.1)' : 'none',
                color: active ? 'var(--color-primary, #8B5CF6)' : 'var(--color-text-muted, #6B7280)',
                fontWeight: active ? 700 : 500, fontSize: '0.8125rem',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem',
                transition: 'all 0.15s',
              }}
            >
              <t.Icon size={18} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'vendors'  && <VendorsTab  uid={uid} buildingId={buildingId} />}
      {tab === 'stock'    && <StockTab    uid={uid} buildingId={buildingId} />}
      {tab === 'assets'   && <AssetsTab   uid={uid} buildingId={buildingId} rooms={rooms} />}
      {tab === 'expenses' && <ExpensesTab uid={uid} buildingId={buildingId} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// VENDORS TAB
// ══════════════════════════════════════════════════════════════════════════════

const SPECIALTIES = ['ไฟฟ้า','ประปา','แอร์','ก่อสร้าง','ทั่วไป','ทำความสะอาด','อื่นๆ'];

type VendorForm = Omit<Vendor, 'id' | 'created_at'>;
const EMPTY_VENDOR: VendorForm = { name: '', phone: '', specialty: 'ทั่วไป', note: '' };

function VendorsTab({ uid, buildingId }: { uid: string; buildingId: string }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<VendorForm>(EMPTY_VENDOR);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const col = `users/${uid}/buildings/${buildingId}/vendors`;

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(collection(db, col),
      snap => {
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as Vendor));
        docs.sort((a, b) => a.name.localeCompare(b.name, 'th'));
        setVendors(docs);
        setLoading(false);
      },
      (err) => { console.error('vendors:', err); setLoading(false); },
    );
    return unsub;
  }, [col]);

  const openAdd = () => { setForm(EMPTY_VENDOR); setEditId(null); setSaveError(''); setShowForm(true); };
  const openEdit = (v: Vendor) => { setForm({ name: v.name, phone: v.phone, specialty: v.specialty, note: v.note ?? '' }); setEditId(v.id); setSaveError(''); setShowForm(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setSaveError('');
    try {
      if (editId) {
        await updateDoc(doc(db, col, editId), { ...form, updated_at: new Date().toISOString() });
      } else {
        await addDoc(collection(db, col), { ...form, created_at: new Date().toISOString() });
      }
      setShowForm(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg.includes('permission') ? 'ไม่มีสิทธิ์บันทึก — กรุณา deploy Firestore rules ก่อน' : `บันทึกไม่สำเร็จ: ${msg}`);
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, col, id));
    setDeleteId(null);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          <Plus size={15} /> เพิ่มผู้รับเหมา
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card mb-4" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', marginBottom: '1rem', color: 'var(--color-text)' }}>
            {editId ? 'แก้ไขข้อมูล' : 'เพิ่มผู้รับเหมา'}
          </h3>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ชื่อ *
              <input className="form-input" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="ชื่อผู้รับเหมา / ร้าน" style={{ marginTop: '0.25rem' }} />
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              เบอร์โทร
              <input className="form-input" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="0812345678" inputMode="tel" style={{ marginTop: '0.25rem' }} />
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ความชำนาญ
              <select className="form-input" value={form.specialty}
                onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))}
                style={{ marginTop: '0.25rem' }}>
                {SPECIALTIES.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมายเหตุ
              <textarea className="form-input" rows={2} value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="ราคา, เวลา, ข้อสังเกต..." style={{ marginTop: '0.25rem', resize: 'vertical' }} />
            </label>
          </div>
          {saveError && (
            <div style={{ marginTop: '0.75rem', padding: '0.625rem 0.875rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: '8px', fontSize: '0.8125rem', color: '#DC2626', fontWeight: 600 }}>
              ⚠️ {saveError}
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
      ) : vendors.length === 0 ? (
        <div className="empty-state">
          <HardHat size={48} />
          <h3>ยังไม่มีผู้รับเหมา</h3>
          <p>เพิ่มข้อมูลช่าง/ผู้รับเหมาที่ใช้บ่อย</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {vendors.map(v => (
            <div key={v.id} className="card" style={{ padding: '1rem 1.125rem' }}>
              {deleteId === v.id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.875rem', color: '#DC2626', fontWeight: 600, flex: 1 }}>ยืนยันลบ "{v.name}"?</span>
                  <button className="btn btn-sm" onClick={() => handleDelete(v.id)}
                    style={{ background: '#DC2626', color: '#fff', border: 'none' }}>ลบ</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setDeleteId(null)}>ยกเลิก</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '10px', flexShrink: 0,
                    background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <HardHat size={18} color="#fff" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--color-text)', marginBottom: '0.25rem' }}>
                      {v.name}
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      {v.phone && (
                        <a href={`tel:${v.phone}`} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8125rem', color: '#4F46E5', textDecoration: 'none', fontWeight: 600 }}>
                          <Phone size={13} /> {v.phone}
                        </a>
                      )}
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        {v.specialty}
                      </span>
                    </div>
                    {v.note && <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0.375rem 0 0', lineHeight: 1.5 }}>{v.note}</p>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(v)}><Edit2 size={13} /></button>
                    <button className="btn btn-sm" onClick={() => setDeleteId(v.id)}
                      style={{ color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
                      <Trash2 size={13} />
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

// ══════════════════════════════════════════════════════════════════════════════
// STOCK TAB
// ══════════════════════════════════════════════════════════════════════════════

const STOCK_CATEGORIES = ['ไฟฟ้า','ประปา','ทั่วไป','ทำความสะอาด','เครื่องมือ','อะไหล่','อื่นๆ'];
type StockForm = Omit<StockItem, 'id' | 'created_at' | 'updated_at'>;
const EMPTY_STOCK: StockForm = { name: '', category: 'ทั่วไป', quantity: 0, unit: 'ชิ้น', min_quantity: 0, note: '' };

function StockTab({ uid, buildingId }: { uid: string; buildingId: string }) {
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <label style={{ gridColumn: '1/-1', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ชื่อรายการ *
              <input className="form-input" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="เช่น หลอด LED, ท่อ PVC" style={{ marginTop: '0.25rem' }} />
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมวดหมู่
              <select className="form-input" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                style={{ marginTop: '0.25rem' }}>
                {STOCK_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หน่วย
              <input className="form-input" value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="ชิ้น, กล่อง, เมตร" style={{ marginTop: '0.25rem' }} />
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              จำนวนปัจจุบัน
              <input className="form-input" type="number" min={0} value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: +e.target.value || 0 }))}
                style={{ marginTop: '0.25rem' }} />
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              แจ้งเตือนเมื่อเหลือ (ขั้นต่ำ)
              <input className="form-input" type="number" min={0} value={form.min_quantity}
                onChange={e => setForm(f => ({ ...f, min_quantity: +e.target.value || 0 }))}
                style={{ marginTop: '0.25rem' }} />
            </label>
            <label style={{ gridColumn: '1/-1', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมายเหตุ
              <input className="form-input" value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="ยี่ห้อ, แหล่งซื้อ..." style={{ marginTop: '0.25rem' }} />
            </label>
          </div>
          {saveError && (
            <div style={{ marginTop: '0.75rem', padding: '0.625rem 0.875rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: '8px', fontSize: '0.8125rem', color: '#DC2626', fontWeight: 600 }}>
              ⚠️ {saveError}
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
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--color-text)' }}>{it.name}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', background: 'var(--color-gray-100,#F3F4F6)', padding: '0.1rem 0.4rem', borderRadius: '5px' }}>
                            {it.category}
                          </span>
                          {isLow && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#D97706', background: '#FEF3C7', padding: '0.1rem 0.4rem', borderRadius: '5px' }}>
                              ⚠️ ใกล้หมด
                            </span>
                          )}
                        </div>
                        {it.note && <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0.25rem 0 0' }}>{it.note}</p>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: isLow ? '#D97706' : 'var(--color-text)', fontFamily: 'monospace', lineHeight: 1 }}>
                          {it.quantity}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{it.unit}</div>
                      </div>
                    </div>

                    {/* Adjust quantity */}
                    {adjId === it.id ? (
                      <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>ปรับจำนวน (+ หรือ -):</span>
                        <input
                          type="number"
                          value={adjDelta}
                          onChange={e => setAdjDelta(e.target.value)}
                          placeholder="เช่น 5 หรือ -2"
                          className="form-input"
                          style={{ width: 100 }}
                        />
                        <button className="btn btn-primary btn-sm" onClick={() => handleAdjust(it)} disabled={!adjDelta}>
                          <Check size={13} /> ยืนยัน
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setAdjId(null); setAdjDelta(''); }}>ยกเลิก</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary btn-sm"
                          onClick={() => { setAdjId(it.id); setAdjDelta(''); }}>
                          <ChevronUp size={13} /> / <ChevronDown size={13} /> ปรับจำนวน
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(it)}><Edit2 size={13} /></button>
                        <button className="btn btn-sm" onClick={() => setDeleteId(it.id)}
                          style={{ color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ASSETS TAB
// ══════════════════════════════════════════════════════════════════════════════

const ASSET_CATEGORIES = ['เฟอร์นิเจอร์','เครื่องใช้ไฟฟ้า','แอร์','ประตู/หน้าต่าง','ระบบน้ำ','ระบบไฟ','ส่วนกลาง','อื่นๆ'];
const CONDITION_CFG: Record<AssetCondition, { label: string; color: string }> = {
  good:   { label: 'ดี',           color: '#059669' },
  fair:   { label: 'พอใช้',        color: '#D97706' },
  poor:   { label: 'ทรุดโทรม',     color: '#DC2626' },
  broken: { label: 'ชำรุด/เสียหาย', color: '#9CA3AF' },
};

type AssetForm = Omit<Asset, 'id' | 'created_at'>;
const EMPTY_ASSET: AssetForm = { name: '', category: 'เฟอร์นิเจอร์', room_id: '', room_number: '', condition: 'good', purchase_date: '', purchase_price: undefined, note: '' };

function AssetsTab({ uid, buildingId, rooms }: { uid: string; buildingId: string; rooms: Room[] }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<AssetForm>(EMPTY_ASSET);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const col = `users/${uid}/buildings/${buildingId}/assets`;

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(collection(db, col),
      snap => {
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as Asset));
        docs.sort((a, b) => a.name.localeCompare(b.name, 'th'));
        setAssets(docs);
        setLoading(false);
      },
      (err) => { console.error('assets:', err); setLoading(false); },
    );
    return unsub;
  }, [col]);

  const openAdd = () => { setForm(EMPTY_ASSET); setEditId(null); setSaveError(''); setShowForm(true); };
  const openEdit = (a: Asset) => {
    setForm({ name: a.name, category: a.category, room_id: a.room_id ?? '', room_number: a.room_number ?? '', condition: a.condition, purchase_date: a.purchase_date ?? '', purchase_price: a.purchase_price, note: a.note ?? '' });
    setEditId(a.id); setSaveError(''); setShowForm(true);
  };

  const handleRoomChange = (roomId: string) => {
    const room = rooms.find(r => r.id === roomId);
    setForm(f => ({ ...f, room_id: roomId, room_number: room?.room_number ?? '' }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setSaveError('');
    const now = new Date().toISOString();
    try {
      const data = { ...form, purchase_price: form.purchase_price ?? null };
      if (editId) {
        await updateDoc(doc(db, col, editId), { ...data, updated_at: now });
      } else {
        await addDoc(collection(db, col), { ...data, created_at: now });
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          <Plus size={15} /> เพิ่มทรัพย์สิน
        </button>
      </div>

      {showForm && (
        <div className="card mb-4" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', marginBottom: '1rem', color: 'var(--color-text)' }}>
            {editId ? 'แก้ไขทรัพย์สิน' : 'เพิ่มทรัพย์สิน'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <label style={{ gridColumn: '1/-1', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ชื่อทรัพย์สิน *
              <input className="form-input" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="เช่น เครื่องปรับอากาศ มิตซู, โต๊ะ" style={{ marginTop: '0.25rem' }} />
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมวดหมู่
              <select className="form-input" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                style={{ marginTop: '0.25rem' }}>
                {ASSET_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ห้อง
              <select className="form-input" value={form.room_id}
                onChange={e => handleRoomChange(e.target.value)}
                style={{ marginTop: '0.25rem' }}>
                <option value="">ส่วนกลาง</option>
                {rooms.map(r => <option key={r.id} value={r.id}>ห้อง {r.room_number}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              สภาพ
              <select className="form-input" value={form.condition}
                onChange={e => setForm(f => ({ ...f, condition: e.target.value as AssetCondition }))}
                style={{ marginTop: '0.25rem' }}>
                {(Object.keys(CONDITION_CFG) as AssetCondition[]).map(c => (
                  <option key={c} value={c}>{CONDITION_CFG[c].label}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              วันที่ซื้อ
              <input className="form-input" type="date" value={form.purchase_date}
                onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))}
                style={{ marginTop: '0.25rem' }} />
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ราคาที่ซื้อ (บาท)
              <input className="form-input" type="number" min={0} value={form.purchase_price ?? ''}
                onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value ? +e.target.value : undefined }))}
                placeholder="0" style={{ marginTop: '0.25rem' }} />
            </label>
            <label style={{ gridColumn: '1/-1', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมายเหตุ
              <textarea className="form-input" rows={2} value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="Serial no., ยี่ห้อ, รุ่น..." style={{ marginTop: '0.25rem', resize: 'vertical' }} />
            </label>
          </div>
          {saveError && (
            <div style={{ marginTop: '0.75rem', padding: '0.625rem 0.875rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: '8px', fontSize: '0.8125rem', color: '#DC2626', fontWeight: 600 }}>
              ⚠️ {saveError}
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
      ) : assets.length === 0 ? (
        <div className="empty-state">
          <Layers size={48} />
          <h3>ยังไม่มีรายการทรัพย์สิน</h3>
          <p>บันทึกครุภัณฑ์และอุปกรณ์ประจำห้องหรือส่วนกลาง</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {assets.map(a => {
            const cond = CONDITION_CFG[a.condition] ?? CONDITION_CFG.good;
            return (
              <div key={a.id} className="card" style={{ padding: '1rem 1.125rem' }}>
                {deleteId === a.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.875rem', color: '#DC2626', fontWeight: 600, flex: 1 }}>ยืนยันลบ "{a.name}"?</span>
                    <button className="btn btn-sm" onClick={() => handleDelete(a.id)}
                      style={{ background: '#DC2626', color: '#fff', border: 'none' }}>ลบ</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setDeleteId(null)}>ยกเลิก</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--color-text)' }}>{a.name}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', background: 'var(--color-gray-100,#F3F4F6)', padding: '0.1rem 0.4rem', borderRadius: '5px' }}>
                          {a.category}
                        </span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: cond.color, background: `${cond.color}18`, padding: '0.1rem 0.4rem', borderRadius: '5px' }}>
                          {cond.label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <FieldRow label="ตำแหน่ง" value={a.room_number ? `ห้อง ${a.room_number}` : 'ส่วนกลาง'} />
                        {a.purchase_date && <FieldRow label="ซื้อวันที่" value={fmtDate(a.purchase_date)} />}
                        {a.purchase_price != null && <FieldRow label="ราคา" value={`฿${fmtBaht(a.purchase_price)}`} />}
                      </div>
                      {a.note && <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0.375rem 0 0' }}>{a.note}</p>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(a)}><Edit2 size={13} /></button>
                      <button className="btn btn-sm" onClick={() => setDeleteId(a.id)}
                        style={{ color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
                        <Trash2 size={13} />
                      </button>
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

// ══════════════════════════════════════════════════════════════════════════════
// EXPENSES TAB
// ══════════════════════════════════════════════════════════════════════════════

const EXPENSE_CATEGORIES = ['ค่าซ่อม','ค่าวัสดุ','ค่าแรง','ค่าไฟ/น้ำ','ค่าทำความสะอาด','ค่าใช้จ่ายทั่วไป','อื่นๆ'];

type ExpenseForm = Omit<Expense, 'id' | 'created_at'>;
const EMPTY_EXPENSE: ExpenseForm = {
  date: new Date().toISOString().slice(0, 10),
  amount: 0, category: 'ค่าซ่อม', description: '', vendor_id: '', vendor_name: '', note: '',
};

function ExpensesTab({ uid, buildingId }: { uid: string; buildingId: string }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseForm>(EMPTY_EXPENSE);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

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

  // Build list of available months
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              วันที่
              <input className="form-input" type="date" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                style={{ marginTop: '0.25rem' }} />
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              จำนวนเงิน (บาท) *
              <input className="form-input" type="number" min={0} value={form.amount || ''}
                onChange={e => setForm(f => ({ ...f, amount: +e.target.value || 0 }))}
                placeholder="0" style={{ marginTop: '0.25rem' }} />
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมวดหมู่
              <select className="form-input" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                style={{ marginTop: '0.25rem' }}>
                {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              ผู้รับเหมา/ร้าน
              <select className="form-input" value={form.vendor_id}
                onChange={e => handleVendorChange(e.target.value)}
                style={{ marginTop: '0.25rem' }}>
                <option value="">—</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label style={{ gridColumn: '1/-1', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              รายละเอียด *
              <input className="form-input" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="เช่น เปลี่ยนหลอดไฟห้อง 101" style={{ marginTop: '0.25rem' }} />
            </label>
            <label style={{ gridColumn: '1/-1', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              หมายเหตุ
              <input className="form-input" value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="เลขที่ใบเสร็จ, หมายเหตุเพิ่มเติม" style={{ marginTop: '0.25rem' }} />
            </label>
          </div>
          {saveError && (
            <div style={{ marginTop: '0.75rem', padding: '0.625rem 0.875rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: '8px', fontSize: '0.8125rem', color: '#DC2626', fontWeight: 600 }}>
              ⚠️ {saveError}
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
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text)' }}>{e.description}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', background: 'var(--color-gray-100,#F3F4F6)', padding: '0.1rem 0.4rem', borderRadius: '5px' }}>
                        {e.category}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{fmtDate(e.date)}</span>
                      {e.vendor_name && <span style={{ fontSize: '0.8rem', color: '#4F46E5', fontWeight: 600 }}>{e.vendor_name}</span>}
                      {e.note && <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{e.note}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#DC2626', fontFamily: 'monospace' }}>
                      ฿{fmtBaht(e.amount)}
                    </div>
                    <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem', justifyContent: 'flex-end' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(e)}><Edit2 size={12} /></button>
                      <button className="btn btn-sm" onClick={() => setDeleteId(e.id)}
                        style={{ color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
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
