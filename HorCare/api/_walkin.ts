/**
 * Walk-in vendors (ขาจร) and LINE.
 *
 *  • The market's scan link: `/?walkin=<token>`, made for that market (walkin_links/{token}); the owner can replace it,
 *    and the old one stops working. It names no account or property id.
 *  • Each request gets its own one-off code (HCW-XXXXXXXX, walkin_codes/{code}). The page that confirms the request
 *    opens the market's LINE OA with that code ready to send; sending it links that LINE account to the request.
 *  • A linked walk-in (line_walkins/{lineUserId}) talks to that market: their messages land in the market's LINE
 *    inbox, "ขอความช่วยเหลือ" alerts its staff, they get the walk-in rich menu (they are not a registered vendor),
 *    and the market's decision — with the lot it gave — is sent to them in the same chat.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { db } from './_firebase.js';
import { appBaseUrl } from './_app-url.js';
import { currentLineChannel, linePush, linkRichMenuAlias, resolveLineToken, roomLineChannel, unlinkRichMenu, type LineChannel } from './_line.js';
import { propertyOaId } from './_line-oa.js';
import {
    WALKIN_LOT_NOTE, WALKIN_STATUS_LABELS_TH, isWalkInCode, lotLabel, todayTh, type WalkIn, type WalkInLot,
} from '../src/shared/market.js';

/** The rich menu alias a linked walk-in is given (scripts/setup-oa-rich-menus.mjs walkin). */
export const WALKIN_MENU_ALIAS = 'horcare-walkin';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export interface WalkInLineLink {
    owner_uid: string;
    building_id: string;
    walkin_id: string;
    name: string;
    phone: string;
    channel: LineChannel;
    linked_at: string;
    /** They were given the walk-in menu (taken away again once they register a stall). */
    menu?: boolean;
}

const baseOf = (owner: string, building: string) => `users/${owner}/buildings/${building}`;

export async function marketName(owner: string, building: string): Promise<string> {
    const [cfg, b] = await Promise.all([db.doc(`${baseOf(owner, building)}/data/config`).get(), db.doc(baseOf(owner, building)).get()]);
    return (cfg.data()?.bill_customization?.dorm_name as string | undefined) || (b.data()?.name as string | undefined) || 'ตลาด';
}

// ── the market's scan link ───────────────────────────────────────────────────

const linkKey = (token: string) => createHash('sha256').update(token).digest('hex');

/** The market a scan link belongs to, or null (unknown, replaced). */
export async function resolveWalkInLink(token: unknown): Promise<{ owner_uid: string; building_id: string } | null> {
    if (typeof token !== 'string' || !LINK_TOKEN_RE.test(token)) return null;
    const d = (await db.doc(`walkin_links/${linkKey(token)}`).get()).data();
    if (!d || d.revoked === true) return null;
    return { owner_uid: String(d.owner_uid), building_id: String(d.building_id) };
}

/**
 * The market's current scan link token, made on first use; `rotate` replaces it (the old link stops working).
 * Both live in server-only collections (the rules deny clients); the index is keyed by the token's hash.
 */
export async function walkInLinkToken(owner: string, building: string, opts: { rotate?: boolean } = {}): Promise<string> {
    const cfgRef = db.doc(`walkin_link_of/${owner}__${building}`);
    const cur = (await cfgRef.get()).data()?.token as string | undefined;
    // the current link, unless asked for a new one — or its index entry is gone, which would make it a dead QR
    if (cur && !opts.rotate && (await db.doc(`walkin_links/${linkKey(cur)}`).get()).data()?.revoked === false) return cur;
    const token = randomBytes(18).toString('base64url');
    await db.doc(`walkin_links/${linkKey(token)}`).set({ owner_uid: owner, building_id: building, revoked: false, created_at: new Date().toISOString() });
    if (cur) await db.doc(`walkin_links/${linkKey(cur)}`).set({ revoked: true, revoked_at: new Date().toISOString() }, { merge: true });
    await cfgRef.set({ token, updated_at: new Date().toISOString() });
    return token;
}

