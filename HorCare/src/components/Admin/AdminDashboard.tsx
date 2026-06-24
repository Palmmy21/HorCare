import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useFirestore } from '../../hooks/useFirestore';
import type { UserProfile, LicenseType } from '../../types';
import {
    Search, Loader2, CheckCircle, Clock, Shield, AlertTriangle,
    Users, UserCheck, Timer, XCircle, Key, Infinity as InfinityIcon,
    X, Mail, CalendarDays, Hash, BadgeCheck, ShieldAlert, Copy,
    Ban, RotateCcw, ShieldOff, Crown, Package, ChevronDown, MailCheck,
    RefreshCw, ShieldCheck, ShieldX, LogIn
} from 'lucide-react';

// Extended type that includes Firebase Auth fields not in Firestore
type AdminUserRow = UserProfile & {
    email_verified?: boolean;
    last_sign_in?: string | null;
    has_firestore_profile?: boolean;
};

const LICENSE_OPTIONS: { value: LicenseType; label: string; color: string; bg: string; border: string }[] = [
    { value: 'free',            label: 'Free (แผนฟรี)',             color: '#FCD34D', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)' },
    { value: 'monthly_small',  label: 'Small รายเดือน (฿79)',     color: '#A5B4FC', bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.3)' },
    { value: 'monthly_medium', label: 'Medium รายเดือน (฿259)',   color: '#67E8F9', bg: 'rgba(6,182,212,0.15)', border: 'rgba(6,182,212,0.3)' },
    { value: 'monthly_large',  label: 'Large รายเดือน (฿399)',    color: '#C4B5FD', bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.3)' },
    { value: 'yearly_small',   label: 'Small รายปี (฿790)',       color: '#A5B4FC', bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.3)' },
    { value: 'yearly_medium',  label: 'Medium รายปี (฿1,590)',    color: '#67E8F9', bg: 'rgba(6,182,212,0.15)', border: 'rgba(6,182,212,0.3)' },
    { value: 'yearly_large',   label: 'Large รายปี (฿2,590)',     color: '#C4B5FD', bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.3)' },
    { value: 'active',         label: 'Active (ตลอดชีพ)',         color: '#6EE7B7', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.3)' },
];

function licenseLabel(license: LicenseType): string {
    return LICENSE_OPTIONS.find(o => o.value === license)?.label ?? license;
}

function getDaysLeft(isoDate: string): number {
    return Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86400000);
}

function UserAvatar({ name, email, size = 40 }: { name?: string; email?: string; size?: number }) {
    const initials = (name || email || '?').slice(0, 2).toUpperCase();
    return (
        <div style={{
            width: size, height: size, borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: size > 48 ? '1.25rem' : '0.875rem',
            flexShrink: 0, letterSpacing: '0.05em'
        }}>
            {initials}
        </div>
    );
}

function InfoRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: React.ReactNode; mono?: boolean }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
            padding: '0.75rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', paddingTop: '0.1rem', flexShrink: 0 }}>{icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>{label}</div>
                <div style={{ fontSize: '0.875rem', color: '#fff', fontWeight: 500, fontFamily: mono ? 'var(--font-mono)' : undefined, wordBreak: 'break-all' }}>{value}</div>
            </div>
        </div>
    );
}

