import { useCallback, useEffect, useMemo, useState } from 'react';
import { CloudRain, Loader2, Plus, Trash2, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { useBuildingRooms } from '../../hooks/useAccountingData';
import {
    MARKET_CLOSURE_REASONS, MARKET_CLOSURE_REASON_LABELS_TH, todayTh,
    type MarketClosure, type MarketClosureReason,
} from '../../shared/market';

const dayLabel = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });

const ERRORS: Record<string, string> = {
    invalid_input: 'ตรวจวันที่อีกครั้ง (บันทึกย้อนหลังได้ไม่เกิน 120 วัน และไม่เกิน 60 วันต่อครั้ง)',
    forbidden: 'คุณไม่มีสิทธิ์บันทึกตลาดหยุด',
};

/**
 * ตลาดหยุด: days the market itself (or some zones) did not open — a power cut, a flood, an event. Recorded here, those
 * days are not counted as money owed by daily stalls in the revenue audit; with "ยกเว้นค่าเช่า" monthly stalls get them
 * off their rent too. Can be recorded after the fact.
 */
export default function MarketClosures({ ownerUid, buildingId, canEdit }: { ownerUid: string; buildingId: string; canEdit: boolean }) {
    const { rooms } = useBuildingRooms(ownerUid, buildingId);
    const zones = useMemo(() => [...new Set(rooms.map(r => (r.zone ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th', { numeric: true })), [rooms]);
    const today = todayTh();
    const [list, setList] = useState<MarketClosure[] | null>(null);
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState<{ from: string; to: string; reason: MarketClosureReason; zones: string[]; note: string; waive: boolean; notify: boolean }>({ from: today, to: today, reason: 'power', zones: [], note: '', waive: false, notify: true });

    const call = useCallback(async <T,>(body: Record<string, unknown>) => apiPost<T>('market', { owner_uid: ownerUid, building_id: buildingId, ...body }), [ownerUid, buildingId]);
    const load = useCallback(async () => {
        try { setList((await call<{ closures: MarketClosure[] }>({ action: 'market_closure_list' })).closures); }
        catch { setList([]); }
    }, [call]);
    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        setBusy(true);
        try {
            const r = await call<{ line_sent?: number; line_failed?: number }>({ action: 'market_closure_add', from_date: form.from, to_date: form.to, reason: form.reason, zones: form.zones.length ? form.zones : null, note: form.note || null, waive_rent: form.waive, notify_line: form.notify });
            toast.success(form.notify ? `บันทึกแล้ว · แจ้งผู้ค้าทาง LINE ${r.line_sent ?? 0} คน${r.line_failed ? ` (ส่งไม่ถึง ${r.line_failed})` : ''}` : 'บันทึกตลาดหยุดแล้ว');
            setShow(false);
            setForm(f => ({ ...f, note: '', zones: [], waive: false }));
            await load();
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'บันทึกไม่สำเร็จ');
        } finally {
            setBusy(false);
        }
    };
    const cancel = async (c: MarketClosure) => {
        if (!confirm(`ยกเลิกรายการตลาดหยุด ${dayLabel(c.from_date)}?`)) return;
        try { await call({ action: 'market_closure_cancel', market_closure_id: c.id }); await load(); }
        catch (e) { toast.error((e as ApiError).message ?? 'ไม่สำเร็จ'); }
    };
    const toggleZone = (z: string) => setForm(f => ({ ...f, zones: f.zones.includes(z) ? f.zones.filter(x => x !== z) : [...f.zones, z] }));

    return (
        <div className="mc">
            <p className="mc-intro">
                บันทึกวันที่ตลาดไม่ได้เปิด เช่น ไฟดับ น้ำท่วม หรือมีงานพิเศษ ระบบตรวจยอดจะไม่นับวันเหล่านี้เป็นเงินที่ควรได้จากแผงรายวัน
                (เลือก "ยกเว้นค่าเช่า" ถ้าจะลดค่าเช่าของแผงรายเดือนตามจำนวนวันด้วย)
            </p>
            {canEdit && !show && <button type="button" className="btn btn-primary btn-sm" onClick={() => setShow(true)}><Plus size={14} aria-hidden /> บันทึกตลาดหยุด</button>}
            {show && (
                <div className="mc-form">
                    <div className="mc-row">
                        <label><span className="form-label">ตั้งแต่</span><input type="date" className="form-input" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value, to: f.to < e.target.value ? e.target.value : f.to }))} /></label>
                        <label><span className="form-label">ถึง</span><input type="date" className="form-input" value={form.to} min={form.from} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} /></label>
                        <label><span className="form-label">สาเหตุ</span>
                            <select className="form-input" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value as MarketClosureReason }))}>
                                {MARKET_CLOSURE_REASONS.map(r => <option key={r} value={r}>{MARKET_CLOSURE_REASON_LABELS_TH[r]}</option>)}
                            </select>
                        </label>
                    </div>
                    {zones.length > 0 && (
                        <fieldset className="mc-zones">
                            <legend className="form-label">โซนที่หยุด (ไม่เลือก = ทั้งตลาด)</legend>
                            {zones.map(z => (
                                <label key={z} className={`mc-zone${form.zones.includes(z) ? ' is-on' : ''}`}>
                                    <input type="checkbox" checked={form.zones.includes(z)} onChange={() => toggleZone(z)} /> {z}
                                </label>
                            ))}
                        </fieldset>
                    )}
                    <label><span className="form-label">หมายเหตุ</span><input className="form-input" maxLength={300} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="เช่น หม้อแปลงไฟเสีย ไฟกลับมา 16:00" /></label>
                    <label className="mc-check"><input type="checkbox" checked={form.waive} onChange={e => setForm(f => ({ ...f, waive: e.target.checked }))} /> ยกเว้นค่าเช่าแผงรายเดือนตามจำนวนวันที่หยุด</label>
                    <label className="mc-check"><input type="checkbox" checked={form.notify} onChange={e => setForm(f => ({ ...f, notify: e.target.checked }))} /> แจ้งผู้ค้าในโซนที่หยุดทาง LINE ทันที</label>
                    <div className="mc-actions">
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setShow(false)} disabled={busy}>ยกเลิก</button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={busy || !form.from || !form.to}>{busy ? <Loader2 size={14} className="spin" aria-hidden /> : null} บันทึก</button>
                    </div>
                </div>
            )}
            {list === null ? <Loader2 size={18} className="spin" aria-label="กำลังโหลด" /> : list.length === 0 ? (
                <p className="mc-empty">ยังไม่มีวันที่ตลาดหยุด</p>
            ) : (
                <ul className="mc-list">
                    {list.map(c => (
                        <li key={c.id} className="mc-item">
                            <span className="mc-icon" aria-hidden>{c.reason === 'power' ? <Zap size={18} /> : <CloudRain size={18} />}</span>
                            <span className="mc-text">
                                <strong>{dayLabel(c.from_date)}{c.to_date !== c.from_date ? ` – ${dayLabel(c.to_date)}` : ''} · {MARKET_CLOSURE_REASON_LABELS_TH[c.reason]}</strong>
                                <small>{c.zones ? c.zones.join(', ') : 'ทั้งตลาด'}{c.waive_rent ? ' · ยกเว้นค่าเช่ารายเดือน' : ''}{c.note ? ` · ${c.note}` : ''} · บันทึกโดย {c.created_by}</small>
                            </span>
                            {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cancel(c)} aria-label="ยกเลิกรายการ"><Trash2 size={15} aria-hidden /></button>}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
