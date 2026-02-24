import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useFirestore } from '../../hooks/useFirestore';
import type { UserProfile } from '../../types';
import {
    Search, Loader2, CheckCircle, Clock, Shield, AlertTriangle,
    Users, UserCheck, Timer, XCircle, RefreshCw, Key, Infinity,
    X, Mail, CalendarDays, Hash, BadgeCheck, ShieldAlert, Copy,
    Ban, RotateCcw, ShieldOff
} from 'lucide-react';

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
            padding: '0.75rem 0', borderBottom: '1px solid #F3F4F6'
        }}>
            <div style={{ color: '#9CA3AF', paddingTop: '0.1rem', flexShrink: 0 }}>{icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.7rem', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>{label}</div>
                <div style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 500, fontFamily: mono ? 'var(--font-mono)' : undefined, wordBreak: 'break-all' }}>{value}</div>
            </div>
        </div>
    );
}

function UserDetailPanel({ u, onClose, onExtend, onUnlock, onBan, onUnban, onRevoke, isProcessing }: {
    u: UserProfile;
    onClose: () => void;
    onExtend: (uid: string) => void;
    onUnlock: (uid: string) => void;
    onBan: (uid: string) => void;
    onUnban: (uid: string) => void;
    onRevoke: (uid: string) => void;
    isProcessing: boolean;
}) {
    const isBanned = u.status === 'banned';
    const isExpired = u.license === 'trial' && u.trial_expires_at && new Date(u.trial_expires_at) < new Date();
    const daysLeft = u.license === 'trial' && u.trial_expires_at ? getDaysLeft(u.trial_expires_at) : null;

    let statusLabel = isBanned ? 'ถูกแบน' : 'ตลอดชีพ';
    let statusColor = isBanned ? '#DC2626' : '#16A34A';
    let statusBg = isBanned ? '#FEF2F2' : '#F0FDF4';
    let statusBorder = isBanned ? '#FECACA' : '#BBF7D0';
    if (!isBanned && u.license === 'trial') {
        if (isExpired) { statusLabel = 'หมดอายุ'; statusColor = '#DC2626'; statusBg = '#FEF2F2'; statusBorder = '#FECACA'; }
        else { statusLabel = 'ทดลองใช้'; statusColor = '#D97706'; statusBg = '#FFFBEB'; statusBorder = '#FDE68A'; }
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
                background: '#fff', zIndex: 201, display: 'flex', flexDirection: 'column',
                boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
                animation: 'slideInRight 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}>
                {/* Panel header */}
                <div style={{
                    background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
                    padding: '1.5rem',
                    display: 'flex', alignItems: 'flex-start', gap: '1rem',
                    flexShrink: 0,
                }}>
                    <UserAvatar name={u.display_name} email={u.email} size={60} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.3, marginBottom: '0.25rem' }}>
                            {u.display_name || 'ไม่ระบุชื่อ'}
                        </div>
                        <div style={{ color: 'rgba(165,180,252,0.9)', fontSize: '0.8125rem', wordBreak: 'break-all' }}>{u.email}</div>
                        <span style={{ marginTop: '0.625rem' }}>
                            {isBanned && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: '999px', padding: '0.2rem 0.625rem', fontSize: '0.75rem', fontWeight: 700, marginRight: '0.4rem' }}>
                                    <Ban size={11} /> ถูกแบน
                                </span>
                            )}
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                background: statusBg, color: statusColor, border: `1px solid ${statusBorder}`,
                                borderRadius: '999px', padding: '0.2rem 0.625rem', fontSize: '0.75rem', fontWeight: 700,
                            }}>
                                {u.license === 'active' ? <Infinity size={11} /> : isExpired ? <XCircle size={11} /> : <Clock size={11} />}
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
                    <InfoRow
                        icon={<Hash size={15} />}
                        label="UID"
                        value={
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{u.uid}</span>
                                <button onClick={copyUID} title="คัดลอก UID" style={{
                                    background: copied ? '#F0FDF4' : '#F9FAFB',
                                    border: '1px solid ' + (copied ? '#BBF7D0' : '#E5E7EB'),
                                    borderRadius: '6px', cursor: 'pointer', padding: '0.2rem',
                                    color: copied ? '#16A34A' : '#6B7280',
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
                        u.license === 'active' ? 'ตลอดชีพ (Active)' : 'ทดลองใช้ (Trial)'
                    } />
                    {u.license === 'trial' && u.trial_expires_at && (
                        <InfoRow icon={<Timer size={15} />} label="หมดอายุ" value={
                            <span>
                                <span style={{ display: 'block' }}>{new Date(u.trial_expires_at).toLocaleDateString('th-TH', {
                                    year: 'numeric', month: 'long', day: 'numeric'
                                })}</span>
                                {daysLeft !== null && (
                                    <span style={{
                                        marginTop: '0.25rem', display: 'inline-block',
                                        fontWeight: 700, fontSize: '0.875rem',
                                        color: daysLeft <= 0 ? '#DC2626' : daysLeft <= 7 ? '#D97706' : '#16A34A'
                                    }}>
                                        {daysLeft <= 0 ? '⚠️ หมดอายุแล้ว' : `เหลืออีก ${daysLeft} วัน`}
                                    </span>
                                )}
                            </span>
                        } />
                    )}
                    {u.role && (
                        <InfoRow icon={<ShieldAlert size={15} />} label="บทบาท" value={u.role === 'admin' ? '👑 Admin' : 'User'} />
                    )}

                    {/* Danger Zone */}
                    <div style={{ marginTop: '1.25rem', padding: '1rem', background: '#FEF2F2', borderRadius: '12px', border: '1px solid #FECACA' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                            <Ban size={13} /> Danger Zone
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {/* Revoke */}
                            <button
                                onClick={() => onRevoke(u.uid)}
                                disabled={isProcessing || u.license === 'trial'}
                                style={{
                                    background: u.license === 'trial' ? '#F9FAFB' : '#FEF3C7', color: u.license === 'trial' ? '#9CA3AF' : '#92400E',
                                    border: '1px solid ' + (u.license === 'trial' ? '#E5E7EB' : '#FDE68A'), borderRadius: '8px',
                                    padding: '0.5rem 0.875rem', fontSize: '0.8125rem', fontWeight: 600,
                                    cursor: (isProcessing || u.license === 'trial') ? 'not-allowed' : 'pointer',
                                    opacity: isProcessing ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    textAlign: 'left',
                                }}
                            >
                                <RotateCcw size={13} />
                                <span>
                                    <span style={{ display: 'block' }}>เพิกถอนสิทธิ์ (Revoke)</span>
                                    <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>เปลี่ยน license เป็น trial ที่หมดอายุทันที</span>
                                </span>
                            </button>
                            {/* Ban / Unban */}
                            {isBanned ? (
                                <button
                                    onClick={() => onUnban(u.uid)}
                                    disabled={isProcessing}
                                    style={{
                                        background: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0', borderRadius: '8px',
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
                                        background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: '8px',
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
                    borderTop: '1px solid #F3F4F6',
                    display: 'flex', gap: '0.625rem', flexWrap: 'wrap',
                    flexShrink: 0,
                }}>
                    <button
                        onClick={() => onExtend(u.uid)}
                        disabled={isProcessing}
                        style={{
                            flex: 1, background: '#FFFBEB', color: '#D97706',
                            border: '1px solid #FDE68A', borderRadius: '10px',
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
            `}</style>
        </>
    );
}

export default function AdminDashboard() {
    const { user, profile } = useAuth();
    const { getAllUsers, updateUserLicense } = useFirestore(user?.uid ?? null);

    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

    const loadUsers = async (showRefresh = false) => {
        if (showRefresh) setRefreshing(true);
        else setLoading(true);
        setError(null);
        try {
            const result = await getAllUsers();
            setUsers(result);
        } catch (err: unknown) {
            const e = err as { message?: string };
            setError(e.message || 'ไม่สามารถโหลดข้อมูลผู้ใช้งานได้');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => { loadUsers(); }, [getAllUsers]);

    // Sync selected user data when users list refreshes
    useEffect(() => {
        if (selectedUser) {
            const updated = users.find(u => u.uid === selectedUser.uid);
            if (updated) setSelectedUser(updated);
        }
    }, [users]);

    const handleExtendTrial = async (uid: string) => {
        setProcessingId(uid);
        try {
            const current = users.find(u => u.uid === uid);
            if (!current) return;
            const currentExp = new Date(current.trial_expires_at || new Date());
            currentExp.setDate(currentExp.getDate() + 30);
            await updateUserLicense(uid, { trial_expires_at: currentExp.toISOString(), license: 'trial' });
            await loadUsers(true);
        } catch (err) { console.error(err); }
        finally { setProcessingId(null); }
    };

    const handleUnlockForever = async (uid: string) => {
        if (!confirm('ยืนยันปลดล็อกถาวรให้กับผู้ใช้นี้?')) return;
        setProcessingId(uid);
        try {
            await updateUserLicense(uid, { license: 'active' });
            await loadUsers(true);
        } catch (err) { console.error(err); }
        finally { setProcessingId(null); }
    };

    const handleBan = async (uid: string) => {
        if (!confirm('ยืนยันแบนผู้ใช้นี้? บัญชีของพวกเขาจะถูกบล็อคทันที')) return;
        setProcessingId(uid);
        try {
            await updateUserLicense(uid, { status: 'banned' });
            await loadUsers(true);
        } catch (err) { console.error(err); }
        finally { setProcessingId(null); }
    };

    const handleUnban = async (uid: string) => {
        setProcessingId(uid);
        try {
            await updateUserLicense(uid, { status: 'active' });
            await loadUsers(true);
        } catch (err) { console.error(err); }
        finally { setProcessingId(null); }
    };

    const handleRevoke = async (uid: string) => {
        if (!confirm('ยืนยันเพิกถอนสิทธิ์? license จะถูก reset เป็น trial ที่หมดอายุแล้ว')) return;
        setProcessingId(uid);
        try {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            await updateUserLicense(uid, { license: 'trial', trial_expires_at: yesterday.toISOString() });
            await loadUsers(true);
        } catch (err) { console.error(err); }
        finally { setProcessingId(null); }
    };

    const filteredUsers = users.filter(u =>
        u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.display_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const isAdmin = profile?.role === 'admin' || user?.email === 'sakdidechneverdie@gmail.com';

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
    const trialUsers = users.filter(u => u.license === 'trial' && u.trial_expires_at && new Date(u.trial_expires_at) >= new Date()).length;
    const expiredUsers = users.filter(u => u.license === 'trial' && u.trial_expires_at && new Date(u.trial_expires_at) < new Date()).length;

    const statCards = [
        { label: 'ผู้ใช้ทั้งหมด', value: totalUsers, icon: Users, color: '#6366F1', bg: '#EEF2FF' },
        { label: 'ตลอดชีพ', value: activeUsers, icon: UserCheck, color: '#16A34A', bg: '#F0FDF4' },
        { label: 'ทดลองใช้', value: trialUsers, icon: Timer, color: '#D97706', bg: '#FFFBEB' },
        { label: 'หมดอายุ', value: expiredUsers, icon: XCircle, color: '#DC2626', bg: '#FEF2F2' },
    ];

    return (
        <div>
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
                <button onClick={() => loadUsers(true)} disabled={refreshing} style={{
                    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '10px', color: '#C7D2FE', padding: '0.625rem 1.25rem',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem',
                    fontSize: '0.875rem', fontWeight: 500,
                }}>
                    <RefreshCw size={15} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
                    รีเฟรช
                </button>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {statCards.map(s => {
                    const Icon = s.icon;
                    return (
                        <div key={s.label} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: '14px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div style={{ width: 40, height: 40, borderRadius: '10px', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Icon size={20} color={s.color} />
                            </div>
                            <div>
                                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827', lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{loading ? '—' : s.value}</div>
                                <div style={{ fontSize: '0.8125rem', color: '#6B7280', marginTop: '0.25rem' }}>{s.label}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* User table card */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Search bar */}
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
                        <input
                            type="text"
                            placeholder="ค้นหาชื่อ หรือ อีเมล..."
                            className="form-input"
                            style={{ paddingLeft: '2.25rem', paddingTop: '0.625rem', paddingBottom: '0.625rem', fontSize: '0.875rem', width: '100%' }}
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {error && (
                        <div style={{ color: '#DC2626', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                            <AlertTriangle size={14} /> {error}
                        </div>
                    )}
                    <div style={{ fontSize: '0.8125rem', color: '#9CA3AF', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
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
                                <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #F3F4F6' }}>
                                    <th style={{ padding: '0.75rem 1.25rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ผู้ใช้งาน</th>
                                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>สถานะ</th>
                                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>วันที่เหลือ</th>
                                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>สมัครเมื่อ</th>
                                    <th style={{ padding: '0.75rem 1.25rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>จัดการ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.map((u, i) => {
                                    const isExpired = u.license === 'trial' && u.trial_expires_at && new Date(u.trial_expires_at) < new Date();
                                    const daysLeft = u.license === 'trial' && u.trial_expires_at ? getDaysLeft(u.trial_expires_at) : null;
                                    const isProcessing = processingId === u.uid;
                                    const isSelected = selectedUser?.uid === u.uid;

                                    let daysColor = '#16A34A'; let daysBg = '#F0FDF4';
                                    if (daysLeft !== null) {
                                        if (daysLeft <= 0) { daysColor = '#DC2626'; daysBg = '#FEF2F2'; }
                                        else if (daysLeft <= 7) { daysColor = '#D97706'; daysBg = '#FFFBEB'; }
                                    }

                                    return (
                                        <tr
                                            key={u.uid}
                                            onClick={() => setSelectedUser(u)}
                                            style={{
                                                borderBottom: i < filteredUsers.length - 1 ? '1px solid #F9FAFB' : 'none',
                                                transition: 'background 0.1s',
                                                cursor: 'pointer',
                                                background: isSelected ? '#EEF2FF' : 'transparent',
                                            }}
                                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#FAFAFA'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = isSelected ? '#EEF2FF' : 'transparent'; }}
                                        >
                                            <td style={{ padding: '0.875rem 1.25rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <UserAvatar name={u.display_name} email={u.email} />
                                                    <div>
                                                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#111827' }}>{u.display_name || 'ไม่ระบุชื่อ'}</div>
                                                        <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>{u.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                                                {u.status === 'banned' ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: '999px', padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600 }}>
                                                        <Ban size={12} /> แบน
                                                    </span>
                                                ) : u.license === 'active' ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', background: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0', borderRadius: '999px', padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600 }}>
                                                        <Infinity size={12} /> ตลอดชีพ
                                                    </span>
                                                ) : isExpired ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: '999px', padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600 }}>
                                                        <XCircle size={12} /> หมดอายุ
                                                    </span>
                                                ) : (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A', borderRadius: '999px', padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600 }}>
                                                        <Clock size={12} /> ทดลองใช้
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                                                {u.license === 'active' ? (
                                                    <span style={{ color: '#D1D5DB', fontSize: '0.875rem' }}>∞</span>
                                                ) : daysLeft !== null ? (
                                                    <span style={{ display: 'inline-block', background: daysBg, color: daysColor, borderRadius: '8px', padding: '0.25rem 0.625rem', fontSize: '0.875rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                                                        {daysLeft <= 0 ? 'หมดแล้ว' : `${daysLeft} วัน`}
                                                    </span>
                                                ) : <span style={{ color: '#D1D5DB' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '0.875rem 1rem' }}>
                                                <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>
                                                    {u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH', { year: '2-digit', month: 'short', day: 'numeric' }) : '—'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '0.875rem 1.25rem' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                                                    <button
                                                        onClick={() => handleExtendTrial(u.uid)}
                                                        disabled={isProcessing}
                                                        style={{ background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A', borderRadius: '8px', padding: '0.375rem 0.75rem', fontSize: '0.8rem', fontWeight: 600, cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '0.375rem', whiteSpace: 'nowrap' }}
                                                    >
                                                        {isProcessing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Timer size={12} />}+30 วัน
                                                    </button>
                                                    {u.license !== 'active' && (
                                                        <button
                                                            onClick={() => handleUnlockForever(u.uid)}
                                                            disabled={isProcessing}
                                                            style={{ background: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0', borderRadius: '8px', padding: '0.375rem 0.75rem', fontSize: '0.8rem', fontWeight: 600, cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '0.375rem', whiteSpace: 'nowrap' }}
                                                        >
                                                            {isProcessing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Key size={12} />}ปลดล็อก
                                                        </button>
                                                    )}
                                                    {u.license === 'active' && <CheckCircle size={16} color="#86EFAC" />}
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
                    onExtend={handleExtendTrial}
                    onUnlock={handleUnlockForever}
                    onBan={handleBan}
                    onUnban={handleUnban}
                    onRevoke={handleRevoke}
                    isProcessing={processingId === selectedUser.uid}
                />
            )}
        </div>
    );
}
