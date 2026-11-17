import { useState } from 'react';
import { PenTool, Trash2, Check, X, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import SignaturePad from './SignaturePad';
import type { OwnerSignatureState } from '../../hooks/useOwnerSignature';

/**
 * คลังเอกสาร → ลายเซ็นอิเล็กทรอนิกส์ของเจ้าของ. Drawn once, printed on every document. Rendered for the owner only;
 * the Firestore rules refuse any other writer, so a staff account cannot change it even outside the app.
 */
export default function OwnerSignatureCard({ state, defaultName }: { state: OwnerSignatureState; defaultName?: string }) {
  const { signature, loading, save, remove } = state;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const startEdit = () => { setDraft(''); setName(signature?.signer_name ?? defaultName ?? ''); setEditing(true); };

  const handleSave = async () => {
    if (!draft) { toast.error('วาดลายเซ็นแล้วกด "บันทึก" ในช่องลายเซ็นก่อน'); return; }
    setBusy(true);
    try {
      await save(draft, name);
      toast.success('บันทึกลายเซ็นแล้ว — จะใช้กับทุกเอกสาร');
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error && e.message === 'invalid_signature' ? 'ลายเซ็นใหญ่เกินไป ลองวาดใหม่ให้เล็กลง' : 'บันทึกไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const handleRemove = async () => {
    setBusy(true);
    try { await remove(); toast.success('ลบลายเซ็นแล้ว — เอกสารจะกลับเป็นช่องเซ็นว่าง'); }
    catch { toast.error('ลบไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <PenTool size={20} /> ลายเซ็นอิเล็กทรอนิกส์ของเจ้าของ
          </h3>
          <p className="text-muted" style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', lineHeight: 1.6 }}>
            ลงลายเซ็นครั้งเดียว ระบบจะใส่ให้ในใบแจ้งหนี้ ใบเสร็จ/บิล รายงานสรุปยอด ใบสำคัญบัญชี และใช้ลงนามฝ่ายผู้ให้เช่าในสัญญา
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#15803D', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <ShieldCheck size={14} /> แก้ไขหรือลบได้เฉพาะเจ้าของ — ผู้ดูแลใช้ได้ในเอกสารแต่แก้ไขไม่ได้
          </p>
        </div>
        {!editing && !loading && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary btn-sm" onClick={startEdit} disabled={busy}>
              <PenTool size={16} /> {signature ? 'เปลี่ยนลายเซ็น' : 'ลงลายเซ็น'}
            </button>
            {signature && (
              <button className="btn btn-outline btn-sm" onClick={handleRemove} disabled={busy} style={{ color: '#B42318' }}>
                <Trash2 size={16} /> ลบ
              </button>
            )}
          </div>
        )}
      </div>

      {!editing && (
        <div style={{ marginTop: '1rem', border: '1px dashed var(--color-gray-300, #D1D5DB)', borderRadius: 12, padding: '1rem', background: '#fff', textAlign: 'center' }}>
          {loading ? (
            <span className="text-muted">กำลังโหลด…</span>
          ) : signature ? (
            <>
              <img src={signature.image} alt="ลายเซ็นของเจ้าของ" style={{ maxHeight: 90, maxWidth: '100%', objectFit: 'contain' }} />
              <div style={{ borderTop: '1px dotted #4B5563', width: 'min(260px, 80%)', margin: '4px auto 6px' }} />
              {signature.signer_name && <div style={{ fontWeight: 600, color: '#111827' }}>( {signature.signer_name} )</div>}
              {signature.updated_at && (
                <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                  บันทึกเมื่อ {new Date(signature.updated_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              )}
            </>
          ) : (
            <span className="text-muted">ยังไม่มีลายเซ็น — เอกสารจะแสดงช่องเซ็นว่าง</span>
          )}
        </div>
      )}

      {editing && (
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.875rem', fontWeight: 600 }}>
            ชื่อใต้ลายเซ็น (ไม่บังคับ)
            <input className="form-input" value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="เช่น นายสมชาย ใจดี" />
          </label>
          <SignaturePad
            label="ลายเซ็นของเจ้าของ"
            subtitle='วาดด้วยเมาส์ หรือนิ้ว/ปากกา แล้วกด "บันทึก" ในช่องนี้'
            signerName={name || undefined}
            onSave={setDraft}
            height={200}
          />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setEditing(false)} disabled={busy}><X size={16} /> ยกเลิก</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={busy || !draft}>
              <Check size={16} /> {busy ? 'กำลังบันทึก…' : 'ใช้ลายเซ็นนี้กับทุกเอกสาร'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
