import { useCallback, useEffect, useState } from 'react';
import { BellOff } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  CLOSURE_REASONS, CLOSURE_REASON_LABELS_TH, MAX_CLOSURE_DAYS, addDays, todayTh,
  type ClosureReason, type ShopClosure,
} from '../../shared/market';

interface Props {
  uid: string;
  buildingId: string;
  roomId: string;
  Label: React.ComponentType<{ icon: React.ReactNode; label: string }>;
}

const ERR: Record<string, string> = {
  invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบวันที่ (ต้องไม่ใช่อดีต)',
  overlaps_existing: 'ช่วงวันนี้ซ้ำกับที่แจ้งไว้แล้ว',
  limit_reached: 'แจ้งหยุดล่วงหน้าได้ไม่เกิน 10 รายการ',
};
const day = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({})) as { error?: string; closures?: ShopClosure[] };
  if (!res.ok) throw new Error(data.error ?? 'failed');
  return data;
}

/** Market stalls tell the market which days they will be closed. Shown only for market workspaces. */
export default function TenantClosureSection({ uid, buildingId, roomId, Label }: Props) {
  const [items, setItems] = useState<ShopClosure[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = todayTh();
  const [form, setForm] = useState<{ from: string; to: string; reason: ClosureReason; note: string }>({ from: today, to: today, reason: 'personal', note: '' });
  const ids = { owner_uid: uid, building_id: buildingId, room_id: roomId };

  const load = useCallback(() => post({ action: 'closure_list', ...ids }).then(d => setItems(d.closures ?? [])).catch(() => undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid, buildingId, roomId]);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    setBusy(true);
    try {
      await post({ action: 'closure_submit', ...ids, from_date: form.from, to_date: form.to, reason: form.reason, note: form.note });
      toast.success('แจ้งหยุดเรียบร้อยแล้ว');
      setOpen(false);
      await load();
    } catch (e) {
      toast.error(ERR[(e as Error).message] ?? 'แจ้งไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally { setBusy(false); }
  };
  const cancel = async (id: string) => {
    if (!window.confirm('ยกเลิกการแจ้งหยุดนี้?')) return;
    try { await post({ action: 'closure_cancel', ...ids, closure_id: id }); await load(); } catch { toast.error('ยกเลิกไม่สำเร็จ'); }
  };

  const field: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid rgba(0,0,0,0.2)', borderRadius: 8, font: 'inherit', minWidth: 0, boxSizing: 'border-box' };
  return (
    <section>
      <Label icon={<BellOff size={14} />} label="แจ้งหยุดขายล่วงหน้า" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
        {items.map(c => (
          <div key={c.id} style={{ padding: '0.65rem 0.75rem', borderRadius: 12, background: 'var(--card-bg, #fff)', border: '1px solid rgba(0,0,0,0.08)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{day(c.from_date)}{c.to_date !== c.from_date ? ` – ${day(c.to_date)}` : ''}</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{CLOSURE_REASON_LABELS_TH[c.reason]}{c.ack_at ? ' · เจ้าหน้าที่รับทราบแล้ว' : ''}</div>
            </div>
            <button type="button" onClick={() => void cancel(c.id)} style={{ border: 'none', background: 'rgba(0,0,0,0.06)', borderRadius: 8, padding: '0.4rem 0.6rem', cursor: 'pointer' }}>ยกเลิก</button>
          </div>
        ))}
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} style={{ padding: '0.65rem', borderRadius: 12, border: '1px dashed rgba(0,0,0,0.3)', background: 'transparent', cursor: 'pointer', font: 'inherit' }}>+ แจ้งหยุดขาย</button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0.75rem', borderRadius: 12, border: '1px solid rgba(0,0,0,0.12)' }}>
            <label style={{ fontSize: '0.85rem' }}>ตั้งแต่วันที่ <input type="date" style={field} min={today} max={addDays(today, 365)} value={form.from} onChange={e => setForm({ ...form, from: e.target.value, to: e.target.value > form.to ? e.target.value : form.to })} /></label>
            <label style={{ fontSize: '0.85rem' }}>ถึงวันที่ <input type="date" style={field} min={form.from} max={addDays(form.from, MAX_CLOSURE_DAYS - 1)} value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} /></label>
            <select style={field} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value as ClosureReason })}>
              {CLOSURE_REASONS.map(r => <option key={r} value={r}>{CLOSURE_REASON_LABELS_TH[r]}</option>)}
            </select>
            <input style={field} placeholder="หมายเหตุ (ถ้ามี)" maxLength={200} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={busy || !form.from || !form.to} onClick={() => void submit()} style={{ flex: 1, padding: '0.6rem', borderRadius: 10, border: 'none', background: '#0F766E', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{busy ? 'กำลังส่ง…' : 'ส่งแจ้งหยุด'}</button>
              <button type="button" disabled={busy} onClick={() => setOpen(false)} style={{ padding: '0.6rem 1rem', borderRadius: 10, border: '1px solid rgba(0,0,0,0.2)', background: 'transparent', cursor: 'pointer' }}>ปิด</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
