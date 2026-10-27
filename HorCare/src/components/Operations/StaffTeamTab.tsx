import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Loader2, MessageCircle, RefreshCw, Sparkles, UserCheck, Users, Wrench, XCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { useWorkOrders } from '../../hooks/useWorkOrders';
import StaffManagerModal from '../WorkOrders/StaffManagerModal';
import { STAFF_ROLE_LABELS_TH, type WorkStaff } from '../../shared/workOrders';
import type { StaffRegistration } from '../../shared/staffRegistration';

interface Props { uid: string; buildingId: string; onPendingChange?: (n: number) => void }

interface LineStatus {
  token_set: boolean; secret_set: boolean; basic_id: string | null; display_name: string | null;
  webhook_url: string | null; webhook_active: boolean | null; expected_webhook_url: string; webhook_matches: boolean | null;
}
type Pending = StaffRegistration & { match: string | null };

const ERRORS: Record<string, string> = {
  already_decided: 'คำขอนี้มีคนตัดสินไปแล้ว', staff_already_linked: 'พนักงานคนนี้เชื่อม LINE อื่นอยู่แล้ว — เลือก "แทนที่" ถ้าต้องการเปลี่ยน',
  staff_not_found: 'ไม่พบพนักงานที่เลือก', forbidden: 'คุณไม่มีสิทธิ์จัดการทีมงาน', unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
};
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: '0.9rem', background: 'var(--color-white, #fff)', display: 'flex', flexDirection: 'column', gap: 8 };
const ago = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Row({ ok, label, hint }: { ok: boolean | null; label: string; hint?: string }) {
  const color = ok === null ? '#8FA3B8' : ok ? '#15803D' : '#B91C1C';
  const Icon = ok === null ? AlertTriangle : ok ? CheckCircle2 : XCircle;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.88rem' }}>
      <Icon size={16} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
      <span><strong style={{ color }}>{label}</strong>{hint ? <><br /><small style={{ color: 'var(--color-gray-500)' }}>{hint}</small></> : null}</span>
    </div>
  );
}

