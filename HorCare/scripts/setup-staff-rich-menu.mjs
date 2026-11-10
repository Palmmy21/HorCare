/**
 * setup-staff-rich-menu.mjs
 *
 * The rich menus of the TEAM LINE Official Account "HorCare Maintenance" (/api/line-staff-webhook, not the tenants' OA).
 * One menu per kind of person; the server puts each LINE account on the right one (api/_staff-menu.ts finds them by name):
 *
 *   register      everyone until they are linked (the OA's default)   ลงทะเบียน · คู่มือ · ช่วยเหลือ
 *   technician    ช่าง                                                  งานของฉัน · ส่งงาน · ช่วยเหลือ
 *   housekeeping  แม่บ้าน                                               งานของฉัน · จดมิเตอร์ · ส่งงาน · ช่วยเหลือ
 *   admin         ผู้ดูแล / แอดมิน (a linked HorCare account)            งานทั้งหมด · ทีมงาน · จดมิเตอร์ · ช่วยเหลือ
 *
 * Every button sends a word the webhook understands (src/shared/staffBot.ts); the answer is a card with one big button
 * made for that person, so no link is ever baked into a menu. Few, large buttons: many of the people using them rarely
 * use apps.
 *
 * Usage (Node 18+). Deploy the server first: until it runs this code, linked staff would be left on the register menu.
 *   node scripts/setup-staff-rich-menu.mjs --render      draw rich-menu/staff-<menu>.png for every menu (needs Chrome or Edge)
 *   LINE_STAFF_CHANNEL_ACCESS_TOKEN=… node scripts/setup-staff-rich-menu.mjs --dry-run   ask LINE to validate, change nothing
 *   LINE_STAFF_CHANNEL_ACCESS_TOKEN=… node scripts/setup-staff-rich-menu.mjs             install: create all four, make
 *                                         "register" the default, delete the menus this script made before
 *   … --keep-old                          leave the previous menus in place
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'rich-menu');
const W = 2500, H = 1686;
const pngOf = menu => join(OUT, `staff-${menu}.png`);
/** Must match staffMenuName() in src/shared/staffBot.ts. */
const nameOf = menu => `horcare-staff-${menu}`;
/** Menus made by earlier versions of this script, replaced on install. */
const LEGACY_NAMES = ['HorCare staff menu'];

// ── icons (Lucide, 24×24 stroke) ─────────────────────────────────────────────
const ICONS = {
    register: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
    guide: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    jobs: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
    submit: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    meter: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    team: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
};

// ── the menus: one definition draws the picture and makes the tap areas ──────
const TOP = H / 2, BOTTOM = H - TOP, HALF_W = W / 2, HALF_H = H / 2;
const wide = (label, sub, icon, text) => ({ x: 0, y: 0, w: W, h: TOP, label, sub, icon, text, primary: true });
const low = (i, label, sub, icon, text) => ({ x: i * HALF_W, y: TOP, w: HALF_W, h: BOTTOM, label, sub, icon, text });
const quad = (col, row, label, sub, icon, text, primary = false) => ({ x: col * HALF_W, y: row * HALF_H, w: HALF_W, h: HALF_H, label, sub, icon, text, primary });

const MENUS = {
    register: { chatBarText: 'ลงทะเบียน', tiles: [
        wide('ลงทะเบียน', 'ขอ QR จากผู้จัดการ แล้วสแกน', 'register', 'ลงทะเบียน'),
        low(0, 'คู่มือ', 'วิธีใช้ มีรูปประกอบ', 'guide', 'คู่มือ'),
        low(1, 'ช่วยเหลือ', 'ติดขัดตรงไหน กดที่นี่', 'help', 'ช่วยเหลือ'),
    ] },
    technician: { chatBarText: 'เมนูงาน', tiles: [
        wide('งานของฉัน', 'งานซ่อมที่ได้รับทั้งหมด', 'jobs', 'งานของฉัน'),
        low(0, 'ส่งงาน', 'ถ่ายรูป แล้วกดเสร็จ', 'submit', 'ส่งงาน'),
        low(1, 'ช่วยเหลือ', 'ติดขัดตรงไหน กดที่นี่', 'help', 'ช่วยเหลือ'),
    ] },
    housekeeping: { chatBarText: 'เมนูงาน', tiles: [
        quad(0, 0, 'งานของฉัน', 'ห้องที่ต้องทำ', 'jobs', 'งานของฉัน', true),
        quad(1, 0, 'จดมิเตอร์', 'น้ำ-ไฟ ถ่ายรูปได้', 'meter', 'จดมิเตอร์'),
        quad(0, 1, 'ส่งงาน', 'ถ่ายรูป แล้วกดเสร็จ', 'submit', 'ส่งงาน'),
        quad(1, 1, 'ช่วยเหลือ', 'ติดขัด กดที่นี่', 'help', 'ช่วยเหลือ'),
    ] },
    admin: { chatBarText: 'เมนูผู้ดูแล', tiles: [
        quad(0, 0, 'งานทั้งหมด', 'มอบหมาย ตรวจรับงาน', 'jobs', 'งานทั้งหมด', true),
        quad(1, 0, 'ทีมงาน', 'อนุมัติ · QR ลงทะเบียน', 'team', 'ทีมงาน'),
        quad(0, 1, 'จดมิเตอร์', 'เปิดหน้าจดมิเตอร์', 'meter', 'จดมิเตอร์'),
        quad(1, 1, 'ช่วยเหลือ', 'คู่มือและวิธีใช้', 'help', 'ช่วยเหลือ'),
    ] },
};

