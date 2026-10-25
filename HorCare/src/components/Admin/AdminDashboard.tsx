import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useFirestore } from '../../hooks/useFirestore';
import type { UserProfile, LicenseType } from '../../types';
import { isAdminUser } from '../../shared/admin';
import {
    Search, Loader2, Clock, Shield, AlertTriangle,
    Users, Timer, XCircle, Key, Infinity as InfinityIcon,
    X, Copy, Ban, Crown, Package, ChevronDown,
    RefreshCw, CalendarPlus, Filter, ArrowUpDown,
    Download, Eye, Coins, Sparkles, Activity, Check, CheckCircle2,
} from 'lucide-react';

type AdminUserRow = UserProfile & {
    email_verified?: boolean;
    last_sign_in?: string | null;
    has_firestore_profile?: boolean;
};

type FilterKey = 'all' | 'paid' | 'free' | 'small' | 'medium' | 'large' | 'active' | 'expiring_soon' | 'expired' | 'banned';
type SortKey = 'created_desc' | 'created_asc' | 'expiry_asc' | 'name_asc';

interface LicenseStyle {
    label: string;
    shortLabel: string;
    color: string;
    bg: string;
    border: string;
}

const LICENSE_STYLES: Record<string, LicenseStyle> = {
    free:           { label: 'Free Plan',         shortLabel: 'Free',         color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.25)' },
    monthly_small:  { label: 'Start (รายเดือน)',   shortLabel: 'Start/ด.',    color: '#38BDF8', bg: 'rgba(14,165,233,0.12)',  border: 'rgba(14,165,233,0.28)' },
    monthly_medium: { label: 'Plus (รายเดือน)',    shortLabel: 'Plus/ด.',     color: '#818CF8', bg: 'rgba(99,102,241,0.12)',  border: 'rgba(99,102,241,0.28)' },
    monthly_large:  { label: 'HorCare (รายเดือน)', shortLabel: 'HorCare/ด.',  color: '#C084FC', bg: 'rgba(168,85,247,0.12)',  border: 'rgba(168,85,247,0.28)' },
    yearly_small:   { label: 'Start (รายปี)',      shortLabel: 'Start/ปี',    color: '#38BDF8', bg: 'rgba(14,165,233,0.12)',  border: 'rgba(14,165,233,0.28)' },
    yearly_medium:  { label: 'Plus (รายปี)',       shortLabel: 'Plus/ปี',     color: '#818CF8', bg: 'rgba(99,102,241,0.12)',  border: 'rgba(99,102,241,0.28)' },
    yearly_large:   { label: 'HorCare (รายปี)',    shortLabel: 'HorCare/ปี',   color: '#C084FC', bg: 'rgba(168,85,247,0.12)',  border: 'rgba(168,85,247,0.28)' },
    active:         { label: 'ตลอดชีพ (VIP)',      shortLabel: 'ตลอดชีพ',     color: '#34D399', bg: 'rgba(16,185,129,0.14)',  border: 'rgba(16,185,129,0.32)' },
};

const LICENSE_OPTIONS: LicenseType[] = [
    'free', 'monthly_small', 'yearly_small',
    'monthly_medium', 'yearly_medium',
    'monthly_large', 'yearly_large', 'active',
];

function getLicenseStyle(license?: LicenseType): LicenseStyle {
    if (!license) return LICENSE_STYLES.free;
    return LICENSE_STYLES[license] ?? {
        label: license, shortLabel: license,
        color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.25)',
    };
}

function getDaysLeft(isoDate: string): number {
    return Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86400000);
}

function isExpiredUser(u: AdminUserRow): boolean {
    if (!u.license?.startsWith('monthly_') && !u.license?.startsWith('yearly_')) return false;
    return u.current_period_end ? new Date(u.current_period_end) < new Date() : false;
}

function isExpiringSoon(u: AdminUserRow): boolean {
    if (!u.license?.startsWith('monthly_') && !u.license?.startsWith('yearly_')) return false;
    if (!u.current_period_end) return false;
    const days = getDaysLeft(u.current_period_end);
    return days > 0 && days <= 7;
}

/* User Avatar with Initials */
function UserAvatar({ name, email, size = 38 }: { name?: string; email?: string; size?: number }) {
    const initials = (name || email || '?').slice(0, 2).toUpperCase();
    return (
        <div style={{
            width: size, height: size, borderRadius: '12px',
            background: 'linear-gradient(135deg, #0284C7 0%, #0369A1 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#FFFFFF', fontWeight: 700, fontSize: size > 48 ? '1.25rem' : '0.8rem',
            flexShrink: 0, letterSpacing: '0.04em',
            boxShadow: '0 2px 8px rgba(2, 132, 199, 0.25)',
        }}>
            {initials}
        </div>
    );
}

/* License Pill Badge */
function LicenseBadge({ license, expired = false, size = 'md' }: { license: LicenseType; expired?: boolean; size?: 'sm' | 'md' }) {
    const style = getLicenseStyle(license);
    const isSm = size === 'sm';
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: isSm ? '0.25rem' : '0.35rem',
            background: expired ? 'rgba(239, 68, 68, 0.14)' : style.bg,
            color: expired ? '#F87171' : style.color,
            border: `1px solid ${expired ? 'rgba(239, 68, 68, 0.3)' : style.border}`,
            borderRadius: '999px',
            padding: isSm ? '0.15rem 0.55rem' : '0.25rem 0.75rem',
            fontSize: isSm ? '0.7rem' : '0.75rem',
            fontWeight: 600, whiteSpace: 'nowrap',
        }}>
            {expired
                ? <XCircle size={isSm ? 11 : 12} />
                : license === 'active'
                    ? <InfinityIcon size={isSm ? 11 : 12} />
                    : license === 'free'
                        ? <Clock size={isSm ? 11 : 12} />
                        : <Package size={isSm ? 11 : 12} />
            }
            {expired ? 'หมดอายุแล้ว' : isSm ? style.shortLabel : style.label}
        </span>
    );
}

