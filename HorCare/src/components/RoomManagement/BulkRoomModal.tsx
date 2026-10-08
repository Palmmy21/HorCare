import { useMemo, useState } from 'react';
import { X, Plus, Layers, AlertTriangle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { DormConfig, Room } from '../../types';
import {
    buildRoomNumbers, findDuplicates, validatePattern, MAX_BULK_ROOMS, type PatternError,
} from '../../utils/bulkRooms';
import { BUILTIN_AMENITIES } from '../../utils/amenities';
import { defaultRentType, getWorkspaceTerms, rentTypeOptions, rentUnitLabel } from '../../utils/workspaceTerminology';

interface BulkRoomModalProps {
    existingRooms: Room[];
    config: DormConfig;
    /** Rooms still allowed by the current plan (Infinity if unlimited). */
    remainingSlots: number;
    unitName: string;
    onCreate: (rooms: Partial<Room>[]) => Promise<{ created: number }>;
    onSaveConfig: (config: DormConfig) => Promise<void>;
    onClose: () => void;
}

const PATTERN_ERRORS: Record<Exclude<PatternError, null>, string> = {
    not_integer: 'กรอกเลขเริ่มต้นและเลขสิ้นสุดเป็นจำนวนเต็ม',
    negative: 'เลขห้องต้องไม่ติดลบ',
    end_before_start: 'เลขสิ้นสุดต้องไม่น้อยกว่าเลขเริ่มต้น',
    too_many: `สร้างได้สูงสุด ${MAX_BULK_ROOMS} ห้องต่อครั้ง`,
};

export default function BulkRoomModal({
    existingRooms, config, remainingSlots, unitName, onCreate, onSaveConfig, onClose,
}: BulkRoomModalProps) {
    const [start, setStart] = useState('101');
    const [end, setEnd] = useState('120');
    const [prefix, setPrefix] = useState('');
    const [padWidth, setPadWidth] = useState('0');
    const [buildingName, setBuildingName] = useState('');
    const [floor, setFloor] = useState('');
    const [roomType, setRoomType] = useState<'dormitory' | 'commercial'>(
        config.building_type === 'commercial' ? 'commercial' : 'dormitory',
    );
    const terms = getWorkspaceTerms(config.building_type);
    const [rentType, setRentType] = useState<Room['rent_type']>(defaultRentType(config.building_type, config.market_config?.default_rent_cycle));
    const [rent, setRent] = useState(String(config.room_rent ?? 0));
    const [deposit, setDeposit] = useState('');
    const [elecRate, setElecRate] = useState('');
    const [waterRate, setWaterRate] = useState('');
    const [status, setStatus] = useState<'vacant' | 'occupied' | 'reserved'>('vacant');
    const [amenities, setAmenities] = useState<Set<string>>(new Set());
    const [customName, setCustomName] = useState('');
    const [customAmenities, setCustomAmenities] = useState<string[]>(config.custom_amenities ?? []);
    const [saving, setSaving] = useState(false);

    const pattern = useMemo(() => ({
        start: Number(start), end: Number(end), prefix: prefix.trim(), padWidth: Number(padWidth) || 0,
    }), [start, end, prefix, padWidth]);

    const patternError = start === '' || end === '' ? 'not_integer' : validatePattern(pattern);
    const numbers = useMemo(() => (patternError ? [] : buildRoomNumbers(pattern)), [pattern, patternError]);
    const duplicates = useMemo(
        () => findDuplicates(numbers, existingRooms.map(r => r.room_number)),
        [numbers, existingRooms],
    );
    const overLimit = numbers.length > remainingSlots;
    const canSubmit = !saving && numbers.length > 0 && duplicates.length === 0 && !overLimit
        && Number(rent) >= 0 && rent !== '';

    const toggleAmenity = (key: string) => setAmenities(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    const addCustomAmenity = () => {
        const name = customName.trim();
        if (!name) return;
        const all = [...BUILTIN_AMENITIES.map(a => a.label.toLowerCase()), ...customAmenities.map(a => a.toLowerCase())];
        if (all.includes(name.toLowerCase())) { toast.error('มี Amenity นี้อยู่แล้ว'); return; }
        setCustomAmenities(prev => [...prev, name]);
        setAmenities(prev => new Set(prev).add(name));
        setCustomName('');
    };

    const submit = async () => {
        if (!canSubmit) return;
        setSaving(true);
        try {
            const rooms: Partial<Room>[] = numbers.map(n => ({
                room_number: n,
                room_type: roomType,
                rent_amount: Number(rent) || 0,
                rent_type: rentType,
                room_status: status,
                ...(buildingName.trim() ? { building_name: buildingName.trim() } : {}),
                ...(floor.trim() ? { floor: floor.trim() } : {}),
                ...(deposit !== '' ? { deposit_amount: Number(deposit) || 0 } : {}),
                ...(terms.usesMeters && elecRate !== '' ? { custom_electricity_rate: Number(elecRate) || 0 } : {}),
                ...(terms.usesMeters && waterRate !== '' ? { custom_water_config: { type: 'normal' as const, unit_rate: Number(waterRate) || 0 } } : {}),
                ...(amenities.size > 0 ? { amenities: [...amenities] } : {}),
            }));
            const { created } = await onCreate(rooms);

            // Persist any new custom amenities so they're offered next time.
            const before = config.custom_amenities ?? [];
            if (customAmenities.length !== before.length) {
                await onSaveConfig({ ...config, custom_amenities: customAmenities });
            }
            toast.success(`สร้าง ${created} ${unitName} เรียบร้อย`);
            onClose();
        } catch (err) {
            const e = err as Error & { duplicates?: string[] };
            if (e.message === 'duplicate_room_numbers') {
                toast.error(`เลขซ้ำ: ${(e.duplicates ?? []).slice(0, 8).join(', ')}`);
            } else {
                toast.error('สร้างไม่สำเร็จ กรุณาลองใหม่');
            }
        } finally {
            setSaving(false);
        }
    };

    const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 };
    const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
            <div className="modal" style={{ maxWidth: 640 }} role="dialog" aria-modal="true" aria-label={`สร้าง${unitName}หลายรายการ`}>
                <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Layers size={20} /> สร้าง{unitName}หลายรายการ
                    </span>
                    <button className="btn-icon" onClick={onClose} disabled={saving} aria-label="ปิด"><X size={18} /></button>
                </div>

                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                    <section>
                        <div className="form-label" style={{ marginBottom: '0.5rem', fontWeight: 700 }}>ช่วงเลข{unitName}</div>
                        <div style={grid}>
                            <label style={field}>
                                <span className="form-label">เลขเริ่มต้น</span>
                                <input className="form-input mono" inputMode="numeric" value={start} onChange={e => setStart(e.target.value)} />
                            </label>
                            <label style={field}>
                                <span className="form-label">เลขสิ้นสุด</span>
                                <input className="form-input mono" inputMode="numeric" value={end} onChange={e => setEnd(e.target.value)} />
                            </label>
                            <label style={field}>
                                <span className="form-label">นำหน้า (ไม่บังคับ)</span>
                                <input className="form-input mono" placeholder="เช่น A-" value={prefix} onChange={e => setPrefix(e.target.value)} />
                            </label>
                            <label style={field}>
                                <span className="form-label">เติม 0 ให้ครบ (หลัก)</span>
                                <input className="form-input mono" inputMode="numeric" value={padWidth} onChange={e => setPadWidth(e.target.value)} />
                            </label>
                        </div>

                        <div style={{ marginTop: '0.625rem', fontSize: '0.8125rem' }}>
                            {patternError ? (
                                <span style={{ color: '#DC2626', display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                                    <AlertTriangle size={14} /> {PATTERN_ERRORS[patternError]}
                                </span>
                            ) : (
                                <span style={{ color: 'var(--color-gray-600)' }}>
                                    จะสร้าง <b>{numbers.length}</b> {unitName}:{' '}
                                    <span className="mono">
                                        {numbers.slice(0, 4).join(', ')}{numbers.length > 4 ? ` … ${numbers[numbers.length - 1]}` : ''}
                                    </span>
                                </span>
                            )}
                            {duplicates.length > 0 && (
                                <div role="alert" style={{ color: '#DC2626', marginTop: '0.375rem', display: 'flex', gap: '0.375rem', alignItems: 'flex-start' }}>
                                    <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                                    <span>มีเลขซ้ำ/อยู่แล้วในระบบ ({duplicates.length}): {duplicates.slice(0, 10).join(', ')}{duplicates.length > 10 ? ' …' : ''}</span>
                                </div>
                            )}
                            {overLimit && (
                                <div role="alert" style={{ color: '#DC2626', marginTop: '0.375rem' }}>
                                    เกินจำนวน{unitName}ที่แผนปัจจุบันรองรับ (เพิ่มได้อีก {remainingSlots} {unitName})
                                </div>
                            )}
                        </div>
                    </section>

                    <section>
                        <div className="form-label" style={{ marginBottom: '0.5rem', fontWeight: 700 }}>ตำแหน่งและประเภท</div>
                        <div style={grid}>
                            <label style={field}>
                                <span className="form-label">ตึก / อาคาร</span>
                                <input className="form-input" value={buildingName} onChange={e => setBuildingName(e.target.value)} />
                            </label>
                            <label style={field}>
                                <span className="form-label">ชั้น</span>
                                <input className="form-input" value={floor} onChange={e => setFloor(e.target.value)} />
                            </label>
                            <label style={field}>
                                <span className="form-label">ประเภท</span>
                                <select className="form-input" value={roomType} onChange={e => setRoomType(e.target.value as 'dormitory' | 'commercial')}>
                                    <option value="dormitory">หอพัก / ที่พัก</option>
                                    <option value="commercial">พาณิชย์</option>
                                </select>
                            </label>
                            <label style={field}>
                                <span className="form-label">สถานะเริ่มต้น</span>
                                <select className="form-input" value={status} onChange={e => setStatus(e.target.value as typeof status)}>
                                    <option value="vacant">ว่าง</option>
                                    <option value="occupied">มีผู้เช่า</option>
                                    <option value="reserved">ติดจอง</option>
                                </select>
                            </label>
                        </div>
                    </section>

                    <section>
                        <div className="form-label" style={{ marginBottom: '0.5rem', fontWeight: 700 }}>ราคา</div>
                        <div style={grid}>
                            <label style={field}>
                                <span className="form-label">รูปแบบการเก็บเงิน</span>
                                <select className="form-input" value={rentType} onChange={e => setRentType(e.target.value as Room['rent_type'])}>
                                    {rentTypeOptions(config.building_type).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </label>
                            <label style={field}>
                                <span className="form-label">{terms.isMarket ? 'ค่าเช่าแผง' : terms.usesMeters ? 'ค่าเช่า' : 'ราคาห้อง'}/{rentUnitLabel(rentType, config.building_type)} (฿)</span>
                                <input className="form-input mono" inputMode="decimal" value={rent} onChange={e => setRent(e.target.value)} />
                            </label>
                            <label style={field}>
                                <span className="form-label">เงินมัดจำ (฿)</span>
                                <input className="form-input mono" inputMode="decimal" value={deposit} onChange={e => setDeposit(e.target.value)} />
                            </label>
                            {terms.usesMeters && <label style={field}>
                                <span className="form-label">ค่าไฟ/หน่วย (฿)</span>
                                <input className="form-input mono" inputMode="decimal" placeholder={`ค่าเริ่มต้น ${config.electricity_rate}`} value={elecRate} onChange={e => setElecRate(e.target.value)} />
                            </label>}
                            {terms.usesMeters && <label style={field}>
                                <span className="form-label">ค่าน้ำ/หน่วย (฿)</span>
                                <input className="form-input mono" inputMode="decimal" placeholder="ใช้ค่าเริ่มต้น" value={waterRate} onChange={e => setWaterRate(e.target.value)} />
                            </label>}
                        </div>
                        {terms.usesMeters && <p style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', margin: '0.375rem 0 0' }}>
                            เว้นว่างค่าไฟ/ค่าน้ำเพื่อใช้อัตราเริ่มต้นของสถานที่
                        </p>}
                    </section>

                    <section>
                        <div className="form-label" style={{ marginBottom: '0.5rem', fontWeight: 700 }}>สิ่งอำนวยความสะดวก (Amenities)</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {[...BUILTIN_AMENITIES.map(a => ({ key: a.id, label: a.label })),
                              ...customAmenities.map(a => ({ key: a, label: a }))].map(a => {
                                const on = amenities.has(a.key);
                                return (
                                    <button
                                        key={a.key} type="button" onClick={() => toggleAmenity(a.key)} aria-pressed={on}
                                        style={{
                                            padding: '0.375rem 0.75rem', borderRadius: 999, fontSize: '0.8125rem', cursor: 'pointer',
                                            fontWeight: on ? 700 : 500,
                                            border: `1px solid ${on ? 'var(--color-primary, #8B5CF6)' : 'var(--color-gray-200)'}`,
                                            background: on ? 'var(--color-primary, #8B5CF6)' : 'transparent',
                                            color: on ? '#fff' : 'var(--color-gray-700)',
                                        }}
                                    >{a.label}</button>
                                );
                            })}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.625rem' }}>
                            <input
                                className="form-input" style={{ flex: 1 }} placeholder="เพิ่ม Amenity ของคุณเอง"
                                value={customName} onChange={e => setCustomName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomAmenity(); } }}
                            />
                            <button type="button" className="btn btn-outline btn-sm" onClick={addCustomAmenity} disabled={!customName.trim()}>
                                <Plus size={14} /> เพิ่ม
                            </button>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', margin: '0.375rem 0 0' }}>
                            ที่เลือกจะถูกใส่ให้ทุก{unitName}ที่สร้าง และแก้ไขรายห้องได้ภายหลัง
                        </p>
                    </section>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-outline" onClick={onClose} disabled={saving}>ยกเลิก</button>
                    <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
                        {saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                        สร้าง {numbers.length > 0 ? numbers.length : ''} {unitName}
                    </button>
                </div>
            </div>
        </div>
    );
}
