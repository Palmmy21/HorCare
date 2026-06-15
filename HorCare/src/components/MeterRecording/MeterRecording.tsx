import { useState, useEffect } from 'react';
import {
    Zap, Droplets, CheckCircle, Clock, ArrowRight, Save, AlertTriangle,
    ChevronLeft, ChevronRight, Home, Banknote, FileText
} from 'lucide-react';
import type { Room, DormConfig, MonthlyBill } from '../../types';
import {
    calculateFullBill,
    formatCurrency,
    validateReading,
    formatMonthThai,
    getPreviousMonth,
    getNextMonth,
    getEffectiveRates
} from '../../utils/calculations';

interface MeterRecordingProps {
    rooms: Room[];
    config: DormConfig;
    currentMonth: string;
    onSaveBill: (bill: MonthlyBill) => Promise<MonthlyBill | void> | void;
    getBillForRoom: (roomId: string, month: string) => MonthlyBill | undefined;
    getPreviousBill: (roomId: string, month: string) => MonthlyBill | undefined;
    onMonthChange: (month: string) => void;
    buildingId?: string;
}

interface RoomRecordingState {
    prevElec: string;
    prevWater: string;
    currElec: string;
    currWater: string;
    isSaved: boolean;
    isLocked: boolean;
}

// Unsaved (draft) meter readings, persisted per building+month so typed values
// survive switching pages (e.g. ไปแก้ข้อมูลห้อง), room edits, and reloads.
interface MeterDraft {
    prevElec: string;
    prevWater: string;
    currElec: string;
    currWater: string;
}

const DRAFT_PREFIX = 'horcare_meter_drafts_';

function readDrafts(key: string): Record<string, MeterDraft> {
    try {
        return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
        return {};
    }
}

function writeDraft(key: string, roomId: string, draft: MeterDraft) {
    const drafts = readDrafts(key);
    drafts[roomId] = draft;
    try { localStorage.setItem(key, JSON.stringify(drafts)); } catch { /* quota full — drafts are best-effort */ }
}

function removeDraft(key: string, roomId: string) {
    const drafts = readDrafts(key);
    if (!(roomId in drafts)) return;
    delete drafts[roomId];
    try {
        if (Object.keys(drafts).length === 0) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, JSON.stringify(drafts));
        }
    } catch { /* best-effort */ }
}

