import { useEffect, useMemo, useState } from 'react';
import AntiBot, { captchaRequired } from '../Common/AntiBot';
import { WALKIN_LOT_NOTE, WALKIN_MAX_DAYS_AHEAD, addDays, lotLabel, todayTh, type WalkInLot } from '../../shared/market';

const ERR: Record<string, string> = {
  invalid_input: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบชื่อ เบอร์โทร (เช่น 0812345678) และวันที่',
  invalid_lot: 'ล็อกที่เลือกไม่มีในตลาดนี้แล้ว กรุณาเลือกใหม่',
  already_requested: 'เบอร์นี้แจ้งวันนี้ไปแล้ว รอเจ้าหน้าที่พิจารณานะคะ',
  day_full: 'วันที่เลือกเต็มแล้ว กรุณาเลือกวันอื่น',
  not_found: 'ลิงก์นี้ใช้ไม่ได้แล้ว กรุณาสแกน QR ใหม่ที่ตลาด หรือขอลิงก์ใหม่จากเจ้าหน้าที่',
  too_many_requests: 'ส่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
  captcha_failed: 'ยืนยันตัวตนไม่ผ่าน กรุณาลองใหม่อีกครั้ง',
};

interface Info { market_name: string; date: string; lots: WalkInLot[]; requested: Record<string, number> }
interface Done { line_url: string | null; line_code: string | null; market_name: string }

const C = { ink: '#102A43', sub: '#557089', line: '#C3D0DE', bg: '#F4F7FB', green: '#06C755', warnBg: '#FFF7E6', warnLine: '#F5C26B', warnInk: '#7A4B00' };
const field: React.CSSProperties = { padding: '0.7rem', border: `1px solid ${C.line}`, borderRadius: 10, font: 'inherit', width: '100%', boxSizing: 'border-box', background: '#fff', color: C.ink };
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.9rem', fontWeight: 600, color: C.ink };

/** The lot note: a chosen lot is a wish, not a booking. Shown on the form and again on the confirmation. */
function LotNote() {
  return (
    <div role="note" style={{ background: C.warnBg, border: `1px solid ${C.warnLine}`, color: C.warnInk, borderRadius: 10, padding: '0.7rem 0.8rem', fontSize: '0.85rem', lineHeight: 1.55 }}>
      <b>📌 หมายเหตุเรื่องล็อก</b><br />{WALKIN_LOT_NOTE}
    </div>
  );
}

