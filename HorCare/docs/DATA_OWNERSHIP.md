# HorCare — Data ownership & ID mapping (R0)

สถานะ: สำรวจจากโค้ดบน `main` วันที่ 20 ตุลาคม 2026 อ้างอิง DATA-01, DATA-03, DATA-05 และ DATA-07 ใน Product & System Requirements v1.0
ส่วนที่ 1–3 บอกสภาพปัจจุบันตามโค้ด ส่วนที่ 4 **อนุมัติให้ใช้ตามข้อเสนอแล้ว (20 ต.ค. 2026)** นโยบายที่เลือกสำหรับคำถามในส่วนที่ 5 บันทึกไว้ใน [MIGRATION_R1.md](MIGRATION_R1.md) ข้อ 1

---

## 1. ฐานข้อมูลที่ใช้อยู่

| ที่เก็บ | ใช้กับ | ผู้เขียน |
|---|---|---|
| Firestore `users/{ownerUid}/…` | องค์กร อาคาร ห้อง บิลรายเดือน ผู้เช่า ใบงาน พัสดุ บัญชี (ledger) audit | client ตาม `firestore.rules` หรือ API (Admin SDK) |
| Firestore ระดับบนสุด | ตารางเชื่อม LINE, token/idempotency, rate limit | API เท่านั้น (rules ปฏิเสธ client) |
| Supabase (Postgres) | lead การจอง สัญญาเช่า การเก็บเงินรายวัน/รายคืน/แผงตลาด | API เท่านั้น (service role) ทุกแถวมี `owner_uid` + `building_id` |
| Firebase Storage | ไฟล์เดิมบางส่วน (`slip_path` แบบเก่า) | — |

ขอบเขตองค์กร = `ownerUid` (uid ของเจ้าของ) ขอบเขตสินทรัพย์ = `buildingId` ใน Firestore ทุกอย่างอยู่ใต้ path นี้ ส่วน Supabase ใช้คู่คอลัมน์เดียวกัน

## 2. Entity ปัจจุบัน → entity เป้าหมาย

