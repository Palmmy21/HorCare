import { useEffect, useState } from 'react';
import { Check, Link2, Loader2, Pencil, Plus, Trash2, Undo2, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { todayTh } from '../../shared/market';
import { feeLabel, recentMonths, type Statement, type UnitOwner } from '../../shared/rentalParties';

interface Props {
  ownerUid: string;
  buildingId: string;
  owners: UnitOwner[];
  rooms: { id: string; room_number: string }[];
  onChanged: () => Promise<void>;
}

const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: '0.875rem', background: 'var(--color-white, #fff)', display: 'flex', flexDirection: 'column', gap: 8 };
const input: React.CSSProperties = { padding: '0.5rem 0.65rem', border: '1px solid var(--color-gray-300, #C3D0DE)', borderRadius: 8, font: 'inherit', minWidth: 0, boxSizing: 'border-box', width: '100%' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 };
const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00+07:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

const ERRORS: Record<string, string> = {
  invalid_input: 'ข้อมูลไม่ถูกต้อง: ชื่ออย่างน้อย 2 ตัวอักษร ค่าดูแลเป็น % (0–100) หรือบาท',
  forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  not_found: 'ไม่พบเจ้าของห้องรายนี้ — โหลดใหม่แล้วลองอีกครั้ง',
};
const errText = (e: unknown) => { const err = e as ApiError; return ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ'; };

const blank = { name: '', phone: '', payout_to: '', fee_type: 'percent' as 'percent' | 'fixed', fee_value: '10', note: '' };

/** ซื้อแล้วปล่อยเช่า: the people who own rooms here, their fee, their rooms, and what they are owed each month. */
export default function UnitOwnersTab({ ownerUid, buildingId, owners, rooms, onChanged }: Props) {
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const call = async <T,>(key: string, body: Record<string, unknown>): Promise<T | null> => {
    setBusy(key);
    try { return await apiPost<T>('rental-parties', { owner_uid: ownerUid, building_id: buildingId, ...body }); }
    catch (e) { toast.error(errText(e)); return null; }
    finally { setBusy(null); }
  };

  const save = async () => {
    if (!form) return;
    const ok = await call('save', { action: 'owner_save', owner_id: editing ?? undefined, ...form, fee_value: Number(form.fee_value) });
    if (ok) { toast.success(editing ? 'บันทึกแล้ว' : 'เพิ่มเจ้าของห้องแล้ว'); setForm(null); setEditing(null); await onChanged(); }
  };
  const edit = (o: UnitOwner) => {
    setEditing(o.id);
    setForm({ name: o.name, phone: o.phone ?? '', payout_to: o.payout_to ?? '', fee_type: o.fee_type, fee_value: String(o.fee_type === 'fixed' ? o.fee_value / 100 : o.fee_value), note: o.note ?? '' });
  };
  const remove = async (o: UnitOwner) => {
    if (!confirm(`ลบ ${o.name} ออกจากทะเบียนเจ้าของห้อง? ห้องจะกลับเป็นของที่พัก ลิงก์สรุปของเขาจะใช้ไม่ได้`)) return;
    if (await call('rm:' + o.id, { action: 'owner_remove', owner_id: o.id })) { toast.success('ลบแล้ว'); await onChanged(); }
  };

  const takenBy = new Map(owners.flatMap(o => o.room_ids.map(r => [r, o] as const)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, background: 'var(--color-primary-ultra-light, #EEF5FC)', borderColor: 'transparent' }}>
        <strong>ซื้อแล้วปล่อยเช่า</strong>
        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted, #557089)' }}>
          ห้องที่มีคนซื้อไปแล้วฝากที่พักปล่อยเช่า: ออกบิลเก็บผู้เช่าตามปกติ ระบบสรุปให้ทุกเดือนว่าเก็บค่าเช่าได้เท่าไร หักค่าดูแลแล้วต้องจ่ายเจ้าของห้องเท่าไร
          (นับเฉพาะค่าเช่าที่เก็บได้จริง ค่าน้ำไฟเป็นของที่พัก)
        </span>
      </div>

      <div><button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setForm(form ? null : blank); }} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Plus size={14} /> เพิ่มเจ้าของห้อง</button></div>

      {form && (
        <div style={card}>
          <strong>{editing ? 'แก้ไขเจ้าของห้อง' : 'เจ้าของห้องใหม่'}</strong>
          <div style={grid}>
            <label style={{ fontSize: '0.8rem' }}>ชื่อ<input style={input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={100} /></label>
            <label style={{ fontSize: '0.8rem' }}>เบอร์โทร<input style={input} inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
            <label style={{ fontSize: '0.8rem' }}>บัญชีรับเงิน<input style={input} placeholder="ธนาคาร เลขบัญชี หรือ PromptPay" value={form.payout_to} onChange={e => setForm({ ...form, payout_to: e.target.value })} maxLength={200} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div role="radiogroup" aria-label="ค่าดูแล" style={{ display: 'flex', gap: 6 }}>
              {(['percent', 'fixed'] as const).map(t => (
                <button key={t} type="button" role="radio" aria-checked={form.fee_type === t} className={form.fee_type === t ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
                  onClick={() => setForm({ ...form, fee_type: t })}>{t === 'percent' ? 'ค่าดูแล %' : 'ค่าดูแล บาท/ห้อง'}</button>
              ))}
            </div>
            <label style={{ fontSize: '0.8rem', width: 160 }}>{form.fee_type === 'percent' ? 'กี่ % ของค่าเช่า' : 'บาทต่อห้องต่อเดือน'}
              <input style={input} type="number" min="0" max={form.fee_type === 'percent' ? 100 : undefined} value={form.fee_value} onChange={e => setForm({ ...form, fee_value: e.target.value })} />
            </label>
          </div>
          <input style={input} placeholder="หมายเหตุ" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} maxLength={500} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-primary btn-sm" disabled={busy === 'save' || form.name.trim().length < 2 || form.fee_value === ''} onClick={() => void save()}>{busy === 'save' ? <Loader2 size={14} className="spin" /> : 'บันทึก'}</button>
            <button className="btn btn-outline btn-sm" onClick={() => { setForm(null); setEditing(null); }}>ยกเลิก</button>
          </div>
        </div>
      )}

      {owners.length === 0 && !form && <div style={{ color: 'var(--color-gray-500)' }}>ยังไม่มีเจ้าของห้อง — ถ้ามีห้องที่คนซื้อไปแล้วฝากปล่อยเช่า เพิ่มที่ปุ่มด้านบน</div>}

      {owners.map(o => (
        <OwnerCard key={o.id} ownerUid={ownerUid} buildingId={buildingId} owner={o} rooms={rooms} takenBy={takenBy} busy={busy} call={call}
          onEdit={() => edit(o)} onRemove={() => void remove(o)} onChanged={onChanged} />
      ))}
    </div>
  );
}

