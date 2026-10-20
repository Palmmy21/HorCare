# 🚀 HorCare — Deploy & Env Checklist

คู่มือ deploy ขึ้น **Vercel** + ตั้งค่า **Stripe** และ **LINE Official Account**
ทำตามลำดับ 1 → 6 ทีละข้อ ✅

---

## ขั้นตอนที่ 1 — สมัคร 3 บริการ (ทำก่อน)

| บริการ | ลิงก์ | ทำอะไร |
|--------|-------|--------|
| Vercel | https://vercel.com | สมัครด้วย GitHub (จะ import repo ได้เลย) |
| Stripe | https://dashboard.stripe.com | เริ่มที่ **Test mode** ก่อน (มุมขวาบนมีสวิตช์ Test/Live) |
| LINE | https://developers.line.biz | สร้าง Provider + Messaging API channel (= Official Account) |

---

## ขั้นตอนที่ 2 — เก็บค่า Stripe

### 2.1 API Keys
Dashboard → **Developers → API keys**
- `Secret key` → ขึ้นต้น `sk_test_...` → ใช้กับ env **`STRIPE_SECRET_KEY`**
- `Publishable key` → ขึ้นต้น `pk_test_...` → ใช้กับ env **`VITE_STRIPE_PUBLISHABLE_KEY`**

### 2.2 สร้าง Product + Price 6 ตัว
Dashboard → **Product catalog → Add product**
สร้าง 3 product (Small / Medium / Large) แต่ละอันมี 2 ราคา (รายเดือน + รายปี) → ได้ Price ID 6 ตัว

| แพ็ก | รอบ | สกุล | env (ฝั่ง server) | env (ฝั่ง client) |
|------|-----|------|-------------------|-------------------|
| Small  | เดือน | THB | `STRIPE_PRICE_MONTHLY_SMALL`  | `VITE_STRIPE_SMALL_MONTHLY_PRICE_ID` |
| Small  | ปี    | THB | `STRIPE_PRICE_YEARLY_SMALL`   | `VITE_STRIPE_SMALL_YEARLY_PRICE_ID` |
| Medium | เดือน | THB | `STRIPE_PRICE_MONTHLY_MEDIUM` | `VITE_STRIPE_MEDIUM_MONTHLY_PRICE_ID` |
| Medium | ปี    | THB | `STRIPE_PRICE_YEARLY_MEDIUM`  | `VITE_STRIPE_MEDIUM_YEARLY_PRICE_ID` |
| Large  | เดือน | THB | `STRIPE_PRICE_MONTHLY_LARGE`  | `VITE_STRIPE_LARGE_MONTHLY_PRICE_ID` |
| Large  | ปี    | THB | `STRIPE_PRICE_YEARLY_LARGE`   | `VITE_STRIPE_LARGE_YEARLY_PRICE_ID` |

> Price ID ขึ้นต้นด้วย `price_...` — ต้องใส่ทั้งฝั่ง server (สร้าง checkout) และ client (แสดงปุ่ม)

> ⚠️ `STRIPE_WEBHOOK_SECRET` ยังไม่ต้องหา ตอนนี้ — จะได้หลัง deploy (ขั้นตอนที่ 5)

---

## ขั้นตอนที่ 3 — เก็บค่า LINE Official Account

LINE Developers Console → channel ของคุณ
- แท็บ **Messaging API** → `Channel access token (long-lived)` → กด Issue → env **`LINE_CHANNEL_ACCESS_TOKEN`**
- แท็บ **Basic settings** → `Channel secret` → env **`LINE_CHANNEL_SECRET`**
- `LINE OA ID` (เช่น `@horcare`) → env **`VITE_LINE_OA_ID`** (ใช้ทำลิงก์ให้ผู้เช่าแอดเพื่อน)

> ❌ ไม่ต้องหา "LINE Notify" — ปิดบริการแล้ว โปรเจกต์นี้ใช้ Messaging API

---

