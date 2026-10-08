import React, { useState } from 'react';
import {
  Building2, Building, Home, Hotel, Store,
  Zap, DollarSign, X, Plus
} from 'lucide-react';
import type { DormConfig, WaterConfig, BillLanguage, CollectionStyle } from '../../types';
import './AddBuildingModal.css';

import { getWorkspaceTerms, defaultCollectionStyle, DEFAULT_MARKET_ZONES } from '../../utils/workspaceTerminology';
import { errorInfo } from '../../shared/errorInfo';

interface AddBuildingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, initialConfig: Partial<DormConfig>) => Promise<void>;
}

type BuildingTypeOption = {
  type: DormConfig['building_type'];
  label: string;
  icon: React.ReactNode;
};

const BUILDING_TYPES: BuildingTypeOption[] = [
  { type: 'dormitory', label: 'หอพัก', icon: <Building2 size={20} /> },
  { type: 'market', label: 'ตลาด / แผงค้า', icon: <Store size={20} /> },
  { type: 'commercial', label: 'อาคารพาณิชย์', icon: <Building size={20} /> },
  { type: 'apartment', label: 'อพาร์ตเมนต์', icon: <Building size={20} /> },
  { type: 'condo', label: 'คอนโดมิเนียม', icon: <Building size={20} /> },
  { type: 'house', label: 'บ้านเช่า / ทาวน์โฮม', icon: <Home size={20} /> },
  { type: 'resort', label: 'รีสอร์ท / โรงแรม', icon: <Hotel size={20} /> },
];

const COLLECTION_STYLES: { style: CollectionStyle; label: string; hint: string; unit: string; startRent: number }[] = [
  { style: 'monthly', label: 'รายเดือน', hint: 'ออกบิลค่าเช่า + ค่าน้ำไฟทุกเดือน', unit: 'บาท/เดือน', startRent: 3500 },
  { style: 'nightly', label: 'รายวัน (ต่อคืน)', hint: 'จองห้อง เช็คอิน/เช็คเอาต์ คิดเงินตามจำนวนคืน', unit: 'บาท/คืน', startRent: 800 },
  { style: 'stall', label: 'แผงค้า รายสัปดาห์/วัน', hint: 'เก็บล่วงหน้ารายสัปดาห์ หรือรายวันตามที่ร้านมาจริง', unit: 'บาท/วัน', startRent: 100 },
];