function OwnerCard({ ownerUid, buildingId, owner, rooms, takenBy, busy, call, onEdit, onRemove, onChanged }: {
  ownerUid: string; buildingId: string;
  owner: UnitOwner; rooms: { id: string; room_number: string }[]; takenBy: Map<string, UnitOwner>; busy: string | null;
  call: <T>(key: string, body: Record<string, unknown>) => Promise<T | null>;
  onEdit: () => void; onRemove: () => void; onChanged: () => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(owner.room_ids));
  const months = recentMonths(todayTh().slice(0, 7), 12);
  const [month, setMonth] = useState(months[0]);
  const [st, setSt] = useState<{ statement: Statement; payout: { amount: number; paid_at: string; paid_by: string } | null } | null>(null);

  const [tick, setTick] = useState(0);
  const hasRooms = owner.room_ids.length > 0;
  useEffect(() => {
    if (!hasRooms) return;
    let cancelled = false;
    apiPost<{ statement: Statement; payout: { amount: number; paid_at: string; paid_by: string } | null }>('rental-parties', { owner_uid: ownerUid, building_id: buildingId, action: 'statement', owner_id: owner.id, month })
      .then(r => { if (!cancelled) setSt(r); })
      .catch(e => { if (!cancelled) toast.error(errText(e)); });
    return () => { cancelled = true; };
  }, [ownerUid, buildingId, owner.id, hasRooms, month, tick]);
  const loadStatement = () => setTick(t => t + 1);

  const saveRooms = async () => {
    if (await call('rooms:' + owner.id, { action: 'owner_rooms', owner_id: owner.id, room_ids: [...picked] })) { toast.success('บันทึกห้องแล้ว'); setPicking(false); await onChanged(); }
  };
  const link = async () => {
    const r = await call<{ url: string }>('link:' + owner.id, { action: 'owner_link', owner_id: owner.id });
    if (!r) return;
    try { await navigator.clipboard.writeText(r.url); toast.success('คัดลอกลิงก์ใหม่แล้ว ลิงก์เดิมใช้ไม่ได้แล้ว'); }
    catch { window.prompt('คัดลอกลิงก์นี้ส่งให้เจ้าของห้อง', r.url); }
    await onChanged();
  };
  const markPaid = async () => {
    if (!st) return;
    if (!confirm(`บันทึกว่าจ่าย ${owner.name} แล้ว ${money(st.statement.payout)} บาท สำหรับ${monthLabel(month)}?`)) return;
    if (await call('pay:' + owner.id, { action: 'payout_mark', owner_id: owner.id, month, amount: st.statement.payout })) { toast.success('บันทึกการจ่ายแล้ว'); loadStatement(); }
  };
  const undoPaid = async () => {
    if (!confirm('ยกเลิกบันทึกการจ่ายของเดือนนี้?')) return;
    if (await call('undo:' + owner.id, { action: 'payout_undo', owner_id: owner.id, month })) loadStatement();
  };

  const roomNo = (id: string) => rooms.find(r => r.id === id)?.room_number ?? '—';
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{owner.name}</strong>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{feeLabel(owner)}</span>
      </div>
      <div style={{ fontSize: '0.82rem', color: 'var(--color-gray-500)' }}>
        {owner.phone && <a href={`tel:${owner.phone}`}>{owner.phone}</a>}{owner.phone && owner.payout_to ? ' · ' : ''}{owner.payout_to && <>รับเงิน: {owner.payout_to}</>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.82rem' }}>ห้อง:</span>
        {owner.room_ids.length ? owner.room_ids.map(id => <span key={id} className="badge badge-gray">{roomNo(id)}</span>) : <span style={{ fontSize: '0.82rem', color: '#C2410C' }}>ยังไม่ได้เลือกห้อง</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-outline btn-sm" onClick={() => { setPicked(new Set(owner.room_ids)); setPicking(p => !p); }}>เลือกห้อง</button>
        <button className="btn btn-outline btn-sm" disabled={busy === 'link:' + owner.id} onClick={() => void link()} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <Link2 size={13} /> {owner.has_link ? 'สร้างลิงก์สรุปใหม่' : 'ลิงก์สรุปให้เจ้าของห้อง'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onEdit} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Pencil size={13} /> แก้ไข</button>
        <button className="btn btn-ghost btn-sm" onClick={onRemove} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', color: 'var(--color-danger)' }}><Trash2 size={13} /> ลบ</button>
      </div>

      {picking && (
        <div style={{ borderTop: '1px solid var(--color-gray-100)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {rooms.map(r => {
              const other = takenBy.get(r.id);
              const on = picked.has(r.id);
              return (
                <button key={r.id} type="button" aria-pressed={on} className={on ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
                  title={other && other.id !== owner.id ? `ตอนนี้เป็นของ ${other.name} — เลือกแล้วจะย้ายมาเป็นของ ${owner.name}` : undefined}
                  onClick={() => setPicked(p => { const n = new Set(p); if (on) n.delete(r.id); else n.add(r.id); return n; })}>
                  {on && <Check size={12} />} {r.room_number}{other && other.id !== owner.id ? ' *' : ''}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>* เป็นของเจ้าของห้องคนอื่นอยู่ — ห้องหนึ่งมีเจ้าของได้คนเดียว</span>
          <div><button className="btn btn-primary btn-sm" disabled={busy === 'rooms:' + owner.id} onClick={() => void saveRooms()}>บันทึกห้อง ({picked.size})</button></div>
        </div>
      )}

      {owner.room_ids.length > 0 && (
        <div style={{ borderTop: '1px solid var(--color-gray-100)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Wallet size={15} aria-hidden /><strong style={{ fontSize: '0.9rem' }}>สรุปจ่ายเจ้าของห้อง</strong>
            <select style={{ ...input, width: 'auto' }} value={month} onChange={e => setMonth(e.target.value)} aria-label="เดือน">
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
          {!st ? <Loader2 size={16} className="spin" /> : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ fontSize: '0.85rem' }}>
                  <thead><tr><th>ห้อง</th><th className="text-right">ค่าเช่าในบิล</th><th className="text-right">เก็บได้</th><th className="text-right">ค่าดูแล</th><th className="text-right">จ่ายเจ้าของ</th></tr></thead>
                  <tbody>
                    {st.statement.lines.map(l => (
                      <tr key={l.room_id}><td>{l.room_number}</td><td className="text-right mono">{money(l.rent_billed)}</td><td className="text-right mono">{money(l.rent_collected)}</td><td className="text-right mono">{money(l.fee)}</td><td className="text-right mono"><strong>{money(l.payout)}</strong></td></tr>
                    ))}
                    <tr><td><strong>รวม</strong></td><td className="text-right mono">{money(st.statement.rent_billed)}</td><td className="text-right mono">{money(st.statement.rent_collected)}</td><td className="text-right mono">{money(st.statement.fee)}</td><td className="text-right mono"><strong>{money(st.statement.payout)}</strong></td></tr>
                  </tbody>
                </table>
              </div>
              {st.statement.outstanding > 0 && <span style={{ fontSize: '0.8rem', color: '#C2410C' }}>ค่าเช่ายังเก็บไม่ได้ {money(st.statement.outstanding)} บาท — จะรวมในยอดจ่ายเมื่อผู้เช่าจ่ายแล้ว</span>}
              {st.payout ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--color-success)' }}>
                  <Check size={15} /> จ่ายแล้ว {money(st.payout.amount)} บาท · {new Date(st.payout.paid_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} · {st.payout.paid_by}
                  {st.payout.amount !== st.statement.payout && <span style={{ color: '#C2410C' }}>(ยอดตอนนี้ {money(st.statement.payout)} — มีบิลจ่ายเพิ่มหลังบันทึก)</span>}
                  <button className="btn btn-ghost btn-sm" onClick={() => void undoPaid()} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Undo2 size={13} /> ยกเลิก</button>
                </div>
              ) : (
                <div><button className="btn btn-primary btn-sm" disabled={st.statement.payout <= 0 || busy === 'pay:' + owner.id} onClick={() => void markPaid()}>บันทึกว่าจ่ายแล้ว {money(st.statement.payout)} บาท</button></div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
