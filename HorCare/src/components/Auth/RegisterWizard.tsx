import { useState } from 'react';
import {
    AlertTriangle, ArrowRight, Building, Building2, Calendar, Check, ChevronLeft, DollarSign, Droplets, Eye, EyeOff,
    Home, Hotel, Loader2, Store, Zap,
} from 'lucide-react';
import type { DormConfig, InitialBuildingConfig, WaterConfig } from '../../types';
import { getWorkspaceTerms } from '../../utils/workspaceTerminology';
import { MIN_PASSWORD, SIGNUP_STEPS, signupStepIssue, type SignupData } from '../../shared/signupSteps';

interface RegisterWizardProps {
    onRegister: (email: string, password: string, name: string, initialBuilding?: InitialBuildingConfig) => Promise<void>;
    /** Error from the sign-up call (shown on the last step). */
    error: string | null;
    clearError: () => void;
}

const BUILDING_TYPES = [
    { type: 'dormitory', label: 'หอพัก', icon: <Building2 size={20} /> },
    { type: 'market', label: 'ตลาด / แผงค้า', icon: <Store size={20} /> },
    { type: 'apartment', label: 'อพาร์ตเมนต์', icon: <Building size={20} /> },
    { type: 'condo', label: 'คอนโดมิเนียม', icon: <Building size={20} /> },
    { type: 'house', label: 'บ้านเช่า', icon: <Home size={20} /> },
    { type: 'commercial', label: 'อาคารพาณิชย์', icon: <Store size={20} /> },
    { type: 'resort', label: 'รีสอร์ท/รร.', icon: <Hotel size={20} /> },
] as const;

