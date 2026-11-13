import { useMemo, useState } from 'react';
import { Loader2, Wrench, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { MaintenanceCategory, MaintenanceRequest, Room } from '../../types';

const CATEGORIES: { id: MaintenanceCategory; label: string }[] = [
  { id: 'electric', label: 'ไฟฟ้า' }, { id: 'plumbing', label: 'ประปา' }, { id: 'ac', label: 'แอร์' },
  { id: 'appliance', label: 'เครื่องใช้ไฟฟ้า' }, { id: 'door_window', label: 'ประตู/หน้าต่าง' }, { id: 'bathroom', label: 'ห้องน้ำ' },
  { id: 'furniture', label: 'เฟอร์นิเจอร์' }, { id: 'other', label: 'อื่นๆ' },
];

type NewRequest = Pick<MaintenanceRequest, 'room_id' | 'room_number' | 'category' | 'description' | 'urgency'>;

/** The owner or front desk adds a repair themselves: a phone call, a walk-in, something seen on a round. */
export default function AddMaintenanceModal({ rooms, unitName = 'ห้อง', onAdd, onClose }: {
  rooms: Room[];
  unitName?: string;
  onAdd: (data: NewRequest) => Promise<unknown>;
  onClose: () => void;
}) {
  const sorted = useMemo(() => [...rooms].sort((a, b) => a.room_number.localeCompare(b.room_number, 'th', { numeric: true })), [rooms]);
  const [roomId, setRoomId] = useState('');
  const [category, setCategory] = useState<MaintenanceCategory>('electric');
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const room = sorted.find(r => r.id === roomId);
  const ready = !!room && description.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!room || !ready) return;
    setBusy(true);
    try {
      await onAdd({ room_id: room.id, room_number: room.room_number, category, urgency, description: description.trim().slice(0, 1000) });
      toast.success(`เพิ่มงานแจ้งซ่อม${unitName} ${room.room_number} แล้ว`);
      onClose();
    } catch (err) {
      console.error('add maintenance failed', err);
      toast.error('เพิ่มงานไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-mt-title" style={{ maxWidth: 480, width: '100%' }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 id="add-mt-title" className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Wrench size={18} /> เพิ่มงานแจ้งซ่อม</h2>
          <button type="button" className="btn-icon" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>
        </div>
        <form onSubmit={e => void submit(e)}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <label className="form-group" style={{ margin: 0 }}>
              <span className="form-label">{unitName} *</span>
              <select className="form-input" value={roomId} onChange={e => setRoomId(e.target.value)} required autoFocus>
                <option value="">— เลือก{unitName} —</option>
                {sorted.map(r => <option key={r.id} value={r.id}>{r.room_number}</option>)}
              </select>
              {sorted.length === 0 && <small style={{ color: 'var(--color-gray-500)' }}>ยังไม่มี{unitName}ในสาขานี้</small>}
            </label>
            <label className="form-group" style={{ margin: 0 }}>
              <span className="form-label">ประเภท</span>
              <select className="form-input" value={category} onChange={e => setCategory(e.target.value as MaintenanceCategory)}>
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <div className="form-group" style={{ margin: 0 }}>
              <span className="form-label">ความด่วน</span>
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem' }}>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="radio" name="mt-urgency" checked={urgency === 'normal'} onChange={() => setUrgency('normal')} /> ปกติ</label>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center', color: '#DC2626' }}><input type="radio" name="mt-urgency" checked={urgency === 'urgent'} onChange={() => setUrgency('urgent')} /> ด่วน</label>
              </div>
            </div>
            <label className="form-group" style={{ margin: 0 }}>
              <span className="form-label">อาการ / รายละเอียด *</span>
              <textarea className="form-input" rows={3} maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} required
                placeholder="เช่น แอร์ไม่เย็น มีน้ำหยด, ก๊อกอ่างล้างหน้ารั่ว" style={{ resize: 'vertical' }} />
            </label>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !ready}>
              {busy ? <Loader2 size={16} className="spin" /> : <Wrench size={16} />} เพิ่มงาน
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
