import { useState, useEffect, useRef } from 'react';
import {
    Zap, Droplets, CheckCircle, Clock, ArrowRight, Save, AlertTriangle,
    ChevronLeft, ChevronRight, Home, Banknote, FileText,
    Download, Upload, X, Layers,
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
    const [importResult, setImportResult] = useState<{ updated: number; skipped: string[] } | null>(null);
    const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; roomNumber: string; done: boolean; failed: number } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
                    prevElec: existingBill.prev_elec.toString(),
                    prevWater: existingBill.prev_water.toString(),
                    currElec: existingBill.curr_elec === 0 ? '' : existingBill.curr_elec.toString(),
                    currWater: existingBill.curr_water === 0 ? '' : existingBill.curr_water.toString(),
                    isSaved: existingBill.is_saved,
                    isLocked: existingBill.is_locked
                };
            } else {
                initialState[room.id] = {
                    // Always show '0' explicitly so users notice and can correct the starting point
                    prevElec: defaultPrevElec.toString(),
                    prevWater: defaultPrevWater.toString(),
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

    // ── Save all rooms at once ─────────────────────────────────────────────────
    const handleSaveAll = async () => {
        const activeRooms = rooms.filter(r => r.is_active);
        const pending = activeRooms.filter(room => {
            const state = recordingState[room.id];
            if (!state || state.isSaved || state.isLocked) return false;
            const prevElec = parseInt(state.prevElec) || 0;
            const prevWater = parseInt(state.prevWater) || 0;
            const currElec = parseInt(state.currElec) || 0;
            const currWater = parseInt(state.currWater) || 0;
            return state.currElec !== '' && state.currWater !== '' &&
                validateReading(prevElec, currElec).valid && validateReading(prevWater, currWater).valid;
        });

        if (pending.length === 0) return;

        setBulkProgress({ current: 0, total: pending.length, roomNumber: '', done: false, failed: 0 });
        let failed = 0;

        for (let i = 0; i < pending.length; i++) {
            const room = pending[i];
            setBulkProgress({ current: i + 1, total: pending.length, roomNumber: room.room_number, done: false, failed });

            const state = recordingState[room.id];
            const prevElec = parseInt(state.prevElec) || 0;
            const prevWater = parseInt(state.prevWater) || 0;
            const currElec = parseInt(state.currElec) || 0;
            const currWater = parseInt(state.currWater) || 0;
            const effectiveRent = room.rent_type === 'semester' ? 0 : (room.rent_amount ?? config.room_rent);
            const { electricityRate, waterConfig } = getEffectiveRates(room, config);
            const calculation = calculateFullBill(prevElec, currElec, prevWater, currWater, config, effectiveRent, room.tenant_count, electricityRate, waterConfig);
            const bill: MonthlyBill = {
                id: `bill_${room.id}_${currentMonth}`,
                room_id: room.id,
                room_number: room.room_number,
                month: currentMonth,
                prev_elec: prevElec, curr_elec: currElec,
                elec_units: calculation.elec_units, elec_bill: calculation.elec_bill,
                prev_water: prevWater, curr_water: currWater,
                water_units: calculation.water_units, water_bill: calculation.water_bill,
                water_flat_amount: calculation.water_flat_amount,
                water_excess_units: calculation.water_excess_units,
                water_excess_amount: calculation.water_excess_amount,
                room_rent: effectiveRent,
                total_bill: calculation.total_bill,
                is_saved: true, is_locked: false, is_notified: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            try {
                await onSaveBill(bill);
                removeDraft(draftKey, room.id);
                setRecordingState(prev => ({ ...prev, [room.id]: { ...prev[room.id], isSaved: true } }));
            } catch {
                failed++;
            }
        }

        setBulkProgress(prev => prev ? { ...prev, done: true, failed } : null);
    };

    // ── CSV export template ────────────────────────────────────────────────────
    const exportTemplate = () => {
        const header = ['ห้อง', 'ไฟก่อนหน้า', 'ไฟปัจจุบัน', 'น้ำก่อนหน้า', 'น้ำปัจจุบัน'];
        const activeRoomsForExport = rooms.filter(r => r.is_active);
        const rows = activeRoomsForExport.map(room => {
            const state = recordingState[room.id];
            return [
                room.room_number,
                state?.prevElec ?? room.current_meter_elec ?? '0',
                state?.currElec ?? '',
                state?.prevWater ?? room.current_meter_water ?? '0',
                state?.currWater ?? '',
            ];
        });
        const csv = [header, ...rows]
            .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `meter_template_${currentMonth}.csv`;
        a.click();
    };

    // ── CSV import ─────────────────────────────────────────────────────────────
    const handleImportFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const text = (e.target?.result as string).replace(/^﻿/, ''); // strip BOM
                const lines = text.split(/\r?\n/).filter(l => l.trim());
                if (lines.length < 2) return;

                // Parse header to find column indices (order-independent)
                const ALIASES: Record<string, string> = {
                    'ห้อง': 'room', 'room': 'room', 'room_number': 'room', 'เลขห้อง': 'room',
                    'ไฟก่อนหน้า': 'prevElec', 'prev_elec': 'prevElec', 'มิเตอร์ไฟก่อนหน้า': 'prevElec',
                    'ไฟปัจจุบัน': 'currElec', 'curr_elec': 'currElec', 'มิเตอร์ไฟปัจจุบัน': 'currElec',
                    'น้ำก่อนหน้า': 'prevWater', 'prev_water': 'prevWater', 'มิเตอร์น้ำก่อนหน้า': 'prevWater',
                    'น้ำปัจจุบัน': 'currWater', 'curr_water': 'currWater', 'มิเตอร์น้ำปัจจุบัน': 'currWater',
                };

                const parseRow = (line: string) =>
                    line.split(',').map(c => c.trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"'));

                const headers = parseRow(lines[0]).map(h => h.toLowerCase().trim());
                const colIdx: Record<string, number> = {};
                headers.forEach((h, i) => {
                    const key = ALIASES[h] ?? ALIASES[h.replace(/\s+/g, '')] ?? null;
                    if (key && !(key in colIdx)) colIdx[key] = i;
                });

                // Fallback to positional if header not recognised
                if (!('room' in colIdx)) {
                    colIdx.room = 0; colIdx.prevElec = 1; colIdx.currElec = 2;
                    colIdx.prevWater = 3; colIdx.currWater = 4;
                }

                const roomMap = new Map(rooms.filter(r => r.is_active).map(r => [r.room_number, r]));
                const updatedState: Record<string, RoomRecordingState> = {};
                const skipped: string[] = [];
                let updated = 0;

                // Skip header row (index 0), parse data rows
                const startIdx = ALIASES[headers[0] ?? ''] !== undefined || colIdx.room === 0 ? 1 : 0;
                for (let i = startIdx; i < lines.length; i++) {
                    const cols = parseRow(lines[i]);
                    const roomNum = cols[colIdx.room]?.trim();
                    if (!roomNum) continue;

                    const room = roomMap.get(roomNum);
                    if (!room) { skipped.push(roomNum); continue; }

                    const existing = recordingState[room.id];
                    if (existing?.isLocked) { skipped.push(roomNum); continue; }

                    const get = (key: string) => colIdx[key] !== undefined ? (cols[colIdx[key]] ?? '').trim() : '';

                    const prevElec = get('prevElec') || existing?.prevElec || '0';
                    const currElec = get('currElec') || existing?.currElec || '';
                    const prevWater = get('prevWater') || existing?.prevWater || '0';
                    const currWater = get('currWater') || existing?.currWater || '';

                    const newState: RoomRecordingState = {
                        prevElec, currElec, prevWater, currWater,
                        isSaved: false,
                        isLocked: existing?.isLocked ?? false,
                    };
                    updatedState[room.id] = newState;
                    writeDraft(draftKey, room.id, { prevElec, currElec, prevWater, currWater });
                    updated++;
                }

                setRecordingState(prev => ({ ...prev, ...updatedState }));
                setImportResult({ updated, skipped });
                setTimeout(() => setImportResult(null), 6000);
            } catch (err) {
                console.error('CSV import error:', err);
                setImportResult({ updated: 0, skipped: ['ไม่สามารถอ่านไฟล์ได้'] });
                setTimeout(() => setImportResult(null), 5000);
            }
        };
        reader.readAsText(file, 'UTF-8');
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
        {/* Bulk save progress modal */}
        {bulkProgress && (
            <div style={{
                position: 'fixed', inset: 0, zIndex: 500,
                background: 'rgba(10,8,30,0.75)', backdropFilter: 'blur(8px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '1rem',
                animation: 'bsOverlayIn 0.2s ease',
            }}>
                <style>{`
                    @keyframes bsOverlayIn { from { opacity:0 } to { opacity:1 } }
                    @keyframes bsCardIn { from { opacity:0; transform:scale(0.88) translateY(16px) } to { opacity:1; transform:scale(1) translateY(0) } }
                    @keyframes bsSpin { to { transform:rotate(360deg) } }
                    @keyframes bsPulseRing { 0%,100% { transform:scale(1); opacity:0.6 } 50% { transform:scale(1.18); opacity:0.15 } }
                    @keyframes bsCountPop { 0% { transform:scale(1) } 40% { transform:scale(1.18) } 100% { transform:scale(1) } }
                    @keyframes bsRoomSlide { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
                    @keyframes bsShimmer { from { transform:translateX(-100%) } to { transform:translateX(200%) } }
                    @keyframes bsSuccessScale { 0% { transform:scale(0.5); opacity:0 } 60% { transform:scale(1.15) } 100% { transform:scale(1); opacity:1 } }
                    @keyframes bsDotBounce { 0%,80%,100% { transform:translateY(0) } 40% { transform:translateY(-6px) } }
                `}</style>

                <div style={{
                    background: 'linear-gradient(160deg,#0f0c29,#1a1040,#24243e)',
                    borderRadius: '24px', padding: '2.25rem 2rem',
                    width: '100%', maxWidth: '360px',
                    boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.07)',
                    textAlign: 'center',
                    animation: 'bsCardIn 0.3s cubic-bezier(0.34,1.56,0.64,1)',
                    position: 'relative', overflow: 'hidden',
                }}>
                    {/* Ambient glow bg */}
                    <div style={{
                        position: 'absolute', top: -60, left: '50%', transform: 'translateX(-50%)',
                        width: 200, height: 200, borderRadius: '50%',
                        background: bulkProgress.done ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.2)',
                        filter: 'blur(40px)', pointerEvents: 'none', transition: 'background 0.5s',
                    }} />

                    {/* Icon */}
                    <div style={{ position: 'relative', width: 72, height: 72, margin: '0 auto 1.5rem' }}>
                        {!bulkProgress.done && (
                            <>
                                {/* Pulse ring */}
                                <div style={{
                                    position: 'absolute', inset: -4, borderRadius: '50%',
                                    background: 'rgba(99,102,241,0.3)',
                                    animation: 'bsPulseRing 1.5s ease-in-out infinite',
                                }} />
                                {/* Spinning ring */}
                                <svg style={{ position: 'absolute', inset: 0, animation: 'bsSpin 1.2s linear infinite' }} viewBox="0 0 72 72">
                                    <circle cx="36" cy="36" r="33" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                                    <circle cx="36" cy="36" r="33" fill="none" stroke="url(#spinGrad)" strokeWidth="3"
                                        strokeDasharray="60 150" strokeLinecap="round" />
                                    <defs>
                                        <linearGradient id="spinGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                            <stop offset="0%" stopColor="#818CF8" />
                                            <stop offset="100%" stopColor="#C084FC" />
                                        </linearGradient>
                                    </defs>
                                </svg>
                            </>
                        )}
                        <div style={{
                            position: 'absolute', inset: 0, borderRadius: '50%',
                            background: bulkProgress.done
                                ? 'linear-gradient(135deg,#10B981,#059669)'
                                : 'linear-gradient(135deg,#6366F1,#8B5CF6)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            animation: bulkProgress.done ? 'bsSuccessScale 0.45s cubic-bezier(0.34,1.56,0.64,1)' : 'none',
                            transition: 'background 0.4s',
                            boxShadow: bulkProgress.done ? '0 0 24px rgba(16,185,129,0.5)' : '0 0 20px rgba(99,102,241,0.4)',
                        }}>
                            {bulkProgress.done
                                ? <CheckCircle size={30} color="#fff" />
                                : <Layers size={26} color="#fff" />}
                        </div>
                    </div>

                    {/* Title */}
                    <h3 style={{ fontWeight: 800, fontSize: '1.125rem', margin: '0 0 0.375rem', color: '#fff' }}>
                        {bulkProgress.done ? '🎉 บันทึกเสร็จสิ้น' : 'กำลังบันทึก...'}
                    </h3>

                    {/* Room name / summary */}
                    <p key={bulkProgress.roomNumber + bulkProgress.done} style={{
                        color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem', margin: '0 0 1.75rem',
                        animation: 'bsRoomSlide 0.2s ease',
                        minHeight: '1.4em',
                    }}>
                        {bulkProgress.done
                            ? `${bulkProgress.total - bulkProgress.failed} ห้อง สำเร็จ${bulkProgress.failed > 0 ? ` · ล้มเหลว ${bulkProgress.failed}` : ''}`
                            : `ห้อง ${bulkProgress.roomNumber}`}
                    </p>

                    {/* Big counter */}
                    <div key={bulkProgress.current} style={{
                        animation: 'bsCountPop 0.25s ease',
                        marginBottom: '1.25rem',
                        lineHeight: 1,
                    }}>
                        <span style={{
                            fontSize: '3rem', fontWeight: 900, color: '#fff',
                            fontFamily: 'var(--font-mono)', letterSpacing: '-0.04em',
                        }}>
                            {bulkProgress.current}
                        </span>
                        <span style={{ fontSize: '1.25rem', color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>
                            /{bulkProgress.total}
                        </span>
                    </div>

                    {/* Progress bar */}
                    <div style={{
                        background: 'rgba(255,255,255,0.08)', borderRadius: '999px',
                        height: 8, overflow: 'hidden', marginBottom: '0.75rem', position: 'relative',
                    }}>
                        <div style={{
                            height: '100%', borderRadius: '999px', position: 'relative', overflow: 'hidden',
                            background: bulkProgress.done
                                ? 'linear-gradient(90deg,#10B981,#34D399)'
                                : 'linear-gradient(90deg,#6366F1,#A78BFA,#C084FC)',
                            width: `${(bulkProgress.current / bulkProgress.total) * 100}%`,
                            transition: 'width 0.4s cubic-bezier(0.4,0,0.2,1)',
                            boxShadow: bulkProgress.done ? '0 0 12px #10B981' : '0 0 12px #818CF8',
                        }}>
                            {/* Shimmer */}
                            {!bulkProgress.done && (
                                <div style={{
                                    position: 'absolute', inset: 0,
                                    background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)',
                                    animation: 'bsShimmer 1.4s ease infinite',
                                }} />
                            )}
                        </div>
                    </div>

                    {/* Percent */}
                    <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)', marginBottom: '1.75rem', fontFamily: 'var(--font-mono)' }}>
                        {Math.round((bulkProgress.current / bulkProgress.total) * 100)}%
                    </div>

                    {/* Waiting dots / Close button */}
                    {bulkProgress.done ? (
                        <button
                            onClick={() => setBulkProgress(null)}
                            style={{
                                width: '100%', padding: '0.8rem', fontSize: '0.9375rem', fontWeight: 700,
                                background: 'linear-gradient(135deg,#10B981,#059669)',
                                color: '#fff', border: 'none', borderRadius: '14px',
                                cursor: 'pointer', boxShadow: '0 4px 20px rgba(16,185,129,0.4)',
                                animation: 'bsRoomSlide 0.3s ease 0.1s both',
                            }}
                        >
                            เสร็จสิ้น ✓
                        </button>
                    ) : (
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
                            {[0, 1, 2].map(i => (
                                <div key={i} style={{
                                    width: 6, height: 6, borderRadius: '50%',
                                    background: 'rgba(165,180,252,0.6)',
                                    animation: `bsDotBounce 1.2s ease ${i * 0.2}s infinite`,
                                }} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        )}
            <div className="page-header">
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={28} /> จดมิเตอร์</h1>
                    <p className="page-subtitle">กรอกเลขมิเตอร์และกดบันทึกแต่ละห้อง</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    {(() => {
                        const pendingCount = rooms.filter(r => r.is_active).filter(room => {
                            const state = recordingState[room.id];
                            if (!state || state.isSaved || state.isLocked) return false;
                            return state.currElec !== '' && state.currWater !== '';
                        }).length;
                        return pendingCount > 0 ? (
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={handleSaveAll}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontWeight: 700 }}
                            >
                                <Layers size={15} /> บันทึกทั้งหมด ({pendingCount})
                            </button>
                        ) : null;
                    })()}
                    <button
                        className="btn btn-outline btn-sm"
                        onClick={exportTemplate}
                        title="ดาวน์โหลด Template CSV"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
                    >
                        <Download size={15} /> Template
                    </button>
                    <button
                        className="btn btn-outline btn-sm"
                        onClick={() => fileInputRef.current?.click()}
                        title="นำเข้าข้อมูลมิเตอร์จาก CSV"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
                    >
                        <Upload size={15} /> นำเข้า CSV
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        style={{ display: 'none' }}
                        onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) { handleImportFile(f); e.target.value = ''; }
                        }}
                    />
                </div>
            </div>

            {/* Import result toast */}
            {importResult && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.625rem',
                    background: importResult.updated > 0 ? '#ECFDF5' : '#FEF3C7',
                    border: `1px solid ${importResult.updated > 0 ? '#A7F3D0' : '#FDE68A'}`,
                    color: importResult.updated > 0 ? '#065F46' : '#92400E',
                    borderRadius: '10px', padding: '0.625rem 0.875rem',
                    fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.75rem',
                }}>
                    <CheckCircle size={15} color={importResult.updated > 0 ? '#059669' : '#D97706'} />
                    <span style={{ flex: 1 }}>
                        {importResult.updated > 0
                            ? `นำเข้าสำเร็จ ${importResult.updated} ห้อง`
                            : 'ไม่พบห้องที่ตรงกัน'}
                        {importResult.skipped.length > 0 && ` · ข้ามไป: ${importResult.skipped.join(', ')}`}
                    </span>
                    <button onClick={() => setImportResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
                        <X size={14} />
                    </button>
                </div>
            )}

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
