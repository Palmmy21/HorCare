# HorCare Launch Checklist — ขั้นตอนการตรวจเช็คก่อนใช้งานจริง

## วิธีใช้
ทำตามลำดับ ✅ = ผ่าน / ❌ = ต้องแก้ไข

---

## ขั้นตอนที่ 1 — Vercel Environment Variables

เปิด https://vercel.com → โปรเจกต์ HorCare → Settings → Environment Variables

| Variable | ค่าที่ต้องมี | ตรวจสอบ |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | JSON ของ service account (ดู Firebase Console → Project Settings → Service Accounts) | [ ] |
| `FIREBASE_STORAGE_BUCKET` | เช่น `horcare-xxxx.firebasestorage.app` | [ ] |
| `STRIPE_SECRET_KEY` | ขึ้นต้นด้วย `sk_live_` (ไม่ใช่ `sk_test_`) | [ ] |
| `STRIPE_WEBHOOK_SECRET` | ขึ้นต้นด้วย `whsec_` (จาก Stripe Dashboard → Webhooks → Live) | [ ] |
| `LINE_CHANNEL_ACCESS_TOKEN` | จาก LINE Developers Console → Messaging API | [ ] |
| `LINE_CHANNEL_SECRET` | จาก LINE Developers Console → Basic settings | [ ] |
| `CRON_SECRET` | รหัสลับใดก็ได้ (เช่น UUID) ต้องตรงกับที่ตั้งใน Vercel | [ ] |
| `APP_URL` | `https://horcare.app` (หรือ domain จริง ไม่มี / ท้าย) | [ ] |

**วิธีตรวจสอบ:** หลังตั้งค่า ให้ Redeploy แล้วเปิด Vercel Function Logs ดูว่า "Firebase Admin initialized" ขึ้นหรือไม่

---

## ขั้นตอนที่ 2 — Stripe Dashboard (Live Mode)

เปิด https://dashboard.stripe.com → ปิด "Test mode" (toggle มุมบนขวา)

### 2.1 Webhook
- [ ] ไปที่ Developers → Webhooks → Add endpoint
- [ ] URL: `https://[domain]/api/stripe-webhook`
- [ ] Events ที่ต้อง subscribe: `checkout.session.completed`
- [ ] คัดลอก **Signing secret** (`whsec_...`) ไปใส่ใน `STRIPE_WEBHOOK_SECRET` ใน Vercel
- [ ] สถานะ webhook ต้องเป็น **Enabled**

### 2.2 PromptPay
- [ ] ไปที่ Settings → Payment methods → PromptPay → Enable
- [ ] ต้องมีบัญชีธนาคารไทยที่ verified กับ Stripe

### 2.3 ทดสอบ
```
1. เปิดแอป → กดอัปเกรด → เลือกแผน → สแกน PromptPay
2. ชำระเงินจริง (จำนวนน้อยสุด ฿79)
3. ตรวจใน Stripe Dashboard → Payments ว่า status = "Succeeded"
4. ตรวจใน Firestore users/{uid} ว่า subscription_status = "active" และ access_until มีวันหมดอายุ
5. ตรวจว่าฟีเจอร์ Pro ในแอปเปิดให้ใช้งานได้แล้ว
```

---

## ขั้นตอนที่ 3 — Firebase Console

### 3.1 Firestore Indexes (จำเป็นสำหรับระบบทวงบิลอัตโนมัติ)
เปิด https://console.firebase.google.com → โปรเจกต์ → Firestore → Indexes → Composite

- [ ] เพิ่ม index: **Collection group** = `bills`, Fields = `month (Ascending)` + `is_saved (Ascending)`, Query scope = **Collection group**
- [ ] รอ index build เสร็จ (สถานะเปลี่ยนเป็น "Enabled" อาจใช้เวลา 5–10 นาที)

> ถ้าไม่มี index นี้ ระบบทวงบิลอัตโนมัติจะ error เงียบๆ โดยไม่ส่งการแจ้งเตือน

### 3.2 Firestore Security Rules
- [ ] ตรวจว่า rules ไม่อนุญาต read/write โดยไม่ผ่าน auth
- [ ] ตรวจว่า `access_until` rule บังคับ license expiry

