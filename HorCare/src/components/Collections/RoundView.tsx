import { useMemo, useState } from 'react';
import { CalendarCheck, Search, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import type { CollectionsSnapshot } from '../../hooks/useCollections';
import { collectionsError, todayRoundOf } from '../../hooks/useCollections';
import { dayTotals, resolveRate, roundTotals, type Charge, type RoundRow, type RoundStatus } from '../../shared/collections';
import type { BankAccount } from '../../shared/banks';
import PayDialog from './PayDialog';
import DayClosePanel from './DayClosePanel';

interface Props {
  data: CollectionsSnapshot;
  accounts: BankAccount[];
  canClose: boolean;
  call: <T>(body: Record<string, unknown>) => Promise<T>;
  act: <T = Record<string, unknown>>(key: string, body: Record<string, unknown>, ok?: string) => Promise<T | null>;
  reload: () => void;
}

const baht = (s: number) => (s / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const STATUS_LABEL: Record<RoundStatus, string> = {
  due: 'ค้างเก็บ', partial: 'จ่ายบางส่วน', paid: 'จ่ายแล้ว', closed: 'แจ้งหยุด', absent: 'ไม่มา', not_trading: 'ไม่ได้ตั้งค่าเช่า',
  vacant: 'แผงว่าง', billed: 'เก็บผ่านบิลรายเดือน',
};
const STATUS_COLOR: Record<RoundStatus, string> = {
  due: '#DC2626', partial: '#E8740C', paid: '#15803D', closed: '#557089', absent: '#557089', not_trading: '#8FA3B8', vacant: '#8FA3B8', billed: '#557089',
};
const STATUS_BG: Partial<Record<RoundStatus, string>> = { due: '#FFF5F5', partial: '#FFF8F0', paid: '#F0FAF3' };
const MODE_LABEL = { daily_actual: 'รายวัน', weekly_advance: 'รายสัปดาห์', monthly: 'รายเดือน' } as const;
const field: React.CSSProperties = { padding: '0.7rem 0.8rem', border: '1px solid var(--color-gray-300, #C3D0DE)', borderRadius: 10, font: 'inherit', minWidth: 0, boxSizing: 'border-box', width: '100%', fontSize: '1rem' };
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: '0.75rem', background: 'var(--color-white, #fff)' };

type Filter = 'all' | 'due' | 'paid';
const collectable = (r: RoundRow) => (r.status === 'due' || r.status === 'partial' || r.status === 'vacant') && r.expected_satang > 0;

/**
 * The collector's round for today: every stall on one screen, ready from the day it is made. Tap a stall (or type its
 * number) → cash or transfer (QR to scan, photo of the slip or skip) → confirm. Built for a phone in one hand.
 */
export default function RoundView({ data, accounts, canClose, call, act, reload }: Props) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [zone, setZone] = useState<string>('');
  const [paying, setPaying] = useState<{ charge: Charge; row: RoundRow | null } | null>(null);
  const [walkIn, setWalkIn] = useState<{ name: string; amount: string } | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const rows = useMemo(() => todayRoundOf(data), [data]);
  const zones = useMemo(() => [...new Set(rows.map(r => r.zone ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th', { numeric: true })), [rows]);

  const totals = roundTotals(rows);
  const today = useMemo(() => dayTotals(data.payments, data.today), [data.payments, data.today]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(r => {
    if (zone && r.zone !== zone) return false;
    if (needle && !r.room_number.toLowerCase().includes(needle)) return false;
    if (filter === 'due') return r.status === 'due' || r.status === 'partial';
    if (filter === 'paid') return r.status === 'paid';
    return r.status !== 'not_trading' || !!needle;
  });
  const counts = { due: rows.filter(r => r.status === 'due' || r.status === 'partial').length, paid: rows.filter(r => r.status === 'paid').length };
  const unset = rows.filter(r => r.status === 'not_trading').length;

  /** Make sure the stall has today's / this week's / this month's charge (the server prices it), then take the money. */
  const collect = async (r: RoundRow) => {
    if (r.status === 'billed') { toast('แผงนี้มีบิลรายเดือนที่รวมค่าเช่าแล้ว — รับชำระที่หน้า "การชำระเงิน"'); return; }
    if (!collectable(r)) return;
    setWorking(r.room_id);
    try {
      const charge = r.charge ?? (await call<{ charge: Charge }>({ action: 'stall_charge', room_id: r.room_id, date: data.today })).charge;
      setPaying({ charge, row: r });
    } catch (e) { toast.error(collectionsError(e)); } finally { setWorking(null); }
  };
  const absent = async (r: RoundRow) => {
    setPaying(null);
    await act('absent:' + r.room_id, { action: 'stall_attendance', room_id: r.room_id, date: data.today, present: false }, `แผง ${r.room_number} ไม่มาวันนี้`);
  };

  const startWalkIn = async () => {
    if (!walkIn) return;
    const amount = Number(walkIn.amount);
    if (!(amount > 0) || walkIn.name.trim().length < 1) return;
    setWorking('walkin');
    try {
      const { charge } = await call<{ charge: Charge }>({ action: 'walk_in_charge', name: walkIn.name.trim(), amount, date: data.today });
      setWalkIn(null); setPaying({ charge, row: null }); reload();
    } catch (e) { toast.error(collectionsError(e)); } finally { setWorking(null); }
  };
  const walkInRate = resolveRate(data.rates, { purpose: 'walk_in', unit: 'day', date: data.today })?.amount_satang;
  const hasWeekly = rows.some(r => r.mode === 'weekly_advance');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ ...card, background: '#FEF2F2' }}><div style={{ fontSize: '0.75rem' }}>ค้างเก็บ ({totals.unpaid} แผง)</div><strong style={{ fontSize: '1.4rem' }}>฿{baht(totals.to_collect_satang)}</strong></div>
        <div style={{ ...card, background: '#EFF8F2' }}><div style={{ fontSize: '0.75rem' }}>เก็บได้วันนี้</div><strong style={{ fontSize: '1.4rem' }}>฿{baht(today.cash_satang + today.transfer_satang)}</strong><div style={{ fontSize: '0.7rem' }}>สด {baht(today.cash_satang)} · โอน {baht(today.transfer_satang)}</div></div>
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: 14, opacity: 0.5 }} />
        <input style={{ ...field, paddingLeft: 36 }} placeholder="พิมพ์เลขแผง เช่น A22" value={q} onChange={e => setQ(e.target.value)} inputMode="search"
          onKeyDown={e => { if (e.key === 'Enter') { const hit = shown.filter(collectable); if (hit.length === 1) void collect(hit[0]); } }} />
      </div>
      {zones.length > 1 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {['', ...zones].map(z => (
            <button key={z || 'all'} className={zone === z ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} style={{ flex: 'none' }} onClick={() => setZone(z)}>{z || 'ทุกโซน'}</button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        {([['all', `ทั้งหมด (${rows.length - unset})`], ['due', `ค้างเก็บ (${counts.due})`], ['paid', `จ่ายแล้ว (${counts.paid})`]] as const).map(([id, label]) => (
          <button key={id} className={filter === id ? 'btn btn-primary' : 'btn btn-outline'} style={{ flex: 1, padding: '0.6rem 0.25rem' }} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-outline" style={{ flex: 1, display: 'inline-flex', gap: 4, justifyContent: 'center', alignItems: 'center' }} onClick={() => setWalkIn({ name: '', amount: walkInRate ? String(walkInRate / 100) : '' })}><UserPlus size={15} /> ขาจร</button>
        {hasWeekly && (
          <button className="btn btn-outline" style={{ flex: 1, display: 'inline-flex', gap: 4, justifyContent: 'center', alignItems: 'center' }} disabled={working === 'week'}
            onClick={async () => { setWorking('week'); const r = await act<{ created: number }>('week', { action: 'week_generate', date: data.today }); setWorking(null); if (r) toast.success(r.created ? `สร้างยอดรายสัปดาห์ ${r.created} แผง` : 'ยอดสัปดาห์นี้ครบแล้ว'); }}>
            <CalendarCheck size={15} /> สร้างยอดสัปดาห์
          </button>
        )}
      </div>

      {walkIn && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong>เก็บค่าที่ขาจร</strong>
          <input style={field} placeholder="ชื่อร้าน / คนขาย" value={walkIn.name} onChange={e => setWalkIn({ ...walkIn, name: e.target.value })} maxLength={100} />
          <input style={field} placeholder="จำนวนเงิน (บาท)" inputMode="decimal" value={walkIn.amount} onChange={e => setWalkIn({ ...walkIn, amount: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" onClick={() => setWalkIn(null)}>ยกเลิก</button>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={working === 'walkin' || !walkIn.name.trim() || !(Number(walkIn.amount) > 0)} onClick={() => void startWalkIn()}>ไปรับเงิน</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 8 }}>
        {shown.map(r => {
          const tap = collectable(r) || r.status === 'billed';
          return (
            <button key={r.room_id} type="button" disabled={!tap || working === r.room_id} onClick={() => void collect(r)}
              aria-label={`แผง ${r.room_number} ${STATUS_LABEL[r.status]}${r.expected_satang ? ` ${baht(r.expected_satang)} บาท` : ''}`}
              style={{
                ...card, padding: '0.6rem 0.5rem', textAlign: 'left', cursor: tap ? 'pointer' : 'default', font: 'inherit', color: 'inherit',
                background: STATUS_BG[r.status] ?? 'var(--color-white, #fff)', borderColor: r.status === 'due' ? '#F5B5B5' : undefined, opacity: working === r.room_id ? 0.6 : 1,
                display: 'flex', flexDirection: 'column', gap: 2, minHeight: 84,
              }}>
              <span style={{ fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{r.room_number}</span>
              <span style={{ fontSize: '0.95rem', fontWeight: 700 }}>
                {r.status === 'paid' ? `฿${baht(r.paid_satang)}` : r.expected_satang > 0 ? `฿${baht(r.expected_satang)}` : '—'}
              </span>
              <span style={{ fontSize: '0.7rem', color: STATUS_COLOR[r.status], fontWeight: 700 }}>
                {STATUS_LABEL[r.status]}{r.mode && r.status !== 'not_trading' ? ` · ${MODE_LABEL[r.mode]}` : ''}
              </span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: 'var(--color-gray-500)' }}>
          {rows.length === 0 ? 'ยังไม่มีแผง — เพิ่มแผงที่หน้า "จัดการแผงค้า" แล้วแผงจะขึ้นที่นี่ทันที' : 'ไม่มีแผงในตัวกรองนี้'}
        </div>
      )}
      {unset > 0 && filter === 'all' && !needle && (
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>มี {unset} แผงที่ยังไม่ได้ใส่ค่าเช่า — ใส่ค่าเช่าที่หน้า "จัดการแผงค้า" แล้วแผงจะขึ้นให้เก็บได้ทันที</p>
      )}

      {canClose && <DayClosePanel data={data} totals={today} call={call} reload={reload} />}
      {paying && (
        <PayDialog charge={paying.charge} accounts={accounts} call={call} onDone={reload} onClose={() => setPaying(null)}
          onAbsent={paying.row && paying.row.mode === 'daily_actual' && paying.charge.paid_satang === 0 ? () => void absent(paying.row!) : undefined} />
      )}
    </div>
  );
}
