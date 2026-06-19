// HorCare - Type Definitions

export type PlanName = 'small' | 'medium' | 'large';
export type BillingCycle = 'monthly' | 'yearly';
export type LicenseType =
  | 'free'
  | 'active'
  | 'monthly_small'
  | 'monthly_medium'
  | 'monthly_large'
  | 'yearly_small'
  | 'yearly_medium'
  | 'yearly_large';

export interface UserProfile {
  uid: string;
  email: string;
  display_name: string;
  license: LicenseType;
  role?: 'admin' | 'user';
  status?: 'active' | 'banned'; // 'banned' = blocked by admin
  trial_expires_at?: string; // legacy — unused for free plan
  created_at: string;
  // Subscription info (Stripe)
  subscription_id?: string;
  subscription_status?: 'active' | 'past_due' | 'canceled' | 'incomplete';
  current_period_end?: string; // ISO date
  access_until?: number; // epoch millis — single source of truth for expiry (enforced in Firestore rules)
  plan_name?: PlanName;
  billing_cycle?: BillingCycle;
  stripe_customer_id?: string;
}

export interface Dorm {
  id: string;
  owner_uid: string;
  name: string;
  created_at: string;
}

export interface Building {
  id: string;
  name: string;
  created_at: string;
  order: number;
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

export interface BillCustomization {
  dorm_name: string;          // ชื่อหอพัก
  dorm_address: string;       // ที่อยู่
  dorm_phone: string;         // เบอร์โทร
  promptpay_number: string;   // เลข PromptPay
  promptpay_name: string;     // ชื่อบัญชี PromptPay
  footer_text: string;        // ข้อความด้านล่างบิล
  due_day: number;            // กำหนดชำระวันที่
}

export interface DormConfig {
  building_type: 'dormitory' | 'commercial';
  electricity_rate: number;
  water_config: WaterConfig; // Default for dormitory rooms
  commercial_water_config?: WaterConfig; // Default for commercial rooms
  room_rent: number;
  bill_customization?: BillCustomization; // ตั้งค่าใบแจ้งหนี้
  dorm_code?: string; // รหัสสำหรับลงทะเบียนรับบิลผ่าน LINE
}

export interface Room {
  id: string;
  room_number: string;
  room_type: 'dormitory' | 'commercial';
  tenant_count?: number; // Defaults to 1 if undefined
  line_user_id?: string;
  current_meter_elec: number;
  current_meter_water: number;
  is_active: boolean;
  rent_amount: number;
  rent_type: 'monthly' | 'semester';
  // Per-room rate overrides (used in commercial mode)
  custom_electricity_rate?: number | null;
  custom_water_config?: WaterConfig | null;
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
  tenant_count?: number; // Snapshot of tenant count at time of billing

  // ── Payment tracking (tenant sends slip via LINE) ──
  // undefined is treated as 'unpaid' for legacy bills
  payment_status?: PaymentStatus;
  slip_path?: string;          // legacy: Firebase Storage path of the uploaded slip image
  slip_image?: boolean;        // true = compressed slip image stored as base64 in slip_images/{billId}
  slip_amount?: number;        // amount read from the verified slip (THB)
  slip_ref?: string;           // bank transaction reference — used to reject duplicate slips
  slip_sender?: string;        // payer display name from the slip
  slip_bank?: string;          // sending bank short name, if available
  slip_submitted_at?: string;  // ISO timestamp when the tenant sent the slip
  verify_note?: string;        // why auto-verify failed (shown to owner for manual review)
  paid_at?: string;            // ISO timestamp when the bill was marked paid
  paid_method?: 'auto' | 'manual'; // how the payment was confirmed

  // ── Auto reminders (written by /api/remind-bills cron) ──
  last_reminded_at?: string;   // ISO timestamp of the latest LINE reminder
  reminder_count?: number;     // total reminders sent for this bill (spam cap)
}

// 'unpaid'  — no slip yet
// 'pending' — slip received but needs the owner's manual confirmation
//             (auto-verify failed, quota exhausted, or amount mismatch)
// 'paid'    — confirmed (auto by SlipOK, or manually by the owner)
export type PaymentStatus = 'unpaid' | 'pending' | 'paid';

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
