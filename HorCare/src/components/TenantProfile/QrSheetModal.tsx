import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, QrCode, Loader2, Printer, Search, RefreshCw, AlertTriangle, Check, Ban } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import type { Room } from '../../types';
import { apiPost, ApiError } from '../../utils/api';
import {
    CARDS_PER_PAGE, chunk, groupOf, paginateForPrint, QR_CHUNK, roomQrState, sortForPrint,
    type RoomLineRequest, type RoomQrState,
} from '../../shared/roomQr';

interface QrSheetModalProps {
    ownerUid: string;
    buildingId: string;
    rooms: Room[];
    unitName: string;
    dormName?: string;
    /** Whether this person may approve a request (tenant.update). */
    canDecide: boolean;
    onClose: () => void;
}

interface RoomCode { room_id: string; room_number: string; code: string }
interface CodesResponse { codes: RoomCode[]; base_url: string }
type Card = RoomCode & { floor?: string; zone?: string };
type PendingRequest = Omit<RoomLineRequest, 'line_user_id'>;
interface Job { ids: string[]; action: 'codes' | 'rotate' }

const STATE_LABEL: Record<RoomQrState, string> = { unregistered: 'ยังไม่ลงทะเบียน', unreachable: 'ส่งข้อความไม่ถึง', linked: 'เชื่อมแล้ว' };
const STATE_COLOR: Record<RoomQrState, string> = { unregistered: '#B45309', unreachable: '#DC2626', linked: '#15803D' };
const STATE_ORDER: RoomQrState[] = ['unregistered', 'unreachable', 'linked'];
/** Chunks in flight at once: fast on a big property, gentle on the API. */
const PARALLEL = 3;

const DECIDE_ERRORS: Record<string, string> = {
    forbidden: 'คุณไม่มีสิทธิ์อนุมัติคำขอนี้',
    request_not_pending: 'คำขอนี้ถูกจัดการไปแล้ว',
    room_unavailable: 'ห้องนี้ถูกปิดใช้งานแล้ว',
};

/**
 * LINE registration for a whole property: who is on LINE, requests waiting for an admin, and printing each room's
 * permanent QR. Printing again gives the same codes, so a lost card is just a reprint; replacing a code is a separate,
 * deliberate action. Any number of rooms: they go to the server in chunks, and a failed chunk is retried alone.
 */
