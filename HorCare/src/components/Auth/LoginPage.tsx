import { useState, lazy, Suspense } from 'react';
import {
    Mail, ArrowRight, Loader2, Eye, EyeOff, KeyRound, CheckCircle2,
    AlertTriangle, Smartphone, Cloud, Zap, Sparkles, Building2, Building,
    Home, Hotel, Store, Droplets, Calendar, DollarSign
} from 'lucide-react';
import { authenticateHousekeeper } from '../../hooks/useHousekeepers';
import type { HousekeeperSession, DormConfig, WaterConfig, InitialBuildingConfig } from '../../types';
import horcareLogo from '../../assets/horcare_logo.png';
import { errorInfo } from '../../shared/errorInfo';
const PricingPage = lazy(() => import('../Pricing/PricingPage'));

interface LoginPageProps {
    onLogin: (email: string, password: string) => Promise<void>;
    onRegister: (email: string, password: string, name: string, initialBuilding?: InitialBuildingConfig) => Promise<void>;
    onResetPassword: (email: string) => Promise<void>;
    onMaidLogin?: (session: HousekeeperSession) => void;
    error: string | null;
    clearError: () => void;
}

type PageMode = 'login' | 'register' | 'forgot' | 'pricing' | 'maid';

const BUILDING_TYPES = [
    { type: 'dormitory', label: 'หอพัก', icon: <Building2 size={20} /> },
    { type: 'market', label: 'ตลาด / แผงค้า', icon: <Store size={20} /> },
    { type: 'apartment', label: 'อพาร์ตเมนต์', icon: <Building size={20} /> },
    { type: 'condo', label: 'คอนโดมิเนียม', icon: <Building size={20} /> },
    { type: 'house', label: 'บ้านเช่า', icon: <Home size={20} /> },
    { type: 'commercial', label: 'อาคารพาณิชย์', icon: <Store size={20} /> },
    { type: 'resort', label: 'รีสอร์ท/รร.', icon: <Hotel size={20} /> },
] as const;

