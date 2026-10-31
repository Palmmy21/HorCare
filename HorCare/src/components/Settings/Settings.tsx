import { useState, useRef, useEffect } from 'react';
import { Save, Zap, Droplets, Home, Lock, Eye, EyeOff, Check, Building2, Trees, Hotel, LayoutGrid, FileText, BarChart3, Settings as SettingsIcon, AlertTriangle, Palette, Sun, Moon, Monitor, MessageCircle, Copy, RefreshCw, Share2, QrCode, ExternalLink, ImageIcon, Trash2, Bell, BellOff, BellRing, Mail, ShieldCheck, Printer, Lightbulb, CheckCircle2, Globe, Upload, Store, Plus, Sparkles, Clock } from 'lucide-react';
import { usePushNotification } from '../../hooks/usePushNotification';
import { QRCodeCanvas } from 'qrcode.react';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { auth } from '../../firebase/config';
import type { DormConfig, WaterConfig, BillLanguage, MarketConfig, LateFeeConfig } from '../../types';

/** Late-fee form values, with defaults for a property that has never set them. */
function lateFeeFormOf(c: DormConfig): Required<LateFeeConfig> {
    return {
        enabled: c.late_fee?.enabled ?? false,
        mode: c.late_fee?.mode ?? 'per_day',
        amount: c.late_fee?.amount ?? 50,
        grace_days: c.late_fee?.grace_days ?? 0,
        max_amount: c.late_fee?.max_amount ?? 0,
    };
}
import { generateDormCode } from '../../utils/calculations';
import { LANGUAGE_OPTIONS } from '../../utils/i18n/billTranslations';
import { getWorkspaceTerms, DEFAULT_MARKET_ZONES } from '../../utils/workspaceTerminology';
import type { ThemeMode } from '../../hooks/useTheme';
import ListingSettingsSection from './ListingSettingsSection';
import OwnerLineSection from './OwnerLineSection';
import { toast } from 'react-hot-toast';
import horcareLogo from '../../assets/horcare_logo.png';
import ContractTemplatesSettingsSection from './ContractTemplatesSettingsSection';

async function compressLogoToBase64(file: File, maxPx = 400, quality = 0.85): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/png', quality));
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

interface SettingsProps {
    config: DormConfig;
    onSaveConfig: (config: DormConfig) => void;
    themeId: string;
    onSetTheme: (id: string) => void;
    mode: ThemeMode;
    onSetMode: (m: ThemeMode) => void;
    emailVerified: boolean;
    userEmail: string;
    onSendVerifyEmail: () => Promise<unknown>;
    onRefreshEmailVerified: () => Promise<boolean>;
    isPaid?: boolean;
    onUpgrade?: () => void;
    uid?: string;
    /** The property being edited (public vacancy page, viewing requests). */
    buildingId?: string;
}

const BUILDING_TYPES = [
    {
        key: 'dormitory',
        icon: Home,
        iconBg: '#E7F0FA',
        iconColor: '#0A6CC2',
        title: 'หอพัก',
        subtitle: '(Dormitory)',
        desc: 'คิดค่าน้ำ/ไฟอัตราเดียวกันทุกห้อง',
    },
    {
        key: 'commercial',
        icon: Building2,
        iconBg: '#FDEBD3',
        iconColor: '#E8740C',
        title: 'อาคารพาณิชย์',
        subtitle: '(Commercial)',
        desc: 'ตั้งค่าน้ำ/ไฟแยกรายห้องได้',
    },
    {
        key: 'market',
        icon: Store,
        iconBg: '#FBD9A8',
        iconColor: '#E8740C',
        title: 'พื้นที่ขายของ / ตลาดนัด',
        subtitle: '(Market / Stall)',
        desc: 'จัดการแผงค้าและค่าเช่าพื้นที่',
    },
    {
        key: 'resort',
        icon: Trees,
        iconBg: '#DCF2E4',
        iconColor: '#15803D',
        title: 'รีสอร์ท',
        subtitle: '(Resort)',
        desc: 'เหมาะสำหรับรีสอร์ทและที่พักธรรมชาติ',
    },
    {
        key: 'hotel',
        icon: Hotel,
        iconBg: '#E7F0FA',
        iconColor: '#0A6CC2',
        title: 'โรงแรม',
        subtitle: '(Hotel)',
        desc: 'สำหรับโรงแรมและที่พักแบบมืออาชีพ',
    },
    {
        key: 'apartment',
        icon: Building2,
        iconBg: '#E7F0FA',
        iconColor: '#0F4C81',
        title: 'อพาร์ทเมนต์',
        subtitle: '(Apartment)',
        desc: 'คล้ายหอพัก เหมาะสำหรับผู้เช่าระยะยาว',
    },
    {
        key: 'condo',
        icon: Building2,
        iconBg: '#E7F0FA',
        iconColor: '#0A6CC2',
        title: 'คอนโดมิเนียม',
        subtitle: '(Condo)',
        desc: 'บริหารจัดการนิติบุคคลหรือปล่อยเช่าส่วนตัว',
    },
    {
        key: 'house',
        icon: Home,
        iconBg: '#FDEBD3',
        iconColor: '#E8740C',
        title: 'บ้านเช่า / ทาวน์โฮม',
        subtitle: '(House / Townhouse)',
        desc: 'ให้เช่าบ้านเป็นหลังพร้อมจัดการบิล',
    },
    {
        key: 'office',
        icon: LayoutGrid,
        iconBg: '#E7F0FA',
        iconColor: '#08589F',
        title: 'พื้นที่เช่า / สำนักงาน',
        subtitle: '(Workspace / Office)',
        desc: 'ออฟฟิศให้เช่ารายเดือนพร้อมค่าน้ำไฟ',
    },
    {
        key: 'other',
        icon: LayoutGrid,
        iconBg: '#EBF1F7',
        iconColor: '#557089',
        title: 'อื่นๆ',
        subtitle: '(Others)',
        desc: 'อาคารประเภทอื่นที่ต้องการจัดการมิเตอร์',
    },
];

type SettingsTab = 'general' | 'billing' | 'contract' | 'integrations' | 'account';

const SETTINGS_TABS: { id: SettingsTab; label: string; desc: string; icon: typeof SettingsIcon }[] = [
    { id: 'general', label: 'ทั่วไป', desc: 'ประเภทพื้นที่ ภาษา โลโก้ ธีม', icon: SettingsIcon },
    { id: 'billing', label: 'ค่าเช่าและค่าบริการ', desc: 'ค่าเช่า ค่าไฟ ค่าน้ำ ใบแจ้งหนี้', icon: Zap },
    { id: 'contract', label: 'สัญญาเช่า', desc: 'แม่แบบสัญญาและลายเซ็น', icon: FileText },
    { id: 'integrations', label: 'การเชื่อมต่อ', desc: 'LINE การแจ้งเตือน พอร์ทัลผู้เช่า', icon: Share2 },
    { id: 'account', label: 'บัญชีและความปลอดภัย', desc: 'อีเมล รหัสผ่าน', icon: Lock },
];

