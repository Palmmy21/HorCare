import { useState, lazy, Suspense } from 'react';
import {
    Mail, ArrowRight, Loader2, Eye, EyeOff, KeyRound, CheckCircle2,
    AlertTriangle, Smartphone, Cloud, Zap, Sparkles, ChevronLeft
} from 'lucide-react';
import { START_TRIAL_KEY, TRIAL_DAYS } from '../../shared/trial';
import { authenticateHousekeeper } from '../../hooks/useHousekeepers';
import type { HousekeeperSession, InitialBuildingConfig } from '../../types';
import RegisterWizard from './RegisterWizard';
import { LOGO_SRC } from '../../utils/brand';
import { errorInfo } from '../../shared/errorInfo';
import { parseLoginId } from '../../shared/loginId';
import { staffPhoneLogin } from '../../utils/staffLogin';
const PricingPage = lazy(() => import('../Pricing/PricingPage'));

interface LoginPageProps {
    onLogin: (email: string, password: string) => Promise<void>;
    onRegister: (email: string, password: string, name: string, initialBuilding?: InitialBuildingConfig) => Promise<void>;
    onResetPassword: (email: string) => Promise<void>;
    onMaidLogin?: (session: HousekeeperSession) => void;
    error: string | null;
    clearError: () => void;
    /** Screen to open on (the guest home sends people straight to sign up, sign in or the plans) */
    initialMode?: 'login' | 'register' | 'pricing';
    /** Back to the guest home */
    onBack?: () => void;
}

type PageMode = 'login' | 'register' | 'forgot' | 'pricing' | 'maid';