/** Public form (no login): a walk-in vendor tells the market the day — and the lot they would like — to sell. */
export default function WalkInPage() {
  const params = new URLSearchParams(window.location.search);
  const linkToken = params.get('walkin') ?? '';
  // the market's own scan link (?walkin=<token>), or a link printed before it (?walkin=1&uid=&bid=)
  const where = useMemo(() => linkToken.length >= 16 ? { link: linkToken } : { owner_uid: params.get('uid') ?? '', building_id: params.get('bid') ?? '' },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linkToken]);
  const validLink = 'link' in where || (!!where.owner_uid && !!where.building_id);

  const today = todayTh();
  const [form, setForm] = useState({ date: today, name: '', phone: '', goods: '', preferred_room_id: '' });
  const [info, setInfo] = useState<Info | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy'>('idle');
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trap, setTrap] = useState('');
  const [token, setToken] = useState('');

  // the market's name and lots, and how many already asked for each lot on the chosen day
  useEffect(() => {
    if (!validLink) return;
    let gone = false;
    fetch('/api/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'walkin_info', ...where, date: form.date }) })
      .then(async r => {
        const d = await r.json().catch(() => ({})) as Partial<Info> & { error?: string };
        if (gone) return;
        if (!r.ok) { setInfoError(ERR[d.error ?? ''] ?? 'โหลดข้อมูลตลาดไม่สำเร็จ กรุณาลองใหม่'); return; }
        setInfoError(null);
        setInfo({ market_name: d.market_name ?? 'ตลาด', date: d.date ?? form.date, lots: d.lots ?? [], requested: d.requested ?? {} });
      })
      .catch(() => { if (!gone) setInfoError('เชื่อมต่อไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'); });
    return () => { gone = true; };
  }, [where, validLink, form.date]);

  const zones = useMemo(() => {
    const m = new Map<string, WalkInLot[]>();
    for (const l of info?.lots ?? []) { const z = l.zone ?? 'ไม่ระบุโซน'; m.set(z, [...(m.get(z) ?? []), l]); }
    return [...m.entries()];
  }, [info]);
  const chosen = info?.lots.find(l => l.room_id === form.preferred_room_id) ?? null;
  const askedForChosen = chosen ? info?.requested[chosen.room_id] ?? 0 : 0;

  const submit = async () => {
    setState('busy');
    setError(null);
    try {
      const res = await fetch('/api/market', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'walkin_submit', ...where, ...form, preferred_room_id: form.preferred_room_id || null, website: trap, captcha_token: token }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string } & Partial<Done>;
      if (!res.ok) { setError(ERR[data.error ?? ''] ?? 'ส่งไม่สำเร็จ กรุณาลองใหม่'); setState('idle'); return; }
      setDone({ line_url: data.line_url ?? null, line_code: data.line_code ?? null, market_name: data.market_name ?? info?.market_name ?? 'ตลาด' });
    } catch {
      setError('เชื่อมต่อไม่ได้ กรุณาลองใหม่');
    }
    setState('idle');
  };

  const phoneOk = /^0\d{8,9}$/.test(form.phone.replace(/\D/g, ''));
  const ready = form.name.trim().length >= 2 && phoneOk && form.goods.trim().length >= 2 && (!captchaRequired || token !== '');
  const dayText = new Date(`${form.date}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', justifyContent: 'center', padding: '1rem', boxSizing: 'border-box', fontFamily: "'Anuphan', 'Leelawadee UI', 'Noto Sans Thai', sans-serif" }}>
      <main style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 16, padding: '1.25rem', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 14, alignSelf: 'flex-start', color: C.ink }}>
        <header>
          <div style={{ fontSize: '0.8rem', color: C.sub }}>{info?.market_name ?? (validLink && !infoError ? 'กำลังโหลด…' : '')}</div>
          <h1 style={{ margin: '2px 0 0', fontSize: '1.35rem' }}>แจ้งเข้าขายของ (ขาจร)</h1>
        </header>

        {!validLink ? <p role="alert">ลิงก์ไม่ถูกต้อง กรุณาสแกน QR ใหม่ที่ตลาด หรือขอลิงก์จากเจ้าหน้าที่</p>
          : infoError && !info ? <p role="alert" style={{ color: '#B91C1C' }}>{infoError}</p>
          : done ? (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: '#ECFDF3', border: '1px solid #A6E9C0', borderRadius: 12, padding: '0.9rem', lineHeight: 1.6 }}>
                <b>✅ ส่งคำขอเรียบร้อยแล้ว</b><br />
                วันที่ขาย: {dayText}<br />
                ล็อก: {lotLabel(chosen)}<br />
                สถานะ: รอเจ้าหน้าที่พิจารณา
              </div>
              <LotNote />
              {done.line_url ? (
                <>
                  <p style={{ margin: 0, lineHeight: 1.6 }}>
                    <b>รับผลการพิจารณาทาง LINE</b><br />
                    กดปุ่มด้านล่าง LINE จะเปิดแชทของ{done.market_name}พร้อมรหัสคำขอ — <b>กด "ส่ง"</b> เพื่อเชื่อม แล้วจะได้รับผลอนุมัติ ล็อกที่ได้ และคุยกับเจ้าหน้าที่ตลาดได้ในแชทนั้น
                  </p>
                  <a href={done.line_url} style={{ display: 'block', textAlign: 'center', padding: '0.85rem', borderRadius: 12, background: C.green, color: '#fff', fontWeight: 700, textDecoration: 'none' }}>
                    เชื่อม LINE ของ{done.market_name}
                  </a>
                  {done.line_code && <p style={{ margin: 0, fontSize: '0.8rem', color: C.sub }}>ถ้าปุ่มไม่ทำงาน: เพิ่มเพื่อน LINE ของตลาด แล้วพิมพ์รหัส <b style={{ letterSpacing: 1 }}>{done.line_code}</b> ส่งในแชท</p>}
                </>
              ) : <p style={{ margin: 0, lineHeight: 1.6 }}>เจ้าหน้าที่ตลาดจะพิจารณา และติดต่อกลับที่เบอร์ {form.phone} ค่ะ</p>}
            </section>
          ) : (
            <form onSubmit={e => { e.preventDefault(); if (ready && state !== 'busy') void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={label}>วันที่ต้องการเข้าขาย
                <input type="date" required style={field} min={today} max={addDays(today, WALKIN_MAX_DAYS_AHEAD)} value={form.date}
                  onChange={e => e.target.value && setForm({ ...form, date: e.target.value })} />
              </label>
              <label style={label}>ล็อกที่ต้องการ <span style={{ fontWeight: 400, color: C.sub, fontSize: '0.8rem' }}>(ไม่บังคับ)</span>
                <select style={field} value={form.preferred_room_id} onChange={e => setForm({ ...form, preferred_room_id: e.target.value })} disabled={!info}>
                  <option value="">ให้ตลาดจัดให้</option>
                  {zones.map(([zone, lots]) => (
                    <optgroup key={zone} label={zone}>
                      {lots.map(l => {
                        const n = info?.requested[l.room_id] ?? 0;
                        return <option key={l.room_id} value={l.room_id}>ล็อก {l.room_number}{n > 0 ? ` — มีผู้แจ้งแล้ว ${n} ราย` : ''}</option>;
                      })}
                    </optgroup>
                  ))}
                </select>
              </label>
              {askedForChosen > 0 && <div style={{ fontSize: '0.85rem', color: C.warnInk }}>ล็อกนี้มีผู้แจ้งต้องการในวันเดียวกันแล้ว {askedForChosen} ราย มีโอกาสได้ล็อกอื่นแทน</div>}
              <LotNote />
              <label style={label}>ชื่อ-นามสกุล
                <input required style={field} autoComplete="name" maxLength={60} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </label>
              <label style={label}>เบอร์โทรศัพท์
                <input required style={field} inputMode="tel" autoComplete="tel" placeholder="0812345678" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                  aria-invalid={form.phone !== '' && !phoneOk} />
                {form.phone !== '' && !phoneOk && <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#B91C1C' }}>เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0</span>}
              </label>
              <label style={label}>สินค้าที่จะขาย
                <input required style={field} placeholder="เช่น ผลไม้ เสื้อผ้า อาหารปรุงสุก" maxLength={100} value={form.goods} onChange={e => setForm({ ...form, goods: e.target.value })} />
              </label>
              <AntiBot trap={trap} onTrap={setTrap} onToken={setToken} />
              {error && <div role="alert" style={{ color: '#B91C1C', fontSize: '0.9rem' }}>{error}</div>}
              <button type="submit" disabled={state === 'busy' || !ready}
                style={{ padding: '0.85rem', borderRadius: 12, border: 'none', background: ready ? '#15803D' : '#8FA3B8', color: '#fff', fontWeight: 700, font: 'inherit', cursor: ready ? 'pointer' : 'default' }}>
                {state === 'busy' ? 'กำลังส่ง…' : 'ส่งคำขอเข้าขาย'}
              </button>
              <p style={{ margin: 0, fontSize: '0.75rem', color: C.sub }}>ข้อมูลนี้ใช้เพื่อการจัดพื้นที่ขายของตลาดและติดต่อกลับเท่านั้น</p>
            </form>
          )}
      </main>
    </div>
  );
}
