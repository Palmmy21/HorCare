import { useState, lazy, Suspense } from 'react';
import { Mail, ArrowRight, Loader2, Eye, EyeOff, KeyRound, CheckCircle2, AlertTriangle, Smartphone, Cloud, Zap, Sparkles } from 'lucide-react';
import { authenticateHousekeeper } from '../../hooks/useHousekeepers';
import type { HousekeeperSession } from '../../types';
const PricingPage = lazy(() => import('../Pricing/PricingPage'));

interface LoginPageProps {
    onLogin: (email: string, password: string) => Promise<void>;
    onRegister: (email: string, password: string, name: string) => Promise<void>;
    onResetPassword: (email: string) => Promise<void>;
    onMaidLogin?: (session: HousekeeperSession) => void;
    error: string | null;
    clearError: () => void;
}

type PageMode = 'login' | 'register' | 'forgot' | 'pricing' | 'maid';

export default function LoginPage({ onLogin, onRegister, onResetPassword, onMaidLogin, error, clearError }: LoginPageProps) {
    const [mode, setMode] = useState<PageMode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [phone, setPhone] = useState('');
    const [referralSources, setReferralSources] = useState<string[]>([]);
    
    // Maid login state
    const [maidPhone, setMaidPhone] = useState('');
    const [maidPasscode, setMaidPasscode] = useState('');
    const [maidError, setMaidError] = useState<string | null>(null);

    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [resetSent, setResetSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            if (mode === 'register') {
                const fullName = `${firstName.trim()} ${lastName.trim()}`;
                await onRegister(email, password, fullName);
                // phone and referralSources can be saved here if backend supports it
            } else {
                await onLogin(email, password);
            }
        } catch {
            // error handled by parent
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            await onResetPassword(email);
            setResetSent(true);
        } catch {
            // error handled by parent
        } finally {
            setIsLoading(false);
        }
    };

    const switchMode = (newMode: PageMode) => {
        setMode(newMode);
        clearError();
        setMaidError(null);
        setEmail('');
        setPassword('');
        setFirstName('');
        setLastName('');
        setPhone('');
        setMaidPhone('');
        setMaidPasscode('');
        setReferralSources([]);
        setResetSent(false);
    };

    const handleMaidSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setMaidError(null);
        try {
            const session = await authenticateHousekeeper(maidPhone, maidPasscode);
            if (session) {
                if (onMaidLogin) {
                    onMaidLogin(session);
                } else {
                    window.location.reload();
                }
            } else {
                setMaidError('เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีแม่บ้านถูกปิดใช้งาน');
            }
        } catch (err: any) {
            setMaidError(err.message || 'เกิดข้อผิดพลาดในการเข้าสู่ระบบแม่บ้าน');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGuestSelectPlan = (planId: string, cycle: string) => {
        localStorage.setItem('horcare_pending_plan', JSON.stringify({ planId, cycle }));
        switchMode('register');
    };

    // ─── Pricing (guest) View ────────────────────────────────────────────────
    if (mode === 'pricing') {
        return (
            <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} /></div>}>
                <PricingPage
                    profile={null}
                    isGuest
                    onNeedAuth={handleGuestSelectPlan}
                    onBack={() => switchMode('login')}
                />
            </Suspense>
        );
    }

    // ─── Forgot Password View ────────────────────────────────────────────────
    if (mode === 'forgot') {
        return (
            <div className="login-page">
                <div className="login-card">
                    <div className="login-logo">
                        <img src="/logo.png" alt="HorCare" style={{ width: 140, height: 140, objectFit: 'contain', marginBottom: '0.25rem' }} />
                        <p className="login-subtitle">รีเซ็ตรหัสผ่าน</p>
                    </div>

                    {resetSent ? (
                        /* Success state */
                        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                            <CheckCircle2
                                size={52}
                                style={{ color: '#22c55e', margin: '0 auto 1rem' }}
                            />
                            <h3 style={{ color: 'var(--text-primary)', fontWeight: 700, marginBottom: '0.5rem' }}>
                                ส่งอีเมลแล้ว!
                            </h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.7, marginBottom: '1.5rem' }}>
                                เราส่งลิงก์รีเซ็ตรหัสผ่านไปที่<br />
                                <strong style={{ color: 'var(--text-primary)' }}>{email}</strong><br />
                                กรุณาตรวจสอบกล่องขาเข้า (และโฟลเดอร์ Spam)
                            </p>
                            <button
                                className="login-button"
                                onClick={() => switchMode('login')}
                            >
                                กลับไปหน้าเข้าสู่ระบบ
                                <ArrowRight size={18} />
                            </button>
                        </div>
                    ) : (
                        /* Email input form */
                        <>
                            <p style={{
                                color: 'var(--text-secondary)',
                                fontSize: '0.875rem',
                                textAlign: 'center',
                                marginBottom: '1.25rem',
                                lineHeight: 1.6,
                            }}>
                                กรอกอีเมลที่ใช้ลงทะเบียน เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้คุณ
                            </p>
                            <form onSubmit={handleResetSubmit} className="login-form">
                                <div className="login-field">
                                    <div className="login-input-wrapper">
                                        <Mail size={18} className="login-input-icon" />
                                        <input
                                            type="email"
                                            className="login-input"
                                            placeholder="อีเมลของคุณ"
                                            value={email}
                                            onChange={e => setEmail(e.target.value)}
                                            required
                                            autoComplete="email"
                                            autoFocus
                                        />
                                    </div>
                                </div>

                                {error && (
                                    <div className="login-error">
                                        <AlertTriangle size={16} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }} /> {error}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    className="login-button"
                                    disabled={isLoading}
                                >
                                    {isLoading ? (
                                        <Loader2 size={20} className="spin" />
                                    ) : (
                                        <>
                                            <KeyRound size={18} />
                                            ส่งลิงก์รีเซ็ตรหัสผ่าน
                                        </>
                                    )}
                                </button>
                            </form>

                            <div className="login-toggle">
                                <button
                                    className="login-toggle-btn"
                                    onClick={() => switchMode('login')}
                                    type="button"
                                >
                                    ← กลับไปหน้าเข้าสู่ระบบ
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    }

    // ─── Login / Register View ───────────────────────────────────────────────
    return (
        <div className="login-page">
            <div className="login-card">
                {/* Logo */}
                <div className="login-logo">
                    <img src="/logo.png" alt="HorCare" style={{ width: 140, height: 140, objectFit: 'contain', marginBottom: '0.25rem' }} />
                    <p className="login-subtitle">จัดการหอพักครบวงจร</p>
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                        background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.28)',
                        borderRadius: '999px', padding: '0.3rem 0.9rem', marginTop: '0.4rem',
                        fontSize: '0.78rem', fontWeight: 700, color: '#059669',
                    }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><CheckCircle2 size={12} /> ใช้ฟรี</span>
                        <span style={{ opacity: 0.4 }}>|</span>
                        <span>เพิ่ม LINE ส่งบิล ฿399/เดือน</span>
                    </div>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', width: '100%', marginBottom: '1.5rem', borderBottom: '2px solid var(--border-color, #e5e7eb)' }}>
                    <button
                        type="button"
                        onClick={() => switchMode('login')}
                        style={{
                            flex: 1, padding: '0.65rem 0.25rem', background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.9rem', fontWeight: 600, color: mode === 'login' ? 'var(--primary)' : 'var(--text-secondary, #6B7280)',
                            borderBottom: mode === 'login' ? '2px solid var(--primary)' : 'none',
                            marginBottom: '-2px', whiteSpace: 'nowrap',
                        }}
                    >
                        เจ้าของหอพัก
                    </button>
                    <button
                        type="button"
                        onClick={() => switchMode('maid')}
                        style={{
                            flex: 1, padding: '0.65rem 0.25rem', background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.9rem', fontWeight: 600, color: mode === 'maid' ? 'var(--primary)' : 'var(--text-secondary, #6B7280)',
                            borderBottom: mode === 'maid' ? '2px solid var(--primary)' : 'none',
                            marginBottom: '-2px', whiteSpace: 'nowrap',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem'
                        }}
                    >
                        <Sparkles size={14} color={mode === 'maid' ? 'var(--primary)' : '#6B7280'} />
                        แม่บ้าน
                    </button>
                    <button
                        type="button"
                        onClick={() => switchMode('register')}
                        style={{
                            flex: 1, padding: '0.65rem 0.25rem', background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.9rem', fontWeight: 600, color: mode === 'register' ? 'var(--primary)' : 'var(--text-secondary, #6B7280)',
                            borderBottom: mode === 'register' ? '2px solid var(--primary)' : 'none',
                            marginBottom: '-2px', whiteSpace: 'nowrap',
                        }}
                    >
                        สมัครสมาชิก
                    </button>
                </div>

                {/* Form */}
                {mode === 'maid' ? (
                    <form onSubmit={handleMaidSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, padding: '0.75rem 0.875rem', fontSize: '0.825rem', color: '#0369A1', lineHeight: 1.4 }}>
                            สำหรับแม่บ้านประจำหอพัก เข้าสู่ระบบด้วยเบอร์โทรศัพท์และรหัสผ่านที่เจ้าของหอพักกำหนดให้
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>เบอร์โทรศัพท์</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="tel"
                                    placeholder="เช่น 0812345678"
                                    value={maidPhone}
                                    onChange={e => setMaidPhone(e.target.value)}
                                    required
                                    autoComplete="tel"
                                    style={{
                                        width: '100%', padding: '0.75rem 1rem', borderRadius: '8px',
                                        border: '1px solid var(--border-color, #e5e7eb)', background: 'var(--bg-primary, #fff)',
                                        color: 'var(--text-primary)', outline: 'none'
                                    }}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>รหัสผ่าน (Passcode)</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showPassword ? "text" : "password"}
                                    placeholder="รหัสผ่านที่ได้รับจากเจ้าของหอพัก"
                                    value={maidPasscode}
                                    onChange={e => setMaidPasscode(e.target.value)}
                                    required
                                    style={{
                                        width: '100%', padding: '0.75rem 2.5rem 0.75rem 1rem', borderRadius: '8px',
                                        border: '1px solid var(--border-color, #e5e7eb)', background: 'var(--bg-primary, #fff)',
                                        color: 'var(--text-primary)', outline: 'none'
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={{
                                        position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                                        background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                                        color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {maidError && (
                            <div className="login-error">
                                <AlertTriangle size={16} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }} /> {maidError}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="login-button"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <Loader2 size={20} className="spin" />
                            ) : (
                                <>
                                    <Sparkles size={18} />
                                    เข้าสู่ระบบแม่บ้าน
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>
                ) : (
                <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {mode === 'register' && (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                    <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>ชื่อ</label>
                                    <input
                                        type="text"
                                        placeholder="สมชาย"
                                        value={firstName}
                                        onChange={e => setFirstName(e.target.value)}
                                        required
                                        style={{
                                            width: '100%', padding: '0.75rem 1rem', borderRadius: '8px',
                                            border: '1px solid var(--border-color, #e5e7eb)', background: 'var(--bg-primary, #fff)',
                                            color: 'var(--text-primary)', outline: 'none'
                                        }}
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                    <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>นามสกุล</label>
                                    <input
                                        type="text"
                                        placeholder="ใจดี"
                                        value={lastName}
                                        onChange={e => setLastName(e.target.value)}
                                        required
                                        style={{
                                            width: '100%', padding: '0.75rem 1rem', borderRadius: '8px',
                                            border: '1px solid var(--border-color, #e5e7eb)', background: 'var(--bg-primary, #fff)',
                                            color: 'var(--text-primary)', outline: 'none'
                                        }}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>เบอร์โทรศัพท์</label>
                                <input
                                    type="tel"
                                    placeholder="08X-XXX-XXXX"
                                    value={phone}
                                    onChange={e => setPhone(e.target.value)}
                                    required
                                    style={{
                                        width: '100%', padding: '0.75rem 1rem', borderRadius: '8px',
                                        border: '1px solid var(--border-color, #e5e7eb)', background: 'var(--bg-primary, #fff)',
                                        color: 'var(--text-primary)', outline: 'none'
                                    }}
                                />
                            </div>
                        </>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>อีเมล</label>
                        <input
                            type="email"
                            placeholder="email@example.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                            style={{
                                width: '100%', padding: '0.75rem 1rem', borderRadius: '8px',
                                border: '1px solid var(--border-color, #e5e7eb)', background: 'var(--bg-primary, #fff)',
                                color: 'var(--text-primary)', outline: 'none'
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>รหัสผ่าน</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type={showPassword ? "text" : "password"}
                                placeholder="อย่างน้อย 8 ตัวอักษร"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                minLength={8}
                                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                                style={{
                                    width: '100%', padding: '0.75rem 2.5rem 0.75rem 1rem', borderRadius: '8px',
                                    border: '1px solid var(--border-color, #e5e7eb)', background: 'var(--bg-primary, #fff)',
                                    color: 'var(--text-primary)', outline: 'none'
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                                    color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    {mode === 'register' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                คุณรู้จักเราได้อย่างไร? <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(เลือกได้หลายข้อ)</span>
                            </label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                {['Google', 'Facebook', 'เพื่อนแนะนำ', 'LINE', 'TikTok', 'อื่นๆ'].map(source => (
                                    <label key={source} style={{
                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                        padding: '0.6rem 1rem', border: '1px solid var(--border-color, #e5e7eb)',
                                        borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem'
                                    }}>
                                        <input
                                            type="checkbox"
                                            checked={referralSources.includes(source)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setReferralSources(prev => [...prev, source]);
                                                } else {
                                                    setReferralSources(prev => prev.filter(s => s !== source));
                                                }
                                            }}
                                            style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--primary)' }}
                                        />
                                        {source}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Forgot password link — only shown on login mode */}
                    {mode === 'login' && (
                        <div style={{ textAlign: 'right', marginTop: '-0.25rem' }}>
                            <button
                                type="button"
                                onClick={() => switchMode('forgot')}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: 'var(--primary)',
                                    fontSize: '0.8rem',
                                    padding: '0',
                                    textDecoration: 'underline',
                                    opacity: 0.85,
                                }}
                            >
                                ลืมรหัสผ่าน?
                            </button>
                        </div>
                    )}

                    {error && (
                        <div className="login-error">
                            <AlertTriangle size={16} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }} /> {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        className="login-button"
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <Loader2 size={20} className="spin" />
                        ) : (
                            <>
                                {mode === 'register' ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}
                                <ArrowRight size={18} />
                            </>
                        )}
                    </button>
                </form>
            )}

                {mode === 'login' && (
                    <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
                        <button
                            type="button"
                            onClick={() => switchMode('pricing')}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--primary)',
                                fontSize: '0.875rem',
                                padding: '0.25rem 0.5rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                opacity: 0.9,
                                fontWeight: 600,
                            }}
                        >
                            <Zap size={15} />
                            ดูแพ็กเกจและราคา
                        </button>
                    </div>
                )}
                {mode === 'register' && localStorage.getItem('horcare_pending_plan') && (
                    <div style={{
                        marginTop: '0.75rem',
                        background: 'rgba(139,92,246,0.12)',
                        border: '1px solid rgba(139,92,246,0.35)',
                        borderRadius: '10px',
                        padding: '0.6rem 0.875rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '0.82rem',
                        color: '#C4B5FD',
                    }}>
                        <Zap size={14} style={{ flexShrink: 0 }} />
                        สมัครแล้วจะพาไปหน้าชำระเงินทันที
                    </div>
                )}

                {/* Features */}
                {mode === 'login' && (
                    <div className="login-features">
                        <div className="login-feature" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Smartphone size={16} /> จดมิเตอร์ & ออกบิลอัตโนมัติ</div>
                        <div className="login-feature" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Zap size={16} /> LINE ส่งบิล ฿399/เดือน</div>
                        <div className="login-feature" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Cloud size={16} /> ข้อมูลปลอดภัยบน Cloud</div>
                    </div>
                )}
            </div>
        </div>
    );
}
