import { useState } from 'react';
import { Mail, Lock, User, ArrowRight, Loader2, Eye, EyeOff, KeyRound, CheckCircle2 } from 'lucide-react';

interface LoginPageProps {
    onLogin: (email: string, password: string) => Promise<void>;
    onRegister: (email: string, password: string, name: string) => Promise<void>;
    onResetPassword: (email: string) => Promise<void>;
    error: string | null;
    clearError: () => void;
}

type PageMode = 'login' | 'register' | 'forgot';

export default function LoginPage({ onLogin, onRegister, onResetPassword, error, clearError }: LoginPageProps) {
    const [mode, setMode] = useState<PageMode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [resetSent, setResetSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            if (mode === 'register') {
                await onRegister(email, password, name);
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
        setEmail('');
        setPassword('');
        setName('');
        setResetSent(false);
    };

    // ─── Forgot Password View ────────────────────────────────────────────────
    if (mode === 'forgot') {
        return (
            <div className="login-page">
                <div className="login-card">
                    <div className="login-logo">
                        <img src="/logo.png" alt="HorCare" style={{ width: 80, height: 80, objectFit: 'contain', marginBottom: '0.5rem' }} />
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
                                        ⚠️ {error}
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
                    <img src="/logo.png" alt="HorCare" style={{ width: 80, height: 80, objectFit: 'contain', marginBottom: '0.5rem' }} />
                    <p className="login-subtitle">ระบบจัดการหอพักอัจฉริยะ</p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="login-form">
                    {mode === 'register' && (
                        <div className="login-field">
                            <div className="login-input-wrapper">
                                <User size={18} className="login-input-icon" />
                                <input
                                    type="text"
                                    className="login-input"
                                    placeholder="ชื่อ-นามสกุล"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    required
                                    autoComplete="name"
                                />
                            </div>
                        </div>
                    )}

                    <div className="login-field">
                        <div className="login-input-wrapper">
                            <Mail size={18} className="login-input-icon" />
                            <input
                                type="email"
                                className="login-input"
                                placeholder="อีเมล"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                            />
                        </div>
                    </div>

                    <div className="login-field">
                        <div className="login-input-wrapper">
                            <Lock size={18} className="login-input-icon" />
                            <input
                                type={showPassword ? "text" : "password"}
                                className="login-input"
                                placeholder="รหัสผ่าน"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                minLength={6}
                                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                                style={{ paddingRight: '40px' }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    color: '#6B7280',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
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
                            ⚠️ {error}
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

                {/* Toggle */}
                <div className="login-toggle">
                    <span className="login-toggle-text">
                        {mode === 'register' ? 'มีบัญชีอยู่แล้ว?' : 'ยังไม่มีบัญชี?'}
                    </span>
                    <button
                        className="login-toggle-btn"
                        onClick={() => switchMode(mode === 'register' ? 'login' : 'register')}
                        type="button"
                    >
                        {mode === 'register' ? 'เข้าสู่ระบบ' : 'สมัครฟรี — ทดลองใช้ 30 วัน'}
                    </button>
                </div>

                {/* Features */}
                {mode === 'login' && (
                    <div className="login-features">
                        <div className="login-feature">📱 จดมิเตอร์จากมือถือ</div>
                        <div className="login-feature">🧾 ออกบิลอัตโนมัติ</div>
                        <div className="login-feature">☁️ ข้อมูลปลอดภัยบน Cloud</div>
                    </div>
                )}
            </div>
        </div>
    );
}
