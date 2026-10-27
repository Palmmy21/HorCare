import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { AlertTriangle, Info, CheckCheck, Link2Off, MoveRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import type { Building, Room } from '../../types';
import { apiPost, ApiError } from '../../utils/api';
import { useSecurityAlerts } from '../../hooks/useSecurityAlerts';
import { ALERT_TYPE_LABELS_TH } from '../../shared/security-alerts';

const ERRORS: Record<string, string> = {
    target_occupied: 'ห้องปลายทางมีบัญชี LINE ผูกอยู่แล้ว (ไม่ย้ายทับผู้เช่าคนอื่น) ให้ยกเลิกการผูกของห้องนั้นก่อน',
    target_not_found: 'ไม่พบห้องปลายทาง หรือห้องถูกปิดใช้งาน',
    not_linked: 'ห้องนี้ไม่ได้ผูก LINE อยู่',
    link_mismatch: 'ข้อมูลการลงทะเบียนไม่ตรงกับสถานที่นี้ กรุณาติดต่อผู้ดูแลระบบ',
    forbidden: 'คุณไม่มีสิทธิ์แก้ไขการผูกห้อง',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
};

const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: '0.75rem', background: 'var(--color-white, #fff)', display: 'flex', flexDirection: 'column', gap: 6 };

