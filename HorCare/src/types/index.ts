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
  dorm_logo?: string;         // base64 โลโก้หอพัก (แสดงในพอร์ทัลผู้เช่า)
}

export interface DormConfig {
  building_type: 'dormitory' | 'commercial' | 'resort' | 'hotel' | 'apartment' | 'condo' | 'house' | 'office' | 'market' | 'other';
  electricity_rate: number;
  water_config: WaterConfig; // Default for dormitory rooms
  commercial_water_config?: WaterConfig; // Default for commercial / resort / hotel rooms
  room_rent: number;
  bill_customization?: BillCustomization; // ตั้งค่าใบแจ้งหนี้
  dorm_code?: string; // รหัสสำหรับลงทะเบียนรับบิลผ่าน LINE
  portal_pin?: string; // PIN สำหรับเข้า tenant portal (4 หลัก)
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
  rent_type: 'monthly' | 'semester' | 'yearly' | 'daily';
  // Per-room rate overrides (used in commercial mode)
  custom_electricity_rate?: number | null;
  custom_water_config?: WaterConfig | null;
  // Common fee overrides (maps fee.id to room-specific settings)
  common_fee_overrides?: Record<string, { amount?: number; is_active?: boolean }>;
  // Room occupancy status — set manually by owner
  // 'occupied' = มีผู้เช่า, 'vacant' = ว่าง, 'reserved' = ติดจอง
  room_status?: 'occupied' | 'vacant' | 'reserved';
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
  common_fee: number; // Sum of applied common fees
  applied_common_fees?: { id: string; name: string; amount: number }[]; // Breakdown of applied common fees
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
  common_fee: number;
  applied_common_fees?: { id: string; name: string; amount: number }[];
  total_bill: number;
}

export type ViewMode = 'dashboard' | 'rooms' | 'recording' | 'summary' | 'settings';

// ─── Tenant Profile ───────────────────────────────────────────────────────────

/**
 * ข้อมูลผู้เช่าแบบละเอียด — เก็บเป็น sub-document ใน
 * users/{uid}/buildings/{buildingId}/rooms/{roomId}/profile/{roomId}
 */
export interface TenantProfile {
  id: string;        // = room_id
  room_id: string;
  building_id: string;

  // ── Basic (ฟรี) ──
  full_name: string;
  nickname?: string;
  phone: string;
  line_display_name?: string;   // ชื่อใน LINE (sync จาก webhook)

  // ── สัญญา / วันที่ (ฟรี) ──
  move_in_date?: string;         // ISO date "YYYY-MM-DD"
  contract_end_date?: string;    // ISO date
  expected_move_out?: string;    // ISO date — ใช้กับ Churn prediction

  // ── มัดจำ (ฟรี) ──
  deposit_amount?: number;
  deposit_status?: 'held' | 'returned' | 'deducted';
  deposit_note?: string;
  deposit_returned_at?: string;  // ISO date

  // ── Extended (Paid) ──
  birthdate?: string;            // ISO date — ⚠️ PDPA sensitive
  id_card_number?: string;       // ⚠️ PDPA sensitive
  occupation?: string;
  university?: string;
  year_of_study?: number;        // ใช้กับ Churn prediction (นักศึกษาปี 4)

  // ── ผู้ติดต่อฉุกเฉิน (Paid) ──
  emergency_name?: string;
  emergency_phone?: string;
  emergency_relation?: string;   // "พ่อ" | "แม่" | "พี่น้อง" | ฯลฯ

  // ── Metadata ──
  created_at: string;
  updated_at: string;
}

/**
 * Log การเข้า-ออก / เหตุการณ์สำคัญของผู้เช่า
 * เก็บเป็น sub-collection: ...rooms/{roomId}/events/{eventId}
 */
export interface TenantEvent {
  id: string;
  room_id: string;
  type: 'move_in' | 'move_out' | 'contract_renewed' | 'deposit_returned' | 'note';
  date: string;       // ISO date
  note?: string;
  created_by?: string; // uid (เตรียมสำหรับ RBAC)
  created_at: string;
}

// ─── Maintenance Requests (แจ้งซ่อม) ──────────────────────────────────────────
export type MaintenanceCategory =
  | 'electric' | 'plumbing' | 'appliance' | 'door_window'
  | 'bathroom' | 'ac' | 'furniture' | 'other';

export type MaintenanceUrgency = 'urgent' | 'normal';
export type MaintenanceStatus = 'open' | 'in_progress' | 'done' | 'rejected';

export interface MaintenancePartUsed {
  stock_id: string;
  stock_name: string;
  qty: number;
  unit: string;
}

export interface MaintenanceRequest {
  id: string;
  room_id: string;
  room_number: string;
  category: MaintenanceCategory;
  description: string;
  urgency: MaintenanceUrgency;
  status: MaintenanceStatus;
  created_at: string;   // ISO
  updated_at?: string;  // ISO
  admin_note?: string;
  has_photo?: boolean;  // true ถ้ามีรูปใน maintenance_images/{id}
  // Assignment (set when moving to in_progress)
  vendor_id?: string;
  vendor_name?: string;
  vendor_phone?: string;
  scheduled_date?: string; // YYYY-MM-DD
  // Completion data
  parts_used?: MaintenancePartUsed[];
  asset_id?: string;
  asset_name?: string;
  asset_condition_after?: AssetCondition;
}

// ─── Vendors (ผู้รับเหมา/ช่าง) ────────────────────────────────────────────────
export interface Vendor {
  id: string;
  name: string;
  phone: string;
  specialty: string;
  note?: string;
  created_at: string;
}

// ─── Stock (สต็อกวัสดุ) ────────────────────────────────────────────────────────
export interface StockItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  min_quantity: number;
  note?: string;
  created_at: string;
  updated_at: string;
}

// ─── Assets (ทรัพย์สิน) ────────────────────────────────────────────────────────
export type AssetCondition = 'good' | 'fair' | 'poor' | 'broken';
export interface Asset {
  id: string;
  name: string;
  category: string;
  room_id?: string;
  room_number?: string;
  condition: AssetCondition;
  purchase_date?: string;
  purchase_price?: number;
  note?: string;
  created_at: string;
}

// ─── Expenses (ค่าใช้จ่าย) ────────────────────────────────────────────────────
export interface Expense {
  id: string;
  date: string;
  amount: number;
  category: string;
  description: string;
  vendor_id?: string;
  vendor_name?: string;
  note?: string;
  created_at: string;
}

// ─── Fines (ค่าปรับรายห้อง) ───────────────────────────────────────────────────
export type FineStatus = 'unpaid' | 'paid';

export interface Fine {
  id: string;
  room_id: string;
  room_number: string;
  reason: string;
  amount: number;
  date: string;
  status: FineStatus;
  note?: string;
  created_at: string;
  updated_at?: string;
}

// ─── Common Fees (ค่าบริการส่วนกลาง) ─────────────────────────────────────────
export interface CommonFee {
  id: string;
  name: string;
  amount: number;
  is_active: boolean;
  charge_cycle?: 'monthly' | 'yearly';
  charge_month?: number; // 1-12
  charge_type?: 'per_room' | 'per_person';
  note?: string;
  created_at: string;
  updated_at?: string;
}