## ขั้นตอนที่ 4 — เก็บค่า Firebase

Firebase Console → ⚙️ **Project settings**
- แท็บ **Service accounts** → **Generate new private key** → ได้ไฟล์ JSON
  → เปิดไฟล์ copy **ทั้งก้อน** ใส่ env **`FIREBASE_SERVICE_ACCOUNT`** (วางเป็น string เดียว)
- แท็บ **General** → ค่า config เว็บ (มีอยู่แล้วใน `.env` เดิม) → ใส่ `VITE_FIREBASE_*` ให้ครบ

---

## ขั้นตอนที่ 5 — Deploy บน Vercel

1. Vercel → **Add New → Project → Import** repo `Palmmy21/HorCare`
2. **Root Directory**: ตั้งเป็น `HorCare` (โค้ดอยู่ในโฟลเดอร์ย่อย)
3. **Environment Variables**: ใส่ทุกตัวด้านล่างให้ครบ แล้วกด **Deploy**
4. ได้ URL เช่น `https://horcare.vercel.app` → เอาไปใส่ env **`APP_URL`** แล้ว **Redeploy** อีกรอบ

### รายการ env vars ทั้งหมดที่ต้องใส่ใน Vercel

**ฝั่ง Server (ห้ามมี prefix VITE_):**
```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET          # ใส่ทีหลังในขั้นตอนที่ 6
STRIPE_PRICE_MONTHLY_SMALL
STRIPE_PRICE_MONTHLY_MEDIUM
STRIPE_PRICE_MONTHLY_LARGE
STRIPE_PRICE_YEARLY_SMALL
STRIPE_PRICE_YEARLY_MEDIUM
STRIPE_PRICE_YEARLY_LARGE
APP_URL
FIREBASE_SERVICE_ACCOUNT
LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET
```

**ฝั่ง Client (ต้องมี prefix VITE_ — ใช้ตอน build):**
```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID
VITE_STRIPE_PUBLISHABLE_KEY
VITE_STRIPE_SMALL_MONTHLY_PRICE_ID
VITE_STRIPE_SMALL_YEARLY_PRICE_ID
VITE_STRIPE_MEDIUM_MONTHLY_PRICE_ID
VITE_STRIPE_MEDIUM_YEARLY_PRICE_ID
VITE_STRIPE_LARGE_MONTHLY_PRICE_ID
VITE_STRIPE_LARGE_YEARLY_PRICE_ID
VITE_LINE_OA_ID
```

---

## ขั้นตอนที่ 6 — ตั้ง Webhook (หลังมี URL แล้ว)

### 6.1 Stripe Webhook
Stripe Dashboard → **Developers → Webhooks → Add endpoint**
- Endpoint URL: `https://<your-app>.vercel.app/api/stripe-webhook`
- Events to send (เลือก 4 ตัว):
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- กด Add → copy **Signing secret** (`whsec_...`) → ใส่ env `STRIPE_WEBHOOK_SECRET` ใน Vercel → **Redeploy**

### 6.2 LINE Webhook
LINE Developers → channel → **Messaging API**
- Webhook URL: `https://<your-app>.vercel.app/api/line-webhook`
- เปิด **Use webhook** = ON
- ปิด **Auto-reply messages** / **Greeting messages** (กันชนกับ bot)

---

## ขั้นตอนที่ 7 — ปิดการเข้าถึงข้อมูลแบบสาธารณะ (ตุลาคม 2026)

ผู้เช่าเข้า portal ผ่าน `/api/portal` ด้วยลิงก์ที่มี secret ต่อห้อง (`/?p=...`) และแม่บ้านล็อกอินผ่าน `/api/housekeepers`
ข้อมูลใน Firestore จึงไม่เปิดให้อ่านหรือเขียนโดยไม่ล็อกอินอีกต่อไป