export default function LineBindingsTab({ ownerUid, buildings }: { ownerUid: string; buildings: Building[] }) {
    const ids = useMemo(() => buildings.map(b => b.id), [buildings]);
    const nameOf = useMemo(() => new Map(buildings.map(b => [b.id, b.name])), [buildings]);
    const { alerts, openCount } = useSecurityAlerts(ownerUid, ids);
    const [buildingId, setBuildingId] = useState(ids[0] ?? '');
    const [rooms, setRooms] = useState<(Room & { id: string })[]>([]);
    const [target, setTarget] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        if (!buildingId) return;
        return onSnapshot(
            collection(db, `users/${ownerUid}/buildings/${buildingId}/rooms`),
            s => setRooms(s.docs.map(d => ({ ...(d.data() as Room), id: d.id }))),
            () => setRooms([]),
        );
    }, [ownerUid, buildingId]);

    const sorted = useMemo(
        () => [...rooms].filter(r => r.is_active !== false).sort((a, b) => a.room_number.localeCompare(b.room_number, 'th', { numeric: true })),
        [rooms],
    );
    const linked = sorted.filter(r => r.line_user_id);
    const free = sorted.filter(r => !r.line_user_id);

    const run = async (key: string, route: string, body: Record<string, unknown>, ok: string) => {
        setBusy(key);
        try {
            await apiPost(route, { owner_uid: ownerUid, ...body });
            toast.success(ok);
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ');
        } finally {
            setBusy(null);
        }
    };

    const move = (r: Room & { id: string }) => {
        const to = target[r.id];
        const dest = free.find(x => x.id === to);
        if (!dest || !window.confirm(`ย้ายบัญชี LINE จากห้อง ${r.room_number} ไปห้อง ${dest.room_number}?\nผู้เช่าจะได้รับข้อความแจ้งใน LINE`)) return;
        void run('m:' + r.id, 'tenant-link', { building_id: buildingId, action: 'move', room_id: r.id, to_room_id: to }, `ย้ายไปห้อง ${dest.room_number} แล้ว`);
    };
    const unlink = (r: Room & { id: string }) => {
        if (!window.confirm(`ยกเลิกการผูก LINE ของห้อง ${r.room_number}?\nผู้เช่าจะไม่ได้รับบิลทาง LINE จนกว่าจะลงทะเบียนใหม่`)) return;
        void run('u:' + r.id, 'tenant-link', { building_id: buildingId, action: 'unlink', room_id: r.id }, 'ยกเลิกการผูกแล้ว');
    };
    const ackAll = async () => {
        for (const bid of new Set(alerts.filter(a => a.status === 'open').map(a => a.building_id))) {
            await run('ack', 'security-alerts', { building_id: bid, action: 'ack_all' }, 'รับทราบแล้ว');
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h2 style={{ margin: 0, fontSize: '1.05rem', flex: 1 }}>แจ้งเตือนการผูก LINE {openCount > 0 && <span style={{ background: '#DC2626', color: '#fff', borderRadius: 999, padding: '0 0.5rem', fontSize: '0.8rem' }}>{openCount}</span>}</h2>
                    {openCount > 0 && <button className="btn btn-outline btn-sm" disabled={busy === 'ack'} onClick={() => void ackAll()} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><CheckCheck size={14} /> รับทราบทั้งหมด</button>}
                </div>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                    ทุกครั้งที่มีบัญชี LINE ถูกผูกกับห้อง ระบบจะแจ้งที่นี่ — ถ้าไม่ใช่ผู้เช่าของห้องนั้น ให้ย้ายหรือยกเลิกการผูกด้านล่าง
                </p>
                {alerts.length === 0 ? <div style={{ color: 'var(--color-gray-500)' }}>ยังไม่มีการแจ้งเตือน</div> : alerts.slice(0, 30).map(a => (
                    <div key={a.id} style={{ ...card, borderColor: a.status === 'open' && a.severity === 'warning' ? '#F59E2E' : undefined, opacity: a.status === 'acknowledged' ? 0.6 : 1 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 700 }}>
                            {a.severity === 'warning' ? <AlertTriangle size={15} color="#E8740C" /> : <Info size={15} color="#0A6CC2" />}
                            {ALERT_TYPE_LABELS_TH[a.type]}
                            {buildings.length > 1 && <span style={{ fontWeight: 400, fontSize: '0.8rem' }}>· {nameOf.get(a.building_id) ?? a.building_id}</span>}
                        </div>
                        <div style={{ fontSize: '0.9rem', overflowWrap: 'anywhere' }}>{a.message}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span>{when(a.created_at)} · LINE …{a.line_ref}</span>
                            {a.status === 'acknowledged'
                                ? <span>รับทราบโดย {a.ack_by}</span>
                                : <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void run('ack', 'security-alerts', { building_id: a.building_id, action: 'ack', alert_id: a.id }, 'รับทราบแล้ว')}>รับทราบ</button>}
                        </div>
                    </div>
                ))}
            </section>

            <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h2 style={{ margin: 0, fontSize: '1.05rem', flex: 1 }}>แก้ไขการผูกห้อง</h2>
                    {buildings.length > 1 && (
                        <select value={buildingId} onChange={e => setBuildingId(e.target.value)} aria-label="สถานที่" style={{ padding: '0.4rem 0.6rem', borderRadius: 8, border: '1px solid var(--color-gray-300, #C3D0DE)' }}>
                            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    )}
                </div>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                    ผู้เช่าใหม่ลงทะเบียนผิดห้อง? ย้ายบัญชี LINE ไปห้องที่ถูกต้องได้ (ห้องปลายทางต้องยังไม่มีบัญชี LINE) ประวัติแชทจะย้ายตามไปด้วย
                </p>
                {linked.length === 0 ? <div style={{ color: 'var(--color-gray-500)' }}>ยังไม่มีห้องที่ผูก LINE</div> : linked.map(r => (
                    <div key={r.id} style={{ ...card, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                        <strong style={{ minWidth: 70 }}>ห้อง {r.room_number}</strong>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>LINE …{(r.line_user_id ?? '').slice(-4)}</span>
                        <span style={{ flex: 1 }} />
                        <select value={target[r.id] ?? ''} onChange={e => setTarget({ ...target, [r.id]: e.target.value })} aria-label={`ย้ายห้อง ${r.room_number} ไปที่`} style={{ padding: '0.4rem 0.6rem', borderRadius: 8, border: '1px solid var(--color-gray-300, #C3D0DE)' }}>
                            <option value="">ย้ายไปห้อง…</option>
                            {free.map(f => <option key={f.id} value={f.id}>{f.room_number}</option>)}
                        </select>
                        <button className="btn btn-primary btn-sm" disabled={!target[r.id] || !!busy} onClick={() => move(r)} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            {busy === 'm:' + r.id ? <Loader2 size={14} className="spin" /> : <MoveRight size={14} />} ย้าย
                        </button>
                        <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => unlink(r)} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Link2Off size={14} /> ยกเลิกการผูก</button>
                    </div>
                ))}
            </section>
        </div>
    );
}
