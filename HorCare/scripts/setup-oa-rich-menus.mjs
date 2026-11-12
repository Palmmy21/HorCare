/**
 * setup-oa-rich-menus.mjs — the rich menus of the resident and staff LINE OAs:
 *
 *   tenant   the tenant OA (dorms, rooms)          token: LINE_CHANNEL_ACCESS_TOKEN
 *            บิล · ส่งสลิป · พอร์ทัล / ประกาศ · แจ้งซ่อม · ช่วยเหลือ (= "ขอความช่วยเหลือ": staff are alerted with the room)
 *   market   "HorCare Markets" (vendors)          token: LINE_MARKET_CHANNEL_ACCESS_TOKEN
 *            บิล · ส่งสลิป · แจ้งหยุด / ประกาศ · พอร์ทัล · ช่วยเหลือ (same)
 *   walkin   HorCare Markets, for walk-ins (ขาจร) — NOT the default: alias horcare-walkin, given per person by the bot
 *            สถานะการจอง · แจ้งเข้าขาย / ลงทะเบียนแผง · ช่วยเหลือ
 *   pos      "HorCare Staff" (POS Care, collectors) token: LINE_POS_CHANNEL_ACCESS_TOKEN
 *            เปิด POS Care / ยอดวันนี้ · ร้านหยุดวันนี้ · ปิดยอด
 *
 * Every button sends a word the webhook understands (src/shared/tenantBot.ts, src/shared/posCare.ts), so no link is ever
 * baked into a menu. One menu per OA, set as its default.
 *
 * Usage (Node 18+):
 *   node scripts/setup-oa-rich-menus.mjs --render                 draw scripts/rich-menu/oa-<name>.png (needs Chrome or Edge)
 *   node scripts/setup-oa-rich-menus.mjs tenant
 *   node scripts/setup-oa-rich-menus.mjs market --dry-run          ask LINE to validate, change nothing
 *   node scripts/setup-oa-rich-menus.mjs market                   install and make it the default (deletes this script's older one)
 *   node scripts/setup-oa-rich-menus.mjs walkin                   (the walk-in menu: sets its alias, leaves the default alone)
 *   node scripts/setup-oa-rich-menus.mjs pos
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'rich-menu');
const W = 2500, H = 1686, HALF = H / 2;

const ICONS = {
    bill: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
    slip: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    closed: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m14 14-4 4"/><path d="m10 14 4 4"/>',
    news: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    portal: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    sos: '<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/>',
    repair: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    calplus: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M12 13v6"/><path d="M9 16h6"/>',
    status: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    pos: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/><path d="M6 15h4"/>',
    today: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
    close: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
};

const third = W / 3;
const cell = (col, row, label, sub, icon, text, primary = false) => ({ x: Math.round(col * third), y: row * HALF, w: Math.round((col + 1) * third) - Math.round(col * third), h: HALF, label, sub, icon, text, primary });
/** The help button: it calls a person at the property at once (the webhook's "support" command), so it stands out. */
const sosCell = (col, row, sub) => ({ ...cell(col, row, 'ช่วยเหลือ', sub, 'sos', 'ขอความช่วยเหลือ'), sos: true });
/** A tile of a 2 × 2 menu. */
const half = (col, row, label, sub, icon, text) => ({ x: col * (W / 2), y: row * HALF, w: W / 2, h: HALF, label, sub, icon, text });

