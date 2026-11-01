import { useState } from 'react';
import { Loader2, Minus, Pencil, Plus, Trash2, X, Zap, Droplets, Home, Building2, Lock, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { MonthlyBill } from '../../types';
import { formatCurrency } from '../../utils/calculations';
import { ADJUSTMENT_PRESETS, baseTotal, cleanAdjustments } from '../../shared/billAdjustments';

interface Row { id?: string; label: string; amount: string; sign: 1 | -1 }

interface Props {
    bill: MonthlyBill;
    onSave: (billId: string, adjustments: { id: string; label: string; amount: number }[], note: string) => Promise<void>;
    onClose: () => void;
}

const rowsOf = (bill: MonthlyBill): Row[] =>
    (bill.adjustments ?? []).map(a => ({ id: a.id, label: a.label, amount: String(Math.abs(a.amount)), sign: a.amount < 0 ? -1 : 1 }));

/**
 * Edit one bill from สรุปยอด: the meter, rent and fee lines stay as calculated; the owner adds extra charges or
 * discounts and a note, and sees the new total before saving. The tenant sees these lines on every bill copy.
 */
export default function BillEditModal({ bill, onSave, onClose }: Props) {
    const [rows, setRows] = useState<Row[]>(() => (bill.adjustments?.length ? rowsOf(bill) : [{ label: '', amount: '', sign: 1 }]));
    const [note, setNote] = useState(bill.bill_note ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const base = baseTotal(bill);
    const signed = rows.map(r => ({ id: r.id, label: r.label, amount: r.amount === '' ? '' : String(r.sign * Number(r.amount.replace(/[,฿\s]/g, ''))) }));
    const checked = cleanAdjustments(signed, base);
    const extra = checked.ok ? checked.adjustments.reduce((s, a) => s + a.amount, 0) : 0;
    const locked = bill.is_locked;
    const paid = bill.payment_status === 'paid' || bill.payment_status === 'pending';
    const readOnly = locked || paid;

    const setRow = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const addRow = (label = '', sign: 1 | -1 = 1) => setRows(rs => {
        // a preset fills the last blank row instead of piling up empty ones
        const blank = rs.findIndex(r => !r.label && !r.amount);
        if (blank >= 0 && label) return rs.map((r, j) => (j === blank ? { ...r, label, sign } : r));
        return [...rs, { label, amount: '', sign }];
    });

    const save = async () => {
        if (!checked.ok) { setError(checked.error); return; }
        setBusy(true);
        setError(null);
        try {
            await onSave(bill.id, checked.adjustments, note.trim().slice(0, 300));
            toast.success(`บันทึกบิลห้อง ${bill.room_number} แล้ว`);
            onClose();
        } catch (err) {
            const code = (err as Error).message;
            setError(code === 'bill_locked' ? 'เดือนนี้ปิดยอดแล้ว แก้บิลไม่ได้ (ปลดล็อกเดือนก่อน)'
                : code === 'bill_paid' ? 'บิลนี้ชำระแล้วหรือมีสลิปรอตรวจ แก้ยอดไม่ได้'
                : 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
            setBusy(false);
        }
    };

    const line = (icon: React.ReactNode, label: string, amount: number, sub?: string) => (
        <div className="be-line">
            <span className="be-line-label">{icon}{label}{sub && <small>{sub}</small>}</span>
            <span className="mono">{formatCurrency(amount)}</span>
        </div>
    );

    return (
        <div className="modal-overlay" onClick={busy ? undefined : onClose}>
            <div className="modal be-modal" role="dialog" aria-modal="true" aria-labelledby="be-title" onClick={e => e.stopPropagation()}>
                <div className="modal-header be-head">
                    <h2 id="be-title" className="modal-title"><Pencil size={18} aria-hidden /> แก้ไขบิล ห้อง {bill.room_number}</h2>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>
                </div>

                <div className="modal-body be-body">
                    {readOnly && (
                        <p className="be-notice">
                            {locked ? <><Lock size={15} aria-hidden /> เดือนนี้ปิดยอดแล้ว ปลดล็อกเดือนในหน้านี้ก่อนจึงจะแก้บิลได้</>
                                : <><AlertTriangle size={15} aria-hidden /> บิลนี้ชำระแล้วหรือมีสลิปรอตรวจ แก้ยอดไม่ได้ ถ้าต้องเก็บเพิ่มให้ใส่ในบิลเดือนถัดไป</>}
                        </p>
                    )}

                    <section>
                        <h3 className="be-section">ตามมิเตอร์และค่าเช่า</h3>
                        {line(<Zap size={14} color="#E8740C" aria-hidden />, 'ค่าไฟ', bill.elec_bill, `${bill.prev_elec} → ${bill.curr_elec} (${bill.elec_units} หน่วย)`)}
                        {line(<Droplets size={14} color="#0A6CC2" aria-hidden />, 'ค่าน้ำ', bill.water_bill, `${bill.prev_water} → ${bill.curr_water} (${bill.water_units} หน่วย)`)}
                        {line(<Home size={14} color="#15803D" aria-hidden />, 'ค่าห้อง', bill.room_rent, bill.rent_prorate ? `คิด ${bill.rent_prorate.days}/${bill.rent_prorate.days_in_month} วัน` : undefined)}
                        {(bill.applied_common_fees ?? []).map(f => <div key={f.id}>{line(<Building2 size={14} color="#0A6CC2" aria-hidden />, f.name, f.amount)}</div>)}
                        <p className="be-hint">แก้เลขมิเตอร์ได้ที่หน้า จดมิเตอร์ · ค่าส่วนกลางประจำตั้งที่ ระบบจัดการ → ส่วนกลาง</p>
                    </section>

                    <section>
                        <h3 className="be-section">ค่าใช้จ่ายเพิ่มเติม / ส่วนลด</h3>
                        {!readOnly && (
                            <div className="be-presets">
                                {ADJUSTMENT_PRESETS.map(p => (
                                    <button key={p.label} type="button" className={`be-preset${p.sign < 0 ? ' is-discount' : ''}`} onClick={() => addRow(p.label, p.sign)}>
                                        {p.sign < 0 ? <Minus size={12} aria-hidden /> : <Plus size={12} aria-hidden />}{p.label}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="be-rows">
                            {rows.map((r, i) => (
                                <div key={i} className="be-row">
                                    <button type="button" className={`be-sign${r.sign < 0 ? ' is-discount' : ''}`} disabled={readOnly}
                                        onClick={() => setRow(i, { sign: r.sign === 1 ? -1 : 1 })}
                                        aria-label={r.sign < 0 ? 'ส่วนลด (กดเพื่อเปลี่ยนเป็นค่าใช้จ่าย)' : 'ค่าใช้จ่าย (กดเพื่อเปลี่ยนเป็นส่วนลด)'}>
                                        {r.sign < 0 ? '−' : '+'}
                                    </button>
                                    <input className="form-input be-label" placeholder="ชื่อรายการ เช่น ค่าซ่อมก๊อกน้ำ" maxLength={60} value={r.label} disabled={readOnly}
                                        onChange={e => setRow(i, { label: e.target.value })} />
                                    <input className="form-input mono be-amount" placeholder="0" inputMode="decimal" value={r.amount} disabled={readOnly}
                                        onChange={e => setRow(i, { amount: e.target.value.replace(/[^\d.,]/g, '') })} aria-label="จำนวนเงิน (บาท)" />
                                    {!readOnly && (
                                        <button type="button" className="btn btn-ghost btn-sm be-del" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label="ลบรายการ">
                                            <Trash2 size={15} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        {!readOnly && <button type="button" className="btn btn-ghost btn-sm be-add" onClick={() => addRow()}><Plus size={15} aria-hidden /> เพิ่มรายการ</button>}
                    </section>

                    <section>
                        <label className="be-section" htmlFor="be-note">หมายเหตุในบิล (ผู้เช่าจะเห็น)</label>
                        <textarea id="be-note" className="form-input" rows={2} maxLength={300} value={note} disabled={readOnly}
                            onChange={e => setNote(e.target.value)} placeholder="เช่น ค่าซ่อมแอร์วันที่ 12 ตามใบเสร็จช่าง" />
                    </section>

                    <div className="be-total">
                        <div><span>ยอดตามมิเตอร์และค่าเช่า</span><span className="mono">{formatCurrency(base)}</span></div>
                        {extra !== 0 && <div><span>{extra > 0 ? 'ค่าใช้จ่ายเพิ่มเติม' : 'ส่วนลด'}</span><span className="mono">{extra > 0 ? '+' : '−'}{formatCurrency(Math.abs(extra))}</span></div>}
                        <div className="be-total-final"><span>ยอดรวมใหม่</span><span className="mono">{formatCurrency(base + extra)}</span></div>
                    </div>
                    {(error || (!checked.ok && rows.some(r => r.label || r.amount))) && (
                        <p className="be-error" role="alert">{error ?? (!checked.ok ? checked.error : '')}</p>
                    )}
                    {bill.is_notified && !readOnly && <p className="be-hint">ส่งบิลนี้ทาง LINE ไปแล้ว หลังบันทึกกด "ส่ง LINE" อีกครั้งเพื่อส่งยอดใหม่ให้ผู้เช่า</p>}
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>ยกเลิก</button>
                    {!readOnly && (
                        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !checked.ok}>
                            {busy && <Loader2 size={16} className="pp-spin" aria-hidden />} บันทึกบิล
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
