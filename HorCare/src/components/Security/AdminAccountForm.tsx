import { useState } from 'react';
import { Copy, KeyRound, Loader2, RefreshCw, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { ASSIGNABLE_ROLES, ROLE_LABELS_TH, type Role } from '../../shared/permissions';
import type { Building } from '../../types';
import { generatePassword } from '../../utils/password';

const ERRORS: Record<string, string> = {
  invalid_email: 'อีเมลไม่ถูกต้อง', invalid_name: 'กรุณากรอกชื่อ-นามสกุล (2–80 ตัวอักษร)', invalid_role: 'บทบาทไม่ถูกต้อง',
  password_too_short: 'รหัสผ่านสั้นเกินไป (อย่างน้อย 8 ตัว)', password_too_long: 'รหัสผ่านยาวเกินไป (ไม่เกิน 64 ตัว)', password_too_simple: 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข',
  user_exists: 'อีเมลนี้มีบัญชี HorCare อยู่แล้ว — ใช้ "เพิ่มสมาชิกทีม" ด้านล่างแทน', unknown_property: 'ไม่พบอาคารที่เลือก', invalid_property_ids: 'กรุณาเลือกอาคารอย่างน้อย 1 แห่ง',
  forbidden: 'เฉพาะเจ้าของเท่านั้นที่สร้างบัญชีได้', unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
};

const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 };

/** The owner makes a sign-in for a building administrator: email + a password the owner hands over, limited to chosen buildings. */
export default function AdminAccountForm({ ownerUid, buildings, onCreated }: { ownerUid: string; buildings: Building[]; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(generatePassword);
  const [show, setShow] = useState(true);
  const [role, setRole] = useState<Role>('property_manager');
  const [scope, setScope] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string; password: string; name: string; scope: string } | null>(null);

  const toggle = (id: string) => setScope(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const scopeNames = all ? 'ทุกอาคาร' : buildings.filter(b => scope.includes(b.id)).map(b => b.name).join(', ');
  const ready = name.trim().length >= 2 && /^\S+@\S+\.\S{2,}$/.test(email.trim()) && password.length >= 8 && (all || scope.length > 0);

  const create = async () => {
    setBusy(true);
    try {
      await apiPost('members', { owner_uid: ownerUid, action: 'create_account', display_name: name.trim(), email: email.trim(), password, role, property_ids: all ? ['*'] : scope });
      setDone({ email: email.trim().toLowerCase(), password, name: name.trim(), scope: scopeNames });
      setName(''); setEmail(''); setPassword(generatePassword()); setScope([]); setAll(false);
      onCreated();
    } catch (e) {
      const err = e as ApiError;
      toast.error(ERRORS[err.code] ?? err.message ?? 'สร้างบัญชีไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const message = done ? `เข้าสู่ระบบ HorCare\nเว็บ: ${window.location.origin}\nอีเมล: ${done.email}\nรหัสผ่านชั่วคราว: ${done.password}\nดูแล: ${done.scope}\n(กรุณาเปลี่ยนรหัสผ่านหลังเข้าใช้ครั้งแรก)` : '';
  const copy = async () => { try { await navigator.clipboard.writeText(message); toast.success('คัดลอกแล้ว'); } catch { toast.error('คัดลอกไม่สำเร็จ'); } };

  return (
    <div className="card" style={{ padding: '1rem' }}>
      <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}><KeyRound size={16} /> สร้างบัญชีผู้ดูแลอาคาร (อีเมล + รหัสผ่าน)</div>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.8125rem', color: 'var(--color-gray-500)' }}>
        ผู้ดูแลเข้าสู่ระบบด้วยอีเมลและรหัสผ่านที่คุณตั้งให้ และเห็น/แก้ไขได้เฉพาะอาคารที่คุณเลือก — ผู้ดูแลตึก A จะไม่เห็นข้อมูลตึก B
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.625rem' }}>
        <label style={field}><span className="form-label">ชื่อ-นามสกุล</span><input className="form-input" value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
        <label style={field}><span className="form-label">อีเมล (ใช้เข้าสู่ระบบ)</span><input className="form-input" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin.a@example.com" /></label>
        <label style={field}>
          <span className="form-label">รหัสผ่านชั่วคราว</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="form-input mono" type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setPassword(generatePassword())} title="สุ่มรหัสใหม่" aria-label="สุ่มรหัสใหม่"><RefreshCw size={13} /></button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setShow(s => !s)}>{show ? 'ซ่อน' : 'แสดง'}</button>
          </div>
        </label>
        <label style={field}>
          <span className="form-label">บทบาท</span>
          <select className="form-input" value={role} onChange={e => setRole(e.target.value as Role)}>
            {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{r === 'property_manager' ? 'ผู้ดูแลอาคาร (จัดการได้ทุกอย่างในอาคารที่เลือก)' : ROLE_LABELS_TH[r]}</option>)}
          </select>
        </label>
      </div>
      <div style={{ marginTop: '0.75rem' }}>
        <div className="form-label" style={{ marginBottom: 4 }}>อาคารที่ดูแล (ต้องเลือกอย่างน้อย 1 แห่ง)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
          {buildings.map(b => (
            <label key={b.id} style={{ fontSize: '0.8125rem', display: 'flex', gap: 4, alignItems: 'center', opacity: all ? 0.4 : 1 }}>
              <input type="checkbox" disabled={all} checked={all || scope.includes(b.id)} onChange={() => toggle(b.id)} /> {b.name}
            </label>
          ))}
          <label style={{ fontSize: '0.8125rem', display: 'flex', gap: 4, alignItems: 'center', color: '#B45309' }}>
            <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> ทุกอาคาร (รวมอาคารที่เพิ่มในอนาคต)
          </label>
        </div>
      </div>
      <button className="btn btn-primary btn-sm" style={{ marginTop: '0.75rem' }} disabled={busy || !ready} onClick={() => void create()}>
        {busy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} สร้างบัญชี
      </button>

      {done && (
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: 10, background: '#F0FDF4', border: '1px solid #BBF7D0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <strong>สร้างบัญชีให้ {done.name} แล้ว — ส่งข้อมูลนี้ให้เขา (รหัสผ่านจะไม่แสดงอีก)</strong>
          <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.8125rem', userSelect: 'text' }}>{message}</pre>
          <div><button className="btn btn-outline btn-sm" onClick={() => void copy()}><Copy size={12} /> คัดลอกข้อความ</button></div>
        </div>
      )}
    </div>
  );
}

