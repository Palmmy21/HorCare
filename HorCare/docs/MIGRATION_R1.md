# HorCare — R1 migration plan (Firestore → core schema)

สถานะ: **แผนพร้อม schema และ mapping ที่ผ่านเทสต์แล้ว ยังไม่มีตัวรัน (runner) และยังไม่ได้รันกับข้อมูลจริง**
อ้างอิง: Requirements v1.0 ข้อ 12, [DATA_OWNERSHIP.md](DATA_OWNERSHIP.md)
Schema: `supabase/migrations/20261020000000_core_billing.sql` · Mapping: `api/_migrate-r1.ts`

## 1. การตัดสินใจที่ใช้ (อนุมัติแบบค่าเริ่มต้น 20 ต.ค. 2026)

| ประเด็น | ที่ใช้ | เปลี่ยนได้ภายหลังหรือไม่ |
|---|---|---|
| ที่เก็บหลักของ Party / Contract / Invoice / Payment / Deposit | Supabase | ไม่ควร (schema ออกแบบตามนี้) |
| บิลเดิมใน Firestore | แปลง**ทุกงวด** (รวมประวัติ) เป็น invoice สถานะ `issued` พร้อม `legacy_ref` หลังตัดระบบ บิลเดิมใช้อ่านอย่างเดียว | ได้ ถ้าเลือกแปลงเฉพาะงวดค้าง |
| ผู้เช่าที่ไม่มีสัญญาใน `leases` | สร้าง **Party** จากข้อมูลจริง แต่**ไม่สร้างสัญญาอนุมาน** ให้เข้าคิว `migration_issues` (`no_contract`) รอเจ้าของยืนยัน | — |
| ค่าเช่าไม่เต็มเดือน | ค่าเริ่มต้น `proration = 'none'` (เก็บเต็มเดือนเหมือนเดิม) ตั้งเป็น `daily` ได้ต่อสัญญา | ได้ ต่อสัญญา |
| เงินเกิน | อยู่ในการชำระเงินเป็นยอด "รอจัดสรร" (`payment_balances.unallocated_satang`) ไม่นับเป็นรายได้ | — |
| เงินประกัน | ทะเบียนแยก `deposit_entries` การหักและการคืนต้องมีผู้อนุมัติและเหตุผล | — |

## 2. ลำดับการแปลงต่ออาคาร

1. **Party** ← `tenants/{roomId}` (ชื่อ เบอร์ ผู้ติดต่อฉุกเฉิน) และ `line_rooms` (LINE user)
   - `legacy_ref = firestore:tenants/<bid>/<rid>` ไม่รวมคนจากชื่อเหมือนกัน (LEA-01)
2. **Contract** ← `leases` ที่มีอยู่แล้ว
   - เติม `party_id` เมื่อ `tenant_name` + เบอร์ ตรงกับ Party ของห้องเดียวกันแบบไม่กำกวม ถ้าไม่ตรงหรือตรงหลายราย → issue `party_ambiguous`
   - ห้องที่มีผู้เช่าแต่ไม่มี lease → issue `no_contract`
3. **lease_units** ← `leases.start_date/end_date/status` (active → `occupied`) ถ้าช่วงเวลาซ้อนกันจะถูก constraint ปฏิเสธ → issue `overlap`
4. **Deposit** ← `leases.deposit_satang` → รายการ `required`
   - `tenants.deposit_status = 'held'` → รายการ `received` อ้างอิงเดิม
   - `returned` หรือ `deducted` ที่ไม่มีหลักฐานยอด → issue `deposit_unknown_amount`
5. **Meter readings** ← `bills.prev_*/curr_*` ทีละงวด (ค่า curr ของงวด และ prev เป็น `previous_reading`) ค่าที่ลดลงโดยไม่มีเหตุผล → issue `reading_decreased`
6. **Invoice + lines** ← `bills` ผ่าน `mapLegacyBill`
   - ยอดรวมต้องเท่ากับที่ผู้เช่าเห็น ถ้าส่วนย่อยรวมไม่ตรงจะเพิ่มบรรทัด `adjustment` และขึ้น issue `total_mismatch`
7. **Payment + allocation**
   - บิลที่จ่ายแล้ว (ฟิลด์ในบิล) ← `mapLegacyBill.payment`
   - บิลที่ `payments_recorded` ← `buildings/{bid}/payments` (`allocations[]` เดิมใช้สตางค์อยู่แล้ว)
   - สลิปที่ยังรอตรวจ → `pending_verification` ไม่จัดสรร
8. **Portal grants** ← สร้างใหม่ให้ Party ของสัญญาที่ active (ลิงก์ `portal_links` เดิมใช้ได้ถึงวันตัดระบบ)