function UserDetailPanel({ u, onClose, onUnlock, onBan, onUnban, onRevoke, onSetLicense, onVerifyEmail, isProcessing }: {
    u: AdminUserRow;
    onClose: () => void;
    onUnlock: (uid: string) => void;
    onBan: (uid: string) => void;
    onUnban: (uid: string) => void;
    onRevoke: (uid: string) => void;
    onSetLicense: (uid: string, license: LicenseType) => void;
    onVerifyEmail: (uid: string) => Promise<void>;
    isProcessing: boolean;
}) {
    const [licenseMenuOpen, setLicenseMenuOpen] = useState(false);
    const [verifyingEmail, setVerifyingEmail] = useState(false);
    const [emailVerifyDone, setEmailVerifyDone] = useState(false);
    const isBanned = u.status === 'banned';
    let statusLabel = isBanned ? 'ถูกแบน' : 'ตลอดชีพ';
    let statusColor = isBanned ? '#FCA5A5' : '#6EE7B7';
    let statusBg = isBanned ? 'rgba(220,38,38,0.15)' : 'rgba(16,185,129,0.15)';
    let statusBorder = isBanned ? 'rgba(220,38,38,0.3)' : 'rgba(16,185,129,0.3)';
    if (!isBanned && u.license === 'free') {
        statusLabel = 'Free'; statusColor = '#FCD34D'; statusBg = 'rgba(245,158,11,0.15)'; statusBorder = 'rgba(245,158,11,0.3)';
    }

    const [copied, setCopied] = useState(false);
    const copyUID = () => {
        navigator.clipboard.writeText(u.uid);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
                    zIndex: 200, backdropFilter: 'blur(2px)',
                    animation: 'fadeIn 0.15s ease',
                }}
            />
            {/* Panel */}
            <div style={{
                position: 'fixed', top: 0, right: 0, height: '100vh',
                width: 'min(400px, 92vw)',
                background: '#1a1040', zIndex: 201, display: 'flex', flexDirection: 'column',
                boxShadow: '-8px 0 32px rgba(0,0,0,0.6)',
                animation: 'slideInRight 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
            }}>
                {/* Panel header */}
                <div style={{
                    background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
                    padding: '1.5rem',
                    display: 'flex', alignItems: 'flex-start', gap: '1rem',
                    flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)'
                }}>
                    <UserAvatar name={u.display_name} email={u.email} size={60} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.3, marginBottom: '0.25rem' }}>
                            {u.display_name || 'ไม่ระบุชื่อ'}
                        </div>
                        <div style={{ color: 'rgba(165,180,252,0.9)', fontSize: '0.8125rem', wordBreak: 'break-all' }}>{u.email}</div>
                        <span style={{ marginTop: '0.625rem' }}>
                            {isBanned && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(220,38,38,0.15)', color: '#FCA5A5', border: '1px solid rgba(220,38,38,0.3)', borderRadius: '999px', padding: '0.2rem 0.625rem', fontSize: '0.75rem', fontWeight: 700, marginRight: '0.4rem' }}>
                                    <Ban size={11} /> ถูกแบน
                                </span>
                            )}
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                background: statusBg, color: statusColor, border: `1px solid ${statusBorder}`,
                                borderRadius: '999px', padding: '0.2rem 0.625rem', fontSize: '0.75rem', fontWeight: 700,
                            }}>
                                {u.license === 'active' ? <InfinityIcon size={11} /> : u.license === 'free' ? <Clock size={11} /> : <Package size={11} />}
                                {statusLabel}
                            </span>
                        </span>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px',
                        color: '#A5B4FC', cursor: 'pointer', padding: '0.375rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                    }}>
                        <X size={18} />
                    </button>
                </div>

                {/* Panel body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
                    <InfoRow icon={<Mail size={15} />} label="อีเมล" value={u.email} />
                    <InfoRow icon={u.email_verified ? <ShieldCheck size={15} /> : <ShieldX size={15} />} label="ยืนยันอีเมล" value={
                        u.email_verified === true
                            ? <span style={{ color: '#6EE7B7', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={13} /> ยืนยันแล้ว</span>
                            : u.email_verified === false
                                ? <span style={{ color: '#FCA5A5', display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={13} /> ยังไม่ยืนยัน</span>
                                : '—'
                    } />
                    {u.last_sign_in && (
                        <InfoRow icon={<LogIn size={15} />} label="เข้าสู่ระบบล่าสุด" value={
                            new Date(u.last_sign_in).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        } />
                    )}
                    {u.has_firestore_profile === false && (
                        <div style={{ margin: '0.5rem 0', padding: '0.5rem 0.75rem', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, fontSize: '0.75rem', color: '#FCD34D', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <AlertTriangle size={12} /> ไม่มี Firestore profile (สมัครไม่สมบูรณ์)
                        </div>
                    )}
                    <InfoRow
                        icon={<Hash size={15} />}
                        label="UID"
                        value={
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{u.uid}</span>
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
                    <InfoRow icon={<CalendarDays size={15} />} label="สมัครเมื่อ" value={
                        u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH', {
                            year: 'numeric', month: 'long', day: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                        }) : '—'
                    } />
                    <InfoRow icon={<BadgeCheck size={15} />} label="ประเภทสิทธิ์" value={
                        licenseLabel(u.license)
                    } />
                    {u.role && (
                        <InfoRow icon={<ShieldAlert size={15} />} label="บทบาท" value={
                            u.role === 'admin'
                                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#B45309' }}><Crown size={13} /> Admin</span>
                                : 'User'
                        } />
                    )}

                    {/* Set License / Plan */}
                    <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'rgba(139,92,246,0.08)', borderRadius: '12px', border: '1px solid rgba(139,92,246,0.2)' }}>
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
                                    {licenseLabel(u.license)}
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
                                    {LICENSE_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            onClick={() => {
                                                onSetLicense(u.uid, opt.value);
                                                setLicenseMenuOpen(false);
                                            }}
                                            style={{
                                                width: '100%', textAlign: 'left',
                                                background: u.license === opt.value ? opt.bg : 'transparent',
                                                border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)',
                                                padding: '0.5rem 0.75rem', cursor: 'pointer',
                                                fontSize: '0.8125rem', fontWeight: u.license === opt.value ? 700 : 400,
                                                color: u.license === opt.value ? opt.color : 'rgba(255,255,255,0.7)',
                                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                transition: 'background 0.1s',
                                            }}
                                            onMouseEnter={e => { if (u.license !== opt.value) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                                            onMouseLeave={e => { if (u.license !== opt.value) e.currentTarget.style.background = 'transparent'; }}
                                        >
                                            {u.license === opt.value && <CheckCircle size={13} />}
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#8B5CF6', marginTop: '0.5rem', opacity: 0.8 }}>
                            ⚠️ Large plan จะเปิด Multi-Building ให้ผู้ใช้
                        </div>
                    </div>

                    {/* Verify Email */}
                    <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(6,182,212,0.08)', borderRadius: '12px', border: '1px solid rgba(6,182,212,0.2)' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#67E8F9', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                            <MailCheck size={13} /> ยืนยันอีเมล
                        </div>
                        <button
                            onClick={async () => {
                                setVerifyingEmail(true);
                                try {
                                    await onVerifyEmail(u.uid);
                                    setEmailVerifyDone(true);
                                } finally {
                                    setVerifyingEmail(false);
                                }
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

                    {/* Danger Zone */}
                    <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(220,38,38,0.08)', borderRadius: '12px', border: '1px solid rgba(220,38,38,0.2)' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#FCA5A5', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                            <Ban size={13} /> Danger Zone
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {/* Revoke */}
                            <button
                                onClick={() => onRevoke(u.uid)}
                                disabled={isProcessing || u.license === 'free'}
                                style={{
                                    background: u.license === 'free' ? 'rgba(255,255,255,0.02)' : 'rgba(245,158,11,0.1)', color: u.license === 'free' ? 'rgba(255,255,255,0.3)' : '#FCD34D',
                                    border: '1px solid ' + (u.license === 'free' ? 'rgba(255,255,255,0.05)' : 'rgba(245,158,11,0.3)'), borderRadius: '8px',
                                    padding: '0.5rem 0.875rem', fontSize: '0.8125rem', fontWeight: 600,
                                    cursor: (isProcessing || u.license === 'free') ? 'not-allowed' : 'pointer',
                                    opacity: isProcessing ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    textAlign: 'left',
                                }}
                            >
                                <RotateCcw size={13} />
                                <span>
                                    <span style={{ display: 'block' }}>เพิกถอนสิทธิ์ (Revoke)</span>
                                    <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>reset license กลับเป็น Free plan</span>
                                </span>
                            </button>
                            {/* Ban / Unban */}
                            {isBanned ? (
                                <button
                                    onClick={() => onUnban(u.uid)}
                                    disabled={isProcessing}
                                    style={{
                                        background: 'rgba(16,185,129,0.1)', color: '#6EE7B7', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px',
                                        padding: '0.5rem 0.875rem', fontSize: '0.8125rem', fontWeight: 600,
                                        cursor: isProcessing ? 'not-allowed' : 'pointer',
                                        opacity: isProcessing ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '0.5rem',
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
                                        background: 'rgba(220,38,38,0.1)', color: '#FCA5A5', border: '1px solid rgba(220,38,38,0.3)', borderRadius: '8px',
                                        padding: '0.5rem 0.875rem', fontSize: '0.8125rem', fontWeight: 600,
                                        cursor: isProcessing ? 'not-allowed' : 'pointer',
                                        opacity: isProcessing ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '0.5rem',
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
                {/* Panel footer actions */}
                <div style={{
                    padding: '1rem 1.25rem',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', gap: '0.625rem', flexWrap: 'wrap',
                    flexShrink: 0,
                }}>
                    <button
                        onClick={() => onSetLicense(u.uid, 'active')}
                        disabled={isProcessing}
                        style={{
                            flex: 1, background: 'rgba(245,158,11,0.1)', color: '#FCD34D',
                            border: '1px solid rgba(245,158,11,0.3)', borderRadius: '10px',
                            padding: '0.625rem', fontSize: '0.875rem', fontWeight: 600,
                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                            opacity: isProcessing ? 0.5 : 1,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                        }}
                    >
                        {isProcessing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Timer size={14} />}
                        +30 วัน
                    </button>
                    {u.license !== 'active' && (
                        <button
                            onClick={() => onUnlock(u.uid)}
                            disabled={isProcessing}
                            style={{
                                flex: 1, background: 'linear-gradient(135deg, #16A34A 0%, #059669 100%)',
                                color: '#fff', border: 'none', borderRadius: '10px',
                                padding: '0.625rem', fontSize: '0.875rem', fontWeight: 600,
                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                opacity: isProcessing ? 0.5 : 1,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                                boxShadow: '0 2px 8px rgba(22,163,74,0.3)',
                            }}
                        >
                            {isProcessing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Key size={14} />}
                            ปลดล็อกถาวร
                        </button>
                    )}
                    {u.license === 'active' && (
                        <div style={{ flex: 1, textAlign: 'center', color: '#16A34A', fontSize: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem' }}>
                            <CheckCircle size={16} /> ใช้งานตลอดชีพแล้ว
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
                @keyframes slideInRight { from { transform: translateX(100%) } to { transform: translateX(0) } }
                @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
            `}</style>
        </>
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
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);

    const loadUsers = useCallback(async (showRefresh = false) => {
        if (!user) return;
        if (showRefresh) setRefreshing(true); else setLoading(true);
        setError(null);
        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/admin-list-users', {
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

    // Sync selected user panel after refresh
    useEffect(() => {
        if (selectedUser) {
            const updated = users.find(u => u.uid === selectedUser.uid);
            if (updated) setSelectedUser(updated);
        }
    }, [users]);


    const handleUnlockForever = async (uid: string) => {
        if (!confirm('ยืนยันปลดล็อกถาวรให้กับผู้ใช้นี้?')) return;
        setProcessingId(uid);
        try {
            await updateUserLicense(uid, { license: 'active' });
        } catch (err) { console.error(err); }
        finally { setProcessingId(null); }
    };

    const handleBan = async (uid: string) => {
        if (!confirm('ยืนยันแบนผู้ใช้นี้? บัญชีของพวกเขาจะถูกบล็อคทันที')) return;
        setProcessingId(uid);
        try {
            await updateUserLicense(uid, { status: 'banned' });
        } catch (err) { console.error(err); }
        finally { setProcessingId(null); }
    };

    const handleUnban = async (uid: string) => {
        setProcessingId(uid);
        try {
            await updateUserLicense(uid, { status: 'active' });
        } catch (err) { console.error(err); }
        finally { setProcessingId(null); }
    };

    const handleRevoke = async (uid: string) => {
        if (!confirm('ยืนยันเพิกถอนสิทธิ์? license จะถูก reset กลับเป็น Free plan')) return;
        setProcessingId(uid);
        try {
            await updateUserLicense(uid, { license: 'free', access_until: 0 });
        } catch (err) { console.error(err); }
        finally { setProcessingId(null); }
    };

    const handleVerifyEmail = async (targetUid: string) => {
        const idToken = await user!.getIdToken();
        const res = await fetch('/api/admin-verify-email', {
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

    const handleSetLicense = async (uid: string, license: LicenseType) => {
        const opt = LICENSE_OPTIONS.find(o => o.value === license);
        if (!confirm(`เปลี่ยนแพ็กเกจเป็น "${opt?.label ?? license}" ให้กับผู้ใช้นี้?`)) return;
        setProcessingId(uid);
        try {
            const updates: Partial<UserProfile> = { license };
            // If switching to a paid plan, set subscription fields
            if (license !== 'free' && license !== 'active') {
                const periodEnd = new Date();
                const isYearly = license.startsWith('yearly_');
                if (isYearly) periodEnd.setFullYear(periodEnd.getFullYear() + 1);
                else periodEnd.setMonth(periodEnd.getMonth() + 1);
                const plan = license.replace(/^(monthly|yearly)_/, '') as import('../../types').PlanName;
                const cycle = (isYearly ? 'yearly' : 'monthly') as import('../../types').BillingCycle;
                updates.plan_name = plan;
                updates.billing_cycle = cycle;
                updates.subscription_status = 'active';
                updates.current_period_end = periodEnd.toISOString();
                updates.access_until = periodEnd.getTime(); // server-enforced expiry
                updates.subscription_id = `admin_demo_${Date.now()}`;
            }
            // If switching to active (lifetime), clear subscription fields.
            // access_until is cleared too — rules grant 'active' unconditionally.
            if (license === 'active') {
                updates.subscription_id = undefined;
                updates.subscription_status = undefined;
                updates.current_period_end = undefined;
                updates.access_until = undefined;
            }
            await updateUserLicense(uid, updates);
        } catch (err) { console.error(err); }
        finally { setProcessingId(null); }
    };

    const filteredUsers = users.filter(u =>
        u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.display_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const missingProfileCount = users.filter(u => !u.has_firestore_profile).length;
    const [backfilling, setBackfilling] = useState(false);

    const handleBackfill = async () => {
        if (!confirm(`สร้าง Firestore profile ให้ ${missingProfileCount} user ที่ยังไม่มี?`)) return;
        setBackfilling(true);
        try {
            const idToken = await user!.getIdToken();
            const res = await fetch('/api/admin-backfill-profiles', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${idToken}` },
            });
            const data = await res.json() as { created: number; message?: string };
            alert(`✅ สร้างแล้ว ${data.created} profiles`);
            await loadUsers(true);
        } catch (err) {
            alert('Error: ' + (err as Error).message);
        } finally {
            setBackfilling(false);
        }
    };

    const isAdmin = profile?.role === 'admin' || user?.email === 'horcare.admin@gmail.com';

    if (!isAdmin) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1rem' }}>
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '16px', padding: '2rem 3rem', textAlign: 'center' }}>
                    <AlertTriangle size={48} color="#EF4444" style={{ margin: '0 auto 1rem' }} />
                    <h2 style={{ color: '#DC2626', fontWeight: 700, marginBottom: '0.5rem' }}>Access Denied</h2>
                    <p style={{ color: '#6B7280' }}>คุณไม่มีสิทธิ์เข้าถึงหน้านี้</p>
                </div>
            </div>
        );
    }

    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.license === 'active').length;
    const paidUsers = users.filter(u => u.license !== 'free' && u.license !== 'active').length;
    const freeUsers = users.filter(u => u.license === 'free').length;
    const expiredUsers = users.filter(u => {
        if (!u.license?.startsWith('monthly_') && !u.license?.startsWith('yearly_')) return false;
        return u.current_period_end ? new Date(u.current_period_end) < new Date() : false;
    }).length;

    const statCards = [
        { label: 'ผู้ใช้ทั้งหมด', value: totalUsers, icon: Users, color: '#818CF8', bg: 'rgba(99,102,241,0.15)' },
        { label: 'Paid Plans', value: paidUsers, icon: Package, color: '#A78BFA', bg: 'rgba(124,58,237,0.15)' },
        { label: 'ตลอดชีพ', value: activeUsers, icon: UserCheck, color: '#34D399', bg: 'rgba(16,185,129,0.15)' },
        { label: 'Free', value: freeUsers, icon: Timer, color: '#FCD34D', bg: 'rgba(245,158,11,0.15)' },
        { label: 'หมดอายุ', value: expiredUsers, icon: XCircle, color: '#FCA5A5', bg: 'rgba(220,38,38,0.15)' },
    ];

    return (
        <div style={{
            background: 'linear-gradient(160deg, #0d0820 0%, #0a0a18 50%, #060414 100%)',
            borderRadius: '20px',
            padding: '1.5rem',
            margin: '-1rem',
            colorScheme: 'dark',
        }}>
            {/* Premium header */}
            <div style={{
                background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 50%, #1E1B4B 100%)',
                borderRadius: '16px', padding: '1.75rem 2rem', marginBottom: '1.5rem',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: '1rem',
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
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            fontSize: '0.875rem', fontWeight: 600,
                        }}>
                            {backfilling
                                ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                                : <AlertTriangle size={15} />}
                            สร้าง {missingProfileCount} profile ที่หาย
                        </button>
                    )}
                    <button onClick={() => loadUsers(true)} disabled={refreshing} style={{
                        background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '10px', color: '#C7D2FE', padding: '0.625rem 1.25rem',
                        cursor: refreshing ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        fontSize: '0.875rem', fontWeight: 500,
                    }}>
                        <RefreshCw size={15} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
                        รีเฟรช
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {statCards.map(s => {
                    const Icon = s.icon;
                    return (
                        <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div style={{ width: 40, height: 40, borderRadius: '10px', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Icon size={20} color={s.color} />
                            </div>
                            <div>
                                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#fff', lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{loading ? '—' : s.value}</div>
                                <div style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.25rem' }}>{s.label}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* User table card */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.08)' }}>
                {/* Search bar */}
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
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
                    {error && (
                        <div style={{ color: '#FCA5A5', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                            <AlertTriangle size={14} /> {error}
                        </div>
                    )}
                    <div style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.4)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                        {filteredUsers.length} / {totalUsers} คน
                    </div>
                </div>

                {loading ? (
                    <div style={{ padding: '4rem', textAlign: 'center' }}>
                        <Loader2 size={32} color="#6366F1" style={{ animation: 'spin 1s linear infinite', margin: '0 auto 0.75rem' }} />
                        <p style={{ color: '#9CA3AF', fontSize: '0.875rem' }}>กำลังโหลดข้อมูล...</p>
                    </div>
                ) : filteredUsers.length === 0 ? (
                    <div style={{ padding: '4rem', textAlign: 'center', color: '#9CA3AF' }}>ไม่พบข้อมูลผู้ใช้งานที่ค้นหา</div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    <th style={{ padding: '0.75rem 1.25rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ผู้ใช้งาน</th>
                                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>สถานะ</th>
                                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>วันที่เหลือ</th>
                                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>สมัครเมื่อ</th>
                                    <th style={{ padding: '0.75rem 1.25rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>จัดการ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.map((u, i) => {
                                    const isPaidPlan = u.license?.startsWith('monthly_') || u.license?.startsWith('yearly_');
                                    const isExpired = isPaidPlan && u.current_period_end ? new Date(u.current_period_end) < new Date() : false;
                                    const daysLeft = isPaidPlan && u.current_period_end ? getDaysLeft(u.current_period_end) : null;
                                    const isProcessing = processingId === u.uid;
                                    const isSelected = selectedUser?.uid === u.uid;

                                    let daysColor = '#6EE7B7'; let daysBg = 'rgba(16,185,129,0.15)';
                                    if (daysLeft !== null) {
                                        if (daysLeft <= 0) { daysColor = '#FCA5A5'; daysBg = 'rgba(220,38,38,0.15)'; }
                                        else if (daysLeft <= 7) { daysColor = '#FCD34D'; daysBg = 'rgba(245,158,11,0.15)'; }
                                    }

                                    return (
                                        <tr
                                            key={u.uid}
                                            onClick={() => setSelectedUser(u)}
                                            style={{
                                                borderBottom: i < filteredUsers.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                                                transition: 'background 0.1s',
                                                cursor: 'pointer',
                                                background: isSelected ? 'rgba(99,102,241,0.15)' : 'transparent',
                                            }}
                                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'rgba(99,102,241,0.15)' : 'transparent'; }}
                                        >
                                            <td style={{ padding: '0.875rem 1.25rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <UserAvatar name={u.display_name} email={u.email} />
                                                    <div>
                                                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff' }}>{u.display_name || 'ไม่ระบุชื่อ'}</div>
                                                        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>{u.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                                                {u.status === 'banned' ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', background: 'rgba(220,38,38,0.15)', color: '#FCA5A5', border: '1px solid rgba(220,38,38,0.3)', borderRadius: '999px', padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600 }}>
                                                        <Ban size={12} /> แบน
                                                    </span>
                                                ) : u.license === 'active' ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', background: 'rgba(16,185,129,0.15)', color: '#6EE7B7', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '999px', padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600 }}>
                                                        <InfinityIcon size={12} /> ตลอดชีพ
                                                    </span>
                                                ) : isExpired ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', background: 'rgba(220,38,38,0.15)', color: '#FCA5A5', border: '1px solid rgba(220,38,38,0.3)', borderRadius: '999px', padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600 }}>
                                                        <XCircle size={12} /> หมดอายุ
                                                    </span>
                                                ) : (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', background: 'rgba(245,158,11,0.15)', color: '#FCD34D', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '999px', padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600 }}>
                                                        <Clock size={12} /> ทดลองใช้
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                                                {u.license === 'active' ? (
                                                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.875rem' }}>∞</span>
                                                ) : daysLeft !== null ? (
                                                    <span style={{ display: 'inline-block', background: daysBg, color: daysColor, borderRadius: '8px', padding: '0.25rem 0.625rem', fontSize: '0.875rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                                                        {daysLeft <= 0 ? 'หมดแล้ว' : `${daysLeft} วัน`}
                                                    </span>
                                                ) : <span style={{ color: 'rgba(255,255,255,0.3)' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                <span style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.5)' }}>
                                                    {u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH', { year: '2-digit', month: 'short', day: 'numeric' }) : '—'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '0.875rem 1.25rem' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                                                    {u.license !== 'active' && (
                                                        <button
                                                            onClick={() => handleUnlockForever(u.uid)}
                                                            disabled={isProcessing}
                                                            style={{ background: 'rgba(16,185,129,0.1)', color: '#6EE7B7', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', padding: '0.375rem 0.75rem', fontSize: '0.8rem', fontWeight: 600, cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '0.375rem', whiteSpace: 'nowrap' }}
                                                        >
                                                            {isProcessing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Key size={12} />}ปลดล็อก
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

            {/* User detail panel */}
            {selectedUser && (
                <UserDetailPanel
                    u={selectedUser}
                    onClose={() => setSelectedUser(null)}
                    onUnlock={handleUnlockForever}
                    onBan={handleBan}
                    onUnban={handleUnban}
                    onRevoke={handleRevoke}
                    onSetLicense={handleSetLicense}
                    onVerifyEmail={handleVerifyEmail}
                    isProcessing={processingId === selectedUser.uid}
                />
            )}
        </div>
    );
}
