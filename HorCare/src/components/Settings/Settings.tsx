import { useState } from 'react';
import { Save, Zap, Droplets, Home, Lock, Eye, EyeOff, Check, Building2, Trees, Hotel, LayoutGrid, FileText, BarChart3, Settings as SettingsIcon, AlertTriangle, Palette, Sun, Moon, Monitor, MessageCircle, Copy, RefreshCw, Share2, QrCode, ExternalLink } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { auth } from '../../firebase/config';
import type { DormConfig, WaterConfig } from '../../types';
import { generateDormCode } from '../../utils/calculations';
import { THEME_PRESETS } from '../../hooks/useTheme';
import type { ThemeMode } from '../../hooks/useTheme';

interface SettingsProps {
    config: DormConfig;
    onSaveConfig: (config: DormConfig) => void;
    themeId: string;
    onSetTheme: (id: string) => void;
    mode: ThemeMode;
    onSetMode: (m: ThemeMode) => void;
}

const BUILDING_TYPES = [
    {
        key: 'dormitory',
        icon: Home,
        iconBg: '#E0E7FF',
        iconColor: '#4F46E5',
        title: 'หอพัก',
        subtitle: '(Dormitory)',
        desc: 'คิดค่าน้ำ/ไฟอัตราเดียวกันทุกห้อง',
    },
    {
        key: 'commercial',
        icon: Building2,
        iconBg: '#FEF3C7',
        iconColor: '#D97706',
        title: 'อาคารพาณิชย์',
        subtitle: '(Commercial)',
        desc: 'ตั้งค่าน้ำ/ไฟแยกรายห้องได้',
    },
    {
        key: 'resort',
        icon: Trees,
        iconBg: '#D1FAE5',
        iconColor: '#059669',
        title: 'รีสอร์ท',
        subtitle: '(Resort)',
        desc: 'เหมาะสำหรับรีสอร์ทและที่พักธรรมชาติ',
    },
    {
        key: 'hotel',
        icon: Hotel,
        iconBg: '#DBEAFE',
        iconColor: '#2563EB',
        title: 'โรงแรม',
        subtitle: '(Hotel)',
        desc: 'สำหรับโรงแรมและที่พักแบบมืออาชีพ',
    },
    {
        key: 'other',
        icon: LayoutGrid,
        iconBg: '#F3F4F6',
        iconColor: '#6B7280',
        title: 'อื่นๆ',
        subtitle: '(Others)',
        desc: 'อาคารประเภทอื่นที่ต้องการจัดการมิเตอร์',
    },
];

