import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    collection, doc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, serverTimestamp, writeBatch
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { logActivity, diffFields } from '../utils/auditLog';
import { findDuplicates, MAX_BULK_ROOMS } from '../utils/bulkRooms';
import { defaultRentType } from '../utils/workspaceTerminology';
import type { DormConfig, Room, MonthlyBill, UserProfile, Fine, CommonFee } from '../types';
import { getCurrentMonth, calculateFullBill, getEffectiveRates, getNextMonth, getPreviousMonth } from '../utils/calculations';

// How many months of bills the realtime listener keeps in memory, anchored on the
// selected month. Bounds reads + memory regardless of how long a dorm has existed —
// the single most important change for supporting many dorms. Older months load
// automatically when the user navigates to them (the window re-anchors).
const BILLS_WINDOW_MONTHS = 6;

const DEFAULT_CONFIG: DormConfig = {
    building_type: 'dormitory',
    electricity_rate: 8,
    water_config: {
        type: 'flat_rate_tier',
        flat_price: 250,
        flat_limit_unit: 10,
        excess_unit_rate: 25
    },
    commercial_water_config: {
        type: 'normal',
        unit_rate: 24
    },
    room_rent: 3500
};

export function useFirestore(userId: string | null, buildingId: string | null, anchorMonth?: string) {
    const [config, setConfigState] = useState<DormConfig>(DEFAULT_CONFIG);
    const [rooms, setRoomsState] = useState<Room[]>([]);
    const [bills, setBillsState] = useState<MonthlyBill[]>([]);
    const [fines, setFinesState] = useState<Fine[]>([]);
    const [commonFees, setCommonFeesState] = useState<CommonFee[]>([]);
    const [loading, setLoading] = useState(true);

    // Base path scoped to the active building
    const userPath = userId && buildingId
        ? `users/${userId}/buildings/${buildingId}`
        : null;

    // Month window the bills listener subscribes to, anchored on the selected month.
    // 'YYYY-MM' strings compare lexicographically, so a range query on `month` works
    // with the automatic single-field index — no composite index needed.
    const { windowStart, windowEnd } = useMemo(() => {
        const anchor = anchorMonth || getCurrentMonth();
        let start = anchor;
        for (let i = 0; i < BILLS_WINDOW_MONTHS; i++) start = getPreviousMonth(start);
        return { windowStart: start, windowEnd: getNextMonth(anchor) };
    }, [anchorMonth]);

    // Loading coordination across config/rooms (per building) and bills (per window).
    const loadedRef = useRef({ config: false, rooms: false, bills: false, fines: false, commonFees: false });
    // Track whether we've already run self-heal for this building session.
    const syncedDormCodeRef = useRef<string | null>(null);
    const settle = () => {
        const l = loadedRef.current;
        if (l.config && l.rooms && l.bills && l.fines && l.commonFees) setLoading(false);
    };

    // Config + rooms — re-subscribe only when the active building changes.
    useEffect(() => {
        if (!userPath) {
            setLoading(false);
            return;
        }

        // New building → show the loading screen until its data arrives.
        setLoading(true);
        loadedRef.current = { config: false, rooms: false, bills: false, fines: false, commonFees: false };

        const unsubConfig = onSnapshot(doc(db, userPath, 'data', 'config'), async (snap) => {
            if (snap.exists()) {
                // Always merge with DEFAULT_CONFIG so missing fields (old data) never crash
                const raw = snap.data() as Partial<DormConfig>;
                const merged: DormConfig = {
                    ...DEFAULT_CONFIG,
                    ...raw,
                    water_config: { ...DEFAULT_CONFIG.water_config, ...raw.water_config },
                    commercial_water_config: raw.commercial_water_config
                        ? { ...DEFAULT_CONFIG.water_config, ...raw.commercial_water_config }
                        : undefined,
                };
                setConfigState(merged);

                // ── Self-heal: ลูกค้าเก่าที่มี dorm_code แต่ dorm_codes collection ว่าง ──
                // (เกิดจาก Firestore rules เดิมที่ block การเขียน)
                // ตรวจครั้งเดียวต่อ building session เพื่อไม่ให้ query ซ้ำซ้อน
                const dc = merged.dorm_code;
                if (dc && userId && buildingId && syncedDormCodeRef.current !== dc) {
                    syncedDormCodeRef.current = dc;
                    try {
                        // dorm_codes is write-only for clients (rules: read false), so upsert without reading first.
                        // Rules allow it only when the code is new or already ours.
                        await setDoc(doc(db, 'dorm_codes', dc), {
                            uid: userId,
                            building_id: buildingId,
                            dorm_name: merged.bill_customization?.dorm_name || '',
                            due_day: merged.bill_customization?.due_day || 5,
                            updated_at: serverTimestamp(),
                        }, { merge: true });
                    } catch (e) {
                        // ไม่ block การโหลดแอป — log เพื่อ debug เท่านั้น
                        console.warn('[HorCare] dorm_code self-heal failed:', e);
                    }
                }
            } else {
                setDoc(doc(db, userPath, 'data', 'config'), DEFAULT_CONFIG);
                setConfigState(DEFAULT_CONFIG);
            }
            loadedRef.current.config = true;
            settle();
        });

        const roomsRef = collection(db, userPath, 'rooms');
        const roomsQuery = query(roomsRef, orderBy('room_number'));
        const unsubRooms = onSnapshot(roomsQuery, (snap) => {
            const roomList: Room[] = snap.docs.map(d => ({ ...d.data(), id: d.id } as Room));
            setRoomsState(roomList);
            loadedRef.current.rooms = true;
            settle();
        });

        const finesRef = collection(db, userPath, 'fines');
        const unsubFines = onSnapshot(finesRef, (snap) => {
            const list: Fine[] = snap.docs.map(d => ({ ...d.data(), id: d.id } as Fine));
            list.sort((a, b) => b.date.localeCompare(a.date));
            setFinesState(list);
            loadedRef.current.fines = true;
            settle();
        }, () => { loadedRef.current.fines = true; settle(); });

        const commonFeesRef = collection(db, userPath, 'common_fees');
        const unsubCommonFees = onSnapshot(commonFeesRef, (snap) => {
            const list: CommonFee[] = snap.docs.map(d => ({ ...d.data(), id: d.id } as CommonFee));
            list.sort((a, b) => a.created_at.localeCompare(b.created_at));
            setCommonFeesState(list);
            loadedRef.current.commonFees = true;
            settle();
        }, () => { loadedRef.current.commonFees = true; settle(); });

        return () => {
            unsubConfig();
            unsubRooms();
            unsubFines();
            unsubCommonFees();
        };
    }, [userPath]); // eslint-disable-line react-hooks/exhaustive-deps -- buildingId/userId captured via userPath

    // Bills — re-subscribe when the building OR the month window changes. Navigating
    // to an older month re-anchors the window silently (no full-screen reload).
    useEffect(() => {
        if (!userPath) return;

        const billsRef = collection(db, userPath, 'bills');
        const billsQuery = query(
            billsRef,
            where('month', '>=', windowStart),
            where('month', '<=', windowEnd),
        );
        const unsubBills = onSnapshot(billsQuery, (snap) => {
            const billList: MonthlyBill[] = snap.docs.map(d => ({ ...d.data(), id: d.id } as MonthlyBill));
            setBillsState(billList);
            loadedRef.current.bills = true;
            settle();
        });

        return () => unsubBills();
    }, [userPath, windowStart, windowEnd]);

    // Save config
    const saveConfig = useCallback(async (newConfig: DormConfig) => {
        if (!userPath || !userId || !buildingId) return;
        await setDoc(doc(db, userPath, 'data', 'config'), newConfig);

        // Only the names of the changed settings are logged — values can be large
        // (logo base64) or sensitive (portal PIN).
        const changedKeys = (Object.keys(newConfig) as (keyof DormConfig)[])
            .filter(k => JSON.stringify(newConfig[k]) !== JSON.stringify(config[k]));
        if (changedKeys.length > 0) {
            logActivity({
                action: 'UPDATE', resourceType: 'config', resourceId: 'config',
                resourceLabel: 'Property settings', note: `changed: ${changedKeys.join(', ')}`,
            });
        }

        // Sync dorm logo to building document
        try {
            const logo = newConfig.bill_customization?.dorm_logo;
            await updateDoc(doc(db, `users/${userId}/buildings`, buildingId), {
                logo: logo || null
            });
        } catch (err) {
            console.warn('Could not sync logo to building document:', err);
        }

        // Recalculate all unlocked bills for the current UI month and calendar month
        // to reflect the new global settings
        const monthsToRecalc = [...new Set([getCurrentMonth(), anchorMonth].filter(Boolean))] as string[];

        for (const month of monthsToRecalc) {
            const billsInMonth = bills.filter(b => b.month === month && !b.is_locked);
            for (const existingBill of billsInMonth) {
                const room = rooms.find(r => r.id === existingBill.room_id);
                if (!room) continue;

                const effectiveRent = ['semester', 'yearly', 'daily'].includes(room.rent_type) ? 0 : (room.rent_amount ?? newConfig.room_rent);
                const { electricityRate, waterConfig } = getEffectiveRates(room, newConfig);

                const calculation = calculateFullBill(
                    existingBill.prev_elec,
                    existingBill.curr_elec,
                    existingBill.prev_water,
                    existingBill.curr_water,
                    newConfig,
                    effectiveRent,
                    room.tenant_count,
                    electricityRate,
                    waterConfig,
                    commonFees,
                    room.common_fee_overrides,
                    month
                );

                const updatedBill: Partial<MonthlyBill> = {
                    elec_units: calculation.elec_units,
                    elec_bill: calculation.elec_bill,
                    water_units: calculation.water_units,
                    water_bill: calculation.water_bill,
                    water_flat_amount: calculation.water_flat_amount,
                    water_excess_units: calculation.water_excess_units,
                    water_excess_amount: calculation.water_excess_amount,
                    room_rent: effectiveRent,
                    common_fee: calculation.common_fee,
                    applied_common_fees: calculation.applied_common_fees,
                    total_bill: calculation.total_bill,
                    updated_at: new Date().toISOString()
                };

                await updateDoc(doc(db, userPath, 'bills', existingBill.id), updatedBill);
            }
        }

        // Sync dorm_code lookup table so LINE webhook can find this building
        if (newConfig.dorm_code) {
            try {
                await setDoc(doc(db, 'dorm_codes', newConfig.dorm_code), {
                    uid: userId,
                    building_id: buildingId,
                    dorm_name: newConfig.bill_customization?.dorm_name || '',
                    due_day: newConfig.bill_customization?.due_day || 5,
                    updated_at: serverTimestamp()
                });
            } catch (e) {
                console.error('Failed to sync dorm_code lookup table:', e);
                throw e; // re-throw ให้ UI แสดง error ได้
            }
        }
    }, [userPath, userId, buildingId, bills, rooms, commonFees, anchorMonth, config]);

    // Room operations
    const addRoom = useCallback(async (roomNumber: string) => {
        if (!userPath) return;
        const roomId = `room_${Date.now()}`;
        const newRoom: Room = {
            id: roomId,
            room_number: roomNumber,
            room_type: config.building_type === 'commercial' ? 'commercial' : 'dormitory',
            current_meter_elec: 0,
            current_meter_water: 0,
            is_active: true,
            rent_amount: config.room_rent,
            rent_type: defaultRentType(config.building_type, config.market_config?.default_rent_cycle)
        };
        await setDoc(doc(db, userPath, 'rooms', roomId), newRoom);
        logActivity({
            action: 'CREATE', resourceType: 'room', resourceId: roomId,
            resourceLabel: `Room ${roomNumber}`, after: { room_number: roomNumber, rent_amount: newRoom.rent_amount },
        });
        return newRoom;
    }, [userPath, config.room_rent, config.building_type, config.market_config?.default_rent_cycle]);

    /**
     * Create many rooms atomically per chunk. Rejects (creating nothing) if any room
     * number already exists in this property or repeats inside the request.
     */
    const addRoomsBulk = useCallback(async (inputs: Partial<Room>[]): Promise<{ created: number }> => {
        if (!userPath) throw new Error('no_property');
        if (inputs.length === 0) return { created: 0 };
        if (inputs.length > MAX_BULK_ROOMS) throw new Error('too_many');

        const dupes = findDuplicates(
            inputs.map(i => String(i.room_number ?? '')),
            rooms.map(r => r.room_number),
        );
        if (dupes.length > 0) {
            const err = new Error('duplicate_room_numbers') as Error & { duplicates?: string[] };
            err.duplicates = dupes;
            throw err;
        }

        const stamp = Date.now();
        const docs: Room[] = inputs.map((input, i) => ({
            room_type: config.building_type === 'commercial' ? 'commercial' : 'dormitory',
            current_meter_elec: 0,
            current_meter_water: 0,
            is_active: true,
            rent_amount: config.room_rent,
            rent_type: defaultRentType(config.building_type, config.market_config?.default_rent_cycle),
            ...input,
            room_number: String(input.room_number).trim(),
            id: `room_${stamp}_${i}`,
        }));

        // Firestore batches are capped at 500 writes.
        for (let i = 0; i < docs.length; i += 400) {
            const batch = writeBatch(db);
            for (const r of docs.slice(i, i + 400)) {
                // Firestore rejects `undefined` field values.
                const clean = JSON.parse(JSON.stringify(r)) as Room;
                batch.set(doc(db, userPath, 'rooms', r.id), clean);
            }
            await batch.commit();
        }

        logActivity({
            action: 'CREATE', resourceType: 'room', resourceId: null,
            resourceLabel: `${docs.length} rooms (${docs[0].room_number} – ${docs[docs.length - 1].room_number})`,
            after: { count: docs.length, first: docs[0].room_number, last: docs[docs.length - 1].room_number },
            note: 'bulk create',
        });
        return { created: docs.length };
    }, [userPath, rooms, config.building_type, config.room_rent, config.market_config?.default_rent_cycle]);

    const updateRoom = useCallback(async (roomId: string, updates: Partial<Room>) => {
        if (!userPath) return;

        // 1. Update the room
        await updateDoc(doc(db, userPath, 'rooms', roomId), updates);

        const roomDiff = diffFields(rooms.find(r => r.id === roomId), updates);
        if (roomDiff) {
            logActivity({
                action: 'UPDATE',
                // Meter edits get their own resource type so they are easy to filter.
                resourceType: 'current_meter_elec' in updates || 'current_meter_water' in updates ? 'meter' : 'room',
                resourceId: roomId,
                resourceLabel: `Room ${rooms.find(r => r.id === roomId)?.room_number ?? roomId}`,
                before: roomDiff.before, after: roomDiff.after,
            });
        }

        // 2. Recalculate this room's bills for the months the owner can be working
        // in: the current calendar month AND the month selected in the UI. Meter
        // readings are kept from the bill snapshot — only the amounts are repriced
        // with the new room settings. Locked (closed) months are never touched.
        const currentRoom = rooms.find(r => r.id === roomId);
        if (!currentRoom) return;

        const newRoom = { ...currentRoom, ...updates };

        const effectiveRent = ['semester', 'yearly', 'daily'].includes(newRoom.rent_type) ? 0 : (newRoom.rent_amount ?? config.room_rent);
        const { electricityRate, waterConfig } = getEffectiveRates(newRoom, config);

        const monthsToRecalc = [...new Set([getCurrentMonth(), anchorMonth].filter(Boolean))] as string[];

        for (const month of monthsToRecalc) {
            const existingBill = bills.find(b => b.room_id === roomId && b.month === month);
            if (!existingBill || existingBill.is_locked) continue;

            // Use meter readings from the existing bill (snapshot)
            const calculation = calculateFullBill(
                existingBill.prev_elec,
                existingBill.curr_elec,
                existingBill.prev_water,
                existingBill.curr_water,
                config,
                effectiveRent,
                newRoom.tenant_count,
                electricityRate,
                waterConfig,
                commonFees,
                newRoom.common_fee_overrides,
                month
            );

            const updatedBill: Partial<MonthlyBill> = {
                elec_units: calculation.elec_units,
                elec_bill: calculation.elec_bill,
                water_units: calculation.water_units,
                water_bill: calculation.water_bill,
                water_flat_amount: calculation.water_flat_amount,
                water_excess_units: calculation.water_excess_units,
                water_excess_amount: calculation.water_excess_amount,
                room_rent: effectiveRent,
                total_bill: calculation.total_bill,
                tenant_count: newRoom.tenant_count || 1, // Update snapshot of tenant count
                updated_at: new Date().toISOString()
            };

            await updateDoc(doc(db, userPath, 'bills', existingBill.id), updatedBill);
        }
    }, [userPath, bills, rooms, config, commonFees, anchorMonth]);

    const deleteRoom = useCallback(async (roomId: string) => {
        if (!userPath) return;
        const existing = rooms.find(r => r.id === roomId);
        await deleteDoc(doc(db, userPath, 'rooms', roomId));
        logActivity({
            action: 'DELETE', resourceType: 'room', resourceId: roomId,
            resourceLabel: `Room ${existing?.room_number ?? roomId}`,
            before: existing ? { room_number: existing.room_number, rent_amount: existing.rent_amount } : null,
        });
    }, [userPath, rooms]);

    const deleteBill = useCallback(async (billId: string) => {
        if (!userPath) return;
        await deleteDoc(doc(db, userPath, 'bills', billId));
    }, [userPath]);

    // Partial update of payment fields (manual confirm / undo from PaymentsPage)
    const updateBillPayment = useCallback(async (billId: string, fields: Partial<MonthlyBill>) => {
        if (!userPath) return;
        await updateDoc(doc(db, userPath, 'bills', billId), fields);

        const bill = bills.find(b => b.id === billId);
        const pick = (b: Partial<MonthlyBill> | undefined) => b && ({
            payment_status: b.payment_status, payment_method: b.payment_method,
            paid_amount: b.paid_amount, paid_at: b.paid_at,
        });
        logActivity({
            action: 'PAYMENT_MODIFY', resourceType: 'payment', resourceId: billId,
            resourceLabel: `Room ${bill?.room_number ?? ''} ${bill?.month ?? ''}`.trim(),
            before: pick(bill), after: pick({ ...bill, ...fields }),
        });
    }, [userPath, bills]);

    // Bill operations
    const saveBill = useCallback(async (bill: MonthlyBill) => {
        if (!userPath) return bill;
        const previous = bills.find(b => b.id === bill.id);
        await setDoc(doc(db, userPath, 'bills', bill.id), bill);

        // Meter readings: log only when a reading actually changed (e.g. "Room 305 Meter 1,245 → 1,285").
        if (!previous || previous.curr_elec !== bill.curr_elec || previous.curr_water !== bill.curr_water) {
            logActivity({
                action: previous ? 'UPDATE' : 'CREATE', resourceType: 'meter', resourceId: bill.id,
                resourceLabel: `Room ${bill.room_number} ${bill.month}`,
                before: previous ? { curr_elec: previous.curr_elec, curr_water: previous.curr_water } : null,
                after: { curr_elec: bill.curr_elec, curr_water: bill.curr_water },
            });
        }

        // Also update room meters
        await updateDoc(doc(db, userPath, 'rooms', bill.room_id), {
            current_meter_elec: bill.curr_elec,
            current_meter_water: bill.curr_water
        });

        // Check for next month's bill to update recursively
        const nextMonth = getNextMonth(bill.month);
        const nextMonthBill = bills.find(b => b.room_id === bill.room_id && b.month === nextMonth);

        if (nextMonthBill) {
            // Recalculate next month's bill with new previous readings
            const room = rooms.find(r => r.id === bill.room_id);
            if (room) {
                const effectiveRent = ['semester', 'yearly', 'daily'].includes(room.rent_type) ? 0 : (room.rent_amount ?? config.room_rent);
                const { electricityRate, waterConfig } = getEffectiveRates(room, config);

                const calculation = calculateFullBill(
                    bill.curr_elec, // New prev for next month
                    nextMonthBill.curr_elec,
                    bill.curr_water, // New prev for next month
                    nextMonthBill.curr_water,
                    config,
                    effectiveRent,
                    room.tenant_count,
                    electricityRate,
                    waterConfig,
                    commonFees,
                    room.common_fee_overrides,
                    nextMonth
                );

                const updatedNextBill: Partial<MonthlyBill> = {
                    prev_elec: bill.curr_elec,
                    prev_water: bill.curr_water,
                    elec_units: calculation.elec_units,
                    elec_bill: calculation.elec_bill,
                    water_units: calculation.water_units,
                    water_bill: calculation.water_bill,
                    water_flat_amount: calculation.water_flat_amount,
                    water_excess_units: calculation.water_excess_units,
                    water_excess_amount: calculation.water_excess_amount,
                    total_bill: calculation.total_bill,
                    updated_at: new Date().toISOString()
                };

                await updateDoc(doc(db, userPath, 'bills', nextMonthBill.id), updatedNextBill);
            }
        }

        return bill;
    }, [userPath, bills, rooms, config, commonFees]);

    const getBillForRoom = useCallback((roomId: string, month: string): MonthlyBill | undefined => {
        return bills.find(b => b.room_id === roomId && b.month === month);
    }, [bills]);

    const getBillsForMonth = useCallback((month: string): MonthlyBill[] => {
        return bills.filter(b => b.month === month);
    }, [bills]);

    const getPreviousBill = useCallback((roomId: string, currentMonth: string): MonthlyBill | undefined => {
        const roomBills = bills
            .filter(b => b.room_id === roomId && b.month < currentMonth)
            .sort((a, b) => b.month.localeCompare(a.month));
        return roomBills[0];
    }, [bills]);

    // Close month
    const closeMonth = useCallback(async (month: string) => {
        if (!userPath) return;
        const monthBills = bills.filter(b => b.month === month);

        // Lock all bills for this month
        const lockPromises = monthBills.map(bill =>
            updateDoc(doc(db, userPath, 'bills', bill.id), { is_locked: true })
        );

        // Update room meters
        const meterPromises = rooms.map(room => {
            const bill = monthBills.find(b => b.room_id === room.id);
            if (bill) {
                return updateDoc(doc(db, userPath, 'rooms', room.id), {
                    current_meter_elec: bill.curr_elec,
                    current_meter_water: bill.curr_water
                });
            }
            return Promise.resolve();
        });

        await Promise.all([...lockPromises, ...meterPromises]);
    }, [userPath, bills, rooms]);

    // Unlock month
    const unlockMonth = useCallback(async (month: string) => {
        if (!userPath) return;
        const monthBills = bills.filter(b => b.month === month);

        // Unlock all bills for this month
        const unlockPromises = monthBills.map(bill =>
            updateDoc(doc(db, userPath, 'bills', bill.id), { is_locked: false })
        );

        await Promise.all(unlockPromises);
    }, [userPath, bills]);

    // Stats
    const getMonthStats = useCallback((month: string = getCurrentMonth()) => {
        const monthBills = bills.filter(b => b.month === month);
        const activeRooms = rooms.filter(r => r.is_active !== false);
        const totalRooms = activeRooms.length;
        const totalRevenue = monthBills.reduce((sum, b) => sum + b.total_bill, 0);
        
        // Count how many ACTIVE rooms have saved bills
        const savedCount = activeRooms.filter(room => 
            monthBills.some(b => b.room_id === room.id && b.is_saved)
        ).length;

        const isAllSaved = activeRooms.length > 0 && activeRooms.every(room => 
            monthBills.some(b => b.room_id === room.id && b.is_saved)
        );

        return {
            savedCount,
            totalRooms,
            totalRevenue,
            isAllSaved,
            progress: totalRooms > 0 ? (savedCount / totalRooms) * 100 : 0
        };
    }, [bills, rooms]);

    // Admin functions
    const getAllUsers = useCallback(async () => {
        const usersRef = collection(db, 'users');
        // Fetch all and sort client-side to avoid index requirement
        const snap = await import('firebase/firestore').then(m => m.getDocs(usersRef));
        return snap.docs
            .map(d => d.data() as UserProfile)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }, []);

    const updateUserLicense = useCallback(async (targetUid: string, updates: Partial<UserProfile>) => {
        await updateDoc(doc(db, 'users', targetUid), updates);
    }, []);

    // ── Fines CRUD ──────────────────────────────────────────────────────────────
    const addFine = useCallback(async (data: Omit<Fine, 'id' | 'created_at'>) => {
        if (!userPath) return;
        const now = new Date().toISOString();
        await addDoc(collection(db, userPath, 'fines'), { ...data, created_at: now });
    }, [userPath]);

    const updateFine = useCallback(async (fineId: string, updates: Partial<Fine>) => {
        if (!userPath) return;
        await updateDoc(doc(db, userPath, 'fines', fineId), { ...updates, updated_at: new Date().toISOString() });
    }, [userPath]);

    const deleteFine = useCallback(async (fineId: string) => {
        if (!userPath) return;
        await deleteDoc(doc(db, userPath, 'fines', fineId));
    }, [userPath]);

    // ── Common Fees CRUD ────────────────────────────────────────────────────────
    const addCommonFee = useCallback(async (data: Omit<CommonFee, 'id' | 'created_at'>) => {
        if (!userPath) return;
        const now = new Date().toISOString();
        await addDoc(collection(db, userPath, 'common_fees'), { ...data, created_at: now });
    }, [userPath]);

    const updateCommonFee = useCallback(async (feeId: string, updates: Partial<CommonFee>) => {
        if (!userPath) return;
        await updateDoc(doc(db, userPath, 'common_fees', feeId), { ...updates, updated_at: new Date().toISOString() });
    }, [userPath]);

    const deleteCommonFee = useCallback(async (feeId: string) => {
        if (!userPath) return;
        await deleteDoc(doc(db, userPath, 'common_fees', feeId));
    }, [userPath]);

    return {
        config,
        rooms,
        bills,
        fines,
        commonFees,
        loading,
        saveConfig,
        addRoom,
        addRoomsBulk,
        updateRoom,
        deleteRoom,
        saveBill,
        deleteBill,
        updateBillPayment,
        getBillForRoom,
        getBillsForMonth,
        getPreviousBill,
        closeMonth,
        unlockMonth,
        getMonthStats,
        getAllUsers,
        updateUserLicense,
        addFine,
        updateFine,
        deleteFine,
        addCommonFee,
        updateCommonFee,
        deleteCommonFee,
    };
}