const REFERRALS = ['Google', 'Facebook', 'เพื่อนแนะนำ', 'LINE', 'TikTok', 'อื่นๆ'];

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.75rem 1rem', borderRadius: '10px',
    border: '1px solid var(--color-gray-200, #dce5ef)', background: 'var(--color-white, #fff)',
    color: 'var(--color-text, #1a3350)', outline: 'none', fontSize: '0.95rem',
};
const labelStyle: React.CSSProperties = { fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text, #1a3350)', display: 'flex', alignItems: 'center', gap: '0.3rem' };
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.4rem' };

/** Sign-up one short step at a time, so a new owner never faces the whole form at once. */
export default function RegisterWizard({ onRegister, error, clearError }: RegisterWizardProps) {
    const [step, setStep] = useState(0);
    const [issue, setIssue] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [phone, setPhone] = useState('');
    const [referralSources, setReferralSources] = useState<string[]>([]);
    const [dormName, setDormName] = useState('');
    const [buildingType, setBuildingType] = useState<DormConfig['building_type']>('dormitory');
    const [elecRate, setElecRate] = useState(8);
    const [waterMode, setWaterMode] = useState<'normal' | 'flat'>('normal');
    const [waterUnitRate, setWaterUnitRate] = useState(18);
    const [waterFlatRate, setWaterFlatRate] = useState(100);
    const [roomRent, setRoomRent] = useState(3500);
    const [dueDay, setDueDay] = useState(5);

    const terms = getWorkspaceTerms(buildingType);
    const current = SIGNUP_STEPS[step];
    const last = step === SIGNUP_STEPS.length - 1;
    const data: SignupData = {
        email, password, firstName, lastName, phone, dormName,
        elecRate, waterRate: waterMode === 'normal' ? waterUnitRate : waterFlatRate, roomRent, dueDay,
    };

    const go = (to: number) => { setIssue(null); clearError(); setStep(to); };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const problem = signupStepIssue(current.id, data);
        if (problem) { setIssue(problem); return; }
        if (!last) { go(step + 1); return; }

        const water_config: WaterConfig = waterMode === 'normal'
            ? { type: 'normal', unit_rate: Number(waterUnitRate) || 18 }
            : { type: 'flat_rate_tier', flat_price: Number(waterFlatRate) || 100, flat_limit_unit: 0, excess_unit_rate: Number(waterUnitRate) || 18 };
        setLoading(true);
        try {
            await onRegister(email.trim(), password, `${firstName.trim()} ${lastName.trim()}`.trim(), {
                dorm_name: dormName.trim() || 'หอพักของฉัน',
                building_type: buildingType,
                electricity_rate: Number(elecRate) || 8,
                water_config,
                room_rent: Number(roomRent) || 3500,
                due_day: Number(dueDay) || 5,
                phone: phone.trim(),
                referral_sources: referralSources,
            });
        } catch {
            // the parent shows the error
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* progress */}
            <div className="su-progress" aria-label={`ขั้นที่ ${step + 1} จาก ${SIGNUP_STEPS.length}`}>
                <ol className="su-dots">
                    {SIGNUP_STEPS.map((s, i) => (
                        <li key={s.id} className={i < step ? 'is-done' : i === step ? 'is-current' : ''} aria-current={i === step ? 'step' : undefined}>
                            <span className="su-dot">{i < step ? <Check size={12} /> : i + 1}</span>
                        </li>
                    ))}
                </ol>
                <div className="su-step-label">ขั้นที่ {step + 1} จาก {SIGNUP_STEPS.length}</div>
                <h2 className="su-title">{current.title}</h2>
                <p className="su-hint">{current.hint}</p>
            </div>

            {current.id === 'account' && (
                <>
                    <label style={field}>
                        <span style={labelStyle}>อีเมล</span>
                        <input type="email" placeholder="email@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" autoFocus style={inputStyle} />
                    </label>
                    <label style={field}>
                        <span style={labelStyle}>รหัสผ่าน</span>
                        <div style={{ position: 'relative' }}>
                            <input
                                type={showPassword ? 'text' : 'password'} placeholder={`อย่างน้อย ${MIN_PASSWORD} ตัวอักษร`} value={password}
                                onChange={e => setPassword(e.target.value)} autoComplete="new-password" style={{ ...inputStyle, paddingRight: '2.5rem' }}
                            />
                            <button
                                type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--color-text-muted, #557089)', display: 'flex' }}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </label>
                </>
            )}

            {current.id === 'about' && (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <label style={field}>
                            <span style={labelStyle}>ชื่อ</span>
                            <input type="text" placeholder="สมชาย" value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="given-name" autoFocus style={inputStyle} />
                        </label>
                        <label style={field}>
                            <span style={labelStyle}>นามสกุล</span>
                            <input type="text" placeholder="ใจดี" value={lastName} onChange={e => setLastName(e.target.value)} autoComplete="family-name" style={inputStyle} />
                        </label>
                    </div>
                    <label style={field}>
                        <span style={labelStyle}>เบอร์โทรศัพท์</span>
                        <input type="tel" inputMode="tel" placeholder="08X-XXX-XXXX" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" style={inputStyle} />
                    </label>
                    <div style={field}>
                        <span style={labelStyle}>รู้จักเราจากที่ไหน <span style={{ color: 'var(--color-text-muted, #557089)', fontWeight: 400, fontSize: '0.78rem' }}>(ไม่บังคับ)</span></span>
                        <div className="su-chips">
                            {REFERRALS.map(source => {
                                const on = referralSources.includes(source);
                                return (
                                    <button
                                        key={source} type="button" className={`su-chip${on ? ' is-on' : ''}`} aria-pressed={on}
                                        onClick={() => setReferralSources(prev => (on ? prev.filter(s => s !== source) : [...prev, source]))}
                                    >
                                        {on && <Check size={13} />} {source}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

            {current.id === 'place' && (
                <>
                    <div style={field}>
                        <span style={labelStyle}>ประเภท</span>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                            {BUILDING_TYPES.map(bt => {
                                const on = buildingType === bt.type;
                                return (
                                    <button
                                        key={bt.type} type="button" aria-pressed={on} onClick={() => setBuildingType(bt.type)}
                                        className={`su-type${on ? ' is-on' : ''}`}
                                    >
                                        {bt.icon}
                                        <span>{bt.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <label style={field}>
                        <span style={labelStyle}>ชื่อ{terms.facilityType}</span>
                        <input type="text" placeholder={terms.isMarket ? 'เช่น ตลาดสดสุขใจ' : 'เช่น หอพักสุขใจ, อาคาร A'} value={dormName} onChange={e => setDormName(e.target.value)} autoFocus style={inputStyle} />
                    </label>
                </>
            )}

            {current.id === 'rates' && (
                <>
                    <label style={field}>
                        <span style={labelStyle}><DollarSign size={14} color="#22a35a" /> ค่าเช่าเริ่มต้นต่อ{terms.unitName} (บาท/เดือน)</span>
                        <input type="number" step="100" min="0" value={roomRent} onChange={e => setRoomRent(Number(e.target.value) || 0)} style={inputStyle} />
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <label style={field}>
                            <span style={labelStyle}><Zap size={14} color="#f59e2e" /> ค่าไฟ (บาท/หน่วย)</span>
                            <input type="number" step="0.5" min="0" value={elecRate} onChange={e => setElecRate(Number(e.target.value) || 0)} style={inputStyle} />
                        </label>
                        <label style={field}>
                            <span style={labelStyle}><Calendar size={14} color="#0a6cc2" /> ครบกำหนดชำระวันที่</span>
                            <input type="number" min="1" max="31" value={dueDay} onChange={e => setDueDay(Number(e.target.value) || 0)} style={inputStyle} />
                        </label>
                    </div>
                    <div style={field}>
                        <span style={labelStyle}><Droplets size={14} color="#0a6cc2" /> ค่าน้ำ</span>
                        <div className="su-segment">
                            <button type="button" className={waterMode === 'normal' ? 'is-on' : ''} onClick={() => setWaterMode('normal')}>ตามมิเตอร์</button>
                            <button type="button" className={waterMode === 'flat' ? 'is-on' : ''} onClick={() => setWaterMode('flat')}>เหมาจ่าย</button>
                        </div>
                        <input
                            type="number" min="0" step={waterMode === 'normal' ? '0.5' : '10'} aria-label={waterMode === 'normal' ? 'ค่าน้ำต่อหน่วย' : 'ค่าน้ำเหมาจ่ายต่อเดือน'}
                            value={waterMode === 'normal' ? waterUnitRate : waterFlatRate}
                            onChange={e => { const v = Number(e.target.value) || 0; if (waterMode === 'normal') setWaterUnitRate(v); else setWaterFlatRate(v); }}
                            style={inputStyle}
                        />
                        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #557089)' }}>
                            {waterMode === 'normal' ? 'บาทต่อหน่วย' : 'บาทต่อเดือน'} · ไม่แน่ใจใช้ค่าที่ตั้งไว้ไปก่อนได้ แก้ได้ในหน้าตั้งค่า
                        </span>
                    </div>
                </>
            )}

            {(issue || (last && error)) && (
                <div className="login-error" role="alert">
                    <AlertTriangle size={16} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }} /> {issue ?? error}
                    {!issue && error && (
                        <button type="button" className="su-link" onClick={() => go(0)}>แก้อีเมล / รหัสผ่าน</button>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', gap: '0.625rem' }}>
                {step > 0 && (
                    <button type="button" className="btn btn-outline" onClick={() => go(step - 1)} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ChevronLeft size={16} /> ย้อนกลับ
                    </button>
                )}
                <button type="submit" className="login-button" disabled={loading} style={{ flex: 1 }}>
                    {loading ? <Loader2 size={20} className="spin" /> : <>{last ? 'สมัครสมาชิก' : 'ถัดไป'} <ArrowRight size={18} /></>}
                </button>
            </div>
        </form>
    );
}
