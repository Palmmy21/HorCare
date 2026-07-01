import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useFirestore } from '../../hooks/useFirestore';
import type { UserProfile, LicenseType } from '../../types';
import {
    Search, Loader2, CheckCircle, Clock, Shield, AlertTriangle,
    Users, UserCheck, Timer, XCircle, Key, Infinity as InfinityIcon,
    X, Mail, CalendarDays, Hash, BadgeCheck, ShieldAlert, Copy,
    Ban, RotateCcw, ShieldOff, Crown, Package, ChevronDown, MailCheck,
    RefreshCw, ShieldCheck, ShieldX, LogIn, CalendarPlus, TrendingUp,
    Filter, ArrowUpDown,
} from 'lucide-react';

type AdminUserRow = UserProfile & {
    email_verified?: boolean;
    last_sign_in?: string | null;
    has_firestore_profile?: boolean;
};

type FilterKey = 'all' | 'free' | 'small' | 'medium' | 'large' | 'active' | 'expired' | 'banned';
type SortKey = 'created_desc' | 'expiry_asc' | 'name_asc';

// ──────────────────────────────────────────────
// License display helpers
// ──────────────────────────────────────────────

interface LicenseStyle {
    label: string;
    shortLabel: string;
    color: string;
    bg: string;
    border: string;
}

const LICENSE_STYLES: Record<string, LicenseStyle> = {
    free:           { label: 'Free Plan',         shortLabel: 'Free',       color: '#FCD34D', bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.3)' },
    monthly_small:  { label: 'Start รายเดือน',    shortLabel: 'Start/เดือน',color: '#A5B4FC', bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.3)' },
    monthly_medium: { label: 'Plus รายเดือน',     shortLabel: 'Plus/เดือน', color: '#67E8F9', bg: 'rgba(6,182,212,0.15)',  border: 'rgba(6,182,212,0.3)' },
    monthly_large:  { label: 'Pro รายเดือน',      shortLabel: 'Pro/เดือน',  color: '#C4B5FD', bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.3)' },
    yearly_small:   { label: 'Start รายปี',       shortLabel: 'Start/ปี',   color: '#A5B4FC', bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.3)' },
    yearly_medium:  { label: 'Plus รายปี',        shortLabel: 'Plus/ปี',    color: '#67E8F9', bg: 'rgba(6,182,212,0.15)',  border: 'rgba(6,182,212,0.3)' },
    yearly_large:   { label: 'Pro รายปี',         shortLabel: 'Pro/ปี',     color: '#C4B5FD', bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.3)' },
    active:         { label: 'ตลอดชีพ',           shortLabel: 'ตลอดชีพ',   color: '#6EE7B7', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.3)' },
};

const LICENSE_OPTIONS: LicenseType[] = [
    'free', 'monthly_small', 'monthly_medium', 'monthly_large',
    'yearly_small', 'yearly_medium', 'yearly_large', 'active',
];

function getLicenseStyle(license: LicenseType): LicenseStyle {
    return LICENSE_STYLES[license] ?? {
        label: license, shortLabel: license,
        color: '#9CA3AF', bg: 'rgba(107,114,128,0.15)', border: 'rgba(107,114,128,0.3)',
    };
}

function getDaysLeft(isoDate: string): number {
    return Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86400000);
}

function isExpiredUser(u: AdminUserRow): boolean {
    if (!u.license?.startsWith('monthly_') && !u.license?.startsWith('yearly_')) return false;
    return u.current_period_end ? new Date(u.current_period_end) < new Date() : false;
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function UserAvatar({ name, email, size = 40 }: { name?: string; email?: string; size?: number }) {
    const initials = (name || email || '?').slice(0, 2).toUpperCase();
    return (
        <div style={{
            width: size, height: size, borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: size > 48 ? '1.25rem' : '0.875rem',
            flexShrink: 0, letterSpacing: '0.05em',
        }}>
            {initials}
        </div>
    );
}

function InfoRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: React.ReactNode; mono?: boolean }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
            padding: '0.75rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', paddingTop: '0.1rem', flexShrink: 0 }}>{icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>{label}</div>
                <div style={{ fontSize: '0.875rem', color: '#fff', fontWeight: 500, fontFamily: mono ? 'var(--font-mono)' : undefined, wordBreak: 'break-all' }}>{value}</div>
            </div>
        </div>
    );
}

function LicenseBadge({ license, expired = false, size = 'md' }: { license: LicenseType; expired?: boolean; size?: 'sm' | 'md' }) {
    const style = getLicenseStyle(license);
    const isSm = size === 'sm';
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: isSm ? '0.25rem' : '0.375rem',
            background: expired ? 'rgba(220,38,38,0.15)' : style.bg,
            color: expired ? '#FCA5A5' : style.color,
            border: `1px solid ${expired ? 'rgba(220,38,38,0.3)' : style.border}`,
            borderRadius: '999px',
            padding: isSm ? '0.2rem 0.5rem' : '0.3rem 0.75rem',
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
            {expired ? 'หมดอายุ' : isSm ? style.shortLabel : style.label}
        </span>
    );
}

