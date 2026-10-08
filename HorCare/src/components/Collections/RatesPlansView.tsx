import { useState } from 'react';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import type { CollectionsSnapshot } from '../../hooks/useCollections';
import { collectionsError } from '../../hooks/useCollections';
import {
  COLLECTION_MODES, COLLECTION_MODE_LABELS_TH, RATE_PURPOSE_LABELS_TH, RATE_UNIT_LABELS_TH, type CollectionMode, type RatePurpose, type RateUnit,
} from '../../shared/collections';
import type { CollectionStyle } from '../../types';

interface Props {
  data: CollectionsSnapshot;
  style: CollectionStyle;
  call: <T>(body: Record<string, unknown>) => Promise<T>;
  act: <T = Record<string, unknown>>(key: string, body: Record<string, unknown>, ok?: string) => Promise<T | null>;
  reload: () => void;
}

const baht = (s: number) => (s / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const field: React.CSSProperties = { padding: '0.5rem 0.6rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 8, font: 'inherit', minWidth: 0, boxSizing: 'border-box', width: '100%' };
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 12, padding: '0.75rem', background: 'var(--color-white, #fff)', display: 'flex', flexDirection: 'column', gap: 8 };
const DAY_NAMES = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export default function RatesPlansView({ data, style, call, act, reload }: Props) {
  const stall = style === 'stall';
  const purposes: RatePurpose[] = stall ? ['stall', 'walk_in'] : ['stay'];
  const [r, setR] = useState({ name: '', purpose: purposes[0], unit: (stall ? 'day' : 'night') as RateUnit, amount: '', scope: 'all', zone: '', room_id: '', valid_from: '', valid_to: '', priority: '0' });
  const [p, setP] = useState({ room_id: '', mode: 'daily_actual' as CollectionMode, unit: 'day' as 'day' | 'week', rate: '', open_days: [1, 2, 3, 4, 5, 6, 0], starts_on: data.today });
  const zones = [...new Set(data.rooms.map(x => x.zone).filter((z): z is string => !!z))];
  const planOf = new Map(data.plans.map(x => [x.room_id, x]));
  const unitsFor = (purpose: RatePurpose): RateUnit[] => (purpose === 'stay' ? ['night'] : ['day', 'week']);

  const saveRate = async () => {
    const ok = await act('rate', {
      action: 'rate_save', name: r.name, purpose: r.purpose, unit: r.unit, amount: Number(r.amount), scope: r.scope,
      zone: r.scope === 'zone' ? r.zone : undefined, room_id: r.scope === 'room' ? r.room_id : undefined,
      valid_from: r.valid_from || undefined, valid_to: r.valid_to || undefined, priority: Number(r.priority) || 0,
    }, 'บันทึกราคาแล้ว');
    if (ok) setR({ ...r, name: '', amount: '' });
  };

  const planBody = (roomId: string) => ({ action: 'plan_save', room_id: roomId, mode: p.mode, unit: p.unit, rate: p.rate ? Number(p.rate) : undefined, open_days: p.open_days, starts_on: p.starts_on });
  const applyAll = async () => {
    const todo = data.rooms.filter(x => !planOf.has(x.id));
    let done = 0;
    for (const room of todo) {
      try { await call(planBody(room.id)); done++; } catch (e) { toast.error(`แผง ${room.room_number}: ${collectionsError(e)}`); break; }
    }
    if (done) toast.success(`ตั้งแผนให้ ${done} แผงแล้ว`);
    reload();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <strong>{stall ? 'ราคาค่าแผง / ค่าที่ขาจร' : 'ราคาห้องพักต่อคืน'}</strong>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>ราคาเฉพาะห้อง มาก่อนราคาโซน และมาก่อนราคาทั่วไป · ราคาช่วงเทศกาล (ระบุวันที่) มาก่อนราคาปกติ</span>
        {data.rates.length === 0 && <span style={{ color: '#B45309' }}>ยังไม่มีราคา — เพิ่มราคาด้านล่าง ระบบจะคิดเงินให้อัตโนมัติ</span>}
        {data.rates.map(x => (
          <div key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', opacity: x.active ? 1 : 0.5 }}>
            <span style={{ flex: 1, minWidth: 180 }}>
              <strong>{x.name}</strong> · {RATE_PURPOSE_LABELS_TH[x.purpose]} {RATE_UNIT_LABELS_TH[x.unit]}
              <br /><small>{x.scope === 'all' ? 'ทุกห้อง' : x.scope === 'zone' ? `โซน ${x.zone}` : `ห้อง ${data.rooms.find(rm => rm.id === x.room_id)?.room_number ?? ''}`}{x.valid_from || x.valid_to ? ` · ${x.valid_from ?? '…'} ถึง ${x.valid_to ?? '…'}` : ''}</small>
            </span>
            <strong>฿{baht(x.amount_satang)}</strong>
            <button className="btn btn-outline btn-sm" onClick={() => void act('rt:' + x.id, { action: 'rate_save', rate_id: x.id, name: x.name, purpose: x.purpose, unit: x.unit, amount: x.amount_satang / 100, scope: x.scope, zone: x.zone ?? undefined, room_id: x.room_id ?? undefined, valid_from: x.valid_from ?? undefined, valid_to: x.valid_to ?? undefined, priority: x.priority, active: !x.active })}>{x.active ? 'ปิดใช้' : 'เปิดใช้'}</button>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
          <input style={field} placeholder="ชื่อราคา เช่น ห้องมาตรฐาน" value={r.name} onChange={e => setR({ ...r, name: e.target.value })} maxLength={80} />
          {stall && <select style={field} value={r.purpose} onChange={e => { const purpose = e.target.value as RatePurpose; setR({ ...r, purpose, unit: unitsFor(purpose)[0] }); }}>{purposes.map(x => <option key={x} value={x}>{RATE_PURPOSE_LABELS_TH[x]}</option>)}</select>}
          {stall && <select style={field} value={r.unit} onChange={e => setR({ ...r, unit: e.target.value as RateUnit })}>{unitsFor(r.purpose).map(x => <option key={x} value={x}>{RATE_UNIT_LABELS_TH[x]}</option>)}</select>}
          <input style={field} placeholder="ราคา (บาท)" inputMode="decimal" value={r.amount} onChange={e => setR({ ...r, amount: e.target.value })} />
          <select style={field} value={r.scope} onChange={e => setR({ ...r, scope: e.target.value })}><option value="all">ทุกห้อง/แผง</option><option value="zone" disabled={zones.length === 0}>เฉพาะโซน</option><option value="room">เฉพาะห้อง/แผง</option></select>
          {r.scope === 'zone' && <select style={field} value={r.zone} onChange={e => setR({ ...r, zone: e.target.value })}><option value="">เลือกโซน</option>{zones.map(z => <option key={z} value={z}>{z}</option>)}</select>}
          {r.scope === 'room' && <select style={field} value={r.room_id} onChange={e => setR({ ...r, room_id: e.target.value })}><option value="">เลือกห้อง</option>{data.rooms.map(x => <option key={x.id} value={x.id}>{x.room_number}</option>)}</select>}
          <label style={{ fontSize: '0.72rem' }}>ใช้ตั้งแต่ (ไม่บังคับ)<input style={field} type="date" value={r.valid_from} onChange={e => setR({ ...r, valid_from: e.target.value })} /></label>
          <label style={{ fontSize: '0.72rem' }}>ถึง (ไม่บังคับ)<input style={field} type="date" value={r.valid_to} onChange={e => setR({ ...r, valid_to: e.target.value })} /></label>
        </div>
        <div><button className="btn btn-primary btn-sm" disabled={r.name.trim().length < 2 || !(Number(r.amount) >= 0) || r.amount === '' || (r.scope === 'zone' && !r.zone) || (r.scope === 'room' && !r.room_id)} onClick={() => void saveRate()} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Plus size={14} /> เพิ่มราคา</button></div>
      </div>

      {stall && (
        <div style={card}>
          <strong>แผนการเก็บเงินของแต่ละแผง</strong>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>รายสัปดาห์ = เก็บล่วงหน้าทั้งสัปดาห์ (หักวันที่แผงแจ้งหยุด) · รายวัน = เก็บตามจริงเมื่อร้านมา · เว้นราคาว่างเพื่อใช้ราคาตลาดด้านบน</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
            <select style={field} value={p.room_id} onChange={e => setP({ ...p, room_id: e.target.value })}><option value="">เลือกแผง</option>{data.rooms.map(x => <option key={x.id} value={x.id}>{x.room_number}{planOf.has(x.id) ? ' (มีแผนแล้ว)' : ''}</option>)}</select>
            <select style={field} value={p.mode} onChange={e => { const mode = e.target.value as CollectionMode; setP({ ...p, mode, unit: mode === 'daily_actual' ? 'day' : p.unit }); }}>{COLLECTION_MODES.map(m => <option key={m} value={m}>{COLLECTION_MODE_LABELS_TH[m]}</option>)}</select>
            <select style={field} value={p.unit} disabled={p.mode === 'daily_actual'} onChange={e => setP({ ...p, unit: e.target.value as 'day' | 'week' })}><option value="day">คิดต่อวันที่ขาย</option><option value="week">คิดเหมาต่อสัปดาห์</option></select>
            <input style={field} placeholder="ราคาเฉพาะแผง (บาท)" inputMode="decimal" value={p.rate} onChange={e => setP({ ...p, rate: e.target.value })} />
            <label style={{ fontSize: '0.72rem' }}>เริ่มเก็บ<input style={field} type="date" value={p.starts_on} onChange={e => setP({ ...p, starts_on: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DAY_NAMES.map((n, i) => (
              <label key={n} style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                <input type="checkbox" checked={p.open_days.includes(i)} onChange={e => setP({ ...p, open_days: e.target.checked ? [...p.open_days, i] : p.open_days.filter(d => d !== i) })} />{n}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" disabled={!p.room_id || p.open_days.length === 0} onClick={() => void act('plan', planBody(p.room_id), 'บันทึกแผนแล้ว')}>บันทึกแผนของแผงนี้</button>
            <button className="btn btn-outline btn-sm" disabled={p.open_days.length === 0 || data.rooms.every(x => planOf.has(x.id))} onClick={() => void applyAll()}>ใช้กับทุกแผงที่ยังไม่มีแผน</button>
          </div>
          {data.plans.map(x => (
            <div key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 160 }}><strong>แผง {x.room_number}</strong> · {COLLECTION_MODE_LABELS_TH[x.mode]}<br /><small>เปิด {x.open_days.map(d => DAY_NAMES[d]).join(' ')} · {x.rate_satang != null ? `฿${baht(x.rate_satang)}/${x.unit === 'day' ? 'วัน' : 'สัปดาห์'}` : 'ราคาตลาด'}</small></span>
              <button className="btn btn-outline btn-sm" onClick={() => { if (window.confirm(`เลิกเก็บเงินแผง ${x.room_number}?`)) void act('end:' + x.id, { action: 'plan_end', plan_id: x.id }, 'สิ้นสุดแผนแล้ว'); }}>เลิกเก็บ</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