### 3.3 Firebase Storage
- [ ] Bucket ชื่อตรงกับ `FIREBASE_STORAGE_BUCKET`
- [ ] Storage rules อนุญาตให้ server (admin SDK) เขียนได้

---

## ขั้นตอนที่ 4 — LINE Developers Console

เปิด https://developers.line.biz → โปรเจกต์ HorCare → Messaging API

### 4.1 Webhook
- [ ] Webhook URL: `https://[domain]/api/line-webhook`
- [ ] กดปุ่ม **Verify** → ต้องขึ้น "Success"
- [ ] เปิด **Use webhook** = ON

### 4.2 Rich Menu
- [ ] Rich Menu ถูก publish แล้ว (ใช้ script `HorCare/scripts/setup-rich-menu.mjs`)
- [ ] ทดสอบกดปุ่มบน LINE แล้วได้รับข้อความตอบกลับ:
  - [ ] "ระบบทำงานยังไง?" → ได้รับคำอธิบาย
  - [ ] "ราคาเท่าไหร่?" → ได้รับข้อมูลราคา
  - [ ] "ติดต่อแอดมิน" → ได้รับ LINE contact

### 4.3 LINE Official Account Manager
- [ ] Bot ตั้งเป็น **Chat mode: Bot** (ไม่ใช่ Chat)
- [ ] Auto-reply messages: **OFF**
- [ ] Greeting messages: ตั้งตามต้องการ

---

## ขั้นตอนที่ 5 — ทดสอบ End-to-End (ทดสอบจริงทุกขั้น)

### 5.1 ระบบลงทะเบียนลูกหอ
```
1. เจ้าของเปิดแอป → ตั้งค่า → คัดลอก dorm code (HC-XXXXXX)
2. ลูกหอเพิ่มเพื่อน LINE Official Account
3. ลูกหอพิมพ์รหัส HC-XXXXXX ใน LINE
4. ระบบถามเลขห้อง → ลูกหอตอบเลขห้อง
5. ตรวจใน Firestore line_rooms/{lineUserId} ว่ามีข้อมูล room_id และ building_id
```
ผลลัพธ์ที่ถูกต้อง: ✅ ลูกหอได้รับข้อความยืนยันการลงทะเบียน

### 5.2 ระบบจดมิเตอร์และออกบิล
```
1. เปิดแอป → จดมิเตอร์ → กรอกค่ามิเตอร์ครบทุกช่อง
2. ตรวจ Preview ว่าค่าคำนวณถูกต้อง
3. กด "บันทึก"
4. ไปหน้าสรุป → ตรวจว่าบิลขึ้นในรายการ
```
ผลลัพธ์ที่ถูกต้อง: ✅ บิลปรากฏในตาราง สถานะ "พร้อมส่ง"

### 5.3 ระบบดาวน์โหลดบิล
```
1. หน้าสรุป → กดปุ่มดาวน์โหลด (icon ลูกศรลง) ของห้องใดก็ได้
2. รอประมาณ 1–2 วินาที
3. ไฟล์ bill_[ห้อง]_[เดือน].png ต้องดาวน์โหลดโดยอัตโนมัติ
4. เปิดรูปตรวจว่าข้อมูลครบ ไม่ถูกตัด และ QR PromptPay แสดงถูกต้อง
```
ผลลัพธ์ที่ถูกต้อง: ✅ รูปครบ ไม่ขาด ไม่เพี้ยน

### 5.4 ระบบส่งบิลผ่าน LINE
```
1. หน้าสรุป → กดปุ่ม "ส่งบิลผ่าน LINE"
2. รอผล → ตรวจว่าขึ้น "ส่งสำเร็จ X ห้อง"
3. เปิด LINE ของลูกหอที่ลงทะเบียนแล้ว → ต้องได้รับ Flex Message บิล
```
ผลลัพธ์ที่ถูกต้อง: ✅ ลูกหอได้รับบิลใน LINE

