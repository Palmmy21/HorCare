import { useState } from 'react';
import { Mail, Lock, User, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react';

interface LoginPageProps {
    onLogin: (email: string, password: string) => Promise<void>;
    onRegister: (email: string, password: string, name: string) => Promise<void>;
    error: string | null;
    clearError: () => void;
}

export default function LoginPage({ onLogin, onRegister, error, clearError }: LoginPageProps) {
    const [isRegister, setIsRegister] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            if (isRegister) {
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

    const toggleMode = () => {
        setIsRegister(!isRegister);
        clearError();
        setEmail('');
        setPassword('');
        setName('');
    };

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
                    {isRegister && (
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
                                autoComplete={isRegister ? 'new-password' : 'current-password'}
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
                                {isRegister ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}
                                <ArrowRight size={18} />
                            </>
                        )}
                    </button>
                </form>

                {/* Toggle */}
                <div className="login-toggle">
                    <span className="login-toggle-text">
                        {isRegister ? 'มีบัญชีอยู่แล้ว?' : 'ยังไม่มีบัญชี?'}
                    </span>
                    <button className="login-toggle-btn" onClick={toggleMode} type="button">
                        {isRegister ? 'เข้าสู่ระบบ' : 'สมัครฟรี — ทดลองใช้ 30 วัน'}
                    </button>
                </div>

                {/* Features */}
                {!isRegister && (
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
