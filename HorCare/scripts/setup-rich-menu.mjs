/**
 * setup-rich-menu.mjs
 * สร้าง LINE Rich Menu สำหรับ HorCare Bot
 *
 * วิธีใช้:
 *   node scripts/setup-rich-menu.mjs
 *
 * ต้องมี LINE_CHANNEL_ACCESS_TOKEN ใน .env หรือ environment variable
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── โหลด .env ด้วยมือ (ไม่พึ่ง dotenv เพื่อลด dependency) ────────────────────
function loadEnv() {
    const envPath = resolve(ROOT, '.env');
    if (!existsSync(envPath)) return;
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key && !process.env[key]) process.env[key] = val;
    }
}

loadEnv();

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) {
    console.error('❌ ไม่พบ LINE_CHANNEL_ACCESS_TOKEN ใน .env');
    process.exit(1);
}

const BASE = 'https://api.line.me';
const HEADERS = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
};

// ── 1. โครงสร้าง Rich Menu (2x2 — compact height 843px) ──────────────────────
const richMenu = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'HorCare Main Menu',
    chatBarText: '☰ เมนู',
    areas: [
        {
            // บน-ซ้าย: ระบบทำงานยังไง?
            bounds: { x: 0, y: 0, width: 1250, height: 421 },
            action: {
                type: 'message',
                label: 'ระบบทำงานยังไง?',
                text: 'ระบบทำงานยังไง?',
            },
        },
        {
            // บน-ขวา: ราคาเท่าไหร่?
            bounds: { x: 1250, y: 0, width: 1250, height: 421 },
            action: {
                type: 'message',
                label: 'ราคาเท่าไหร่?',
                text: 'ราคาเท่าไหร่?',
            },
        },
        {
            // ล่าง-ซ้าย: ติดต่อแอดมิน
            bounds: { x: 0, y: 421, width: 1250, height: 422 },
            action: {
                type: 'message',
                label: 'ติดต่อแอดมิน',
                text: 'ติดต่อแอดมิน',
            },
        },
        {
            // ล่าง-ขวา: ดูบิล
            bounds: { x: 1250, y: 421, width: 1250, height: 422 },
            action: {
                type: 'message',
                label: 'ดูบิล',
                text: 'บิล',
            },
        },
    ],
};

// ── 2. ลบ Rich Menu เก่าทั้งหมด (cleanup) ────────────────────────────────────
async function deleteAllRichMenus() {
    const res = await fetch(`${BASE}/v2/bot/richmenu/list`, { headers: HEADERS });
    if (!res.ok) return;
    const data = await res.json();
    const menus = data.richmenus || [];
    if (menus.length === 0) {
        console.log('ℹ️  ไม่มี Rich Menu เก่าให้ลบ');
        return;
    }
    console.log(`🗑️  พบ Rich Menu เก่า ${menus.length} รายการ กำลังลบ...`);
    for (const menu of menus) {
        await fetch(`${BASE}/v2/bot/richmenu/${menu.richMenuId}`, {
            method: 'DELETE',
            headers: HEADERS,
        });
        console.log(`   ✓ ลบ ${menu.richMenuId} (${menu.name})`);
    }
}

// ── 3. สร้าง Rich Menu ────────────────────────────────────────────────────────
async function createRichMenu() {
    const res = await fetch(`${BASE}/v2/bot/richmenu`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(richMenu),
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(`สร้าง Rich Menu ไม่สำเร็จ: ${JSON.stringify(data)}`);
    }
    return data.richMenuId;
}

// ── 4. Resize รูปให้ได้ขนาดที่ LINE กำหนด (2500×843) ───────────────────────
async function resizeImage(inputPath, outputPath) {
    // โหลด Jimp ซึ่งมีอยู่แล้วใน dependencies
    const { Jimp } = await import('jimp');
    const img = await Jimp.read(inputPath);
    img.resize({ w: 2500, h: 843 }); // LINE Rich Menu compact size
    // บันทึกเป็น JPEG quality 80 เพื่อให้ไฟล์ไม่เกิน 1MB (LINE limit)
    await img.write(outputPath, { quality: 80 });
    console.log(`   ✓ Resize สำเร็จ: ${img.width}×${img.height}`);
}

// ── 5. อัปโหลดรูป Rich Menu ───────────────────────────────────────────────────
async function uploadImage(richMenuId, imagePath) {
    if (!existsSync(imagePath)) {
        console.warn(`⚠️  ไม่พบรูป: ${imagePath} — ข้ามการอัปโหลดรูป`);
        console.warn('   Rich Menu จะมีพื้นหลังว่างเปล่า ให้ไปอัปโหลดรูปเองใน LINE Developers Console');
        return false;
    }

    // Resize ก่อน upload (LINE ต้องการ 2500×843 พอดี, ไฟล์ต้องไม่เกิน 1MB)
    const resizedPath = imagePath.replace(/\.\w+$/, '-resized.jpg'); // บันทึกเป็น JPEG เสมอ
    await resizeImage(imagePath, resizedPath);

    const imageBuffer = readFileSync(resizedPath);
    const contentType = 'image/jpeg';

    console.log(`   📦 ขนาดไฟล์: ${(imageBuffer.length / 1024).toFixed(1)} KB`);

    const res = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': contentType,
        },
        body: imageBuffer,
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`อัปโหลดรูปไม่สำเร็จ (${res.status}): ${txt}`);
    }
    return true;
}

// ── 5. ตั้งเป็น Default Rich Menu ────────────────────────────────────────────
async function setDefault(richMenuId) {
    const res = await fetch(`${BASE}/v2/bot/user/all/richmenu/${richMenuId}`, {
        method: 'POST',
        headers: HEADERS,
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`ตั้ง Default ไม่สำเร็จ (${res.status}): ${txt}`);
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀 HorCare Rich Menu Setup\n');

    // หารูป — ลองหลาย path
    const imageCandidates = [
        resolve(ROOT, 'scripts', 'rich-menu.png'),
        resolve(ROOT, 'scripts', 'rich-menu.jpg'),
        resolve(ROOT, 'public', 'rich-menu.png'),
    ];
    const imagePath = imageCandidates.find(existsSync) || imageCandidates[0];

    try {
        // Step 1: ลบเก่า
        await deleteAllRichMenus();

        // Step 2: สร้างใหม่
        console.log('\n📐 กำลังสร้าง Rich Menu...');
        const richMenuId = await createRichMenu();
        console.log(`   ✅ สร้างสำเร็จ: ${richMenuId}`);

        // Step 3: อัปโหลดรูป
        console.log('\n🖼️  กำลังอัปโหลดรูป Rich Menu...');
        const uploaded = await uploadImage(richMenuId, imagePath);
        if (uploaded) console.log('   ✅ อัปโหลดรูปสำเร็จ');

        // Step 4: ตั้งเป็น default
        console.log('\n🌐 กำลังตั้งเป็น Default Rich Menu...');
        await setDefault(richMenuId);
        console.log('   ✅ ตั้ง Default สำเร็จ');

        console.log('\n🎉 Rich Menu พร้อมใช้งานแล้ว!');
        console.log(`   Rich Menu ID: ${richMenuId}`);
        if (!uploaded) {
            console.log('\n📌 ขั้นตอนต่อไป — อัปโหลดรูปเอง:');
            console.log('   1. ไปที่ https://developers.line.biz');
            console.log('   2. เลือก Channel → Messaging API → Rich Menu');
            console.log(`   3. เลือก Rich Menu ID: ${richMenuId}`);
            console.log('   4. อัปโหลดรูปขนาด 2500×843px');
        }
    } catch (err) {
        console.error('\n❌ เกิดข้อผิดพลาด:', err.message);
        process.exit(1);
    }
}

main();
