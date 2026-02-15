import { useState, useEffect } from 'react';
import {
    Zap, Droplets, CheckCircle, Clock, ArrowRight, Save, AlertTriangle,
    ChevronLeft, ChevronRight
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
    onSaveBill: (bill: MonthlyBill) => void;
    getBillForRoom: (roomId: string, month: string) => MonthlyBill | undefined;
    getPreviousBill: (roomId: string, month: string) => MonthlyBill | undefined;
    onMonthChange: (month: string) => void;
}

interface RoomRecordingState {
    prevElec: string;
    prevWater: string;
    currElec: string;
    currWater: string;
    isSaved: boolean;
}

export default function MeterRecording({
    rooms,
    config,
    currentMonth,
    onSaveBill,
    getBillForRoom,
    getPreviousBill,
    onMonthChange
}: MeterRecordingProps) {
    const [recordingState, setRecordingState] = useState<Record<string, RoomRecordingState>>({});

    // Initialize state from existing bills or previous data
    useEffect(() => {
        const initialState: Record<string, RoomRecordingState> = {};

        rooms.forEach(room => {
            const existingBill = getBillForRoom(room.id, currentMonth);
            const prevBill = getPreviousBill(room.id, currentMonth);

            // Get default previous readings
            const defaultPrevElec = prevBill?.curr_elec ?? room.current_meter_elec ?? 0;
            const defaultPrevWater = prevBill?.curr_water ?? room.current_meter_water ?? 0;

            if (existingBill) {
                initialState[room.id] = {
                    prevElec: existingBill.prev_elec.toString(),
                    prevWater: existingBill.prev_water.toString(),
                    currElec: existingBill.curr_elec.toString(),
                    currWater: existingBill.curr_water.toString(),
                    isSaved: existingBill.is_saved
                };
            } else {
                initialState[room.id] = {
                    prevElec: defaultPrevElec.toString(),
                    prevWater: defaultPrevWater.toString(),
                    currElec: '',
                    currWater: '',
                    isSaved: false
                };
            }
        });

        setRecordingState(initialState);
    }, [rooms, currentMonth, getBillForRoom, getPreviousBill]);

    const handleInputChange = (roomId: string, field: 'prevElec' | 'prevWater' | 'currElec' | 'currWater', value: string) => {
        // Only allow numbers
        if (value && !/^\d*$/.test(value)) return;

        setRecordingState(prev => ({
            ...prev,
            [roomId]: {
                ...prev[roomId],
                [field]: value,
                isSaved: false // Reset saved status on change
            }
        }));
    };



    const handleSave = (roomId: string) => {
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

        onSaveBill(bill);

        setRecordingState(prev => ({
            ...prev,
            [roomId]: {
                ...prev[roomId],
                isSaved: true
            }
        }));
    };

    const renderRoomCard = (room: Room) => {
        const state = recordingState[room.id] || { prevElec: '0', prevWater: '0', currElec: '', currWater: '', isSaved: false };

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

        const canSave = state.prevElec && state.prevWater && state.currElec && state.currWater && elecValidation.valid && waterValidation.valid;

        return (
            <div key={room.id} className={`room-card ${state.isSaved ? 'saved' : ''}`}>
                <div className="room-card-header">
                    <span className="room-number">🏠 ห้อง {room.room_number}</span>
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
                                🏠 ค่าห้อง
                                {room.rent_type === 'semester' && (
                                    <span style={{ fontSize: '0.75rem', color: 'var(--color-warning)', marginLeft: '4px' }}>(รายเทอม)</span>
                                )}
                            </span>
                            <span className="bill-value">{formatCurrency(effectiveRentPreview)}</span>
                        </div>
                        <div className="bill-row total">
                            <span className="bill-label">💰 รวมทั้งสิ้น</span>
                            <span className="bill-value">{formatCurrency(calculation.total_bill)}</span>
                        </div>
                    </div>
                )}

                {/* Save Button */}
                <div className="room-card-actions">
                    <button
                        className={`btn ${state.isSaved ? 'btn-success' : 'btn-primary'}`}
                        onClick={() => handleSave(room.id)}
                        disabled={!canSave}
                    >
                        {state.isSaved ? (
                            <>
                                <CheckCircle size={18} />
                                บันทึกแล้ว ✓
                            </>
                        ) : (
                            <>
                                <Save size={18} />
                                💾 บันทึก
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    };

    const activeRooms = rooms.filter(r => r.is_active);

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">📝 จดมิเตอร์</h1>
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
                    <div>🏠</div>
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