export default function LoginPage({ onLogin, onRegister, onResetPassword, onMaidLogin, error, clearError, initialMode = 'login', onBack }: LoginPageProps) {
    const [mode, setMode] = useState<PageMode>(initialMode);
    const logo = (
        <div className="login-brand">
            <img src={LOGO_SRC} alt="" width={84} height={84} />
            <h1 className="login-brand-name">HorCare</h1>
        </div>
    );
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
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
            await onLogin(email, password);
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
        setMaidPhone('');
        setMaidPasscode('');
        setResetSent(false);
    };

    const handleMaidSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setMaidError(null);
        clearError();
        const id = parseLoginId(maidPhone);
        if (!id) {
            setMaidError('กรอกเบอร์โทรศัพท์ หรืออีเมลให้ถูกต้อง');
            setIsLoading(false);
            return;
        }
        try {
            // an email is an administrator account the owner created: the ordinary sign-in (errors shown by the parent)
            if (id.kind === 'email') {
                try { await onLogin(id.email, maidPasscode); } catch { /* error handled by parent */ }
                return;
            }
            // a phone: an administrator's phone first, then a housekeeper's
            const staff = await staffPhoneLogin(id.phone, maidPasscode);
            if (staff === 'ok') return;
            if (staff === 'too_many') { setMaidError('ลองหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่'); return; }
            const session = await authenticateHousekeeper(id.phone, maidPasscode);
            if (session) {
                if (onMaidLogin) {
                    onMaidLogin(session);
                } else {
                    window.location.reload();
                }
            } else {
                setMaidError('เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกปิดใช้งาน');
            }
        } catch (errRaw) {
            const err = errorInfo(errRaw);
            setMaidError(err.message || 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ');
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
                    onTrialNeedAuth={() => {
                        try { localStorage.setItem(START_TRIAL_KEY, '1'); } catch { /* storage blocked: the trial can still be started from Pricing */ }
                        switchMode('register');
                    }}
                    onBack={() => (onBack && initialMode === 'pricing' ? onBack() : switchMode('login'))}
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
                        {logo}
                        <p className="login-subtitle">รีเซ็ตรหัสผ่าน</p>
                    </div>

                    {resetSent ? (
                        /* Success state */
                        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                            <CheckCircle2
                                size={52}
                                style={{ color: '#22a35a', margin: '0 auto 1rem' }}
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
            <div className={`login-card ${mode === 'register' ? 'register-mode' : ''}`}>
                {onBack && (
                    <button type="button" className="btn btn-ghost btn-sm login-back" onClick={onBack}>
                        <ChevronLeft size={16} aria-hidden /> กลับไปดูระบบตัวอย่าง
                    </button>
                )}
                {/* Logo */}
                <div className="login-logo">
                    {logo}
                    <p className="login-subtitle">บริหารอสังหาริมทรัพย์ให้เช่าอย่างมืออาชีพ</p>
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                        background: 'rgba(34, 163, 90,0.12)', border: '1px solid rgba(34, 163, 90,0.28)',
                        borderRadius: '999px', padding: '0.3rem 0.9rem', marginTop: '0.4rem',
                        fontSize: '0.78rem', fontWeight: 700, color: '#15803D',
                    }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><CheckCircle2 size={12} /> ใช้ฟรี</span>
                        <span style={{ opacity: 0.4 }}>|</span>
                        <span>เพิ่ม LINE ส่งบิล ฿399/เดือน</span>
                    </div>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', width: '100%', marginBottom: '1.5rem', borderBottom: '2px solid var(--color-gray-200, #dce5ef)' }}>
                    <button
                        type="button"
                        onClick={() => switchMode('login')}
                        style={{
                            flex: 1, padding: '0.65rem 0.25rem', background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.9rem', fontWeight: 600, color: mode === 'login' ? 'var(--color-primary, #0a6cc2)' : 'var(--color-text-muted, #557089)',
                            borderBottom: mode === 'login' ? '2px solid var(--color-primary, #0a6cc2)' : 'none',
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
                            fontSize: '0.9rem', fontWeight: 600, color: mode === 'maid' ? 'var(--color-primary, #0a6cc2)' : 'var(--color-text-muted, #557089)',
                            borderBottom: mode === 'maid' ? '2px solid var(--color-primary, #0a6cc2)' : 'none',
                            marginBottom: '-2px', whiteSpace: 'nowrap',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem'
                        }}
                    >
                        <Sparkles size={14} color={mode === 'maid' ? 'var(--color-primary, #0a6cc2)' : '#557089'} />
                        แอดมิน หรือ staff
                    </button>
                    <button
                        type="button"
                        onClick={() => switchMode('register')}
                        style={{
                            flex: 1, padding: '0.65rem 0.25rem', background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.9rem', fontWeight: 600, color: mode === 'register' ? 'var(--color-primary, #0a6cc2)' : 'var(--color-text-muted, #557089)',
                            borderBottom: mode === 'register' ? '2px solid var(--color-primary, #0a6cc2)' : 'none',
                            marginBottom: '-2px', whiteSpace: 'nowrap',
                        }}
                    >
                        สมัครสมาชิก
                    </button>
                </div>

                {/* Form */}
                {mode === 'register' ? (
                    <RegisterWizard onRegister={onRegister} error={error} clearError={clearError} />
                ) : mode === 'maid' ? (
                    <form onSubmit={handleMaidSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ background: 'rgba(10, 108, 194, 0.08)', border: '1px solid rgba(10, 108, 194, 0.25)', borderRadius: 10, padding: '0.75rem 0.875rem', fontSize: '0.825rem', color: 'var(--color-primary, #0a6cc2)', lineHeight: 1.4 }}>
                            สำหรับแอดมินหรือ staff ประจำหอพัก เข้าสู่ระบบด้วยเบอร์โทรศัพท์ หรืออีเมล และรหัสผ่านที่เจ้าของหอพักกำหนดให้
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text, #1a3350)' }}>เบอร์โทรศัพท์ หรืออีเมล</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="text"
                                    inputMode="email"
                                    placeholder="เช่น 0812345678 หรือ admin@example.com"
                                    value={maidPhone}
                                    onChange={e => setMaidPhone(e.target.value)}
                                    required
                                    autoComplete="username"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    style={{
                                        width: '100%', padding: '0.75rem 1rem', borderRadius: '10px',
                                        border: '1px solid var(--color-gray-200, #dce5ef)', background: 'var(--color-white, #fff)',
                                        color: 'var(--color-text, #1a3350)', outline: 'none'
                                    }}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text, #1a3350)' }}>รหัสผ่าน</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showPassword ? "text" : "password"}
                                    placeholder="รหัสผ่านที่ได้รับจากเจ้าของหอพัก"
                                    value={maidPasscode}
                                    onChange={e => setMaidPasscode(e.target.value)}
                                    required
                                    autoComplete="current-password"
                                    style={{
                                        width: '100%', padding: '0.75rem 2.5rem 0.75rem 1rem', borderRadius: '10px',
                                        border: '1px solid var(--color-gray-200, #dce5ef)', background: 'var(--color-white, #fff)',
                                        color: 'var(--color-text, #1a3350)', outline: 'none'
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={{
                                        position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                                        background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                                        color: 'var(--color-text-muted, #557089)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {(maidError || error) && (
                            <div className="login-error">
                                <AlertTriangle size={16} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }} /> {maidError || error}
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
                                    เข้าสู่ระบบแอดมิน / staff
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>
                ) : (
                <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text, #1a3350)' }}>อีเมล <span style={{ color: '#ef4444' }}>*</span></label>
                        <input
                            type="email"
                            placeholder="email@example.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                            style={{
                                width: '100%', padding: '0.75rem 1rem', borderRadius: '10px',
                                border: '1px solid var(--color-gray-200, #dce5ef)', background: 'var(--color-white, #fff)',
                                color: 'var(--color-text, #1a3350)', outline: 'none', fontSize: '0.9rem'
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text, #1a3350)' }}>รหัสผ่าน <span style={{ color: '#ef4444' }}>*</span></label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type={showPassword ? "text" : "password"}
                                placeholder="อย่างน้อย 8 ตัวอักษร"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                minLength={8}
                                autoComplete="current-password"
                                style={{
                                    width: '100%', padding: '0.75rem 2.5rem 0.75rem 1rem', borderRadius: '10px',
                                    border: '1px solid var(--color-gray-200, #dce5ef)', background: 'var(--color-white, #fff)',
                                    color: 'var(--color-text, #1a3350)', outline: 'none', fontSize: '0.9rem'
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                                    color: 'var(--color-text-muted, #557089)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

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
                                เข้าสู่ระบบ
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
                        background: 'rgba(15, 76, 129,0.12)',
                        border: '1px solid rgba(15, 76, 129,0.35)',
                        borderRadius: '10px',
                        padding: '0.6rem 0.875rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '0.82rem',
                        color: '#CFE2F6',
                    }}>
                        <Zap size={14} style={{ flexShrink: 0 }} />
                        สมัครแล้วจะพาไปหน้าชำระเงินทันที
                    </div>
                )}
                {mode === 'register' && !localStorage.getItem('horcare_pending_plan') && localStorage.getItem(START_TRIAL_KEY) && (
                    <div className="login-trial-note">
                        <Sparkles size={14} aria-hidden />
                        สมัครแล้วเริ่มทดลองใช้ HorCare Pro ฟรี {TRIAL_DAYS} วันทันที ใช้ได้ทุกฟีเจอร์
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
