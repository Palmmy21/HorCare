/**
 * setup-staff-rich-menu.mjs
 *
 * Rich menu for the STAFF LINE Official Account (technicians, housekeepers, owners):
 * the one behind /api/line-staff-webhook, not the tenants' OA.
 *
 *   ┌───────────────────────────┬─────────────┐
 *   │ งานของฉัน                  │ ช่วยเหลือ     │
 *   ├─────────────┬─────────────┼─────────────┤
 *   │ #ยอด        │ #ค้าง        │ #ห้องว่าง     │
 *   └─────────────┴─────────────┴─────────────┘
 *
 * Every button sends a text the webhook already understands, so nothing changes on the server.
 *
 * Usage (Node 18+):
 *   node scripts/setup-staff-rich-menu.mjs --render      redraw rich-menu/staff-menu.png from staff-menu.html (needs Chrome or Edge)
 *   LINE_STAFF_CHANNEL_ACCESS_TOKEN=… node scripts/setup-staff-rich-menu.mjs --dry-run    ask LINE to validate, change nothing
 *   LINE_STAFF_CHANNEL_ACCESS_TOKEN=… node scripts/setup-staff-rich-menu.mjs              create it and make it the default menu
 *   … --delete-old                                        also delete the menu that was the default before
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = join(HERE, 'rich-menu', 'staff-menu.html');
const PNG = join(HERE, 'rich-menu', 'staff-menu.png');
const W = 2500, H = 1686, ROW = H / 2;

const message = (label, text) => ({ type: 'message', label, text });
const AREAS = [
    { bounds: { x: 0, y: 0, width: 1667, height: ROW }, action: message('งานของฉัน', 'งานของฉัน') },
    // any text the bot does not know answers with the registration help, or where the person's request stands
    { bounds: { x: 1667, y: 0, width: 833, height: ROW }, action: message('ช่วยเหลือ', 'ช่วยเหลือ') },
    { bounds: { x: 0, y: ROW, width: 833, height: ROW }, action: message('ยอดเดือนนี้', '#ยอด') },
    { bounds: { x: 833, y: ROW, width: 834, height: ROW }, action: message('ค้างชำระ', '#ค้าง') },
    { bounds: { x: 1667, y: ROW, width: 833, height: ROW }, action: message('ห้องว่าง', '#ห้องว่าง') },
];
const MENU = { size: { width: W, height: H }, selected: true, name: 'HorCare staff menu', chatBarText: 'เมนู', areas: AREAS };

const args = new Set(process.argv.slice(2));

function render() {
    const browser = [
        process.env.CHROME_PATH,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome', '/usr/bin/chromium',
    ].find(p => p && existsSync(p));
    if (!browser) throw new Error('Chrome or Edge not found; set CHROME_PATH');
    execFileSync(browser, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
        `--window-size=${W},${H}`, '--virtual-time-budget=8000', `--screenshot=${PNG}`, pathToFileURL(HTML).href,
    ], { stdio: 'ignore' });
    console.log(`rendered ${PNG} (${(statSync(PNG).size / 1024).toFixed(0)} KB)`);
}

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

if (args.has('--render')) { render(); process.exit(0); }

const TOKEN = process.env.LINE_STAFF_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) { console.error('Set LINE_STAFF_CHANNEL_ACCESS_TOKEN (the staff OA, not the tenants\' one).'); process.exit(1); }
if (!existsSync(PNG)) { console.error(`Missing ${PNG}; run with --render first.`); process.exit(1); }
const image = readFileSync(PNG);
if (image.length > 1024 * 1024) { console.error('Image is over LINE\'s 1 MB limit.'); process.exit(1); }

try {
    const info = await line('GET', '/info');
    console.log(`OA: ${info.displayName} (${info.basicId})`);

    await line('POST', '/richmenu/validate', MENU);
    console.log('menu definition is valid');
    if (args.has('--dry-run')) process.exit(0);

    const previous = await line('GET', '/user/all/richmenu').then(r => r.richMenuId ?? null).catch(() => null);
    const { richMenuId } = await line('POST', '/richmenu', MENU);
    await line('POST', `/richmenu/${richMenuId}/content`, image, 'api-data.line.me');
    await line('POST', `/user/all/richmenu/${richMenuId}`);
    console.log(`default menu is now ${richMenuId}`);

    if (previous && previous !== richMenuId) {
        if (args.has('--delete-old')) { await line('DELETE', `/richmenu/${previous}`); console.log(`deleted previous menu ${previous}`); }
        else console.log(`previous default ${previous} kept (to go back: POST /user/all/richmenu/${previous}; --delete-old removes it)`);
    }
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