/** `?walkin=<token>` (`?w=` is a staff job page); links printed before as ?walkin=1&uid=&bid= still open the form. */
export const walkInPageUrl = (token: string) => `${appBaseUrl()}/?walkin=${encodeURIComponent(token)}`;

// ── lots ─────────────────────────────────────────────────────────────────────

/** Stalls a walk-in may ask for: active ones, by zone and number. Numbers and zones only. */
export async function walkInLots(owner: string, building: string): Promise<WalkInLot[]> {
    const rooms = (await db.collection(`${baseOf(owner, building)}/rooms`).get()).docs;
    return rooms
        .map(d => ({ id: d.id, ...(d.data() as { room_number?: unknown; zone?: unknown; is_active?: unknown }) }))
        .filter(r => r.is_active !== false && r.room_number !== undefined && r.room_number !== null && String(r.room_number).trim() !== '')
        .map(r => ({ room_id: r.id, room_number: String(r.room_number), zone: typeof r.zone === 'string' && r.zone.trim() ? r.zone.trim() : null }))
        .sort((a, b) => (a.zone ?? '').localeCompare(b.zone ?? '', 'th') || a.room_number.localeCompare(b.room_number, 'th', { numeric: true }))
        .slice(0, 2000);
}

/** One stall of this market as a lot, or null when it is not one (unknown, inactive). */
export async function lotOf(owner: string, building: string, roomId: string): Promise<WalkInLot | null> {
    const d = await db.doc(`${baseOf(owner, building)}/rooms/${roomId}`).get();
    const r = d.data() as { room_number?: unknown; zone?: unknown; is_active?: unknown } | undefined;
    if (!r || r.is_active === false || r.room_number === undefined || r.room_number === null) return null;
    return { room_id: d.id, room_number: String(r.room_number), zone: typeof r.zone === 'string' && r.zone.trim() ? r.zone.trim() : null };
}

// ── the request's own LINE code ─────────────────────────────────────────────

