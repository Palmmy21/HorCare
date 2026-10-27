import { useMemo, useState } from 'react';
import { CalendarPlus, ChevronLeft, ChevronRight, LogIn, LogOut, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { CollectionsSnapshot } from '../../hooks/useCollections';
import { collectionsError } from '../../hooks/useCollections';
import {
  BOOKING_STATUS_LABELS_TH, HOLDING_STATUSES, outstanding, quoteStay, type Booking, type Charge,
} from '../../shared/collections';
import { addDays } from '../../shared/market';
import type { BankAccount } from '../../shared/banks';
import PayDialog from './PayDialog';

interface Props {
  data: CollectionsSnapshot;
  from: string;
  onShift: (days: number) => void;
  accounts: BankAccount[];
  canManage: boolean;
  call: <T>(body: Record<string, unknown>) => Promise<T>;
  act: <T = Record<string, unknown>>(key: string, body: Record<string, unknown>, ok?: string) => Promise<T | null>;
  reload: () => void;
}

const DAYS = 14;
const baht = (s: number) => (s / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const shortDay = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
const weekday = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short' });
const field: React.CSSProperties = { padding: '0.5rem 0.6rem', border: '1px solid var(--color-gray-300, #C3D0DE)', borderRadius: 8, font: 'inherit', minWidth: 0, boxSizing: 'border-box', width: '100%' };
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: '0.75rem', background: 'var(--color-white, #fff)', display: 'flex', flexDirection: 'column', gap: 8 };
const STATUS_COLOR: Record<string, string> = { reserved: '#FBD9A8', checked_in: '#A7DDBB', checked_out: '#DCE5EF', cancelled: '#FECACA', no_show: '#FECACA' };

export default function StaysView({ data, from, onShift, accounts, canManage, call, act, reload }: Props) {
  const dates = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(from, i)), [from]);
  const holding = useMemo(() => data.bookings.filter(b => HOLDING_STATUSES.includes(b.status) || b.status === 'checked_out'), [data.bookings]);
  const chargeById = useMemo(() => new Map(data.charges.map(c => [c.id, c])), [data.charges]);
  const [form, setForm] = useState<{ room_id: string; check_in: string } | null>(null);
  const [picked, setPicked] = useState<Booking | null>(null);
  const [paying, setPaying] = useState<Charge | null>(null);

  const cellBooking = (roomId: string, date: string) => holding.find(b => b.room_id === roomId && b.check_in <= date && date < b.check_out);
  const owing = data.charges.filter(c => c.kind === 'stay' && outstanding(c) > 0).sort((a, b) => a.period_start.localeCompare(b.period_start));
  const arrivals = data.bookings.filter(b => b.status === 'reserved' && b.check_in === data.today);
  const inHouse = data.bookings.filter(b => b.status === 'checked_in');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...card, flex: '1 1 140px' }}><span style={{ fontSize: '0.75rem' }}>เข้าพักวันนี้</span><strong style={{ fontSize: '1.3rem' }}>{arrivals.length}</strong></div>
        <div style={{ ...card, flex: '1 1 140px' }}><span style={{ fontSize: '0.75rem' }}>พักอยู่</span><strong style={{ fontSize: '1.3rem' }}>{inHouse.length}/{data.rooms.length}</strong></div>
        <div style={{ ...card, flex: '1 1 140px', background: owing.length ? '#FDEBD3' : undefined }}><span style={{ fontSize: '0.75rem' }}>ค้างชำระ</span><strong style={{ fontSize: '1.3rem' }}>฿{baht(owing.reduce((s, c) => s + outstanding(c), 0))}</strong></div>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-outline btn-sm" onClick={() => onShift(-7)} aria-label="ก่อนหน้า"><ChevronLeft size={14} /></button>
        <strong>{shortDay(dates[0])} – {shortDay(dates[DAYS - 1])}</strong>
        <button className="btn btn-outline btn-sm" onClick={() => onShift(7)} aria-label="ถัดไป"><ChevronRight size={14} /></button>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={() => setForm({ room_id: data.rooms[0]?.id ?? '', check_in: data.today })}>
          <CalendarPlus size={14} /> จองห้อง
        </button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12 }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 'max-content', width: '100%', fontSize: '0.8rem' }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: 'var(--color-white, #fff)', padding: 6, textAlign: 'left', zIndex: 1 }}>ห้อง</th>
              {dates.map(d => <th key={d} style={{ padding: '4px 6px', minWidth: 44, background: d === data.today ? '#E7F0FA' : undefined }}><div>{weekday(d)}</div><div>{Number(d.slice(8))}</div></th>)}
            </tr>
          </thead>
          <tbody>
            {data.rooms.map(r => (
              <tr key={r.id}>
                <td style={{ position: 'sticky', left: 0, background: 'var(--color-white, #fff)', padding: 6, fontWeight: 700 }}>{r.room_number}</td>
                {dates.map(d => {
                  const b = cellBooking(r.id, d);
                  return (
                    <td key={d} style={{ padding: 0, border: '1px solid var(--color-gray-100, #EBF1F7)', height: 34 }}>
                      <button
                        aria-label={b ? `${r.room_number} ${b.guest_name}` : `จอง ${r.room_number} ${d}`}
                        onClick={() => (b ? setPicked(b) : setForm({ room_id: r.id, check_in: d >= data.today ? d : data.today }))}
                        style={{ width: '100%', height: '100%', border: 'none', cursor: 'pointer', background: b ? STATUS_COLOR[b.status] : 'transparent', fontSize: '0.68rem', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', padding: '0 2px' }}
                      >{b && b.check_in === d ? b.guest_name : ''}</button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {data.rooms.length === 0 && <tr><td style={{ padding: 12 }} colSpan={DAYS + 1}>ยังไม่มีห้อง — เพิ่มห้องที่หน้า "จัดการห้อง"</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 10, fontSize: '0.75rem', flexWrap: 'wrap' }}>
        {(['reserved', 'checked_in', 'checked_out'] as const).map(s => <span key={s}><span style={{ display: 'inline-block', width: 10, height: 10, background: STATUS_COLOR[s], marginRight: 4 }} />{BOOKING_STATUS_LABELS_TH[s]}</span>)}
      </div>

      {owing.length > 0 && (
        <div style={card}>
          <strong>ค้างชำระ</strong>
          {owing.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 160 }}>{c.room_number} · {c.party_name}<br /><small>{shortDay(c.period_start)} – {shortDay(addDays(c.period_end, 1))}</small></span>
              <strong>฿{baht(outstanding(c))}</strong>
              <button className="btn btn-primary btn-sm" onClick={() => setPaying(c)}>รับเงิน</button>
            </div>
          ))}
        </div>
      )}

      {form && <BookingForm data={data} initial={form} accounts={accounts} canManage={canManage} onClose={() => setForm(null)} onSave={async body => { const r = await act('booking', { action: 'booking_create', ...body }, 'จองห้องแล้ว'); if (r) setForm(null); return !!r; }} />}
      {picked && <BookingPanel booking={picked} charge={picked.charge_id ? chargeById.get(picked.charge_id) ?? null : null} today={data.today} accounts={accounts} act={act} onPay={c => { setPicked(null); setPaying(c); }} onClose={() => setPicked(null)} />}
      {paying && <PayDialog charge={paying} accounts={accounts} call={call} onDone={reload} onClose={() => setPaying(null)} />}
    </div>
  );
}

function BookingForm({ data, initial, accounts, canManage, onClose, onSave }: {
  data: CollectionsSnapshot; initial: { room_id: string; check_in: string }; accounts: BankAccount[]; canManage: boolean;
  onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [f, setF] = useState({ room_id: initial.room_id, guest_name: '', guest_phone: '', adults: '1', check_in: initial.check_in, check_out: addDays(initial.check_in, 1), deposit: '', deposit_method: 'cash', bank: accounts[0]?.id ?? '', total: '' });
  const room = data.rooms.find(r => r.id === f.room_id);
  const quote = useMemo(() => (f.check_out > f.check_in && room ? quoteStay(data.rates, { roomId: f.room_id, zone: room.zone, checkIn: f.check_in, checkOut: f.check_out }) : null), [data.rates, f.room_id, f.check_in, f.check_out, room]);
  const [saving, setSaving] = useState(false);
  const missing = (quote?.missing.length ?? 0) > 0;
  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        room_id: f.room_id, guest_name: f.guest_name, guest_phone: f.guest_phone || undefined, adults: Number(f.adults) || 1, check_in: f.check_in, check_out: f.check_out,
        deposit: f.deposit ? Number(f.deposit) : 0, deposit_method: f.deposit_method, ...(f.deposit_method === 'transfer' ? { deposit_bank_account_id: f.bank } : {}),
        ...(missing && f.total ? { total: Number(f.total) } : {}),
      });
    } catch (e) { toast.error(collectionsError(e)); } finally { setSaving(false); }
  };
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 480, width: '100%' }} role="dialog" aria-modal="true" aria-label="จองห้อง">
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between' }}><span className="modal-title">จองห้อง</span><button className="btn-icon" onClick={onClose} aria-label="ปิด"><X size={18} /></button></div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select style={field} value={f.room_id} onChange={e => setF({ ...f, room_id: e.target.value })}>{data.rooms.map(r => <option key={r.id} value={r.id}>{r.room_number}</option>)}</select>
          <input style={field} placeholder="ชื่อผู้เข้าพัก" value={f.guest_name} onChange={e => setF({ ...f, guest_name: e.target.value })} maxLength={100} />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
            <input style={field} placeholder="เบอร์โทร" inputMode="tel" value={f.guest_phone} onChange={e => setF({ ...f, guest_phone: e.target.value })} />
            <input style={field} placeholder="ผู้ใหญ่" inputMode="numeric" value={f.adults} onChange={e => setF({ ...f, adults: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ fontSize: '0.75rem' }}>เช็กอิน<input style={field} type="date" min={data.today} value={f.check_in} onChange={e => setF({ ...f, check_in: e.target.value })} /></label>
            <label style={{ fontSize: '0.75rem' }}>เช็กเอาต์<input style={field} type="date" min={addDays(f.check_in, 1)} value={f.check_out} onChange={e => setF({ ...f, check_out: e.target.value })} /></label>
          </div>
          {quote && (
            <div style={{ ...card, background: missing ? '#FDEBD3' : '#EFF8F2' }}>
              {missing
                ? <span>ยังไม่มีราคาสำหรับบางคืน ({quote.missing.length} คืน){canManage ? ' — ใส่ราคารวมเองได้ หรือตั้งราคาที่แท็บ "ราคา"' : ' — ให้ผู้จัดการตั้งราคาที่แท็บ "ราคา"'}</span>
                : <span>{quote.nights.length} คืน · รวม <strong>฿{baht(quote.total_satang)}</strong> (เซิร์ฟเวอร์คิดราคาอีกครั้งตอนบันทึก)</span>}
              {missing && canManage && <input style={field} inputMode="decimal" placeholder="ราคารวม (บาท)" value={f.total} onChange={e => setF({ ...f, total: e.target.value })} />}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input style={field} inputMode="decimal" placeholder="มัดจำ (บาท)" value={f.deposit} onChange={e => setF({ ...f, deposit: e.target.value })} />
            <select style={field} value={f.deposit_method} onChange={e => setF({ ...f, deposit_method: e.target.value })}><option value="cash">มัดจำเงินสด</option><option value="transfer">มัดจำโอน</option></select>
          </div>
          {f.deposit_method === 'transfer' && Number(f.deposit) > 0 && (
            <select style={field} value={f.bank} onChange={e => setF({ ...f, bank: e.target.value })}>{accounts.map(a => <option key={a.id} value={a.id}>{a.nickname || `${a.bank_short} ${a.account_name}`}</option>)}</select>
          )}
        </div>
        <div className="modal-footer"><button className="btn btn-outline" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary" disabled={saving || f.guest_name.trim().length < 2 || !f.room_id || (missing && !(canManage && Number(f.total) > 0))} onClick={() => void submit()}>บันทึกการจอง</button></div>
      </div>
    </div>
  );
}

function BookingPanel({ booking: b, charge, today, accounts, act, onPay, onClose }: {
  booking: Booking; charge: Charge | null; today: string; accounts: BankAccount[];
  act: Props['act']; onPay: (c: Charge) => void; onClose: () => void;
}) {
  const left = charge ? outstanding(charge) : 0;
  const paid = charge?.paid_satang ?? 0;
  const [cancelMode, setCancelMode] = useState<'void' | 'forfeit' | 'refund' | null>(null);
  const step = async (to: 'check_in' | 'check_out' | 'no_show', ok: string) => { if (await act('status', { action: 'booking_status', booking_id: b.id, to }, ok)) onClose(); };
  const cancel = async () => {
    if (!cancelMode) return;
    if (await act('cancel', { action: 'booking_cancel', booking_id: b.id, mode: cancelMode, method: 'cash', ...(accounts[0] ? { bank_account_id: accounts[0].id } : {}) }, 'ยกเลิกการจองแล้ว')) onClose();
  };
  const live = b.status === 'reserved' || b.status === 'checked_in';
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 440, width: '100%' }} role="dialog" aria-modal="true" aria-label="รายละเอียดการจอง">
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between' }}><span className="modal-title">ห้อง {b.room_number} · {b.guest_name}</span><button className="btn-icon" onClick={onClose} aria-label="ปิด"><X size={18} /></button></div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>{shortDay(b.check_in)} – {shortDay(b.check_out)} · {BOOKING_STATUS_LABELS_TH[b.status]}{b.guest_phone ? ` · ${b.guest_phone}` : ''}</div>
          {charge && <div style={card}><span>ค่าห้อง ฿{baht(charge.amount_satang)} · รับแล้ว ฿{baht(paid)}</span><strong>ค้างชำระ ฿{baht(left)}</strong></div>}
          {charge && left > 0 && charge.status !== 'void' && <button className="btn btn-primary" onClick={() => onPay(charge)}>รับเงิน (เงินสด / QR / สลิป)</button>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {b.status === 'reserved' && b.check_in <= today && <button className="btn btn-outline" onClick={() => void step('check_in', 'เช็กอินแล้ว')}><LogIn size={14} /> เช็กอิน</button>}
            {b.status === 'checked_in' && <button className="btn btn-outline" onClick={() => void step('check_out', 'เช็กเอาต์แล้ว')}><LogOut size={14} /> เช็กเอาต์</button>}
            {b.status === 'reserved' && b.check_in < today && <button className="btn btn-outline" onClick={() => void step('no_show', 'บันทึกไม่มาเข้าพักแล้ว')}>ไม่มาเข้าพัก</button>}
          </div>
          {live && (
            <div style={card}>
              <strong>ยกเลิกการจอง</strong>
              {([['void', 'ยกเลิกเฉย ๆ (ยังไม่ได้รับเงิน)', paid === 0], ['forfeit', 'ริบเงินที่รับไว้', paid > 0], ['refund', 'คืนเงินที่รับไว้', paid > 0]] as const).map(([m, label, ok]) => (
                <label key={m} style={{ opacity: ok ? 1 : 0.4 }}><input type="radio" disabled={!ok} checked={cancelMode === m} onChange={() => setCancelMode(m)} /> {label}</label>
              ))}
              <button className="btn btn-outline btn-sm" disabled={!cancelMode} onClick={() => void cancel()}>ยืนยันยกเลิก</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
