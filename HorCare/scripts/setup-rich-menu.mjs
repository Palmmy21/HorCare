/**
 * setup-rich-menu.mjs
 *
 * อัปเดต Rich Menu ที่มีอยู่แล้ว:
 *   - ดึง default rich menu ปัจจุบัน
 *   - clone layout เดิมทั้งหมด แต่เปลี่ยนปุ่ม "ดูบิล" ให้ส่งข้อความ "พอร์ทัล" แทน
 *   - copy รูปภาพเดิมมาใช้
 *   - ตั้ง menu ใหม่เป็น default แล้วลบอันเก่า
 *
 * วิธีใช้:
 *   LINE_CHANNEL_ACCESS_TOKEN=<token> node scripts/setup-rich-menu.mjs
 *
 * ต้องการ: Node.js 18+ (fetch built-in)
 */

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('❌ กรุณาตั้ง LINE_CHANNEL_ACCESS_TOKEN ก่อนรัน');
  process.exit(1);
}

const BASE = 'https://api.line.me/v2/bot';
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

async function lineAPI(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(`LINE API ${res.status}: ${path}`), { body: json });
  return json;
}

/** ดาวน์โหลด binary ของภาพ rich menu */
async function downloadMenuImage(richMenuId) {
  const res = await fetch(`${BASE}/richmenu/${richMenuId}/content`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

/** อัปโหลดภาพไปยัง rich menu ที่สร้างใหม่ */
async function uploadMenuImage(richMenuId, buffer, contentType) {
  const res = await fetch(`${BASE}/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      Authorization: `Bearer ${TOKEN}`,
    },
    body: buffer,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`อัปโหลดภาพไม่สำเร็จ (${res.status}): ${t.slice(0, 120)}`);
  }
}

/** หา default rich menu ของ bot (ถ้ามี) */
async function getDefaultMenuId() {
  try {
    const { richMenuId } = await lineAPI('GET', '/user/all/richmenu');
    return richMenuId ?? null;
  } catch {
    return null;
  }
}

(async () => {
  try {
    console.log('🔍 ดึง Rich Menu ปัจจุบัน...\n');

    // ── 1. หา default menu ────────────────────────────────────────
    const defaultMenuId = await getDefaultMenuId();

    // ── 2. ดึงรายการ menus ทั้งหมด ───────────────────────────────
    const { richmenus } = await lineAPI('GET', '/richmenu/list');
    if (!richmenus?.length) {
      console.error('❌ ไม่พบ Rich Menu บัญชีนี้ กรุณาสร้าง Rich Menu ก่อนผ่าน LINE Developers Console');
      process.exit(1);
    }

    // ใช้ default menu ก่อน ถ้าไม่มีให้ใช้อันแรก
    const targetId = defaultMenuId ?? richmenus[0].richMenuId;
    const oldMenu = await lineAPI('GET', `/richmenu/${targetId}`);
    console.log(`✅ พบ Rich Menu: "${oldMenu.name}" (${targetId})`);
    console.log(`   ขนาด: ${oldMenu.size.width}×${oldMenu.size.height}`);
    console.log(`   จำนวนปุ่ม: ${oldMenu.areas.length}\n`);

    // ── 3. แสดง areas เดิม ────────────────────────────────────────
    console.log('📋 ปุ่มที่มีอยู่:');
    oldMenu.areas.forEach((area, i) => {
      const action = area.action;
      const label = action.label || action.text || action.type;
      console.log(`   [${i + 1}] "${label}" → ${action.type}: "${action.text || action.uri || ''}"`);
    });
    console.log('');

    // ── 4. Clone areas แล้วเปลี่ยนเฉพาะปุ่ม "ดูบิล" ─────────────
    // ค้นหาปุ่มที่มี text = "บิล" หรือ label = "ดูบิล"
    let replaced = 0;
    const newAreas = oldMenu.areas.map(area => {
      const a = area.action;
      const isViewBill =
        (a.type === 'message' && (a.text === 'บิล' || a.text === 'ดูบิล')) ||
        (a.label === 'ดูบิล');

      if (!isViewBill) return area;

      replaced++;
      return {
        ...area,
        action: {
          type: 'message',
          label: 'พอร์ทัล',
          text: 'พอร์ทัล',
        },
      };
    });

    if (replaced === 0) {
      console.warn('⚠️  ไม่พบปุ่ม "ดูบิล" (text="บิล"/"ดูบิล" หรือ label="ดูบิล") ใน menu นี้');
      console.warn('   ตรวจสอบ areas ข้างต้น แล้วแก้ไขเงื่อนไขใน script ตรง isViewBill\n');
      process.exit(1);
    }
    console.log(`🔄 เปลี่ยนปุ่ม "ดูบิล" → "พอร์ทัล" (${replaced} ปุ่ม)\n`);

    // ── 5. ดาวน์โหลดภาพเดิม ──────────────────────────────────────
    console.log('🖼  ดาวน์โหลดภาพ rich menu เดิม...');
    const img = await downloadMenuImage(targetId);
    if (!img) {
      console.warn('⚠️  ดาวน์โหลดภาพไม่สำเร็จ — จะสร้าง menu ใหม่โดยไม่มีภาพ');
      console.warn('   คุณต้องอัปโหลดภาพใหม่เองผ่าน LINE Developers Console\n');
    } else {
      console.log(`   ได้ภาพ ${img.contentType} ขนาด ${(img.buffer.length / 1024).toFixed(1)} KB\n`);
    }

    // ── 6. สร้าง menu ใหม่ด้วย layout เดิม + areas ที่อัปเดตแล้ว ──
    const newMenuPayload = {
      size: oldMenu.size,
      selected: oldMenu.selected ?? true,
      name: oldMenu.name,
      chatBarText: oldMenu.chatBarText,
      areas: newAreas,
    };

    const { richMenuId: newMenuId } = await lineAPI('POST', '/richmenu', newMenuPayload);
    console.log(`✅ สร้าง Rich Menu ใหม่สำเร็จ: ${newMenuId}`);

    // ── 7. อัปโหลดภาพไปยัง menu ใหม่ ────────────────────────────
    if (img) {
      await uploadMenuImage(newMenuId, img.buffer, img.contentType);
      console.log('✅ copy ภาพไปยัง menu ใหม่สำเร็จ');
    }

    // ── 8. ตั้ง menu ใหม่เป็น default ────────────────────────────
    await lineAPI('POST', `/user/all/richmenu/${newMenuId}`);
    console.log('✅ ตั้งเป็น default menu สำหรับผู้ใช้ทุกคนแล้ว');

    // ── 9. ลบ menu เก่า ───────────────────────────────────────────
    await lineAPI('DELETE', `/richmenu/${targetId}`);
    console.log(`🗑  ลบ menu เก่า (${targetId}) แล้ว`);

    console.log('\n🎉 เสร็จสิ้น! ปุ่ม "ดูบิล" ถูกเปลี่ยนเป็น "พอร์ทัล" แล้ว');
    console.log('   ลูกหอกดปุ่ม → bot ตอบลิงก์พอร์ทัลส่วนตัวพร้อมปุ่มเปิดได้เลย');
  } catch (err) {
    console.error('\n❌ เกิดข้อผิดพลาด:', err.message);
    if (err.body) console.error('   Detail:', JSON.stringify(err.body, null, 2));
    process.exit(1);
  }
})();