### 5.5 ระบบส่งสลิป (ลูกหอ)
```
1. ลูกหอถ่าย/ส่งรูปสลิปใน LINE chat กับ Bot
2. ระบบตอบกลับ "ได้รับสลิปแล้ว รอเจ้าของยืนยัน"
3. เจ้าของเปิดแอป → Payments → เห็นสลิปรอยืนยัน
4. กดยืนยัน → ตรวจว่าลูกหอได้รับใบเสร็จ LINE
```
ผลลัพธ์ที่ถูกต้อง: ✅ สลิปขึ้นในแอป / ลูกหอได้รับใบเสร็จ

### 5.6 ระบบทวงบิลอัตโนมัติ (ทดสอบ manual)
```
วิธีทดสอบโดยไม่ต้องรอ cron:
curl -X POST https://[domain]/api/remind-bills \
  -H "Authorization: Bearer [CRON_SECRET]"

ดู response: { "ok": true, "reminded": N, "skipped": N }
```
ผลลัพธ์ที่ถูกต้อง: ✅ response ok:true และลูกหอที่มีบิลค้างได้รับข้อความ

### 5.7 Monthly Report PDF
```
1. หน้าสรุป → กด "สรุปรายเดือน"
2. กด "ดาวน์โหลด PDF"
3. รอ PDF → เปิดตรวจว่าข้อมูลครบ
```
ผลลัพธ์ที่ถูกต้อง: ✅ PDF ดาวน์โหลดได้ ไม่ error

---

## ขั้นตอนที่ 6 — ตรวจสอบบนมือถือ

เปิดแอปบนมือถือจริง (ไม่ใช่ Simulator)

- [ ] หน้าสรุป: ตารางบิลแสดงเป็น Card mode (ไม่ใช่ตาราง 4 คอลัมน์)
- [ ] กด "ดูบิล" → Modal เปิดขึ้น → บิลแสดงครบ ไม่เพี้ยน ไม่ scroll แนวนอน
- [ ] บิลใน modal: header ชื่อหอ + "ใบแจ้งหนี้" stack แนวตั้ง
- [ ] QR PromptPay อยู่ข้างบน กำหนดชำระอยู่ข้างล่าง (ไม่บีบข้างกัน)
- [ ] ปุ่มทุกปุ่มกดได้ ไม่ถูกตัด

---

## ขั้นตอนที่ 7 — ตรวจสอบ Vercel Logs หลัง Deploy

เปิด Vercel → โปรเจกต์ → Functions → เลือก function แต่ละตัว

- [ ] `line-webhook`: ไม่มี error ขณะ cold start
- [ ] `stripe-webhook`: ไม่มี "STRIPE_WEBHOOK_SECRET not set"
- [ ] `remind-bills`: ไม่มี "Unauthorized" (CRON_SECRET ถูก)
- [ ] `send-line-bills`: ไม่มี Firebase error

---

## สรุปเช็คลิสต์ก่อน Go-Live

```
[ ] Step 1: Vercel env vars ครบทั้ง 8 ตัว
[ ] Step 2: Stripe webhook live mode ตั้งแล้ว, PromptPay enabled
[ ] Step 3: Firestore composite index (collectionGroup bills) สร้างแล้ว
[ ] Step 4: LINE webhook URL verify ผ่าน, Rich Menu publish แล้ว
[ ] Step 5.1: ทดสอบลงทะเบียนลูกหอผ่าน LINE ✅
[ ] Step 5.2: ทดสอบจดมิเตอร์และออกบิล ✅
[ ] Step 5.3: ทดสอบดาวน์โหลดบิล PNG ✅
[ ] Step 5.4: ทดสอบส่งบิลผ่าน LINE ✅
[ ] Step 5.5: ทดสอบส่งสลิปและยืนยัน ✅
[ ] Step 5.6: ทดสอบ remind-bills manual ✅
[ ] Step 5.7: ทดสอบ Monthly Report PDF ✅
[ ] Step 6: ตรวจบนมือถือจริง ✅
[ ] Step 7: Vercel Function Logs ไม่มี error ✅
```

เมื่อครบทุกข้อ → พร้อม launch ครับ 🚀
