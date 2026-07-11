import { useState } from 'react';
import { Zap, Droplets, Settings as SettingsIcon, ChevronDown, ChevronUp, RotateCcw, Calculator, BarChart3, Save, Banknote, Check } from 'lucide-react';

const LS_KEY = 'horcare_meter_calc_settings';

interface CalcSettings {
    elec_rate: number;
    water_mode: 'normal' | 'flat_rate_tier';
    water_unit_rate: number;
    water_flat_price: number;
    water_flat_limit: number;
    water_excess_rate: number;
}

const DEFAULT_SETTINGS: CalcSettings = {
    elec_rate: 8,
    water_mode: 'normal',
    water_unit_rate: 18,
    water_flat_price: 100,
    water_flat_limit: 10,
    water_excess_rate: 20,
};

function loadSettings(): CalcSettings {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: CalcSettings) {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
}

function calcWater(units: number, s: CalcSettings): { bill: number; detail: string } {
    if (s.water_mode === 'normal') {
        const bill = units * s.water_unit_rate;
        return { bill, detail: `${units} หน่วย × ${s.water_unit_rate} บาท = ${bill.toFixed(2)} บาท` };
    }
    // flat_rate_tier
    if (units <= 0) return { bill: 0, detail: '0 หน่วย' };
    const flatBill = s.water_flat_price;
    if (units <= s.water_flat_limit) {
        return { bill: flatBill, detail: `เหมาจ่าย ${flatBill} บาท (ใช้ ${units}/${s.water_flat_limit} หน่วย)` };
    }
    const excess = units - s.water_flat_limit;
    const excessBill = excess * s.water_excess_rate;
    const total = flatBill + excessBill;
    return {
        bill: total,
        detail: `เหมา ${flatBill} บาท + ส่วนเกิน ${excess} หน่วย × ${s.water_excess_rate} = ${total.toFixed(2)} บาท`
    };
}