const menuPayload = menu => ({
    size: { width: W, height: H }, selected: true, name: nameOf(menu), chatBarText: MENUS[menu].chatBarText,
    areas: MENUS[menu].tiles.map(t => ({
        bounds: { x: t.x, y: t.y, width: t.w, height: t.h },
        action: { type: 'message', label: t.label, text: t.text },
    })),
});

// ── drawing ──────────────────────────────────────────────────────────────────
function html(menu) {
    const tile = t => {
        const row = t.w === W;          // the full-width tile lays its icon beside the words
        return `<div class="tile${t.primary ? ' primary' : ''}${row ? ' row' : ''}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px">
  <svg viewBox="0 0 24 24">${ICONS[t.icon]}</svg>
  <div><div class="label">${t.label}</div><div class="sub">${t.sub}</div></div>
</div>`;
    };
    return `<!doctype html><html lang="th"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anuphan:wght@500;600;700&display=swap">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #DCE5EF; }
  body { position: relative; font-family: 'Anuphan', 'Leelawadee UI', 'Noto Sans Thai', sans-serif; }
  .tile { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
          background: #FFFFFF; color: #102A43; border: 4px solid #DCE5EF; }
  .tile svg { width: 260px; height: 260px; fill: none; stroke: #0A6CC2; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .label { font-size: 168px; font-weight: 700; line-height: 1.2; margin-top: 64px; letter-spacing: -0.01em; }
  .sub { font-size: 78px; font-weight: 500; line-height: 1.3; margin-top: 14px; color: #557089; }
  .tile.primary { background: #0A5DAA; border-color: #0A5DAA; color: #FFFFFF; }
  .tile.primary svg { stroke: #FFB36B; }
  .tile.primary .sub { color: #CFE3F7; }
  .tile.row { flex-direction: row; gap: 130px; text-align: left; padding: 0 90px; }
  .tile.row svg { width: 440px; height: 440px; stroke-width: 1.5; flex: none; }
  .tile.row .label { font-size: 270px; margin-top: 0; }
  .tile.row .sub { font-size: 100px; margin-top: 24px; }
</style></head><body>
${MENUS[menu].tiles.map(tile).join('\n')}
</body></html>`;
}

function render() {
    const browser = [
        process.env.CHROME_PATH,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome', '/usr/bin/chromium',
    ].find(p => p && existsSync(p));
    if (!browser) throw new Error('Chrome or Edge not found; set CHROME_PATH');
    const tmp = mkdtempSync(join(tmpdir(), 'horcare-menu-'));
    try {
        for (const menu of Object.keys(MENUS)) {
            const page = join(tmp, `${menu}.html`);
            writeFileSync(page, html(menu));
            execFileSync(browser, [
                '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                `--window-size=${W},${H}`, '--virtual-time-budget=8000', `--screenshot=${pngOf(menu)}`, pathToFileURL(page).href,
            ], { stdio: 'ignore' });
            console.log(`rendered ${pngOf(menu)} (${(statSync(pngOf(menu)).size / 1024).toFixed(0)} KB)`);
        }
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// ── LINE ─────────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
if (args.has('--render')) { render(); process.exit(0); }

const TOKEN = process.env.LINE_STAFF_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) { console.error('Set LINE_STAFF_CHANNEL_ACCESS_TOKEN (the team OA, not the tenants\' one).'); process.exit(1); }

async function line(method, path, body, host = 'api.line.me') {
    const isImage = Buffer.isBuffer(body);
    const res = await fetch(`https://${host}/v2/bot${path}`, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': isImage ? 'image/png' : 'application/json' } : {}) },
        body: body ? (isImage ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LINE ${res.status} ${method} ${path}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
}

try {
    const menus = Object.keys(MENUS);
    const images = {};
    for (const menu of menus) {
        if (!existsSync(pngOf(menu))) throw new Error(`Missing ${pngOf(menu)}; run with --render first.`);
        images[menu] = readFileSync(pngOf(menu));
        if (images[menu].length > 1024 * 1024) throw new Error(`${pngOf(menu)} is over LINE's 1 MB limit.`);
    }

    const info = await line('GET', '/info');
    console.log(`OA: ${info.displayName} (${info.basicId})`);
    for (const menu of menus) await line('POST', '/richmenu/validate', menuPayload(menu));
    console.log(`${menus.length} menu definitions are valid`);
    if (args.has('--dry-run')) process.exit(0);

    const before = (await line('GET', '/richmenu/list')).richmenus ?? [];
    const mine = before.filter(m => m.name.startsWith('horcare-staff-') || LEGACY_NAMES.includes(m.name));

    const ids = {};
    for (const menu of menus) {
        ids[menu] = (await line('POST', '/richmenu', menuPayload(menu))).richMenuId;
        await line('POST', `/richmenu/${ids[menu]}/content`, images[menu], 'api-data.line.me');
        console.log(`created ${nameOf(menu)} → ${ids[menu]}`);
    }
    await line('POST', `/user/all/richmenu/${ids.register}`);
    console.log('default menu (everyone not linked yet) is now "register"');

    if (args.has('--keep-old')) {
        if (mine.length) console.log(`kept ${mine.length} previous menu(s): ${mine.map(m => m.richMenuId).join(', ')}`);
    } else {
        for (const m of mine) { await line('DELETE', `/richmenu/${m.richMenuId}`); console.log(`deleted previous menu ${m.name} (${m.richMenuId})`); }
    }
    console.log('done. Linked staff move to their own menu the next time they tap or type anything.');
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
