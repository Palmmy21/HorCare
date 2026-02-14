// HorCare - Type Definitions

export interface UserProfile {
  uid: string;
  email: string;
  display_name: string;
  license: 'trial' | 'active';
  trial_expires_at: string; // ISO date
  created_at: string;
}

export interface Dorm {
  id: string;
  owner_uid: string;
  name: string;
  created_at: string;
}
export interface WaterConfig {
  type: 'normal' | 'flat_rate_tier';
  // Normal mode
  unit_rate?: number;
  // Flat rate tier mode
  flat_price?: number;
  flat_limit_unit?: number;
  excess_unit_rate?: number;
}

export interface DormConfig {
  electricity_rate: number;
  water_config: WaterConfig;
  room_rent: number;
}

export interface Room {
  id: string;
  room_number: string;
  line_user_id?: string;
  current_meter_elec: number;
  current_meter_water: number;
  is_active: boolean;
  rent_amount: number;
  rent_type: 'monthly' | 'semester';
}

export interface MonthlyBill {
  id: string;
  room_id: string;
  room_number: string;
  month: string;
  prev_elec: number;
  curr_elec: number;
  elec_units: number;
  elec_bill: number;
  prev_water: number;
  curr_water: number;
  water_units: number;
  water_bill: number;
  water_flat_amount: number;
  water_excess_units: number;
  water_excess_amount: number;
  room_rent: number;
  total_bill: number;
  is_saved: boolean;
  is_locked: boolean;
  is_notified: boolean;
  created_at: string;
  updated_at: string;
}

export interface BillCalculation {
  elec_units: number;
  elec_bill: number;
  water_units: number;
  water_bill: number;
  water_flat_amount: number;
  water_excess_units: number;
  water_excess_amount: number;
  total_bill: number;
}

export type ViewMode = 'dashboard' | 'rooms' | 'recording' | 'summary' | 'settings';
