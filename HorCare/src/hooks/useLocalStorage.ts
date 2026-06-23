// LocalStorage-based data hook (Firebase integration ready)
import { useState, useEffect, useCallback } from 'react';
import type { DormConfig, Room, MonthlyBill } from '../types';
import { getCurrentMonth } from '../utils/calculations';

// Default configuration
const DEFAULT_CONFIG: DormConfig = {
    building_type: 'dormitory',
    electricity_rate: 8,
    water_config: {
        type: 'flat_rate_tier',
        flat_price: 250,
        flat_limit_unit: 10,
        excess_unit_rate: 25
    },
    room_rent: 3500
};

// Storage keys
const STORAGE_KEYS = {
    CONFIG: 'dormutility_config',
    ROOMS: 'dormutility_rooms',
    BILLS: 'dormutility_bills'
};

export function useLocalStorage() {
    const [config, setConfigState] = useState<DormConfig>(DEFAULT_CONFIG);
    const [rooms, setRoomsState] = useState<Room[]>([]);
    const [bills, setBillsState] = useState<MonthlyBill[]>([]);
    const [loading, setLoading] = useState(true);

    // Load data from localStorage on mount
    useEffect(() => {
        try {
            const storedConfig = localStorage.getItem(STORAGE_KEYS.CONFIG);
            const storedRooms = localStorage.getItem(STORAGE_KEYS.ROOMS);
            const storedBills = localStorage.getItem(STORAGE_KEYS.BILLS);

            let parsedConfig = DEFAULT_CONFIG;
            if (storedConfig) {
                parsedConfig = JSON.parse(storedConfig);
                setConfigState(parsedConfig);
            }
            if (storedRooms) {
                // Migration: backfill rent_amount and rent_type for existing rooms
                const parsed: Room[] = JSON.parse(storedRooms);
                const migrated = parsed.map(room => ({
                    ...room,
                    rent_amount: room.rent_amount ?? parsedConfig.room_rent,
                    rent_type: room.rent_type ?? 'monthly' as const
                }));
                setRoomsState(migrated);
                localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(migrated));
            }
            if (storedBills) {
                setBillsState(JSON.parse(storedBills));
            }
        } catch (error) {
            console.error('Error loading from localStorage:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Save config
    const saveConfig = useCallback((newConfig: DormConfig) => {
        localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newConfig));
        setConfigState(newConfig);
    }, []);

    // Room operations
    const addRoom = useCallback((roomNumber: string) => {
        const newRoom: Room = {
            id: `room_${Date.now()}`,
            room_number: roomNumber,
            room_type: config.building_type === 'commercial' ? 'commercial' : 'dormitory',
            current_meter_elec: 0,
            current_meter_water: 0,
            is_active: true,
            rent_amount: config.room_rent,
            rent_type: 'monthly'
        };
        const updatedRooms = [...rooms, newRoom].sort((a, b) =>
            a.room_number.localeCompare(b.room_number)
        );
        localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(updatedRooms));
        setRoomsState(updatedRooms);
        return newRoom;
    }, [rooms]);

    const updateRoom = useCallback((roomId: string, updates: Partial<Room>) => {
        const updatedRooms = rooms.map(room =>
            room.id === roomId ? { ...room, ...updates } : room
        );
        localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(updatedRooms));
        setRoomsState(updatedRooms);
    }, [rooms]);

    const deleteRoom = useCallback((roomId: string) => {
        const updatedRooms = rooms.filter(room => room.id !== roomId);
        localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(updatedRooms));
        setRoomsState(updatedRooms);
    }, [rooms]);

    // Bill operations
    const saveBill = useCallback((bill: MonthlyBill) => {
        const existingIndex = bills.findIndex(
            b => b.room_id === bill.room_id && b.month === bill.month
        );

        let updatedBills: MonthlyBill[];
        if (existingIndex >= 0) {
            updatedBills = [...bills];
            updatedBills[existingIndex] = bill;
        } else {
            updatedBills = [...bills, bill];
        }

        // Also update the room's current meter readings
        const updatedRooms = rooms.map(room => {
            if (room.id === bill.room_id) {
                return {
                    ...room,
                    current_meter_elec: bill.curr_elec,
                    current_meter_water: bill.curr_water
                };
            }
            return room;
        });

        localStorage.setItem(STORAGE_KEYS.BILLS, JSON.stringify(updatedBills));
        localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(updatedRooms));
        setBillsState(updatedBills);
        setRoomsState(updatedRooms);
        return bill;
    }, [bills, rooms]);

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

    // Close month and forward meter readings
    const closeMonth = useCallback((month: string) => {
        const monthBills = bills.filter(b => b.month === month);
        // Lock all bills for this month
        const updatedBills = bills.map(bill =>
            bill.month === month ? { ...bill, is_locked: true } : bill
        );
        // Update room meters with current readings
        const updatedRooms = rooms.map(room => {
            const bill = monthBills.find(b => b.room_id === room.id);
            if (bill) {
                return {
                    ...room,
                    current_meter_elec: bill.curr_elec,
                    current_meter_water: bill.curr_water
                };
            }
            return room;
        });

        localStorage.setItem(STORAGE_KEYS.BILLS, JSON.stringify(updatedBills));
        localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(updatedRooms));
        setBillsState(updatedBills);
        setRoomsState(updatedRooms);
    }, [bills, rooms]);

    // Unlock month
    const unlockMonth = useCallback((month: string) => {
        const updatedBills = bills.map(bill =>
            bill.month === month ? { ...bill, is_locked: false } : bill
        );
        localStorage.setItem(STORAGE_KEYS.BILLS, JSON.stringify(updatedBills));
        setBillsState(updatedBills);
    }, [bills]);

    // Get current month stats
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
        unlockMonth,
        getMonthStats
    };
}