const MENUS = {
    tenant: {
        name: 'horcare-tenant', chatBarText: 'เมนูผู้เช่า', token: 'LINE_CHANNEL_ACCESS_TOKEN',
        tiles: [
            cell(0, 0, 'บิล', 'ดูยอดที่ต้องจ่าย', 'bill', 'บิล', true),
            cell(1, 0, 'ส่งสลิป', 'จ่ายแล้ว ส่งรูปสลิป', 'slip', 'ส่งสลิป'),
            cell(2, 0, 'พอร์ทัล', 'ประวัติบิล สัญญา', 'portal', 'พอร์ทัล'),
            cell(0, 1, 'ประกาศ', 'ข่าวจากหอพัก', 'news', 'ประกาศ'),
            cell(1, 1, 'แจ้งซ่อม', 'ของเสีย ชำรุด', 'repair', 'แจ้งซ่อม'),
            sosCell(2, 1, 'เรียกเจ้าหน้าที่ทันที'),
        ],
    },
    market: {
        name: 'horcare-market-vendor', chatBarText: 'เมนูผู้ค้า', token: 'LINE_MARKET_CHANNEL_ACCESS_TOKEN',
        tiles: [
            cell(0, 0, 'บิล', 'ดูยอดที่ต้องจ่าย', 'bill', 'บิล', true),
            cell(1, 0, 'ส่งสลิป', 'จ่ายแล้ว ส่งรูปสลิป', 'slip', 'ส่งสลิป'),
            cell(2, 0, 'แจ้งหยุด', 'แผงหยุดวันไหน', 'closed', 'แจ้งหยุด'),
            cell(0, 1, 'ประกาศ', 'ข่าวจากตลาด', 'news', 'ประกาศ'),
            cell(1, 1, 'พอร์ทัล', 'ประวัติ แจ้งซ่อม', 'portal', 'พอร์ทัล'),
            sosCell(2, 1, 'เรียกเจ้าหน้าที่ทันที'),
        ],
    },
    // Not a default: the bot gives it to one person (by its alias) when a walk-in links their request (api/_walkin.ts),
    // and takes it back once they register a stall. Same OA as `market`.
    walkin: {
        name: 'horcare-walkin', alias: 'horcare-walkin', chatBarText: 'เมนูขาจร', token: 'LINE_MARKET_CHANNEL_ACCESS_TOKEN',
        tiles: [
            { ...half(0, 0, 'สถานะการจอง', 'ผลอนุมัติ ล็อกที่ได้', 'status', 'สถานะขาจร'), primary: true },
            half(1, 0, 'แจ้งเข้าขาย', 'จองวันขายครั้งถัดไป', 'calplus', 'แจ้งเข้าขาย'),
            half(0, 1, 'ลงทะเบียนแผง', 'สำหรับผู้ค้าประจำ', 'portal', 'ลงทะเบียน'),
            { ...half(1, 1, 'ช่วยเหลือ', 'เรียกเจ้าหน้าที่ตลาด', 'sos', 'ขอความช่วยเหลือ'), sos: true },
        ],
    },
    pos: {
        name: 'horcare-pos-care', chatBarText: 'POS Care', token: 'LINE_POS_CHANNEL_ACCESS_TOKEN',
        tiles: [
            { x: 0, y: 0, w: W, h: HALF, label: 'เปิด POS Care', sub: 'เดินเก็บแผง · รับค่าห้อง · ขาจร', icon: 'pos', text: 'เปิด POS Care', primary: true },
            cell(0, 1, 'ยอดวันนี้', 'เก็บได้เท่าไร', 'today', 'ยอดวันนี้'),
            cell(1, 1, 'ร้านหยุดวันนี้', 'แผงไหนแจ้งหยุด', 'closed', 'ร้านหยุดวันนี้'),
            cell(2, 1, 'ปิดยอด', 'นับเงินสดสิ้นวัน', 'close', 'ปิดยอด'),
        ],
    },
};

const pngOf = name => join(OUT, `oa-${name}.png`);
const payload = name => {
    const m = MENUS[name];
    return {
        size: { width: W, height: H }, selected: true, name: m.name, chatBarText: m.chatBarText,
        areas: m.tiles.map(t => ({ bounds: { x: t.x, y: t.y, width: t.w, height: t.h }, action: { type: 'message', label: t.label.slice(0, 20), text: t.text } })),
    };
};

