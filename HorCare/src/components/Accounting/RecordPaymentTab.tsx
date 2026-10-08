import { useMemo, useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { useBuildingBilling, useBuildingRooms, type BillingItem } from '../../hooks/useAccountingData';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { bankAccountLabel } from '../../shared/banks';
import { toSatang } from '../../shared/accounting';
import type { Building, Fine, MonthlyBill } from '../../types';

interface Props { ownerUid: string; buildings: Building[] }

interface Outstanding { kind: 'bill' | 'fine'; id: string; label: string; outstanding: number; total: number }

const ERRORS: Record<string, string> = {
    exceeds_outstanding: 'ยอดที่จัดสรรเกินยอดค้างของบิล/ค่าปรับ',
    target_not_issued: 'บิลนี้ยังเป็นฉบับร่าง',
    target_wrong_room: 'รายการไม่ใช่ของห้องนี้',
    target_not_found: 'ไม่พบบิล/ค่าปรับ',
    bank_account_required: 'เลือกบัญชีธนาคารที่รับเงิน',
    bank_account_invalid: 'บัญชีธนาคารไม่ถูกต้อง',
    invalid_input: 'ข้อมูลไม่ถูกต้อง (ยอด วันที่ ต้องไม่เป็นอนาคต)',
    forbidden: 'คุณไม่มีสิทธิ์บันทึกรับชำระ',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
};
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 12, padding: '0.875rem', background: 'var(--color-white, #fff)', display: 'flex', flexDirection: 'column', gap: 8 };
const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 8, font: 'inherit', minWidth: 0, boxSizing: 'border-box' };
const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function outstandingOf(kind: 'bill' | 'fine', item: BillingItem): Outstanding | null {
    const total = kind === 'bill' ? (item as MonthlyBill).total_bill : (item as Fine).amount;
    if (kind === 'bill' && !(item as MonthlyBill).is_saved) return null; // draft bills are not receivable yet
    const paidLegacy = kind === 'bill' ? (item as MonthlyBill).payment_status === 'paid' : (item as Fine).status === 'paid';
    const allocated = item.payments_recorded ? (item.allocated_satang ?? 0) / 100 : paidLegacy ? total : 0;
    const outstanding = Math.round((total - allocated) * 100) / 100;
    if (outstanding <= 0) return null;
    const label = kind === 'bill' ? `บิลเดือน ${(item as MonthlyBill).month}` : `ค่าปรับ: ${(item as Fine).reason}`;
    return { kind, id: item.id, label, outstanding, total };
}

