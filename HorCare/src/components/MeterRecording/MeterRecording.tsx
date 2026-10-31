import { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import {
    Zap, Droplets, CheckCircle, Clock, ArrowRight, Save, AlertTriangle,
    ChevronLeft, ChevronRight, Home, Banknote, FileText,
    Download, Upload, X, Layers, Camera, Check, Search,
} from 'lucide-react';
import MeterPhotoReader, { type MeterReadResult } from './MeterPhotoReader';
import MeterBatchModal, { type BatchSaveResult } from './MeterBatchModal';
import { logActivity } from '../../utils/auditLog';
import type { RoomMeterContext, RoomReadings } from '../../utils/meterBatch';
import type { Room, DormConfig, MonthlyBill, CommonFee, RentProrate } from '../../types';
import { useTenantStays } from '../../hooks/useTenantStays';
import { prorateRent, proratedAmount } from '../../shared/prorate';
import {
    calculateFullBill,
    formatCurrency,
    validateReading,
    formatMonthThai,
    getPreviousMonth,
    getNextMonth,
    getEffectiveRates,
    roomFees
} from '../../utils/calculations';

interface MeterRecordingProps {
    rooms: Room[];
    config: DormConfig;
    commonFees: CommonFee[];
    currentMonth: string;
    onSaveBill: (bill: MonthlyBill) => Promise<MonthlyBill | void> | void;
    getBillForRoom: (roomId: string, month: string) => MonthlyBill | undefined;
    getPreviousBill: (roomId: string, month: string) => MonthlyBill | undefined;
    onMonthChange: (month: string) => void;
    buildingId?: string;
    /** true = ผู้ใช้เป็น Plus หรือ Pro — เปิดใช้ฟีเจอร์อ่านมิเตอร์จากรูปถ่าย */
    canUseMeterPhoto?: boolean;
    /** Signed-in owner uid. Needed for AI batch reading (server checks permission); omit for maid sessions. */
    ownerUid?: string;
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
const METER_TAB_KEY = 'horcare_meter_tab';

type MeterTab = 'elec' | 'water';

function readMeterTab(): MeterTab {
    try {
        return localStorage.getItem(METER_TAB_KEY) === 'water' ? 'water' : 'elec';
    } catch {
        return 'elec';
    }
}

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
    commonFees,
    currentMonth,
    onSaveBill,
    getBillForRoom,
    getPreviousBill,
    onMonthChange,
    buildingId,
    canUseMeterPhoto = false,
    ownerUid,
}: MeterRecordingProps) {
    const [showBatch, setShowBatch] = useState(false);
    // Electricity and water are recorded on separate tabs — one meter type per walk-through
    const [meterTab, setMeterTab] = useState<MeterTab>(readMeterTab);
    const changeMeterTab = (tab: MeterTab) => {
        setMeterTab(tab);
        try { localStorage.setItem(METER_TAB_KEY, tab); } catch { /* best-effort */ }
    };
    const [recordingState, setRecordingState] = useState<Record<string, RoomRecordingState>>({});
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'saved' | 'unsaved'>('all');
    const [savingRooms, setSavingRooms] = useState<Record<string, boolean>>({});
    const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
    const [importResult, setImportResult] = useState<{ updated: number; skipped: string[] } | null>(null);
    const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; roomNumber: string; done: boolean; failed: number } | null>(null);
    const [modalIn, setModalIn] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    /** roomId ของห้องที่กำลังเปิด MeterPhotoReader modal */
    const [photoReaderId, setPhotoReaderId] = useState<string | null>(null);

    // Trigger pop-in transition on the frame after modal mounts
    useEffect(() => {
        if (bulkProgress) {
            const id = requestAnimationFrame(() => requestAnimationFrame(() => setModalIn(true)));
            return () => cancelAnimationFrame(id);
        } else {
            setModalIn(false);
        }
    }, [bulkProgress != null]); // eslint-disable-line react-hooks/exhaustive-deps -- depend on presence not value

    const draftKey = `${DRAFT_PREFIX}${buildingId || 'local'}_${currentMonth}`;

    // Rent for this month: monthly rooms only (term/daily rent is billed elsewhere), prorated for a mid-month
    // move-in or move-out when the property turns that on (Settings → บิล).
    const stays = useTenantStays(config.prorate_rent ? ownerUid : null, buildingId);
    const rentFor = (room: Room): { rent: number; prorate: RentProrate | null } => {
        const full = ['semester', 'yearly', 'daily'].includes(room.rent_type) ? 0 : (room.rent_amount ?? config.room_rent);
        const prorate = config.prorate_rent ? prorateRent(full, currentMonth, stays[room.id]) : null;
        return { rent: proratedAmount(full, prorate), prorate };
    };

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

        const { rent: effectiveRent, prorate } = rentFor(room);
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
            waterConfig,
            roomFees(commonFees, room),
            room.common_fee_overrides,
            currentMonth
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
            common_fee: calculation.common_fee,
            applied_common_fees: calculation.applied_common_fees,
            room_rent: effectiveRent,
            ...(prorate ? { rent_prorate: prorate } : {}),
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

        flushSync(() => setBulkProgress({ current: 0, total: pending.length, roomNumber: '', done: false, failed: 0 }));
        let failed = 0;

        for (let i = 0; i < pending.length; i++) {
            const room = pending[i];
            flushSync(() => setBulkProgress({ current: i + 1, total: pending.length, roomNumber: room.room_number, done: false, failed }));

            const state = recordingState[room.id];
            const prevElec = parseInt(state.prevElec) || 0;
            const prevWater = parseInt(state.prevWater) || 0;
            const currElec = parseInt(state.currElec) || 0;
            const currWater = parseInt(state.currWater) || 0;
            const { rent: effectiveRent, prorate } = rentFor(room);
            const { electricityRate, waterConfig } = getEffectiveRates(room, config);
            const calculation = calculateFullBill(prevElec, currElec, prevWater, currWater, config, effectiveRent, room.tenant_count, electricityRate, waterConfig, roomFees(commonFees, room), room.common_fee_overrides, currentMonth);
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
                common_fee: calculation.common_fee,
                applied_common_fees: calculation.applied_common_fees,
                room_rent: effectiveRent,
                ...(prorate ? { rent_prorate: prorate } : {}),
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

        flushSync(() => setBulkProgress(prev => prev ? { ...prev, done: true, failed } : null));
    };

    // ── AI batch reading ───────────────────────────────────────────────────────
    // What the batch review needs to judge a reading: last month's closing value, last
    // month's usage (to spot jumps) and whether the month is already closed.
    const getBatchContext = (roomId: string, type: 'electric' | 'water'): RoomMeterContext | undefined => {
        const state = recordingState[roomId];
        if (!state) return undefined;
        const prev = getPreviousBill(roomId, currentMonth);
        return {
            previous: parseInt(type === 'electric' ? state.prevElec : state.prevWater) || 0,
            lastUnits: type === 'electric' ? prev?.elec_units : prev?.water_units,
            locked: state.isLocked,
        };
    };

    // Called only with readings a person confirmed. A room needs both an electric and a
    // water reading to become a bill; with only one, the value is kept as a draft in the
    // normal recording form (same as typing it) so the other can be added later.
    const saveBatchReadings = async (readings: RoomReadings[], meta: { overriddenCount: number }): Promise<BatchSaveResult> => {
        const result: BatchSaveResult = { bills: 0, drafts: 0, failed: [] };
        const savedRooms: string[] = [];

        for (const r of readings) {
            const room = rooms.find(x => x.id === r.roomId);
            const state = recordingState[r.roomId];
            if (!room || !state || state.isLocked) { result.failed.push(r.roomId); continue; }

            const currElec = r.electric !== undefined ? String(r.electric) : state.currElec;
            const currWater = r.water !== undefined ? String(r.water) : state.currWater;
            const next: RoomRecordingState = { ...state, currElec, currWater, isSaved: false };
            writeDraft(draftKey, r.roomId, { prevElec: next.prevElec, prevWater: next.prevWater, currElec, currWater });

            const prevElec = parseInt(next.prevElec) || 0;
            const prevWater = parseInt(next.prevWater) || 0;
            const complete = currElec !== '' && currWater !== ''
                && validateReading(prevElec, parseInt(currElec)).valid
                && validateReading(prevWater, parseInt(currWater)).valid;

            if (!complete) {
                setRecordingState(prev => ({ ...prev, [r.roomId]: next }));
                result.drafts++;
                savedRooms.push(room.room_number);
                continue;
            }

            const { rent: effectiveRent, prorate } = rentFor(room);
            const { electricityRate, waterConfig } = getEffectiveRates(room, config);
            const calc = calculateFullBill(prevElec, parseInt(currElec), prevWater, parseInt(currWater), config, effectiveRent,
                room.tenant_count, electricityRate, waterConfig, roomFees(commonFees, room), room.common_fee_overrides, currentMonth);
            const now = new Date().toISOString();
            const bill: MonthlyBill = {
                id: `bill_${room.id}_${currentMonth}`, room_id: room.id, room_number: room.room_number, month: currentMonth,
                prev_elec: prevElec, curr_elec: parseInt(currElec), elec_units: calc.elec_units, elec_bill: calc.elec_bill,
                prev_water: prevWater, curr_water: parseInt(currWater), water_units: calc.water_units, water_bill: calc.water_bill,
                water_flat_amount: calc.water_flat_amount, water_excess_units: calc.water_excess_units,
                water_excess_amount: calc.water_excess_amount, common_fee: calc.common_fee,
                applied_common_fees: calc.applied_common_fees, room_rent: effectiveRent, ...(prorate ? { rent_prorate: prorate } : {}), total_bill: calc.total_bill,
                is_saved: true, is_locked: false, is_notified: false, created_at: now, updated_at: now,
            };
            try {
                await onSaveBill(bill);
                removeDraft(draftKey, r.roomId);
                setRecordingState(prev => ({ ...prev, [r.roomId]: { ...next, isSaved: true } }));
                result.bills++;
                savedRooms.push(room.room_number);
            } catch {
                result.failed.push(r.roomId);
            }
        }

        if (savedRooms.length > 0) {
            logActivity({
                action: 'CREATE', resourceType: 'meter', resourceLabel: `AI batch · ${savedRooms.length} rooms · ${currentMonth}`,
                after: { rooms: savedRooms, bills: result.bills, drafts: result.drafts },
                note: `AI-assisted, human-confirmed; warnings overridden: ${meta.overriddenCount}`,
            });
        }
        return result;
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
                const text = (e.target?.result as string).replace(/^\uFEFF/, ''); // strip BOM
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

    // Enter on a "เดือนนี้" input jumps to the same meter of the next visible, unlocked room
    const focusNextRoom = (roomId: string) => {
        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-meter-curr]:not(:disabled)'));
        const idx = inputs.findIndex(el => el.dataset.meterCurr === roomId);
        const next = inputs[idx + 1];
        if (next) {
            next.focus();
            next.select();
            next.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else {
            inputs[idx]?.blur();
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

        const { rent: effectiveRentPreview, prorate: prorateInfo } = rentFor(room);
        const { electricityRate: roomElecRate, waterConfig: roomWaterCfg } = getEffectiveRates(room, config);

        // Calculate preview
        const calculation = state.currElec && state.currWater
            ? calculateFullBill(prevElec, currElec, prevWater, currWater, config, effectiveRentPreview, room.tenant_count, roomElecRate, roomWaterCfg, roomFees(commonFees, room), room.common_fee_overrides, currentMonth)
            : null;

        // prevElec/prevWater อาจเป็น '' (แทน 0) ถือว่า valid — ตรวจแค่ currElec/currWater ต้องกรอก
        const canSave = state.currElec !== '' && state.currWater !== '' && elecValidation.valid && waterValidation.valid;

        // Values for the meter shown on the active tab
        const isElec = meterTab === 'elec';
        const prevField = isElec ? 'prevElec' : 'prevWater';
        const currField = isElec ? 'currElec' : 'currWater';
        const prevValue = isElec ? state.prevElec : state.prevWater;
        const currValue = isElec ? state.currElec : state.currWater;
        const units = isElec ? elecUnits : waterUnits;
        const validation = isElec ? elecValidation : waterValidation;
        const otherMissing = isElec ? state.currWater === '' : state.currElec === '';

        // ── Photo reader confirm handler ────────────────────────────────────────
        const handlePhotoConfirm = (result: MeterReadResult) => {
            const field = result.meterType === 'electric'
                ? 'currElec'
                : result.meterType === 'water'
                    ? 'currWater'
                    : null;

            if (field) {
                // ใส่ค่าลง field ที่ตรงกับประเภทมิเตอร์
                handleInputChange(room.id, field, result.reading.toString());
            } else {
                // ไม่ทราบประเภท — ใส่ลงมิเตอร์ของแท็บที่เปิดอยู่
                handleInputChange(room.id, currField, result.reading.toString());
            }
            setPhotoReaderId(null);
        };

        return (
            <div key={room.id} className={`room-card ${state.isSaved ? 'saved' : ''}`}>
                <div className="room-card-header">
                    <span className="room-number" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Home size={18} /> ห้อง {room.room_number}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {/* ปุ่มถ่ายรูป — เฉพาะ Plus/Pro และห้องที่ยังไม่ lock */}
                        {canUseMeterPhoto && !state.isLocked && (
                            <button
                                className="btn-meter-photo"
                                onClick={() => setPhotoReaderId(room.id)}
                                title="อ่านมิเตอร์จากรูปถ่าย (AI)"
                            >
                                <Camera size={15} />
                                <span>AI อ่านรูป</span>
                            </button>
                        )}
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
                </div>

                {/* MeterPhotoReader modal */}
                {photoReaderId === room.id && (
                    <MeterPhotoReader
                        roomNumber={room.room_number}
                        onConfirm={handlePhotoConfirm}
                        onClose={() => setPhotoReaderId(null)}
                    />
                )}

                {/* Meter for the active tab (ไฟฟ้า or น้ำประปา) */}
                <div className="meter-section">
                    <div className="meter-label">
                        {isElec ? <Zap size={16} color="#F59E2E" /> : <Droplets size={16} color="#0A6CC2" />}
                        {isElec ? 'มิเตอร์ไฟฟ้า' : 'มิเตอร์น้ำประปา'}
                    </div>
                    <div className="meter-row">
                        <div className="meter-input-group">
                            <span className="meter-input-label">เดือนก่อน</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                className="meter-input meter-input-prev"
                                placeholder="0"
                                value={prevValue}
                                onChange={e => handleInputChange(room.id, prevField, e.target.value)}
                                disabled={state.isLocked}
                            />
                        </div>
                        <ArrowRight size={16} className="meter-arrow" />
                        <div className="meter-input-group">
                            <span className="meter-input-label">เดือนนี้</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                enterKeyHint="next"
                                data-meter-curr={room.id}
                                className={`meter-input ${validation.warning ? 'error' : ''}`}
                                placeholder="0"
                                value={currValue}
                                onChange={e => handleInputChange(room.id, currField, e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') focusNextRoom(room.id); }}
                                disabled={state.isLocked}
                            />
                        </div>
                        <span className="meter-units">
                            {currValue && prevValue && (
                                <span className={`units-badge ${units < 0 ? 'text-danger' : ''}`}>
                                    {units >= 0 ? '+' : ''}{units} หน่วย
                                </span>
                            )}
                        </span>
                    </div>
                    {validation.warning && (
                        <div className="form-error flex items-center gap-2 mt-2">
                            <AlertTriangle size={14} />
                            {validation.warning}
                        </div>
                    )}
                    {/* The other meter is still missing — a bill needs both readings */}
                    {!state.isLocked && otherMissing && (
                        <button
                            type="button"
                            onClick={() => changeMeterTab(isElec ? 'water' : 'elec')}
                            style={{
                                marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted, #557089)',
                            }}
                        >
                            {isElec ? <Droplets size={13} color="#0A6CC2" /> : <Zap size={13} color="#F59E2E" />}
                            {isElec ? 'ยังไม่ได้จดมิเตอร์น้ำ' : 'ยังไม่ได้จดมิเตอร์ไฟ'} — ไปจด
                            <ArrowRight size={12} />
                        </button>
                    )}
                </div>

                {/* Bill Preview */}
                {calculation && (
                    <div className="bill-preview">
                        {isElec ? (
                            <div className="bill-row">
                                <span className="bill-label">
                                    <Zap size={14} color="#F59E2E" />
                                    ค่าไฟ ({calculation.elec_units} หน่วย × {roomElecRate}฿)
                                </span>
                                <span className="bill-value">{formatCurrency(calculation.elec_bill)}</span>
                            </div>
                        ) : (
                            <div className="bill-row">
                                <span className="bill-label">
                                    <Droplets size={14} color="#0A6CC2" />
                                    {roomWaterCfg.type === 'normal'
                                        ? `ค่าน้ำ (${calculation.water_units} หน่วย × ${roomWaterCfg.unit_rate}฿)`
                                        : `ค่าน้ำ ${calculation.water_excess_units > 0 ? `(เกิน ${calculation.water_excess_units} หน่วย)` : '(เหมา)'}`
                                    }
                                </span>
                                <span className="bill-value">{formatCurrency(calculation.water_bill)}</span>
                            </div>
                        )}
                        <div className="bill-row">
                            <span className="bill-label">
                                {isElec ? <Droplets size={14} color="#0A6CC2" /> : <Zap size={14} color="#F59E2E" />}
                                {isElec ? 'ค่าน้ำ' : 'ค่าไฟ'}
                            </span>
                            <span className="bill-value">{formatCurrency(isElec ? calculation.water_bill : calculation.elec_bill)}</span>
                        </div>
                        <div className="bill-row">
                            <span className="bill-label">
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><Home size={14} color="#15803D" /> ค่าห้อง</span>
                                {room.rent_type === 'semester' && (
                                    <span style={{ fontSize: '0.75rem', color: 'var(--color-warning)', marginLeft: '4px' }}>(รายเทอม)</span>
                                )}
                                {prorateInfo && (
                                    <span className="rent-prorate-note" title={`ค่าเช่าเต็มเดือน ${formatCurrency(prorateInfo.full_rent)}`}>
                                        คิด {prorateInfo.days}/{prorateInfo.days_in_month} วัน
                                    </span>
                                )}
                            </span>
                            <span className="bill-value">{formatCurrency(effectiveRentPreview)}</span>
                        </div>
                        {calculation.common_fee > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                <div style={{ color: 'var(--color-text-muted)' }}>ส่วนกลาง</div>
                                <div style={{ color: 'var(--color-text)', fontWeight: 600 }}>฿{formatCurrency(calculation.common_fee)}</div>
                            </div>
                        )}
                        <div className="bill-row total">
                            <span className="bill-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Banknote size={16} /> รวมทั้งสิ้น</span>
                            <span className="bill-value">{formatCurrency(calculation.total_bill)}</span>
                        </div>
                    </div>
                )}

                {/* Save & Clear Buttons */}
                <div className="room-card-actions flex flex-wrap gap-2">
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
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>บันทึกแล้ว <Check size={14} /></span>
                            </>
                        ) : (
                            <>
                                <Save size={18} />
                                {!state.isLocked && otherMissing && currValue !== ''
                                    ? (isElec ? 'รอจดค่าน้ำ' : 'รอจดค่าไฟ')
                                    : 'บันทึก'}
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

    const filteredRooms = activeRooms.filter(room => {
        if (searchQuery && !room.room_number.toLowerCase().includes(searchQuery.toLowerCase())) {
            return false;
        }
        const state = recordingState[room.id];
        const isSaved = state?.isSaved || state?.isLocked;
        if (filterStatus === 'saved' && !isSaved) return false;
        if (filterStatus === 'unsaved' && isSaved) return false;
        return true;
    });

    return (
        <div>
        {/* Bulk save progress modal */}
        {bulkProgress && (
            <div style={{
                position: 'fixed', inset: 0, zIndex: 500,
                background: 'rgba(0,0,0,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '1rem',
                opacity: modalIn ? 1 : 0,
                transition: 'opacity 0.25s ease',
            }}>
                <div style={{
                    background: '#102a43',
                    border: '1px solid rgba(15, 76, 129,0.3)',
                    borderRadius: '24px',
                    padding: '2rem',
                    width: '100%',
                    maxWidth: '340px',
                    textAlign: 'center',
                    boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
                    transform: modalIn ? 'scale(1) translateY(0)' : 'scale(0.7) translateY(40px)',
                    opacity: modalIn ? 1 : 0,
                    transition: 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease',
                }}>
                    {/* Icon circle */}
                    <div style={{
                        width: 64, height: 64, borderRadius: '50%',
                        background: bulkProgress.done
                            ? 'linear-gradient(135deg,#22A35A,#15803D)'
                            : 'linear-gradient(135deg,#0A6CC2,#0F4C81)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 1.25rem',
                        boxShadow: bulkProgress.done
                            ? '0 8px 24px rgba(34, 163, 90,0.45)'
                            : '0 8px 24px rgba(10, 108, 194,0.45)',
                        transition: 'background 0.4s ease, box-shadow 0.4s ease',
                        transform: bulkProgress.done ? 'scale(1.1)' : 'scale(1)',
                    }}>
                        {bulkProgress.done
                            ? <CheckCircle size={30} color="#fff" />
                            : <Layers size={26} color="#fff" style={{ animation: 'spin 1.5s linear infinite' }} />}
                    </div>

                    {/* Title */}
                    <div style={{ fontWeight: 800, fontSize: '1.125rem', color: '#fff', marginBottom: '0.25rem' }}>
                        {bulkProgress.done ? 'บันทึกเรียบร้อยแล้ว!' : 'กำลังบันทึก...'}
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: 'rgba(165,180,252,0.7)', marginBottom: '1.5rem', minHeight: '1.3em' }}>
                        {bulkProgress.done
                            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>สำเร็จ {bulkProgress.total - bulkProgress.failed} ห้อง{bulkProgress.failed > 0 ? ` · ล้มเหลว ${bulkProgress.failed}` : <CheckCircle size={12} color="#22A35A" />}</span>
                            : `ห้อง ${bulkProgress.roomNumber}`}
                    </div>

                    {/* Counter */}
                    <div style={{ marginBottom: '1.25rem' }}>
                        <span style={{
                            fontSize: '3.5rem', fontWeight: 900, color: '#fff',
                            fontFamily: 'var(--font-mono)', letterSpacing: '-0.03em',
                            lineHeight: 1,
                        }}>
                            {bulkProgress.current}
                        </span>
                        <span style={{ fontSize: '1.5rem', color: 'rgba(165,180,252,0.4)', fontWeight: 400 }}>
                            /{bulkProgress.total}
                        </span>
                    </div>

                    {/* Progress bar */}
                    <div style={{
                        height: 10, borderRadius: 999,
                        background: 'rgba(255,255,255,0.08)',
                        overflow: 'hidden', marginBottom: '0.5rem',
                    }}>
                        <div style={{
                            height: '100%', borderRadius: 999,
                            background: bulkProgress.done
                                ? 'linear-gradient(90deg,#22A35A,#22A35A)'
                                : 'linear-gradient(90deg,#0A6CC2,#3D8FD6)',
                            width: `${Math.round((bulkProgress.current / bulkProgress.total) * 100)}%`,
                            transition: 'width 0.35s ease, background 0.4s ease',
                            boxShadow: '0 0 10px rgba(15, 76, 129,0.6)',
                        }} />
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'rgba(165,180,252,0.4)', marginBottom: '1.5rem' }}>
                        {Math.round((bulkProgress.current / bulkProgress.total) * 100)}%
                    </div>

                    {bulkProgress.done ? (
                        <button
                            onClick={() => setBulkProgress(null)}
                            style={{
                                width: '100%', padding: '0.75rem',
                                background: 'linear-gradient(135deg,#22A35A,#15803D)',
                                color: '#fff', border: 'none', borderRadius: '12px',
                                fontWeight: 700, fontSize: '0.9375rem', cursor: 'pointer',
                                boxShadow: '0 4px 16px rgba(34, 163, 90,0.4)',
                            }}
                        >
                            ปิด
                        </button>
                    ) : (
                        <div style={{ color: 'rgba(165,180,252,0.5)', fontSize: '0.8125rem' }}>
                            กรุณารอสักครู่...
                        </div>
                    )}
                </div>
            </div>
        )}
            {showBatch && ownerUid && buildingId && (
                <MeterBatchModal
                    ownerUid={ownerUid}
                    buildingId={buildingId}
                    rooms={rooms}
                    monthLabel={formatMonthThai(currentMonth)}
                    getContext={getBatchContext}
                    onSave={saveBatchReadings}
                    onClose={() => setShowBatch(false)}
                />
            )}
            <div className="page-header">
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={28} /> จดมิเตอร์</h1>
                    <p className="page-subtitle">กรอกเลขมิเตอร์และกดบันทึกแต่ละห้อง</p>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', flexShrink: 0 }}>
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
                    {canUseMeterPhoto && ownerUid && buildingId && (
                        <button
                            className="btn btn-outline btn-sm"
                            onClick={() => setShowBatch(true)}
                            title="อ่านมิเตอร์จากรูปหลายรูปพร้อมกันด้วย AI"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontWeight: 700 }}
                        >
                            <Camera size={15} /> AI อ่านเป็นชุด
                        </button>
                    )}
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
                    background: importResult.updated > 0 ? '#EFF8F2' : '#FDEBD3',
                    border: `1px solid ${importResult.updated > 0 ? '#A7DDBB' : '#FBD9A8'}`,
                    color: importResult.updated > 0 ? '#166534' : '#9A3412',
                    borderRadius: '10px', padding: '0.625rem 0.875rem',
                    fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.75rem',
                }}>
                    <CheckCircle size={15} color={importResult.updated > 0 ? '#15803D' : '#E8740C'} />
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

            {/* Meter type tabs — record electricity and water separately */}
            <div
                role="tablist"
                aria-label="ประเภทมิเตอร์"
                style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem',
                    marginBottom: '1rem',
                }}
            >
                {([
                    { id: 'elec', label: 'ไฟฟ้า', Icon: Zap, color: '#F59E2E', tint: '#FEF4E6', field: 'currElec' },
                    { id: 'water', label: 'น้ำประปา', Icon: Droplets, color: '#0A6CC2', tint: '#E8F2FB', field: 'currWater' },
                ] as const).map(t => {
                    const active = meterTab === t.id;
                    const done = activeRooms.filter(r => {
                        const s = recordingState[r.id];
                        return s && (s.isLocked || s[t.field] !== '');
                    }).length;
                    const complete = activeRooms.length > 0 && done === activeRooms.length;
                    return (
                        <button
                            key={t.id}
                            role="tab"
                            aria-selected={active}
                            onClick={() => changeMeterTab(t.id)}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                padding: '0.75rem 0.5rem', borderRadius: '12px', cursor: 'pointer',
                                border: `2px solid ${active ? t.color : 'var(--color-border, #DCE5EF)'}`,
                                background: active ? t.tint : 'var(--color-surface, #fff)',
                                color: active ? 'var(--color-text, #102A43)' : 'var(--color-text-muted, #557089)',
                                fontWeight: active ? 800 : 600, fontSize: '0.95rem',
                                transition: 'all 0.15s',
                            }}
                        >
                            <t.Icon size={18} color={t.color} />
                            {t.label}
                            <span style={{
                                fontSize: '0.75rem', fontWeight: 700, padding: '0.1rem 0.5rem', borderRadius: 999,
                                background: complete ? '#EFF8F2' : active ? '#fff' : 'var(--color-gray-100, #EBF1F7)',
                                color: complete ? '#15803D' : 'var(--color-text-muted, #557089)',
                                fontFamily: 'var(--font-mono)',
                            }}>
                                {done}/{activeRooms.length}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Search and Filter Bar */}
            <div className="card mb-6" style={{ padding: '0.75rem 0.875rem', display: 'flex', flexWrap: 'wrap', gap: '0.625rem', alignItems: 'center' }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    background: 'var(--color-gray-50, #F4F7FB)',
                    border: '1px solid var(--color-border, #DCE5EF)',
                    borderRadius: '10px', padding: '0.5rem 0.75rem', flex: 1, minWidth: '200px'
                }}>
                    <Search size={15} color="var(--color-text-muted, #8FA3B8)" />
                    <input
                        type="text"
                        placeholder="ค้นหาเลขห้อง..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        style={{
                            border: 'none', background: 'none', outline: 'none',
                            flex: 1, fontSize: '0.875rem', color: 'var(--color-text, #102A43)',
                        }}
                    />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-muted, #8FA3B8)', display: 'flex' }}>
                            <X size={15} />
                        </button>
                    )}
                </div>

                <div style={{
                    display: 'flex', background: 'var(--color-gray-100, #EBF1F7)',
                    borderRadius: '10px', padding: '3px', gap: '2px', flexWrap: 'wrap'
                }}>
                    {([
                        { id: 'all', label: 'ทั้งหมด' },
                        { id: 'unsaved', label: 'รอบันทึก' },
                        { id: 'saved', label: 'บันทึกแล้ว' },
                    ] as const).map(f => {
                        const active = filterStatus === f.id;
                        return (
                            <button
                                key={f.id}
                                onClick={() => setFilterStatus(f.id)}
                                style={{
                                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    gap: '0.3rem', padding: '0.45rem 0.75rem', borderRadius: '8px',
                                    border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '0.78rem',
                                    fontWeight: active ? 700 : 500, transition: 'all 0.15s',
                                    background: active ? '#fff' : 'transparent',
                                    color: active ? 'var(--color-primary, #0F4C81)' : 'var(--color-text-muted, #557089)',
                                    boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                                }}
                            >
                                {f.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {filteredRooms.length === 0 ? (
                <div className="card empty-state">
                    <div><Home size={48} color="#8FA3B8" style={{ margin: '0 auto 1rem' }} /></div>
                    <h3>ไม่พบห้องพัก</h3>
                    <p>ไม่มีห้องพักที่ตรงกับเงื่อนไขการค้นหา</p>
                </div>
            ) : (
                <div className="room-grid">
                    {filteredRooms.map(renderRoomCard)}
                </div>
            )}
        </div>
    );
}