// ──────────────────────────────────────────────
// Detail Panel
// ──────────────────────────────────────────────

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
    const [emailVerifyDone, setEmailVerifyDone] = useState(false);
    const [copied, setCopied] = useState(false);

    const isBanned = u.status === 'banned';
    const expired = isExpiredUser(u);
    const ls = getLicenseStyle(u.license);
    const daysLeft = u.current_period_end ? getDaysLeft(u.current_period_end) : null;

    const copyUID = () => {
        navigator.clipboard.writeText(u.uid);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <>
            <div
                onClick={onClose}
                style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
                    zIndex: 200, backdropFilter: 'blur(2px)',
                    animation: 'fadeIn 0.15s ease',
                }}
            />
            <div style={{
                position: 'fixed', top: 0, right: 0, height: '100vh',
                width: 'min(420px, 92vw)',
                background: '#1a1040', zIndex: 201, display: 'flex', flexDirection: 'column',
                boxShadow: '-8px 0 32px rgba(0,0,0,0.6)',
                animation: 'slideInRight 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
            }}>
                {/* Header */}
                <div style={{
                    background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
                    padding: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '1rem',
                    flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}>
                    <UserAvatar name={u.display_name} email={u.email} size={60} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.3, marginBottom: '0.25rem' }}>
                            {u.display_name || 'ไม่ระบุชื่อ'}
                        </div>
                        <div style={{ color: 'rgba(165,180,252,0.9)', fontSize: '0.8125rem', wordBreak: 'break-all', marginBottom: '0.625rem' }}>{u.email}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                            {isBanned && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(220,38,38,0.15)', color: '#FCA5A5', border: '1px solid rgba(220,38,38,0.3)', borderRadius: '999px', padding: '0.2rem 0.625rem', fontSize: '0.75rem', fontWeight: 700 }}>
                                    <Ban size={11} /> ถูกแบน
                                </span>
                            )}
                            <LicenseBadge license={u.license} expired={expired} />
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px',
                        color: '#A5B4FC', cursor: 'pointer', padding: '0.375rem',
                        display: 'flex', alignItems: 'center', flexShrink: 0,
                    }}>
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>

                    {/* Subscription info */}
                    {u.license !== 'free' && u.license !== 'active' && (
                        <div style={{ marginBottom: '1rem', padding: '1rem', background: expired ? 'rgba(220,38,38,0.07)' : 'rgba(99,102,241,0.07)', border: `1px solid ${expired ? 'rgba(220,38,38,0.2)' : ls.border}`, borderRadius: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: expired ? '#FCA5A5' : ls.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    สถานะการสมัครสมาชิก
                                </div>
                                <LicenseBadge license={u.license} expired={expired} size="sm" />
                            </div>
                            {u.current_period_end && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                                    <span style={{ color: 'rgba(255,255,255,0.5)' }}>วันหมดอายุ</span>
                                    <span style={{ color: expired ? '#FCA5A5' : '#fff', fontWeight: 600 }}>
                                        {new Date(u.current_period_end).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                                        {daysLeft !== null && (
                                            <span style={{ marginLeft: '0.5rem', color: daysLeft <= 0 ? '#FCA5A5' : daysLeft <= 7 ? '#FCD34D' : '#6EE7B7', fontSize: '0.75rem' }}>
                                                ({daysLeft <= 0 ? 'หมดแล้ว' : `${daysLeft} วัน`})
                                            </span>
                                        )}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Quick extend days */}
                    {u.license !== 'free' && u.license !== 'active' && (
                        <div style={{ marginBottom: '1rem', padding: '1rem', background: 'rgba(245,158,11,0.08)', borderRadius: '12px', border: '1px solid rgba(245,158,11,0.2)' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#FCD34D', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                <CalendarPlus size={13} /> ต่ออายุ
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                {[30, 90, 180, 365].map(days => (
                                    <button
                                        key={days}
                                        onClick={() => onExtendDays(u.uid, days)}
                                        disabled={isProcessing}
                                        style={{
                                            flex: 1, background: 'rgba(245,158,11,0.1)', color: '#FCD34D',
                                            border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px',
                                            padding: '0.5rem 0', fontSize: '0.8rem', fontWeight: 600,
                                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                                            opacity: isProcessing ? 0.5 : 1,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem',
                                        }}
                                    >
                                        {isProcessing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                                        +{days}วัน
                                    </button>
                                ))}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'rgba(245,158,11,0.6)', marginTop: '0.5rem' }}>
                                ต่อจากวันหมดอายุปัจจุบัน (หรือจากวันนี้ถ้าหมดแล้ว)
                            </div>
                        </div>
                    )}

                    {/* Change plan */}
                    <div style={{ marginBottom: '1rem', padding: '1rem', background: 'rgba(139,92,246,0.08)', borderRadius: '12px', border: '1px solid rgba(139,92,246,0.2)' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#A78BFA', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                            <Package size={13} /> เปลี่ยนแพ็กเกจ
                        </div>
                        <div style={{ position: 'relative' }}>
                            <button
                                onClick={() => setLicenseMenuOpen(v => !v)}
                                disabled={isProcessing}
                                style={{
                                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px',
                                    padding: '0.5rem 0.75rem', cursor: isProcessing ? 'not-allowed' : 'pointer',
                                    fontSize: '0.8125rem', fontWeight: 600, color: '#C4B5FD',
                                    opacity: isProcessing ? 0.5 : 1,
                                }}
                            >
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Package size={13} />
                                    {getLicenseStyle(u.license).label}
                                </span>
                                <ChevronDown size={14} style={{ transition: 'transform 0.2s', transform: licenseMenuOpen ? 'rotate(180deg)' : 'none', opacity: 0.6 }} />
                            </button>
                            {licenseMenuOpen && (
                                <div style={{
                                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                                    background: '#1a1040', border: '1px solid rgba(139,92,246,0.3)',
                                    borderRadius: '10px', overflow: 'hidden',
                                    zIndex: 50, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                                }}>
                                    {LICENSE_OPTIONS.map(opt => {
                                        const s = getLicenseStyle(opt);
                                        return (
                                            <button
                                                key={opt}
                                                onClick={() => { onSetLicense(u.uid, opt); setLicenseMenuOpen(false); }}
                                                style={{
                                                    width: '100%', textAlign: 'left',
                                                    background: u.license === opt ? s.bg : 'transparent',
                                                    border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)',
                                                    padding: '0.5rem 0.75rem', cursor: 'pointer',
                                                    fontSize: '0.8125rem', fontWeight: u.license === opt ? 700 : 400,
                                                    color: u.license === opt ? s.color : 'rgba(255,255,255,0.7)',
                                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                }}
                                                onMouseEnter={e => { if (u.license !== opt) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                                                onMouseLeave={e => { if (u.license !== opt) e.currentTarget.style.background = 'transparent'; }}
                                            >
                                                {u.license === opt && <CheckCircle size={13} />}
                                                {s.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* User info */}
                    <InfoRow icon={<Mail size={15} />} label="อีเมล" value={u.email} />
                    <InfoRow
                        icon={u.email_verified ? <ShieldCheck size={15} /> : <ShieldX size={15} />}
                        label="ยืนยันอีเมล"
                        value={
                            u.email_verified === true
                                ? <span style={{ color: '#6EE7B7', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={13} /> ยืนยันแล้ว</span>
                                : u.email_verified === false
                                    ? <span style={{ color: '#FCA5A5', display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={13} /> ยังไม่ยืนยัน</span>
                                    : '—'
                        }
                    />
                    {u.last_sign_in && (
                        <InfoRow icon={<LogIn size={15} />} label="เข้าสู่ระบบล่าสุด" value={
                            new Date(u.last_sign_in).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        } />
                    )}
                    <InfoRow icon={<CalendarDays size={15} />} label="สมัครเมื่อ" value={
                        u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
                    } />
                    <InfoRow icon={<BadgeCheck size={15} />} label="ประเภทสิทธิ์" value={getLicenseStyle(u.license).label} />
                    {u.role && (
                        <InfoRow icon={<ShieldAlert size={15} />} label="บทบาท" value={
                            u.role === 'admin'
                                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#B45309' }}><Crown size={13} /> Admin</span>
                                : 'User'
                        } />
                    )}
                    <InfoRow
                        icon={<Hash size={15} />}
                        label="UID"
                        value={
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{u.uid}</span>
                                <button onClick={copyUID} title="คัดลอก UID" style={{
                                    background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.04)',
                                    border: '1px solid ' + (copied ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'),
                                    borderRadius: '6px', cursor: 'pointer', padding: '0.2rem',
                                    color: copied ? '#6EE7B7' : 'rgba(255,255,255,0.5)',
                                    display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                                    transition: 'all 0.15s',
                                }}>
                                    {copied ? <CheckCircle size={13} /> : <Copy size={13} />}
                                </button>
                            </span>
                        }
                    />
                    {u.has_firestore_profile === false && (
                        <div style={{ margin: '0.5rem 0', padding: '0.5rem 0.75rem', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, fontSize: '0.75rem', color: '#FCD34D', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <AlertTriangle size={12} /> ไม่มี Firestore profile (สมัครไม่สมบูรณ์)
                        </div>
                    )}

                    {/* Verify email */}
                    <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(6,182,212,0.08)', borderRadius: '12px', border: '1px solid rgba(6,182,212,0.2)' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#67E8F9', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                            <MailCheck size={13} /> ยืนยันอีเมล
                        </div>
                        <button
                            onClick={async () => {
                                setVerifyingEmail(true);
                                try { await onVerifyEmail(u.uid); setEmailVerifyDone(true); }
                                finally { setVerifyingEmail(false); }
                            }}
                            disabled={isProcessing || verifyingEmail || emailVerifyDone}
                            style={{
                                width: '100%',
                                background: emailVerifyDone ? 'rgba(16,185,129,0.1)' : 'rgba(6,182,212,0.1)',
                                color: emailVerifyDone ? '#6EE7B7' : '#67E8F9',
                                border: `1px solid ${emailVerifyDone ? 'rgba(16,185,129,0.3)' : 'rgba(6,182,212,0.3)'}`,
                                borderRadius: '8px', padding: '0.5rem 0.875rem',
                                fontSize: '0.8125rem', fontWeight: 600,
                                cursor: (isProcessing || verifyingEmail || emailVerifyDone) ? 'not-allowed' : 'pointer',
                                opacity: (isProcessing || verifyingEmail) ? 0.5 : 1,
                                display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: 'left',
                            }}
                        >
                            {verifyingEmail ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : emailVerifyDone ? <CheckCircle size={13} /> : <MailCheck size={13} />}
                            <span>
                                <span style={{ display: 'block' }}>{emailVerifyDone ? 'ยืนยันอีเมลแล้ว ✓' : 'ยืนยันอีเมลแทนผู้ใช้'}</span>
                                <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>force-verify ผ่าน Firebase Admin SDK</span>
                            </span>
                        </button>
                    </div>

                    {/* Danger zone */}
                    <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(220,38,38,0.08)', borderRadius: '12px', border: '1px solid rgba(220,38,38,0.2)' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#FCA5A5', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                            <Ban size={13} /> Danger Zone
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <button
                                onClick={() => onRevoke(u.uid)}
                                disabled={isProcessing || u.license === 'free'}
                                style={{
                                    background: u.license === 'free' ? 'rgba(255,255,255,0.02)' : 'rgba(245,158,11,0.1)',
                                    color: u.license === 'free' ? 'rgba(255,255,255,0.3)' : '#FCD34D',
                                    border: '1px solid ' + (u.license === 'free' ? 'rgba(255,255,255,0.05)' : 'rgba(245,158,11,0.3)'),
                                    borderRadius: '8px', padding: '0.5rem 0.875rem', fontSize: '0.8125rem', fontWeight: 600,
                                    cursor: (isProcessing || u.license === 'free') ? 'not-allowed' : 'pointer',
                                    opacity: isProcessing ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: 'left',
                                }}
                            >
                                <RotateCcw size={13} />
                                <span>
                                    <span style={{ display: 'block' }}>เพิกถอนสิทธิ์ (Revoke)</span>
                                    <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>reset license กลับเป็น Free plan</span>
                                </span>
                            </button>
                            {isBanned ? (
                                <button
                                    onClick={() => onUnban(u.uid)}
                                    disabled={isProcessing}
                                    style={{
                                        background: 'rgba(16,185,129,0.1)', color: '#6EE7B7', border: '1px solid rgba(16,185,129,0.3)',
                                        borderRadius: '8px', padding: '0.5rem 0.875rem', fontSize: '0.8125rem', fontWeight: 600,
                                        cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.5 : 1,
                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    }}
                                >
                                    <ShieldOff size={13} />
                                    <span>
                                        <span style={{ display: 'block' }}>ยกเลิกแบน (Unban)</span>
                                        <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>คืนค่าสถานะปกติให้ผู้ใช้งาน</span>
                                    </span>
                                </button>
                            ) : (
                                <button
                                    onClick={() => onBan(u.uid)}
                                    disabled={isProcessing}
                                    style={{
                                        background: 'rgba(220,38,38,0.1)', color: '#FCA5A5', border: '1px solid rgba(220,38,38,0.3)',
                                        borderRadius: '8px', padding: '0.5rem 0.875rem', fontSize: '0.8125rem', fontWeight: 600,
                                        cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.5 : 1,
                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    }}
                                >
                                    <Ban size={13} />
                                    <span>
                                        <span style={{ display: 'block' }}>แบนผู้ใช้งาน (Ban)</span>
                                        <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>บล็อคการเข้าถึงระบบทันที</span>
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', gap: '0.625rem', flexShrink: 0,
                }}>
                    {u.license !== 'active' ? (
                        <button
                            onClick={() => onSetLicense(u.uid, 'active')}
                            disabled={isProcessing}
                            style={{
                                flex: 1, background: 'linear-gradient(135deg, #16A34A 0%, #059669 100%)',
                                color: '#fff', border: 'none', borderRadius: '10px',
                                padding: '0.75rem', fontSize: '0.875rem', fontWeight: 600,
                                cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.5 : 1,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                                boxShadow: '0 2px 8px rgba(22,163,74,0.3)',
                            }}
                        >
                            {isProcessing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Key size={14} />}
                            ปลดล็อกถาวร (ตลอดชีพ)
                        </button>
                    ) : (
                        <div style={{ flex: 1, textAlign: 'center', color: '#34D399', fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem' }}>
                            <CheckCircle size={16} /> ใช้งานตลอดชีพแล้ว
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
                @keyframes slideInRight { from { transform: translateX(100%) } to { transform: translateX(0) } }
                @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
            `}</style>
        </>
    );
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

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

    const loadUsers = useCallback(async (showRefresh = false) => {
        if (!user) return;
        if (showRefresh) setRefreshing(true); else setLoading(true);
        setError(null);
        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/admin?action=list-users', {
                headers: { 'Authorization': `Bearer ${idToken}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as { users: AdminUserRow[] };
            setUsers(data.users);
        } catch (err: unknown) {
            setError((err as Error).message || 'ไม่สามารถโหลดข้อมูลได้');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [user]);

    useEffect(() => { loadUsers(); }, [loadUsers]);

    // Sync selected user after any refresh
    useEffect(() => {
        if (!selectedUser) return;
        const updated = users.find(u => u.uid === selectedUser.uid);
        if (updated) setSelectedUser(updated);
    }, [users]);

    // ── Stats ──
    const stats = useMemo(() => {
        const total    = users.length;
        const free     = users.filter(u => u.license === 'free').length;
        const small    = users.filter(u => u.license?.includes('small')).length;
        const medium   = users.filter(u => u.license?.includes('medium')).length;
        const large    = users.filter(u => u.license?.includes('large')).length;
        const lifetime = users.filter(u => u.license === 'active').length;
        const expired  = users.filter(isExpiredUser).length;
        const banned   = users.filter(u => u.status === 'banned').length;
        const paid     = small + medium + large + lifetime;
        return { total, free, small, medium, large, lifetime, expired, banned, paid };
    }, [users]);

    // ── Filter + sort ──
    const displayedUsers = useMemo(() => {
        let list = users.filter(u => {
            const q = searchTerm.toLowerCase();
            if (q && !u.email?.toLowerCase().includes(q) && !u.display_name?.toLowerCase().includes(q)) return false;
            if (filterKey === 'all')     return true;
            if (filterKey === 'free')    return u.license === 'free';
            if (filterKey === 'small')   return u.license?.includes('small');
            if (filterKey === 'medium')  return u.license?.includes('medium');
            if (filterKey === 'large')   return u.license?.includes('large');
            if (filterKey === 'active')  return u.license === 'active';
            if (filterKey === 'expired') return isExpiredUser(u);
            if (filterKey === 'banned')  return u.status === 'banned';
            return true;
        });
        list = [...list].sort((a, b) => {
            if (sortKey === 'created_desc') return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
            if (sortKey === 'expiry_asc') {
                const aExp = a.current_period_end ? new Date(a.current_period_end).getTime() : Infinity;
                const bExp = b.current_period_end ? new Date(b.current_period_end).getTime() : Infinity;
                return aExp - bExp;
            }
            if (sortKey === 'name_asc') return (a.display_name || '').localeCompare(b.display_name || '', 'th');
            return 0;
        });
        return list;
    }, [users, searchTerm, filterKey, sortKey]);

    // ── Handlers ──
    const handleBan = async (uid: string) => {
        if (!confirm('ยืนยันแบนผู้ใช้นี้?')) return;
        setProcessingId(uid);
        try { await updateUserLicense(uid, { status: 'banned' }); }
        catch (err) { console.error(err); }
        finally { setProcessingId(null); await loadUsers(true); }
    };

    const handleUnban = async (uid: string) => {
        setProcessingId(uid);
        try { await updateUserLicense(uid, { status: 'active' }); }
        catch (err) { console.error(err); }
        finally { setProcessingId(null); await loadUsers(true); }
    };

    const handleRevoke = async (uid: string) => {
        if (!confirm('ยืนยันเพิกถอนสิทธิ์? license จะถูก reset กลับเป็น Free plan')) return;
        setProcessingId(uid);
        try { await updateUserLicense(uid, { license: 'free', access_until: 0, subscription_status: undefined, current_period_end: undefined }); }
        catch (err) { console.error(err); }
        finally { setProcessingId(null); await loadUsers(true); }
    };

    const handleSetLicense = async (uid: string, license: LicenseType) => {
        const label = getLicenseStyle(license).label;
        if (!confirm(`เปลี่ยนแพ็กเกจเป็น "${label}" ให้กับผู้ใช้นี้?`)) return;
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
        } catch (err) { console.error(err); }
        finally { setProcessingId(null); await loadUsers(true); }
    };

    const handleExtendDays = async (uid: string, days: number) => {
        const u = users.find(x => x.uid === uid);
        if (!u) return;
        setProcessingId(uid);
        try {
            const now = Date.now();
            // Extend from current expiry if still valid, otherwise from today
            const baseMs = u.current_period_end
                ? Math.max(new Date(u.current_period_end).getTime(), now)
                : now;
            const newExpiry = new Date(baseMs + days * 86_400_000);
            await updateUserLicense(uid, {
                access_until: newExpiry.getTime(),
                current_period_end: newExpiry.toISOString(),
                subscription_status: 'active',
            });
        } catch (err) { console.error(err); }
        finally { setProcessingId(null); await loadUsers(true); }
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
        if (!confirm(`สร้าง Firestore profile ให้ ${missingProfileCount} user ที่ยังไม่มี?`)) return;
        setBackfilling(true);
        try {
            const idToken = await user!.getIdToken();
            const res = await fetch('/api/admin?action=backfill-profiles', {
                method: 'POST', headers: { 'Authorization': `Bearer ${idToken}` },
            });
            const data = await res.json() as { created: number };
            alert(`✅ สร้างแล้ว ${data.created} profiles`);
            await loadUsers(true);
        } catch (err) { alert('Error: ' + (err as Error).message); }
        finally { setBackfilling(false); }
    };

    const isAdmin = profile?.role === 'admin' || user?.email === 'horcare.admin@gmail.com';
    if (!isAdmin) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '16px', padding: '2rem 3rem', textAlign: 'center' }}>
                    <AlertTriangle size={48} color="#EF4444" style={{ margin: '0 auto 1rem' }} />
                    <h2 style={{ color: '#DC2626', fontWeight: 700 }}>Access Denied</h2>
                    <p style={{ color: '#6B7280' }}>คุณไม่มีสิทธิ์เข้าถึงหน้านี้</p>
                </div>
            </div>
        );
    }

    // Filter chip definitions
    const filterChips: { key: FilterKey; label: string; count: number; color: string }[] = [
        { key: 'all',     label: 'ทั้งหมด',  count: stats.total,    color: '#818CF8' },
        { key: 'free',    label: 'Free',     count: stats.free,     color: '#FCD34D' },
        { key: 'small',   label: 'Small',    count: stats.small,    color: '#A5B4FC' },
        { key: 'medium',  label: 'Medium',   count: stats.medium,   color: '#67E8F9' },
        { key: 'large',   label: 'Large',    count: stats.large,    color: '#C4B5FD' },
        { key: 'active',  label: 'ตลอดชีพ', count: stats.lifetime, color: '#6EE7B7' },
        { key: 'expired', label: 'หมดอายุ', count: stats.expired,  color: '#FCA5A5' },
        { key: 'banned',  label: 'แบน',      count: stats.banned,   color: '#F87171' },
    ];

    return (
        <div style={{
            background: 'linear-gradient(160deg, #0d0820 0%, #0a0a18 50%, #060414 100%)',
            borderRadius: '20px', padding: '1.5rem', margin: '-1rem', colorScheme: 'dark',
        }}>
            {/* Header */}
            <div style={{
                background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 50%, #1E1B4B 100%)',
                borderRadius: '16px', padding: '1.75rem 2rem', marginBottom: '1.5rem',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ background: 'rgba(255,255,255,0.12)', padding: '0.75rem', borderRadius: '12px', display: 'flex' }}>
                        <Shield size={28} color="#A5B4FC" />
                    </div>
                    <div>
                        <h1 style={{ color: '#fff', fontWeight: 800, fontSize: '1.375rem', margin: 0, letterSpacing: '-0.025em' }}>แผงควบคุมผู้ดูแลระบบ</h1>
                        <p style={{ color: 'rgba(165,180,252,0.8)', fontSize: '0.875rem', margin: 0 }}>จัดการสิทธิ์และข้อมูลผู้ใช้งาน HorCare</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
                    {missingProfileCount > 0 && (
                        <button onClick={handleBackfill} disabled={backfilling} style={{
                            background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)',
                            borderRadius: '10px', color: '#FCD34D', padding: '0.625rem 1.25rem',
                            cursor: backfilling ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 600,
                        }}>
                            {backfilling ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <AlertTriangle size={15} />}
                            สร้าง {missingProfileCount} profile ที่หาย
                        </button>
                    )}
                    <button onClick={() => loadUsers(true)} disabled={refreshing} style={{
                        background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '10px', color: '#C7D2FE', padding: '0.625rem 1.25rem',
                        cursor: refreshing ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 500,
                    }}>
                        <RefreshCw size={15} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
                        รีเฟรช
                    </button>
                </div>
            </div>

            {/* Stats cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.875rem', marginBottom: '1.25rem' }}>
                {[
                    { label: 'ผู้ใช้ทั้งหมด', value: stats.total,    color: '#818CF8', bg: 'rgba(99,102,241,0.15)',   icon: Users },
                    { label: 'Free Plan',     value: stats.free,     color: '#FCD34D', bg: 'rgba(245,158,11,0.15)',  icon: Timer },
                    { label: 'Small',         value: stats.small,    color: '#A5B4FC', bg: 'rgba(99,102,241,0.15)', icon: Package },
                    { label: 'Medium',        value: stats.medium,   color: '#67E8F9', bg: 'rgba(6,182,212,0.15)',  icon: Package },
                    { label: 'Large',         value: stats.large,    color: '#C4B5FD', bg: 'rgba(139,92,246,0.15)', icon: Package },
                    { label: 'ตลอดชีพ',      value: stats.lifetime, color: '#6EE7B7', bg: 'rgba(16,185,129,0.15)', icon: UserCheck },
                    { label: 'Paid ทั้งหมด', value: stats.paid,     color: '#A78BFA', bg: 'rgba(124,58,237,0.15)', icon: TrendingUp },
                    { label: 'หมดอายุ',      value: stats.expired,  color: '#FCA5A5', bg: 'rgba(220,38,38,0.15)',  icon: XCircle },
                ].map(s => {
                    const Icon = s.icon;
                    return (
                        <div key={s.label} style={{
                            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '14px', padding: '1.125rem', display: 'flex', flexDirection: 'column', gap: '0.625rem',
                        }}>
                            <div style={{ width: 36, height: 36, borderRadius: '9px', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Icon size={18} color={s.color} />
                            </div>
                            <div>
                                <div style={{ fontSize: '1.625rem', fontWeight: 700, color: '#fff', lineHeight: 1, fontFamily: 'var(--font-mono)' }}>
                                    {loading ? '—' : s.value}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.25rem' }}>{s.label}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* User table */}
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                {/* Toolbar */}
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {/* Search + sort */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
                            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)' }} />
                            <input
                                type="text"
                                placeholder="ค้นหาชื่อ หรือ อีเมล..."
                                className="form-input"
                                style={{ paddingLeft: '2.25rem', paddingTop: '0.625rem', paddingBottom: '0.625rem', fontSize: '0.875rem', width: '100%', background: 'rgba(255,255,255,0.04)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        {/* Sort */}
                        <div style={{ position: 'relative' }}>
                            <select
                                value={sortKey}
                                onChange={e => setSortKey(e.target.value as SortKey)}
                                style={{
                                    appearance: 'none', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '8px', color: 'rgba(255,255,255,0.7)', fontSize: '0.8125rem', fontWeight: 500,
                                    padding: '0.5rem 2rem 0.5rem 0.75rem', cursor: 'pointer',
                                }}
                            >
                                <option value="created_desc">สมัครล่าสุด</option>
                                <option value="expiry_asc">หมดอายุใกล้สุด</option>
                                <option value="name_asc">ชื่อ A-Z</option>
                            </select>
                            <ArrowUpDown size={13} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', pointerEvents: 'none' }} />
                        </div>
                        {error && (
                            <div style={{ color: '#FCA5A5', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                <AlertTriangle size={14} /> {error}
                            </div>
                        )}
                        <div style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.4)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                            {displayedUsers.length} / {stats.total} คน
                        </div>
                    </div>

                    {/* Filter chips */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <Filter size={14} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
                        {filterChips.map(chip => (
                            <button
                                key={chip.key}
                                onClick={() => setFilterKey(chip.key)}
                                style={{
                                    background: filterKey === chip.key ? `rgba(${chip.color === '#FCD34D' ? '245,158,11' : chip.color === '#818CF8' ? '99,102,241' : chip.color === '#A5B4FC' ? '99,102,241' : chip.color === '#67E8F9' ? '6,182,212' : chip.color === '#C4B5FD' ? '139,92,246' : chip.color === '#6EE7B7' ? '16,185,129' : '220,38,38'},0.2)` : 'rgba(255,255,255,0.04)',
                                    border: `1px solid ${filterKey === chip.key ? chip.color + '55' : 'rgba(255,255,255,0.08)'}`,
                                    borderRadius: '999px',
                                    color: filterKey === chip.key ? chip.color : 'rgba(255,255,255,0.5)',
                                    padding: '0.25rem 0.75rem', fontSize: '0.75rem', fontWeight: 600,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem',
                                    transition: 'all 0.15s',
                                }}
                            >
                                {chip.label}
                                <span style={{
                                    background: filterKey === chip.key ? chip.color + '33' : 'rgba(255,255,255,0.08)',
                                    color: filterKey === chip.key ? chip.color : 'rgba(255,255,255,0.4)',
                                    borderRadius: '999px', padding: '0.05rem 0.4rem', fontSize: '0.7rem', fontWeight: 700,
                                }}>
                                    {loading ? '…' : chip.count}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Table */}
                {loading ? (
                    <div style={{ padding: '4rem', textAlign: 'center' }}>
                        <Loader2 size={32} color="#6366F1" style={{ animation: 'spin 1s linear infinite', margin: '0 auto 0.75rem' }} />
                        <p style={{ color: '#9CA3AF', fontSize: '0.875rem' }}>กำลังโหลดข้อมูล...</p>
                    </div>
                ) : displayedUsers.length === 0 ? (
                    <div style={{ padding: '4rem', textAlign: 'center', color: '#9CA3AF' }}>ไม่พบผู้ใช้งาน</div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    {['ผู้ใช้งาน', 'แพ็กเกจ', 'วันเหลือ', 'สมัครเมื่อ', 'จัดการ'].map(h => (
                                        <th key={h} style={{ padding: '0.75rem 1rem', textAlign: h === 'ผู้ใช้งาน' ? 'left' : 'center', fontSize: '0.7rem', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {displayedUsers.map((u, i) => {
                                    const expired = isExpiredUser(u);
                                    const daysLeft = u.current_period_end ? getDaysLeft(u.current_period_end) : null;
                                    const isProcessing = processingId === u.uid;
                                    const isSelected = selectedUser?.uid === u.uid;
                                    let daysColor = '#6EE7B7'; let daysBg = 'rgba(16,185,129,0.12)';
                                    if (daysLeft !== null) {
                                        if (daysLeft <= 0)  { daysColor = '#FCA5A5'; daysBg = 'rgba(220,38,38,0.12)'; }
                                        else if (daysLeft <= 7) { daysColor = '#FCD34D'; daysBg = 'rgba(245,158,11,0.12)'; }
                                    }
                                    return (
                                        <tr
                                            key={u.uid}
                                            onClick={() => setSelectedUser(u)}
                                            style={{
                                                borderBottom: i < displayedUsers.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                                                cursor: 'pointer', background: isSelected ? 'rgba(99,102,241,0.15)' : 'transparent',
                                                transition: 'background 0.1s',
                                            }}
                                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'rgba(99,102,241,0.15)' : 'transparent'; }}
                                        >
                                            {/* User */}
                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <UserAvatar name={u.display_name} email={u.email} />
                                                    <div style={{ minWidth: 0 }}>
                                                        <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                                            {u.display_name || 'ไม่ระบุชื่อ'}
                                                            {u.status === 'banned' && <Ban size={12} color="#FCA5A5" />}
                                                            {u.role === 'admin' && <Crown size={12} color="#B45309" />}
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>{u.email}</div>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Plan */}
                                            <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                                                {u.status === 'banned' ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(220,38,38,0.15)', color: '#FCA5A5', border: '1px solid rgba(220,38,38,0.3)', borderRadius: '999px', padding: '0.25rem 0.625rem', fontSize: '0.7rem', fontWeight: 600 }}>
                                                        <Ban size={11} /> แบน
                                                    </span>
                                                ) : (
                                                    <LicenseBadge license={u.license} expired={expired} size="sm" />
                                                )}
                                            </td>

                                            {/* Days left */}
                                            <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                                                {u.license === 'active' ? (
                                                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.875rem' }}>∞</span>
                                                ) : daysLeft !== null ? (
                                                    <span style={{ display: 'inline-block', background: daysBg, color: daysColor, borderRadius: '8px', padding: '0.2rem 0.5rem', fontSize: '0.8125rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                                                        {daysLeft <= 0 ? 'หมดแล้ว' : `${daysLeft} วัน`}
                                                    </span>
                                                ) : <span style={{ color: 'rgba(255,255,255,0.25)' }}>—</span>}
                                            </td>

                                            {/* Created */}
                                            <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                                                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)' }}>
                                                    {u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH', { year: '2-digit', month: 'short', day: 'numeric' }) : '—'}
                                                </span>
                                            </td>

                                            {/* Actions */}
                                            <td style={{ padding: '0.875rem 1rem' }} onClick={e => e.stopPropagation()}>
                                                <div style={{ display: 'flex', gap: '0.375rem', justifyContent: 'center' }}>
                                                    {/* Extend +30 days quick action for paid users */}
                                                    {u.license !== 'free' && u.license !== 'active' && (
                                                        <button
                                                            onClick={() => handleExtendDays(u.uid, 30)}
                                                            disabled={isProcessing}
                                                            title="+30 วัน"
                                                            style={{
                                                                background: 'rgba(245,158,11,0.1)', color: '#FCD34D',
                                                                border: '1px solid rgba(245,158,11,0.3)', borderRadius: '7px',
                                                                padding: '0.3rem 0.5rem', fontSize: '0.75rem', fontWeight: 600,
                                                                cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.5 : 1,
                                                                display: 'flex', alignItems: 'center', gap: '0.2rem', whiteSpace: 'nowrap',
                                                            }}
                                                        >
                                                            {isProcessing ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <CalendarPlus size={11} />}
                                                            +30
                                                        </button>
                                                    )}
                                                    {/* Unlock forever */}
                                                    {u.license !== 'active' && (
                                                        <button
                                                            onClick={() => handleSetLicense(u.uid, 'active')}
                                                            disabled={isProcessing}
                                                            title="ปลดล็อกถาวร"
                                                            style={{
                                                                background: 'rgba(16,185,129,0.1)', color: '#6EE7B7',
                                                                border: '1px solid rgba(16,185,129,0.3)', borderRadius: '7px',
                                                                padding: '0.3rem 0.5rem', fontSize: '0.75rem', fontWeight: 600,
                                                                cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.5 : 1,
                                                                display: 'flex', alignItems: 'center', gap: '0.2rem', whiteSpace: 'nowrap',
                                                            }}
                                                        >
                                                            {isProcessing ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Key size={11} />}
                                                            ∞
                                                        </button>
                                                    )}
                                                    {u.license === 'active' && <CheckCircle size={16} color="#34D399" />}
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

            {/* Detail panel */}
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