export default function QrSheetModal({ ownerUid, buildingId, rooms, unitName, dormName, canDecide, onClose }: QrSheetModalProps) {
    const [requests, setRequests] = useState<PendingRequest[] | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [stateFilter, setStateFilter] = useState<RoomQrState | 'all'>('all');
    const [groupFilter, setGroupFilter] = useState('');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Set<string> | null>(null);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [cards, setCards] = useState<Card[] | null>(null);
    const [baseUrl, setBaseUrl] = useState('');
    const [failed, setFailed] = useState<Job[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [deciding, setDeciding] = useState<string | null>(null);

    const busy = progress !== null;

    const load = useCallback(async () => {
        setLoadError(false);
        try {
            const res = await apiPost<{ requests: PendingRequest[] }>('room-qr', { action: 'status', owner_uid: ownerUid, building_id: buildingId });
            setRequests(res.requests);
        } catch {
            setLoadError(true);
        }
    }, [ownerUid, buildingId]);

    useEffect(() => { void load(); }, [load]);

    const rows = useMemo(() => sortForPrint(rooms.filter(r => r.is_active)).map(room => ({
        room, group: groupOf(room), state: roomQrState(room),
    })), [rooms]);
    const counts = useMemo(() => {
        const c: Record<RoomQrState, number> = { unregistered: 0, unreachable: 0, linked: 0 };
        for (const r of rows) c[r.state]++;
        return c;
    }, [rows]);
    const groups = useMemo(() => [...new Set(rows.map(r => r.group).filter(Boolean))], [rows]);

    // Every room by default: the card is permanent, so even a linked room needs one for its next tenant.
    const chosen = useMemo(() => selected ?? new Set(rows.map(r => r.room.id)), [selected, rows]);
    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter(r => (stateFilter === 'all' || r.state === stateFilter)
            && (!groupFilter || r.group === groupFilter)
            && (!q || r.room.room_number.toLowerCase().includes(q)));
    }, [rows, stateFilter, groupFilter, search]);
    const allShownChosen = shown.length > 0 && shown.every(r => chosen.has(r.room.id));
    const pickedIds = rows.filter(r => chosen.has(r.room.id)).map(r => r.room.id);

    const toggle = (id: string) => {
        const next = new Set(chosen);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelected(next);
    };
    const toggleShown = () => {
        const next = new Set(chosen);
        for (const r of shown) { if (allShownChosen) next.delete(r.room.id); else next.add(r.room.id); }
        setSelected(next);
    };

    const runJobs = async (jobs: Job[]) => {
        const total = jobs.reduce((n, j) => n + j.ids.length, 0);
        const byId = new Map(rooms.map(r => [r.id, r]));
        const got: Card[] = [];
        const lost: Job[] = [];
        let done = 0;
        let lastError = '';
        setError(null);
        setProgress({ done: 0, total });
        const queue = [...jobs];
        const worker = async () => {
            for (let job = queue.shift(); job; job = queue.shift()) {
                try {
                    const res = await apiPost<CodesResponse>('room-qr', { action: job.action, owner_uid: ownerUid, building_id: buildingId, room_ids: job.ids });
                    for (const c of res.codes) got.push({ ...c, floor: byId.get(c.room_id)?.floor, zone: byId.get(c.room_id)?.zone });
                    setBaseUrl(res.base_url);
                } catch (e) {
                    const err = e as ApiError;
                    lastError = err.code === 'forbidden' ? 'คุณไม่มีสิทธิ์สร้าง QR' : err.message || 'สร้าง QR ไม่สำเร็จ';
                    // a failed "codes" is safe to repeat; a failed "rotate" may have landed, and "codes" then returns the new code
                    lost.push({ ids: job.ids, action: 'codes' });
                }
                done += job.ids.length;
                setProgress({ done, total });
            }
        };
        await Promise.all(Array.from({ length: PARALLEL }, worker));
        setCards(prev => [...(prev ?? []), ...got]);
        setFailed(lost);
        setError(lost.length ? lastError : null);
        setProgress(null);
    };

    const issue = (action: Job['action']) => {
        if (action === 'rotate' && !confirm(`เปลี่ยน QR ของ ${pickedIds.length} ${unitName}? ใบเดิมที่พิมพ์หรือติดไว้จะใช้ไม่ได้ทันที`)) return;
        void runJobs(chunk(pickedIds, QR_CHUNK).map(ids => ({ ids, action })));
    };

    const decide = async (r: PendingRequest, action: 'approve' | 'reject') => {
        const ok = action === 'approve'
            ? confirm(`อนุมัติให้ "${r.display_name || `LINE …${r.line_ref}`}" เป็นผู้ลงทะเบียน${unitName} ${r.room_number}?\nบัญชีเดิมของ${unitName}นี้จะถูกถอดออก`)
            : confirm(`ปฏิเสธคำขอของ${unitName} ${r.room_number}?`);
        if (!ok) return;
        setDeciding(r.id);
        try {
            await apiPost('room-qr', { action, owner_uid: ownerUid, building_id: buildingId, request_id: r.id });
            toast.success(action === 'approve' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว');
        } catch (e) {
            const err = e as ApiError;
            toast.error(DECIDE_ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ');
        } finally {
            setDeciding(null);
            void load();
        }
    };

    const close = () => { if (!busy) onClose(); };
    const pages = useMemo(() => (cards ? paginateForPrint(cards) : []), [cards]);
    const linkFor = (code: string) => `${baseUrl}/r/${code}`;
    const reached = counts.linked + counts.unreachable;
    const total = rows.length;

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) close(); }}>
            <div className="modal" style={{ maxWidth: cards ? 860 : 620 }} role="dialog" aria-modal="true" aria-label="QR ลงทะเบียน LINE รายห้อง">
                <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <QrCode size={20} /> QR ลงทะเบียน LINE ราย{unitName}
                    </span>
                    <button className="btn-icon" onClick={close} disabled={busy} aria-label="ปิด"><X size={18} /></button>
                </div>

                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                    {busy ? (
                        <div className="qr-desk-progress" role="status">
                            <div>กำลังเตรียม QR {progress.done.toLocaleString('th-TH')} / {progress.total.toLocaleString('th-TH')} {unitName}</div>
                            <div className="qs-bar"><span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
                        </div>
                    ) : cards ? (
                        <>
                            <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-600)' }}>
                                {cards.length.toLocaleString('th-TH')} {unitName} · {pages.length.toLocaleString('th-TH')} หน้า A4 · QR ถาวร ไม่มีวันหมดอายุ
                            </div>
                            {failed.length > 0 && (
                                <div role="alert" className="qr-desk-warn" style={{ color: '#DC2626' }}>
                                    <AlertTriangle size={15} />
                                    <span style={{ flex: 1 }}>
                                        {failed.reduce((n, j) => n + j.ids.length, 0)} {unitName}ยังไม่สำเร็จ{error ? ` (${error})` : ''}
                                    </span>
                                    <button className="btn btn-outline btn-sm" onClick={() => void runJobs(failed)}>
                                        <RefreshCw size={13} /> ลองใหม่เฉพาะส่วนนี้
                                    </button>
                                </div>
                            )}
                            {cards.length > CARDS_PER_PAGE && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>ตัวอย่าง {CARDS_PER_PAGE} ใบแรก ทุกใบจะออกตอนพิมพ์</div>
                            )}
                            <div className="qr-sheet-grid">
                                {pages[0]?.items.map(c => <QrCard key={c.room_id} code={c} link={linkFor(c.code)} unitName={unitName} dormName={dormName ?? ''} />)}
                            </div>
                        </>
                    ) : loadError ? (
                        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: '#DC2626' }}>
                            โหลดสถานะไม่สำเร็จ
                            <button className="btn btn-outline btn-sm" onClick={() => void load()}><RefreshCw size={13} /> ลองใหม่</button>
                        </div>
                    ) : !requests ? (
                        <Loader2 size={18} className="spin" />
                    ) : (
                        <>
                            {requests.length > 0 && (
                                <section className="qr-desk-requests" aria-label="คำขอรออนุมัติ">
                                    <div className="qr-desk-requests-head"><AlertTriangle size={15} /> รออนุมัติ {requests.length} คำขอ</div>
                                    {requests.map(r => (
                                        <div key={r.id} className="qr-desk-request">
                                            <span className="qr-desk-room">{r.room_number}</span>
                                            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                                                {r.display_name || 'ไม่ทราบชื่อ'} · LINE …{r.line_ref}
                                                <span className="qr-desk-when"> · {new Date(r.created_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                            </span>
                                            {canDecide ? (
                                                <>
                                                    <button className="btn btn-outline btn-sm" disabled={!!deciding} onClick={() => void decide(r, 'reject')}><Ban size={13} /> ปฏิเสธ</button>
                                                    <button className="btn btn-primary btn-sm" disabled={!!deciding} onClick={() => void decide(r, 'approve')}>
                                                        {deciding === r.id ? <Loader2 size={13} className="spin" /> : <Check size={13} />} อนุมัติ
                                                    </button>
                                                </>
                                            ) : <span className="qr-desk-when">รอผู้มีสิทธิ์อนุมัติ</span>}
                                        </div>
                                    ))}
                                </section>
                            )}

                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-gray-600)' }}>
                                    <span>เชื่อม LINE แล้ว {reached.toLocaleString('th-TH')} จาก {total.toLocaleString('th-TH')} {unitName}</span>
                                    <span>{total ? Math.round((reached / total) * 100) : 0}%</span>
                                </div>
                                <div className="qs-bar"><span style={{ width: `${total ? (reached / total) * 100 : 0}%` }} /></div>
                            </div>

                            <div className="qr-desk-tiles">
                                {STATE_ORDER.map(s => (
                                    <button key={s} type="button" className={`qr-desk-tile${stateFilter === s ? ' is-on' : ''}`} aria-pressed={stateFilter === s}
                                        onClick={() => setStateFilter(stateFilter === s ? 'all' : s)}>
                                        <span className="qr-desk-num" style={{ color: STATE_COLOR[s] }}>{counts[s].toLocaleString('th-TH')}</span>
                                        <span>{STATE_LABEL[s]}</span>
                                    </button>
                                ))}
                            </div>
                            {counts.unreachable > 0 && (
                                <div className="qr-desk-warn" style={{ color: '#B45309' }}>
                                    <AlertTriangle size={15} />
                                    <span>{counts.unreachable} {unitName}ลงทะเบียนแล้วแต่ยังไม่ได้เพิ่มเพื่อนหรือบล็อก LINE ทำให้บิลส่งไม่ถึง ต้องให้ผู้เช่าเพิ่มเพื่อน OA</span>
                                </div>
                            )}

                            <div className="qr-desk-filters">
                                <div className="qr-desk-search">
                                    <Search size={14} />
                                    <input className="form-input" value={search} onChange={e => setSearch(e.target.value)} placeholder={`ค้นหาเลข${unitName}`} aria-label={`ค้นหาเลข${unitName}`} />
                                </div>
                                {groups.length > 1 && (
                                    <select className="form-input" value={groupFilter} onChange={e => setGroupFilter(e.target.value)} aria-label="ชั้นหรือโซน">
                                        <option value="">ทุกชั้น/โซน</option>
                                        {groups.map(g => <option key={g} value={g}>{g}</option>)}
                                    </select>
                                )}
                            </div>

                            <div className="qr-desk-list">
                                <label className="qr-desk-row qr-desk-all">
                                    <input type="checkbox" checked={allShownChosen} disabled={shown.length === 0} onChange={toggleShown} />
                                    <span>เลือกทั้งหมดที่แสดง ({shown.length.toLocaleString('th-TH')})</span>
                                </label>
                                {shown.length === 0 && <div className="qr-desk-empty">ไม่พบ{unitName}</div>}
                                {shown.map(({ room, group, state }) => (
                                    <label key={room.id} className="qr-desk-row">
                                        <input type="checkbox" checked={chosen.has(room.id)} onChange={() => toggle(room.id)} />
                                        <span className="qr-desk-room">{room.room_number}</span>
                                        <span className="qr-desk-group">{group}</span>
                                        <span style={{ color: STATE_COLOR[state], fontWeight: 600 }}>{STATE_LABEL[state]}</span>
                                    </label>
                                ))}
                            </div>

                            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>
                                QR ของแต่ละ{unitName}เป็นใบถาวร พิมพ์ซ้ำกี่ครั้งก็ได้รหัสเดิม ถ้า{unitName}มีคนลงทะเบียนอยู่แล้ว การสแกนจะเป็นคำขอรอแอดมินอนุมัติ ไม่ทับคนเดิม
                            </p>
                        </>
                    )}
                </div>

                <div className="modal-footer" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button className="btn btn-outline" onClick={close} disabled={busy}>ปิด</button>
                    {!cards ? (
                        <>
                            <button className="btn btn-outline" onClick={() => issue('rotate')} disabled={busy || !requests || pickedIds.length === 0}>
                                <RefreshCw size={16} /> เปลี่ยน QR
                            </button>
                            <button className="btn btn-primary" onClick={() => issue('codes')} disabled={busy || !requests || pickedIds.length === 0}>
                                <QrCode size={16} /> เตรียมพิมพ์ {pickedIds.length.toLocaleString('th-TH')} {unitName}
                            </button>
                        </>
                    ) : !busy && cards.length > 0 && (
                        <button className="btn btn-primary" onClick={() => window.print()}>
                            <Printer size={16} /> พิมพ์ {pages.length.toLocaleString('th-TH')} หน้า
                        </button>
                    )}
                </div>
            </div>

            {/* printed copy lives outside the modal so it lays out on plain A4 pages */}
            {pages.length > 0 && !busy && createPortal(
                <div className="qr-sheet-print">
                    {pages.map(p => (
                        <section className="qr-sheet-page" key={p.page}>
                            <div className="qr-sheet-grid">
                                {p.items.map(c => <QrCard key={c.room_id} code={c} link={linkFor(c.code)} unitName={unitName} dormName={dormName ?? ''} />)}
                            </div>
                            <div className="qr-sheet-foot">{dormName}{p.group ? ` · ${p.group}` : ''} · หน้า {p.page}/{p.pages}</div>
                        </section>
                    ))}
                </div>,
                document.body,
            )}
        </div>
    );
}

function QrCard({ code, link, unitName, dormName }: { code: RoomCode; link: string; unitName: string; dormName: string }) {
    return (
        <div className="qr-sheet-card">
            {dormName && <div className="qr-sheet-dorm">{dormName}</div>}
            <div className="qr-sheet-room">{unitName} {code.room_number}</div>
            {/* level M: a card on a door gets scuffed */}
            <QRCodeSVG value={link} size={150} level="M" marginSize={2} />
            <div className="qr-sheet-steps">สแกนด้วยมือถือ แล้วทำตามหน้าจอ<br />รับบิลและแจ้งชำระผ่าน LINE ได้ทันที</div>
            <div className="qr-sheet-code mono">{code.code}</div>
        </div>
    );
}
