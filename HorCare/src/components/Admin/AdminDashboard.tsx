import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import { useFirestore } from '../../hooks/useFirestore';
import type { UserProfile, LicenseType, PlanName, BillingCycle } from '../../types';
import { isAdminUser } from '../../shared/admin';
import {
    Search, Loader2, AlertTriangle, Users, Timer, XCircle, Coins,
    X, Copy, Ban, Crown, ChevronRight, RefreshCw, Download, Check,
    Infinity as InfinityIcon, ShieldAlert, RotateCcw, Wrench, ArrowUpDown,
} from 'lucide-react';

type AdminUserRow = UserProfile & {
    email_verified?: boolean;
    last_sign_in?: string | null;
    has_firestore_profile?: boolean;
};

type FilterKey = 'all' | 'paid' | 'free' | 'small' | 'medium' | 'large' | 'active' | 'expiring_soon' | 'expired' | 'banned';
type SortKey = 'created_desc' | 'created_asc' | 'expiry_asc' | 'name_asc';

const LICENSE_LABELS: Record<string, { label: string; short: string }> = {
    free:           { label: 'Free',                short: 'Free' },
    monthly_small:  { label: 'Start · รายเดือน',     short: 'Start' },
    yearly_small:   { label: 'Start · รายปี',        short: 'Start' },
    monthly_medium: { label: 'Plus · รายเดือน',      short: 'Plus' },
    yearly_medium:  { label: 'Plus · รายปี',         short: 'Plus' },
    monthly_large:  { label: 'HorCare Pro · รายเดือน', short: 'Pro' },
    yearly_large:   { label: 'HorCare Pro · รายปี',    short: 'Pro' },
    active:         { label: 'ตลอดชีพ',             short: 'ตลอดชีพ' },
};

const LICENSE_OPTIONS: LicenseType[] = [
    'free', 'monthly_small', 'yearly_small',
    'monthly_medium', 'yearly_medium',
    'monthly_large', 'yearly_large', 'active',
];

const EXTEND_OPTIONS = [
    { days: 30, label: '+30 วัน' },
    { days: 90, label: '+90 วัน' },
    { days: 180, label: '+6 เดือน' },
    { days: 365, label: '+1 ปี' },
];

const SORT_LABELS: Record<SortKey, string> = {
    created_desc: 'สมัครล่าสุด',
    created_asc: 'สมัครก่อน',
    expiry_asc: 'ใกล้หมดอายุก่อน',
    name_asc: 'ชื่อ ก–ฮ / A–Z',
};

const licenseLabel = (license?: LicenseType) => LICENSE_LABELS[license ?? 'free']?.label ?? license ?? 'Free';
const licenseShort = (license?: LicenseType) => LICENSE_LABELS[license ?? 'free']?.short ?? license ?? 'Free';
const isTimed = (license?: LicenseType) => !!license && (license.startsWith('monthly_') || license.startsWith('yearly_'));

function getDaysLeft(isoDate: string): number {
    return Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86400000);
}

function isExpiredUser(u: AdminUserRow): boolean {
    if (!isTimed(u.license)) return false;
    return u.current_period_end ? new Date(u.current_period_end) < new Date() : false;
}

function isExpiringSoon(u: AdminUserRow): boolean {
    if (!isTimed(u.license) || !u.current_period_end) return false;
    const days = getDaysLeft(u.current_period_end);
    return days > 0 && days <= 7;
}

const fmtDate = (iso?: string | null, withTime = false) =>
    iso
        ? new Date(iso).toLocaleDateString('th-TH', {
            year: '2-digit', month: 'short', day: 'numeric',
            ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
        })
        : '—';

/* One status badge per user: the thing that needs the admin's attention, else the plan. */
function StatusBadge({ u }: { u: AdminUserRow }) {
    if (u.status === 'banned') return <span className="badge badge-danger"><Ban size={12} aria-hidden /> ถูกแบน</span>;
    if (u.license === 'active') return <span className="badge badge-success"><InfinityIcon size={12} aria-hidden /> ตลอดชีพ</span>;
    if (isTimed(u.license) && u.current_period_end) {
        const days = getDaysLeft(u.current_period_end);
        if (days <= 0) return <span className="badge badge-danger">หมดอายุแล้ว</span>;
        if (days <= 7) return <span className="badge badge-warning">เหลือ {days} วัน</span>;
        return <span className="badge badge-gray">เหลือ {days} วัน</span>;
    }
    return null;
}

