import { useState } from 'react';
import { addDays, todayTh, WALKIN_MAX_DAYS_AHEAD } from '../../shared/market';

const ERR: Record<string, string> = {
  invalid_input: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบชื่อ เบอร์โทร และวันที่',
  already_requested: 'เบอร์นี้แจ้งวันนี้ไปแล้ว รอเจ้าหน้าที่พิจารณานะคะ',
  day_full: 'วันที่เลือกเต็มแล้ว กรุณาเลือกวันอื่น',
  not_found: 'ลิงก์นี้ไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากตลาด',
};

/** Public form (no login): a walk-in vendor tells the market the day they want to sell. Opened from ?walkin=1&uid=&bid=. */
export default function WalkInPage() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get('uid') ?? '';
  const bid = params.get('bid') ?? '';
  const today = todayTh();
  const [form, setForm] = useState({ date: today, name: '', phone: '', goods: '' });
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setState('busy');
    setError(null);
    try {
      const res = await fetch('/api/market', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'walkin_submit', owner_uid: uid, building_id: bid, ...form }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setError(ERR[data.error ?? ''] ?? 'ส่งไม่สำเร็จ กรุณาลองใหม่'); setState('idle'); return; }
      setState('done');
    } catch {
      setError('เชื่อมต่อไม่ได้ กรุณาลองใหม่'); setState('idle');
    }
  };

  const field: React.CSSProperties = { padding: '0.7rem', border: '1px solid #CBD5E1', borderRadius: 10, font: 'inherit', width: '100%', boxSizing: 'border-box' };
  const ready = form.name.trim().length >= 2 && form.phone.replace(/\D/g, '').length >= 9 && form.goods.trim().length >= 2;

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: 16, padding: '1.25rem', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 12, alignSelf: 'flex-start' }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>แจ้งเข้าขายของ (ขาจร)</h1>
        {!uid || !bid ? <p>ลิงก์ไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากตลาด</p> : state === 'done' ? (
          <p style={{ lineHeight: 1.6 }}>ส่งเรื่องเรียบร้อยแล้วค่ะ ✅<br />เจ้าหน้าที่ตลาดจะพิจารณา และติดต่อกลับที่เบอร์ {form.phone} หากมีข้อสงสัย</p>
        ) : (
          <>
            <label>วันที่ต้องการเข้าขาย<input type="date" style={field} min={today} max={addDays(today, WALKIN_MAX_DAYS_AHEAD)} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
            <input style={field} placeholder="ชื่อ-นามสกุล" maxLength={60} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input style={field} placeholder="เบอร์โทรศัพท์" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            <input style={field} placeholder="สินค้าที่จะขาย เช่น ผลไม้ เสื้อผ้า" maxLength={100} value={form.goods} onChange={e => setForm({ ...form, goods: e.target.value })} />
            {error && <div role="alert" style={{ color: '#B91C1C', fontSize: '0.9rem' }}>{error}</div>}
            <button type="button" disabled={state === 'busy' || !ready} onClick={() => void submit()}
              style={{ padding: '0.8rem', borderRadius: 12, border: 'none', background: ready ? '#0F766E' : '#94A3B8', color: '#fff', fontWeight: 700, font: 'inherit', cursor: ready ? 'pointer' : 'default' }}>
              {state === 'busy' ? 'กำลังส่ง…' : 'ส่งเรื่อง'}
            </button>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748B' }}>ข้อมูลนี้ใช้เพื่อการจัดพื้นที่ขายของตลาดเท่านั้น</p>
          </>
        )}
      </div>
    </div>
  );
}