export default function Settings(props: SettingsProps) {
    const { config, onSaveConfig, mode, onSetMode, emailVerified, userEmail, onSendVerifyEmail, onRefreshEmailVerified, isPaid = false, onUpgrade, uid, buildingId } = props;
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
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

    const [marketConfig, setMarketConfig] = useState<MarketConfig>(() => ({
        default_rent_cycle: config.market_config?.default_rent_cycle || 'daily',
        default_stall_size: config.market_config?.default_stall_size || '2x2 ม.',
        waste_fee_per_stall: config.market_config?.waste_fee_per_stall ?? 20,
        waste_fee_cycle: config.market_config?.waste_fee_cycle || 'daily',
        electricity_flat_fee: config.market_config?.electricity_flat_fee ?? 30,
        table_rental_fee: config.market_config?.table_rental_fee ?? 0,
        zones: config.market_config?.zones && config.market_config.zones.length > 0
            ? config.market_config.zones
            : [...DEFAULT_MARKET_ZONES],
    }));
    const [newZoneInput, setNewZoneInput] = useState('');

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPasswords, setShowPasswords] = useState(false);
    const [passwordStatus, setPasswordStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [passwordError, setPasswordError] = useState('');
    const [dormCode, setDormCode] = useState(config.dorm_code || '');
    const [codeCopied, setCodeCopied] = useState(false);
    const [showQR, setShowQR] = useState(false);
    const [portalPin, setPortalPin] = useState(config.portal_pin || '');

    // Push Notifications
    const { permission, enabled, loading: notifLoading, requestPermission, toggleEnabled, testNotification } = usePushNotification();
    const [notifRequesting, setNotifRequesting] = useState(false);
    const [testNotifSending, setTestNotifSending] = useState(false);

    // Email verification + cooldown
    const [verifyStatus, setVerifyStatus] = useState<'idle' | 'sending' | 'sent' | 'error' | 'checking'>('idle');
    const [verifyMsg, setVerifyMsg] = useState('');
    const [verifyCooldown, setVerifyCooldown] = useState(0); // seconds remaining
    const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const startCooldown = (seconds = 60) => {
        if (cooldownRef.current) clearInterval(cooldownRef.current);
        setVerifyCooldown(seconds);
        cooldownRef.current = setInterval(() => {
            setVerifyCooldown(prev => {
                if (prev <= 1) {
                    clearInterval(cooldownRef.current!);
                    cooldownRef.current = null;
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    // Pre-fill cooldown from registration/previous send — prevents immediate re-send hitting rate limit
    useEffect(() => {
        const sentAt = localStorage.getItem('horcare_verify_sent_at');
        if (!sentAt) return;
        const elapsed = Math.floor((Date.now() - parseInt(sentAt)) / 1000);
        const remaining = 120 - elapsed;
        if (remaining > 0) {
            setVerifyStatus('sent');
            setVerifyMsg('ส่งอีเมลยืนยันแล้ว! กรุณาตรวจสอบกล่องจดหมายของคุณ');
            startCooldown(remaining);
        }
    }, []);

    useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current); }, []);

    const handleSendVerifyEmail = async () => {
        setVerifyStatus('sending');
        setVerifyMsg('');
        try {
            await onSendVerifyEmail();
            localStorage.setItem('horcare_verify_sent_at', Date.now().toString());
            setVerifyStatus('sent');
            setVerifyMsg('ส่งอีเมลยืนยันแล้ว! กรุณาตรวจสอบกล่องจดหมายของคุณ');
            startCooldown(60);
        } catch (e: unknown) {
            const msg = (e as Error).message || '';
            setVerifyStatus('error');
            if (msg.includes('TOO_MANY_ATTEMPTS') || msg.includes('too-many-requests')) {
                setVerifyMsg('ส่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
                startCooldown(120);
            } else {
                setVerifyMsg(msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
            }
        }
    };

    const handleCheckVerified = async () => {
        setVerifyStatus('checking');
        setVerifyMsg('');
        try {
            const verified = await onRefreshEmailVerified();
            if (verified) {
                setVerifyStatus('idle');
                setVerifyMsg('');
                localStorage.removeItem('horcare_verify_sent_at');
            } else {
                setVerifyStatus('sent');
                setVerifyMsg('ยังไม่พบการยืนยัน — กดลิงก์ในอีเมลก่อน แล้วลองใหม่');
            }
        } catch {
            setVerifyStatus('error');
            setVerifyMsg('ตรวจสอบไม่สำเร็จ กรุณาลองใหม่');
        }
    };

    const handleRequestNotif = async () => {
        setNotifRequesting(true);
        await requestPermission();
        setNotifRequesting(false);
    };

    // Bill customization state
    const [billForm, setBillForm] = useState({
        dorm_name: config.bill_customization?.dorm_name || '',
        dorm_address: config.bill_customization?.dorm_address || '',
        dorm_phone: config.bill_customization?.dorm_phone || '',
        footer_text: config.bill_customization?.footer_text || 'กรุณาชำระภายในวันที่ 5 ของทุกเดือน',
        due_day: config.bill_customization?.due_day || 5,
        default_language: (config.bill_customization?.default_language || 'th') as BillLanguage,
        bilingual_mode: config.bill_customization?.bilingual_mode || false,
        secondary_language: (config.bill_customization?.secondary_language || 'en') as BillLanguage,
    });
    const [lateFee, setLateFee] = useState(() => lateFeeFormOf(config));
    const [prorateRentOn, setProrateRentOn] = useState(!!config.prorate_rent);
    const [dormLogo, setDormLogo] = useState<string | undefined>(config.bill_customization?.dorm_logo);
    const [logoLoading, setLogoLoading] = useState(false);
    const logoInputRef = useRef<HTMLInputElement>(null);
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
            footer_text: config.bill_customization?.footer_text || 'กรุณาชำระภายในวันที่ 5 ของทุกเดือน',
            due_day: config.bill_customization?.due_day || 5,
            default_language: (config.bill_customization?.default_language || 'th') as BillLanguage,
            bilingual_mode: config.bill_customization?.bilingual_mode || false,
            secondary_language: (config.bill_customization?.secondary_language || 'en') as BillLanguage,
        });
        setDormLogo(config.bill_customization?.dorm_logo);
        setLateFee(lateFeeFormOf(config));
        setProrateRentOn(!!config.prorate_rent);
        setDormCode(config.dorm_code || '');
        setPortalPin(config.portal_pin || '');
        setMarketConfig({
            default_rent_cycle: config.market_config?.default_rent_cycle || 'daily',
            default_stall_size: config.market_config?.default_stall_size || '2x2 ม.',
            waste_fee_per_stall: config.market_config?.waste_fee_per_stall ?? 20,
            waste_fee_cycle: config.market_config?.waste_fee_cycle || 'daily',
            electricity_flat_fee: config.market_config?.electricity_flat_fee ?? 30,
            table_rental_fee: config.market_config?.table_rental_fee ?? 0,
            zones: config.market_config?.zones && config.market_config.zones.length > 0
                ? config.market_config.zones
                : [...DEFAULT_MARKET_ZONES],
        });
    }

    const snapshot = JSON.stringify({ formData, billForm, dormLogo, dormCode, portalPin, marketConfig, lateFee, prorateRentOn });
    const [baseline, setBaseline] = useState<string | null>(null);
    const [baselineFor, setBaselineFor] = useState(prevConfig);
    if (baselineFor !== prevConfig) { setBaselineFor(prevConfig); setBaseline(null); }
    if (baseline === null) setBaseline(snapshot);
    const dirty = baseline !== null && baseline !== snapshot;

    const handleChange = (field: string, value: string | number) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleMarketChange = (field: keyof MarketConfig, value: unknown) => {
        setMarketConfig(prev => ({ ...prev, [field]: value }));
    };

    const handleAddZone = () => {
        const trimmed = newZoneInput.trim();
        if (!trimmed) return;
        if (marketConfig.zones?.includes(trimmed)) {
            toast.error('มีชื่อโซนนี้อยู่แล้ว');
            return;
        }
        setMarketConfig(prev => ({
            ...prev,
            zones: [...(prev.zones || []), trimmed]
        }));
        setNewZoneInput('');
        toast.success(`เพิ่ม "${trimmed}" เรียบร้อยแล้ว`);
    };

    const handleRemoveZone = (zoneToRemove: string) => {
        setMarketConfig(prev => ({
            ...prev,
            zones: (prev.zones || []).filter(z => z !== zoneToRemove)
        }));
    };

    const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLogoLoading(true);
        try {
            const b64 = await compressLogoToBase64(file);
            setDormLogo(b64);
        } catch {
            alert('ไม่สามารถโหลดรูปได้ กรุณาลองใหม่');
        } finally {
            setLogoLoading(false);
            if (logoInputRef.current) logoInputRef.current.value = '';
        }
    };

    const handleSave = () => {
        if (lateFee.enabled && !(Number(lateFee.amount) > 0)) {
            toast.error('ใส่จำนวนค่าปรับให้มากกว่า 0 หรือปิดค่าปรับล่าช้า');
            return;
        }
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

        // saveConfig replaces the whole document: start from the current config so settings this form does not edit
        // (collection style, LINE claim mode, custom amenities, …) survive. A field set to undefined is removed
        // (Firestore here ignores undefined properties).
        const newConfig: DormConfig = {
            ...config,
            building_type: formData.building_type as DormConfig['building_type'],
            electricity_rate: Number(formData.electricity_rate),
            room_rent: Number(formData.room_rent),
            water_config: dormWaterConfig,
            commercial_water_config: commWaterConfig,
            bill_customization: {
                dorm_name: billForm.dorm_name,
                dorm_address: billForm.dorm_address,
                dorm_phone: billForm.dorm_phone,
                footer_text: billForm.footer_text,
                due_day: Number(billForm.due_day) || 5,
                default_language: billForm.default_language,
                bilingual_mode: billForm.bilingual_mode,
                secondary_language: billForm.secondary_language,
                ...(dormLogo ? { dorm_logo: dormLogo } : {}),
                // legacy PromptPay values stay until they are moved onto a bank account (Payments → receiving accounts)
                ...(config.bill_customization?.promptpay_number ? { promptpay_number: config.bill_customization.promptpay_number, promptpay_name: config.bill_customization.promptpay_name ?? '' } : {}),
            },
            dorm_code: dormCode || undefined,
            portal_pin: portalPin.length === 4 ? portalPin : undefined,
            market_config: formData.building_type === 'market' || config.market_config ? marketConfig : undefined,
            late_fee: {
                enabled: lateFee.enabled,
                mode: lateFee.mode,
                amount: Math.max(0, Number(lateFee.amount) || 0),
                grace_days: Math.max(0, Math.floor(Number(lateFee.grace_days) || 0)),
                max_amount: Math.max(0, Number(lateFee.max_amount) || 0),
            },
            prorate_rent: prorateRentOn,
        };

        onSaveConfig(newConfig);
        setBaseline(snapshot);
        toast.success('บันทึกเรียบร้อยแล้ว!', {
            id: 'settings-saved',
            duration: 3000,
            style: {
                background: 'linear-gradient(135deg, #15803D 0%, #22A35A 100%)',
                color: '#ffffff',
                fontWeight: 600,
                borderRadius: '14px',
                padding: '0.85rem 1.4rem',
                boxShadow: '0 10px 25px rgba(34, 163, 90, 0.35)',
                fontSize: '0.95rem',
            },
            iconTheme: {
                primary: '#ffffff',
                secondary: '#15803D',
            },
        });
    };

    const handleBillFormChange = (field: string, value: string | number | boolean) => {
        setBillForm(prev => ({ ...prev, [field]: value }));
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

    const terms = getWorkspaceTerms(formData.building_type as DormConfig['building_type']);

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><SettingsIcon size={28} /> ตั้งค่าระบบ</h1>
                <p className="page-subtitle">ข้อมูลกิจการ ค่าบริการ การเชื่อมต่อ และบัญชีของคุณ</p>
            </div>

            <div className="settings-layout">
            <nav className="settings-nav" aria-label="หมวดการตั้งค่า">
                {SETTINGS_TABS.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        className={`settings-nav-item${activeTab === t.id ? ' active' : ''}`}
                        aria-current={activeTab === t.id ? 'page' : undefined}
                        onClick={() => setActiveTab(t.id)}
                    >
                        <span className="settings-nav-icon"><t.icon size={18} aria-hidden /></span>
                        <span className="settings-nav-text">
                            <span className="settings-nav-label">{t.id === 'billing' ? `${terms.rentLabel}และค่าบริการ` : t.label}</span>
                            <span className="settings-nav-desc">{t.desc}</span>
                        </span>
                    </button>
                ))}
            </nav>
            <div className="settings-body">
            <h2 className="settings-body-title">{activeTab === 'billing' ? `${terms.rentLabel}และค่าบริการ` : SETTINGS_TABS.find(t => t.id === activeTab)!.label}</h2>

            {/* ── Account Info (Owner ID) ── */}
            {activeTab === 'account' && uid && (
                <div className="card mb-6">
                    <div className="card-header">
                        <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <ShieldCheck size={18} /> ข้อมูลบัญชีผู้ใช้
                        </h2>
                        <p className="card-subtitle">ข้อมูลประจำตัวสำหรับยืนยันสิทธิ์กับ LINE Support</p>
                    </div>
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1rem',
                        background: 'var(--color-gray-50)',
                        padding: '1.25rem',
                        borderRadius: '12px',
                        border: '1px solid var(--color-gray-200)',
                    }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Owner ID (รหัสเจ้าของหอ)</div>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                <div className="mono" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-primary-700)', wordBreak: 'break-all' }}>
                                    {uid}
                                </div>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(uid || '');
                                        toast.success('คัดลอก Owner ID เรียบร้อยแล้ว');
                                    }}
                                    style={{
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        color: 'var(--color-primary-500)', display: 'flex', alignItems: 'center', padding: '0.25rem'
                                    }}
                                    title="คัดลอก Owner ID"
                                >
                                    <Copy size={16} />
                                </button>
                            </div>
                            <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)', marginTop: '0.25rem' }}>
                                โปรดแจ้งรหัสนี้แก่ทีม Support เพื่อความรวดเร็วในการให้บริการ
                            </div>
                        </div>
                        <div style={{ borderTop: '1px dashed var(--color-gray-200)' }}></div>
                        <div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Email</div>
                            <div style={{ fontSize: '0.9375rem', color: 'var(--color-gray-800)' }}>{userEmail}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Email Verification Banner ── */}
            {activeTab === 'account' && !emailVerified && (
                <div style={{
                    background: 'linear-gradient(135deg, rgba(245, 158, 46,0.08), rgba(239,68,68,0.06))',
                    border: '1.5px solid rgba(245, 158, 46,0.35)',
                    borderRadius: '16px',
                    padding: '1.25rem 1.5rem',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '1rem',
                    flexWrap: 'wrap',
                }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: '12px', flexShrink: 0,
                        background: 'rgba(245, 158, 46,0.15)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Mail size={22} color="#E8740C" />
                    </div>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--color-gray-800)', marginBottom: '0.25rem' }}>
                            ยังไม่ได้ยืนยันอีเมล
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)', lineHeight: 1.6 }}>
                            ยืนยัน <strong>{userEmail}</strong> เพื่อความปลอดภัยของบัญชี
                        </div>
                        {verifyMsg && (
                            <div style={{
                                marginTop: '0.5rem', fontSize: '0.8rem', lineHeight: 1.5,
                                color: verifyStatus === 'error' ? '#DC2626' : '#15803D',
                                fontWeight: 500,
                            }}>
                                {verifyMsg}
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                            onClick={handleSendVerifyEmail}
                            disabled={verifyStatus === 'sending' || verifyStatus === 'checking' || verifyCooldown > 0}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                                background: verifyCooldown > 0
                                    ? 'var(--color-gray-200)'
                                    : 'linear-gradient(135deg, #F59E2E, #E8740C)',
                                color: verifyCooldown > 0 ? 'var(--color-gray-500)' : '#fff',
                                border: 'none',
                                padding: '0.625rem 1.25rem', borderRadius: '10px',
                                fontWeight: 700, fontSize: '0.875rem',
                                cursor: verifyCooldown > 0 ? 'not-allowed' : 'pointer',
                                opacity: verifyStatus === 'sending' ? 0.7 : 1,
                                boxShadow: verifyCooldown > 0 ? 'none' : '0 2px 10px rgba(245, 158, 46,0.3)',
                                transition: 'all 0.2s',
                            }}
                        >
                            <Mail size={15} />
                            {verifyStatus === 'sending'
                                ? 'กำลังส่ง...'
                                : verifyCooldown > 0
                                    ? `รอ ${verifyCooldown}s`
                                    : 'ส่งลิงก์ยืนยัน'
                            }
                        </button>
                        {verifyStatus === 'sent' && (
                            <button
                                onClick={handleCheckVerified}
                                disabled={false}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                                    background: 'transparent',
                                    color: 'var(--color-gray-500)',
                                    border: '1px solid var(--color-gray-200)',
                                    padding: '0.625rem 1rem', borderRadius: '10px',
                                    fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer',
                                }}
                            >
                                <RefreshCw size={14} /> ตรวจสอบอีกครั้ง
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ── Email Verified Badge ── */}
            {activeTab === 'account' && emailVerified && (
                <div style={{
                    background: 'linear-gradient(135deg, rgba(34, 163, 90,0.08), rgba(21, 128, 61,0.05))',
                    border: '1.5px solid rgba(34, 163, 90,0.3)',
                    borderRadius: '14px',
                    padding: '0.875rem 1.25rem',
                    marginBottom: '1.5rem',
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                }}>
                    <ShieldCheck size={20} color="#15803D" />
                    <div>
                        <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#15803D' }}>อีเมลยืนยันแล้ว</span>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)', marginLeft: '0.5rem' }}>{userEmail}</span>
                    </div>
                </div>
            )}

            {/* General Tab */}
            {activeTab === 'general' && (
                <>
                {/* Workspace & Property Type Selector */}
                <div className="settings-section">
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                        <div>
                            <h3 className="settings-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                                {formData.building_type === 'market' ? <Store size={22} color="#E8740C" /> : <Building2 size={22} color="#0A6CC2" />}
                                ประเภทพื้นที่
                            </h3>
                            <p className="form-hint" style={{ margin: 0 }}>
                                เลือกลักษณะพื้นที่เพื่อปรับคำศัพท์ (เช่น แผงค้า vs ห้องพัก, ผู้ค้า vs ผู้เช่า) และรูปแบบการคิดเงินอัตโนมัติ
                            </p>
                        </div>
                        <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.45rem',
                            padding: '0.4rem 0.95rem',
                            borderRadius: '999px',
                            background: formData.building_type === 'market' ? 'rgba(245, 158, 46, 0.15)' : 'rgba(10, 108, 194, 0.12)',
                            border: `1.5px solid ${formData.building_type === 'market' ? '#F59E2E' : '#0A6CC2'}`,
                            fontSize: '0.85rem',
                            fontWeight: 700,
                            color: formData.building_type === 'market' ? '#9A3412' : '#08589F'
                        }}>
                            <Sparkles size={14} /> โหมดปัจจุบัน: {BUILDING_TYPES.find(b => b.key === formData.building_type)?.title || 'หอพัก'}
                        </div>
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                        gap: '0.85rem',
                        marginTop: '1rem',
                    }}>
                        {BUILDING_TYPES.map(bt => {
                            const Icon = bt.icon;
                            const isSelected = formData.building_type === bt.key;
                            return (
                                <div
                                    key={bt.key}
                                    onClick={() => handleChange('building_type', bt.key)}
                                    style={{
                                        position: 'relative',
                                        padding: '1rem 0.85rem',
                                        borderRadius: '14px',
                                        cursor: 'pointer',
                                        border: isSelected 
                                            ? bt.key === 'market' 
                                                ? '2px solid #F59E2E'
                                                : '2px solid var(--color-primary)'
                                            : '1px solid var(--color-gray-200)',
                                        background: isSelected
                                            ? bt.key === 'market'
                                                ? 'linear-gradient(135deg, rgba(251, 217, 168, 0.25), rgba(245, 158, 46, 0.08))'
                                                : 'linear-gradient(135deg, rgba(10, 108, 194, 0.08), rgba(10, 108, 194, 0.04))'
                                            : 'var(--color-gray-50)',
                                        boxShadow: isSelected 
                                            ? bt.key === 'market' ? '0 4px 14px rgba(245, 158, 46, 0.2)' : '0 4px 14px rgba(10, 108, 194, 0.15)'
                                            : 'none',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        textAlign: 'center',
                                        gap: '0.5rem',
                                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                        transform: isSelected ? 'scale(1.02)' : 'none',
                                    }}
                                >
                                    {isSelected && (
                                        <div style={{
                                            position: 'absolute',
                                            top: '8px',
                                            right: '8px',
                                            background: bt.key === 'market' ? '#E8740C' : 'var(--color-primary)',
                                            color: '#fff',
                                            borderRadius: '50%',
                                            width: '18px',
                                            height: '18px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '10px'
                                        }}>
                                            <Check size={11} strokeWidth={3} />
                                        </div>
                                    )}

                                    <div style={{
                                        background: bt.iconBg,
                                        width: 44,
                                        height: 44,
                                        borderRadius: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
                                    }}>
                                        <Icon size={22} color={bt.iconColor} />
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: isSelected ? '#102A43' : 'var(--color-gray-800)' }}>
                                            {bt.title}
                                        </div>
                                        <div style={{ fontSize: '0.725rem', color: 'var(--color-gray-500)' }}>
                                            {bt.subtitle}
                                        </div>
                                    </div>
                                    <p style={{ margin: 0, fontSize: '0.725rem', color: 'var(--color-gray-500)', lineHeight: 1.35 }}>
                                        {bt.desc}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Market Specific Configuration (Rendered when workspace is Market) */}
                {formData.building_type === 'market' && (
                    <div className="settings-section" style={{
                        border: '1.5px solid rgba(245, 158, 46, 0.45)',
                        background: 'linear-gradient(135deg, rgba(253, 235, 211, 0.2), rgba(255, 255, 255, 0.95))',
                        borderRadius: '16px',
                        padding: '1.5rem',
                        boxShadow: '0 8px 24px rgba(245, 158, 46, 0.1)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                            <div style={{
                                background: '#FDEBD3',
                                width: 44,
                                height: 44,
                                borderRadius: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                            }}>
                                <Store size={24} color="#E8740C" />
                            </div>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 800, color: '#9A3412', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    ตั้งค่าตลาดและแผงค้า
                                </h3>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: '#C2410C' }}>
                                    กำหนดค่าบริการเริ่มต้นสำหรับแผงค้า, ล็อกตลาด, ค่าขยะ, และการแบ่งโซน
                                </p>
                            </div>
                        </div>

                        {/* Market Config Grid */}
                        <div className="settings-grid" style={{ marginBottom: '1.25rem' }}>
                            {/* Default Rent Cycle */}
                            <div className="form-group">
                                <label className="form-label" style={{ fontWeight: 700 }}>รอบคิดค่าเช่าแผงเริ่มต้น</label>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    {[
                                        { key: 'daily', label: '☀️ รายวัน', sub: 'ตลาดนัด/ถนนคนเดิน' },
                                        { key: 'weekly', label: '📅 รายสัปดาห์', sub: 'ตลาดเปิด 1-3 วัน/สัปดาห์' },
                                        { key: 'monthly', label: '🗓️ รายเดือน', sub: 'ตลาดสด/ล็อกประจำ' },
                                    ].map(cycle => {
                                        const active = marketConfig.default_rent_cycle === cycle.key;
                                        return (
                                            <button
                                                key={cycle.key}
                                                type="button"
                                                onClick={() => handleMarketChange('default_rent_cycle', cycle.key)}
                                                style={{
                                                    flex: '1 1 120px',
                                                    padding: '0.65rem 0.75rem',
                                                    borderRadius: '10px',
                                                    border: active ? '2px solid #E8740C' : '1px solid var(--color-gray-300)',
                                                    background: active ? '#FDEBD3' : '#FFFFFF',
                                                    color: active ? '#9A3412' : 'var(--color-gray-700)',
                                                    fontWeight: active ? 700 : 500,
                                                    fontSize: '0.875rem',
                                                    cursor: 'pointer',
                                                    textAlign: 'center',
                                                    transition: 'all 0.15s ease',
                                                }}
                                            >
                                                <div>{cycle.label}</div>
                                                <div style={{ fontSize: '0.7rem', opacity: 0.8, marginTop: '2px' }}>{cycle.sub}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="form-hint">รอบตั้งต้นเมื่อเพิ่มแผงใหม่ (สามารถปรับรายแผงได้)</p>
                            </div>

                            {/* Default Stall Size */}
                            <div className="form-group">
                                <label className="form-label" style={{ fontWeight: 700 }}>ขนาดแผงค้ามาตรฐาน (กว้าง x ลึก)</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                                    value={marketConfig.default_stall_size || ''}
                                    onChange={e => handleMarketChange('default_stall_size', e.target.value)}
                                    placeholder="เช่น 2x2 ม., 3x3 ม."
                                />
                                <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.45rem', flexWrap: 'wrap' }}>
                                    {['2x2 ม.', '2.5x2.5 ม.', '3x3 ม.', '4x4 ม.'].map(size => (
                                        <button
                                            key={size}
                                            type="button"
                                            onClick={() => handleMarketChange('default_stall_size', size)}
                                            style={{
                                                background: marketConfig.default_stall_size === size ? '#FDEBD3' : '#EBF1F7',
                                                border: marketConfig.default_stall_size === size ? '1px solid #E8740C' : '1px solid #DCE5EF',
                                                color: marketConfig.default_stall_size === size ? '#9A3412' : '#3E5872',
                                                borderRadius: '6px',
                                                padding: '0.2rem 0.5rem',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                cursor: 'pointer'
                                            }}
                                        >
                                            {size}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Stall Utilities Grid */}
                        <div style={{
                            background: '#FFFFFF',
                            borderRadius: '12px',
                            border: '1px solid rgba(245, 158, 46, 0.25)',
                            padding: '1.25rem',
                            marginBottom: '1.25rem'
                        }}>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#9A3412', marginBottom: '0.85rem' }}>
                                🧹 ค่าบริการและสิ่งอำนวยความสะดวกสำหรับตลาด (Market Utilities)
                            </div>
                            <div className="settings-grid">
                                <div className="form-group">
                                    <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>ค่าขยะ & ดูแลความสะอาดแผง (บาท)</span>
                                        <span style={{ fontSize: '0.75rem', color: '#E8740C', fontWeight: 600 }}>
                                            {marketConfig.waste_fee_cycle === 'monthly' ? 'ต่อเดือน' : 'ต่อวัน'}
                                        </span>
                                    </label>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <input
                                            type="number"
                                            className="form-input mono"
                                            style={{ flex: 1, padding: '0.65rem 0.85rem' }}
                                            value={marketConfig.waste_fee_per_stall ?? 20}
                                            onChange={e => handleMarketChange('waste_fee_per_stall', Number(e.target.value))}
                                        />
                                        <select
                                            className="form-input"
                                            style={{ width: '110px', padding: '0.65rem 0.5rem', fontSize: '0.85rem' }}
                                            value={marketConfig.waste_fee_cycle || 'daily'}
                                            onChange={e => handleMarketChange('waste_fee_cycle', e.target.value)}
                                        >
                                            <option value="daily">/ วัน</option>
                                            <option value="monthly">/ เดือน</option>
                                        </select>
                                    </div>
                                    <p className="form-hint">ค่าเก็บขยะ/ทำความสะอาดทางเดินตลาด</p>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">ค่าไฟเหมาต่อแผง (บาท/วัน)</label>
                                    <input
                                        type="number"
                                        className="form-input mono"
                                        style={{ padding: '0.65rem 0.85rem' }}
                                        value={marketConfig.electricity_flat_fee ?? 30}
                                        onChange={e => handleMarketChange('electricity_flat_fee', Number(e.target.value))}
                                    />
                                    <p className="form-hint">สำหรับแผงใช้ไฟส่องสว่าง/พัดลม (ไม่ติดมิเตอร์)</p>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">ค่าเช่าโต๊ะ / เต็นท์ / อุปกรณ์ (บาท/วัน)</label>
                                    <input
                                        type="number"
                                        className="form-input mono"
                                        style={{ padding: '0.65rem 0.85rem' }}
                                        value={marketConfig.table_rental_fee ?? 0}
                                        onChange={e => handleMarketChange('table_rental_fee', Number(e.target.value))}
                                    />
                                    <p className="form-hint">กรณีตลาดมีบริการให้เช่าโต๊ะพับหรือร่มแม่ค้า</p>
                                </div>
                            </div>
                        </div>

                        {/* Market Zones */}
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
                                <label className="form-label" style={{ fontWeight: 700, margin: 0 }}>
                                    🏷️ โซนแผงค้าในตลาด (Market Zones)
                                </label>
                                <span style={{ fontSize: '0.75rem', color: '#C2410C' }}>
                                    {marketConfig.zones?.length || 0} โซน
                                </span>
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                {(marketConfig.zones || []).map((zone, idx) => (
                                    <span
                                        key={idx}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.35rem',
                                            background: '#FFFFFF',
                                            border: '1px solid rgba(245, 158, 46, 0.4)',
                                            color: '#9A3412',
                                            borderRadius: '999px',
                                            padding: '0.35rem 0.75rem',
                                            fontSize: '0.8125rem',
                                            fontWeight: 600,
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                                        }}
                                    >
                                        <span>{zone}</span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveZone(zone)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                color: '#EF4444',
                                                padding: 0,
                                                display: 'flex',
                                                alignItems: 'center',
                                                fontWeight: 800,
                                                fontSize: '12px'
                                            }}
                                            title="ลบโซนนี้"
                                        >
                                            ✕
                                        </button>
                                    </span>
                                ))}
                            </div>

                            {/* Add zone input */}
                            <div style={{ display: 'flex', gap: '0.5rem', maxWidth: '420px' }}>
                                <input
                                    type="text"
                                    className="form-input"
                                    style={{ padding: '0.55rem 0.85rem', fontSize: '0.875rem' }}
                                    placeholder="เช่น โซน F (ฟู้ดทรัค), โซน G (ตลาดต้นไม้)"
                                    value={newZoneInput}
                                    onChange={e => setNewZoneInput(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleAddZone();
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={handleAddZone}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.3rem',
                                        background: '#E8740C',
                                        color: '#FFFFFF',
                                        border: 'none',
                                        fontWeight: 700,
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    <Plus size={15} /> เพิ่มโซน
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {/* Multi-Language Settings */}
                <div className="settings-section">
                    <h3 className="settings-title">
                        <Globe size={20} color="#0A6CC2" />
                        ภาษาของระบบและบิล
                    </h3>
                    <p className="form-hint" style={{ marginBottom: '1.25rem' }}>
                        กำหนดภาษาหลักของหอพักสำหรับใบแจ้งหนี้, สลิปความร้อน, และข้อความแจ้งเตือนผ่าน LINE
                    </p>

                    <div className="settings-grid">
                        <div className="form-group">
                            <label className="form-label">ภาษาเริ่มต้นของหอพัก (Default Language)</label>
                            <select
                                className="form-input"
                                style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                                value={billForm.default_language}
                                onChange={e => handleBillFormChange('default_language', e.target.value)}
                            >
                                {LANGUAGE_OPTIONS.map(opt => (
                                    <option key={opt.code} value={opt.code}>
                                        {opt.flag} {opt.name} ({opt.nativeName})
                                    </option>
                                ))}
                            </select>
                            <p className="form-hint">ภาษาหลักที่ใช้สร้างบิลและข้อความแจ้งเตือน</p>
                        </div>

                        <div className="form-group">
                            <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>โหมด 2 ภาษา (Bilingual Invoices)</span>
                                <input
                                    type="checkbox"
                                    checked={billForm.bilingual_mode}
                                    onChange={e => handleBillFormChange('bilingual_mode', e.target.checked)}
                                    style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#0A6CC2' }}
                                />
                            </label>
                            <p className="form-hint" style={{ marginTop: '0.25rem' }}>
                                พิมพ์บิลพร้อมคำแปลภาษาที่สองคู่ขนาน (เช่น ไทย + English)
                            </p>

                            {billForm.bilingual_mode && (
                                <div style={{ marginTop: '0.75rem' }}>
                                    <label className="form-label" style={{ fontSize: '0.85rem' }}>ภาษาที่สอง (Secondary Language)</label>
                                    <select
                                        className="form-input"
                                        style={{ padding: '0.6rem 0.85rem', fontSize: '0.9rem' }}
                                        value={billForm.secondary_language}
                                        onChange={e => handleBillFormChange('secondary_language', e.target.value)}
                                    >
                                        {LANGUAGE_OPTIONS.filter(o => o.code !== billForm.default_language).map(opt => (
                                            <option key={opt.code} value={opt.code}>
                                                {opt.flag} {opt.name} ({opt.nativeName})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Dorm Logo Settings */}
                <div className="settings-section">
                    <h3 className="settings-title">
                        <ImageIcon size={20} color="#0A6CC2" />
                        โลโก้{terms.facilityType}
                    </h3>
                    <p className="form-hint" style={{ marginBottom: '1.25rem' }}>
                        โลโก้นี้จะแสดงที่หน้าเลือกสาขาหอพัก, มุมบนหน้า Dashboard, พอร์ทัลผู้เช่า, และบนใบแจ้งหนี้
                    </p>

                    <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoChange} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                        {dormLogo ? (
                            <div style={{ position: 'relative' }}>
                                <img
                                    src={dormLogo}
                                    alt="โลโก้หอพัก"
                                    style={{
                                        width: 84,
                                        height: 84,
                                        objectFit: 'contain',
                                        borderRadius: 16,
                                        border: '1.5px solid var(--color-primary)',
                                        background: '#FFFFFF',
                                        padding: 4,
                                        boxShadow: '0 4px 14px rgba(10, 108, 194, 0.18)'
                                    }}
                                />
                            </div>
                        ) : (
                            <div style={{
                                width: 84,
                                height: 84,
                                borderRadius: 16,
                                border: '2px dashed var(--color-gray-300)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.25rem',
                                color: 'var(--color-gray-400)',
                                background: 'var(--color-gray-50)'
                            }}>
                                <ImageIcon size={28} />
                                <span style={{ fontSize: '0.7rem' }}>ไม่มีโลโก้</span>
                            </div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <button
                                    type="button"
                                    onClick={() => logoInputRef.current?.click()}
                                    disabled={logoLoading}
                                    className="btn btn-primary btn-sm"
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        fontWeight: 600,
                                        opacity: logoLoading ? 0.7 : 1,
                                    }}
                                >
                                    {logoLoading ? (
                                        <span style={{ width: 14, height: 14, border: '2px solid rgba(255, 255, 255, 0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                                    ) : (
                                        <Upload size={14} />
                                    )}
                                    {dormLogo ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้หอพัก'}
                                </button>
                                {dormLogo && (
                                    <button
                                        type="button"
                                        onClick={() => setDormLogo(undefined)}
                                        className="btn btn-outline btn-sm"
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.35rem',
                                            color: '#EF4444',
                                            borderColor: '#FCA5A5'
                                        }}
                                    >
                                        <Trash2 size={14} /> ลบโลโก้
                                    </button>
                                )}
                            </div>
                            <p className="form-hint" style={{ margin: 0, fontSize: '0.8rem' }}>
                                รองรับ PNG หรือ JPG (แนะนำขนาด 400×400 px ขึ้นไป ระบบจะบีบอัดอัตโนมัติ)
                            </p>
                        </div>
                    </div>
                </div>

                </>
            )}

            {/* Billing Tab */}
            {activeTab === 'billing' && (
                <>
            {/* Rent Settings */}
            <div className="settings-section">
                <h3 className="settings-title">
                    {formData.building_type === 'market' ? <Store size={20} color="#15803D" /> : <Home size={20} color="#15803D" />}
                    {terms.rentLabel}
                </h3>
                <div className="form-group">
                    <label className="form-label">
                        {formData.building_type === 'market'
                            ? `ค่าเช่าเริ่มต้น (บาท / ${marketConfig.default_rent_cycle === 'daily' ? 'วัน' : marketConfig.default_rent_cycle === 'weekly' ? 'สัปดาห์' : 'เดือน'})`
                            : 'ค่าเช่าเริ่มต้น (บาท)'
                        }
                    </label>
                    <input
                        type="number"
                        className="form-input mono"
                        style={{ maxWidth: '200px', padding: '0.75rem 1rem', fontSize: '1rem' }}
                        value={formData.room_rent}
                        onChange={e => handleChange('room_rent', e.target.value)}
                    />
                    <p className="form-hint">ค่าเช่าเริ่มต้นสำหรับ{terms.unitNamePlural}ใหม่ (แก้ไขราย{terms.unitName}ได้ในหน้า{terms.manageUnitsLabel})</p>
                </div>
            </div>

                {/* Electricity Settings */}
                <div className="settings-section">
                <h3 className="settings-title">
                    <Zap size={20} color="#F59E2E" />
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
                    <Droplets size={20} color="#0A6CC2" />
                    <Home size={20} color="#0A6CC2" style={{ marginRight: '8px' }} />
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
                    <Droplets size={20} color="#0A6CC2" />
                    <Building2 size={20} color="#0A6CC2" style={{ marginRight: '8px' }} />
                    ค่าน้ำประปา — อาคารพาณิชย์
                </h3>
                <p className="form-hint" style={{ marginBottom: 'var(--space-4)', fontSize: '0.875rem', color: 'var(--color-gray-500)' }}>
                    ใช้สำหรับห้องที่ตั้งประเภทเป็น "พาณิชย์" (ตั้งค่าเฉพาะห้องได้ในหน้าจัดการห้อง)
                </p>
                {renderWaterForm('comm', formData.comm_water_type)}
            </div>

            {/* Bill Customization */}
            <div className="settings-section">
                <h3 className="settings-title">
                    <FileText size={20} color="#0A6CC2" />
                    ตั้งค่าใบแจ้งหนี้ / ใบเสร็จ
                </h3>
                <p className="form-hint" style={{ marginBottom: 'var(--space-4)', fontSize: '0.875rem', color: 'var(--color-gray-500)' }}>
                    ข้อมูลเหล่านี้จะแสดงในใบแจ้งหนี้ทุกใบ และเอกสารสรุปรายเดือน
                </p>

                {/* Dorm logo */}
                <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <ImageIcon size={15} /> โลโก้{terms.facilityType} (แสดงในพอร์ทัล{terms.tenantLabel})
                    </label>
                    <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoChange} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        {dormLogo ? (
                            <img src={dormLogo} alt={`โลโก้${terms.facilityType}`} style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 10, border: '1.5px solid var(--color-gray-200)', background: '#F4F7FB', padding: 4 }} />
                        ) : (
                            <div style={{ width: 72, height: 72, borderRadius: 10, border: '1.5px dashed var(--color-gray-300)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-gray-400)', background: '#F4F7FB' }}>
                                <ImageIcon size={24} />
                            </div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <button
                                type="button"
                                onClick={() => logoInputRef.current?.click()}
                                disabled={logoLoading}
                                style={{
                                    padding: '0.5rem 1rem', borderRadius: 8, cursor: 'pointer',
                                    border: '1.5px solid var(--color-primary)', background: 'rgba(15, 76, 129,0.07)',
                                    color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.875rem',
                                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                                    opacity: logoLoading ? 0.6 : 1,
                                }}
                            >
                                {logoLoading
                                    ? <span style={{ width: 14, height: 14, border: '2px solid rgba(10, 108, 194, 0.3)', borderTopColor: '#0A6CC2', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                                    : <ImageIcon size={14} />
                                }
                                {dormLogo ? 'เปลี่ยนโลโก้' : 'อัพโหลดโลโก้'}
                            </button>
                            {dormLogo && (
                                <button
                                    type="button"
                                    onClick={() => setDormLogo(undefined)}
                                    style={{
                                        padding: '0.35rem 0.75rem', borderRadius: 8, cursor: 'pointer',
                                        border: '1px solid #FCA5A5', background: 'transparent',
                                        color: '#DC2626', fontWeight: 500, fontSize: '0.8rem',
                                        display: 'flex', alignItems: 'center', gap: '0.3rem',
                                    }}
                                >
                                    <Trash2 size={13} /> ลบโลโก้
                                </button>
                            )}
                        </div>
                    </div>
                    <p className="form-hint">รองรับ PNG/JPG ขนาดแนะนำ 400×400 px ขึ้นไป (บีบอัดอัตโนมัติ)</p>
                </div>

                <div className="settings-grid">
                    <div className="form-group">
                        <label className="form-label">{terms.facilityNameLabel}</label>
                        <input
                            type="text"
                            className="form-input"
                            style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                            value={billForm.dorm_name}
                            onChange={e => handleBillFormChange('dorm_name', e.target.value)}
                            placeholder={formData.building_type === 'market' ? 'เช่น ตลาดนัดกรีนมาร์เก็ต' : 'เช่น หอพักสุขใจ'}
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
                    <label className="form-label">ที่อยู่ ({terms.facilityType})</label>
                    <input
                        type="text"
                        className="form-input"
                        style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                        value={billForm.dorm_address}
                        onChange={e => handleBillFormChange('dorm_address', e.target.value)}
                        placeholder="เช่น 123 ถ.มิตรภาพ อ.เมือง จ.ขอนแก่น 40000"
                    />
                </div>

                <div className="form-group" style={{ background: 'rgba(10, 108, 194,0.08)', border: '1px solid rgba(10, 108, 194,0.25)', borderRadius: 12, padding: '0.75rem 1rem', fontSize: '0.875rem', lineHeight: 1.5 }}>
                    <strong>QR สำหรับรับเงินในบิล</strong> สร้างจากบัญชีรับเงินหลักของสถานที่นี้ ตั้งค่าได้ที่หน้า <em>การชำระเงิน → บัญชีรับเงิน</em> (ใส่เลข PromptPay เบอร์โทรหรือเลขบัตรประชาชนที่บัญชีนั้นได้)
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

            {/* Late fees + prorated rent */}
            <div className="settings-section">
                <h3 className="settings-title">
                    <Clock size={20} color="#E8740C" />
                    ค่าปรับล่าช้าและค่าเช่าตามจริง
                </h3>

                <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>คิดค่าปรับชำระล่าช้าอัตโนมัติ</span>
                        <input
                            type="checkbox"
                            checked={lateFee.enabled}
                            onChange={e => setLateFee(prev => ({ ...prev, enabled: e.target.checked }))}
                            style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#0A6CC2' }}
                        />
                    </label>
                    <p className="form-hint" style={{ marginTop: '0.25rem' }}>
                        ระบบตรวจทุกเช้า บิลที่ยังไม่จ่ายเลยวันที่ {Number(billForm.due_day) || 5}
                        {Number(lateFee.grace_days) > 0 ? ` + ผ่อนผัน ${lateFee.grace_days} วัน` : ''} จะได้รายการค่าปรับในห้องนั้น
                        และแจ้งในข้อความทวงทาง LINE ผู้เช่าที่ส่งสลิปแล้วรอตรวจจะไม่ถูกปรับเพิ่ม
                    </p>
                </div>

                {lateFee.enabled && (
                    <div className="settings-grid">
                        <div className="form-group">
                            <label className="form-label">วิธีคิด</label>
                            <select
                                className="form-input"
                                style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                                value={lateFee.mode}
                                onChange={e => setLateFee(prev => ({ ...prev, mode: e.target.value as LateFeeConfig['mode'] }))}
                            >
                                <option value="per_day">รายวัน (บาท/วัน)</option>
                                <option value="flat">ครั้งเดียว (บาท)</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">{lateFee.mode === 'per_day' ? 'ค่าปรับต่อวัน (บาท)' : 'ค่าปรับ (บาท)'}</label>
                            <input
                                type="number"
                                className="form-input mono"
                                style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                                min={0}
                                value={lateFee.amount}
                                onChange={e => setLateFee(prev => ({ ...prev, amount: Number(e.target.value) }))}
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">ผ่อนผัน (วัน)</label>
                            <input
                                type="number"
                                className="form-input mono"
                                style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                                min={0}
                                max={60}
                                value={lateFee.grace_days}
                                onChange={e => setLateFee(prev => ({ ...prev, grace_days: Number(e.target.value) }))}
                            />
                            <p className="form-hint">จำนวนวันหลังครบกำหนดที่ยังไม่คิดค่าปรับ</p>
                        </div>
                        {lateFee.mode === 'per_day' && (
                            <div className="form-group">
                                <label className="form-label">เพดานค่าปรับต่อบิล (บาท)</label>
                                <input
                                    type="number"
                                    className="form-input mono"
                                    style={{ padding: '0.75rem 1rem', fontSize: '1rem' }}
                                    min={0}
                                    value={lateFee.max_amount}
                                    onChange={e => setLateFee(prev => ({ ...prev, max_amount: Number(e.target.value) }))}
                                />
                                <p className="form-hint">0 = ไม่จำกัด</p>
                            </div>
                        )}
                    </div>
                )}

                <div className="form-group" style={{ marginTop: '0.5rem' }}>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>คิดค่าเช่าตามจำนวนวัน เมื่อย้ายเข้า/ย้ายออกกลางเดือน</span>
                        <input
                            type="checkbox"
                            checked={prorateRentOn}
                            onChange={e => setProrateRentOn(e.target.checked)}
                            style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#0A6CC2' }}
                        />
                    </label>
                    <p className="form-hint" style={{ marginTop: '0.25rem' }}>
                        ใช้วันเข้าอยู่และวันย้ายออกจากข้อมูลผู้เช่า เช่น ค่าเช่า 3,100 บาท เข้าอยู่วันที่ 21 ต.ค. (11 จาก 31 วัน) คิด 1,100 บาท
                        ใช้กับห้องรายเดือนเท่านั้น แสดงเป็น “คิด 11/31 วัน” ในหน้าจดมิเตอร์ก่อนบันทึก
                    </p>
                </div>
            </div>
            </>
            )}

            {/* Contract & E-Sign Templates Tab */}
            {activeTab === 'contract' && (
                <ContractTemplatesSettingsSection
                    config={config}
                    onSaveConfig={onSaveConfig}
                />
            )}

            {/* Integrations Tab */}
            {activeTab === 'integrations' && (
                <>
            <ListingSettingsSection config={config} ownerUid={uid} buildingId={buildingId} />
            <OwnerLineSection ownerUid={uid} />

            {/* LINE Integration */}
            <div className="settings-section" style={{ position: 'relative' }}>
            {!isPaid && (
                <div style={{
                    position: 'absolute', inset: 0, zIndex: 10,
                    background: 'rgba(255,255,255,0.82)',
                    backdropFilter: 'blur(3px)',
                    borderRadius: 'inherit',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
                }}>
                    <div style={{
                        width: 48, height: 48, borderRadius: '50%',
                        background: 'linear-gradient(135deg,#0F4C81,#0F4C81)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 4px 16px rgba(15, 76, 129,0.3)',
                    }}>
                        <Lock size={22} color="#fff" />
                    </div>
                    <p style={{ margin: 0, fontWeight: 700, color: '#102A43', fontSize: '0.9375rem' }}>ฟีเจอร์สำหรับแพ็กเกจที่ชำระเงิน</p>
                    <button
                        onClick={onUpgrade}
                        style={{
                            background: 'linear-gradient(135deg,#0F4C81,#E8740C)',
                            color: '#fff', border: 'none', borderRadius: '10px',
                            padding: '0.625rem 1.5rem', fontWeight: 700, fontSize: '0.875rem',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem',
                            boxShadow: '0 4px 14px rgba(15, 76, 129,0.35)',
                        }}
                    >
                        <Zap size={15} /> ดูแพ็กเกจ
                    </button>
                </div>
            )}
                <h3 className="settings-title">
                    <MessageCircle size={20} color="#06C755" />
                    เชื่อมต่อ LINE (ส่งบิลผ่าน LINE)
                </h3>
                <p className="form-hint" style={{ marginBottom: 'var(--space-5)' }}>
                    สร้าง Invite Link แล้วส่งให้ลูกหอ — กดลิ้งก์เดียว พิมพ์เลขห้อง แล้วจบ <CheckCircle2 size={14} color="#15803D" style={{ display: 'inline', verticalAlign: 'text-bottom' }} />
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
                    // LINE URL scheme: https://line.me/R/oaMessage/{OA ID}/?{text}
                    // The OA ID ("@xxxx") and the message must both be URL-encoded,
                    // otherwise LINE can't resolve the account ("ไม่พบผู้ใช้").
                    const inviteLink = lineOaId
                        ? `https://line.me/R/oaMessage/${encodeURIComponent(lineOaId)}/?${encodeURIComponent(dormCode)}`
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
                                                    <QRCodeCanvas 
                                                        id="invite-qr-canvas"
                                                        value={inviteLink!} 
                                                        size={192} 
                                                        level="H" 
                                                        marginSize={2} 
                                                        imageSettings={{
                                                            src: horcareLogo,
                                                            height: 32,
                                                            width: 32,
                                                            excavate: true,
                                                        }}
                                                    />
                                                    <div style={{ textAlign: 'center' }}>
                                                        <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#111' }}>
                                                            {billForm.dorm_name || 'หอพัก'}
                                                        </div>
                                                        <div style={{ fontSize: '0.8rem', color: '#777', marginTop: '0.2rem' }}>
                                                            สแกน QR เพื่อรับบิลผ่าน LINE
                                                        </div>
                                                    </div>

                                                    {/* Hidden Print Area */}
                                                    <div className="qr-print-wrapper">
                                                        <div style={{ textAlign: 'center', fontFamily: 'var(--font-sans)' }}>
                                                            <h1 style={{ fontSize: '2.5rem', marginBottom: '0.25rem', color: '#111' }}>{billForm.dorm_name || 'หอพัก'}</h1>
                                                            <h2 style={{ fontSize: '1.5rem', fontWeight: 'normal', color: '#444' }}>
                                                                สแกน QR Code แล้วพิมพ์รหัสเพื่อลงทะเบียน
                                                            </h2>
                                                            <div style={{ margin: '1.5rem auto', padding: '1rem', background: '#fff', borderRadius: '1.5rem', border: '2px solid #eee', display: 'inline-block' }}>
                                                                <QRCodeCanvas 
                                                                    value={inviteLink!} 
                                                                    size={360} 
                                                                    level="H" 
                                                                    imageSettings={{ src: horcareLogo, height: 60, width: 60, excavate: true }}
                                                                />
                                                            </div>
                                                            <div style={{ fontSize: '1.25rem', color: '#555', marginTop: '0.5rem' }}>
                                                                รหัสลงทะเบียน: <strong style={{ fontSize: '2.25rem', color: '#22A35A', letterSpacing: '4px', background: '#eff8f2', padding: '0.5rem 1.5rem', borderRadius: '1rem', display: 'inline-block', border: '2px dashed #22a35a' }}>{dormCode}</strong>
                                                            </div>
                                                            
                                                            <div style={{ display: 'flex', gap: '3rem', justifyContent: 'center', alignItems: 'center', marginTop: '2rem' }}>
                                                                <img src="https://upload.wikimedia.org/wikipedia/commons/4/41/LINE_logo.svg" style={{ height: 65 }} alt="LINE" />
                                                                <div style={{ width: '2px', height: '50px', background: '#ddd' }}></div>
                                                                <img src={horcareLogo} style={{ height: 60 }} alt="HorCare" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
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
                                                            <Printer size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> พิมพ์
                                                        </button>
                                                        <button
                                                            style={{
                                                                display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                                                                background: '#22A35A', color: '#fff',
                                                                border: 'none', borderRadius: 8,
                                                                padding: '0.5rem 1rem', fontSize: '0.8125rem',
                                                                cursor: 'pointer',
                                                            }}
                                                            onClick={() => {
                                                                const canvas = document.getElementById('invite-qr-canvas') as HTMLCanvasElement;
                                                                if (canvas) {
                                                                    const url = canvas.toDataURL('image/png');
                                                                    const a = document.createElement('a');
                                                                    a.href = url;
                                                                    a.download = 'horcare-invite-qr.png';
                                                                    a.click();
                                                                }
                                                            }}
                                                        >
                                                            <ImageIcon size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> โหลดเป็น PNG
                                                        </button>
                                                    </div>
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
                                                <Lightbulb size={14} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> ลูกหอใหม่ลงทะเบียนห้องเดิม → คนเก่าออกจากระบบอัตโนมัติ
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })()}
            </div>

            {/* Tenant Portal PIN */}
            <div className="settings-section" style={{ position: 'relative' }}>
            {!isPaid && (
                <div style={{
                    position: 'absolute', inset: 0, zIndex: 10,
                    background: 'rgba(255,255,255,0.82)',
                    backdropFilter: 'blur(3px)',
                    borderRadius: 'inherit',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
                }}>
                    <div style={{
                        width: 48, height: 48, borderRadius: '50%',
                        background: 'linear-gradient(135deg,#0F4C81,#0F4C81)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 4px 16px rgba(15, 76, 129,0.3)',
                    }}>
                        <Lock size={22} color="#fff" />
                    </div>
                    <p style={{ margin: 0, fontWeight: 700, color: '#102A43', fontSize: '0.9375rem' }}>ฟีเจอร์สำหรับแพ็กเกจที่ชำระเงิน</p>
                    <button
                        onClick={onUpgrade}
                        style={{
                            background: 'linear-gradient(135deg,#0F4C81,#E8740C)',
                            color: '#fff', border: 'none', borderRadius: '10px',
                            padding: '0.625rem 1.5rem', fontWeight: 700, fontSize: '0.875rem',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem',
                            boxShadow: '0 4px 14px rgba(15, 76, 129,0.35)',
                        }}
                    >
                        <Zap size={15} /> ดูแพ็กเกจ
                    </button>
                </div>
            )}
                <h3 className="settings-title">
                    <Lock size={20} color="#15803D" />
                    พอร์ทัลผู้เช่า — PIN
                </h3>
                <p className="form-hint" style={{ marginBottom: 'var(--space-4)', fontSize: '0.875rem', color: 'var(--color-gray-500)' }}>
                    ถ้าตั้งค่า PIN ผู้เช่าต้องกรอก 4 หลักก่อนเข้าดูบิลและแจ้งซ่อม — ปล่อยว่างไว้เพื่อปิดการตรวจสอบ
                </p>
                <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">PIN (4 หลัก)</label>
                    <input
                        type="text"
                        className="form-input mono"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="ปล่อยว่าง = ไม่ต้องกรอก PIN"
                        style={{ maxWidth: '180px', padding: '0.75rem 1rem', fontSize: '1.25rem', letterSpacing: '0.25em' }}
                        value={portalPin}
                        onChange={e => {
                            const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                            setPortalPin(v);
                        }}
                    />
                    {portalPin && portalPin.length !== 4 && (
                        <p className="form-hint" style={{ color: '#DC2626' }}>PIN ต้องมี 4 หลัก</p>
                    )}
                </div>
            </div>
            </>
            )}


            {/* Theme Settings (General Tab) */}
            {activeTab === 'general' && (
                <div className="settings-section">
                <h3 className="settings-title">
                    <Palette size={20} color="#0A6CC2" />
                    ธีมและสีสันของระบบ
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
                        {mode === 'system' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><SettingsIcon size={14} /> ตามโหมดของอุปกรณ์ — เปลี่ยนอัตโนมัติเมื่อ OS สลับ</span> :
                         mode === 'dark'   ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Moon size={14} /> โหมดมืดไฮเทค — ดีไซน์ Deep Navy ถนอมสายตา</span> :
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Sun size={14} /> โหมดสว่างมินิมอล — สะอาดตา คมชัด อ่านง่าย</span>}
                    </p>
                </div>

                {/* Brand Identity & Color System */}
                <div style={{
                    background: 'var(--color-bg-alt)',
                    border: '1px solid rgba(10, 108, 194, 0.2)',
                    borderRadius: '14px',
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{
                                width: 8, height: 8, borderRadius: '50%',
                                background: '#22A35A',
                                boxShadow: '0 0 8px #22A35A',
                            }} />
                            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}>
                                ธีมทางการ HorCare Gen Z Hi-Tech (Active Standard)
                            </span>
                        </div>
                        <span style={{
                            fontSize: '0.75rem', fontWeight: 600,
                            padding: '0.2rem 0.6rem', borderRadius: '20px',
                            background: 'rgba(10, 108, 194, 0.1)', color: '#0A6CC2',
                            border: '1px solid rgba(10, 108, 194, 0.2)',
                        }}>
                            มาตรฐานสากลเดี่ยว
                        </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
                        {[
                            { name: 'Deep Navy', code: '#080C14', desc: 'พื้นหลังหลัก/มิติ', color: '#102A43' },
                            { name: 'Electric Cyan', code: '#0A6CC2', desc: 'สีปุ่มและไอคอน', color: '#0A6CC2' },
                            { name: 'Cyber Emerald', code: '#22A35A', desc: 'สถานะและผลรวม', color: '#22A35A' },
                            { name: 'Neon Orange', code: '#E8740C', desc: 'แจ้งเตือน/เน้นย้ำ', color: '#E8740C' },
                        ].map((swatch, idx) => (
                            <div key={idx} style={{
                                background: 'var(--color-card)',
                                border: '1px solid var(--color-gray-200)',
                                borderRadius: '10px',
                                padding: '0.625rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.625rem',
                            }}>
                                <div style={{
                                    width: '28px', height: '28px', borderRadius: '8px',
                                    background: swatch.color, flexShrink: 0,
                                    border: '1px solid rgba(0,0,0,0.1)',
                                    boxShadow: `0 2px 8px ${swatch.color}44`,
                                }} />
                                <div>
                                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.2 }}>
                                        {swatch.name}
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--color-gray-500)', fontFamily: 'var(--font-mono)' }}>
                                        {swatch.code}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                </div>
            )}


            {/* Push Notifications (Integrations Tab) */}
            {activeTab === 'integrations' && (
            <>
            <div className="settings-section">
                <h3 className="settings-title">
                    <Bell size={20} color="#0F4C81" />
                    การแจ้งเตือน
                </h3>
                <p className="form-hint" style={{ marginBottom: '1.25rem', fontSize: '0.875rem' }}>
                    รับการแจ้งเตือนบนมือถือ/เดสก์ท็อปเมื่อลูกหอแจ้งซ่อม, ส่งสลิป หรือมีเหตุการณ์สำคัญ
                </p>

                {permission === 'unsupported' ? (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.625rem',
                        padding: '0.875rem 1rem', borderRadius: '12px',
                        background: 'var(--color-gray-100)', border: '1px solid var(--color-gray-200)',
                        fontSize: '0.875rem', color: 'var(--color-gray-500)',
                    }}>
                        <BellOff size={18} />
                        เบราว์เซอร์นี้ไม่รองรับ Push Notification
                    </div>
                ) : permission === 'denied' ? (
                    <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: '0.625rem',
                        padding: '0.875rem 1rem', borderRadius: '12px',
                        background: '#FDEBD3', border: '1px solid #FBD9A8',
                        fontSize: '0.875rem', color: '#9A3412',
                    }}>
                        <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                        <div>
                            <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>การแจ้งเตือนถูกบล็อค</div>
                            <div>กรุณาเปิดใช้งานในการตั้งค่าเบราว์เซอร์ → Site Settings → Notifications → Allow</div>
                        </div>
                    </div>
                ) : permission === 'granted' ? (
                    <div>
                        <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: '1rem', flexWrap: 'wrap',
                        padding: '1rem 1.25rem', borderRadius: '14px',
                        background: enabled
                            ? 'linear-gradient(135deg, rgba(15, 76, 129,0.08), rgba(15, 76, 129,0.04))'
                            : 'var(--color-gray-50)',
                        border: enabled
                            ? '1.5px solid rgba(15, 76, 129,0.3)'
                            : '1.5px solid var(--color-gray-200)',
                        transition: 'all 0.2s',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{
                                width: 42, height: 42, borderRadius: '12px', flexShrink: 0,
                                background: enabled
                                    ? 'linear-gradient(135deg, #0F4C81, #0F4C81)'
                                    : 'var(--color-gray-200)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'background 0.2s',
                            }}>
                                {enabled
                                    ? <BellRing size={20} color="#fff" />
                                    : <BellOff size={20} color="var(--color-gray-500)" />
                                }
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--color-text)' }}>
                                    {enabled ? 'เปิดการแจ้งเตือนแล้ว' : 'ปิดการแจ้งเตือน'}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
                                    {enabled
                                        ? 'จะได้รับ push เมื่อลูกหอแจ้งซ่อมหรือส่งสลิป'
                                        : 'เปิดเพื่อรับแจ้งเตือนแบบ real-time'
                                    }
                                </div>
                            </div>
                        </div>
                        {/* Toggle switch */}
                        <button
                            onClick={() => toggleEnabled(!enabled)}
                            disabled={notifLoading}
                            style={{
                                position: 'relative',
                                width: 52, height: 28, borderRadius: 14,
                                border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
                                background: enabled
                                    ? 'linear-gradient(135deg, #0F4C81, #0F4C81)'
                                    : 'var(--color-gray-300)',
                                transition: 'background 0.25s',
                                opacity: notifLoading ? 0.6 : 1,
                            }}
                            aria-label={enabled ? 'ปิดการแจ้งเตือน' : 'เปิดการแจ้งเตือน'}
                        >
                            <span style={{
                                position: 'absolute',
                                top: 3, left: enabled ? 27 : 3,
                                width: 22, height: 22, borderRadius: '50%',
                                background: '#fff',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                                transition: 'left 0.2s',
                                display: 'block',
                            }} />
                        </button>
                    </div>

                    {/* Test notification button */}
                    <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                            type="button"
                            disabled={testNotifSending}
                            onClick={async () => {
                                setTestNotifSending(true);
                                try {
                                    await testNotification();
                                    toast.success('ส่งการแจ้งเตือนทดสอบแล้ว! ตรวจสอบข้อความแจ้งเตือนที่แถบด้านบนหรือหน้าจอมือถือ');
                                } catch {
                                    toast.error('ไม่สามารถส่งการแจ้งเตือนทดสอบได้');
                                } finally {
                                    setTestNotifSending(false);
                                }
                            }}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                padding: '0.5rem 1rem', borderRadius: '10px',
                                border: '1px solid #dce5ef', background: '#f4f7fb',
                                color: '#3E5872', fontSize: '0.8125rem', fontWeight: 600,
                                cursor: 'pointer', transition: 'all 0.15s ease',
                            }}
                        >
                            <Bell size={14} color="#0F4C81" />
                            {testNotifSending ? 'กำลังส่งแจ้งเตือน...' : 'ทดสอบส่งการแจ้งเตือน'}
                        </button>
                    </div>
                </div>
                ) : (
                    /* permission === 'default' — not asked yet */
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.875rem',
                        padding: '1.75rem 1.5rem', borderRadius: '16px', textAlign: 'center',
                        background: 'linear-gradient(135deg, rgba(15, 76, 129,0.06), rgba(15, 76, 129,0.03))',
                        border: '1.5px dashed rgba(15, 76, 129,0.3)',
                    }}>
                        <div style={{
                            width: 56, height: 56, borderRadius: '16px',
                            background: 'linear-gradient(135deg, #0F4C81, #0F4C81)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 16px rgba(15, 76, 129,0.35)',
                        }}>
                            <Bell size={26} color="#fff" />
                        </div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)', marginBottom: '0.375rem' }}>
                                เปิดรับการแจ้งเตือน
                            </div>
                            <div style={{ fontSize: '0.8375rem', color: 'var(--color-text-muted)', lineHeight: 1.6, maxWidth: 300 }}>
                                รู้ทันทีเมื่อมีการแจ้งซ่อม, ชำระเงิน หรือเหตุการณ์สำคัญ — แม้ไม่ได้เปิดแอป
                            </div>
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={handleRequestNotif}
                            disabled={notifRequesting}
                            style={{ padding: '0.75rem 2rem', fontSize: '0.9375rem', borderRadius: '12px', gap: '0.5rem' }}
                        >
                            {notifRequesting
                                ? <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                                : <Bell size={17} />
                            }
                            {notifRequesting ? 'กำลังขอสิทธิ์...' : 'เปิดรับการแจ้งเตือน'}
                        </button>
                    </div>
                )}
            </div>
            </>
            )}


            {activeTab !== 'account' && activeTab !== 'contract' && (
            <div className={`settings-savebar${dirty ? ' dirty' : ''}`} role="region" aria-label="บันทึกการตั้งค่า">
                <span className="settings-savebar-note" aria-live="polite">
                    {dirty ? 'มีการแก้ไขที่ยังไม่ได้บันทึก' : 'บันทึกล่าสุดแล้ว'}
                </span>
                {dirty && <button type="button" className="btn btn-outline" onClick={() => setPrevConfig({ ...config }) /* a fresh copy makes the form reload from the saved config */}>ยกเลิกการแก้ไข</button>}
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!dirty}>
                    <Save size={18} />
                    บันทึกการตั้งค่า
                </button>
            </div>
            )}

            {/* Account Tab */}
            {activeTab === 'account' && (
            <>
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
                        border: '1px solid rgba(34, 163, 90,0.15)'
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
            </>
            )}
            </div>
            </div>
        </div>
    );
}