function Initials({ name, email }: { name?: string; email?: string }) {
    const initials = (name || email || '?').trim().slice(0, 2).toUpperCase();
    return <span className="adm-avatar" aria-hidden>{initials}</span>;
}

/* ── User detail: right-hand sheet on desktop, bottom sheet on phones ── */
function UserSheet({ u, onClose, onBan, onUnban, onRevoke, onSetLicense, onExtendDays, onVerifyEmail, isProcessing }: {
    u: AdminUserRow;
    onClose: () => void;
    onBan: (uid: string) => void;
    onUnban: (uid: string) => void;
    onRevoke: (uid: string) => void;
    onSetLicense: (uid: string, license: LicenseType) => void;
    onExtendDays: (uid: string, days: number) => void;
    onVerifyEmail: (uid: string) => Promise<void>;
    isProcessing: boolean;
}) {
    const [verifyingEmail, setVerifyingEmail] = useState(false);
    const [copied, setCopied] = useState(false);
    const closeRef = useRef<HTMLButtonElement>(null);

    const isBanned = u.status === 'banned';
    const expired = isExpiredUser(u);
    const daysLeft = u.current_period_end ? getDaysLeft(u.current_period_end) : null;

    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [onClose]);

    const copyUID = async () => {
        try {
            await navigator.clipboard.writeText(u.uid);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('คัดลอกไม่สำเร็จ');
        }
    };

    const handleVerify = async () => {
        setVerifyingEmail(true);
        try {
            await onVerifyEmail(u.uid);
            toast.success('ยืนยันอีเมลแล้ว');
        } catch (err) {
            toast.error(`ยืนยันอีเมลไม่สำเร็จ: ${(err as Error).message}`);
        } finally {
            setVerifyingEmail(false);
        }
    };

    return (
        <div className="adm-sheet-root">
            <div className="adm-sheet-scrim" onClick={onClose} />
            <div className="adm-sheet" role="dialog" aria-modal="true" aria-labelledby="adm-sheet-title">
                <div className="adm-sheet-grip" aria-hidden />
                <header className="adm-sheet-head">
                    <Initials name={u.display_name} email={u.email} />
                    <div className="adm-sheet-who">
                        <h2 id="adm-sheet-title" className="adm-sheet-name">
                            {u.display_name || 'ไม่ระบุชื่อ'}
                            {u.role === 'admin' && <Crown size={14} className="adm-crown" aria-label="ผู้ดูแลระบบ" />}
                        </h2>
                        <div className="adm-sheet-email">{u.email || '—'}</div>
                    </div>
                    <button ref={closeRef} type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="ปิด">
                        <X size={18} />
                    </button>
                </header>

                <div className="adm-sheet-body">
                    {/* Plan */}
                    <section className="adm-sec">
                        <dl className="adm-facts">
                            <div>
                                <dt>แพ็กเกจ</dt>
                                <dd>{licenseLabel(u.license)}</dd>
                            </div>
                            <div>
                                <dt>สถานะ</dt>
                                <dd>{isBanned || u.license === 'active' || isTimed(u.license) ? <StatusBadge u={u} /> : <span className="badge badge-gray">ใช้งานฟรี</span>}</dd>
                            </div>
                            {isTimed(u.license) && (
                                <div>
                                    <dt>หมดอายุ</dt>
                                    <dd className={expired ? 'adm-text-danger' : undefined}>
                                        {fmtDate(u.current_period_end)}
                                        {daysLeft !== null && daysLeft > 0 && <span className="adm-dim"> · อีก {daysLeft} วัน</span>}
                                    </dd>
                                </div>
                            )}
                        </dl>
                    </section>

                    {/* Extend */}
                    <section className="adm-sec">
                        <h3 className="adm-sec-title">ต่ออายุการใช้งาน</h3>
                        <p className="adm-sec-hint">
                            {u.license === 'active'
                                ? 'บัญชีนี้ใช้งานได้ตลอดชีพแล้ว'
                                : 'นับต่อจากวันหมดอายุเดิม หรือจากวันนี้ถ้าหมดไปแล้ว'}
                        </p>
                        <div className="adm-extend">
                            {EXTEND_OPTIONS.map(item => (
                                <button
                                    key={item.days}
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={() => onExtendDays(u.uid, item.days)}
                                    disabled={isProcessing || u.license === 'active'}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Change plan */}
                    <section className="adm-sec">
                        <label className="adm-sec-title" htmlFor="adm-plan-select">เปลี่ยนแพ็กเกจ</label>
                        <select
                            id="adm-plan-select"
                            className="form-input adm-select"
                            value={u.license ?? 'free'}
                            disabled={isProcessing}
                            onChange={e => onSetLicense(u.uid, e.target.value as LicenseType)}
                        >
                            {LICENSE_OPTIONS.map(opt => <option key={opt} value={opt}>{licenseLabel(opt)}</option>)}
                        </select>
                    </section>

                    {/* Account */}
                    <section className="adm-sec">
                        <h3 className="adm-sec-title">บัญชี</h3>
                        <ul className="adm-rows">
                            <li>
                                <span className="adm-row-k">อีเมล</span>
                                <span className="adm-row-v">
                                    {u.email_verified
                                        ? <span className="badge badge-success"><Check size={12} aria-hidden /> ยืนยันแล้ว</span>
                                        : <>
                                            <span className="badge badge-warning">ยังไม่ยืนยัน</span>
                                            <button type="button" className="link-btn" onClick={handleVerify} disabled={verifyingEmail}>
                                                {verifyingEmail ? <Loader2 size={14} className="spin" /> : null}
                                                ยืนยันให้
                                            </button>
                                        </>}
                                </span>
                            </li>
                            <li>
                                <span className="adm-row-k">สมัครเมื่อ</span>
                                <span className="adm-row-v">{fmtDate(u.created_at, true)}</span>
                            </li>
                            <li>
                                <span className="adm-row-k">เข้าระบบล่าสุด</span>
                                <span className="adm-row-v">{fmtDate(u.last_sign_in, true)}</span>
                            </li>
                            <li className="adm-row-uid">
                                <span className="adm-row-k">UID</span>
                                <button type="button" className="link-btn" onClick={copyUID}>
                                    {copied ? <Check size={14} /> : <Copy size={14} />}
                                    {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
                                </button>
                                <code className="adm-uid">{u.uid}</code>
                            </li>
                        </ul>
                    </section>

                    {/* Restrictive actions */}
                    <section className="adm-sec">
                        <h3 className="adm-sec-title">จำกัดสิทธิ์</h3>
                        <div className="adm-danger-actions">
                            {isBanned ? (
                                <button type="button" className="btn btn-outline" onClick={() => onUnban(u.uid)} disabled={isProcessing}>
                                    <RotateCcw size={15} /> ปลดแบน
                                </button>
                            ) : (
                                <button type="button" className="btn btn-outline adm-btn-danger" onClick={() => onBan(u.uid)} disabled={isProcessing}>
                                    <Ban size={15} /> แบนผู้ใช้
                                </button>
                            )}
                            <button
                                type="button"
                                className="btn btn-outline"
                                onClick={() => onRevoke(u.uid)}
                                disabled={isProcessing || u.license === 'free'}
                            >
                                รีเซ็ตเป็น Free
                            </button>
                        </div>
                    </section>
                </div>

                <footer className="adm-sheet-foot">
                    {u.license !== 'active' ? (
                        <button type="button" className="btn btn-success adm-btn-block" onClick={() => onSetLicense(u.uid, 'active')} disabled={isProcessing}>
                            {isProcessing ? <Loader2 size={16} className="spin" /> : <InfinityIcon size={16} />}
                            ให้สิทธิ์ตลอดชีพ
                        </button>
                    ) : (
                        <p className="adm-foot-note"><Check size={16} aria-hidden /> ใช้งานได้ตลอดชีพแล้ว</p>
                    )}
                </footer>
            </div>
        </div>
    );
}

export default function AdminDashboard() {
    const { user, profile } = useAuth();
    const { updateUserLicense } = useFirestore(user?.uid ?? null, null);

    const [users, setUsers] = useState<AdminUserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterKey, setFilterKey] = useState<FilterKey>('all');
    const [sortKey, setSortKey] = useState<SortKey>('created_desc');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [selectedUid, setSelectedUid] = useState<string | null>(null);
    const [backfilling, setBackfilling] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<string>('');

    const loadUsers = useCallback(async (showRefresh = false) => {
        if (!user) return;
        if (showRefresh) setRefreshing(true); else setLoading(true);
        setError(null);
        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/admin?action=list-users', {
                headers: { 'Authorization': `Bearer ${idToken}` },
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null) as { message?: string; error?: string } | null;
                throw new Error(`HTTP ${res.status}${body?.message || body?.error ? ` — ${body.message || body.error}` : ''}`);
            }
            const data = await res.json() as { users: AdminUserRow[] };
            setUsers(data.users);
            setLastSyncTime(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }));
        } catch (err: unknown) {
            setError((err as Error).message || 'ไม่สามารถโหลดข้อมูลผู้ใช้งานได้');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [user]);

    useEffect(() => { loadUsers(); }, [loadUsers]);

    const selectedUser = selectedUid ? users.find(u => u.uid === selectedUid) ?? null : null;
    const closeSheet = useCallback(() => setSelectedUid(null), []);

    const stats = useMemo(() => {
        const total = users.length;
        const free = users.filter(u => !u.license || u.license === 'free').length;
        const small = users.filter(u => u.license?.includes('small')).length;
        const medium = users.filter(u => u.license?.includes('medium')).length;
        const large = users.filter(u => u.license?.includes('large')).length;
        const lifetime = users.filter(u => u.license === 'active').length;
        const expired = users.filter(isExpiredUser).length;
        const expiringSoon = users.filter(isExpiringSoon).length;
        const banned = users.filter(u => u.status === 'banned').length;
        const paid = small + medium + large + lifetime;

        // Estimated MRR: yearly plans spread over 12 months; banned and expired accounts excluded
        const mrr = users.reduce((sum, u) => {
            if (u.status === 'banned' || isExpiredUser(u)) return sum;
            if (u.license === 'monthly_small') return sum + 149;
            if (u.license === 'yearly_small') return sum + Math.round(950 / 12);
            if (u.license === 'monthly_medium') return sum + 259;
            if (u.license === 'yearly_medium') return sum + Math.round(1590 / 12);
            if (u.license === 'monthly_large') return sum + 399;
            if (u.license === 'yearly_large') return sum + Math.round(2990 / 12);
            return sum;
        }, 0);

        return { total, free, small, medium, large, lifetime, expired, expiringSoon, banned, paid, mrr };
    }, [users]);

    const displayedUsers = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        const list = users.filter(u => {
            if (q) {
                const hit = u.display_name?.toLowerCase().includes(q)
                    || u.email?.toLowerCase().includes(q)
                    || u.uid.toLowerCase().includes(q);
                if (!hit) return false;
            }
            switch (filterKey) {
                case 'paid': return !!u.license && u.license !== 'free';
                case 'free': return !u.license || u.license === 'free';
                case 'small': return u.license?.includes('small');
                case 'medium': return u.license?.includes('medium');
                case 'large': return u.license?.includes('large');
                case 'active': return u.license === 'active';
                case 'expiring_soon': return isExpiringSoon(u);
                case 'expired': return isExpiredUser(u);
                case 'banned': return u.status === 'banned';
                default: return true;
            }
        });

        return [...list].sort((a, b) => {
            if (sortKey === 'created_desc') return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
            if (sortKey === 'created_asc') return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
            if (sortKey === 'expiry_asc') {
                const aExp = a.current_period_end ? new Date(a.current_period_end).getTime() : Infinity;
                const bExp = b.current_period_end ? new Date(b.current_period_end).getTime() : Infinity;
                return aExp - bExp;
            }
            return (a.display_name || a.email || '').localeCompare(b.display_name || b.email || '', 'th');
        });
    }, [users, searchTerm, filterKey, sortKey]);

    // Every mutation: mark the row busy, report failure, then reload the list
    const mutate = async (uid: string, run: () => Promise<void>, success?: string) => {
        setProcessingId(uid);
        try {
            await run();
            if (success) toast.success(success);
        } catch (err) {
            console.error(err);
            toast.error(`ทำรายการไม่สำเร็จ: ${(err as Error).message}`);
        } finally {
            setProcessingId(null);
            await loadUsers(true);
        }
    };

    const handleBan = (uid: string) => {
        if (!confirm('แบนผู้ใช้นี้? บัญชีจะเข้าสู่ระบบไม่ได้ทันที')) return;
        mutate(uid, () => updateUserLicense(uid, { status: 'banned' }), 'แบนผู้ใช้แล้ว');
    };

    const handleUnban = (uid: string) =>
        mutate(uid, () => updateUserLicense(uid, { status: 'active' }), 'ปลดแบนแล้ว');

    const handleRevoke = (uid: string) => {
        if (!confirm('รีเซ็ตแพ็กเกจของผู้ใช้นี้กลับเป็น Free?')) return;
        mutate(uid, () => updateUserLicense(uid, {
            license: 'free',
            access_until: 0,
            subscription_status: undefined,
            current_period_end: undefined,
        }), 'รีเซ็ตเป็น Free แล้ว');
    };

    const handleSetLicense = (uid: string, license: LicenseType) => {
        if (!confirm(`เปลี่ยนแพ็กเกจเป็น "${licenseLabel(license)}"?`)) return;
        const updates: Partial<UserProfile> = { license };
        if (isTimed(license)) {
            const periodEnd = new Date();
            const isYearly = license.startsWith('yearly_');
            if (isYearly) periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            else periodEnd.setMonth(periodEnd.getMonth() + 1);
            updates.plan_name = license.replace(/^(monthly|yearly)_/, '') as PlanName;
            updates.billing_cycle = (isYearly ? 'yearly' : 'monthly') as BillingCycle;
            updates.subscription_status = 'active';
            updates.current_period_end = periodEnd.toISOString();
            updates.access_until = periodEnd.getTime();
            updates.subscription_id = `admin_${Date.now()}`;
        }
        if (license === 'active') {
            updates.subscription_id = undefined;
            updates.subscription_status = undefined;
            updates.current_period_end = undefined;
            updates.access_until = undefined;
        }
        mutate(uid, () => updateUserLicense(uid, updates), `เปลี่ยนเป็น ${licenseLabel(license)} แล้ว`);
    };

    const handleExtendDays = (uid: string, days: number) => {
        const u = users.find(x => x.uid === uid);
        if (!u) return;
        const now = Date.now();
        const baseMs = u.current_period_end ? Math.max(new Date(u.current_period_end).getTime(), now) : now;
        const newExpiry = new Date(baseMs + days * 86_400_000);
        mutate(uid, () => updateUserLicense(uid, {
            access_until: newExpiry.getTime(),
            current_period_end: newExpiry.toISOString(),
            subscription_status: 'active',
        }), `ต่ออายุถึง ${fmtDate(newExpiry.toISOString())}`);
    };

    const handleVerifyEmail = async (targetUid: string) => {
        const idToken = await user!.getIdToken();
        const res = await fetch('/api/admin?action=verify-email', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUid }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error || `HTTP ${res.status}`);
        }
        await loadUsers(true);
    };

    const missingProfileCount = users.filter(u => !u.has_firestore_profile).length;
    const handleBackfill = async () => {
        if (!confirm(`สร้างโปรไฟล์ให้ ${missingProfileCount} บัญชีที่ยังไม่มี?`)) return;
        setBackfilling(true);
        try {
            const idToken = await user!.getIdToken();
            const res = await fetch('/api/admin?action=backfill-profiles', {
                method: 'POST', headers: { 'Authorization': `Bearer ${idToken}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as { created: number };
            toast.success(`สร้างโปรไฟล์แล้ว ${data.created} บัญชี`);
            await loadUsers(true);
        } catch (err) {
            toast.error(`ซ่อมโปรไฟล์ไม่สำเร็จ: ${(err as Error).message}`);
        } finally {
            setBackfilling(false);
        }
    };

    const handleExportCSV = () => {
        const headers = ['UID', 'ชื่อ', 'อีเมล', 'แพ็กเกจ', 'สถานะ', 'วันหมดอายุ', 'วันที่สมัคร'];
        const rows = displayedUsers.map(u => [
            u.uid,
            `"${(u.display_name || '').replace(/"/g, '""')}"`,
            u.email || '',
            u.license || 'free',
            u.status === 'banned' ? 'banned' : isExpiredUser(u) ? 'expired' : 'active',
            u.current_period_end ? new Date(u.current_period_end).toLocaleDateString('th-TH') : '—',
            u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH') : '—',
        ]);
        const csvContent = '﻿' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `horcare_users_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const isAdmin = isAdminUser(user?.email, profile?.role);
    if (!isAdmin) {
        return (
            <div className="admin-dashboard-page">
                <div className="panel adm-denied">
                    <ShieldAlert size={28} aria-hidden />
                    <h1 className="panel-title">ไม่มีสิทธิ์เข้าถึง</h1>
                    <p>หน้านี้สำหรับผู้ดูแลระบบ HorCare เท่านั้น</p>
                </div>
            </div>
        );
    }

    const statusChips: { key: FilterKey; label: string; count: number }[] = [
        { key: 'all', label: 'ทั้งหมด', count: stats.total },
        { key: 'paid', label: 'จ่ายเงิน', count: stats.paid },
        { key: 'free', label: 'Free', count: stats.free },
        { key: 'expiring_soon', label: 'ใกล้หมดอายุ', count: stats.expiringSoon },
        { key: 'expired', label: 'หมดอายุ', count: stats.expired },
        { key: 'banned', label: 'ถูกแบน', count: stats.banned },
    ];

    // Plan mix — categorical colours, not status colours (Two Palettes Rule)
    const planMix: { key: FilterKey; label: string; count: number; color: string }[] = [
        { key: 'small', label: 'Start', count: stats.small, color: 'var(--cat-1)' },
        { key: 'medium', label: 'Plus', count: stats.medium, color: 'var(--cat-3)' },
        { key: 'large', label: 'HorCare Pro', count: stats.large, color: 'var(--cat-7)' },
        { key: 'active', label: 'ตลอดชีพ', count: stats.lifetime, color: 'var(--cat-4)' },
        { key: 'free', label: 'Free', count: stats.free, color: 'var(--series-muted)' },
    ];
    const planFilterLabel = planMix.find(p => p.key === filterKey && !statusChips.some(c => c.key === p.key))?.label;
    const paidShare = stats.total ? Math.round((stats.paid / stats.total) * 100) : 0;
    const followUp = stats.expiringSoon + stats.expired;

    return (
        <div className="admin-dashboard-page">
            <header className="dash-head">
                <div className="dash-head-text">
                    <h1 className="dash-title">ผู้ใช้งาน HorCare</h1>
                    <p className="dash-subtitle">
                        {loading ? 'กำลังโหลด…' : `${stats.total.toLocaleString('th-TH')} บัญชี`}
                        {lastSyncTime && ` · อัปเดต ${lastSyncTime} น.`}
                    </p>
                </div>
                <div className="dash-head-side">
                    <button type="button" className="btn btn-outline" onClick={handleExportCSV} disabled={loading || displayedUsers.length === 0}>
                        <Download size={16} /> <span className="adm-hide-sm">ส่งออก CSV</span>
                    </button>
                    <button type="button" className="btn btn-primary" onClick={() => loadUsers(true)} disabled={refreshing || loading} aria-label="รีเฟรช">
                        <RefreshCw size={16} className={refreshing ? 'spin' : undefined} /> <span className="adm-hide-sm">รีเฟรช</span>
                    </button>
                </div>
            </header>

            {error && (
                <div className="adm-alert adm-alert-danger" role="alert">
                    <AlertTriangle size={16} aria-hidden />
                    <span>โหลดรายชื่อผู้ใช้ไม่สำเร็จ ({error})</span>
                    <button type="button" className="link-btn" onClick={() => loadUsers()}>ลองอีกครั้ง</button>
                </div>
            )}

            {!loading && missingProfileCount > 0 && (
                <div className="adm-alert" role="status">
                    <Wrench size={16} aria-hidden />
                    <span><strong>{missingProfileCount}</strong> บัญชียังไม่มีโปรไฟล์ในระบบ จึงยังใช้งานไม่ได้</span>
                    <button type="button" className="link-btn" onClick={handleBackfill} disabled={backfilling}>
                        {backfilling && <Loader2 size={14} className="spin" />} ซ่อมโปรไฟล์
                    </button>
                </div>
            )}

            <div className="dash-grid">
                {/* Key figures */}
                <section className="panel figures span-12" aria-label="ภาพรวม">
                    <div className="figure">
                        <span className="figure-label"><Users size={14} aria-hidden /> บัญชีทั้งหมด</span>
                        <span className="figure-value">{loading ? '—' : stats.total.toLocaleString('th-TH')}</span>
                        <span className="figure-sub">จ่ายเงิน {stats.paid.toLocaleString('th-TH')} ({paidShare}%)</span>
                    </div>
                    <div className="figure">
                        <span className="figure-label"><Coins size={14} aria-hidden /> รายได้/เดือน</span>
                        <span className="figure-value">{loading ? '—' : `฿${stats.mrr.toLocaleString('th-TH')}`}</span>
                        <span className="figure-sub">ประมาณการ ไม่รวมหมดอายุ/แบน</span>
                    </div>
                    <button type="button" className="figure adm-figure-btn" onClick={() => setFilterKey('expiring_soon')} aria-pressed={filterKey === 'expiring_soon'}>
                        <span className="figure-label"><Timer size={14} aria-hidden /> ใกล้หมดอายุ</span>
                        <span className={`figure-value${stats.expiringSoon ? ' adm-text-warning' : ''}`}>{loading ? '—' : stats.expiringSoon}</span>
                        <span className="figure-sub">ภายใน 7 วัน</span>
                    </button>
                    <button type="button" className="figure adm-figure-btn" onClick={() => setFilterKey('expired')} aria-pressed={filterKey === 'expired'}>
                        <span className="figure-label"><XCircle size={14} aria-hidden /> หมดอายุ</span>
                        <span className={`figure-value${stats.expired ? ' adm-text-danger' : ''}`}>{loading ? '—' : stats.expired}</span>
                        <span className="figure-sub">ถูกแบน {stats.banned}</span>
                    </button>
                </section>

                {/* Plan mix */}
                {stats.total > 0 && (
                    <section className="panel span-12 adm-mix">
                        <div className="panel-head">
                            <h2 className="panel-title">สัดส่วนแพ็กเกจ</h2>
                            <span className="panel-meta">{followUp > 0 ? `ต้องติดตาม ${followUp} บัญชี` : `จ่ายเงิน ${paidShare}%`}</span>
                        </div>
                        <div className="cycle-bar" role="img" aria-label={planMix.map(p => `${p.label} ${p.count}`).join(', ')}>
                            {planMix.filter(p => p.count > 0).map(p => (
                                <span key={p.key} className="cycle-seg" style={{ flexGrow: p.count, background: p.color }} />
                            ))}
                        </div>
                        <ul className="adm-mix-list">
                            {planMix.map(p => (
                                <li key={p.key}>
                                    <button
                                        type="button"
                                        className={`adm-mix-item${filterKey === p.key ? ' active' : ''}`}
                                        onClick={() => setFilterKey(filterKey === p.key ? 'all' : p.key)}
                                        aria-pressed={filterKey === p.key}
                                    >
                                        <span className="adm-key" style={{ background: p.color }} aria-hidden />
                                        <span className="adm-mix-label">{p.label}</span>
                                        <span className="adm-mix-count">{p.count}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {/* Users */}
                <section className="panel panel-flush span-12">
                    <div className="adm-toolbar">
                        <div className="adm-search">
                            <Search size={16} aria-hidden />
                            <input
                                type="search"
                                className="form-input"
                                placeholder="ค้นหาชื่อ อีเมล หรือ UID"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                aria-label="ค้นหาผู้ใช้"
                            />
                            {searchTerm && (
                                <button type="button" className="adm-search-clear" onClick={() => setSearchTerm('')} aria-label="ล้างคำค้นหา">
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="adm-chips" role="group" aria-label="กรองตามสถานะ">
                        {statusChips.map(chip => (
                            <button
                                key={chip.key}
                                type="button"
                                className={`adm-chip${filterKey === chip.key ? ' active' : ''}`}
                                onClick={() => setFilterKey(chip.key)}
                                aria-pressed={filterKey === chip.key}
                            >
                                {chip.label}
                                <span className="adm-chip-n">{loading ? '…' : chip.count}</span>
                            </button>
                        ))}
                        {planFilterLabel && (
                            <button type="button" className="adm-chip active" onClick={() => setFilterKey('all')} aria-label={`ล้างตัวกรอง ${planFilterLabel}`}>
                                {planFilterLabel} <X size={13} aria-hidden />
                            </button>
                        )}
                    </div>

                    <div className="adm-list-meta">
                        <span>แสดง {displayedUsers.length.toLocaleString('th-TH')} จาก {stats.total.toLocaleString('th-TH')} บัญชี</span>
                        <label className="adm-sort">
                            <ArrowUpDown size={14} aria-hidden />
                            <span className="sr-only">เรียงลำดับ</span>
                            <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}>
                                {(Object.keys(SORT_LABELS) as SortKey[]).map(k => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
                            </select>
                        </label>
                    </div>

                    {loading ? (
                        <ul className="adm-list" aria-busy="true">
                            {Array.from({ length: 6 }, (_, i) => (
                                <li key={i} className="adm-row adm-row-skel"><span className="adm-avatar" /><span className="adm-skel-line" /></li>
                            ))}
                        </ul>
                    ) : displayedUsers.length === 0 ? (
                        <div className="adm-empty">
                            <Users size={28} aria-hidden />
                            <p className="adm-empty-title">ไม่พบผู้ใช้ที่ตรงกับเงื่อนไข</p>
                            {(searchTerm || filterKey !== 'all') && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setSearchTerm(''); setFilterKey('all'); }}>
                                    ล้างการค้นหาและตัวกรอง
                                </button>
                            )}
                        </div>
                    ) : (
                        <ul className="adm-list">
                            <li className="adm-list-head" aria-hidden>
                                <span>ผู้ใช้</span>
                                <span>แพ็กเกจ</span>
                                <span>สถานะ</span>
                                <span>สมัครเมื่อ</span>
                                <span />
                            </li>
                            {displayedUsers.map(u => {
                                const busy = processingId === u.uid;
                                return (
                                    <li key={u.uid}>
                                        <button
                                            type="button"
                                            className={`adm-row${selectedUid === u.uid ? ' selected' : ''}`}
                                            onClick={() => setSelectedUid(u.uid)}
                                        >
                                            <span className="adm-who">
                                                <Initials name={u.display_name} email={u.email} />
                                                <span className="adm-who-text">
                                                    <span className="adm-name">
                                                        {u.display_name || 'ไม่ระบุชื่อ'}
                                                        {u.role === 'admin' && <Crown size={13} className="adm-crown" aria-label="ผู้ดูแลระบบ" />}
                                                    </span>
                                                    <span className="adm-email">{u.email || '—'}</span>
                                                </span>
                                            </span>
                                            <span className="adm-plan">{licenseShort(u.license)}<span className="adm-plan-cycle">{u.license?.startsWith('yearly_') ? ' · ปี' : u.license?.startsWith('monthly_') ? ' · เดือน' : ''}</span></span>
                                            <span className="adm-status">
                                                {busy ? <Loader2 size={14} className="spin" aria-label="กำลังบันทึก" /> : <StatusBadge u={u} />}
                                            </span>
                                            <span className="adm-joined">{fmtDate(u.created_at)}</span>
                                            <ChevronRight size={16} className="adm-go" aria-hidden />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>
            </div>

            {selectedUser && (
                <UserSheet
                    u={selectedUser}
                    onClose={closeSheet}
                    onBan={handleBan}
                    onUnban={handleUnban}
                    onRevoke={handleRevoke}
                    onSetLicense={handleSetLicense}
                    onExtendDays={handleExtendDays}
                    onVerifyEmail={handleVerifyEmail}
                    isProcessing={processingId === selectedUser.uid}
                />
            )}
        </div>
    );
}