export default function MeterCalculator() {
    const [settings, setSettings] = useState<CalcSettings>(loadSettings);
    const [showSettings, setShowSettings] = useState(false);
    const [settingsSaved, setSettingsSaved] = useState(false);

    // Electricity
    const [elecPrev, setElecPrev] = useState('');
    const [elecCurr, setElecCurr] = useState('');

    // Water
    const [waterPrev, setWaterPrev] = useState('');
    const [waterCurr, setWaterCurr] = useState('');

    const elecUnits = Math.max(0, Number(elecCurr) - Number(elecPrev));
    const elecBill = elecPrev !== '' && elecCurr !== '' ? elecUnits * settings.elec_rate : null;

    const waterUnits = Math.max(0, Number(waterCurr) - Number(waterPrev));
    const waterResult = waterPrev !== '' && waterCurr !== '' ? calcWater(waterUnits, settings) : null;

    const handleSettingChange = (field: keyof CalcSettings, value: string | number) => {
        setSettings(prev => ({ ...prev, [field]: value }));
        setSettingsSaved(false);
    };

    const handleSaveSettings = () => {
        saveSettings(settings);
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 2000);
    };

    const handleReset = () => {
        setElecPrev(''); setElecCurr('');
        setWaterPrev(''); setWaterCurr('');
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Calculator size={28} /> คำนวณมิเตอร์</h1>
                <p className="page-subtitle">คำนวณค่าไฟ-ค่าน้ำเร็วๆ — ไม่เกี่ยวกับข้อมูลห้องในระบบ</p>
            </div>

            {/* Settings Collapsible */}
            <div className="card mb-6" style={{ marginBottom: '1.5rem' }}>
                <button
                    onClick={() => setShowSettings(!showSettings)}
                    style={{
                        width: '100%',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '1rem 1.25rem',
                        fontWeight: 600,
                        fontSize: '1rem',
                        color: 'var(--color-gray-800)',
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <SettingsIcon size={18} color="#6366F1" />
                        ตั้งค่าอัตรา
                    </span>
                    {showSettings ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>

                {showSettings && (
                    <div style={{ padding: '0 1.25rem 1.25rem' }}>
                        <div style={{ borderTop: '1px solid var(--color-gray-200)', paddingTop: '1rem' }}>

                            {/* Electricity Rate */}
                            <div className="form-group">
                                <label className="form-label">
                                    <Zap size={14} color="#F59E0B" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                    ค่าไฟฟ้า (บาท/หน่วย)
                                </label>
                                <input
                                    type="number"
                                    className="form-input mono"
                                    style={{ maxWidth: '160px', padding: '0.625rem 0.875rem' }}
                                    value={settings.elec_rate}
                                    min={0}
                                    step={0.5}
                                    onChange={e => handleSettingChange('elec_rate', e.target.value)}
                                />
                            </div>

                            {/* Water Mode */}
                            <div className="form-group">
                                <label className="form-label">
                                    <Droplets size={14} color="#2563EB" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                    รูปแบบคิดค่าน้ำ
                                </label>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <button
                                        className={`btn ${settings.water_mode === 'normal' ? 'btn-primary' : 'btn-outline'}`}
                                        onClick={() => handleSettingChange('water_mode', 'normal')}
                                        style={{ flex: 1, minWidth: '130px', padding: '0.625rem 0.875rem', fontSize: '0.875rem' }}
                                    >
                                        <BarChart3 size={16} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }} /> บาท/หน่วย
                                    </button>
                                    <button
                                        className={`btn ${settings.water_mode === 'flat_rate_tier' ? 'btn-primary' : 'btn-outline'}`}
                                        onClick={() => handleSettingChange('water_mode', 'flat_rate_tier')}
                                        style={{ flex: 1, minWidth: '130px', padding: '0.625rem 0.875rem', fontSize: '0.875rem' }}
                                    >
                                        <Droplets size={16} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }} /> เหมาจ่าย+ส่วนเกิน
                                    </button>
                                </div>
                            </div>

                            {settings.water_mode === 'normal' ? (
                                <div className="form-group">
                                    <label className="form-label">ราคาน้ำต่อหน่วย (บาท)</label>
                                    <input
                                        type="number"
                                        className="form-input mono"
                                        style={{ maxWidth: '160px', padding: '0.625rem 0.875rem' }}
                                        value={settings.water_unit_rate}
                                        min={0}
                                        step={0.5}
                                        onChange={e => handleSettingChange('water_unit_rate', e.target.value)}
                                    />
                                </div>
                            ) : (
                                <div className="settings-grid">
                                    <div className="form-group">
                                        <label className="form-label">ราคาเหมา (บาท)</label>
                                        <input
                                            type="number"
                                            className="form-input mono"
                                            style={{ padding: '0.625rem 0.875rem' }}
                                            value={settings.water_flat_price}
                                            min={0}
                                            onChange={e => handleSettingChange('water_flat_price', e.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">หน่วยในเหมา</label>
                                        <input
                                            type="number"
                                            className="form-input mono"
                                            style={{ padding: '0.625rem 0.875rem' }}
                                            value={settings.water_flat_limit}
                                            min={0}
                                            onChange={e => handleSettingChange('water_flat_limit', e.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">ราคาส่วนเกิน (บาท/หน่วย)</label>
                                        <input
                                            type="number"
                                            className="form-input mono"
                                            style={{ padding: '0.625rem 0.875rem' }}
                                            value={settings.water_excess_rate}
                                            min={0}
                                            step={0.5}
                                            onChange={e => handleSettingChange('water_excess_rate', e.target.value)}
                                        />
                                    </div>
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleSaveSettings}
                                    style={{ padding: '0.625rem 1.5rem', fontSize: '0.9375rem' }}
                                >
                                    <Save size={18} style={{ display: 'inline', marginRight: 4 }} /> บันทึกอัตรา
                                </button>
                                {settingsSaved && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--color-success)', fontWeight: 600, alignSelf: 'center', fontSize: '0.875rem' }}>
                                        <Check size={14} /> บันทึกแล้ว!
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Calculators */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>

                {/* Electricity Calculator */}
                <div className="card">
                    <div className="card-header">
                        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Zap size={20} color="#F59E0B" />
                            ค่าไฟฟ้า
                        </span>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--color-gray-400)' }}>
                            {settings.elec_rate} บาท/หน่วย
                        </span>
                    </div>
                    <div style={{ padding: '1.25rem', paddingTop: '0.75rem' }}>
                        <div className="settings-grid" style={{ marginBottom: '1rem' }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">มิเตอร์ก่อน</label>
                                <input
                                    type="number"
                                    className="form-input mono"
                                    style={{ padding: '0.75rem 1rem', fontSize: '1.05rem' }}
                                    placeholder="0"
                                    value={elecPrev}
                                    min={0}
                                    onChange={e => setElecPrev(e.target.value)}
                                />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">มิเตอร์หลัง</label>
                                <input
                                    type="number"
                                    className="form-input mono"
                                    style={{ padding: '0.75rem 1rem', fontSize: '1.05rem' }}
                                    placeholder="0"
                                    value={elecCurr}
                                    min={0}
                                    onChange={e => setElecCurr(e.target.value)}
                                />
                            </div>
                        </div>

                        {elecBill !== null && (
                            <div style={{
                                background: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
                                border: '1px solid #FDE68A',
                                borderRadius: '10px',
                                padding: '1rem',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                    <span style={{ fontSize: '0.875rem', color: '#92400E' }}>หน่วยที่ใช้</span>
                                    <span className="mono" style={{ fontWeight: 700, fontSize: '1.1rem', color: '#92400E' }}>{elecUnits} หน่วย</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.875rem', color: '#92400E' }}>ค่าไฟฟ้า</span>
                                    <span className="mono" style={{ fontWeight: 700, fontSize: '1.5rem', color: '#D97706' }}>
                                        {elecBill.toFixed(2)} บาท
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: '#B45309', marginTop: '0.5rem', opacity: 0.8 }}>
                                    {elecUnits} × {settings.elec_rate} บาท/หน่วย
                                </div>
                            </div>
                        )}
                        {elecBill === null && (
                            <div style={{
                                background: 'var(--color-gray-50)',
                                borderRadius: '10px',
                                padding: '1rem',
                                textAlign: 'center',
                                color: 'var(--color-gray-400)',
                                fontSize: '0.875rem'
                            }}>
                                กรอกมิเตอร์ก่อน-หลังเพื่อดูผล
                            </div>
                        )}
                    </div>
                </div>

                {/* Water Calculator */}
                <div className="card">
                    <div className="card-header">
                        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Droplets size={20} color="#2563EB" />
                            ค่าน้ำประปา
                        </span>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--color-gray-400)' }}>
                            {settings.water_mode === 'normal' ? `${settings.water_unit_rate} บาท/หน่วย` : 'เหมาจ่าย'}
                        </span>
                    </div>
                    <div style={{ padding: '1.25rem', paddingTop: '0.75rem' }}>
                        <div className="settings-grid" style={{ marginBottom: '1rem' }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">มิเตอร์ก่อน</label>
                                <input
                                    type="number"
                                    className="form-input mono"
                                    style={{ padding: '0.75rem 1rem', fontSize: '1.05rem' }}
                                    placeholder="0"
                                    value={waterPrev}
                                    min={0}
                                    onChange={e => setWaterPrev(e.target.value)}
                                />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">มิเตอร์หลัง</label>
                                <input
                                    type="number"
                                    className="form-input mono"
                                    style={{ padding: '0.75rem 1rem', fontSize: '1.05rem' }}
                                    placeholder="0"
                                    value={waterCurr}
                                    min={0}
                                    onChange={e => setWaterCurr(e.target.value)}
                                />
                            </div>
                        </div>

                        {waterResult !== null && (
                            <div style={{
                                background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
                                border: '1px solid #BFDBFE',
                                borderRadius: '10px',
                                padding: '1rem',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                    <span style={{ fontSize: '0.875rem', color: '#1E3A8A' }}>หน่วยที่ใช้</span>
                                    <span className="mono" style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1E3A8A' }}>{waterUnits} หน่วย</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.875rem', color: '#1E3A8A' }}>ค่าน้ำ</span>
                                    <span className="mono" style={{ fontWeight: 700, fontSize: '1.5rem', color: '#2563EB' }}>
                                        {waterResult.bill.toFixed(2)} บาท
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: '#1D4ED8', marginTop: '0.5rem', opacity: 0.8, lineHeight: 1.5 }}>
                                    {waterResult.detail}
                                </div>
                            </div>
                        )}
                        {waterResult === null && (
                            <div style={{
                                background: 'var(--color-gray-50)',
                                borderRadius: '10px',
                                padding: '1rem',
                                textAlign: 'center',
                                color: 'var(--color-gray-400)',
                                fontSize: '0.875rem'
                            }}>
                                กรอกมิเตอร์ก่อน-หลังเพื่อดูผล
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Summary total (only when both are filled) */}
            {elecBill !== null && waterResult !== null && (
                <div className="card" style={{
                    background: 'linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)',
                    border: '1px solid #C4B5FD',
                }}>
                    <div style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#4C1D95', marginBottom: '0.25rem' }}>
                                <Banknote size={18} style={{ display: 'inline', marginRight: 4 }} /> ยอดรวมทั้งหมด
                            </div>
                            <div style={{ fontSize: '0.8125rem', color: '#7C3AED', opacity: 0.8 }}>
                                ค่าไฟ {elecBill.toFixed(2)} + ค่าน้ำ {waterResult.bill.toFixed(2)}
                            </div>
                        </div>
                        <div className="mono" style={{ fontWeight: 800, fontSize: '2rem', color: '#7C3AED' }}>
                            {(elecBill + waterResult.bill).toFixed(2)} บาท
                        </div>
                    </div>
                </div>
            )}

            {/* Reset Button */}
            <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                <button
                    className="btn btn-outline"
                    onClick={handleReset}
                    style={{ padding: '0.625rem 1.5rem', fontSize: '0.9375rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    <RotateCcw size={16} />
                    ล้างค่าทั้งหมด
                </button>
            </div>
        </div>
    );
}