export default function MeterRecording({
    rooms,
    config,
    currentMonth,
    onSaveBill,
    getBillForRoom,
    getPreviousBill,
    onMonthChange,
    buildingId
}: MeterRecordingProps) {
    const [recordingState, setRecordingState] = useState<Record<string, RoomRecordingState>>({});
    const [savingRooms, setSavingRooms] = useState<Record<string, boolean>>({});
    const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

    const draftKey = `${DRAFT_PREFIX}${buildingId || 'local'}_${currentMonth}`;

    // Drop drafts older than ~3 months so localStorage doesn't accumulate forever
    useEffect(() => {
        let cutoff = currentMonth;
        for (let i = 0; i < 3; i++) cutoff = getPreviousMonth(cutoff);
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
            const month = key.slice(-7); // trailing YYYY-MM
            if (/^\d{4}-\d{2}$/.test(month) && month < cutoff) localStorage.removeItem(key);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const drafts = readDrafts(draftKey);
        const initialState: Record<string, RoomRecordingState> = {};

        rooms.forEach(room => {
            const existingBill = getBillForRoom(room.id, currentMonth);
            const prevBill = getPreviousBill(room.id, currentMonth);

            const defaultPrevElec = prevBill?.curr_elec ?? room.current_meter_elec ?? 0;
            const defaultPrevWater = prevBill?.curr_water ?? room.current_meter_water ?? 0;

            const isLocked = existingBill?.is_locked ?? false;
            const draft = drafts[room.id];

            if (draft && !isLocked) {
                // Unsaved typing wins over bill/defaults — survives page switches
                // and room edits (tenant count, rent type, ...) until saved/cleared
                initialState[room.id] = { ...draft, isSaved: false, isLocked };
            } else if (existingBill) {
                initialState[room.id] = {
                    prevElec: existingBill.prev_elec === 0 ? '' : existingBill.prev_elec.toString(),
                    prevWater: existingBill.prev_water === 0 ? '' : existingBill.prev_water.toString(),
                    currElec: existingBill.curr_elec === 0 ? '' : existingBill.curr_elec.toString(),
                    currWater: existingBill.curr_water === 0 ? '' : existingBill.curr_water.toString(),
                    isSaved: existingBill.is_saved,
                    isLocked: existingBill.is_locked
                };
            } else {
                initialState[room.id] = {
                    prevElec: defaultPrevElec === 0 ? '' : defaultPrevElec.toString(),
                    prevWater: defaultPrevWater === 0 ? '' : defaultPrevWater.toString(),
                    currElec: '',
                    currWater: '',
                    isSaved: false,
                    isLocked: false
                };
            }
        });

        setRecordingState(initialState);
    }, [rooms, currentMonth, draftKey, getBillForRoom, getPreviousBill]);

    const handleInputChange = (roomId: string, field: 'prevElec' | 'prevWater' | 'currElec' | 'currWater', value: string) => {
        // Only allow numbers
        if (value && !/^\d*$/.test(value)) return;

        const updated: RoomRecordingState = {
            ...recordingState[roomId],
            [field]: value,
            isSaved: false // Reset saved status on change
        };
        writeDraft(draftKey, roomId, {
            prevElec: updated.prevElec,
            prevWater: updated.prevWater,
            currElec: updated.currElec,
            currWater: updated.currWater
        });
        setRecordingState(prev => ({ ...prev, [roomId]: updated }));
    };



    const handleClear = (roomId: string) => {
        removeDraft(draftKey, roomId);
        setRecordingState(prev => ({
            ...prev,
            [roomId]: {
                ...prev[roomId],
                prevElec: '',
                prevWater: '',
                currElec: '',
                currWater: '',
                isSaved: false
            }
        }));
    };

    const handleSave = async (roomId: string) => {
        const state = recordingState[roomId];
        const room = rooms.find(r => r.id === roomId);
        if (!state || !room) return;

        const prevElec = parseInt(state.prevElec) || 0;
        const prevWater = parseInt(state.prevWater) || 0;
        const currElec = parseInt(state.currElec) || 0;
        const currWater = parseInt(state.currWater) || 0;

        const effectiveRent = room.rent_type === 'semester' ? 0 : (room.rent_amount ?? config.room_rent);
        const { electricityRate, waterConfig } = getEffectiveRates(room, config);

        const calculation = calculateFullBill(
            prevElec,
            currElec,
            prevWater,
            currWater,
            config,
            effectiveRent,
            room.tenant_count,
            electricityRate,
            waterConfig
        );

        const bill: MonthlyBill = {
            id: `bill_${roomId}_${currentMonth}`,
            room_id: roomId,
            room_number: room.room_number,
            month: currentMonth,
            prev_elec: prevElec,
            curr_elec: currElec,
            elec_units: calculation.elec_units,
            elec_bill: calculation.elec_bill,
            prev_water: prevWater,
            curr_water: currWater,
            water_units: calculation.water_units,
            water_bill: calculation.water_bill,
            water_flat_amount: calculation.water_flat_amount,
            water_excess_units: calculation.water_excess_units,
            water_excess_amount: calculation.water_excess_amount,
            room_rent: effectiveRent,
            total_bill: calculation.total_bill,
            is_saved: true,
            is_locked: false,
            is_notified: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        // แสดง loading
        setSavingRooms(prev => ({ ...prev, [roomId]: true }));
        setSaveErrors(prev => ({ ...prev, [roomId]: '' }));

        try {
            await onSaveBill(bill);
            removeDraft(draftKey, roomId);
            setRecordingState(prev => ({
                ...prev,
                [roomId]: { ...prev[roomId], isSaved: true }
            }));
        } catch (err) {
            console.error('บันทึกบิลล้มเหลว:', err);
            const msg = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
            setSaveErrors(prev => ({ ...prev, [roomId]: msg }));
        } finally {
            setSavingRooms(prev => ({ ...prev, [roomId]: false }));
        }
    };

    const renderRoomCard = (room: Room) => {
        const state = recordingState[room.id] || { prevElec: '0', prevWater: '0', currElec: '', currWater: '', isSaved: false, isLocked: false };
        const isSaving = savingRooms[room.id] || false;
        const saveError = saveErrors[room.id] || '';

        const prevElec = parseInt(state.prevElec) || 0;
        const prevWater = parseInt(state.prevWater) || 0;
        const currElec = parseInt(state.currElec) || 0;
        const currWater = parseInt(state.currWater) || 0;

        const elecUnits = state.currElec ? currElec - prevElec : 0;
        const waterUnits = state.currWater ? currWater - prevWater : 0;

        const elecValidation = state.currElec ? validateReading(prevElec, currElec) : { valid: true };
        const waterValidation = state.currWater ? validateReading(prevWater, currWater) : { valid: true };

        const effectiveRentPreview = room.rent_type === 'semester' ? 0 : (room.rent_amount ?? config.room_rent);
        const { electricityRate: roomElecRate, waterConfig: roomWaterCfg } = getEffectiveRates(room, config);

        // Calculate preview
        const calculation = state.currElec && state.currWater
            ? calculateFullBill(prevElec, currElec, prevWater, currWater, config, effectiveRentPreview, room.tenant_count, roomElecRate, roomWaterCfg)
            : null;

        // prevElec/prevWater อาจเป็น '' (แทน 0) ถือว่า valid — ตรวจแค่ currElec/currWater ต้องกรอก
        const canSave = state.currElec !== '' && state.currWater !== '' && elecValidation.valid && waterValidation.valid;

        return (
            <div key={room.id} className={`room-card ${state.isSaved ? 'saved' : ''}`}>
                <div className="room-card-header">
                    <span className="room-number" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Home size={18} /> ห้อง {room.room_number}</span>
                    <span className={`room-status ${state.isSaved ? 'saved' : 'pending'}`}>
                        {state.isSaved ? (
                            <>
                                <CheckCircle size={16} />
                                บันทึกแล้ว
                            </>
                        ) : (
                            <>
                                <Clock size={16} />
                                รอบันทึก
                            </>
                        )}
                    </span>
                </div>

                {/* Electricity */}
                <div className="meter-section">
                    <div className="meter-label">
                        <Zap size={16} color="#F59E0B" />
                        ค่าไฟฟ้า
                    </div>
                    <div className="meter-row">
                        <div className="meter-input-group">
                            <span className="meter-input-label">เดือนก่อน</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                className="meter-input meter-input-prev"
                                placeholder="0"
                                value={state.prevElec}
                                onChange={e => handleInputChange(room.id, 'prevElec', e.target.value)}
                                disabled={state.isLocked}
                            />
                        </div>
                        <ArrowRight size={16} className="meter-arrow" />
                        <div className="meter-input-group">
                            <span className="meter-input-label">เดือนนี้</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                className={`meter-input ${elecValidation.warning ? 'error' : ''}`}
                                placeholder="0"
                                value={state.currElec}
                                onChange={e => handleInputChange(room.id, 'currElec', e.target.value)}
                                disabled={state.isLocked}
                            />
                        </div>
                        <span className="meter-units">
                            {state.currElec && state.prevElec && (
                                <span className={`units-badge ${elecUnits < 0 ? 'text-danger' : ''}`}>
                                    {elecUnits >= 0 ? '+' : ''}{elecUnits} หน่วย
                                </span>
                            )}
                        </span>
                    </div>
                    {elecValidation.warning && (
                        <div className="form-error flex items-center gap-2 mt-2">
                            <AlertTriangle size={14} />
                            {elecValidation.warning}
                        </div>
                    )}
                </div>

                {/* Water */}
                <div className="meter-section">
                    <div className="meter-label">
                        <Droplets size={16} color="#2563EB" />
                        ค่าน้ำประปา
                    </div>
                    <div className="meter-row">
                        <div className="meter-input-group">
                            <span className="meter-input-label">เดือนก่อน</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                className="meter-input meter-input-prev"
                                placeholder="0"
                                value={state.prevWater}
                                onChange={e => handleInputChange(room.id, 'prevWater', e.target.value)}
                                disabled={state.isLocked}
                            />
                        </div>
                        <ArrowRight size={16} className="meter-arrow" />
                        <div className="meter-input-group">
                            <span className="meter-input-label">เดือนนี้</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                className={`meter-input ${waterValidation.warning ? 'error' : ''}`}
                                placeholder="0"
                                value={state.currWater}
                                onChange={e => handleInputChange(room.id, 'currWater', e.target.value)}
                                disabled={state.isLocked}
                            />
                        </div>
                        <span className="meter-units">
                            {state.currWater && state.prevWater && (
                                <span className={`units-badge ${waterUnits < 0 ? 'text-danger' : ''}`}>
                                    {waterUnits >= 0 ? '+' : ''}{waterUnits} หน่วย
                                </span>
                            )}
                        </span>
                    </div>
                    {waterValidation.warning && (
                        <div className="form-error flex items-center gap-2 mt-2">
                            <AlertTriangle size={14} />
                            {waterValidation.warning}
                        </div>
                    )}
                </div>

                {/* Bill Preview */}
                {calculation && (
                    <div className="bill-preview">
                        <div className="bill-row">
                            <span className="bill-label">
                                <Zap size={14} color="#F59E0B" />
                                ค่าไฟ ({calculation.elec_units} หน่วย × {roomElecRate}฿)
                            </span>
                            <span className="bill-value">{formatCurrency(calculation.elec_bill)}</span>
                        </div>
                        <div className="bill-row">
                            <span className="bill-label">
                                <Droplets size={14} color="#2563EB" />
                                {roomWaterCfg.type === 'normal'
                                    ? `ค่าน้ำ (${calculation.water_units} หน่วย × ${roomWaterCfg.unit_rate}฿)`
                                    : `ค่าน้ำ ${calculation.water_excess_units > 0 ? `(เกิน ${calculation.water_excess_units} หน่วย)` : '(เหมา)'}`
                                }
                            </span>
                            <span className="bill-value">{formatCurrency(calculation.water_bill)}</span>
                        </div>
                        <div className="bill-row">
                            <span className="bill-label">
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><Home size={14} color="#16A34A" /> ค่าห้อง</span>
                                {room.rent_type === 'semester' && (
                                    <span style={{ fontSize: '0.75rem', color: 'var(--color-warning)', marginLeft: '4px' }}>(รายเทอม)</span>
                                )}
                            </span>
                            <span className="bill-value">{formatCurrency(effectiveRentPreview)}</span>
                        </div>
                        <div className="bill-row total">
                            <span className="bill-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Banknote size={16} /> รวมทั้งสิ้น</span>
                            <span className="bill-value">{formatCurrency(calculation.total_bill)}</span>
                        </div>
                    </div>
                )}

                {/* Save & Clear Buttons */}
                <div className="room-card-actions flex gap-2">
                    <button
                        className="btn btn-outline btn-danger"
                        onClick={() => handleClear(room.id)}
                        title="ล้างข้อมูล"
                        style={{ padding: '0.5rem' }}
                        disabled={state.isLocked || isSaving}
                    >
                        <AlertTriangle size={18} />
                    </button>
                    <button
                        className={`btn ${state.isSaved ? 'btn-success' : 'btn-primary'}`}
                        onClick={() => handleSave(room.id)}
                        disabled={!canSave || state.isLocked || isSaving}
                        style={{ flex: 1 }}
                    >
                        {isSaving ? (
                            <>
                                <span className="loading-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                                กำลังบันทึก...
                            </>
                        ) : state.isSaved ? (
                            <>
                                <CheckCircle size={18} />
                                บันทึกแล้ว ✓
                            </>
                        ) : (
                            <>
                                <Save size={18} />
                                บันทึก
                            </>
                        )}
                    </button>
                </div>
                {/* แสดง error ถ้า Firestore fail */}
                {saveError && (
                    <div className="form-error flex items-center gap-2 mt-2" style={{ fontSize: '0.8rem' }}>
                        <AlertTriangle size={14} />
                        บันทึกไม่สำเร็จ: {saveError}
                    </div>
                )}
            </div>
        );
    };

    const activeRooms = rooms.filter(r => r.is_active);

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={28} /> จดมิเตอร์</h1>
                <p className="page-subtitle">
                    กรอกเลขมิเตอร์และกดบันทึกแต่ละห้อง
                </p>
            </div>

            {/* Month Selector */}
            <div className="month-selector">
                <button
                    className="btn btn-outline btn-icon"
                    onClick={() => onMonthChange(getPreviousMonth(currentMonth))}
                    title="เดือนก่อนหน้า"
                >
                    <ChevronLeft size={20} />
                </button>
                <div className="month-display">
                    <span className="month-label">รอบเดือน</span>
                    <span className="month-value">{formatMonthThai(currentMonth)}</span>
                </div>
                <button
                    className="btn btn-outline btn-icon"
                    onClick={() => onMonthChange(getNextMonth(currentMonth))}
                    title="เดือนถัดไป"
                >
                    <ChevronRight size={20} />
                </button>
            </div>

            {activeRooms.length === 0 ? (
                <div className="card empty-state">
                    <div><Home size={48} color="#9CA3AF" style={{ margin: '0 auto 1rem' }} /></div>
                    <h3>ยังไม่มีห้องพัก</h3>
                    <p>กรุณาเพิ่มห้องพักในหน้า "จัดการห้อง" ก่อน</p>
                </div>
            ) : (
                <div className="room-grid">
                    {activeRooms.map(renderRoomCard)}
                </div>
            )}
        </div>
    );
}