/** Technicians and housekeepers: connect the staff LINE OA, hand out the registration QR, approve who signs up. */
export default function StaffTeamTab({ uid, buildingId, onPendingChange }: Props) {
  const { staff } = useWorkOrders(uid, buildingId);
  const [status, setStatus] = useState<LineStatus | null>(null);
  const [code, setCode] = useState<{ code: string | null; expires_at: number | null } | null>(null);
  const [lists, setLists] = useState<{ pending: Pending[]; recent: StaffRegistration[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [linkTo, setLinkTo] = useState<Record<string, string>>({});

  const call = useCallback(<T,>(body: Record<string, unknown>) => apiPost<T>('staff-registration', { owner_uid: uid, building_id: buildingId, ...body }), [uid, buildingId]);
  const fail = (e: unknown) => { const err = e as ApiError; toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ'); };

  const loadLists = useCallback(async () => {
    try { const l = await call<{ pending: Pending[]; recent: StaffRegistration[] }>({ action: 'list' }); setLists(l); onPendingChange?.(l.pending.length); } catch (e) { fail(e); }
  }, [call, onPendingChange]);

  useEffect(() => {
    void call<LineStatus>({ action: 'status' }).then(setStatus).catch(() => setStatus(null));
    void call<{ code: string | null; expires_at: number | null }>({ action: 'code_get' }).then(setCode).catch(() => setCode({ code: null, expires_at: null }));
    void loadLists();
  }, [call, loadLists]);

  const run = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key);
    try { await call(body); toast.success(ok); await loadLists(); } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast.success('คัดลอกแล้ว'); } catch { toast.error('คัดลอกไม่สำเร็จ'); } };

  const basic = status?.basic_id ?? (import.meta.env.VITE_LINE_STAFF_OA_ID as string | undefined) ?? null;
  const addFriendUrl = basic ? `https://line.me/R/ti/p/${encodeURIComponent(basic)}` : null;
  const deepLink = basic && code?.code ? `https://line.me/R/oaMessage/${encodeURIComponent(basic)}/?${encodeURIComponent(code.code)}` : null;
  const connected = !!status?.token_set && !!status.secret_set && status.webhook_matches !== false && status.webhook_active !== false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}><MessageCircle size={16} /> การเชื่อมต่อ LINE OA สำหรับช่าง/แม่บ้าน</strong>
        {!status ? <Loader2 className="spin" /> : (
          <>
            <Row ok={status.token_set} label="Channel access token" hint={status.token_set ? undefined : 'ตั้ง LINE_STAFF_CHANNEL_ACCESS_TOKEN ใน Vercel'} />
            <Row ok={status.secret_set} label="Channel secret" hint={status.secret_set ? undefined : 'ตั้ง LINE_STAFF_CHANNEL_SECRET ใน Vercel (ใช้ตรวจว่าข้อความมาจาก LINE จริง)'} />
            <Row ok={status.basic_id ? true : status.token_set ? false : null} label={status.basic_id ? `เชื่อมกับ ${status.display_name ?? 'OA'} (${status.basic_id})` : 'ยังอ่านข้อมูล OA จาก LINE ไม่ได้'} hint={status.basic_id ? undefined : 'ตรวจว่า token ถูกต้องและเป็นของ Messaging API channel'} />
            <Row ok={status.webhook_matches} label={status.webhook_url ? (status.webhook_matches ? 'Webhook ตั้งค่าถูกต้อง' : 'Webhook ชี้ไปที่อื่น') : 'ยังไม่ได้ตั้ง Webhook URL'}
              hint={status.webhook_matches ? (status.webhook_active === false ? 'Webhook ปิดอยู่ — เปิด "Use webhook" ใน LINE Developers' : undefined) : `ตั้ง Webhook URL เป็น ${status.expected_webhook_url} แล้วเปิด "Use webhook" และกด Verify`} />
            <div style={{ fontSize: '0.85rem', padding: '0.5rem 0.7rem', borderRadius: 8, background: connected ? '#EFF8F2' : '#FDEBD3' }}>
              {connected ? 'พร้อมใช้งาน — ช่างและแม่บ้านลงทะเบียนและรับงานผ่าน LINE ได้แล้ว' : 'ยังไม่พร้อม — แก้รายการที่เป็นสีแดงก่อน ข้อความที่ส่งเข้า OA จะไม่ถูกส่งมาที่ระบบจนกว่า Webhook จะตั้งค่าถูกต้อง'}
            </div>
          </>
        )}
      </div>

      <div style={card}>
        <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}><UserCheck size={16} /> ให้ช่าง/แม่บ้านลงทะเบียนเอง</strong>
        <ol style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', lineHeight: 1.7 }}>
          <li>คุณแสดง QR หรือส่งลิงก์ด้านล่างให้ช่าง/แม่บ้าน</li>
          <li>เขาเพิ่มเพื่อน LINE OA แล้วส่งรหัส (ระบบกรอกให้อัตโนมัติเมื่อสแกน)</li>
          <li>บอทถามหน้าที่ ชื่อ และเบอร์โทร ทีละข้อ</li>
          <li>คำขอมาขึ้นด้านล่าง — คุณกดอนุมัติ แล้วเขาจะรับงานทาง LINE ได้ทันที</li>
        </ol>
        {code === null ? <Loader2 className="spin" /> : code.code ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {deepLink ? <div style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid var(--color-gray-200, #DCE5EF)' }}><QRCodeSVG value={deepLink} size={132} level="M" /></div> : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>รหัสลงทะเบียนของสถานที่นี้ (ใช้ได้ถึง {ago(new Date(code.expires_at!).toISOString())})</span>
              <span className="mono" style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '0.06em' }}>{code.code}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-outline btn-sm" onClick={() => void copy(code.code!)}><Copy size={12} /> คัดลอกรหัส</button>
                {deepLink && <button className="btn btn-outline btn-sm" onClick={() => void copy(deepLink)}><Copy size={12} /> คัดลอกลิงก์สมัคร</button>}
                {addFriendUrl && <button className="btn btn-outline btn-sm" onClick={() => void copy(addFriendUrl)}><Copy size={12} /> ลิงก์เพิ่มเพื่อน OA</button>}
              </div>
              {!deepLink && <span style={{ fontSize: '0.78rem', color: '#C2410C' }}>ยังไม่ทราบ LINE ID ของ OA จึงยังสร้าง QR ไม่ได้ — แก้การเชื่อมต่อด้านบนก่อน (หรือให้ช่างพิมพ์รหัสเอง)</span>}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-outline btn-sm" disabled={busy === 'rot'} onClick={() => { if (confirm('สร้างรหัสใหม่? รหัสเดิมจะใช้ไม่ได้ทันที')) void run('rot', { action: 'code_rotate' }, 'สร้างรหัสใหม่แล้ว').then(() => call<{ code: string | null; expires_at: number | null }>({ action: 'code_get' }).then(setCode)); }}><RefreshCw size={12} /> สร้างรหัสใหม่</button>
                <button className="btn btn-outline btn-sm" disabled={busy === 'rev'} onClick={() => void run('rev', { action: 'code_revoke' }, 'ปิดรหัสแล้ว').then(() => setCode({ code: null, expires_at: null }))}>ปิดรหัส</button>
              </div>
            </div>
          </div>
        ) : (
          <div><button className="btn btn-primary btn-sm" disabled={busy === 'rot'} onClick={() => { setBusy('rot'); call<{ code: string; expires_at: number }>({ action: 'code_rotate' }).then(r => { setCode(r); toast.success('สร้างรหัสลงทะเบียนแล้ว'); }).catch(fail).finally(() => setBusy(null)); }}>สร้างรหัสลงทะเบียน</button></div>
        )}
      </div>

      <div style={card}>
        <strong>รออนุมัติ {lists ? `(${lists.pending.length})` : ''}</strong>
        {!lists ? <Loader2 className="spin" /> : lists.pending.length === 0 ? <span style={{ color: 'var(--color-gray-500)', fontSize: '0.88rem' }}>ไม่มีคำขอที่รออนุมัติ</span> : lists.pending.map(p => {
          const match = p.match ? staff.find(s => s.id === p.match) : undefined;
          const chosen = linkTo[p.id] ?? '';
          const candidates = staff.filter(s => s.active);
          return (
            <div key={p.id} style={{ border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 10, padding: '0.6rem 0.75rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {p.role === 'technician' ? <Wrench size={15} /> : <Sparkles size={15} />}
                <strong>{p.name}</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>{STAFF_ROLE_LABELS_TH[p.role]} · {p.phone} · ส่งเมื่อ {ago(p.created_at)}</span>
              </div>
              {match && <span style={{ fontSize: '0.82rem', color: '#9A3412' }}>เบอร์ตรงกับ "{match.name}" ที่มีอยู่แล้ว — เลือกเชื่อมกับคนนี้แทนการสร้างซ้ำได้</span>}
              <select className="form-input" style={{ maxWidth: 360 }} value={chosen || (match ? match.id : '')} onChange={e => setLinkTo({ ...linkTo, [p.id]: e.target.value || '-' })}>
                <option value="-">สร้างเป็นพนักงานใหม่</option>
                {candidates.map((s: WorkStaff) => <option key={s.id} value={s.id}>เชื่อมกับ: {s.name} ({STAFF_ROLE_LABELS_TH[s.role]}{s.line_user_id ? ' · เชื่อม LINE อยู่แล้ว' : ''})</option>)}
              </select>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary btn-sm" disabled={busy === 'a' + p.id} onClick={() => {
                  const target = chosen === '-' ? '' : (chosen || match?.id || '');
                  const t = staff.find(s => s.id === target);
                  void run('a' + p.id, { action: 'approve', registration_id: p.id, ...(target ? { link_staff_id: target, replace: !!t?.line_user_id } : {}) }, 'อนุมัติแล้ว — แจ้งทาง LINE ให้เขาแล้ว');
                }}>อนุมัติ</button>
                <button className="btn btn-outline btn-sm" disabled={busy === 'r' + p.id} onClick={() => { const reason = window.prompt('เหตุผลที่ไม่อนุมัติ (ไม่บังคับ — จะส่งให้เขาทาง LINE)'); if (reason !== null) void run('r' + p.id, { action: 'reject', registration_id: p.id, reason }, 'ไม่อนุมัติแล้ว'); }}>ไม่อนุมัติ</button>
              </div>
            </div>
          );
        })}
        {lists && lists.recent.length > 0 && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>ตัดสินแล้วล่าสุด ({lists.recent.length})</summary>
            {lists.recent.map(r => <div key={r.id} style={{ fontSize: '0.82rem', padding: '0.2rem 0' }}>{r.status === 'approved' ? '✅' : '⛔'} {r.name} · {STAFF_ROLE_LABELS_TH[r.role]} · {r.decided_at ? ago(r.decided_at) : ''}{r.reject_reason ? ` · ${r.reject_reason}` : ''}</div>)}
          </details>
        )}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Users size={16} /> ทีมช่างและแม่บ้าน ({staff.filter(s => s.active).length})</strong>
          <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setManaging(true)}>จัดการ / เพิ่มเอง</button>
        </div>
        {staff.length === 0 ? <span style={{ color: 'var(--color-gray-500)', fontSize: '0.88rem' }}>ยังไม่มีพนักงาน</span> : staff.map(s => (
          <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', opacity: s.active ? 1 : 0.55, fontSize: '0.88rem' }}>
            {s.role === 'technician' ? <Wrench size={14} /> : <Sparkles size={14} />}
            <strong>{s.name}</strong><span style={{ color: 'var(--color-gray-500)' }}>{STAFF_ROLE_LABELS_TH[s.role]}{s.phone ? ` · ${s.phone}` : ''}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, color: s.line_user_id ? '#15803D' : '#C2410C', fontSize: '0.78rem' }}>{s.line_user_id ? 'เชื่อม LINE แล้ว' : 'ยังไม่เชื่อม LINE'}</span>
          </div>
        ))}
      </div>
      {managing && <StaffManagerModal ownerUid={uid} buildingId={buildingId} staff={staff} onClose={() => setManaging(false)} />}
    </div>
  );
}
