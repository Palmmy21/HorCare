import { useState, useEffect, useCallback } from 'react';
import {
    collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type { DormConfig, Room, MonthlyBill, UserProfile } from '../types';
import { getCurrentMonth, calculateFullBill, getEffectiveRates, getNextMonth } from '../utils/calculations';

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

export function useFirestore(userId: string | null, buildingId: string | null) {
    const [config, setConfigState] = useState<DormConfig>(DEFAULT_CONFIG);
    const [rooms, setRoomsState] = useState<Room[]>([]);
    const [bills, setBillsState] = useState<MonthlyBill[]>([]);
    const [loading, setLoading] = useState(true);

    // Base path scoped to the active building
    const userPath = userId && buildingId
        ? `users/${userId}/buildings/${buildingId}`
        : null;

    // Load data with realtime listeners
    useEffect(() => {
        if (!userPath) {
            setLoading(false);
            return;
        }

        setLoading(true);
        let configLoaded = false;
        let roomsLoaded = false;
        let billsLoaded = false;

        const checkDone = () => {
            if (configLoaded && roomsLoaded && billsLoaded) setLoading(false);
        };

        // Listen to config
        const unsubConfig = onSnapshot(doc(db, userPath, 'data', 'config'), (snap) => {
            if (snap.exists()) {
                setConfigState(snap.data() as DormConfig);
            } else {
                // Initialize default config
                setDoc(doc(db, userPath, 'data', 'config'), DEFAULT_CONFIG);
                setConfigState(DEFAULT_CONFIG);
            }
            configLoaded = true;
            checkDone();
        });

        // Listen to rooms
        const roomsRef = collection(db, userPath, 'rooms');
        const roomsQuery = query(roomsRef, orderBy('room_number'));
        const unsubRooms = onSnapshot(roomsQuery, (snap) => {
            const roomList: Room[] = snap.docs.map(d => ({ ...d.data(), id: d.id } as Room));
            setRoomsState(roomList);
            roomsLoaded = true;
            checkDone();
        });

        // Listen to bills
        const billsRef = collection(db, userPath, 'bills');
        const unsubBills = onSnapshot(billsRef, (snap) => {
            const billList: MonthlyBill[] = snap.docs.map(d => ({ ...d.data(), id: d.id } as MonthlyBill));
            setBillsState(billList);
            billsLoaded = true;
            checkDone();
        });

        return () => {
            unsubConfig();
            unsubRooms();
            unsubBills();
        };
    }, [userPath]);

    // Save config
    const saveConfig = useCallback(async (newConfig: DormConfig) => {
        if (!userPath || !userId || !buildingId) return;
        await setDoc(doc(db, userPath, 'data', 'config'), newConfig);
        // Sync dorm_code lookup table so LINE webhook can find this building
        if (newConfig.dorm_code) {
            await setDoc(doc(db, 'dorm_codes', newConfig.dorm_code), {
                uid: userId,
                building_id: buildingId,
                dorm_name: newConfig.bill_customization?.dorm_name || '',
                due_day: newConfig.bill_customization?.due_day || 5,
                updated_at: serverTimestamp()
            });
        }
    }, [userPath, userId, buildingId]);

    // Room operations
    const addRoom = useCallback(async (roomNumber: string) => {
        if (!userPath) return;
        const roomId = `room_${Date.now()}`;
        const newRoom: Room = {
            id: roomId,
            room_number: roomNumber,
            room_type: config.building_type || 'dormitory',
            current_meter_elec: 0,
            current_meter_water: 0,
            is_active: true,
            rent_amount: config.room_rent,
            rent_type: 'monthly'
        };
        await setDoc(doc(db, userPath, 'rooms', roomId), newRoom);
        return newRoom;
    }, [userPath, config.room_rent, config.building_type]);

    const updateRoom = useCallback(async (roomId: string, updates: Partial<Room>) => {
        if (!userPath) return;

        // 1. Update the room
        await updateDoc(doc(db, userPath, 'rooms', roomId), updates);

        // 2. Check for active bill in current month
        const currentMonth = getCurrentMonth();
        const existingBill = bills.find(b => b.room_id === roomId && b.month === currentMonth);

        // 3. If bill exists and is not locked, recalculate it using new room settings + old meter readings
        if (existingBill) {
            const currentRoom = rooms.find(r => r.id === roomId);
            if (!currentRoom) return;

            const newRoom = { ...currentRoom, ...updates };

            const effectiveRent = newRoom.rent_type === 'semester' ? 0 : (newRoom.rent_amount ?? config.room_rent);
            const { electricityRate, waterConfig } = getEffectiveRates(newRoom, config);

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
                waterConfig
            );

            // Update the bill
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
    }, [userPath, bills, rooms, config]);

    const deleteRoom = useCallback(async (roomId: string) => {
        if (!userPath) return;
        await deleteDoc(doc(db, userPath, 'rooms', roomId));
    }, [userPath]);

    const deleteBill = useCallback(async (billId: string) => {
        if (!userPath) return;
        await deleteDoc(doc(db, userPath, 'bills', billId));
    }, [userPath]);

    // Bill operations
    const saveBill = useCallback(async (bill: MonthlyBill) => {
        if (!userPath) return bill;
        await setDoc(doc(db, userPath, 'bills', bill.id), bill);

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
                const effectiveRent = room.rent_type === 'semester' ? 0 : (room.rent_amount ?? config.room_rent);
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
                    waterConfig
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
    }, [userPath, bills, rooms, config]);

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

    return {
        config,
        rooms,
        bills,
        loading,
        saveConfig,
        addRoom,
        updateRoom,
        deleteRoom,
        saveBill,
        deleteBill,
        getBillForRoom,
        getBillsForMonth,
        getPreviousBill,
        closeMonth,
        unlockMonth,
        getMonthStats,
        getAllUsers,
        updateUserLicense
    };
}
