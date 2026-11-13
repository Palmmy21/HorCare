import { useEffect, useMemo, useState } from 'react';
import {
    X, Check, Home, Building2, Store, Zap, Droplets, Globe, Sparkles, Receipt, Users, Minus, Plus,
    MessageCircle, Link2Off, Loader2, Gauge, Wallet,
} from 'lucide-react';
import type { Room, DormConfig, CommonFee, BillLanguage } from '../../types';
import { BUILTIN_AMENITIES, amenityLabel } from '../../utils/amenities';
import { LANGUAGE_OPTIONS, LANGUAGE_MAP } from '../../utils/i18n/billTranslations';
import { getWorkspaceTerms, rentTypeOptions } from '../../utils/workspaceTerminology';

interface RoomEditModalProps {
    room: Room;
    rooms: Room[];
    config: DormConfig;
    commonFees: CommonFee[];
    onSave: (roomId: string, updates: Partial<Room>) => Promise<void>;
    onUnlinkLine: (roomId: string) => Promise<void> | void;
    onClose: () => void;
}

type FeeOverrides = Record<string, { amount?: number; is_active?: boolean }>;

/** The whole room on one sheet: every field labelled, big targets, save once. */
export default function RoomEditModal({ room, rooms, config, commonFees, onSave, onUnlinkLine, onClose }: RoomEditModalProps) {
    const terms = getWorkspaceTerms(config?.building_type);
    const [roomNumber, setRoomNumber] = useState(room.room_number);
    const [rentAmount, setRentAmount] = useState(String(room.rent_amount ?? 0));
    const [rentType, setRentType] = useState<Room['rent_type']>(room.rent_type || 'monthly');
    const [roomType, setRoomType] = useState<'dormitory' | 'commercial'>(room.room_type || 'dormitory');
    const [tenantCount, setTenantCount] = useState(room.tenant_count || 1);
    const [zone, setZone] = useState(room.zone || '');
    const [stallSize, setStallSize] = useState(room.stall_size || '');
    const [businessType, setBusinessType] = useState(room.business_type || '');
    const [elecRate, setElecRate] = useState(room.custom_electricity_rate?.toString() || '');
    const [waterRate, setWaterRate] = useState(
        room.custom_water_config?.type === 'normal' ? String(room.custom_water_config.unit_rate || 0) : '',
    );
    const [feeOverrides, setFeeOverrides] = useState<FeeOverrides>(room.common_fee_overrides || {});
    const [language, setLanguage] = useState<BillLanguage | ''>(room.language || '');
    const [amenities, setAmenities] = useState<string[]>(room.amenities || []);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [confirmUnlink, setConfirmUnlink] = useState(false);

    const trimmedNumber = roomNumber.trim();
    const duplicate = trimmedNumber !== room.room_number && rooms.some(r => r.id !== room.id && r.room_number === trimmedNumber);
    const canSave = !!trimmedNumber && !duplicate && !saving;

    const amenityKeys = useMemo(() => {
        const custom = config.custom_amenities ?? [];
        const extra = amenities.filter(a => !BUILTIN_AMENITIES.some(b => b.id === a) && !custom.includes(a));
        return [...BUILTIN_AMENITIES.map(a => a.id), ...custom, ...extra];
    }, [config.custom_amenities, amenities]);

    const activeFees = commonFees.filter(f => f.is_active);
    const defaultLang = LANGUAGE_MAP[config.bill_customization?.default_language || 'th'];

    const save = async () => {
        if (!canSave) return;
        const updates: Partial<Room> = {
            room_number: trimmedNumber,
            rent_amount: Number(rentAmount) || 0,
            rent_type: rentType,
            room_type: roomType,
            tenant_count: tenantCount || 1,
            zone: zone.trim() || undefined,
            stall_size: stallSize.trim() || undefined,
            business_type: businessType.trim() || undefined,
            custom_electricity_rate: elecRate.trim() && !isNaN(Number(elecRate)) ? Number(elecRate) : null,
            custom_water_config: waterRate.trim() && !isNaN(Number(waterRate))
                ? { type: 'normal', unit_rate: Number(waterRate) }
                : null,
            common_fee_overrides: feeOverrides,
            language: language ? (language as BillLanguage) : undefined,
            amenities,
        };
        setSaving(true);
        setError('');
        try {
            await onSave(room.id, updates);
            onClose();
        } catch (e) {
            console.error('Error updating room:', e);
            setError('บันทึกไม่สำเร็จ กรุณาลองใหม่');
            setSaving(false);
        }
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !saving) onClose();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    const isCommercial = roomType === 'commercial';
    const showRates = isCommercial || !!elecRate || !!waterRate;

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
            <div className="modal re-modal" role="dialog" aria-modal="true" aria-labelledby="re-title">
                {/* Head: which room, at a glance */}
                <div className="re-head">
                    <div className="re-head-id">
                        <span className="re-head-icon" aria-hidden>
                            {terms.isMarket ? <Store size={20} /> : isCommercial ? <Building2 size={20} /> : <Home size={20} />}
                        </span>
                        <div style={{ minWidth: 0 }}>
                            <div className="re-head-caption">แก้ไขข้อมูล{terms.unitName}</div>
                            <h2 id="re-title" className="re-head-title">{trimmedNumber || room.room_number}</h2>
                        </div>
                    </div>
                    <div className="re-head-tags">
                        {room.line_user_id
                            ? <span className="badge badge-success"><MessageCircle size={12} /> เชื่อม LINE แล้ว</span>
                            : <span className="badge badge-gray">ยังไม่เชื่อม LINE</span>}
                    </div>
                    <button className="re-close" onClick={onClose} disabled={saving} aria-label="ปิด"><X size={20} /></button>
                </div>

                <div className="re-body">
                    {/* Basics */}
                    <section className="re-section">
                        <h3 className="re-section-title"><Home size={16} /> ข้อมูลพื้นฐาน</h3>
                        <div className="re-grid">
                            <label className="re-field">
                                <span className="re-label">{terms.unitNumberLabel}</span>
                                <input
                                    className={`form-input re-input-lg ${duplicate ? 'is-invalid' : ''}`}
                                    value={roomNumber}
                                    onChange={e => setRoomNumber(e.target.value)}
                                    placeholder={terms.unitPlaceholder}
                                    autoFocus
                                />
                                {duplicate && <span className="re-error">มี{terms.unitName}นี้อยู่แล้ว</span>}
                                {!trimmedNumber && <span className="re-error">กรอก{terms.unitNumberLabel}</span>}
                            </label>
                            <div className="re-field">
                                <span className="re-label">{terms.tenantLabel}</span>
                                <div className="re-stepper">
                                    <button type="button" onClick={() => setTenantCount(c => Math.max(1, c - 1))} disabled={tenantCount <= 1} aria-label="ลด"><Minus size={18} /></button>
                                    <input
                                        type="number" min={1} inputMode="numeric" className="tnum"
                                        value={tenantCount}
                                        onChange={e => setTenantCount(Math.max(1, Number(e.target.value) || 1))}
                                        aria-label={terms.tenantLabel}
                                    />
                                    <button type="button" onClick={() => setTenantCount(c => c + 1)} aria-label="เพิ่ม"><Plus size={18} /></button>
                                    <span className="re-stepper-unit"><Users size={14} /> {terms.isMarket ? 'ร้าน' : 'คน'}</span>
                                </div>
                            </div>
                        </div>

                        {!terms.isMarket && (
                            <div className="re-field">
                                <span className="re-label">ประเภทห้อง</span>
                                <div className="re-choice-row">
                                    <ChoiceCard active={roomType === 'dormitory'} onClick={() => setRoomType('dormitory')}
                                        icon={<Home size={18} />} title="หอพัก" sub="ใช้อัตราน้ำ/ไฟตามที่ตั้งไว้" />
                                    <ChoiceCard active={roomType === 'commercial'} onClick={() => setRoomType('commercial')}
                                        icon={<Building2 size={18} />} title="พาณิชย์" sub="ตั้งค่าน้ำ/ไฟเฉพาะห้องได้" />
                                </div>
                            </div>
                        )}

                        {terms.isMarket && (
                            <div className="re-grid re-grid-3">
                                <label className="re-field">
                                    <span className="re-label">โซน</span>
                                    <input className="form-input" value={zone} onChange={e => setZone(e.target.value)} placeholder="เช่น โซน A" />
                                </label>
                                <label className="re-field">
                                    <span className="re-label">ขนาดแผง</span>
                                    <input className="form-input" value={stallSize} onChange={e => setStallSize(e.target.value)} placeholder="เช่น 2x2 ม." />
                                </label>
                                <label className="re-field">
                                    <span className="re-label">ชื่อร้าน / สินค้า</span>
                                    <input className="form-input" value={businessType} onChange={e => setBusinessType(e.target.value)} placeholder="เช่น ผลไม้" />
                                </label>
                            </div>
                        )}
                    </section>

                    {/* Rent */}
                    <section className="re-section">
                        <h3 className="re-section-title"><Wallet size={16} /> {terms.rentLabel}</h3>
                        <div className="re-grid">
                            <label className="re-field">
                                <span className="re-label">จำนวนเงิน</span>
                                <div className="re-money">
                                    <span aria-hidden>฿</span>
                                    <input
                                        type="number" min={0} inputMode="decimal" className="tnum"
                                        value={rentAmount}
                                        onChange={e => setRentAmount(e.target.value)}
                                        onFocus={e => e.target.select()}
                                        placeholder="0"
                                    />
                                </div>
                            </label>
                            <div className="re-field">
                                <span className="re-label">เก็บเงินแบบ</span>
                                <div className="re-chips">
                                    {rentTypeOptions(config?.building_type).map(o => (
                                        <button key={o.value} type="button" aria-pressed={rentType === o.value}
                                            className={`re-chip ${rentType === o.value ? 'is-on' : ''}`}
                                            onClick={() => setRentType(o.value as Room['rent_type'])}>
                                            {rentType === o.value && <Check size={14} />} {o.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Meters + per-room rates */}
                    {terms.usesMeters && (
                        <section className="re-section">
                            <h3 className="re-section-title"><Gauge size={16} /> มิเตอร์และค่าน้ำ/ไฟ</h3>
                            <div className="re-meters">
                                <div className="re-meter">
                                    <Zap size={16} className="re-ic-elec" />
                                    <div>
                                        <div className="re-meter-label">มิเตอร์ไฟล่าสุด</div>
                                        <div className="re-meter-value tnum">{(room.current_meter_elec ?? 0).toLocaleString()}</div>
                                    </div>
                                </div>
                                <div className="re-meter">
                                    <Droplets size={16} className="re-ic-water" />
                                    <div>
                                        <div className="re-meter-label">มิเตอร์น้ำล่าสุด</div>
                                        <div className="re-meter-value tnum">{(room.current_meter_water ?? 0).toLocaleString()}</div>
                                    </div>
                                </div>
                            </div>
                            <p className="re-hint">ตัวเลขมิเตอร์แก้ได้ที่หน้า "จดมิเตอร์"</p>

                            {showRates ? (
                                <div className="re-grid" style={{ marginTop: 'var(--space-3)' }}>
                                    <label className="re-field">
                                        <span className="re-label"><Zap size={14} className="re-ic-elec" /> ค่าไฟเฉพาะ{terms.unitName}นี้</span>
                                        <div className="re-money re-money-sm">
                                            <input type="number" min={0} inputMode="decimal" className="tnum" value={elecRate}
                                                onChange={e => setElecRate(e.target.value)} placeholder={`${config.electricity_rate} (ค่าเริ่มต้น)`} />
                                            <span aria-hidden>บ./หน่วย</span>
                                        </div>
                                    </label>
                                    <label className="re-field">
                                        <span className="re-label"><Droplets size={14} className="re-ic-water" /> ค่าน้ำเฉพาะ{terms.unitName}นี้</span>
                                        <div className="re-money re-money-sm">
                                            <input type="number" min={0} inputMode="decimal" className="tnum" value={waterRate}
                                                onChange={e => setWaterRate(e.target.value)} placeholder="ใช้ค่าเริ่มต้น" />
                                            <span aria-hidden>บ./หน่วย</span>
                                        </div>
                                    </label>
                                </div>
                            ) : (
                                <p className="re-hint">{terms.unitName}หอพักใช้อัตราน้ำ/ไฟตามที่ตั้งไว้ในการตั้งค่า — เลือก "พาณิชย์" เพื่อตั้งอัตราเฉพาะ</p>
                            )}
                        </section>
                    )}

                    {/* Common fees */}
                    {activeFees.length > 0 && (
                        <section className="re-section">
                            <h3 className="re-section-title"><Receipt size={16} /> ค่าบริการส่วนกลาง</h3>
                            <div className="re-fees">
                                {activeFees.map(fee => {
                                    const o = feeOverrides[fee.id] || {};
                                    const on = o.is_active ?? fee.is_active;
                                    const amount = o.amount ?? fee.amount;
                                    return (
                                        <div key={fee.id} className={`re-fee ${on ? '' : 'is-off'}`}>
                                            <button type="button" role="switch" aria-checked={on} className={`re-switch ${on ? 'is-on' : ''}`}
                                                onClick={() => setFeeOverrides(p => ({ ...p, [fee.id]: { ...p[fee.id], is_active: !on } }))}
                                                aria-label={`เก็บ${fee.name}`}>
                                                <span />
                                            </button>
                                            <span className="re-fee-name">{fee.name}</span>
                                            <div className="re-money re-money-sm re-fee-amount">
                                                <input type="number" min={0} inputMode="decimal" className="tnum" disabled={!on} value={amount}
                                                    onChange={e => setFeeOverrides(p => ({ ...p, [fee.id]: { ...p[fee.id], amount: Number(e.target.value) } }))}
                                                    aria-label={`จำนวนเงิน ${fee.name}`} />
                                                <span aria-hidden>บ.</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    {/* Amenities */}
                    <section className="re-section">
                        <h3 className="re-section-title"><Sparkles size={16} /> สิ่งอำนวยความสะดวก</h3>
                        <div className="re-chips">
                            {amenityKeys.map(key => {
                                const on = amenities.includes(key);
                                return (
                                    <button key={key} type="button" aria-pressed={on} className={`re-chip ${on ? 'is-on' : ''}`}
                                        onClick={() => setAmenities(p => on ? p.filter(x => x !== key) : [...p, key])}>
                                        {on && <Check size={14} />} {amenityLabel(key)}
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    {/* Language */}
                    <section className="re-section">
                        <h3 className="re-section-title"><Globe size={16} /> ภาษาบิลและการแจ้งเตือน</h3>
                        <div className="re-chips">
                            <button type="button" aria-pressed={language === ''} className={`re-chip ${language === '' ? 'is-on' : ''}`} onClick={() => setLanguage('')}>
                                {language === '' && <Check size={14} />} ค่าเริ่มต้น ({defaultLang?.flag} {defaultLang?.nativeName})
                            </button>
                            {LANGUAGE_OPTIONS.map(opt => (
                                <button key={opt.code} type="button" aria-pressed={language === opt.code}
                                    className={`re-chip ${language === opt.code ? 'is-on' : ''}`} onClick={() => setLanguage(opt.code)}>
                                    <span aria-hidden>{opt.flag}</span> {opt.nativeName}
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* LINE */}
                    {room.line_user_id && (
                        <section className="re-section re-line">
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="re-line-title"><MessageCircle size={16} /> เชื่อมต่อ LINE อยู่</div>
                                <div className="re-hint" style={{ margin: 0 }}>ผู้เช่าได้รับบิลและแจ้งเตือนทาง LINE</div>
                            </div>
                            {confirmUnlink ? (
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <button className="btn btn-secondary btn-sm" onClick={() => setConfirmUnlink(false)}>ไม่ใช่</button>
                                    <button className="btn btn-danger btn-sm" onClick={async () => { await onUnlinkLine(room.id); onClose(); }}>ยืนยันยกเลิกการเชื่อม</button>
                                </div>
                            ) : (
                                <button className="btn btn-outline btn-sm re-unlink" onClick={() => setConfirmUnlink(true)}>
                                    <Link2Off size={15} /> ยกเลิกการเชื่อม
                                </button>
                            )}
                        </section>
                    )}
                </div>

                <div className="modal-footer re-foot">
                    {error && <span className="re-error" style={{ marginRight: 'auto' }}>{error}</span>}
                    <button className="btn btn-secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
                    <button className="btn btn-primary" onClick={() => void save()} disabled={!canSave}>
                        {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />} บันทึก
                    </button>
                </div>
            </div>
        </div>
    );
}

function ChoiceCard({ active, onClick, icon, title, sub }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; sub: string }) {
    return (
        <button type="button" aria-pressed={active} className={`re-choice ${active ? 'is-on' : ''}`} onClick={onClick}>
            <span className="re-choice-icon">{icon}</span>
            <span style={{ minWidth: 0 }}>
                <span className="re-choice-title">{title}</span>
                <span className="re-choice-sub">{sub}</span>
            </span>
            {active && <Check size={16} className="re-choice-check" />}
        </button>
    );
}