export default function LoginPage({ onLogin, onRegister, onResetPassword, onMaidLogin, error, clearError }: LoginPageProps) {
    const [mode, setMode] = useState<PageMode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [phone, setPhone] = useState('');
    const [referralSources, setReferralSources] = useState<string[]>([]);
    
    // Initial building fields (for register mode)
    const [dormName, setDormName] = useState('');
    const [buildingType, setBuildingType] = useState<DormConfig['building_type']>('dormitory');
    const [elecRate, setElecRate] = useState<number>(8);
    const [waterMode, setWaterMode] = useState<'normal' | 'flat'>('normal');
    const [waterUnitRate, setWaterUnitRate] = useState<number>(18);
    const [waterFlatRate, setWaterFlatRate] = useState<number>(100);
    const [roomRent, setRoomRent] = useState<number>(3500);
    const [dueDay, setDueDay] = useState<number>(5);

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
                const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
                const water_config: WaterConfig = waterMode === 'normal'
                    ? { type: 'normal', unit_rate: Number(waterUnitRate) || 18 }
                    : { type: 'flat_rate_tier', flat_price: Number(waterFlatRate) || 100, flat_limit_unit: 0, excess_unit_rate: Number(waterUnitRate) || 18 };

                const initialBuilding: InitialBuildingConfig = {
                    dorm_name: dormName.trim() || 'หอพักของฉัน',
                    building_type: buildingType,
                    electricity_rate: Number(elecRate) || 8,
                    water_config,
                    room_rent: Number(roomRent) || 3500,
                    due_day: Number(dueDay) || 5,
                    phone: phone.trim(),
                    referral_sources: referralSources,
                };
                await onRegister(email, password, fullName, initialBuilding);
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
        setDormName('');
        setBuildingType('dormitory');
        setElecRate(8);
        setWaterMode('normal');
        setWaterUnitRate(18);
        setWaterFlatRate(100);
        setRoomRent(3500);
        setDueDay(5);
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
                        <img src={horcareLogo} alt="HorCare" style={{ width: 140, height: 140, objectFit: 'contain', marginBottom: '0.25rem' }} />
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
            <div className={`login-card ${mode === 'register' ? 'register-mode' : ''}`}>
                {/* Logo */}
                <div className="login-logo">
                    <img src={horcareLogo} alt="HorCare" style={{ width: 140, height: 140, objectFit: 'contain', marginBottom: '0.25rem' }} />
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
                <div style={{ display: 'flex', width: '100%', marginBottom: '1.5rem', borderBottom: '2px solid var(--color-gray-200, #e2e8f0)' }}>
                    <button
                        type="button"
                        onClick={() => switchMode('login')}
                        style={{
                            flex: 1, padding: '0.65rem 0.25rem', background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.9rem', fontWeight: 600, color: mode === 'login' ? 'var(--color-primary, #0ea5e9)' : 'var(--color-text-muted, #64748b)',
                            borderBottom: mode === 'login' ? '2px solid var(--color-primary, #0ea5e9)' : 'none',
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
                            fontSize: '0.9rem', fontWeight: 600, color: mode === 'maid' ? 'var(--color-primary, #0ea5e9)' : 'var(--color-text-muted, #64748b)',
                            borderBottom: mode === 'maid' ? '2px solid var(--color-primary, #0ea5e9)' : 'none',
                            marginBottom: '-2px', whiteSpace: 'nowrap',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem'
                        }}
                    >
                        <Sparkles size={14} color={mode === 'maid' ? 'var(--color-primary, #0ea5e9)' : '#64748b'} />
                        แอดมิน หรือ staff
                    </button>
                    <button
                        type="button"
                        onClick={() => switchMode('register')}
                        style={{
                            flex: 1, padding: '0.65rem 0.25rem', background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.9rem', fontWeight: 600, color: mode === 'register' ? 'var(--color-primary, #0ea5e9)' : 'var(--color-text-muted, #64748b)',
                            borderBottom: mode === 'register' ? '2px solid var(--color-primary, #0ea5e9)' : 'none',
                            marginBottom: '-2px', whiteSpace: 'nowrap',
                        }}
                    >
                        สมัครสมาชิก
                    </button>
                </div>

                {/* Form */}
                {mode === 'maid' ? (
                    <form onSubmit={handleMaidSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ background: 'rgba(14, 165, 233, 0.08)', border: '1px solid rgba(14, 165, 233, 0.25)', borderRadius: 10, padding: '0.75rem 0.875rem', fontSize: '0.825rem', color: 'var(--color-primary, #0284c7)', lineHeight: 1.4 }}>
                            สำหรับแอดมินหรือ staff ประจำหอพัก เข้าสู่ระบบด้วยเบอร์โทรศัพท์และรหัสผ่านที่เจ้าของหอพักกำหนดให้
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text, #1e293b)' }}>เบอร์โทรศัพท์</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="tel"
                                    placeholder="เช่น 0812345678"
                                    value={maidPhone}
                                    onChange={e => setMaidPhone(e.target.value)}
                                    required
                                    autoComplete="tel"
                                    style={{
                                        width: '100%', padding: '0.75rem 1rem', borderRadius: '10px',
                                        border: '1px solid var(--color-gray-200, #e2e8f0)', background: 'var(--color-white, #fff)',
                                        color: 'var(--color-text, #1e293b)', outline: 'none'
                                    }}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text, #1e293b)' }}>รหัสผ่าน (Passcode)</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showPassword ? "text" : "password"}
                                    placeholder="รหัสผ่านที่ได้รับจากเจ้าของหอพัก"
                                    value={maidPasscode}
                                    onChange={e => setMaidPasscode(e.target.value)}
                                    required
                                    style={{
                                        width: '100%', padding: '0.75rem 2.5rem 0.75rem 1rem', borderRadius: '10px',
                                        border: '1px solid var(--color-gray-200, #e2e8f0)', background: 'var(--color-white, #fff)',
                                        color: 'var(--color-text, #1e293b)', outline: 'none'
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={{
                                        position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                                        background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                                        color: 'var(--color-text-muted, #6B7280)', display: 'flex', alignItems: 'center', justifyContent: 'center'
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
                                    เข้าสู่ระบบแอดมิน / staff
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>
                ) : (
                <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {mode === 'register' && (
                        <>
                            {/* ข้อมูลเจ้าของ */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text, #1e293b)' }}>ชื่อ <span style={{ color: '#ef4444' }}>*</span></label>
                                    <input
                                        type="text"
                                        placeholder="สมชาย"
                                        value={firstName}
                                        onChange={e => setFirstName(e.target.value)}
                                        required
                                        style={{
                                            width: '100%', padding: '0.7rem 0.875rem', borderRadius: '10px',
                                            border: '1px solid var(--color-gray-200, #e2e8f0)', background: 'var(--color-white, #fff)',
                                            color: 'var(--color-text, #1e293b)', outline: 'none', fontSize: '0.9rem'
                                        }}
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text, #1e293b)' }}>นามสกุล <span style={{ color: '#ef4444' }}>*</span></label>
                                    <input
                                        type="text"
                                        placeholder="ใจดี"
                                        value={lastName}
                                        onChange={e => setLastName(e.target.value)}
                                        required
                                        style={{
                                            width: '100%', padding: '0.7rem 0.875rem', borderRadius: '10px',
                                            border: '1px solid var(--color-gray-200, #e2e8f0)', background: 'var(--color-white, #fff)',
                                            color: 'var(--color-text, #1e293b)', outline: 'none', fontSize: '0.9rem'
                                        }}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text, #1e293b)' }}>เบอร์โทรศัพท์ <span style={{ color: '#ef4444' }}>*</span></label>
                                <input
                                    type="tel"
                                    placeholder="08X-XXX-XXXX"
                                    value={phone}
                                    onChange={e => setPhone(e.target.value)}
                                    required
                                    style={{
                                        width: '100%', padding: '0.7rem 0.875rem', borderRadius: '10px',
                                        border: '1px solid var(--color-gray-200, #e2e8f0)', background: 'var(--color-white, #fff)',
                                        color: 'var(--color-text, #1e293b)', outline: 'none', fontSize: '0.9rem'
                                    }}
                                />
                            </div>

                            {/* กล่องตั้งค่าสาขาเริ่มต้น (เหมือนตอนเพิ่มสาขา) */}
                            <div style={{
                                marginTop: '0.25rem',
                                padding: '1rem',
                                borderRadius: '14px',
                                background: 'rgba(14, 165, 233, 0.05)',
                                border: '1.5px solid rgba(14, 165, 233, 0.22)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.875rem'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-primary, #0ea5e9)', fontWeight: 700, fontSize: '0.9rem' }}>
                                    <Building2 size={18} />
                                    <span>ข้อมูลสาขาแรก & กำหนดค่าเริ่มต้น</span>
                                </div>

                                {/* ชื่อหอพัก / สาขา */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <label style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--color-text, #1e293b)' }}>
                                        ชื่อหอพัก / สาขา <span style={{ color: '#ef4444' }}>*</span>
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="เช่น หอพักสุขใจ, อาคาร A"
                                        value={dormName}
                                        onChange={e => setDormName(e.target.value)}
                                        required
                                        style={{
                                            width: '100%', padding: '0.65rem 0.875rem', borderRadius: '10px',
                                            border: '1px solid var(--color-gray-200, #e2e8f0)', background: 'var(--color-white, #fff)',
                                            color: 'var(--color-text, #1e293b)', outline: 'none', fontSize: '0.9rem'
                                        }}
                                    />
                                </div>

                                {/* ประเภทอาคาร */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <label style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--color-text, #1e293b)' }}>ประเภทอาคาร</label>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
                                        {BUILDING_TYPES.map(bt => {
                                            const isSelected = buildingType === bt.type;
                                            return (
                                                <button
                                                    key={bt.type}
                                                    type="button"
                                                    onClick={() => setBuildingType(bt.type as DormConfig['building_type'])}
                                                    style={{
                                                        padding: '0.5rem 0.25rem',
                                                        borderRadius: '10px',
                                                        border: isSelected ? '1.5px solid var(--color-primary, #0ea5e9)' : '1px solid var(--color-gray-200, #e2e8f0)',
                                                        background: isSelected ? 'rgba(14, 165, 233, 0.14)' : 'var(--color-white, #fff)',
                                                        color: isSelected ? 'var(--color-primary, #0ea5e9)' : 'var(--color-text-muted, #64748b)',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        gap: '0.2rem',
                                                        cursor: 'pointer',
                                                        fontSize: '0.72rem',
                                                        fontWeight: isSelected ? 700 : 500,
                                                        transition: 'all 0.15s ease'
                                                    }}
                                                >
                                                    {bt.icon}
                                                    <span>{bt.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* ค่าไฟ & ค่าน้ำ */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text, #1e293b)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                            <Zap size={14} color="#f59e0b" /> ค่าไฟ (฿/หน่วย)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.5"
                                            min="0"
                                            value={elecRate}
                                            onChange={e => setElecRate(Number(e.target.value) || 0)}
                                            required
                                            style={{
                                                width: '100%', padding: '0.6rem 0.75rem', borderRadius: '10px',
                                                border: '1px solid var(--color-gray-200, #e2e8f0)', background: 'var(--color-white, #fff)',
                                                color: 'var(--color-text, #1e293b)', outline: 'none', fontSize: '0.875rem'
                                            }}
                                        />
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text, #1e293b)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                            <Droplets size={14} color="#0ea5e9" /> รูปแบบค่าน้ำ
                                        </label>
                                        <div style={{ display: 'flex', background: 'rgba(148, 163, 184, 0.15)', borderRadius: '8px', padding: '2px', gap: '2px' }}>
                                            <button
                                                type="button"
                                                onClick={() => setWaterMode('normal')}
                                                style={{
                                                    flex: 1, padding: '0.4rem 0.2rem', borderRadius: '6px', border: 'none',
                                                    fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                                                    background: waterMode === 'normal' ? 'var(--color-white, #fff)' : 'transparent',
                                                    color: waterMode === 'normal' ? 'var(--color-primary, #0ea5e9)' : 'var(--color-text-muted, #64748b)',
                                                    boxShadow: waterMode === 'normal' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none'
                                                }}
                                            >
                                                ตามมิเตอร์
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setWaterMode('flat')}
                                                style={{
                                                    flex: 1, padding: '0.4rem 0.2rem', borderRadius: '6px', border: 'none',
                                                    fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                                                    background: waterMode === 'flat' ? 'var(--color-white, #fff)' : 'transparent',
                                                    color: waterMode === 'flat' ? 'var(--color-primary, #0ea5e9)' : 'var(--color-text-muted, #64748b)',
                                                    boxShadow: waterMode === 'flat' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none'
                                                }}
                                            >
                                                เหมาจ่าย
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* ช่องกรอกค่าน้ำ */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text, #1e293b)' }}>
                                        {waterMode === 'normal' ? 'ค่าน้ำต่อหน่วย (บาท/หน่วย)' : 'ค่าเหมาจ่ายน้ำ (บาท/เดือน)'}
                                    </label>
                                    <input
                                        type="number"
                                        step={waterMode === 'normal' ? '0.5' : '10'}
                                        min="0"
                                        value={waterMode === 'normal' ? waterUnitRate : waterFlatRate}
                                        onChange={e => {
                                            const val = Number(e.target.value) || 0;
                                            if (waterMode === 'normal') setWaterUnitRate(val);
                                            else setWaterFlatRate(val);
                                        }}
                                        required
                                        style={{
                                            width: '100%', padding: '0.6rem 0.75rem', borderRadius: '10px',
                                            border: '1px solid var(--color-gray-200, #e2e8f0)', background: 'var(--color-white, #fff)',
                                            color: 'var(--color-text, #1e293b)', outline: 'none', fontSize: '0.875rem'
                                        }}
                                    />
                                </div>

                                {/* ค่าเช่าห้อง & กำหนดชำระ */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text, #1e293b)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                            <DollarSign size={14} color="#10b981" /> ค่าเช่าเริ่มต้น (฿/ด.)
                                        </label>
                                        <input
                                            type="number"
                                            step="100"
                                            min="0"
                                            value={roomRent}
                                            onChange={e => setRoomRent(Number(e.target.value) || 0)}
                                            required
                                            style={{
                                                width: '100%', padding: '0.6rem 0.75rem', borderRadius: '10px',
                                                border: '1px solid var(--color-gray-200, #e2e8f0)', background: 'var(--color-white, #fff)',
                                                color: 'var(--color-text, #1e293b)', outline: 'none', fontSize: '0.875rem'
                                            }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text, #1e293b)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                            <Calendar size={14} color="#0ea5e9" /> กำหนดชำระทุกวันที่
                                        </label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="31"
                                            value={dueDay}
                                            onChange={e => setDueDay(Number(e.target.value) || 5)}
                                            required
                                            style={{
                                                width: '100%', padding: '0.6rem 0.75rem', borderRadius: '10px',
                                                border: '1px solid var(--color-gray-200, #e2e8f0)', background: 'var(--color-white, #fff)',
                                                color: 'var(--color-text, #1e293b)', outline: 'none', fontSize: '0.875rem'
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text, #1e293b)' }}>อีเมล <span style={{ color: '#ef4444' }}>*</span></label>
                        <input
                            type="email"
                            placeholder="email@example.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                            style={{
                                width: '100%', padding: '0.75rem 1rem', borderRadius: '10px',
                                border: '1px solid var(--color-gray-200, #e2e8f0)', background: 'var(--color-white, #fff)',
                                color: 'var(--color-text, #1e293b)', outline: 'none', fontSize: '0.9rem'
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text, #1e293b)' }}>รหัสผ่าน <span style={{ color: '#ef4444' }}>*</span></label>
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
                                    width: '100%', padding: '0.75rem 2.5rem 0.75rem 1rem', borderRadius: '10px',
                                    border: '1px solid var(--color-gray-200, #e2e8f0)', background: 'var(--color-white, #fff)',
                                    color: 'var(--color-text, #1e293b)', outline: 'none', fontSize: '0.9rem'
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                                    color: 'var(--color-text-muted, #6B7280)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    {mode === 'register' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginTop: '0.25rem' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text, #1e293b)' }}>
                                คุณรู้จักเราได้อย่างไร? <span style={{ color: 'var(--color-text-muted, #64748b)', fontWeight: 400, fontSize: '0.78rem' }}>(เลือกได้หลายข้อ)</span>
                            </label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                {['Google', 'Facebook', 'เพื่อนแนะนำ', 'LINE', 'TikTok', 'อื่นๆ'].map(source => (
                                    <label key={source} style={{
                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                        padding: '0.55rem 0.85rem', border: '1px solid var(--color-gray-200, #e2e8f0)',
                                        background: 'var(--color-white, #fff)', color: 'var(--color-text, #1e293b)',
                                        borderRadius: '10px', cursor: 'pointer', fontSize: '0.825rem', fontWeight: 500,
                                        transition: 'all 0.15s ease'
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
                                            style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--color-primary, #0ea5e9)' }}
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
