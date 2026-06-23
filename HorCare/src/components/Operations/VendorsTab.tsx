import { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { Vendor } from '../../types';
import { HardHat, Plus, Edit2, Trash2, Check, Phone } from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

const SPECIALTIES = ['ไฟฟ้า', 'ประปา', 'แอร์', 'ก่อสร้าง', 'ทั่วไป', 'ทำความสะอาด', 'อื่นๆ'];

type VendorForm = Omit<Vendor, 'id' | 'created_at'>;
const EMPTY_VENDOR: VendorForm = { name: '', phone: '', specialty: 'ทั่วไป', note: '' };

interface Props { uid: string; buildingId: string; }

export default function VendorsTab({ uid, buildingId }: Props) {
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
                      {v.created_at && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          เพิ่มเมื่อ {fmtDate(v.created_at)}
                        </span>
                      )}
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