export default function Settings({ config, onSaveConfig, themeId, onSetTheme, mode, onSetMode }: SettingsProps) {
    const [formData, setFormData] = useState({
        building_type: config.building_type || 'dormitory',
        electricity_rate: config.electricity_rate,
        room_rent: config.room_rent,
        // Dormitory water
        dorm_water_type: config.water_config.type,
        dorm_water_unit_rate: config.water_config.unit_rate || 0,
        dorm_water_flat_price: config.water_config.flat_price || 250,
        dorm_water_flat_limit: config.water_config.flat_limit_unit || 10,
        dorm_water_excess_rate: config.water_config.excess_unit_rate || 25,
        // Commercial water
        comm_water_type: config.commercial_water_config?.type || 'normal',
        comm_water_unit_rate: config.commercial_water_config?.unit_rate || 24,
        comm_water_flat_price: config.commercial_water_config?.flat_price || 250,
        comm_water_flat_limit: config.commercial_water_config?.flat_limit_unit || 10,
        comm_water_excess_rate: config.commercial_water_config?.excess_unit_rate || 25
    });
    const [saved, setSaved] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPasswords, setShowPasswords] = useState(false);
    const [passwordStatus, setPasswordStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [passwordError, setPasswordError] = useState('');
    const [dormCode, setDormCode] = useState(config.dorm_code || '');
    const [codeCopied, setCodeCopied] = useState(false);
    const [showQR, setShowQR] = useState(false);

    // Bill customization state
    const [billForm, setBillForm] = useState({
        dorm_name: config.bill_customization?.dorm_name || '',
        dorm_address: config.bill_customization?.dorm_address || '',
        dorm_phone: config.bill_customization?.dorm_phone || '',
        promptpay_number: config.bill_customization?.promptpay_number || '',
        promptpay_name: config.bill_customization?.promptpay_name || '',
        footer_text: config.bill_customization?.footer_text || 'กรุณาชำระภายในวันที่ 5 ของทุกเดือน',
        due_day: config.bill_customization?.due_day || 5,
    });

    const [prevConfig, setPrevConfig] = useState(config);

    if (config !== prevConfig) {
        setPrevConfig(config);
        setFormData({
            building_type: config.building_type || 'dormitory',
            electricity_rate: config.electricity_rate,
            room_rent: config.room_rent,
            dorm_water_type: config.water_config.type,
            dorm_water_unit_rate: config.water_config.unit_rate || 0,
            dorm_water_flat_price: config.water_config.flat_price || 250,
            dorm_water_flat_limit: config.water_config.flat_limit_unit || 10,
            dorm_water_excess_rate: config.water_config.excess_unit_rate || 25,
            comm_water_type: config.commercial_water_config?.type || 'normal',
            comm_water_unit_rate: config.commercial_water_config?.unit_rate || 24,
            comm_water_flat_price: config.commercial_water_config?.flat_price || 250,
            comm_water_flat_limit: config.commercial_water_config?.flat_limit_unit || 10,
            comm_water_excess_rate: config.commercial_water_config?.excess_unit_rate || 25
        });
        setBillForm({
            dorm_name: config.bill_customization?.dorm_name || '',
            dorm_address: config.bill_customization?.dorm_address || '',
            dorm_phone: config.bill_customization?.dorm_phone || '',
            promptpay_number: config.bill_customization?.promptpay_number || '',
            promptpay_name: config.bill_customization?.promptpay_name || '',
            footer_text: config.bill_customization?.footer_text || 'กรุณาชำระภายในวันที่ 5 ของทุกเดือน',
            due_day: config.bill_customization?.due_day || 5,
        });
        setDormCode(config.dorm_code || '');
    }

    const handleChange = (field: string, value: string | number) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setSaved(false);
    };

    const handleSave = () => {
        const dormWaterConfig: WaterConfig = formData.dorm_water_type === 'normal'
            ? { type: 'normal', unit_rate: Number(formData.dorm_water_unit_rate) }
            : {
                type: 'flat_rate_tier',
                flat_price: Number(formData.dorm_water_flat_price),
                flat_limit_unit: Number(formData.dorm_water_flat_limit),
                excess_unit_rate: Number(formData.dorm_water_excess_rate)
            };

        const commWaterConfig: WaterConfig = formData.comm_water_type === 'normal'
            ? { type: 'normal', unit_rate: Number(formData.comm_water_unit_rate) }
            : {
                type: 'flat_rate_tier',
                flat_price: Number(formData.comm_water_flat_price),
                flat_limit_unit: Number(formData.comm_water_flat_limit),
                excess_unit_rate: Number(formData.comm_water_excess_rate)
            };

        const newConfig: DormConfig = {
            building_type: formData.building_type as 'dormitory' | 'commercial',
            electricity_rate: Number(formData.electricity_rate),
            room_rent: Number(formData.room_rent),
            water_config: dormWaterConfig,
            commercial_water_config: commWaterConfig,
            bill_customization: {
                dorm_name: billForm.dorm_name,
                dorm_address: billForm.dorm_address,
                dorm_phone: billForm.dorm_phone,
                promptpay_number: billForm.promptpay_number,
                promptpay_name: billForm.promptpay_name,
                footer_text: billForm.footer_text,
                due_day: Number(billForm.due_day) || 5,
            },
            ...(dormCode ? { dorm_code: dormCode } : {})
        };

        onSaveConfig(newConfig);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const handleBillFormChange = (field: string, value: string | number) => {
        setBillForm(prev => ({ ...prev, [field]: value }));
        setSaved(false);
    };



    const handleChangePassword = async () => {
        setPasswordError('');

        if (newPassword.length < 6) {
            setPasswordError('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordError('รหัสผ่านใหม่ไม่ตรงกัน');
            return;
        }

        const user = auth.currentUser;
        if (!user || !user.email) return;

        setPasswordStatus('loading');
        try {
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPassword);

            setPasswordStatus('success');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setTimeout(() => setPasswordStatus('idle'), 3000);
        } catch (err: unknown) {
            setPasswordStatus('error');
            const firebaseErr = err as { code?: string };
            if (firebaseErr.code === 'auth/wrong-password' || firebaseErr.code === 'auth/invalid-credential') {
                setPasswordError('รหัสผ่านปัจจุบันไม่ถูกต้อง');
            } else {
                setPasswordError('เกิดข้อผิดพลาด กรุณาลองใหม่');
            }
        }
    };

    const renderWaterForm = (prefix: 'dorm' | 'comm', waterType: string) => {
        const typeField = `${prefix}_water_type`;
        const unitRateField = `${prefix}_water_unit_rate`;
        const flatPriceField = `${prefix}_water_flat_price`;
        const flatLimitField = `${prefix}_water_flat_limit`;
        const excessRateField = `${prefix}_water_excess_rate`;

        return (
            <>
                <div className="form-group">
                    <label className="form-label">รูปแบบการคิดค่าน้ำ</label>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                            className={`btn ${waterType === 'flat_rate_tier' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => handleChange(typeField, 'flat_rate_tier')}
                            style={{ flex: 1, minWidth: '140px', padding: '0.75rem 1rem', fontSize: '0.9375rem' }}
                        >
                            <Droplets size={16} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} /> เหมาจ่าย + ส่วนเกิน
                        </button>
                        <button
                            className={`btn ${waterType === 'normal' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => handleChange(typeField, 'normal')}
                            style={{ flex: 1, minWidth: '140px', padding: '0.75rem 1rem', fontSize: '0.9375rem' }}
                        >
                            <BarChart3 size={16} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }} /> คิดตามจริง (บาท/หน่วย)
                        </button>
                    </div>
                </div>

                {waterType === 'normal' ? (
                    <div className="form-group">
                        <label className="form-label">ราคาต่อหน่วย (บาท)</label>
                        <input
                            type="number"
                            className="form-input mono"
                            style={{ maxWidth: '200px', padding: '0.75rem 1rem', fontSize: '1rem' }}
                            value={(formData as Record<string, string | number>)[unitRateField]}
                            onChange={e => handleChange(unitRateField, e.target.value)}
                        />
                        <p className="form-hint">ราคาที่เรียกเก็บต่อหน่วยน้ำ</p>
                    </div>
                ) : (
                    <div className="settings-grid">
                        <div className="form-group">
                            <label className="form-label">ราคาเหมาจ่าย (บาท)</label>
                            <input
                                type="number"
                                className="form-input mono"
                                style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                                value={(formData as Record<string, string | number>)[flatPriceField]}
                                onChange={e => handleChange(flatPriceField, e.target.value)}
                            />
                            <p className="form-hint">ราคาขั้นต่ำที่เรียกเก็บ</p>
                        </div>
                        <div className="form-group">
                            <label className="form-label">หน่วยที่รวมในเหมา</label>
                            <input
                                type="number"
                                className="form-input mono"
                                style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                                value={(formData as Record<string, string | number>)[flatLimitField]}
                                onChange={e => handleChange(flatLimitField, e.target.value)}
                            />
                            <p className="form-hint">จำนวนหน่วยที่ใช้ได้ในราคาเหมา</p>
                        </div>
                        <div className="form-group">
                            <label className="form-label">ราคาหน่วยส่วนเกิน (บาท)</label>
                            <input
                                type="number"
                                className="form-input mono"
                                style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                                value={(formData as Record<string, string | number>)[excessRateField]}
                                onChange={e => handleChange(excessRateField, e.target.value)}
                            />
                            <p className="form-hint">ราคาต่อหน่วยเมื่อใช้เกินกำหนด</p>
                        </div>
                    </div>
                )}
            </>
        );
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><SettingsIcon size={28} /> ตั้งค่าระบบ</h1>
                <p className="page-subtitle">กำหนดอัตราค่าบริการและค่าเช่า</p>
            </div>

            {/* Supported Building Types (Static Display) */}
            <div className="settings-section">
                <h3 className="settings-title">
                    <Building2 size={20} color="#6366F1" />
                    ประเภทอาคารที่รองรับ
                </h3>
                <p className="form-hint" style={{ marginBottom: '1rem' }}>
                    ระบบ HorCare รองรับอาคารหลายประเภท — ตั้งค่าประเภทห้องได้ในหน้าจัดการห้อง
                </p>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                    gap: '0.75rem',
                }}>
                    {BUILDING_TYPES.map(bt => {
                        const Icon = bt.icon;
                        return (
                            <div
                                key={bt.key}
                                style={{
                                    padding: '1rem',
                                    border: '1px solid var(--color-gray-200)',
                                    borderRadius: '12px',
                                    backgroundColor: 'var(--color-gray-50)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    textAlign: 'center',
                                }}
                            >
                                <div style={{
                                    background: bt.iconBg,
                                    padding: '0.65rem',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <Icon size={22} color={bt.iconColor} />
                                </div>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.3, color: 'var(--color-gray-800)' }}>{bt.title}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', lineHeight: 1.3 }}>{bt.subtitle}</div>
                                </div>
                                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-gray-400)', lineHeight: 1.4 }}>
                                    {bt.desc}
                                </p>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Electricity Settings */}
            <div className="settings-section">
                <h3 className="settings-title">
                    <Zap size={20} color="#F59E0B" />
                    {formData.building_type === 'commercial' ? 'ค่าไฟฟ้า (เริ่มต้น)' : 'ค่าไฟฟ้า'}
                </h3>
                <div className="form-group">
                    <label className="form-label">ราคาต่อหน่วย (บาท)</label>
                    <input
                        type="number"
                        className="form-input mono"
                        style={{ maxWidth: '200px', padding: '0.75rem 1rem', fontSize: '1rem' }}
                        value={formData.electricity_rate}
                        onChange={e => handleChange('electricity_rate', e.target.value)}
                    />
                    <p className="form-hint">
                        {formData.building_type === 'commercial'
                            ? 'ราคาเริ่มต้น (ห้องที่ไม่ได้ตั้งค่าเฉพาะจะใช้ค่านี้)'
                            : 'ราคาที่เรียกเก็บต่อหน่วยไฟฟ้า'
                        }
                    </p>
                </div>
            </div>

            {/* Water Settings - Dormitory */}
            <div className="settings-section">
                <h3 className="settings-title">
                    <Droplets size={20} color="#2563EB" />
                    <Home size={20} color="#2563EB" style={{ marginRight: '8px' }} />
                    ค่าน้ำประปา — หอพัก
                </h3>
                <p className="form-hint" style={{ marginBottom: 'var(--space-4)', fontSize: '0.875rem', color: 'var(--color-gray-500)' }}>
                    ใช้สำหรับห้องที่ตั้งประเภทเป็น "หอพัก"
                </p>
                {renderWaterForm('dorm', formData.dorm_water_type)}
            </div>

            {/* Water Settings - Commercial */}
            <div className="settings-section">
                <h3 className="settings-title">
                    <Droplets size={20} color="#8B5CF6" />
                    <Building2 size={20} color="#8B5CF6" style={{ marginRight: '8px' }} />
                    ค่าน้ำประปา — อาคารพาณิชย์
                </h3>
                <p className="form-hint" style={{ marginBottom: 'var(--space-4)', fontSize: '0.875rem', color: 'var(--color-gray-500)' }}>
                    ใช้สำหรับห้องที่ตั้งประเภทเป็น "พาณิชย์" (ตั้งค่าเฉพาะห้องได้ในหน้าจัดการห้อง)
                </p>
                {renderWaterForm('comm', formData.comm_water_type)}
            </div>

            {/* Room Rent Settings */}
            <div className="settings-section">
                <h3 className="settings-title">
                    <Home size={20} color="#16A34A" />
                    ค่าเช่าห้อง
                </h3>
                <div className="form-group">
                    <label className="form-label">ค่าเช่าเริ่มต้น (บาท)</label>
                    <input
                        type="number"
                        className="form-input mono"
                        style={{ maxWidth: '200px', padding: '0.75rem 1rem', fontSize: '1rem' }}
                        value={formData.room_rent}
                        onChange={e => handleChange('room_rent', e.target.value)}
                    />
                    <p className="form-hint">ค่าเช่าเริ่มต้นสำหรับห้องใหม่ (แก้ไขรายห้องได้ในหน้าจัดการห้อง)</p>
                </div>
            </div>

            {/* Bill Customization */}
            <div className="settings-section">
                <h3 className="settings-title">
                    <FileText size={20} color="#8B5CF6" />
                    ตั้งค่าใบแจ้งหนี้
                </h3>
                <p className="form-hint" style={{ marginBottom: 'var(--space-4)', fontSize: '0.875rem', color: 'var(--color-gray-500)' }}>
                    ข้อมูลเหล่านี้จะแสดงในใบแจ้งหนี้ทุกใบ และเอกสารสรุปรายเดือน
                </p>

                <div className="settings-grid">
                    <div className="form-group">
                        <label className="form-label">ชื่อหอพัก</label>
                        <input
                            type="text"
                            className="form-input"
                            style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                            value={billForm.dorm_name}
                            onChange={e => handleBillFormChange('dorm_name', e.target.value)}
                            placeholder="เช่น หอพักสุขใจ"
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">เบอร์โทรศัพท์</label>
                        <input
                            type="text"
                            className="form-input"
                            style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                            value={billForm.dorm_phone}
                            onChange={e => handleBillFormChange('dorm_phone', e.target.value)}
                            placeholder="เช่น 081-234-5678"
                        />
                    </div>
                </div>

                <div className="form-group">
                    <label className="form-label">ที่อยู่</label>
                    <input
                        type="text"
                        className="form-input"
                        style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                        value={billForm.dorm_address}
                        onChange={e => handleBillFormChange('dorm_address', e.target.value)}
                        placeholder="เช่น 123 ถ.มิตรภาพ อ.เมือง จ.ขอนแก่น 40000"
                    />
                </div>

                <div className="settings-grid">
                    <div className="form-group">
                        <label className="form-label">เลข PromptPay (เบอร์โทร หรือ บัตรประชาชน)</label>
                        <input
                            type="text"
                            className="form-input"
                            style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                            value={billForm.promptpay_number}
                            onChange={e => handleBillFormChange('promptpay_number', e.target.value)}
                            placeholder="เช่น 0812345678"
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">ชื่อบัญชี PromptPay</label>
                        <input
                            type="text"
                            className="form-input"
                            style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                            value={billForm.promptpay_name}
                            onChange={e => handleBillFormChange('promptpay_name', e.target.value)}
                            placeholder="เช่น นาย สมมติ ทดสอบ"
                        />
                    </div>
                </div>

                <div className="settings-grid">
                    <div className="form-group">
                        <label className="form-label">ข้อความด้านล่างบิล (Footer)</label>
                        <input
                            type="text"
                            className="form-input"
                            style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                            value={billForm.footer_text}
                            onChange={e => handleBillFormChange('footer_text', e.target.value)}
                            placeholder="เช่น กรุณาชำระภายในวันที่ 5 ของทุกเดือน"
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">กำหนดชำระ (วันที่)</label>
                        <input
                            type="number"
                            className="form-input mono"
                            style={{ maxWidth: '120px', padding: '0.75rem 1rem', fontSize: '1rem' }}
                            value={billForm.due_day}
                            min={1}
                            max={28}
                            onChange={e => handleBillFormChange('due_day', e.target.value)}
                        />
                        <p className="form-hint">วันที่กำหนดชำระในแต่ละเดือน</p>
                    </div>
                </div>
            </div>

            {/* LINE Integration */}
            <div className="settings-section">
                <h3 className="settings-title">
                    <MessageCircle size={20} color="#06C755" />
                    เชื่อมต่อ LINE (ส่งบิลผ่าน LINE)
                </h3>
                <p className="form-hint" style={{ marginBottom: 'var(--space-5)' }}>
                    สร้าง Invite Link แล้วส่งให้ลูกหอ — กดลิ้งก์เดียว พิมพ์เลขห้อง แล้วจบ ✅
                </p>

                {/* Dorm Code row */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    marginBottom: 'var(--space-5)',
                    flexWrap: 'wrap',
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                    }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-gray-600)', whiteSpace: 'nowrap' }}>
                            รหัสหอพัก
                        </span>
                        {dormCode ? (
                            <span style={{
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 800,
                                fontSize: '1rem',
                                letterSpacing: '0.12em',
                                color: 'var(--color-gray-900)',
                                background: 'var(--color-gray-100)',
                                border: '1px solid var(--color-gray-200)',
                                borderRadius: 'var(--radius-md)',
                                padding: '0.25rem 0.75rem',
                            }}>
                                {dormCode}
                            </span>
                        ) : (
                            <span style={{ fontSize: '0.8125rem', color: 'var(--color-gray-400)' }}>ยังไม่มีรหัส</span>
                        )}
                    </div>
                    {!dormCode ? (
                        <button
                            className="btn btn-primary"
                            style={{ fontSize: '0.875rem' }}
                            onClick={() => {
                                const code = generateDormCode();
                                setDormCode(code);
                                onSaveConfig({ ...config, dorm_code: code });
                            }}
                        >
                            <RefreshCw size={14} /> สร้างรหัส
                        </button>
                    ) : (
                        <button
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                                background: 'transparent',
                                color: 'var(--color-gray-500)',
                                border: '1px solid var(--color-gray-200)',
                                borderRadius: 'var(--radius-md)',
                                padding: '0.375rem 0.75rem',
                                fontSize: '0.8125rem', fontWeight: 500,
                                cursor: 'pointer',
                            }}
                            onClick={() => {
                                if (!confirm('สร้างรหัสใหม่?\nInvite Link เก่าจะใช้ไม่ได้ แต่ลูกหอที่ลงทะเบียนแล้วยังรับบิลได้ตามปกติ')) return;
                                const code = generateDormCode();
                                setDormCode(code);
                                onSaveConfig({ ...config, dorm_code: code });
                            }}
                        >
                            <RefreshCw size={13} /> รหัสใหม่
                        </button>
                    )}
                </div>

                {/* Invite Link Card */}
                {dormCode && (() => {
                    const lineOaId = import.meta.env.VITE_LINE_OA_ID as string | undefined;
                    const inviteLink = lineOaId
                        ? `https://line.me/R/oaMessage/${lineOaId}?text=${encodeURIComponent(dormCode)}`
                        : null;

                    return (
                        <div style={{
                            borderRadius: 'var(--radius-xl)',
                            border: '1.5px solid #06C755',
                            overflow: 'hidden',
                        }}>
                            {/* Card Header */}
                            <div style={{
                                background: '#06C755',
                                padding: '0.625rem 1rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                            }}>
                                <MessageCircle size={15} color="#fff" />
                                <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#fff' }}>
                                    Invite Link สำหรับลูกหอ
                                </span>
                                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.75)', marginLeft: 'auto' }}>
                                    กดครั้งเดียว → พิมพ์เลขห้อง → เสร็จ
                                </span>
                            </div>

                            {/* Card Body */}
                            <div style={{
                                background: 'var(--color-white)',
                                padding: 'var(--space-4)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 'var(--space-3)',
                            }}>
                                {!lineOaId ? (
                                    /* Warning: no LINE OA configured */
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '0.5rem',
                                        background: 'oklch(0.975 0.020 75)',
                                        border: '1px solid oklch(0.88 0.08 75)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: '0.75rem 1rem',
                                        fontSize: '0.875rem',
                                        color: 'var(--color-gray-700)',
                                        lineHeight: 1.6,
                                    }}>
                                        <AlertTriangle size={16} style={{ color: 'oklch(0.620 0.160 75)', flexShrink: 0, marginTop: 2 }} />
                                        <span>
                                            ยังไม่ได้ตั้งค่า LINE OA —{' '}
                                            เพิ่ม{' '}
                                            <code style={{
                                                background: 'rgba(0,0,0,0.07)',
                                                padding: '1px 6px',
                                                borderRadius: 4,
                                                fontFamily: 'var(--font-mono)',
                                                fontSize: '0.8em',
                                            }}>VITE_LINE_OA_ID</code>{' '}
                                            ใน .env แล้ว deploy ใหม่
                                        </span>
                                    </div>
                                ) : (
                                    <>
                                        {/* Link row */}
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <div style={{
                                                flex: 1,
                                                minWidth: 0,
                                                background: 'var(--color-gray-50)',
                                                border: '1px solid var(--color-gray-200)',
                                                borderRadius: 'var(--radius-md)',
                                                padding: '0.5rem 0.875rem',
                                                fontFamily: 'var(--font-mono)',
                                                fontSize: '0.75rem',
                                                color: 'var(--color-gray-500)',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {inviteLink}
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                                                <button
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                                                        background: '#06C755', color: '#fff',
                                                        border: 'none', borderRadius: 'var(--radius-md)',
                                                        padding: '0.5rem 0.875rem',
                                                        fontWeight: 600, fontSize: '0.875rem',
                                                        cursor: 'pointer', whiteSpace: 'nowrap',
                                                        transition: 'opacity 0.15s',
                                                    }}
                                                    onMouseOver={e => (e.currentTarget.style.opacity = '0.85')}
                                                    onMouseOut={e => (e.currentTarget.style.opacity = '1')}
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(inviteLink!);
                                                        setCodeCopied(true);
                                                        setTimeout(() => setCodeCopied(false), 2500);
                                                    }}
                                                >
                                                    {codeCopied ? <Check size={14} /> : <Copy size={14} />}
                                                    {codeCopied ? 'คัดลอกแล้ว!' : 'คัดลอก'}
                                                </button>
                                                {'share' in navigator && (
                                                    <button
                                                        style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                                                            background: 'transparent',
                                                            color: 'var(--color-gray-600)',
                                                            border: '1px solid var(--color-gray-200)',
                                                            borderRadius: 'var(--radius-md)',
                                                            padding: '0.5rem 0.875rem',
                                                            fontWeight: 500, fontSize: '0.875rem',
                                                            cursor: 'pointer', whiteSpace: 'nowrap',
                                                        }}
                                                        onClick={() => navigator.share({
                                                            title: `ลงทะเบียนรับบิล — ${billForm.dorm_name || 'หอพัก'}`,
                                                            text: 'กดลิ้งก์เพื่อลงทะเบียนรับบิลค่าน้ำ-ไฟผ่าน LINE ได้เลยค่ะ',
                                                            url: inviteLink!,
                                                        })}
                                                    >
                                                        <Share2 size={14} /> แชร์
                                                    </button>
                                                )}
                                                <a
                                                    href={inviteLink!}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="ทดสอบลิ้งก์"
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                        background: 'transparent',
                                                        color: 'var(--color-gray-500)',
                                                        border: '1px solid var(--color-gray-200)',
                                                        borderRadius: 'var(--radius-md)',
                                                        padding: '0.5rem 0.625rem',
                                                        textDecoration: 'none',
                                                    }}
                                                >
                                                    <ExternalLink size={14} />
                                                </a>
                                            </div>
                                        </div>

                                        {/* QR Code toggle */}
                                        <div>
                                            <button
                                                style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                                                    background: 'transparent',
                                                    color: 'var(--color-gray-600)',
                                                    border: '1px solid var(--color-gray-200)',
                                                    borderRadius: 'var(--radius-md)',
                                                    padding: '0.5rem 0.875rem',
                                                    fontWeight: 500, fontSize: '0.8125rem',
                                                    cursor: 'pointer',
                                                }}
                                                onClick={() => setShowQR(v => !v)}
                                            >
                                                <QrCode size={14} />
                                                {showQR ? 'ซ่อน QR Code' : 'แสดง QR Code (ปริ้นติดประกาศ)'}
                                            </button>

                                            {showQR && (
                                                <div style={{
                                                    marginTop: 'var(--space-3)',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    gap: 'var(--space-3)',
                                                    background: '#fff',
                                                    borderRadius: 'var(--radius-xl)',
                                                    padding: 'var(--space-6)',
                                                    border: '1px solid var(--color-gray-200)',
                                                }}>
                                                    <QRCodeSVG value={inviteLink!} size={192} level="M" marginSize={2} />
                                                    <div style={{ textAlign: 'center' }}>
                                                        <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#111' }}>
                                                            {billForm.dorm_name || 'หอพัก'}
                                                        </div>
                                                        <div style={{ fontSize: '0.8rem', color: '#777', marginTop: '0.2rem' }}>
                                                            สแกน QR เพื่อรับบิลผ่าน LINE
                                                        </div>
                                                    </div>
                                                    <button
                                                        style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                                                            background: 'transparent', color: '#555',
                                                            border: '1px solid #ddd', borderRadius: 8,
                                                            padding: '0.5rem 1rem', fontSize: '0.8125rem',
                                                            cursor: 'pointer',
                                                        }}
                                                        onClick={() => window.print()}
                                                    >
                                                        🖨️ พิมพ์ QR Code
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* How-to strip */}
                                        <div style={{
                                            background: 'var(--color-gray-50)',
                                            borderRadius: 'var(--radius-md)',
                                            padding: '0.625rem 0.875rem',
                                            fontSize: '0.8rem',
                                            color: 'var(--color-gray-500)',
                                            lineHeight: 1.8,
                                        }}>
                                            <div style={{ fontWeight: 600, color: 'var(--color-gray-700)', marginBottom: '0.2rem', fontSize: '0.8125rem' }}>วิธีใช้สำหรับเจ้าของหอ</div>
                                            <ol style={{ paddingLeft: '1.125rem', margin: 0 }}>
                                                <li>คัดลอก Invite Link หรือ QR Code → ส่งให้ลูกหอ (LINE กลุ่ม / ติดป้าย / ใบแจ้งหนี้)</li>
                                                <li>ลูกหอกดลิ้งก์ → LINE เปิดขึ้นมาพร้อมรหัสหอ → พิมพ์แค่เลขห้อง → เสร็จ</li>
                                            </ol>
                                            <div style={{ marginTop: '0.375rem', color: 'var(--color-gray-400)', fontSize: '0.775rem' }}>
                                                💡 ลูกหอใหม่ลงทะเบียนห้องเดิม → คนเก่าออกจากระบบอัตโนมัติ
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })()}
            </div>

            {/* Theme Settings */}
            <div className="settings-section">
                <h3 className="settings-title">
                    <Palette size={20} color="#8B5CF6" />
                    ธีมและสีสัน
                </h3>

                {/* Mode Toggle — Light / Dark / System */}
                <div style={{ marginBottom: '1.75rem' }}>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-gray-600)', marginBottom: '0.625rem' }}>
                        โหมดแสดงผล
                    </div>
                    <div style={{
                        display: 'inline-flex',
                        background: 'var(--color-gray-100)',
                        borderRadius: '12px',
                        padding: '4px',
                        gap: '3px',
                        border: '1px solid var(--color-gray-200)',
                    }}>
                        {([
                            { id: 'light'  as const, label: 'สว่าง', Icon: Sun     },
                            { id: 'dark'   as const, label: 'มืด',   Icon: Moon    },
                            { id: 'system' as const, label: 'ระบบ',  Icon: Monitor },
                        ]).map(({ id, label, Icon }) => {
                            const isActive = mode === id;
                            return (
                                <button
                                    key={id}
                                    id={`mode-btn-${id}`}
                                    onClick={() => onSetMode(id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '0.375rem',
                                        padding: '0.5rem 1.125rem',
                                        borderRadius: '9px',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: '0.8125rem', fontWeight: isActive ? 700 : 500,
                                        background: isActive ? 'var(--color-white)' : 'transparent',
                                        color: isActive ? 'var(--color-primary)' : 'var(--color-gray-500)',
                                        boxShadow: isActive ? 'var(--shadow-md)' : 'none',
                                        transition: 'all 0.18s ease',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    <Icon size={14} />
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                    <p className="form-hint" style={{ marginTop: '0.5rem', fontSize: '0.8125rem' }}>
                        {mode === 'system' ? '⚙️ ตามโหมดของอุปกรณ์ — เปลี่ยนอัตโนมัติเมื่อ OS สลับ' :
                         mode === 'dark'   ? '🌙 โหมดมืด — ถนอมสายตาในที่มืด' :
                                            '☀️ โหมดสว่าง — ค่าเริ่มต้น'}
                    </p>
                </div>

                {/* Theme color presets */}
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-gray-600)', marginBottom: '0.5rem' }}>
                    สีสันหลัก
                </div>
                <p className="form-hint" style={{ marginBottom: '1rem', fontSize: '0.8125rem' }}>
                    เปลี่ยนทันที — ไม่ต้องกดบันทึก
                </p>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: '0.75rem',
                }}>
                    {THEME_PRESETS.map(preset => {
                        const isActive = themeId === preset.id;
                        return (
                            <button
                                key={preset.id}
                                onClick={() => onSetTheme(preset.id)}
                                style={{
                                    position: 'relative',
                                    border: isActive
                                        ? `2px solid ${preset.swatch}`
                                        : '2px solid var(--color-gray-200)',
                                    borderRadius: '14px',
                                    padding: '0',
                                    cursor: 'pointer',
                                    background: 'var(--color-white)',
                                    overflow: 'hidden',
                                    transition: 'all 0.18s ease',
                                    boxShadow: isActive
                                        ? `0 0 0 4px ${preset.swatch}22, 0 4px 16px ${preset.swatch}33`
                                        : 'var(--shadow-sm)',
                                    transform: isActive ? 'scale(1.03)' : 'scale(1)',
                                }}
                            >
                                <div style={{
                                    height: '52px',
                                    background: `linear-gradient(135deg, ${preset.swatch} 0%, ${preset.swatchSecondary} 100%)`,
                                    position: 'relative',
                                }}>
                                    <div style={{
                                        position: 'absolute', left: 0, top: 0, bottom: 0, width: '24px',
                                        background: 'rgba(0,0,0,0.35)',
                                        display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', paddingTop: '6px', gap: '4px',
                                    }}>
                                        {[0,1,2,3].map(i => (
                                            <div key={i} style={{
                                                width: '12px', height: '3px',
                                                borderRadius: '2px',
                                                background: i === 0 ? '#fff' : 'rgba(255,255,255,0.35)',
                                            }} />
                                        ))}
                                    </div>
                                    {isActive && (
                                        <div style={{
                                            position: 'absolute', top: '6px', right: '6px',
                                            width: '20px', height: '20px', borderRadius: '50%',
                                            background: '#fff',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                                        }}>
                                            <Check size={12} color={preset.swatch} strokeWidth={3} />
                                        </div>
                                    )}
                                </div>
                                <div style={{
                                    padding: '0.5rem 0.625rem',
                                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                                }}>
                                    <span style={{ fontSize: '0.9rem' }}>{preset.emoji}</span>
                                    <span style={{
                                        fontSize: '0.8rem', fontWeight: isActive ? 700 : 500,
                                        color: isActive ? preset.swatch : 'var(--color-gray-700)',
                                    }}>{preset.name}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>


            {/* Save Button */}
            <div style={{ marginBottom: 'var(--space-8)', textAlign: 'center' }}>
                <button
                    className="btn btn-primary"
                    onClick={handleSave}
                    style={{
                        padding: '1rem 2.5rem',
                        fontSize: '1.125rem',
                        borderRadius: '12px',
                        minWidth: '240px',
                        fontWeight: 600
                    }}
                >
                    <Save size={22} />
                    บันทึกการตั้งค่า
                </button>
                {saved && (
                    <div className="text-success font-bold" style={{ marginTop: 'var(--space-3)', fontSize: '1rem' }}>
                        ✓ บันทึกเรียบร้อยแล้ว!
                    </div>
                )}
            </div>

            {/* Change Password */}
            <div className="settings-section" style={{ borderTop: '1px solid var(--color-gray-200)', paddingTop: 'var(--space-6)' }}>
                <h3 className="settings-title">
                    <Lock size={20} color="#737373" />
                    เปลี่ยนรหัสผ่าน
                </h3>

                <div className="form-group">
                    <label className="form-label">รหัสผ่านปัจจุบัน</label>
                    <div style={{ position: 'relative', maxWidth: '300px' }}>
                        <input
                            type={showPasswords ? 'text' : 'password'}
                            className="form-input"
                            style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                            value={currentPassword}
                            onChange={e => setCurrentPassword(e.target.value)}
                            placeholder="ใส่รหัสผ่านปัจจุบัน"
                            autoComplete="current-password"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPasswords(!showPasswords)}
                            style={{
                                position: 'absolute', right: '12px', top: '50%',
                                transform: 'translateY(-50%)', background: 'none',
                                border: 'none', cursor: 'pointer', color: 'var(--color-gray-400)',
                                padding: '8px'
                            }}
                        >
                            {showPasswords ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>
                </div>

                <div className="settings-grid" style={{ maxWidth: '620px' }}>
                    <div className="form-group">
                        <label className="form-label">รหัสผ่านใหม่</label>
                        <input
                            type={showPasswords ? 'text' : 'password'}
                            className="form-input"
                            style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            placeholder="อย่างน้อย 6 ตัวอักษร"
                            autoComplete="new-password"
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">ยืนยันรหัสผ่านใหม่</label>
                        <input
                            type={showPasswords ? 'text' : 'password'}
                            className="form-input"
                            style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
                            autoComplete="new-password"
                        />
                    </div>
                </div>

                {passwordError && (
                    <div style={{
                        background: 'var(--color-danger-ultra-light)',
                        color: 'var(--color-danger)',
                        padding: 'var(--space-3) var(--space-4)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.875rem',
                        marginBottom: 'var(--space-4)',
                        border: '1px solid rgba(239,68,68,0.15)'
                    }}>
                        <AlertTriangle size={16} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }} /> {passwordError}
                    </div>
                )}

                {passwordStatus === 'success' && (
                    <div style={{
                        background: 'var(--color-success-ultra-light)',
                        color: 'var(--color-success)',
                        padding: 'var(--space-3) var(--space-4)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.875rem',
                        marginBottom: 'var(--space-4)',
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        border: '1px solid rgba(34,197,94,0.15)'
                    }}>
                        <Check size={16} /> เปลี่ยนรหัสผ่านเรียบร้อยแล้ว!
                    </div>
                )}

                <button
                    className="btn btn-secondary"
                    onClick={handleChangePassword}
                    disabled={passwordStatus === 'loading' || !currentPassword || !newPassword || !confirmPassword}
                    style={{
                        background: 'var(--color-gray-100)',
                        color: 'var(--color-gray-700)',
                        border: '1px solid var(--color-gray-200)',
                        padding: '0.75rem 1.5rem',
                        fontSize: '1rem'
                    }}
                >
                    <Lock size={18} />
                    {passwordStatus === 'loading' ? 'กำลังเปลี่ยน...' : 'เปลี่ยนรหัสผ่าน'}
                </button>
            </div>
        </div>
    );
}