export function newWalkInCode(): string {
    let c = 'HCW-';
    for (let i = 0; i < 8; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return c;
}

/** Store a request's code; it works until the day after the selling day. */
export async function saveWalkInCode(code: string, owner: string, building: string, w: Pick<WalkIn, 'id' | 'date'>): Promise<void> {
    await db.doc(`walkin_codes/${code}`).set({ owner_uid: owner, building_id: building, walkin_id: w.id, until: w.date, created_at: new Date().toISOString() });
}

/** The link that opens the market's OA with the request's code ready to send (null when the market has no OA set up). */
export async function walkInLineUrl(owner: string, building: string, code: string): Promise<{ url: string; oa_id: string } | null> {
    const oa = await propertyOaId(owner, building);
    if (!oa) return null;
    return { url: `https://line.me/R/oaMessage/${encodeURIComponent(oa)}/?${encodeURIComponent(code)}`, oa_id: oa };
}

const dayText = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' });

/** What a walk-in is told about one request: the day, the lot, where it stands. */
export function walkInSummary(w: WalkIn, market: string): string {
    const lot = w.status === 'approved' && w.lot ? `ล็อกที่ได้: ${lotLabel(w.lot)}` : `ล็อกที่ต้องการ: ${lotLabel(w.preferred_lot)}`;
    return `🧺 ${market}\nวันที่ขาย: ${dayText(w.date)}\n${lot}\nสถานะ: ${WALKIN_STATUS_LABELS_TH[w.status]}`;
}

const say = (text: string, quick: string[] = []) => ({
    type: 'text', text: text.slice(0, 4900),
    ...(quick.length ? { quickReply: { items: quick.map(label => ({ type: 'action', action: { type: 'message', label: label.slice(0, 20), text: label } })) } } : {}),
});
export const WALKIN_QUICK = ['สถานะขาจร', 'แจ้งเข้าขาย', 'ขอความช่วยเหลือ'];

/**
 * A walk-in sent their request's code: link this LINE account to it (and to the market's chat), give them the walk-in
 * menu unless they are already a registered vendor here, and tell them where things stand — the lot note included.
 */
export async function bindWalkInCode(lineUserId: string, rawCode: string, opts: { registered: boolean }): Promise<object[]> {
    const code = rawCode.trim().toUpperCase();
    if (!isWalkInCode(code)) return [say('รหัสนี้ไม่ถูกต้องค่ะ กรุณากดลิงก์จากหน้าแจ้งเข้าขายอีกครั้ง')];
    const entry = (await db.doc(`walkin_codes/${code}`).get()).data() as { owner_uid?: string; building_id?: string; walkin_id?: string; until?: string } | undefined;
    if (!entry?.owner_uid || !entry.building_id || !entry.walkin_id) return [say('ไม่พบคำขอนี้ค่ะ รหัสอาจหมดอายุแล้ว กรุณาแจ้งเข้าขายใหม่จากลิงก์ของตลาด')];
    if (entry.until && entry.until < todayTh()) return [say('คำขอนี้เลยวันขายแล้วค่ะ หากต้องการเข้าขายอีก กดเมนู "แจ้งเข้าขาย" ได้เลย', WALKIN_QUICK)];
    const ref = db.doc(`${baseOf(entry.owner_uid, entry.building_id)}/walk_ins/${entry.walkin_id}`);
    const snap = await ref.get();
    if (!snap.exists) return [say('ไม่พบคำขอนี้ค่ะ กรุณาแจ้งเข้าขายใหม่จากลิงก์ของตลาด')];
    const w = snap.data() as WalkIn;
    // a code is for one person: once linked, nobody else can take the request over
    if (w.line_user_id && w.line_user_id !== lineUserId) return [say('คำขอนี้เชื่อมกับ LINE บัญชีอื่นแล้วค่ะ หากเป็นของคุณ กรุณาติดต่อเจ้าหน้าที่ตลาด')];

    const channel = currentLineChannel();
    const now = new Date().toISOString();
    await ref.update({ line_user_id: lineUserId, line_channel: channel });
    const menu = !opts.registered && await linkRichMenuAlias(lineUserId, WALKIN_MENU_ALIAS);
    const link: WalkInLineLink = {
        owner_uid: entry.owner_uid, building_id: entry.building_id, walkin_id: w.id, name: w.name, phone: w.phone, channel, linked_at: now,
        ...(menu ? { menu: true } : {}),
    };
    await db.doc(`line_walkins/${lineUserId}`).set(link);
    const market = await marketName(entry.owner_uid, entry.building_id);
    return [
        say(`✅ เชื่อม LINE กับคำขอเข้าขายเรียบร้อยค่ะ\n\n${walkInSummary({ ...w, line_user_id: lineUserId }, market)}`),
        say(`📌 หมายเหตุ\n${WALKIN_LOT_NOTE}\n\nผลการพิจารณาจะแจ้งในแชทนี้ มีคำถามพิมพ์มาได้เลย เจ้าหน้าที่${market}จะตอบในแชทนี้ค่ะ`, WALKIN_QUICK),
    ];
}

/** The walk-in link of this LINE account on the OA this request runs in, or null. */
export async function walkInLinkOf(lineUserId: string): Promise<WalkInLineLink | null> {
    const d = (await db.doc(`line_walkins/${lineUserId}`).get()).data() as WalkInLineLink | undefined;
    return d && d.channel === currentLineChannel() ? d : null;
}

/** "สถานะขาจร": this person's upcoming requests at the market they are linked to. */
export async function walkInStatusReply(lineUserId: string): Promise<object[]> {
    const link = await walkInLinkOf(lineUserId);
    if (!link) return [say('ยังไม่มีคำขอเข้าขายที่เชื่อมกับ LINE นี้ค่ะ\n\nสแกน QR ขาจรที่ตลาด แจ้งวันที่ต้องการขาย แล้วกดปุ่มเชื่อม LINE ในหน้ายืนยันได้เลย')];
    const today = todayTh();
    const mine = (await db.collection(`${baseOf(link.owner_uid, link.building_id)}/walk_ins`).where('line_user_id', '==', lineUserId).get()).docs
        .map(d => d.data() as WalkIn).filter(w => w.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
    const market = await marketName(link.owner_uid, link.building_id);
    if (mine.length === 0) return [say(`ไม่มีคำขอเข้าขายที่กำลังจะถึงค่ะ\n\nกด "แจ้งเข้าขาย" เพื่อแจ้งวันขายครั้งถัดไปที่${market}`, WALKIN_QUICK)];
    return [say(mine.map(w => walkInSummary(w, market)).join('\n\n') + (mine.some(w => w.status !== 'approved' || !w.lot) ? `\n\n📌 ${WALKIN_LOT_NOTE}` : ''), WALKIN_QUICK)];
}

/** "แจ้งเข้าขาย": the market's walk-in page, to ask for another day. */
export async function walkInNewReply(lineUserId: string): Promise<object[]> {
    const link = await walkInLinkOf(lineUserId);
    if (!link) return [say('สแกน QR ขาจรที่ตลาดเพื่อแจ้งเข้าขายได้เลยค่ะ หรือขอลิงก์จากเจ้าหน้าที่ตลาด')];
    const url = walkInPageUrl(await walkInLinkToken(link.owner_uid, link.building_id));
    const market = await marketName(link.owner_uid, link.building_id);
    return [{
        type: 'template', altText: `แจ้งเข้าขาย ${market}`,
        template: { type: 'buttons', text: `🧺 แจ้งเข้าขายที่${market}\nเลือกวันและล็อกที่ต้องการได้ล่วงหน้า`.slice(0, 160), actions: [{ type: 'uri', label: 'แจ้งเข้าขาย', uri: url }] },
    }];
}

/** A registered vendor no longer needs the walk-in menu: back to the OA's default (once). Best effort. */
export async function dropWalkInMenuIfRegistered(lineUserId: string, registered: () => Promise<boolean>): Promise<void> {
    const ref = db.doc(`line_walkins/${lineUserId}`);
    const d = (await ref.get()).data() as WalkInLineLink | undefined;
    if (!d?.menu || d.channel !== currentLineChannel() || !(await registered())) return;
    if (await unlinkRichMenu(lineUserId)) await ref.update({ menu: false });
}

/** Tell the walk-in the market's decision, through the OA they linked. Returns whether it was sent. */
export async function notifyWalkInDecision(owner: string, building: string, w: WalkIn): Promise<boolean> {
    if (!w.line_user_id || (w.status !== 'approved' && w.status !== 'rejected')) return false;
    const token = await resolveLineToken(roomLineChannel({ line_channel: w.line_channel }));
    if (!token) return false;
    const market = await marketName(owner, building);
    const text = w.status === 'approved'
        ? `✅ ${market} อนุมัติให้เข้าขายแล้วค่ะ\n\n${walkInSummary(w, market)}${w.preferred_lot && w.lot && w.preferred_lot.room_id !== w.lot.room_id ? `\n\nขออภัยค่ะ ${lotLabel(w.preferred_lot)} ที่เลือกไว้ไม่ว่าง ตลาดจึงจัด${lotLabel(w.lot)}ให้แทน` : ''}${w.lot ? '' : '\n\nตลาดจะแจ้งล็อกให้ทราบเมื่อมาถึง'}\n\nกรุณามาถึงก่อนเวลาเปิดตลาด และติดต่อเจ้าหน้าที่ที่จุดเก็บเงินค่ะ`
        : `❌ ขออภัยค่ะ ${market} ไม่สามารถรับเข้าขายในวันที่ ${dayText(w.date)} ได้\n\nเลือกวันอื่นได้โดยกด "แจ้งเข้าขาย" หรือพิมพ์สอบถามในแชทนี้ได้เลยค่ะ`;
    try {
        await linePush(w.line_user_id, [say(text, WALKIN_QUICK)], token);
        return true;
    } catch (err) {
        console.error('[walkin] decision push failed:', (err as Error).message);
        return false;
    }
}