1. **env เพิ่มใน Vercel (ฝั่ง Server)**
   ```
   CRON_SECRET              # cron-check-expiry รับเฉพาะค่านี้ (ไม่ตั้ง = ปฏิเสธทุกคำขอ)
   LINE_LOGIN_CHANNEL_ID    # Channel ID ของ LINE Login ที่ LIFF อยู่ (ตัวเลขหน้าขีดของ LIFF ID)
                            # ไม่ตั้งก็ได้ถ้า VITE_LIFF_ID ถูกส่งให้ฝั่ง server ด้วย
   ```
2. **Stripe webhook**: เพิ่ม event `checkout.session.async_payment_succeeded` (PromptPay ที่ยืนยันหลังปิดหน้า checkout)
3. **ลำดับการ deploy**: deploy โค้ดบน Vercel **ก่อน** แล้วค่อย deploy rules
   `firebase deploy --only firestore:rules` — ต้องใช้บัญชีเจ้าของโปรเจกต์ (CI ไม่ได้ deploy rules)
   โค้ดใหม่ใช้งานได้ทั้งกับ rules เดิมและใหม่ แต่ rules ใหม่ใช้กับโค้ดเดิมไม่ได้
4. **ทดสอบ rules ก่อน deploy**: `npm run test:rules` (ต้องมี Java 21 ใน PATH และใช้ Firestore emulator)
5. **หลัง deploy**
   - ลิงก์ portal แบบเดิม (`/?uid=&bid=&rid=`) ใช้ไม่ได้แล้ว บิล/ค่าปรับ/การแจ้งเตือนที่ส่งทาง LINE หลังจากนี้จะแนบลิงก์ใหม่ให้อัตโนมัติ
     ผู้เช่าขอลิงก์ใหม่ได้โดยพิมพ์ "พอร์ทัล" ใน LINE หรือเจ้าของกด "คัดลอกลิงก์ผู้เช่า" ในหน้าผู้เช่า
   - รหัสแม่บ้านเดิมเคยเปิดให้อ่านได้ ระบบจึงลบรหัสเดิมทิ้งเมื่อเจ้าของเปิดหน้า "งานแม่บ้าน" ครั้งแรก
     เจ้าของต้องตั้งรหัสใหม่ (ตัวเลข 6–8 หลัก) ให้แม่บ้านทุกคน

---

## ✅ ทดสอบหลัง deploy

- [ ] เปิดเว็บ production โหลดได้ ไม่มี error console
- [ ] กดปุ่มสมัครแพ็ก → เด้งไป Stripe Checkout (ใช้บัตรทดสอบ `4242 4242 4242 4242`)
- [ ] จ่ายเสร็จ → กลับมาเว็บ + license ใน Firestore อัปเดตเป็น active (= webhook ทำงาน)
- [ ] ผู้เช่าแอดเพื่อน LINE OA → ผูกห้อง → กดส่งบิล → ได้ Flex บิลใน LINE
- [ ] กดลิงก์ portal ใน Flex บิล → เห็นบิลของห้องตัวเอง → แก้ `?p=` เป็นห้องอื่นแล้วต้องเปิดไม่ได้
- [ ] แม่บ้านล็อกอินด้วยรหัสใหม่ → รับงาน/ปิดงานได้ → เจ้าของเปลี่ยนรหัสแล้วเครื่องแม่บ้านต้องโหลดข้อมูลไม่ได้ทันที (และถูกออกจากระบบเมื่อ token ต่ออายุ ภายใน 1 ชม.)
- [ ] พอทุกอย่างผ่านใน Test mode → สลับ Stripe เป็น **Live mode** แล้วเปลี่ยน key เป็น `sk_live_/pk_live_` + สร้าง webhook ใหม่อีกชุด

---

### สรุปสั้น: ใครทำอะไร
- **คุณ**: สมัคร account, ก็อป key/price/secret, กรอก env ใน Vercel, ตั้ง webhook 2 จุด
- **โค้ด (ทำไว้แล้ว)**: checkout, webhook handler, ส่ง Flex บิล LINE, อัปเดต license อัตโนมัติ
