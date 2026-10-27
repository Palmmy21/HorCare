import { useMemo, useState } from 'react';
import { CalendarCheck, Search, UserPlus, XCircle } from 'lucide-react';
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
const STATUS_LABEL: Record<RoundStatus, string> = { due: 'ค้างเก็บ', partial: 'จ่ายบางส่วน', paid: 'จ่ายแล้ว', closed: 'แจ้งหยุด', absent: 'ไม่มา', not_trading: 'ไม่ขายวันนี้' };
const STATUS_COLOR: Record<RoundStatus, string> = { due: '#DC2626', partial: '#E8740C', paid: '#15803D', closed: '#557089', absent: '#557089', not_trading: '#8FA3B8' };
const field: React.CSSProperties = { padding: '0.7rem 0.8rem', border: '1px solid var(--color-gray-300, #C3D0DE)', borderRadius: 10, font: 'inherit', minWidth: 0, boxSizing: 'border-box', width: '100%', fontSize: '1rem' };
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: '0.75rem', background: 'var(--color-white, #fff)' };

type Filter = 'due' | 'paid' | 'all';

/** The collector's round for today: one big row per stall, tap to collect. Built for a phone in one hand. */
export default function RoundView({ data, accounts, canClose, call, act, reload }: Props) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('due');
  const [paying, setPaying] = useState<Charge | null>(null);
  const [walkIn, setWalkIn] = useState<{ name: string; amount: string } | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const rows = useMemo(() => todayRoundOf(data), [data]);

  const totals = roundTotals(rows);
  const today = useMemo(() => dayTotals(data.payments, data.today), [data.payments, data.today]);
  const shown = rows.filter(r => {
    if (r.status === 'not_trading') return false;
    if (q && !r.room_number.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === 'due') return r.status === 'due' || r.status === 'partial';
    if (filter === 'paid') return r.status === 'paid';
    return true;
  });
  const counts = { due: rows.filter(r => r.status === 'due' || r.status === 'partial').length, paid: rows.filter(r => r.status === 'paid').length };

  /** Make sure the stall has today's/this week's charge (the server prices it), then take the money. */
  const collect = async (r: RoundRow) => {
    setWorking(r.room_id);
    try {
      const charge = r.charge ?? (await call<{ charge: Charge }>({ action: 'stall_charge', room_id: r.room_id, date: data.today })).charge;
      setPaying(charge);
    } catch (e) { toast.error(collectionsError(e)); } finally { setWorking(null); }
  };
  const absent = async (r: RoundRow) => { await act('absent:' + r.room_id, { action: 'stall_attendance', room_id: r.room_id, date: data.today, present: false }, `แผง ${r.room_number} ไม่มาวันนี้`); };

  const startWalkIn = async () => {
    if (!walkIn) return;
    const amount = Number(walkIn.amount);
    if (!(amount > 0) || walkIn.name.trim().length < 1) return;
    setWorking('walkin');
    try {
      const { charge } = await call<{ charge: Charge }>({ action: 'walk_in_charge', name: walkIn.name.trim(), amount, date: data.today });
      setWalkIn(null); setPaying(charge); reload();
    } catch (e) { toast.error(collectionsError(e)); } finally { setWorking(null); }
  };
  const walkInRate = resolveRate(data.rates, { purpose: 'walk_in', unit: 'day', date: data.today })?.amount_satang;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ ...card, background: '#FEF2F2' }}><div style={{ fontSize: '0.75rem' }}>ค้างเก็บ ({totals.unpaid} แผง)</div><strong style={{ fontSize: '1.4rem' }}>฿{baht(totals.to_collect_satang)}</strong></div>
        <div style={{ ...card, background: '#EFF8F2' }}><div style={{ fontSize: '0.75rem' }}>เก็บได้วันนี้</div><strong style={{ fontSize: '1.4rem' }}>฿{baht(today.cash_satang + today.transfer_satang)}</strong><div style={{ fontSize: '0.7rem' }}>สด {baht(today.cash_satang)} · โอน {baht(today.transfer_satang)}</div></div>
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: 14, opacity: 0.5 }} />
        <input style={{ ...field, paddingLeft: 36 }} placeholder="ค้นหาเลขแผง" value={q} onChange={e => setQ(e.target.value)} inputMode="search" />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {([['due', `ค้างเก็บ (${counts.due})`], ['paid', `จ่ายแล้ว (${counts.paid})`], ['all', 'ทั้งหมด']] as const).map(([id, label]) => (
          <button key={id} className={filter === id ? 'btn btn-primary' : 'btn btn-outline'} style={{ flex: 1, padding: '0.6rem 0.25rem' }} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-outline" style={{ flex: 1, display: 'inline-flex', gap: 4, justifyContent: 'center', alignItems: 'center' }} onClick={() => setWalkIn({ name: '', amount: walkInRate ? String(walkInRate / 100) : '' })}><UserPlus size={15} /> ขาจร</button>
        <button className="btn btn-outline" style={{ flex: 1, display: 'inline-flex', gap: 4, justifyContent: 'center', alignItems: 'center' }} disabled={working === 'week'}
          onClick={async () => { setWorking('week'); const r = await act<{ created: number }>('week', { action: 'week_generate', date: data.today }); setWorking(null); if (r) toast.success(r.created ? `สร้างยอดรายสัปดาห์ ${r.created} แผง` : 'ยอดสัปดาห์นี้ครบแล้ว'); }}>
          <CalendarCheck size={15} /> สร้างยอดสัปดาห์
        </button>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map(r => {
          const canCollect = r.status === 'due' || r.status === 'partial';
          return (
            <div key={r.room_id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{r.room_number}</div>
                <div style={{ fontSize: '0.78rem', color: STATUS_COLOR[r.status], fontWeight: 700 }}>{STATUS_LABEL[r.status]}{r.mode === 'weekly_advance' ? ' · รายสัปดาห์' : r.mode === 'daily_actual' ? ' · รายวัน' : ''}</div>
              </div>
              {canCollect && (
                <>
                  {r.mode === 'daily_actual' && <button className="btn btn-outline" aria-label={`แผง ${r.room_number} ไม่มา`} onClick={() => void absent(r)} style={{ padding: '0.7rem' }}><XCircle size={18} /></button>}
                  <button className="btn btn-primary" disabled={working === r.room_id || r.expected_satang <= 0} onClick={() => void collect(r)} style={{ padding: '0.8rem 1rem', fontSize: '1.05rem', minWidth: 110 }}>
                    เก็บ ฿{baht(r.expected_satang)}
                  </button>
                </>
              )}
              {r.status === 'paid' && <strong style={{ color: '#15803D' }}>฿{baht(r.paid_satang)}</strong>}
            </div>
          );
        })}
        {shown.length === 0 && <div style={{ ...card, textAlign: 'center', color: 'var(--color-gray-500)' }}>{rows.every(r => r.status === 'not_trading') ? 'ยังไม่มีแผนเก็บเงินของแผงใดเลย — ตั้งที่แท็บ "ราคาและแผน"' : 'ไม่มีรายการในตัวกรองนี้'}</div>}
      </div>

      {canClose && <DayClosePanel data={data} totals={today} call={call} reload={reload} />}
      {paying && <PayDialog charge={paying} accounts={accounts} call={call} onDone={reload} onClose={() => setPaying(null)} />}
    </div>
  );
}
