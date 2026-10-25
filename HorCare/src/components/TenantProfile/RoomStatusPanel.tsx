import { useState } from 'react';
import { PenLine, RotateCcw, AlertCircle, FileCheck2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Room } from '../../types';
import { errorInfo } from '../../shared/errorInfo';
import { cleanOverride, ROOM_STATUSES, SOURCE_LABELS_TH, type Occupancy, type RoomStatus } from '../../shared/roomOccupancy';
import { STATUS_CONFIG } from '../RoomManagement/RoomStatusDashboard';

interface Props {
  room: Room;
  occupancy?: Occupancy;
  /** Holds room.update (owner / property manager / market admin). */
  canOverride: boolean;
  onUpdateRoom?: (roomId: string, updates: Partial<Room>) => Promise<void>;
  actorName?: string;
  labels: Record<RoomStatus, string>;
}

const failMessage = (e: unknown) =>
  errorInfo(e).code === 'permission-denied' ? 'บัญชีนี้ไม่มีสิทธิ์แก้สถานะห้อง' : 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง';

const when = (iso: string) => {
  try { return new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
};

/** The room's status as the contracts say, and the deliberate way for an admin to correct it. */
export default function RoomStatusPanel({ room, occupancy, canOverride, onUpdateRoom, actorName, labels }: Props) {
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<RoomStatus | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!occupancy) return null;
  const { status, override, auto } = occupancy;
  const canEdit = canOverride && !!onUpdateRoom;
  const draft = choice ? cleanOverride({ status: choice, reason }, auto, { now: new Date(), by: actorName }) : null;

  const reset = () => { setEditing(false); setChoice(null); setReason(''); };

  const save = async () => {
    if (!draft || !onUpdateRoom) return;
    setSaving(true);
    try {
      await onUpdateRoom(room.id, { status_override: draft });
      toast.success(`เปลี่ยนสถานะเป็น "${labels[draft.status]}" แล้ว`);
      reset();
    } catch (e) {
      toast.error(failMessage(e));
    } finally { setSaving(false); }
  };

  const clear = async () => {
    if (!onUpdateRoom) return;
    setSaving(true);
    try {
      await onUpdateRoom(room.id, { status_override: null });
      toast.success('กลับไปใช้สถานะตามสัญญาแล้ว');
    } catch (e) {
      toast.error(failMessage(e));
    } finally { setSaving(false); }
  };

  return (
    <section className="room-status-panel" aria-label="สถานะห้อง">
      <div className="rsp-main">
        <span className="rsp-status">
          <i className={status === 'occupied' ? 'legend-tile' : 'status-dot'} style={status === 'occupied' ? undefined : { background: STATUS_CONFIG[status].dot }} aria-hidden />
          {labels[status]}
        </span>
        <span className="rsp-why">
          {override ? (
            <>
              <PenLine size={13} aria-hidden /> ปรับเอง{override.set_by ? `โดย ${override.set_by}` : ''} · {when(override.set_at)} · เหตุผล: {override.reason}
              <span className="rsp-sub">ตามสัญญาคือ "{labels[auto.status]}" ({auto.detail}) — ค่าที่ปรับจะใช้จนกว่าสัญญาจะเปลี่ยน</span>
            </>
          ) : (
            <>
              <FileCheck2 size={13} aria-hidden /> ตาม{SOURCE_LABELS_TH[auto.source]} · {auto.detail}
            </>
          )}
        </span>
        {canEdit && !editing && (
          <div className="rsp-actions">
            {override ? (
              <button type="button" className="btn btn-outline btn-sm" onClick={clear} disabled={saving}>
                <RotateCcw size={14} /> คืนค่าตามสัญญา
              </button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                <PenLine size={14} /> ปรับสถานะเอง
              </button>
            )}
          </div>
        )}
      </div>

      {occupancy.warning && !override && (
        <p className="rsp-warning"><AlertCircle size={14} aria-hidden /> {occupancy.warning}</p>
      )}

      {editing && (
        <form className="rsp-form" onSubmit={e => { e.preventDefault(); void save(); }}>
          <fieldset>
            <legend>เปลี่ยนเป็น</legend>
            <div className="rsp-choices">
              {ROOM_STATUSES.filter(s => s !== auto.status).map(s => (
                <label key={s} className={`rsp-choice ${choice === s ? 'active' : ''}`}>
                  <input type="radio" name={`rsp-${room.id}`} value={s} checked={choice === s} onChange={() => setChoice(s)} />
                  {labels[s]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="rsp-reason">
            <span>เหตุผล (จำเป็น)</span>
            <textarea className="form-input" rows={2} maxLength={300} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="เช่น ผู้เช่าย้ายออกก่อนกำหนด รอปิดสัญญา" />
          </label>
          <p className="rsp-note">ใช้แทนสถานะตามสัญญา ("{labels[auto.status]}") จนกว่าสัญญาของห้องนี้จะเปลี่ยน และบันทึกในประวัติการแก้ไข</p>
          <div className="rsp-form-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={saving}>ยกเลิก</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!draft || saving}>
              {saving ? 'กำลังบันทึก…' : 'ยืนยันการเปลี่ยนสถานะ'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
