import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import {
  X, UserRound, ShieldCheck, Crown, KeyRound, Copy, Check, Loader2, Sparkles, CalendarClock, Building2, Eye, EyeOff,
  CircleAlert, Mail, Hash, BadgeCheck, Minus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { auth, db } from '../../firebase/config';
import type { Building, LicenseType, UserProfile } from '../../types';
import type { Membership } from '../../hooks/useMembership';
import { getMaxBuildings, getMaxRooms, getPlanDisplayName } from '../../hooks/useSubscription';
import { ROLE_LABELS_TH, type Permission } from '../../shared/permissions';
import { planStatus, thaiShortDate } from '../../shared/accountStatus';
import { canStartTrial, TRIAL_DAYS } from '../../shared/trial';
import { branchInitials } from '../../shared/branchSummary';
import './ProfileModal.css';

export type ProfileSection = 'profile' | 'password';

interface ProfileModalProps {
  user: User;
  profile: UserProfile | null;
  membership: Membership | null;
  /** Branches this account may open. */
  buildings: Building[];
  initialSection?: ProfileSection;
  /** Owner only: open the plan page. */
  onOpenPricing?: () => void;
  onClose: () => void;
}

/** What a member may do, in words an owner checks at a glance. */
const ABILITIES: { perm: Permission; label: string }[] = [
  { perm: 'room.update', label: 'แก้ไขข้อมูลห้อง' },
  { perm: 'tenant.update', label: 'แก้ไขข้อมูลผู้เช่า' },
  { perm: 'meter.record', label: 'จดมิเตอร์' },
  { perm: 'payment.create', label: 'รับชำระเงิน' },
  { perm: 'finance.read', label: 'ดูรายรับและการเงิน' },
  { perm: 'work_order.update', label: 'งานซ่อม' },
  { perm: 'message.send', label: 'ตอบข้อความ LINE' },
  { perm: 'member.manage', label: 'จัดการทีมงาน' },
];

export default function ProfileModal({ user, profile, membership, buildings, initialSection = 'profile', onOpenPricing, onClose }: ProfileModalProps) {
  const isOwner = !membership;
  // an administrator account the owner created keeps the name and phone the owner set up (also enforced by firestore.rules)
  const locked = membership?.managed === true;
  const startName = profile?.name || profile?.display_name || user.displayName || '';
  const [name, setName] = useState(startName);
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const passwordRef = useRef<HTMLElement>(null);

  const dirty = name.trim() !== startName.trim() || phone.trim() !== (profile?.phone ?? '').trim();
  const phoneOk = phone.trim() === '' || /^[0-9+\-\s]{9,15}$/.test(phone.trim());

  useEffect(() => {
    if (initialSection === 'password') passwordRef.current?.scrollIntoView({ block: 'start' });
  }, [initialSection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const saveProfile = async () => {
    if (locked || !dirty || !name.trim() || !phoneOk) return;
    setSaving(true);
    try {
      const clean = name.trim().slice(0, 80);
      await setDoc(doc(db, 'users', user.uid), { name: clean, display_name: clean, phone: phone.trim() }, { merge: true });
      if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: clean });
      toast.success('บันทึกโปรไฟล์แล้ว');
    } catch (e) {
      console.error('profile save failed', e);
      toast.error('บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSaving(false);
    }
  };

  // The plan: the owner's own; a member works under the owner's (license + access_until come with the membership).
  const status = planStatus(isOwner
    ? profile
    : { license: membership.license, access_until: membership.access_until });
  const roleLabel = isOwner ? 'เจ้าของ' : (ROLE_LABELS_TH[membership.role as keyof typeof ROLE_LABELS_TH] ?? membership.role);
  const allBranches = isOwner || membership.property_ids.includes('*');
  const created = user.metadata.creationTime ? thaiShortDate(Date.parse(user.metadata.creationTime)) : null;
  const usesPassword = user.providerData.some(p => p.providerId === 'password');

  const copyId = () => {
    navigator.clipboard.writeText(user.uid).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="modal pf-modal" role="dialog" aria-modal="true" aria-labelledby="pf-title">
        <header className="pf-head">
          <span className="pf-avatar" aria-hidden>
            {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : branchInitials(name || user.email || '?')}
          </span>
          <div className="pf-head-text">
            <h2 id="pf-title">{name.trim() || user.email}</h2>
            <span className="pf-head-sub">{user.email}</span>
            <div className="pf-head-tags">
              <span className="pf-tag pf-tag-role">{isOwner ? <Crown size={13} aria-hidden /> : <ShieldCheck size={13} aria-hidden />} {roleLabel}</span>
              <PlanTag kind={status.kind} name={getPlanDisplayName(status.license as LicenseType)} />
            </div>
          </div>
          <button type="button" className="pf-close" onClick={onClose} disabled={saving} aria-label="ปิด"><X size={20} /></button>
        </header>

        <div className="pf-body">
          {/* ── ข้อมูลส่วนตัว ── */}
          <section className="pf-section">
            <h3><UserRound size={16} aria-hidden /> ข้อมูลส่วนตัว</h3>
            <div className="pf-grid">
              <label className="pf-field">
                <span>ชื่อที่แสดง</span>
                <input className="form-input" value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="ชื่อ-นามสกุล" readOnly={locked} disabled={locked} />
                {!locked && !name.trim() && <small className="pf-err">กรอกชื่อ</small>}
              </label>
              <label className="pf-field">
                <span>เบอร์โทร</span>
                <input className="form-input" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder={locked ? '—' : '08x-xxx-xxxx'} readOnly={locked} disabled={locked} />
                {!locked && !phoneOk && <small className="pf-err">เบอร์โทรไม่ถูกต้อง</small>}
              </label>
            </div>
            {locked && <p className="pf-note">ชื่อ อีเมล และเบอร์โทรตั้งโดย {membership.owner_name || 'เจ้าของบัญชี'} — ติดต่อเจ้าของหากต้องการแก้ไข</p>}
            <dl className="pf-facts">
              <div><dt><Mail size={14} aria-hidden /> อีเมล</dt><dd>{user.email} {user.emailVerified
                ? <span className="pf-ok"><BadgeCheck size={13} aria-hidden /> ยืนยันแล้ว</span>
                : <span className="pf-warn">ยังไม่ยืนยัน</span>}</dd></div>
              {created && <div><dt><CalendarClock size={14} aria-hidden /> สมัครเมื่อ</dt><dd>{created}</dd></div>}
              <div>
                <dt><Hash size={14} aria-hidden /> รหัสผู้ใช้</dt>
                <dd className="pf-id">
                  <code>{user.uid}</code>
                  <button type="button" className="pf-copy" onClick={copyId} aria-label="คัดลอกรหัสผู้ใช้">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
                </dd>
              </div>
            </dl>
            {!locked && <div className="pf-actions">
              <button type="button" className="btn btn-primary" onClick={() => void saveProfile()} disabled={!dirty || !name.trim() || !phoneOk || saving}>
                {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />} บันทึกโปรไฟล์
              </button>
            </div>}
          </section>

          {/* ── บทบาทและสิทธิ์ ── */}
          <section className="pf-section">
            <h3><ShieldCheck size={16} aria-hidden /> บทบาทและสิทธิ์</h3>
            <div className="pf-role">
              <span className="pf-role-icon">{isOwner ? <Crown size={20} /> : <ShieldCheck size={20} />}</span>
              <div>
                <strong>{roleLabel}</strong>
                <p>{isOwner
                  ? 'เจ้าของบัญชี ทำได้ทุกอย่าง รวมถึงเพิ่มสาขา จัดการแพ็กเกจ และเพิ่มทีมงาน'
                  : `ทีมงานของ ${membership.owner_name || 'เจ้าของบัญชี'}`}</p>
              </div>
            </div>
            <div className="pf-sub">
              <span className="pf-sub-label"><Building2 size={14} aria-hidden /> สาขาที่เข้าได้</span>
              {allBranches
                ? <span className="pf-sub-value">ทุกสาขา ({buildings.length})</span>
                : <div className="pf-chips">{buildings.length ? buildings.map(b => <span key={b.id} className="pf-chip">{b.name}</span>) : <span className="pf-warn">ยังไม่ได้รับสิทธิ์สาขาใด</span>}</div>}
            </div>
            {!isOwner && (
              <ul className="pf-abilities" aria-label="สิ่งที่ทำได้">
                {ABILITIES.map(a => {
                  const can = membership.permissions.includes(a.perm);
                  return (
                    <li key={a.perm} className={can ? 'is-on' : ''}>
                      {can ? <Check size={14} aria-hidden /> : <Minus size={14} aria-hidden />} {a.label}
                      <span className="sr-only">{can ? ' — ทำได้' : ' — ทำไม่ได้'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── แพ็กเกจ ── */}
          <section className="pf-section">
            <h3><Sparkles size={16} aria-hidden /> แพ็กเกจ</h3>
            <PlanCard status={status} isOwner={isOwner} branchesUsed={buildings.length} />
            {isOwner && status.kind === 'free' && canStartTrial(profile) && (
              <p className="pf-note">ทดลองใช้ Pro ได้ฟรี {TRIAL_DAYS} วัน ไม่ต้องผูกบัตร</p>
            )}
            {!isOwner && <p className="pf-note">แพ็กเกจเป็นของเจ้าของบัญชี ทีมงานใช้ตามแพ็กเกจนั้น</p>}
            {isOwner && onOpenPricing && (
              <div className="pf-actions">
                <button type="button" className="btn btn-outline" onClick={onOpenPricing}>
                  {status.kind === 'paid' ? 'ต่ออายุ / เปลี่ยนแพ็กเกจ' : status.kind === 'trial' ? 'เลือกแพ็กเกจก่อนหมดทดลอง' : 'ดูแพ็กเกจ'}
                </button>
              </div>
            )}
          </section>

          {/* ── ความปลอดภัย ── */}
          <section className="pf-section" ref={passwordRef}>
            <h3><KeyRound size={16} aria-hidden /> เปลี่ยนรหัสผ่าน</h3>
            {usesPassword ? <PasswordForm email={user.email ?? ''} autoFocus={initialSection === 'password'} />
              : <p className="pf-note">บัญชีนี้เข้าสู่ระบบด้วย Google จึงไม่มีรหัสผ่านให้เปลี่ยนที่นี่</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function PlanTag({ kind, name }: { kind: string; name: string }) {
  const label = kind === 'trial' ? `ทดลองใช้ ${name}` : kind === 'expired' ? `${name} · หมดอายุ` : name;
  return <span className={`pf-tag pf-tag-plan is-${kind}`}><Sparkles size={13} aria-hidden /> {label}</span>;
}

function PlanCard({ status, isOwner, branchesUsed }: { status: ReturnType<typeof planStatus>; isOwner: boolean; branchesUsed: number }) {
  const license = status.license as LicenseType;
  const name = getPlanDisplayName(license);
  const maxRooms = getMaxRooms(license);
  const maxBranches = getMaxBuildings(license);
  const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString('th-TH') : 'ไม่จำกัด');
  const urgent = (status.kind === 'trial' || status.kind === 'paid') && status.endsAt !== null && status.daysLeft <= 7;

  const statusText = {
    trial: 'กำลังทดลองใช้',
    paid: 'ใช้งานอยู่',
    expired: 'หมดอายุแล้ว',
    free: 'แพ็กเกจฟรี',
    unlimited: 'ใช้งานได้ตลอด',
  }[status.kind];

  return (
    <div className={`pf-plan is-${status.kind}`}>
      <div className="pf-plan-top">
        <div>
          <div className="pf-plan-name">{status.kind === 'free' ? 'Free' : `HorCare ${name}`}</div>
          <div className="pf-plan-status">
            <span className={`pf-dot is-${status.kind}`} aria-hidden /> {statusText}
            {status.cycle && <> · {status.cycle === 'yearly' ? 'รายปี' : 'รายเดือน'}</>}
          </div>
        </div>
        {status.endsAt !== null && status.kind !== 'expired' && (
          <div className={`pf-plan-days ${urgent ? 'is-urgent' : ''}`}>
            <strong className="tnum">{status.daysLeft}</strong>
            <span>วันที่เหลือ</span>
          </div>
        )}
      </div>

      {status.endsAt !== null && (
        <div className={`pf-plan-end ${status.kind === 'expired' || urgent ? 'is-warn' : ''}`}>
          {status.kind === 'expired' ? <CircleAlert size={15} aria-hidden /> : <CalendarClock size={15} aria-hidden />}
          {status.kind === 'trial' ? 'ทดลองใช้ถึง' : status.kind === 'expired' ? 'หมดอายุเมื่อ' : 'ใช้ได้ถึง'} {thaiShortDate(status.endsAt)}
        </div>
      )}
      {status.kind === 'trial' && status.endsAt !== null && (
        <div className="pf-bar" role="progressbar" aria-valuemin={0} aria-valuemax={TRIAL_DAYS} aria-valuenow={status.daysLeft} aria-label="วันทดลองที่เหลือ">
          <span style={{ width: `${Math.min(100, (status.daysLeft / TRIAL_DAYS) * 100)}%` }} />
        </div>
      )}

      <dl className="pf-limits">
        <div><dt>ห้อง</dt><dd className="tnum">{fmt(maxRooms)}</dd></div>
        <div><dt>สาขา</dt><dd className="tnum">{isOwner ? `${branchesUsed} / ${fmt(maxBranches)}` : fmt(maxBranches)}</dd></div>
      </dl>
    </div>
  );
}

function PasswordForm({ email, autoFocus }: { email: string; autoFocus: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next.length < 6) { setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
    if (next !== confirm) { setError('รหัสผ่านใหม่ไม่ตรงกัน'); return; }
    const u = auth.currentUser;
    if (!u || !email) return;
    setBusy(true);
    try {
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(email, current));
      await updatePassword(u, next);
      setCurrent(''); setNext(''); setConfirm('');
      toast.success('เปลี่ยนรหัสผ่านแล้ว');
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(code === 'auth/wrong-password' || code === 'auth/invalid-credential' ? 'รหัสผ่านปัจจุบันไม่ถูกต้อง'
        : code === 'auth/too-many-requests' ? 'ลองหลายครั้งเกินไป กรุณารอสักครู่' : 'เปลี่ยนไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setBusy(false);
    }
  };

  const type = show ? 'text' : 'password';
  return (
    <form className="pf-password" onSubmit={e => void submit(e)}>
      <label className="pf-field">
        <span>รหัสผ่านปัจจุบัน</span>
        <input className="form-input" type={type} value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" autoFocus={autoFocus} required />
      </label>
      <div className="pf-grid">
        <label className="pf-field">
          <span>รหัสผ่านใหม่</span>
          <input className="form-input" type={type} value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" minLength={6} required />
        </label>
        <label className="pf-field">
          <span>ยืนยันรหัสผ่านใหม่</span>
          <input className="form-input" type={type} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>
      </div>
      {error && <p className="pf-err" role="alert">{error}</p>}
      <div className="pf-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setShow(s => !s)}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />} {show ? 'ซ่อนรหัส' : 'แสดงรหัส'}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !current || !next || !confirm}>
          {busy ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />} เปลี่ยนรหัสผ่าน
        </button>
      </div>
    </form>
  );
}