/* User Detail Slide-over Panel */
function UserDetailPanel({ u, onClose, onBan, onUnban, onRevoke, onSetLicense, onExtendDays, onVerifyEmail, isProcessing }: {
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
    const [licenseMenuOpen, setLicenseMenuOpen] = useState(false);
    const [verifyingEmail, setVerifyingEmail] = useState(false);
    const [copied, setCopied] = useState(false);

    const isBanned = u.status === 'banned';
    const expired = isExpiredUser(u);
    const daysLeft = u.current_period_end ? getDaysLeft(u.current_period_end) : null;

    const copyUID = () => {
        navigator.clipboard.writeText(u.uid);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const handleVerify = async () => {
        setVerifyingEmail(true);
        try {
            await onVerifyEmail(u.uid);
        } finally {
            setVerifyingEmail(false);
        }
    };

    return (
        <>
            <div
                onClick={onClose}
                style={{
                    position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)',
                    zIndex: 200, backdropFilter: 'blur(6px)',
                }}
            />
            <div style={{
                position: 'fixed', top: 0, right: 0, height: '100vh',
                width: 'min(460px, 94vw)',
                background: '#0F172A', zIndex: 201, display: 'flex', flexDirection: 'column',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '-12px 0 40px rgba(0, 0, 0, 0.8)',
                color: '#F8FAFC',
            }}>
                {/* Header */}
                <div style={{
                    padding: '1.5rem', background: 'rgba(15, 23, 42, 0.95)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex', alignItems: 'flex-start', gap: '1rem',
                }}>
                    <UserAvatar name={u.display_name} email={u.email} size={54} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#FFFFFF', fontWeight: 700, fontSize: '1.15rem', marginBottom: '0.2rem' }}>
                            {u.display_name || 'ไม่ระบุชื่อ'}
                        </div>
                        <div style={{ color: '#94A3B8', fontSize: '0.825rem', wordBreak: 'break-all', marginBottom: '0.5rem' }}>
                            {u.email}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                            {isBanned && (
                                <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                    background: 'rgba(239,68,68,0.18)', color: '#F87171',
                                    border: '1px solid rgba(239,68,68,0.35)', borderRadius: '999px',
                                    padding: '0.15rem 0.6rem', fontSize: '0.72rem', fontWeight: 700,
                                }}>
                                    <Ban size={11} /> ถูกแบน (Banned)
                                </span>
                            )}
                            <LicenseBadge license={u.license} expired={expired} />
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '8px', color: '#94A3B8', cursor: 'pointer', padding: '0.4rem',
                            display: 'flex', alignItems: 'center',
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    
                    {/* Status & Expiry Box */}
                    {u.license !== 'free' && u.license !== 'active' && (
                        <div style={{
                            padding: '1.1rem', borderRadius: '14px',
                            background: expired ? 'rgba(239, 68, 68, 0.08)' : 'rgba(14, 165, 233, 0.08)',
                            border: `1px solid ${expired ? 'rgba(239, 68, 68, 0.25)' : 'rgba(14, 165, 233, 0.25)'}`,
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: expired ? '#F87171' : '#38BDF8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                    สถานะแพ็กเกจ
                                </span>
                                <LicenseBadge license={u.license} expired={expired} size="sm" />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                                <span style={{ color: '#94A3B8' }}>วันหมดอายุ</span>
                                <span style={{ fontWeight: 600, color: expired ? '#F87171' : '#FFFFFF' }}>
                                    {u.current_period_end ? new Date(u.current_period_end).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                                    {daysLeft !== null && (
                                        <span style={{ marginLeft: '0.5rem', color: daysLeft <= 0 ? '#F87171' : daysLeft <= 7 ? '#FBBF24' : '#34D399', fontSize: '0.75rem' }}>
                                            ({daysLeft <= 0 ? 'หมดอายุแล้ว' : `เหลือ ${daysLeft} วัน`})
                                        </span>
                                    )}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Quick Extend Access */}
                    <div style={{
                        padding: '1.1rem', borderRadius: '14px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#38BDF8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <CalendarPlus size={14} /> ต่ออายุการใช้งานทันที
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                            {[
                                { days: 30, label: '+30 วัน' },
                                { days: 90, label: '+90 วัน' },
                                { days: 180, label: '+6 เดือน' },
                                { days: 365, label: '+1 ปี' },
                            ].map(item => (
                                <button
                                    key={item.days}
                                    onClick={() => onExtendDays(u.uid, item.days)}
                                    disabled={isProcessing}
                                    style={{
                                        background: 'rgba(14, 165, 233, 0.12)', color: '#38BDF8',
                                        border: '1px solid rgba(14, 165, 233, 0.28)', borderRadius: '8px',
                                        padding: '0.55rem 0', fontSize: '0.8rem', fontWeight: 600,
                                        cursor: isProcessing ? 'not-allowed' : 'pointer',
                                        transition: 'all 0.15s ease',
                                    }}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Change Plan Tier */}
                    <div style={{
                        padding: '1.1rem', borderRadius: '14px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#A78BFA', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Package size={14} /> เปลี่ยนระดับแพ็กเกจ (Tier)
                        </div>
                        <div style={{ position: 'relative' }}>
                            <button
                                onClick={() => setLicenseMenuOpen(v => !v)}
                                disabled={isProcessing}
                                style={{
                                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.15)',
                                    borderRadius: '10px', padding: '0.65rem 0.85rem', cursor: 'pointer',
                                    color: '#FFFFFF', fontSize: '0.85rem', fontWeight: 600,
                                }}
                            >
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <Package size={14} color="#38BDF8" />
                                    {getLicenseStyle(u.license).label}
                                </span>
                                <ChevronDown size={15} style={{ transform: licenseMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: '#94A3B8' }} />
                            </button>

                            {licenseMenuOpen && (
                                <div style={{
                                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                                    background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.15)',
                                    borderRadius: '12px', overflow: 'hidden', zIndex: 60,
                                    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.6)',
                                }}>
                                    {LICENSE_OPTIONS.map(opt => {
                                        const s = getLicenseStyle(opt);
                                        const isSelected = u.license === opt;
                                        return (
                                            <button
                                                key={opt}
                                                onClick={() => {
                                                    setLicenseMenuOpen(false);
                                                    onSetLicense(u.uid, opt);
                                                }}
                                                style={{
                                                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                    padding: '0.65rem 0.85rem', background: isSelected ? 'rgba(14, 165, 233, 0.15)' : 'transparent',
                                                    border: 'none', borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                                    color: isSelected ? '#38BDF8' : '#F8FAFC', cursor: 'pointer',
                                                    fontSize: '0.825rem', fontWeight: isSelected ? 700 : 500, textAlign: 'left',
                                                }}
                                            >
                                                <span>{s.label}</span>
                                                {isSelected && <Check size={14} color="#38BDF8" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Metadata & Actions */}
                    <div style={{
                        padding: '1.1rem', borderRadius: '14px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        display: 'flex', flexDirection: 'column', gap: '0.75rem',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                            <span style={{ color: '#94A3B8' }}>User ID (UID)</span>
                            <button
                                onClick={copyUID}
                                style={{
                                    background: 'rgba(255, 255, 255, 0.06)', border: 'none', color: copied ? '#34D399' : '#38BDF8',
                                    borderRadius: '6px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem',
                                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                }}
                            >
                                {copied ? <Check size={12} /> : <Copy size={12} />}
                                {copied ? 'คัดลอกแล้ว!' : 'คัดลอก UID'}
                            </button>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748B', wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
                            {u.uid}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                            <span style={{ color: '#94A3B8' }}>ยืนยันอีเมล</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: u.email_verified ? '#34D399' : '#FBBF24', fontWeight: 600, fontSize: '0.78rem' }}>
                                    {u.email_verified ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน'}
                                </span>
                                {!u.email_verified && (
                                    <button
                                        onClick={handleVerify}
                                        disabled={verifyingEmail}
                                        style={{
                                            background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)',
                                            color: '#34D399', borderRadius: '6px', padding: '0.15rem 0.45rem', fontSize: '0.7rem',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {verifyingEmail ? '...' : 'บังคับยืนยัน'}
                                    </button>
                                )}
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                            <span style={{ color: '#94A3B8' }}>วันที่สมัครสมาชิก</span>
                            <span style={{ color: '#FFFFFF', fontWeight: 500 }}>
                                {u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                            </span>
                        </div>
                    </div>

                    {/* Dangerous Actions: Ban / Revoke */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                        {isBanned ? (
                            <button
                                onClick={() => onUnban(u.uid)}
                                disabled={isProcessing}
                                style={{
                                    flex: 1, padding: '0.75rem', borderRadius: '10px', border: 'none',
                                    background: 'rgba(16, 185, 129, 0.15)', color: '#34D399',
                                    cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                                }}
                            >
                                ปลดแบนผู้ใช้
                            </button>
                        ) : (
                            <button
                                onClick={() => onBan(u.uid)}
                                disabled={isProcessing}
                                style={{
                                    flex: 1, padding: '0.75rem', borderRadius: '10px', border: 'none',
                                    background: 'rgba(239, 68, 68, 0.15)', color: '#F87171',
                                    cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                                }}
                            >
                                <Ban size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.3rem' }} />
                                แบนผู้ใช้งาน
                            </button>
                        )}
                        <button
                            onClick={() => onRevoke(u.uid)}
                            disabled={isProcessing}
                            style={{
                                flex: 1, padding: '0.75rem', borderRadius: '10px',
                                background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.15)',
                                color: '#94A3B8', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                            }}
                        >
                            รีเซ็ตเป็น Free
                        </button>
                    </div>

                </div>

                {/* Footer Action */}
                <div style={{ padding: '1.25rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    {u.license !== 'active' ? (
                        <button
                            onClick={() => onSetLicense(u.uid, 'active')}
                            disabled={isProcessing}
                            style={{
                                width: '100%', padding: '0.85rem', borderRadius: '12px', border: 'none',
                                background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                                color: '#FFFFFF', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                boxShadow: '0 4px 16px rgba(16, 185, 129, 0.35)',
                            }}
                        >
                            <Key size={16} /> ปลดล็อกถาวรตลอดชีพ (Lifetime Access)
                        </button>
                    ) : (
                        <div style={{ textAlign: 'center', color: '#34D399', fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                            <CheckCircle2 size={18} /> ผู้ใช้นี้มีสิทธิ์ใช้งานตลอดชีพแล้ว
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

/* ──────────────────────────────────────────────
   Main Admin Dashboard Component
────────────────────────────────────────────── */
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
    const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);
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
            setLastSyncTime(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        } catch (err: unknown) {
            setError((err as Error).message || 'ไม่สามารถโหลดข้อมูลผู้ใช้งานได้');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [user]);

    useEffect(() => { loadUsers(); }, [loadUsers]);

    // Keep selectedUser in sync
    useEffect(() => {
        if (!selectedUser) return;
        const updated = users.find(u => u.uid === selectedUser.uid);
        if (updated) setSelectedUser(updated);
    }, [users]); // eslint-disable-line react-hooks/exhaustive-deps

    // Statistics Calculation
    const stats = useMemo(() => {
        const total = users.length;
        const free = users.filter(u => u.license === 'free').length;
        const small = users.filter(u => u.license?.includes('small')).length;
        const medium = users.filter(u => u.license?.includes('medium')).length;
        const large = users.filter(u => u.license?.includes('large')).length;
        const lifetime = users.filter(u => u.license === 'active').length;
        const expired = users.filter(isExpiredUser).length;
        const expiringSoon = users.filter(isExpiringSoon).length;
        const banned = users.filter(u => u.status === 'banned').length;
        const paid = small + medium + large + lifetime;

        // Estimated MRR calculation
        const mrr = users.reduce((sum, u) => {
            if (u.status === 'banned') return sum;
            if (isExpiredUser(u)) return sum;
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

    // Filter + Sort
    const displayedUsers = useMemo(() => {
        let list = users.filter(u => {
            const q = searchTerm.toLowerCase();
            if (q) {
                const matchName = u.display_name?.toLowerCase().includes(q);
                const matchEmail = u.email?.toLowerCase().includes(q);
                const matchUid = u.uid.toLowerCase().includes(q);
                if (!matchName && !matchEmail && !matchUid) return false;
            }
            if (filterKey === 'all') return true;
            if (filterKey === 'paid') return u.license !== 'free';
            if (filterKey === 'free') return u.license === 'free';
            if (filterKey === 'small') return u.license?.includes('small');
            if (filterKey === 'medium') return u.license?.includes('medium');
            if (filterKey === 'large') return u.license?.includes('large');
            if (filterKey === 'active') return u.license === 'active';
            if (filterKey === 'expiring_soon') return isExpiringSoon(u);
            if (filterKey === 'expired') return isExpiredUser(u);
            if (filterKey === 'banned') return u.status === 'banned';
            return true;
        });

        list = [...list].sort((a, b) => {
            if (sortKey === 'created_desc') {
                return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
            }
            if (sortKey === 'created_asc') {
                return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
            }
            if (sortKey === 'expiry_asc') {
                const aExp = a.current_period_end ? new Date(a.current_period_end).getTime() : Infinity;
                const bExp = b.current_period_end ? new Date(b.current_period_end).getTime() : Infinity;
                return aExp - bExp;
            }
            if (sortKey === 'name_asc') {
                return (a.display_name || '').localeCompare(b.display_name || '', 'th');
            }
            return 0;
        });
        return list;
    }, [users, searchTerm, filterKey, sortKey]);

    // Handlers
    const handleBan = async (uid: string) => {
        if (!confirm('ยืนยันแบนผู้ใช้นี้? บัญชีนี้จะไม่สามารถเข้าสู่ระบบได้ทันที')) return;
        setProcessingId(uid);
        try {
            await updateUserLicense(uid, { status: 'banned' });
        } catch (err) {
            console.error(err);
        } finally {
            setProcessingId(null);
            await loadUsers(true);
        }
    };

    const handleUnban = async (uid: string) => {
        setProcessingId(uid);
        try {
            await updateUserLicense(uid, { status: 'active' });
        } catch (err) {
            console.error(err);
        } finally {
            setProcessingId(null);
            await loadUsers(true);
        }
    };

    const handleRevoke = async (uid: string) => {
        if (!confirm('ยืนยันเพิกถอนสิทธิ์? ระบบจะรีเซ็ตแพ็กเกจของผู้ใช้นี้กลับเป็น Free plan')) return;
        setProcessingId(uid);
        try {
            await updateUserLicense(uid, {
                license: 'free',
                access_until: 0,
                subscription_status: undefined,
                current_period_end: undefined,
            });
        } catch (err) {
            console.error(err);
        } finally {
            setProcessingId(null);
            await loadUsers(true);
        }
    };

    const handleSetLicense = async (uid: string, license: LicenseType) => {
        const label = getLicenseStyle(license).label;
        if (!confirm(`ยืนยันการเปลี่ยนแพ็กเกจเป็น "${label}"?`)) return;
        setProcessingId(uid);
        try {
            const updates: Partial<UserProfile> = { license };
            if (license !== 'free' && license !== 'active') {
                const periodEnd = new Date();
                const isYearly = license.startsWith('yearly_');
                if (isYearly) periodEnd.setFullYear(periodEnd.getFullYear() + 1);
                else periodEnd.setMonth(periodEnd.getMonth() + 1);
                updates.plan_name = license.replace(/^(monthly|yearly)_/, '') as import('../../types').PlanName;
                updates.billing_cycle = (isYearly ? 'yearly' : 'monthly') as import('../../types').BillingCycle;
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
            await updateUserLicense(uid, updates);
        } catch (err) {
            console.error(err);
        } finally {
            setProcessingId(null);
            await loadUsers(true);
        }
    };

    const handleExtendDays = async (uid: string, days: number) => {
        const u = users.find(x => x.uid === uid);
        if (!u) return;
        setProcessingId(uid);
        try {
            const now = Date.now();
            const baseMs = u.current_period_end
                ? Math.max(new Date(u.current_period_end).getTime(), now)
                : now;
            const newExpiry = new Date(baseMs + days * 86_400_000);
            await updateUserLicense(uid, {
                access_until: newExpiry.getTime(),
                current_period_end: newExpiry.toISOString(),
                subscription_status: 'active',
            });
        } catch (err) {
            console.error(err);
        } finally {
            setProcessingId(null);
            await loadUsers(true);
        }
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
        if (!confirm(`สร้าง Firestore profile ให้กับ ${missingProfileCount} บัญชีที่ยังไม่มี?`)) return;
        setBackfilling(true);
        try {
            const idToken = await user!.getIdToken();
            const res = await fetch('/api/admin?action=backfill-profiles', {
                method: 'POST', headers: { 'Authorization': `Bearer ${idToken}` },
            });
            const data = await res.json() as { created: number };
            alert(`[สำเร็จ] สร้างโปรไฟล์สำเร็จแล้ว ${data.created} บัญชี`);
            await loadUsers(true);
        } catch (err) {
            alert('เกิดข้อผิดพลาด: ' + (err as Error).message);
        } finally {
            setBackfilling(false);
        }
    };

    // Export to CSV
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
        const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', background: '#090D16', color: '#F8FAFC' }}>
                <div style={{ background: '#1E293B', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '16px', padding: '2.5rem 3.5rem', textAlign: 'center' }}>
                    <AlertTriangle size={48} color="#EF4444" style={{ margin: '0 auto 1rem' }} />
                    <h2 style={{ color: '#F87171', fontWeight: 800 }}>Access Denied</h2>
                    <p style={{ color: '#94A3B8' }}>คุณไม่มีสิทธิ์เข้าถึงส่วนควบคุมผู้ดูแลระบบ</p>
                </div>
            </div>
        );
    }

    const filterChips: { key: FilterKey; label: string; count: number; color: string }[] = [
        { key: 'all',           label: 'ทั้งหมด',        count: stats.total,        color: '#38BDF8' },
        { key: 'paid',          label: 'ผู้ใช้จ่ายเงิน',   count: stats.paid,         color: '#34D399' },
        { key: 'free',          label: 'Free Plan',      count: stats.free,         color: '#94A3B8' },
        { key: 'small',         label: 'Start',          count: stats.small,        color: '#38BDF8' },
        { key: 'medium',        label: 'Plus',           count: stats.medium,       color: '#818CF8' },
        { key: 'large',         label: 'HorCare Pro',    count: stats.large,        color: '#C084FC' },
        { key: 'active',        label: 'ตลอดชีพ (VIP)',  count: stats.lifetime,     color: '#34D399' },
        { key: 'expiring_soon', label: 'ใกล้หมดอายุ',   count: stats.expiringSoon, color: '#FBBF24' },
        { key: 'expired',       label: 'หมดอายุแล้ว',    count: stats.expired,      color: '#F87171' },
        { key: 'banned',        label: 'ถูกแบน',        count: stats.banned,       color: '#EF4444' },
    ];

    return (
        <div className="admin-dashboard-page" style={{
            minHeight: '100vh',
            width: '100%',
            background: '#090D16',
            backgroundImage: 'radial-gradient(circle at 50% -10%, rgba(14, 165, 233, 0.08) 0%, rgba(9, 13, 22, 0) 60%)',
            color: '#F8FAFC',
            padding: '2rem 2.5rem 5rem',
            boxSizing: 'border-box',
            fontFamily: 'var(--font-sans)',
        }}>
            {/* Header Command Bar */}
            <div style={{
                background: 'rgba(15, 23, 42, 0.75)',
                backdropFilter: 'blur(16px)',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '1.25rem 1.75rem',
                marginBottom: '1.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '1rem',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: '12px',
                        background: 'rgba(14, 165, 233, 0.12)',
                        border: '1px solid rgba(14, 165, 233, 0.25)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#38BDF8',
                    }}>
                        <Shield size={22} />
                    </div>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <h1 style={{ color: '#FFFFFF', fontWeight: 800, fontSize: '1.35rem', margin: 0, letterSpacing: '-0.02em' }}>
                                แผงควบคุมผู้ดูแลระบบ (Admin Mission Control)
                            </h1>
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.25)',
                                color: '#34D399', borderRadius: '999px', padding: '0.1rem 0.5rem',
                                fontSize: '0.7rem', fontWeight: 700,
                            }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34D399' }} /> Live System
                            </span>
                        </div>
                        <p style={{ color: '#94A3B8', fontSize: '0.85rem', margin: '0.15rem 0 0' }}>
                            จัดการสิทธิ์ สมาชิกภาพ และข้อมูลผู้ใช้งานระบบ HorCare ทั่วประเทศ
                            {lastSyncTime && <span style={{ marginLeft: '0.5rem', color: '#64748B' }}>· ซิงค์ล่าสุด {lastSyncTime}</span>}
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {missingProfileCount > 0 && (
                        <button
                            onClick={handleBackfill}
                            disabled={backfilling}
                            style={{
                                background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)',
                                borderRadius: '10px', color: '#FBBF24', padding: '0.55rem 1rem',
                                cursor: backfilling ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.825rem', fontWeight: 600,
                            }}
                        >
                            {backfilling ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <AlertTriangle size={14} />}
                            ซ่อมแซม {missingProfileCount} โปรไฟล์ที่หาย
                        </button>
                    )}
                    <button
                        onClick={handleExportCSV}
                        style={{
                            background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '10px', color: '#CBD5E1', padding: '0.55rem 1rem',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
                            fontSize: '0.825rem', fontWeight: 600, transition: 'all 0.15s ease',
                        }}
                    >
                        <Download size={14} /> ส่งออก CSV
                    </button>
                    <button
                        onClick={() => loadUsers(true)}
                        disabled={refreshing}
                        style={{
                            background: 'linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%)',
                            border: 'none', borderRadius: '10px', color: '#FFFFFF',
                            padding: '0.55rem 1.15rem', cursor: refreshing ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: '0.45rem',
                            fontSize: '0.825rem', fontWeight: 600, boxShadow: '0 2px 8px rgba(2, 132, 199, 0.3)',
                        }}
                    >
                        <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
                        รีเฟรชข้อมูล
                    </button>
                </div>
            </div>

            {/* 8 Metric KPI Cards Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: '1rem',
                marginBottom: '1.5rem',
            }}>
                {[
                    { label: 'ผู้ใช้งานทั้งหมด', value: stats.total, sub: `${stats.paid} ผู้ใช้ชำระเงิน`, color: '#38BDF8', bg: 'rgba(14,165,233,0.12)', icon: Users },
                    { label: 'ประมาณการ MRR', value: `฿${stats.mrr.toLocaleString()}`, sub: 'รายได้เฉลี่ย/เดือน', color: '#34D399', bg: 'rgba(16,185,129,0.12)', icon: Coins },
                    { label: 'ตลอดชีพ (VIP)', value: stats.lifetime, sub: 'สิทธิ์ไม่จำกัด', color: '#A78BFA', bg: 'rgba(139,92,246,0.12)', icon: Crown },
                    { label: 'Start Plan', value: stats.small, sub: 'สูงสุด 50 ห้อง', color: '#38BDF8', bg: 'rgba(14,165,233,0.12)', icon: Package },
                    { label: 'Plus Plan', value: stats.medium, sub: 'สูงสุด 150 ห้อง', color: '#818CF8', bg: 'rgba(99,102,241,0.12)', icon: Package },
                    { label: 'HorCare Pro', value: stats.large, sub: 'ไม่จำกัดห้อง', color: '#C084FC', bg: 'rgba(168,85,247,0.12)', icon: Sparkles },
                    { label: 'ใกล้หมดอายุ (<7 วัน)', value: stats.expiringSoon, sub: 'ต้องติดตาม', color: '#FBBF24', bg: 'rgba(245,158,11,0.12)', icon: Timer },
                    { label: 'หมดอายุ / แบน', value: `${stats.expired} / ${stats.banned}`, sub: 'หมดสัญญา / ระงับ', color: '#F87171', bg: 'rgba(239,68,68,0.12)', icon: XCircle },
                ].map(s => {
                    const Icon = s.icon;
                    return (
                        <div key={s.label} style={{
                            background: 'rgba(15, 23, 42, 0.7)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '16px',
                            padding: '1.15rem 1.25rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.75rem',
                            backdropFilter: 'blur(12px)',
                            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.78rem', color: '#94A3B8', fontWeight: 500 }}>{s.label}</span>
                                <div style={{ width: 32, height: 32, borderRadius: '8px', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Icon size={16} color={s.color} />
                                </div>
                            </div>
                            <div>
                                <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#FFFFFF', lineHeight: 1, letterSpacing: '-0.02em' }}>
                                    {loading ? '…' : s.value}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.35rem' }}>{s.sub}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Plan Tier Distribution Progress Bar */}
            {stats.total > 0 && (
                <div style={{
                    background: 'rgba(15, 23, 42, 0.7)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '16px',
                    padding: '1rem 1.5rem',
                    marginBottom: '1.5rem',
                    backdropFilter: 'blur(12px)',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', fontSize: '0.8rem', color: '#94A3B8' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, color: '#CBD5E1' }}>
                            <Activity size={14} color="#38BDF8" /> สัดส่วนผู้ใช้งานตามแพ็กเกจ (Subscription Distribution)
                        </span>
                        <span>ชำระเงิน {stats.paid} คน ({Math.round((stats.paid / stats.total) * 100)}%)</span>
                    </div>
                    {/* Visual Bar */}
                    <div style={{ height: '8px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', display: 'flex', overflow: 'hidden', gap: '2px' }}>
                        <div style={{ width: `${(stats.free / stats.total) * 100}%`, background: '#64748B' }} title={`Free: ${stats.free}`} />
                        <div style={{ width: `${(stats.small / stats.total) * 100}%`, background: '#38BDF8' }} title={`Start: ${stats.small}`} />
                        <div style={{ width: `${(stats.medium / stats.total) * 100}%`, background: '#818CF8' }} title={`Plus: ${stats.medium}`} />
                        <div style={{ width: `${(stats.large / stats.total) * 100}%`, background: '#C084FC' }} title={`HorCare: ${stats.large}`} />
                        <div style={{ width: `${(stats.lifetime / stats.total) * 100}%`, background: '#34D399' }} title={`Lifetime: ${stats.lifetime}`} />
                    </div>
                    {/* Legend */}
                    <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.6rem', fontSize: '0.72rem', color: '#94A3B8', flexWrap: 'wrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#64748B' }} /> Free ({stats.free})</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38BDF8' }} /> Start ({stats.small})</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#818CF8' }} /> Plus ({stats.medium})</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#C084FC' }} /> HorCare Pro ({stats.large})</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#34D399' }} /> ตลอดชีพ ({stats.lifetime})</span>
                    </div>
                </div>
            )}

            {/* Main Interactive Table Card */}
            <div style={{
                background: 'rgba(15, 23, 42, 0.75)',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                overflow: 'hidden',
                backdropFilter: 'blur(16px)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            }}>
                {/* Search & Filter Toolbar */}
                <div style={{
                    padding: '1.25rem',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        {/* Search Input */}
                        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
                            <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#64748B' }} />
                            <input
                                type="text"
                                placeholder="ค้นหาชื่อ, อีเมล หรือ UID ของผู้ใช้..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '0.65rem 1rem 0.65rem 2.5rem',
                                    borderRadius: '10px',
                                    background: 'rgba(255, 255, 255, 0.04)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    color: '#FFFFFF',
                                    fontSize: '0.875rem',
                                    outline: 'none',
                                    boxSizing: 'border-box',
                                }}
                            />
                            {searchTerm && (
                                <button
                                    onClick={() => setSearchTerm('')}
                                    style={{
                                        position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                                        background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer',
                                    }}
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {/* Sort Selector */}
                        <div style={{ position: 'relative' }}>
                            <select
                                value={sortKey}
                                onChange={e => setSortKey(e.target.value as SortKey)}
                                style={{
                                    appearance: 'none',
                                    background: 'rgba(255, 255, 255, 0.04)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '10px',
                                    color: '#CBD5E1',
                                    fontSize: '0.825rem',
                                    fontWeight: 500,
                                    padding: '0.65rem 2.25rem 0.65rem 1rem',
                                    cursor: 'pointer',
                                    outline: 'none',
                                }}
                            >
                                <option value="created_desc" style={{ background: '#0F172A', color: '#fff' }}>สมัครล่าสุด (ใหม่ไปเก่า)</option>
                                <option value="created_asc" style={{ background: '#0F172A', color: '#fff' }}>สมัครก่อนหน้า (เก่าไปใหม่)</option>
                                <option value="expiry_asc" style={{ background: '#0F172A', color: '#fff' }}>หมดอายุใกล้สุด</option>
                                <option value="name_asc" style={{ background: '#0F172A', color: '#fff' }}>ชื่อ A-Z</option>
                            </select>
                            <ArrowUpDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' }} />
                        </div>

                        {error && (
                            <div style={{ color: '#F87171', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <AlertTriangle size={14} /> {error}
                            </div>
                        )}

                        <div style={{ fontSize: '0.825rem', color: '#64748B', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                            แสดง <strong style={{ color: '#F8FAFC' }}>{displayedUsers.length}</strong> จาก {stats.total} รายการ
                        </div>
                    </div>

                    {/* Filter Tabs Chips */}
                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <Filter size={13} style={{ color: '#64748B', flexShrink: 0, marginRight: '0.2rem' }} />
                        {filterChips.map(chip => {
                            const isSelected = filterKey === chip.key;
                            return (
                                <button
                                    key={chip.key}
                                    onClick={() => setFilterKey(chip.key)}
                                    style={{
                                        background: isSelected ? 'rgba(14, 165, 233, 0.16)' : 'rgba(255, 255, 255, 0.04)',
                                        border: `1px solid ${isSelected ? 'rgba(14, 165, 233, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                                        borderRadius: '999px',
                                        color: isSelected ? '#38BDF8' : '#94A3B8',
                                        padding: '0.3rem 0.75rem',
                                        fontSize: '0.75rem',
                                        fontWeight: isSelected ? 700 : 500,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        transition: 'all 0.15s ease',
                                    }}
                                >
                                    <span>{chip.label}</span>
                                    <span style={{
                                        background: isSelected ? 'rgba(14, 165, 233, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                                        color: isSelected ? '#38BDF8' : '#64748B',
                                        borderRadius: '999px', padding: '0.05rem 0.4rem', fontSize: '0.68rem', fontWeight: 700,
                                    }}>
                                        {loading ? '…' : chip.count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Table View */}
                {loading ? (
                    <div style={{ padding: '5rem 2rem', textAlign: 'center' }}>
                        <Loader2 size={36} color="#0EA5E9" style={{ animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }} />
                        <p style={{ color: '#94A3B8', fontSize: '0.9rem' }}>กำลังเชื่อมต่อและโหลดข้อมูลผู้ใช้...</p>
                    </div>
                ) : displayedUsers.length === 0 ? (
                    <div style={{ padding: '5rem 2rem', textAlign: 'center', color: '#64748B' }}>
                        <Users size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
                        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#94A3B8' }}>ไม่พบข้อมูลผู้ใช้งานที่ตรงกับเงื่อนไข</div>
                        <div style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>ลองปรับเปลี่ยนคำค้นหาหรือเลือกฟิลเตอร์อื่น</div>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ผู้ใช้งาน</th>
                                    <th style={{ padding: '0.85rem 1rem', fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>แพ็กเกจ</th>
                                    <th style={{ padding: '0.85rem 1rem', fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>อายุการใช้งาน</th>
                                    <th style={{ padding: '0.85rem 1rem', fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>วันที่สมัคร</th>
                                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>การจัดการด่วน</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayedUsers.map((u, i) => {
                                    const expired = isExpiredUser(u);
                                    const daysLeft = u.current_period_end ? getDaysLeft(u.current_period_end) : null;
                                    const isProcessing = processingId === u.uid;
                                    const isSelected = selectedUser?.uid === u.uid;

                                    return (
                                        <tr
                                            key={u.uid}
                                            onClick={() => setSelectedUser(u)}
                                            style={{
                                                borderBottom: i < displayedUsers.length - 1 ? '1px solid rgba(255, 255, 255, 0.04)' : 'none',
                                                cursor: 'pointer',
                                                background: isSelected ? 'rgba(14, 165, 233, 0.12)' : 'transparent',
                                                transition: 'background 0.15s ease',
                                            }}
                                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.025)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'rgba(14, 165, 233, 0.12)' : 'transparent'; }}
                                        >
                                            {/* User Info */}
                                            <td style={{ padding: '1rem 1.25rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                                                    <UserAvatar name={u.display_name} email={u.email} />
                                                    <div style={{ minWidth: 0 }}>
                                                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                            <span>{u.display_name || 'ไม่ระบุชื่อ'}</span>
                                                            {u.role === 'admin' && (
                                                                <span title="ผู้ดูแลระบบ (Admin)"><Crown size={13} color="#FBBF24" /></span>
                                                            )}
                                                            {u.status === 'banned' && (
                                                                <span style={{ color: '#F87171', fontSize: '0.7rem', background: 'rgba(239,68,68,0.15)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>แบน</span>
                                                            )}
                                                        </div>
                                                        <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: '0.15rem' }}>
                                                            {u.email}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Plan Badge */}
                                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                                                {u.status === 'banned' ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: 'rgba(239,68,68,0.15)', color: '#F87171', borderRadius: '999px', padding: '0.2rem 0.6rem', fontSize: '0.72rem', fontWeight: 600 }}>
                                                        <Ban size={11} /> ถูกระงับ
                                                    </span>
                                                ) : (
                                                    <LicenseBadge license={u.license} expired={expired} size="sm" />
                                                )}
                                            </td>

                                            {/* Days Left / Expiry */}
                                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                                                {u.license === 'active' ? (
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                                        color: '#34D399', fontSize: '0.8rem', fontWeight: 700,
                                                    }}>
                                                        <InfinityIcon size={13} /> ตลอดชีพ
                                                    </span>
                                                ) : daysLeft !== null ? (
                                                    <div>
                                                        <span style={{
                                                            display: 'inline-block',
                                                            background: daysLeft <= 0 ? 'rgba(239,68,68,0.15)' : daysLeft <= 7 ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)',
                                                            color: daysLeft <= 0 ? '#F87171' : daysLeft <= 7 ? '#FBBF24' : '#34D399',
                                                            borderRadius: '8px', padding: '0.2rem 0.55rem', fontSize: '0.8rem', fontWeight: 700,
                                                        }}>
                                                            {daysLeft <= 0 ? 'หมดอายุแล้ว' : `${daysLeft} วัน`}
                                                        </span>
                                                        {u.current_period_end && (
                                                            <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: '0.25rem' }}>
                                                                {new Date(u.current_period_end).toLocaleDateString('th-TH')}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span style={{ color: '#64748B', fontSize: '0.8rem' }}>—</span>
                                                )}
                                            </td>

                                            {/* Registration Date */}
                                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                                                <span style={{ fontSize: '0.8rem', color: '#94A3B8' }}>
                                                    {u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH', { year: '2-digit', month: 'short', day: 'numeric' }) : '—'}
                                                </span>
                                            </td>

                                            {/* Quick Actions */}
                                            <td style={{ padding: '1rem 1.25rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                                                <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center', alignItems: 'center' }}>
                                                    {/* +30 Days */}
                                                    {u.license !== 'free' && u.license !== 'active' && (
                                                        <button
                                                            onClick={() => handleExtendDays(u.uid, 30)}
                                                            disabled={isProcessing}
                                                            title="ต่ออายุ +30 วัน"
                                                            style={{
                                                                background: 'rgba(14, 165, 233, 0.12)', color: '#38BDF8',
                                                                border: '1px solid rgba(14, 165, 233, 0.3)', borderRadius: '8px',
                                                                padding: '0.35rem 0.65rem', fontSize: '0.75rem', fontWeight: 600,
                                                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                                                display: 'flex', alignItems: 'center', gap: '0.25rem',
                                                                transition: 'all 0.15s ease',
                                                            }}
                                                        >
                                                            {isProcessing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <CalendarPlus size={12} />}
                                                            +30 วัน
                                                        </button>
                                                    )}

                                                    {/* Lifetime unlock */}
                                                    {u.license !== 'active' && (
                                                        <button
                                                            onClick={() => handleSetLicense(u.uid, 'active')}
                                                            disabled={isProcessing}
                                                            title="ปลดล็อกตลอดชีพ"
                                                            style={{
                                                                background: 'rgba(16, 185, 129, 0.12)', color: '#34D399',
                                                                border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px',
                                                                padding: '0.35rem 0.65rem', fontSize: '0.75rem', fontWeight: 600,
                                                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                                                display: 'flex', alignItems: 'center', gap: '0.25rem',
                                                                transition: 'all 0.15s ease',
                                                            }}
                                                        >
                                                            {isProcessing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Key size={12} />}
                                                            ตลอดชีพ
                                                        </button>
                                                    )}

                                                    {/* View Detail Drawer */}
                                                    <button
                                                        onClick={() => setSelectedUser(u)}
                                                        title="ดูข้อมูลละเอียด"
                                                        style={{
                                                            background: 'rgba(255, 255, 255, 0.05)', color: '#CBD5E1',
                                                            border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px',
                                                            padding: '0.35rem 0.65rem', fontSize: '0.75rem', fontWeight: 500,
                                                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
                                                        }}
                                                    >
                                                        <Eye size={12} /> รายละเอียด
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* User Detail Slide Drawer */}
            {selectedUser && (
                <UserDetailPanel
                    u={selectedUser}
                    onClose={() => setSelectedUser(null)}
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