| Entity เป้าหมาย | ที่อยู่ปัจจุบัน | ID ปัจจุบัน | ผู้เขียนปัจจุบัน | หน่วยเงิน | หมายเหตุ |
|---|---|---|---|---|---|
| Organization | `users/{uid}` + `members/{uid}` | Firebase uid ของเจ้าของ | client (โปรไฟล์ตัวเอง) / API (สมาชิก, licence) | — | ไม่มี org ID แยกจาก uid เจ้าของ ถ้าเปลี่ยนเจ้าของบัญชีย้ายไม่ได้ |
| Property | `users/{uid}/buildings/{bid}` | `building_<ms>` | client (เจ้าของ) | — | ประเภทอยู่ที่ `data/config.building_type` |
| Zone/Floor | ฟิลด์ใน room (`zone`, `floor`, `building_name`) | ไม่มี ID | client | — | เป็นข้อความอิสระ |
| Unit | `buildings/{bid}/rooms/{rid}` | `room_<ms>` / `room_<ms>_<i>` | client (`room.*`, `meter.record`) | บาท (`rent_amount`) | ID ถาวร `room_number` เป็นแค่ป้ายชื่อ ✓ DATA-01 |
| Party | **ไม่มี** — กระจาย 3 ที่ | — | — | — | `tenants/{roomId}` (ผูกห้อง), `leases.tenant_name/phone`, `line_rooms/{lineUserId}` |
| Contract | **2 ชุดคู่ขนาน** | `leases.id` (uuid) / `tenants.signed_contract.id` | API (leasing) / client + `/api/portal` (ลงนาม) | สตางค์ / บาท | ไม่มีการเชื่อมกัน |
| ContractUnit | ไม่มี — `leases.room_id` คอลัมน์เดียว | — | — | — | ยังไม่รองรับหลายพื้นที่ต่อสัญญา |
| Reservation (รายเดือน) | `leasing_reservations` | uuid | API | สตางค์ | กันห้องด้วย "1 การจอง active ต่อห้อง" ไม่ได้ดูช่วงวันที่ |
| Stay (รายคืน) | `bookings` | uuid | API (RPC) | สตางค์ | กันจองทับด้วย exclusion constraint ✓ |
| Meter / Reading | `rooms.current_meter_*` + `bills.prev_*/curr_*` | ไม่มี reading ID | client | — | ไม่มีประวัติเปลี่ยนมิเตอร์ ไม่มีรูป/ผู้บันทึกใน reading |
| Invoice (รายเดือน) | `buildings/{bid}/bills/{id}` | `bill_<roomId>_<YYYY-MM>` | client (rules จำกัด field) + API (สลิป, gateway) | **บาท (ทศนิยม)** | ยอดรวมคำนวณในบิล ไม่มี charge แยก ไม่มี snapshot อัตรา |
| Charge (รายวัน/รายคืน/แผง) | `charges` | uuid + `dedupe_key` unique | API | สตางค์ | กันเรียกเก็บซ้ำแล้ว ✓ |
| Fine | `buildings/{bid}/fines/{id}` | auto id | client (`property.update`) | บาท | |
| Payment / Allocation | ฟิลด์ใน `bills` + `buildings/{bid}/payments/{id}` (มี `allocations[]`) + `charge_payments` | ต่างกันทั้ง 3 แบบ | API (accounting, gateway, collections) + client (บันทึกรับเงินใน bill) | สตางค์ใน payments, บาทใน bill | รับเงินผ่านฟิลด์ใน bill ตรง ๆ ข้าม allocation ได้ |
| Deposit | **3 ที่**: `leases.deposit_satang`, `leasing_reservations.deposit_satang`, `tenants.deposit_amount/status` | — | API / client | สตางค์ / บาท | ไม่มียอดคงเหลือหรือ settlement |
| ServiceRequest | `maintenance`, `cleaning` | auto id / uuid | `/api/portal` (ผู้เช่า), client (staff) | — | |
| WorkOrder | `work_orders` | uuid | API เท่านั้น | — | มีสถานะตรวจรับแยกสิทธิ์ ✓ |
| Stock / Expense / Equipment | `stock`, `expenses`, `assets` | auto id | client (`property.update`) | บาท | ไม่ผูกกับใบงานแบบ movement |
| Document | `tenants.signed_contract`, `slip_images`, `cleaning_images` | — | ต่างกัน | — | ไม่มีเวอร์ชันเอกสาร (DOC-02) |
| Communication | `line_threads/*/messages`, `notifications`, `announcements` | | API | — | |
| Ledger | `users/{uid}/ledgers/{id}/entries` | | API เท่านั้น แก้ไขไม่ได้ (ใช้ reversal) | สตางค์ | ✓ |
| AuditEvent | `users/{uid}/audit_logs` | event_id | client (append-only ตาม rules) + API | — | ✓ |
| AutomationJob / idempotency | `stripe_checkouts`, `gateway_events`, `payment_intent_refs`, `expiry_notices`, `rate_limits` | ID ตามแหล่งที่มา | API | — | ยังไม่มีคิวงานกลางหรือสถานะ retry |
| Portal access | `portal_links/{owner}__{bid}__{rid}` | — | API | — | ผูกกับห้อง ไม่ใช่กับการเช่า (ดูข้อ 3.2) |

## 3. ปัญหาที่ต้องแก้ก่อนสร้าง workflow R1

### 3.1 ข้อมูลเดียวกันอยู่หลายที่ และไม่มีผู้ตัดสินเมื่อขัดกัน (DATA-03)
- **ตัวตนผู้เช่า** อยู่ใน `tenants/{roomId}`, `leases` และ `line_rooms` โดยไม่มี key ร่วม
- **สัญญา** มีทั้ง `leases` (Supabase) และ `tenants.signed_contract` (Firestore) ที่สร้างแยกกัน
- **เงินประกัน** มี 3 ที่และใช้หน่วยต่างกัน
- **สถานะห้อง**: `rooms.room_status` ตั้งด้วยมือ ขณะที่ `leases.status` เปลี่ยนใน Supabase โดย `lease_activate`/`lease_end` **ไม่อัปเดตห้อง ผู้เช่า หรือลิงก์ portal ใน Firestore** สองฝั่งจึงขัดกันได้

### 3.2 สิทธิ์ portal ผูกกับห้อง ไม่ใช่การเช่า (SEC-04)
ลิงก์ portal จะเปลี่ยนเมื่อเจ้าของกด "ออกลิงก์ใหม่" เท่านั้น การปิดสัญญายังไม่ยกเลิกลิงก์อัตโนมัติ และข้อมูลผู้เช่าเก็บที่ `tenants/{roomId}` ผู้เช่าคนใหม่จึงเขียนทับเอกสารเดียวกับคนเก่า

### 3.3 หน่วยเงินไม่เหมือนกัน (DATA-05)
บิลรายเดือน ค่าปรับ ค่าเช่าห้อง และค่าใช้จ่ายเก็บเป็นบาท (`number` ทศนิยมได้) ส่วน Supabase, ledger และ payments ใช้สตางค์ (`bigint`/integer) การแปลงอยู่กระจายในแต่ละ API

