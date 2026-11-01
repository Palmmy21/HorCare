import { useMemo, useState } from 'react';
import { FileText, Loader2, X, CheckCircle2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { DormConfig, MonthlyBill, Room } from '../../types';
import { formatCurrency, formatMonthThai } from '../../utils/calculations';
import { useTenantStays } from '../../hooks/useTenantStays';
import { prorateRent, proratedAmount } from '../../shared/prorate';

interface Props {
    rooms: Room[];
    bills: MonthlyBill[];
    config: DormConfig;
    month: string;
    uid?: string;
    buildingId?: string;
    unitName: string;
    onCreate: (items: { room: Room; rent: number; prorate?: MonthlyBill['rent_prorate'] }[], month: string) => Promise<{ created: number; skipped: number }>;
    onClose: () => void;
}

/**
 * Issue the month's rent bills without meter readings (market stalls, offices, rooms with utilities included):
 * rent + the room's fees for every chosen unit that has no bill yet. They then go out like any bill (ส่ง LINE),
 * show in the tenant portal, can be paid in parts, and are reminded / fined when late.
 */
export default function RentBillModal({ rooms, bills, config, month, uid, buildingId, unitName, onCreate, onClose }: Props) {
    const stays = useTenantStays(config.prorate_rent ? uid : null, buildingId);
    const billed = useMemo(() => new Set(bills.filter(b => b.month === month).map(b => b.room_id)), [bills, month]);
    const rows = useMemo(() => rooms
        .filter(r => r.is_active !== false && !billed.has(r.id))
        .sort((a, b) => a.room_number.localeCompare(b.room_number, 'th', { numeric: true }))
        .map(room => {
            const full = ['semester', 'yearly', 'daily'].includes(room.rent_type) ? 0 : (room.rent_amount ?? config.room_rent);
            const prorate = config.prorate_rent ? prorateRent(full, month, stays[room.id]) : null;
            return { room, full, prorate, rent: proratedAmount(full, prorate) };
        }), [rooms, billed, config.room_rent, config.prorate_rent, month, stays]);
    const [chosen, setChosen] = useState<Set<string> | null>(null); // null = all
    const isChosen = (id: string) => (chosen ? chosen.has(id) : true);
    const picked = rows.filter(r => isChosen(r.room.id));
    const total = picked.reduce((s, r) => s + r.rent, 0);
    const [busy, setBusy] = useState(false);

    const toggle = (id: string) => setChosen(prev => {
        const next = new Set(prev ?? rows.map(r => r.room.id));
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const create = async () => {
        setBusy(true);
        try {
            const r = await onCreate(picked.map(x => ({ room: x.room, rent: x.rent, prorate: x.prorate ?? undefined })), month);
            toast.success(`ออกบิลค่าเช่า ${r.created} ${unitName}แล้ว${r.skipped ? ` (ข้าม ${r.skipped} ที่มีบิลแล้ว)` : ''} — กด "ส่ง LINE" เพื่อส่งให้ผู้เช่า`);
            onClose();
        } catch (err) {
            toast.error(`ออกบิลไม่สำเร็จ: ${(err as Error).message}`);
            setBusy(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={busy ? undefined : onClose}>
            <div className="modal rb-modal" role="dialog" aria-modal="true" aria-labelledby="rb-title" onClick={e => e.stopPropagation()}>
                <div className="modal-header be-head">
                    <h2 id="rb-title" className="modal-title"><FileText size={18} aria-hidden /> ออกบิลค่าเช่า {formatMonthThai(month)}</h2>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>
                </div>
                <div className="modal-body">
                    <p className="be-hint" style={{ marginTop: 0 }}>
                        ไม่ต้องจดมิเตอร์ คิดค่าเช่า + ค่าส่วนกลาง/ค่าที่จอดของแต่ละ{unitName} ไม่มีค่าไฟ/ค่าน้ำ
                        ถ้าจดมิเตอร์ทีหลัง บิลจะคิดค่าน้ำไฟเพิ่มให้เอง
                    </p>
                    {rows.length === 0 ? (
                        <div className="rb-empty"><CheckCircle2 size={28} aria-hidden /><p>ทุก{unitName}มีบิลเดือนนี้แล้ว</p></div>
                    ) : (
                        <>
                            <label className="rb-all">
                                <input type="checkbox" checked={picked.length === rows.length} onChange={e => setChosen(e.target.checked ? null : new Set())} />
                                เลือกทั้งหมด ({rows.length} {unitName})
                            </label>
                            <ul className="rb-list">
                                {rows.map(r => (
                                    <li key={r.room.id}>
                                        <label>
                                            <input type="checkbox" checked={isChosen(r.room.id)} onChange={() => toggle(r.room.id)} />
                                            <span className="rb-no">{r.room.room_number}</span>
                                            {r.prorate && <span className="rent-prorate-note">คิด {r.prorate.days}/{r.prorate.days_in_month} วัน</span>}
                                            <span className="rb-rent mono">{formatCurrency(r.rent)}</span>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                            <p className="rb-total">ค่าเช่ารวม <strong className="mono">{formatCurrency(total)}</strong> · {picked.length} {unitName} <small>(ยังไม่รวมค่าส่วนกลาง)</small></p>
                        </>
                    )}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>ยกเลิก</button>
                    {rows.length > 0 && (
                        <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy || picked.length === 0}>
                            {busy && <Loader2 size={16} className="pp-spin" aria-hidden />} ออกบิล {picked.length} {unitName}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