export default function RecordPaymentTab({ ownerUid, buildings }: Props) {
    const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? '');
    const [roomId, setRoomId] = useState('');
    const { rooms } = useBuildingRooms(ownerUid, buildingId);
    const { bills, fines } = useBuildingBilling(ownerUid, buildingId);
    const { activeAccounts } = useBankAccounts(ownerUid, buildingId);
    const [method, setMethod] = useState<'cash' | 'bank_transfer'>('cash');
    const [bankId, setBankId] = useState('');
    const [paidAt, setPaidAt] = useState(nowLocal());
    const [ref, setRef] = useState('');
    const [amounts, setAmounts] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);

    const items = useMemo(() => {
        if (!roomId) return [] as Outstanding[];
        const list = [
            ...bills.filter(b => b.room_id === roomId).map(b => outstandingOf('bill', b)),
            ...fines.filter(f => f.room_id === roomId).map(f => outstandingOf('fine', f)),
        ].filter((x): x is Outstanding => !!x);
        return list.sort((a, b) => a.label.localeCompare(b.label));
    }, [bills, fines, roomId]);

    const key = (i: Outstanding) => `${i.kind}:${i.id}`;
    const chosen = items.map(i => ({ i, amount: Number(amounts[key(i)] ?? '') })).filter(x => x.amount > 0);
    const total = chosen.reduce((s, x) => s + toSatang(x.amount), 0) / 100;
    const over = chosen.find(x => toSatang(x.amount) > toSatang(x.i.outstanding));

    const submit = async () => {
        setBusy(true);
        try {
            await apiPost('accounting', {
                owner_uid: ownerUid, action: 'record_payment', building_id: buildingId, room_id: roomId, method,
                bank_account_id: method === 'bank_transfer' ? bankId : undefined, paid_at: new Date(paidAt).toISOString(),
                transaction_ref: ref || undefined, allocations: chosen.map(x => ({ kind: x.i.kind, id: x.i.id, amount: x.amount })),
            });
            toast.success(`บันทึกรับชำระ ${baht(total)} บาทแล้ว`);
            setAmounts({}); setRef('');
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'บันทึกไม่สำเร็จ');
        } finally { setBusy(false); }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                ใช้เมื่อรับเงินบางส่วน หรือรับเงินครั้งเดียวชำระหลายบิลของแผง/ห้องเดียวกัน — ระบุยอดที่ตัดแต่ละบิล บิลจะเป็น “จ่ายแล้ว” เมื่อตัดครบเต็มยอด
                (การรับเงินโอนจะนับเป็นเงินรับในไฟล์บัญชีเมื่อยืนยันกับรายการธนาคารจริงแล้ว)
            </p>
            <div style={{ ...card, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                {buildings.length > 1 && (
                    <select style={input} value={buildingId} onChange={e => { setBuildingId(e.target.value); setRoomId(''); setAmounts({}); }} aria-label="สถานที่">
                        {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                )}
                <select style={input} value={roomId} onChange={e => { setRoomId(e.target.value); setAmounts({}); }} aria-label="แผง/ห้อง">
                    <option value="">เลือกแผง/ห้อง…</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.room_number}</option>)}
                </select>
            </div>

            {roomId && (items.length === 0 ? <div style={{ color: 'var(--color-gray-500)' }}>ไม่มียอดค้างชำระ</div> : (
                <div style={card}>
                    {items.map(i => (
                        <div key={key(i)} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 160 }}>
                                <div>{i.label}</div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>ค้าง {baht(i.outstanding)} จาก {baht(i.total)}</div>
                            </div>
                            <input type="number" min="0" step="0.01" max={i.outstanding} placeholder="ยอดที่ตัด" style={{ ...input, width: 120 }}
                                value={amounts[key(i)] ?? ''} onChange={e => setAmounts({ ...amounts, [key(i)]: e.target.value })} aria-label={`ยอดที่ตัด ${i.label}`} />
                            <button className="btn btn-outline btn-sm" onClick={() => setAmounts({ ...amounts, [key(i)]: String(i.outstanding) })}>เต็มจำนวน</button>
                        </div>
                    ))}
                    <hr style={{ border: 0, borderTop: '1px solid var(--color-gray-200, #E5E7EB)', width: '100%' }} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <select style={input} value={method} onChange={e => setMethod(e.target.value as 'cash' | 'bank_transfer')} aria-label="วิธีรับเงิน">
                            <option value="cash">เงินสด</option><option value="bank_transfer">เงินโอน</option>
                        </select>
                        {method === 'bank_transfer' && (
                            <select style={input} value={bankId} onChange={e => setBankId(e.target.value)} aria-label="บัญชีที่รับ">
                                <option value="">เลือกบัญชีที่รับ…</option>
                                {activeAccounts.map(a => <option key={a.id} value={a.id}>{bankAccountLabel(a)}</option>)}
                            </select>
                        )}
                        <input type="datetime-local" style={input} value={paidAt} max={nowLocal()} onChange={e => setPaidAt(e.target.value)} aria-label="วันเวลาที่รับเงิน" />
                        <input style={input} placeholder="เลขอ้างอิง (ถ้ามี)" maxLength={80} value={ref} onChange={e => setRef(e.target.value)} />
                    </div>
                    {over && <div role="alert" style={{ color: '#B91C1C', fontSize: '0.85rem' }}>ยอดที่ตัดเกินยอดค้างของ {over.i.label}</div>}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <strong style={{ flex: 1 }}>รวมรับ {baht(total)} บาท</strong>
                        <button className="btn btn-primary btn-sm" disabled={busy || chosen.length === 0 || !!over || !paidAt || (method === 'bank_transfer' && !bankId)} onClick={() => void submit()} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            {busy ? <Loader2 size={14} className="spin" /> : <Wallet size={14} />} บันทึกรับชำระ
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