/** Change which buildings an existing member may use (the owner's decision; takes effect at once). */
export function ScopeEditor({ ownerUid, memberUid, buildings, current, onSaved }: { ownerUid: string; memberUid: string; buildings: Building[]; current: string[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string[]>(current);
  const [busy, setBusy] = useState(false);
  const all = scope.includes('*');
  const names = current.includes('*') ? 'ทุกอาคาร' : current.map(id => buildings.find(b => b.id === id)?.name ?? '(อาคารที่ลบแล้ว)').join(', ');
  const save = async () => {
    setBusy(true);
    try { await apiPost('members', { owner_uid: ownerUid, action: 'update', member_uid: memberUid, property_ids: scope }); toast.success('บันทึกอาคารที่ดูแลแล้ว'); setOpen(false); onSaved(); }
    catch (e) { const err = e as ApiError; toast.error(ERRORS[err.code] ?? 'บันทึกไม่สำเร็จ'); } finally { setBusy(false); }
  };
  return (
    <div style={{ flex: '1 1 160px', minWidth: 0 }}>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => { setScope(current); setOpen(o => !o); }} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>อาคาร: {names}</button>
      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {buildings.map(b => (
            <label key={b.id} style={{ fontSize: '0.8125rem', display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" disabled={all} checked={all || scope.includes(b.id)} onChange={() => setScope(s => (s.includes(b.id) ? s.filter(x => x !== b.id) : [...s.filter(x => x !== '*'), b.id]))} /> {b.name}
            </label>
          ))}
          <label style={{ fontSize: '0.8125rem', display: 'flex', gap: 4, alignItems: 'center', color: '#B45309' }}><input type="checkbox" checked={all} onChange={e => setScope(e.target.checked ? ['*'] : [])} /> ทุกอาคาร</label>
          <div><button className="btn btn-primary btn-sm" disabled={busy || scope.length === 0} onClick={() => void save()}>บันทึก</button></div>
        </div>
      )}
    </div>
  );
}

/** Owner sets a new password for an administrator account created here. */
export function ResetPasswordButton({ ownerUid, memberUid, name }: { ownerUid: string; memberUid: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    const next = generatePassword();
    if (!window.confirm(`ตั้งรหัสผ่านใหม่ให้ ${name}? เขาจะถูกออกจากระบบทุกเครื่องทันที`)) return;
    setBusy(true);
    try {
      await apiPost('members', { owner_uid: ownerUid, action: 'reset_password', member_uid: memberUid, password: next });
      try { await navigator.clipboard.writeText(next); } catch { /* shown below anyway */ }
      window.alert(`รหัสผ่านใหม่ของ ${name}:\n\n${next}\n\n(คัดลอกไว้ในคลิปบอร์ดแล้ว — ส่งให้เขา รหัสนี้จะไม่แสดงอีก)`);
    } catch (e) { const err = e as ApiError; toast.error(ERRORS[err.code] ?? err.message ?? 'ตั้งรหัสผ่านไม่สำเร็จ'); } finally { setBusy(false); }
  };
  return <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void reset()}><KeyRound size={13} /> รหัสผ่านใหม่</button>;
}