export default function AddBuildingModal({ isOpen, onClose, onAdd }: AddBuildingModalProps) {
  const [name, setName] = useState('');
  const [buildingType, setBuildingType] = useState<DormConfig['building_type']>('dormitory');
  const [elecRate, setElecRate] = useState<number>(8);
  const [waterMode, setWaterMode] = useState<'normal' | 'flat'>('normal');
  const [waterUnitRate, setWaterUnitRate] = useState<number>(18);
  const [waterFlatRate, setWaterFlatRate] = useState<number>(100);
  const [collectionStyle, setCollectionStyle] = useState<CollectionStyle>('monthly');
  const [roomRent, setRoomRent] = useState<number>(3500);
  const [dueDay, setDueDay] = useState<number>(5);
  const [defaultLang, setDefaultLang] = useState<BillLanguage>('th');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const terms = getWorkspaceTerms(buildingType);
  const styleInfo = COLLECTION_STYLES.find(s => s.style === collectionStyle) ?? COLLECTION_STYLES[0];

  const pickStyle = (style: CollectionStyle) => {
    setCollectionStyle(style);
    setRoomRent(COLLECTION_STYLES.find(s => s.style === style)?.startRent ?? 3500);
  };
  // Picking a building type switches the collection style (and its starting rate); the owner can still change it.
  const pickType = (type: DormConfig['building_type']) => {
    setBuildingType(type);
    pickStyle(defaultCollectionStyle(type));
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(`กรุณากรอก${terms.facilityNameLabel}`);
      return;
    }
    setError('');
    setLoading(true);

    try {
      const water_config: WaterConfig = waterMode === 'normal'
        ? { type: 'normal', unit_rate: Number(waterUnitRate) || 18 }
        : { type: 'flat_rate_tier', flat_price: Number(waterFlatRate) || 100, flat_limit_unit: 0, excess_unit_rate: Number(waterUnitRate) || 18 };

      const initialConfig: Partial<DormConfig> = {
        building_type: buildingType,
        collection_style: collectionStyle,
        electricity_rate: Number(elecRate) || 8,
        water_config,
        room_rent: Number(roomRent) || 3500,
        bill_customization: {
          dorm_name: name.trim(),
          dorm_address: '',
          dorm_phone: '',
          footer_text: 'กรุณาชำระภายในวันที่กำหนด ขอบคุณครับ',
          due_day: Number(dueDay) || 5,
          default_language: defaultLang,
          bilingual_mode: false,
          secondary_language: 'en',
        },
        market_config: buildingType === 'market' ? {
          default_rent_cycle: collectionStyle === 'monthly' ? 'monthly' : 'weekly',
          default_stall_size: '2x2 ม.',
          waste_fee_per_stall: 20,
          waste_fee_cycle: 'daily',
          electricity_flat_fee: 30,
          table_rental_fee: 50,
          zones: DEFAULT_MARKET_ZONES,
        } : undefined,
      };

      await onAdd(name.trim(), initialConfig);
      // Reset form
      setName('');
      setElecRate(8);
      setWaterUnitRate(18);
      setRoomRent(3500);
      onClose();
    } catch (errRaw) {
        const err = errorInfo(errRaw);
      setError(err?.message || 'เกิดข้อผิดพลาดในการสร้างสาขา');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="add-building-overlay" onClick={onClose}>
      <div className="add-building-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="add-building-header">
          <div className="add-building-title-group">
            <div className="add-building-icon-badge">
              <Building2 size={24} />
            </div>
            <div>
              <h2>เพิ่มสาขา / ตึกใหม่</h2>
              <p>กรอกข้อมูลเบื้องต้นเพื่อเริ่มต้นใช้งานสาขานี้</p>
            </div>
          </div>
          <button className="add-building-close-btn" onClick={onClose} aria-label="ปิด">
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div className="add-building-body">
            {error && (
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                padding: '0.75rem 1rem',
                borderRadius: '12px',
                fontSize: '0.875rem',
                fontWeight: 600,
              }}>
                {error}
              </div>
            )}

            {/* Section 1: ข้อมูลสาขา */}
            <div>
              <div className="ab-section-title">
                <Building2 size={18} />
                <span>ข้อมูลสาขา</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                <div className="ab-field">
                  <label className="ab-label">
                    <span>{terms.facilityNameLabel} <span className="req">*</span></span>
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder={buildingType === 'market' ? 'เช่น ตลาดสดรวยทรัพย์, ตลาดไนท์บาร์ซาร์' : 'เช่น HorCare สุขุมวิท, Living LifeSV 2'}
                    className="ab-input"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>

                <div className="ab-field">
                  <label className="ab-label">ประเภทอาคาร</label>
                  <div className="ab-type-grid">
                    {BUILDING_TYPES.map(item => (
                      <button
                        key={item.type}
                        type="button"
                        className={`ab-type-card ${buildingType === item.type ? 'selected' : ''}`}
                        onClick={() => pickType(item.type)}
                      >
                        <div className="icon-wrap">{item.icon}</div>
                        <span className="name">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ab-field">
                  <label className="ab-label">รูปแบบการเก็บเงิน</label>
                  <div className="ab-segmented">
                    {COLLECTION_STYLES.map(s => (
                      <button
                        key={s.style}
                        type="button"
                        className={`ab-segmented-btn ${collectionStyle === s.style ? 'active' : ''}`}
                        onClick={() => pickStyle(s.style)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: 6 }}>{styleInfo.hint}</span>
                </div>
              </div>
            </div>

            {/* Section 2: ค่าน้ำ - ค่าไฟ */}
            <div>
              <div className="ab-section-title">
                <Zap size={18} />
                <span>อัตราค่าน้ำ - ค่าไฟเริ่มต้น</span>
              </div>
              <div className="ab-row-2">
                <div className="ab-field">
                  <label className="ab-label">
                    <span>ค่าไฟ (บาท / หน่วย)</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      className="ab-input"
                      value={elecRate}
                      onChange={e => setElecRate(parseFloat(e.target.value) || 0)}
                      placeholder="8"
                    />
                    <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8125rem', color: '#94a3b8' }}>
                      ฿/หน่วย
                    </span>
                  </div>
                </div>

                <div className="ab-field">
                  <label className="ab-label">
                    <span>รูปแบบค่าน้ำ</span>
                  </label>
                  <div className="ab-segmented">
                    <button
                      type="button"
                      className={`ab-segmented-btn ${waterMode === 'normal' ? 'active' : ''}`}
                      onClick={() => setWaterMode('normal')}
                    >
                      ตามมิเตอร์
                    </button>
                    <button
                      type="button"
                      className={`ab-segmented-btn ${waterMode === 'flat' ? 'active' : ''}`}
                      onClick={() => setWaterMode('flat')}
                    >
                      เหมาจ่าย
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '0.75rem' }}>
                {waterMode === 'normal' ? (
                  <div className="ab-field">
                    <label className="ab-label">
                      <span>ค่าน้ำตามมิเตอร์ (บาท / หน่วย)</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        className="ab-input"
                        value={waterUnitRate}
                        onChange={e => setWaterUnitRate(parseFloat(e.target.value) || 0)}
                        placeholder="18"
                      />
                      <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8125rem', color: '#94a3b8' }}>
                        ฿/หน่วย
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="ab-field">
                    <label className="ab-label">
                      <span>ค่าน้ำเหมาจ่าย (บาท / ห้อง / เดือน)</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="number"
                        step="10"
                        min="0"
                        className="ab-input"
                        value={waterFlatRate}
                        onChange={e => setWaterFlatRate(parseFloat(e.target.value) || 0)}
                        placeholder="100"
                      />
                      <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8125rem', color: '#94a3b8' }}>
                        ฿/เดือน
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Section 3: ค่าเช่า & บิล */}
            <div>
              <div className="ab-section-title">
                <DollarSign size={18} />
                <span>ค่าเช่าและกำหนดชำระบิล</span>
              </div>
              <div className="ab-row-2">
                <div className="ab-field">
                  <label className="ab-label">
                    <span>{collectionStyle === 'nightly' ? 'ราคาห้องเฉลี่ย' : collectionStyle === 'stall' ? 'ค่าเช่าแผงเฉลี่ย' : `${terms.rentLabel}เฉลี่ย`} ({styleInfo.unit})</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      step="100"
                      min="0"
                      className="ab-input"
                      value={roomRent}
                      onChange={e => setRoomRent(parseFloat(e.target.value) || 0)}
                      placeholder="3500"
                    />
                    <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8125rem', color: '#94a3b8' }}>
                      ฿/{styleInfo.unit.split('/')[1]}
                    </span>
                  </div>
                </div>

                {collectionStyle === 'monthly' && <div className="ab-field">
                  <label className="ab-label">
                    <span>กำหนดชำระทุกวันที่</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      className="ab-input"
                      value={dueDay}
                      onChange={e => setDueDay(parseInt(e.target.value, 10) || 5)}
                      placeholder="5"
                    />
                    <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8125rem', color: '#94a3b8' }}>
                      ของเดือน
                    </span>
                  </div>
                </div>}
              </div>

              <div style={{ marginTop: '0.75rem' }}>
                <div className="ab-field">
                  <label className="ab-label">ภาษาเริ่มต้นของใบแจ้งหนี้ / บิล</label>
                  <div className="ab-segmented">
                    <button
                      type="button"
                      className={`ab-segmented-btn ${defaultLang === 'th' ? 'active' : ''}`}
                      onClick={() => setDefaultLang('th')}
                    >
                      🇹🇭 ภาษาไทย (TH)
                    </button>
                    <button
                      type="button"
                      className={`ab-segmented-btn ${defaultLang === 'en' ? 'active' : ''}`}
                      onClick={() => setDefaultLang('en')}
                    >
                      🇬🇧 English (EN)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="add-building-footer">
            <button type="button" className="ab-btn-cancel" onClick={onClose} disabled={loading}>
              ยกเลิก
            </button>
            <button type="submit" className="ab-btn-submit" disabled={loading || !name.trim()}>
              {loading ? (
                <>
                  <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                  กำลังสร้างสาขา...
                </>
              ) : (
                <>
                  <Plus size={18} />
                  สร้างสาขาใหม่
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
