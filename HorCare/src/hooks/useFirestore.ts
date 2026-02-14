import { useState, useEffect, useCallback } from 'react';
import {
    collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type { DormConfig, Room, MonthlyBill } from '../types';
import { getCurrentMonth } from '../utils/calculations';

const DEFAULT_CONFIG: DormConfig = {
    electricity_rate: 8,
    water_config: {
        type: 'flat_rate_tier',
        flat_price: 250,
        flat_limit_unit: 10,
        excess_unit_rate: 25
    },
    room_rent: 3500
};

export function useFirestore(userId: string | null) {
    const [config, setConfigState] = useState<DormConfig>(DEFAULT_CONFIG);
    const [rooms, setRoomsState] = useState<Room[]>([]);
    const [bills, setBillsState] = useState<MonthlyBill[]>([]);
    const [loading, setLoading] = useState(true);

    // Base path for this user's data
    const userPath = userId ? `users/${userId}` : null;

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
        if (!userPath) return;
        await setDoc(doc(db, userPath, 'data', 'config'), newConfig);
    }, [userPath]);

    // Room operations
    const addRoom = useCallback(async (roomNumber: string) => {
        if (!userPath) return;
        const roomId = `room_${Date.now()}`;
        const newRoom: Room = {
            id: roomId,
            room_number: roomNumber,
            current_meter_elec: 0,
            current_meter_water: 0,
            is_active: true,
            rent_amount: config.room_rent,
            rent_type: 'monthly'
        };
        await setDoc(doc(db, userPath, 'rooms', roomId), newRoom);
        return newRoom;
    }, [userPath, config.room_rent]);

    const updateRoom = useCallback(async (roomId: string, updates: Partial<Room>) => {
        if (!userPath) return;
        await updateDoc(doc(db, userPath, 'rooms', roomId), updates);
    }, [userPath]);

    const deleteRoom = useCallback(async (roomId: string) => {
        if (!userPath) return;
        await deleteDoc(doc(db, userPath, 'rooms', roomId));
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

        return bill;
    }, [userPath]);

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
            updateDoc(doc(db, userPath!, 'bills', bill.id), { is_locked: true })
        );

        // Update room meters
        const meterPromises = rooms.map(room => {
            const bill = monthBills.find(b => b.room_id === room.id);
            if (bill) {
                return updateDoc(doc(db, userPath!, 'rooms', room.id), {
                    current_meter_elec: bill.curr_elec,
                    current_meter_water: bill.curr_water
                });
            }
            return Promise.resolve();
        });

        await Promise.all([...lockPromises, ...meterPromises]);
    }, [userPath, bills, rooms]);

    // Stats
    const getMonthStats = useCallback((month: string = getCurrentMonth()) => {
        const monthBills = bills.filter(b => b.month === month);
        const savedCount = monthBills.filter(b => b.is_saved).length;
        const totalRooms = rooms.filter(r => r.is_active).length;
        const totalRevenue = monthBills.reduce((sum, b) => sum + b.total_bill, 0);
        const isAllSaved = savedCount === totalRooms && totalRooms > 0;

        return {
            savedCount,
            totalRooms,
            totalRevenue,
            isAllSaved,
            progress: totalRooms > 0 ? (savedCount / totalRooms) * 100 : 0
        };
    }, [bills, rooms]);

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
        getBillForRoom,
        getBillsForMonth,
        getPreviousBill,
        closeMonth,
        getMonthStats
    };
}
