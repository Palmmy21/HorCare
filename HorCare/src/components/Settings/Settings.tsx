import { useState, useEffect } from 'react';
import { Save, Zap, Droplets, Home, Lock, Eye, EyeOff, Check, Building2 } from 'lucide-react';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { auth } from '../../firebase/config';
import type { DormConfig, WaterConfig } from '../../types';

interface SettingsProps {
    config: DormConfig;
    onSaveConfig: (config: DormConfig) => void;
}

export default function Settings({ config, onSaveConfig }: SettingsProps) {
    const [formData, setFormData] = useState({
        building_type: config.building_type || 'dormitory',
        electricity_rate: config.electricity_rate,
        room_rent: config.room_rent,
        water_type: config.water_config.type,
        water_unit_rate: config.water_config.unit_rate || 0,
        water_flat_price: config.water_config.flat_price || 250,
        water_flat_limit: config.water_config.flat_limit_unit || 10,
        water_excess_rate: config.water_config.excess_unit_rate || 25
    });
    const [saved, setSaved] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPasswords, setShowPasswords] = useState(false);
    const [passwordStatus, setPasswordStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [passwordError, setPasswordError] = useState('');

    useEffect(() => {
        setFormData({
            building_type: config.building_type || 'dormitory',
            electricity_rate: config.electricity_rate,
            room_rent: config.room_rent,
            water_type: config.water_config.type,
            water_unit_rate: config.water_config.unit_rate || 0,
            water_flat_price: config.water_config.flat_price || 250,
            water_flat_limit: config.water_config.flat_limit_unit || 10,
            water_excess_rate: config.water_config.excess_unit_rate || 25
        });
    }, [config]);

    const handleChange = (field: string, value: string | number) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setSaved(false);
    };

    const handleSave = () => {
        const waterConfig: WaterConfig = formData.water_type === 'normal'
            ? { type: 'normal', unit_rate: Number(formData.water_unit_rate) }
            : {
                type: 'flat_rate_tier',
                flat_price: Number(formData.water_flat_price),
                flat_limit_unit: Number(formData.water_flat_limit),
                excess_unit_rate: Number(formData.water_excess_rate)
            };

        const newConfig: DormConfig = {
            building_type: formData.building_type as 'dormitory' | 'commercial',
            electricity_rate: Number(formData.electricity_rate),
            room_rent: Number(formData.room_rent),
            water_config: waterConfig
        };

        onSaveConfig(newConfig);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
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
            // Re-authenticate
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);

            // Update password
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

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">⚙️ ตั้งค่าระบบ</h1>
                <p className="page-subtitle">กำหนดอัตราค่าบริการและค่าเช่า</p>
            </div>

            {/* Building Type */}
            <div className="settings-section">
                <h3 className="settings-title">
                    <Building2 size={20} color="#6366F1" />
                    ประเภทอาคาร
                </h3>
                <div className="form-group">
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            className={`btn ${formData.building_type === 'dormitory' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => handleChange('building_type', 'dormitory')}
                            style={{ flex: 1 }}
                        >
                            🏠 หอพัก
                        </button>
                        <button
                            className={`btn ${formData.building_type === 'commercial' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => handleChange('building_type', 'commercial')}
                            style={{ flex: 1 }}
                        >
                            🏢 อาคารพาณิชย์
                        </button>
                    </div>
                    <p className="form-hint">
                        {formData.building_type === 'commercial'
                            ? 'โหมดอาคารพาณิชย์: ตั้งค่าน้ำ/ไฟเฉพาะห้องได้ในหน้าจัดการห้อง'
                            : 'โหมดหอพัก: ทุกห้องใช้อัตราค่าน้ำ/ไฟเดียวกัน'
                        }
                    </p>
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
                        style={{ maxWidth: '200px' }}
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

            {/* Water Settings */}
            <div className="settings-section">
                <h3 className="settings-title">
                    <Droplets size={20} color="#2563EB" />
                    ค่าน้ำประปา
                </h3>

                <div className="form-group">
                    <label className="form-label">รูปแบบการคิดค่าน้ำ</label>
                    <select
                        className="form-input"
                        style={{ maxWidth: '300px' }}
                        value={formData.water_type}
                        onChange={e => handleChange('water_type', e.target.value)}
                    >
                        <option value="flat_rate_tier">เหมาจ่าย + ส่วนเกิน</option>
                        <option value="normal">คิดตามจริง (บาท/หน่วย)</option>
                    </select>
                </div>

                {formData.water_type === 'normal' ? (
                    <div className="form-group">
                        <label className="form-label">ราคาต่อหน่วย (บาท)</label>
                        <input
                            type="number"
                            className="form-input mono"
                            style={{ maxWidth: '200px' }}
                            value={formData.water_unit_rate}
                            onChange={e => handleChange('water_unit_rate', e.target.value)}
                        />
                    </div>
                ) : (
                    <div className="settings-grid">
                        <div className="form-group">
                            <label className="form-label">ราคาเหมาจ่าย (บาท)</label>
                            <input
                                type="number"
                                className="form-input mono"
                                value={formData.water_flat_price}
                                onChange={e => handleChange('water_flat_price', e.target.value)}
                            />
                            <p className="form-hint">ราคาขั้นต่ำที่เรียกเก็บ</p>
                        </div>
                        <div className="form-group">
                            <label className="form-label">หน่วยที่รวมในเหมา</label>
                            <input
                                type="number"
                                className="form-input mono"
                                value={formData.water_flat_limit}
                                onChange={e => handleChange('water_flat_limit', e.target.value)}
                            />
                            <p className="form-hint">จำนวนหน่วยที่ใช้ได้ในราคาเหมา</p>
                        </div>
                        <div className="form-group">
                            <label className="form-label">ราคาหน่วยส่วนเกิน (บาท)</label>
                            <input
                                type="number"
                                className="form-input mono"
                                value={formData.water_excess_rate}
                                onChange={e => handleChange('water_excess_rate', e.target.value)}
                            />
                            <p className="form-hint">ราคาต่อหน่วยเมื่อใช้เกินกำหนด</p>
                        </div>
                    </div>
                )}
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
                        style={{ maxWidth: '200px' }}
                        value={formData.room_rent}
                        onChange={e => handleChange('room_rent', e.target.value)}
                    />
                    <p className="form-hint">ค่าเช่าเริ่มต้นสำหรับห้องใหม่ (แก้ไขรายห้องได้ในหน้าจัดการห้อง)</p>
                </div>
            </div>

            {/* Save Button */}
            <div className="flex gap-4 items-center" style={{ marginBottom: 'var(--space-8)' }}>
                <button className="btn btn-primary btn-lg" onClick={handleSave}>
                    <Save size={20} />
                    บันทึกการตั้งค่า
                </button>
                {saved && (
                    <span className="text-success font-bold animate-pulse">
                        ✓ บันทึกเรียบร้อยแล้ว!
                    </span>
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
                                padding: '4px'
                            }}
                        >
                            {showPasswords ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </div>

                <div className="settings-grid" style={{ maxWidth: '620px' }}>
                    <div className="form-group">
                        <label className="form-label">รหัสผ่านใหม่</label>
                        <input
                            type={showPasswords ? 'text' : 'password'}
                            className="form-input"
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
                        ⚠️ {passwordError}
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
                        border: '1px solid var(--color-gray-200)'
                    }}
                >
                    <Lock size={16} />
                    {passwordStatus === 'loading' ? 'กำลังเปลี่ยน...' : 'เปลี่ยนรหัสผ่าน'}
                </button>
            </div>
        </div>
    );
}
