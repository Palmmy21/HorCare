import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Home, Loader2 } from 'lucide-react';
import horcareLogo from '../../assets/horcare_logo.png';

interface SummaryData {
  owner_name: string;
  property: string;
  fee: { type: 'percent' | 'fixed'; value: number };
  rooms: { room_number: string; occupied: boolean }[];
  months: { month: string; rent_collected: number; fee: number; payout: number; outstanding: number; paid_amount: number | null; paid_at: string | null }[];
}

const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00+07:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

/**
 * ?unit=<token>: the read-only page a unit owner opens from the link the property sent them — their rooms (let or not)
 * and, month by month, the rent collected, the management fee, what they are owed and whether it was paid.
 * No tenant names, no other rooms: the link names one owner (api/_rental-parties.ts summary).
 */
export default function UnitOwnerSummary() {
  const token = new URLSearchParams(window.location.search).get('unit') ?? '';
  const [data, setData] = useState<SummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/rental-parties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'summary', token }) })
      .then(async r => {
        if (cancelled) return;
        if (r.status === 404) { setError('ลิงก์นี้ใช้ไม่ได้แล้ว กรุณาขอลิงก์ใหม่จากที่พัก'); return; }
        if (!r.ok) { setError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่'); return; }
        setData(await r.json() as SummaryData);
      })
      .catch(() => { if (!cancelled) setError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่'); });
    return () => { cancelled = true; };
  }, [token]);

  const page: React.CSSProperties = { minHeight: '100vh', background: 'var(--color-bg, #F4F7FB)', padding: '1.5rem 1rem 3rem', fontFamily: 'var(--font-sans)', color: 'var(--color-text, #1A3350)' };
  const panel: React.CSSProperties = { background: 'var(--color-white, #fff)', border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: '1rem 1.125rem' };

  return (
    <div style={page}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={horcareLogo} alt="" style={{ width: 36, height: 36, borderRadius: 9, background: '#fff', border: '1px solid #DCE5EF', padding: 2 }} />
          <span style={{ fontWeight: 600 }}>HorCare</span>
        </div>

        {error ? <div style={{ ...panel, color: '#C62828' }}>{error}</div> : !data ? <Loader2 className="spin" aria-label="กำลังโหลด" /> : (
          <>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, color: 'var(--color-gray-900, #102A43)' }}>สรุปห้องของคุณ{data.owner_name ? ` · ${data.owner_name}` : ''}</h1>
              <p style={{ margin: '0.25rem 0 0', color: 'var(--color-text-muted, #557089)', fontSize: '0.9rem' }}>
                {data.property || 'ที่พัก'} ดูแลและปล่อยเช่าให้ · ค่าดูแล {data.fee.type === 'percent' ? `${data.fee.value}% ของค่าเช่าที่เก็บได้` : `${money(data.fee.value / 100)} บาท/ห้อง/เดือน`}
              </p>
            </div>

            <section style={panel} aria-label="ห้อง">
              <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Home size={16} aria-hidden /> ห้อง ({data.rooms.length})</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                {data.rooms.map(r => (
                  <div key={r.room_number} style={{ border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 8, padding: '0.5rem 0.75rem', background: r.occupied ? '#fff' : 'var(--color-bg, #F4F7FB)' }}>
                    <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.room_number}</div>
                    <div style={{ fontSize: '0.8rem', color: r.occupied ? 'var(--color-success, #15803D)' : 'var(--color-text-muted, #557089)' }}>{r.occupied ? 'มีผู้เช่า' : 'ว่าง'}</div>
                  </div>
                ))}
              </div>
            </section>

            <section style={panel} aria-label="ยอดรายเดือน">
              <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600 }}>ยอดที่คุณได้รับ (6 เดือนล่าสุด)</h2>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {data.months.map(m => (
                  <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.75rem 0', borderTop: '1px solid var(--color-gray-100, #EBF1F7)', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{monthLabel(m.month)}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #557089)', fontVariantNumeric: 'tabular-nums' }}>
                        เก็บค่าเช่าได้ {money(m.rent_collected)} · ค่าดูแล {money(m.fee)}{m.outstanding > 0 ? ` · ยังเก็บไม่ได้ ${money(m.outstanding)}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.125rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>฿{money(m.payout)}</div>
                      {m.paid_at
                        ? <div style={{ fontSize: '0.8rem', color: 'var(--color-success, #15803D)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={13} aria-hidden /> จ่ายแล้ว {new Date(m.paid_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</div>
                        : m.payout > 0 ? <div style={{ fontSize: '0.8rem', color: 'var(--color-warning, #C2410C)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={13} aria-hidden /> รอจ่าย</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted, #557089)' }}>นับเฉพาะค่าเช่าที่เก็บได้จริง ค่าน้ำ ค่าไฟ และค่าบริการอื่นเป็นของที่พัก · มีคำถามติดต่อ{data.property || 'ที่พัก'}</p>
          </>
        )}
      </div>
    </div>
  );
}