function html(name) {
    const tile = t => {
        const row = t.w === W;
        return `<div class="tile${t.primary ? ' primary' : ''}${t.sos ? ' sos' : ''}${row ? ' row' : ''}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px">
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
  .tile svg { width: 230px; height: 230px; fill: none; stroke: #0A6CC2; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .label { font-size: 132px; font-weight: 700; line-height: 1.2; margin-top: 52px; letter-spacing: -0.01em; white-space: nowrap; }
  .sub { font-size: 66px; font-weight: 500; line-height: 1.3; margin-top: 12px; color: #557089; white-space: nowrap; }
  .tile.primary { background: #0A5DAA; border-color: #0A5DAA; color: #FFFFFF; }
  .tile.primary svg { stroke: #FFB36B; }
  .tile.primary .sub { color: #CFE3F7; }
  .tile.sos { background: #C62828; border-color: #C62828; color: #FFFFFF; }
  .tile.sos svg { stroke: #FFFFFF; }
  .tile.sos .sub { color: #FFE0E0; }
  .tile.row { flex-direction: row; gap: 120px; text-align: left; padding: 0 90px; }
  .tile.row svg { width: 400px; height: 400px; stroke-width: 1.5; flex: none; }
  .tile.row .label { font-size: 220px; margin-top: 0; }
  .tile.row .sub { font-size: 92px; margin-top: 22px; }
</style></head><body>
${MENUS[name].tiles.map(tile).join('\n')}
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
    const tmp = mkdtempSync(join(tmpdir(), 'horcare-oa-menu-'));
    try {
        for (const name of Object.keys(MENUS)) {
            const page = join(tmp, `${name}.html`);
            writeFileSync(page, html(name));
            execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${W},${H}`, '--virtual-time-budget=8000', `--screenshot=${pngOf(name)}`, pathToFileURL(page).href], { stdio: 'ignore' });
            console.log(`rendered ${pngOf(name)} (${(statSync(pngOf(name)).size / 1024).toFixed(0)} KB)`);
        }
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

const args = process.argv.slice(2);
if (args.includes('--render')) { render(); process.exit(0); }
const name = args.find(a => !a.startsWith('--'));
if (!name || !MENUS[name]) { console.error(`Which OA? ${Object.keys(MENUS).join(' | ')}`); process.exit(1); }
const TOKEN = process.env[MENUS[name].token];
if (!TOKEN) { console.error(`Set ${MENUS[name].token}.`); process.exit(1); }

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
    if (!existsSync(pngOf(name))) throw new Error(`Missing ${pngOf(name)}; run with --render first.`);
    const image = readFileSync(pngOf(name));
    if (image.length > 1024 * 1024) throw new Error('Image is over LINE\'s 1 MB limit.');
    const info = await line('GET', '/info');
    console.log(`OA: ${info.displayName} (${info.basicId})`);
    await line('POST', '/richmenu/validate', payload(name));
    console.log('menu definition is valid');
    if (args.includes('--dry-run')) process.exit(0);
    const before = ((await line('GET', '/richmenu/list')).richmenus ?? []).filter(m => m.name === MENUS[name].name);
    const { richMenuId } = await line('POST', '/richmenu', payload(name));
    await line('POST', `/richmenu/${richMenuId}/content`, image, 'api-data.line.me');
    const alias = MENUS[name].alias;
    if (alias) {
        // a per-person menu: point its alias at the new one (the bot looks it up by alias); not the OA's default
        const exists = await line('GET', `/richmenu/alias/${alias}`).then(() => true, () => false);
        if (exists) await line('POST', `/richmenu/alias/${alias}`, { richMenuId });
        else await line('POST', '/richmenu/alias', { richMenuAliasId: alias, richMenuId });
        console.log(`alias ${alias} → ${richMenuId} (given to each walk-in by the bot; the default menu is unchanged)`);
        // older copies stay: people already given one keep it (deleting it would drop them to the default menu)
        if (before.length) console.log(`kept ${before.length} older copy(ies) for people already linked`);
    } else {
        await line('POST', `/user/all/richmenu/${richMenuId}`);
        console.log(`default menu is now ${richMenuId}`);
        for (const m of before) { await line('DELETE', `/richmenu/${m.richMenuId}`); console.log(`deleted previous ${m.richMenuId}`); }
    }
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
