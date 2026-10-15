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
  name?: string;
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
  line_support_user_id?: string; // LINE User ID from the Support OA
  phone?: string;
  referral_sources?: string[];
}

export interface InitialBuildingConfig {
  dorm_name?: string;
  building_type?: DormConfig['building_type'];
  electricity_rate?: number;
  water_config?: WaterConfig;
  room_rent?: number;
  due_day?: number;
  phone?: string;
  referral_sources?: string[];
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
  logo?: string;
  building_type?: DormConfig['building_type'];
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

export type BillLanguage = 'th' | 'en' | 'my' | 'zh' | 'lo' | 'vi';

export interface BillCustomization {
  dorm_name: string;          // ชื่อหอพัก
  dorm_address: string;       // ที่อยู่
  dorm_phone: string;         // เบอร์โทร
  /** @deprecated moved onto bank accounts (BankAccount.promptpay_id); kept only so old data can be carried over */
  promptpay_number?: string;
  /** @deprecated see promptpay_number */
  promptpay_name?: string;
  footer_text: string;        // ข้อความด้านล่างบิล
  due_day: number;            // กำหนดชำระวันที่
  dorm_logo?: string;         // base64 โลโก้หอพัก (แสดงในพอร์ทัลผู้เช่า)
  default_language?: BillLanguage;   // ภาษาเริ่มต้นของบิลและการแจ้งเตือน (default: 'th')
  bilingual_mode?: boolean;          // แสดงบิล 2 ภาษาคู่ขนาน (เช่น ไทย + อังกฤษ)
  secondary_language?: BillLanguage; // ภาษาที่สองเมื่อเปิดโหมด 2 ภาษา (default: 'en')
}

export interface MarketConfig {
  default_rent_cycle?: 'daily' | 'weekly' | 'monthly';
  default_stall_size?: string;       // เช่น "2x2 ม.", "3x3 ม."
  waste_fee_per_stall?: number;      // ค่าขยะ/ทำความสะอาดรายแผง (บาท)
  waste_fee_cycle?: 'daily' | 'monthly';
  electricity_flat_fee?: number;     // ค่าไฟเหมาต่อจุด/ดวง (บาท/วัน)
  table_rental_fee?: number;         // ค่าเช่าโต๊ะ/ร่ม/เต็นท์ (บาท/วัน)
  zones?: string[];                  // รายชื่อโซนตลาด e.g. ['โซน A (อาหาร)', 'โซน B (ของสด)']
}

/** How this property collects money: monthly bills, nightly stays (hotel/resort), or market stalls (weekly in advance / daily as they trade). */
export type CollectionStyle = 'monthly' | 'nightly' | 'stall';

export interface DormConfig {
  collection_style?: CollectionStyle;
  building_type: 'dormitory' | 'commercial' | 'resort' | 'hotel' | 'apartment' | 'condo' | 'house' | 'office' | 'market' | 'other';
  electricity_rate: number;
  water_config: WaterConfig; // Default for dormitory rooms
  commercial_water_config?: WaterConfig; // Default for commercial / resort / hotel rooms
  room_rent: number;
  bill_customization?: BillCustomization; // ตั้งค่าใบแจ้งหนี้
  dorm_code?: string; // รหัสสำหรับลงทะเบียนรับบิลผ่าน LINE
  portal_pin?: string; // PIN สำหรับเข้า tenant portal (4 หลัก)
  market_config?: MarketConfig; // ตั้งค่าเฉพาะตลาด / แผงค้า
  /** How tenants may claim a room over LINE. Undefined = 'invitation_only'. */
  claim_mode?: 'invitation_only' | 'legacy';
  /** Owner-defined amenities, offered next to the built-in list in bulk room creation. */
  custom_amenities?: string[];
  contract_templates?: ContractTemplate[]; //เทมเพลตสัญญาเช่าดิจิทัลที่เจ้าของสร้าง
}

export interface Room {
  id: string;
  room_number: string;
  room_type: 'dormitory' | 'commercial';
  tenant_count?: number; // Defaults to 1 if undefined
  line_user_id?: string;
  current_meter_elec: number;
  current_meter_water: number;
  /** Meter serials remembered from AI meter reading, used to match a meter photo to this room. */
  meter_serial_elec?: string | null;
  meter_serial_water?: string | null;
  is_active: boolean;
  rent_amount: number;
  rent_type: 'monthly' | 'semester' | 'yearly' | 'daily' | 'weekly';
  // Market / Commercial extensions
  zone?: string;               // โซนแผงค้า เช่น 'โซน A', 'โซน B' หรือชั้น 'ชั้น 1'
  stall_size?: string;         // ขนาดแผง เช่น '2x2 ม.'
  business_type?: string;      // ประเภทสินค้า/ร้าน เช่น 'ข้าวมันไก่', 'เสื้อผ้า'
  // Per-room rate overrides (used in commercial mode)
  custom_electricity_rate?: number | null;
  custom_water_config?: WaterConfig | null;
  // Common fee overrides (maps fee.id to room-specific settings)
  common_fee_overrides?: Record<string, { amount?: number; is_active?: boolean }>;
  // Room occupancy status — set manually by owner
  // 'occupied' = มีผู้เช่า, 'vacant' = ว่าง, 'reserved' = ติดจอง
  room_status?: 'occupied' | 'vacant' | 'reserved';
  // Bulk-creation / amenity data
  building_name?: string;      // ตึก / อาคาร (free text, e.g. 'A')
  floor?: string;              // ชั้น
  deposit_amount?: number;     // เงินมัดจำมาตรฐานของห้อง
  amenities?: string[];        // amenity ids (see src/utils/amenities.ts) or custom names
  // ภาษาเฉพาะห้องสำหรับบิลและการแจ้งเตือน (ถ้าไม่ระบุจะใช้ค่าเริ่มต้นของหอพัก)
  language?: BillLanguage;
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