### 3.4 เขียนข้ามสองฐานโดยไม่มี outbox (DATA-07)
ตัวอย่าง: `_collections.ts` บันทึกเงินใน Supabase แล้ว post ledger ใน Firestore ตามมา ถ้าขั้นที่สองล้มเหลว ไม่มีสถานะค้างหรือ retry ให้ติดตาม

## 4. เจ้าของข้อมูลเป้าหมาย (อนุมัติแล้ว — schema: `supabase/migrations/20261020000000_core_billing.sql`)

หลักการ (ตามค่าเริ่มต้นในข้อ 15 "รักษาระบบเดิมช่วงแรก แต่กำหนดเจ้าของ entity และเขียนผ่าน service"):

1. **หนึ่ง entity มีที่เก็บหลักที่เดียวและผู้เขียนที่เดียว** ที่อื่นเป็นแค่ read model ที่สร้างจากต้นทาง ห้าม sync สองทาง
2. **entity ใหม่ทางการเงินและสัญญาอยู่ Supabase**: Party, Contract, ContractUnit, Invoice, Charge, Payment, Allocation, Deposit เพราะต้องใช้ transaction, constraint (unique/exclusion/check) และสตางค์แบบ integer ซึ่ง Postgres ทำได้ตรงกว่า
3. **Firestore ยังเป็นที่หลักของ** Organization/สมาชิก, Property, Unit, config, ใบงาน, พัสดุ, LINE, ledger, audit จนกว่าจะมีเหตุให้ย้าย
4. **การเขียนข้ามฐาน**ผ่านตาราง outbox ใน Supabase (ธุรกรรมเดียวกับข้อมูลธุรกิจ) แล้ว worker ทำซ้ำได้แบบ idempotent พร้อมสถานะ `queued/running/succeeded/retrying/failed` (AUTO-03, AUTO-07)
5. **ทุกแถวใหม่**มี `id` (uuid), `owner_uid`, `building_id` (ถ้าระดับสินทรัพย์), `legacy_ref` (ID เดิมใน Firestore ถ้าแปลงมา), `created_by`, `created_at`, `version`
6. **เงินเป็นสตางค์ (bigint) ทุกที่ใหม่** วันธุรกิจใช้ `date` ตาม Asia/Bangkok เวลาเหตุการณ์ใช้ `timestamptz`

| Entity | ที่เก็บหลักที่เสนอ | ผู้เขียน | read model ที่เหลือใน Firestore |
|---|---|---|---|
| Party | Supabase `parties` | `/api/leasing` | ไม่มี (`tenants/{roomId}` ถูกแปลงแล้วเลิกใช้เขียน) |
| Contract + ContractUnit | Supabase `leases` (ขยาย) + `lease_units` | `/api/leasing` | `rooms.current_lease_id` (เพื่อแสดงผล) |
| Occupancy | ช่วงเวลาใน `lease_units` | `/api/leasing` | `rooms.occupancy` สร้างจาก outbox |
| Invoice / Charge | Supabase `invoices` + `charges` (ขยายตารางเดิม) | `/api/billing` (ใหม่) | `bills` เดิมเป็นข้อมูลอ่านอย่างเดียวหลังแปลง |
| Payment / Allocation | Supabase `payments` + `allocations` | `/api/billing` | — |
| Deposit | Supabase `deposit_ledger` (รับ/หัก/คืน เป็นรายการ) | `/api/billing` | — |
| Portal access | Supabase `portal_grants` ผูก Party + Contract มีวันหมดอายุ | `/api/portal` | `portal_links` เดิมใช้ระหว่างเปลี่ยนผ่าน |
| Meter reading | Supabase `meter_readings` (ค่า รูป ผู้บันทึก งวด) | `/api/billing` | `rooms.current_meter_*` เป็น read model |

## 5. คำถามที่ต้องตอบก่อนออกแบบ schema จริง

1. อนุมัติให้ entity การเงินและสัญญาใหม่อยู่ Supabase ตามข้อ 4 หรือไม่
2. บิลรายเดือนเดิมใน Firestore: แปลงย้อนหลังทั้งหมด หรือแปลงเฉพาะงวดที่ยังค้างชำระแล้วเก็บของเก่าเป็นอ่านอย่างเดียว
3. ผู้เช่าที่ไม่มีสัญญาใน `leases` (กรอกเฉพาะ `tenants/{roomId}`) ให้สร้าง Contract อนุมานจากข้อมูลเดิม หรือส่งเข้าคิวให้เจ้าของยืนยัน (ข้อ 12.3 ของ requirement ห้ามสร้างประวัติเท็จ)
4. ค่าเช่าไม่เต็มเดือนและนโยบายเงินเกิน/มัดจำ (ข้อ 15) ต้องมีคำตอบก่อนออกแบบ Invoice และ Allocation
