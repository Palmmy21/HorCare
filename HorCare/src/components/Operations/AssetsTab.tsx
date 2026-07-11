import { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { Asset, AssetCondition, Room } from '../../types';
import { Layers, Plus, Edit2, Trash2, Check, AlertTriangle } from 'lucide-react';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}
function fmtBaht(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
      <span style={{ fontSize: '0.75rem', color: '#9CA3AF', minWidth: 72 }}>{label}</span>
      <span style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );
}

const ASSET_CATEGORIES = ['เฟอร์นิเจอร์', 'เครื่องใช้ไฟฟ้า', 'แอร์', 'ประตู/หน้าต่าง', 'ระบบน้ำ', 'ระบบไฟ', 'ส่วนกลาง', 'อื่นๆ'];
const CONDITION_CFG: Record<AssetCondition, { label: string; color: string }> = {
  good:   { label: 'ดี',           color: '#059669' },
  fair:   { label: 'พอใช้',        color: '#D97706' },
  poor:   { label: 'ทรุดโทรม',     color: '#DC2626' },
  broken: { label: 'ชำรุด/เสียหาย', color: '#9CA3AF' },
};

type AssetForm = Omit<Asset, 'id' | 'created_at'>;
const EMPTY_ASSET: AssetForm = { name: '', category: 'เฟอร์นิเจอร์', room_id: '', room_number: '', condition: 'good', purchase_date: '', purchase_price: undefined, note: '' };

interface Props { uid: string; buildingId: string; rooms: Room[]; }

export default function AssetsTab({ uid, buildingId, rooms }: Props) {
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