  // ── Payment method (how the money actually arrived) ──
  payment_method?: PaymentMethod;
  paid_amount?: number;            // amount actually received (THB)
  received_by?: string;            // who took the cash / confirmed it (display name)
  bank_account?: string;           // receiving account, for bank transfers
  bank_account_id?: string;        // BankAccount.id the money went to
  // What was read from the slip (AI) and how it compared with the bill / receiving accounts
  slip_receiver_name?: string;
  slip_receiver_account?: string;
  slip_datetime?: string;          // ISO, Thailand time
  slip_account_id?: string;        // receiving account the slip matched
  slip_checks?: SlipChecks;
  transaction_ref?: string;        // bank / gateway reference
  verification_status?: PaymentVerification; // transfers: has the money been seen in the account?
  bank_transaction_id?: string;    // the bank transaction this payment was reconciled with
  payment_note?: string;

  // ── Auto reminders (written by /api/remind-bills cron) ──
  last_reminded_at?: string;   // ISO timestamp of the latest LINE reminder
  reminder_count?: number;     // total reminders sent for this bill (spam cap)
}

// 'unpaid'  — no slip yet
// 'pending' — slip received but needs the owner's manual confirmation
//             (auto-verify failed, quota exhausted, or amount mismatch)
// 'paid'    — confirmed (auto by SlipOK, or manually by the owner)
export type PaymentStatus = 'unpaid' | 'pending' | 'paid';

// Every confirmed payment carries a method. `qr_gateway` covers PromptPay QR / card gateways.
export type PaymentMethod = 'cash' | 'bank_transfer' | 'qr_gateway' | 'other';
// 'unverified' = recorded from a slip only; 'verified' = confirmed against the bank account.
export type PaymentVerification = 'unverified' | 'verified' | 'rejected';

// Result of comparing a slip with the bill and the property's receiving accounts.
// 'unknown' = the slip did not show that detail (or nothing to compare against).
export type SlipCheck = 'pass' | 'fail' | 'unknown';
export interface SlipChecks {
  amount: SlipCheck;
  receiver_name: SlipCheck;
  receiver_account: SlipCheck;
  datetime: SlipCheck;
  duplicate: SlipCheck;
  qr: SlipCheck;
}

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
  tenant_count?: number;        // จำนวนผู้พักอาศัย (พักกี่คน)

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

  // ── Digital Contract & E-Signature ──
  signed_contract?: SignedContractData;

  // ── Metadata ──
  created_at: string;
  updated_at: string;
}

export interface ContractTemplate {
  id: string;                          // Template ID (e.g. "tpl-residential-std", "tpl-user-123")
  name: string;                        // Display name (e.g. "สัญญาเช่าห้องพักมาตรฐาน", "สัญญาเช่าแผงรายวัน")
  contract_type: 'market_stall' | 'residential' | 'commercial';
  title: string;                       // e.g. "สัญญาเช่าแผงค้าและล็อกจำหน่ายสินค้า"
  default_rent_cycle?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  electricity_rate_desc?: string;
  water_rate_desc?: string;
  waste_fee_desc?: string;
  clauses: string[];                   // ข้อกำหนดและเงื่อนไขสัญญา
  custom_terms?: string;               // เงื่อนไขเพิ่มเติมเริ่มต้น
  is_default?: boolean;                // เป็นเทมเพลตมาตรฐาน
  created_at?: string;
  updated_at?: string;
}

export interface SignedContractData {
  id: string;                          // Contract document ID
  contract_number: string;             // e.g. "HC-MK-202609-001" or "HC-DM-..."
  contract_type: 'market_stall' | 'residential' | 'commercial';
  title: string;                       // e.g. "สัญญาเช่าแผงค้าตลาด" / "สัญญาเช่าห้องพัก"
  template_id?: string;                // ID ของ template ที่ใช้สร้าง
  lessor_name: string;                 // ชื่อผู้ให้เช่า
  lessor_phone?: string;
  lessor_id_card?: string;
  lessor_address?: string;
  lessor_signature?: string;           // Base64 PNG signature
  lessor_signed_at?: string;           // ISO timestamp