ทุกแถวมี `legacy_ref` ที่ unique ต่อองค์กร การรันซ้ำจึงข้ามแถวที่มีอยู่แล้ว (`on conflict do nothing`) และไม่สร้างซ้ำ

## 3. ขั้นตอนการรัน

| ขั้น | ทำอะไร | เกณฑ์ผ่านก่อนไปขั้นถัดไป |
|---|---|---|
| 0. เตรียม | apply migration ที่ staging · export Firestore ของอาคาร · ยืนยันว่า backup กู้คืนได้ (NFR-09) | restore ทดลองที่ staging สำเร็จ |
| 1. Dry run | runner อ่าน Firestore แล้ว map ทั้งหมดโดยไม่เขียนตารางธุรกิจ บันทึก `migration_runs (dry_run = true)` + `migration_issues` | ได้รายงานจำนวนและยอดต่อห้อง |
| 2. ตรวจ issue | เจ้าของ/ทีมแก้ข้อมูลต้นทางหรือบันทึกการตัดสินใจใน `resolution` | ไม่มี issue ประเภท `overlap`, `invalid_total`, `missing_room_or_period` ค้าง |
| 3. หยุดเขียน | เปิดโหมด "กำลังย้ายข้อมูล" ต่ออาคาร (feature flag) ปิดการบันทึกบิล มิเตอร์ และรับเงินชั่วคราว | ไม่มีรายการใหม่หลังเวลาตัด |
| 4. รันจริง | รันทีละห้อง เก็บ `checkpoint` ใน `migration_runs` ถ้าหยุดกลางทางให้รันต่อจาก checkpoint | — |
| 5. กระทบยอด | ตรวจตามข้อ 4 ด้านล่าง | ทุกข้อเท่ากัน หรือต่างตาม issue ที่อนุมัติแล้ว |
| 6. ตัดระบบ | เปิด flag `billing_v2` ให้อาคาร app อ่าน/เขียนผ่าน API ใหม่ ส่วน `bills` ใน Firestore ถูกเขียนโดย outbox worker เป็น read model | ทดสอบ UAT-03..06 กับอาคารนำร่อง |

## 4. การกระทบยอด (ต้องเท่ากันต่ออาคารและต่อห้อง)

- จำนวน `bills` = จำนวน invoice ที่ `legacy_ref` ชี้มา (ไม่นับที่ข้ามพร้อม issue)
- Σ `total_bill` (บาท→สตางค์) = Σ `invoices.total_satang`
- Σ เงินที่บิลเดิมแสดงว่าจ่ายแล้ว = Σ allocation ของ payment ที่ `confirmed`
- ยอดค้างต่อห้อง (บิลเดิม) = Σ `invoice_balances.outstanding_satang`
- เงินประกันที่ถืออยู่ต่อสัญญา = `deposit_balances.held_satang`
- สุ่มตรวจเอกสาร 10 ห้อง: ตัวเลขบน invoice snapshot ตรงกับบิลที่ผู้เช่าได้รับ
- สิทธิ์: ผู้เช่าห้อง A เปิดข้อมูลห้อง B ไม่ได้ทั้งก่อนและหลังตัดระบบ

## 5. Rollback

- ปิด flag `billing_v2` ของอาคาร แล้ว app จะกลับไปอ่านบิลใน Firestore ตามเดิม (Firestore ไม่ถูกลบหรือแก้ระหว่างการแปลง)
- รายการที่เกิดใน Supabase **หลัง**เวลาตัด (`created_at > cutover`) จะแสดงเป็นรายงานให้บันทึกกลับในระบบเดิม **ห้าม restore snapshot เก่าทับข้อมูลใหม่** (ข้อ 12.8)
- outbox ที่ยังค้างของอาคารนั้นถูกตั้งเป็น `cancelled` พร้อมเหตุผล

## 6. สิ่งที่ทำแล้วและยังไม่ทำ

| ส่วน | สถานะ |
|---|---|
| Schema + constraint + ฟังก์ชันสถานะ + outbox + ตารางบันทึกการ migration | ✅ เทสต์บน PGlite (`api/_core-billing.migration.test.ts`) |
| Mapping บิล → invoice/lines/payment | ✅ เทสต์ (`api/_migrate-r1.test.ts`) |
| Mapping ผู้เช่า → Party, lease → party/units, deposit, meter readings, payments collection | ⏳ ถัดไป |
| Runner (dry run, checkpoint, รายงาน) + endpoint สำหรับเจ้าของดู/แก้ issue | ⏳ |
| Outbox worker (cron) + read model ใน Firestore | ⏳ |
| `/api/billing` (สร้าง/อนุมัติ/ออกบิล รับเงิน จัดสรร) + หน้าจอ | ⏳ |
| Feature flag ต่ออาคาร | ⏳ |