  lessee_name: string;                 // ชื่อผู้เช่า / ผู้ค้า
  lessee_phone?: string;
  lessee_id_card?: string;
  lessee_address?: string;
  lessee_business_type?: string;       // e.g. ข้าวมันไก่ (กรณีตลาด)
  lessee_signature?: string;           // Base64 PNG signature
  lessee_signed_at?: string;           // ISO timestamp

  unit_number: string;                 // e.g. "A01" หรือ "101"
  zone_or_floor?: string;              // e.g. "โซน A (อาหาร)" หรือ "ชั้น 2"
  stall_or_room_size?: string;         // e.g. "2x2 ม." หรือ "28 ตร.ม."
  rent_amount: number;
  rent_cycle: 'daily' | 'weekly' | 'monthly' | 'yearly';
  deposit_amount: number;
  start_date: string;                  // ISO "YYYY-MM-DD"
  end_date?: string;                   // ISO "YYYY-MM-DD"
  
  electricity_rate_desc?: string;
  water_rate_desc?: string;
  waste_fee_desc?: string;

  clauses: string[];                   // ข้อตกลงและเงื่อนไขสัญญา
  custom_terms?: string;               // ข้อตกลงเพิ่มเติมเฉพาะราย

  created_at: string;                  // ISO timestamp
  verification_code: string;           // e.g. "HC-SIGN-9F2B81" hash for integrity
  status: 'draft' | 'pending_lessee' | 'signed' | 'expired' | 'terminated';
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
  photo_url?: string;
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
export interface Fine {
  id: string;
  room_id: string;
  room_number: string;
  reason: string;
  amount: number;
  date: string;
  status: PaymentStatus;
  note?: string;
  created_at: string;
  updated_at?: string;

  // Slip tracking
  slip_image?: boolean;
  slip_amount?: number;
  slip_ref?: string;
  slip_sender?: string;
  slip_submitted_at?: string;
  verify_note?: string;
  paid_at?: string;
  paid_method?: 'auto' | 'manual';

  payment_method?: PaymentMethod;
  paid_amount?: number;
  received_by?: string;
  bank_account?: string;
  bank_account_id?: string;
  transaction_ref?: string;
  verification_status?: PaymentVerification;
  bank_transaction_id?: string;
  payment_note?: string;
  slip_receiver_name?: string;
  slip_receiver_account?: string;
  slip_datetime?: string;
  slip_account_id?: string;
  slip_checks?: SlipChecks;
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

// ─── Housekeeping & Maid System (ระบบงานแม่บ้าน) ─────────────────────────────
export type CleaningServiceType =
  | 'general'
  | 'general_cleaning'    // ทำความสะอาดทั่วไป
  | 'bathroom'
  | 'bathroom_cleaning'   // ล้างห้องน้ำ
  | 'balcony'             // ล้างระเบียง / ซักล้าง
  | 'bed_linen'           // เปลี่ยนผ้าปู / ซักรีด
  | 'deep'
  | 'deep_cleaning'       // บิ๊กคลีนนิ่ง
  | 'checkout'
  | 'move_out_cleaning'   // ทำความสะอาดก่อนย้ายออก
  | 'other';              // อื่นๆ

export type CleaningStatus = 'open' | 'pending' | 'assigned' | 'in_progress' | 'done' | 'completed' | 'cancelled';

export interface CleaningRequest {
  id: string;
  room_id?: string;
  room_number: string;
  tenant_name?: string;
  service_type: CleaningServiceType;
  description?: string;
  preferred_date?: string;          // YYYY-MM-DD
  preferred_time_slot?: string;
  status: CleaningStatus;
  urgency?: 'normal' | 'urgent';
  photo_url?: string | null;
  image_url?: string | null;
  has_photo?: boolean;
  assigned_maid_id?: string;
  assigned_maid_name?: string;
  assigned_maid_phone?: string;
  accepted_at?: string;
  completed_at?: string;
  completed_by?: 'maid' | 'landlord';
  completion_notes?: string;
  completed_note?: string;
  completion_photo_url?: string | null;
  fee?: number;
  created_at: string;
  updated_at?: string;
}

export interface Housekeeper {
  id: string;
  name: string;
  phone: string;
  passcode: string;                 // รหัสเข้าสู่ระบบ (4-8 หลัก)
  status?: 'active' | 'busy' | 'off';
  is_active: boolean;
  notes?: string;
  created_at: string;
  updated_at?: string;
}

export interface HousekeeperSession {
  owner_uid: string;
  building_id: string;
  building_name?: string;
  maid_id: string;
  name?: string;
  maid_name: string;
  phone: string;
}


