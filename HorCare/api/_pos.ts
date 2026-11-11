/**
 * POS Care — the LINE OA "HorCare Staff" for people who take money on site, and the mobile page it opens.
 *
 * Identity is the person's own HorCare account (owner, or a member whose role collects money). They link their LINE
 * once with a code made in the app (HCP-, 15 minutes, single use) → `pos_line/{lineUserId}`. From then on the OA's
 * "เปิด POS Care" button replies with a sign-in link made for that moment: single use, 10 minutes, stored as a hash. The
 * page trades it for a Firebase sign-in as that account, so everything after is the ordinary app with the ordinary
 * permission checks (/api/collections). Access is re-read on every use: a member switched off, or whose role no longer
 * collects money, can neither link nor open the page, and their binding is dropped.
 *
 * /api/pos   link_code | status | unlink   (signed in)
 *            places                         (signed in: the properties this account collects at, with what it may do)
 *            redeem                         (public: a sign-in link from the OA → a Firebase custom token)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { admin, db } from './_firebase.js';
import { authorize } from './_rbac.js';
import { rateLimit, rateLimitBy } from './_abuse-guard.js';
import { writeAudit } from './_audit.js';
import { appBaseUrl } from './_app-url.js';
import { supabase } from './_supabase.js';
import { isRole, permissionsForRole, type Permission } from '../src/shared/permissions.js';
import { POS_LINK_TTL_MS, POS_SESSION_TTL_MS, canClosePosDay, canUsePos, isPosLinkCode, type PosDaySummary } from '../src/shared/posCare.js';
import { buildRound, dayTotals, resolveRate, type Charge, type ChargePayment, type Rate, type StallPlan } from '../src/shared/collections.js';
import { addDays, closuresOn, todayTh, type MarketClosure, type ShopClosure } from '../src/shared/market.js';
import type { BankAccount } from '../src/shared/banks.js';

/** Same rule as the app (src/utils/workspaceTerminology.ts collectionStyleOf): the saved choice, else the building type's default. */
function styleOf(cfg: { collection_style?: string; building_type?: string } | undefined): 'monthly' | 'nightly' | 'stall' {
    const s = cfg?.collection_style;
    if (s === 'monthly' || s === 'nightly' || s === 'stall') return s;
    return cfg?.building_type === 'resort' || cfg?.building_type === 'hotel' ? 'nightly' : cfg?.building_type === 'market' ? 'stall' : 'monthly';
}

export const config = { maxDuration: 30 };

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface PosBinding { account_uid: string; owner_uid: string; name: string; linked_at: string }

export interface PosPlace {
    owner_uid: string;
    building_id: string;
    name: string;
    style: 'monthly' | 'nightly' | 'stall';
    building_type: string | null;
    can_close: boolean;
}

/** The properties an account may collect at for one owner. Empty = none (anymore). */
export async function posPlaces(accountUid: string, ownerUid: string): Promise<PosPlace[]> {
    const owner = (await db.doc(`users/${ownerUid}`).get()).data();
    if (owner?.status === 'banned') return [];
    let perms: readonly Permission[] | null = null;
    let allowed: string[] | '*' = '*';
    if (accountUid !== ownerUid) {
        const m = (await db.doc(`users/${ownerUid}/members/${accountUid}`).get()).data() as { status?: string; role?: string; property_ids?: string[] } | undefined;
        if (!m || m.status !== 'active' || !isRole(m.role)) return [];
        perms = permissionsForRole(m.role);   // recomputed from the role, never trusted from the stored copy
        if (!canUsePos(perms)) return [];
        allowed = (m.property_ids ?? []).includes('*') ? '*' : (m.property_ids ?? []);
    }
    const buildings = await db.collection(`users/${ownerUid}/buildings`).get();
    const out: PosPlace[] = [];
    for (const b of buildings.docs) {
        if (allowed !== '*' && !allowed.includes(b.id)) continue;
        const cfg = (await db.doc(`users/${ownerUid}/buildings/${b.id}/data/config`).get()).data() as { collection_style?: string; building_type?: string; bill_customization?: { dorm_name?: string } } | undefined;
        out.push({
            owner_uid: ownerUid, building_id: b.id,
            name: cfg?.bill_customization?.dorm_name || (b.data() as { name?: string }).name || 'ที่พัก',
            style: styleOf(cfg), building_type: cfg?.building_type ?? null, can_close: canClosePosDay(perms),
        });
    }
    return out;
}

/** The binding of a LINE account, if it still gives access somewhere. A binding that no longer does is forgotten. */
export async function posBindingOf(lineUserId: string): Promise<{ binding: PosBinding; places: PosPlace[] } | null> {
    const ref = db.doc(`pos_line/${lineUserId}`);
    const binding = (await ref.get()).data() as PosBinding | undefined;
    if (!binding) return null;
    const places = await posPlaces(binding.account_uid, binding.owner_uid);
    if (places.length === 0) { await ref.delete(); return null; }
    return { binding, places };
}

/** A LINE user sends their HCP- code. Returns the reply text. */
export async function redeemPosLink(lineUserId: string, rawCode: string): Promise<{ ok: boolean; text: string }> {
    if (!isPosLinkCode(rawCode)) return { ok: false, text: '❌ ไม่พบรหัสนี้ กรุณาสร้างรหัสใหม่ในแอป HorCare' };
    if (!(await rateLimitBy(`line:${lineUserId}`, 'poslink-code', 10, 3600)).ok) return { ok: false, text: '⚠️ ลองรหัสบ่อยเกินไป กรุณารอ 1 ชั่วโมงแล้วลองใหม่' };
    const codeRef = db.doc(`pos_link_codes/${sha256(rawCode.trim().toUpperCase())}`);
    const code = (await codeRef.get()).data() as { account_uid: string; owner_uid: string; name: string; expires_at: number; used?: boolean } | undefined;
    if (!code) return { ok: false, text: '❌ ไม่พบรหัสนี้ กรุณาสร้างรหัสใหม่ในแอป HorCare' };
    if (code.used) return { ok: false, text: '⚠️ รหัสนี้ถูกใช้ไปแล้ว กรุณาสร้างรหัสใหม่ในแอป' };
    if (code.expires_at <= Date.now()) return { ok: false, text: '⌛ รหัสหมดอายุแล้ว (ใช้ได้ 15 นาที) กรุณาสร้างรหัสใหม่ในแอป' };
    const places = await posPlaces(code.account_uid, code.owner_uid);
    if (places.length === 0) return { ok: false, text: '⚠️ บัญชีนี้ไม่มีสิทธิ์เก็บเงิน กรุณาติดต่อเจ้าของหรือผู้จัดการ' };
    await codeRef.update({ used: true, used_by_line_user: lineUserId });
    const binding: PosBinding = { account_uid: code.account_uid, owner_uid: code.owner_uid, name: code.name, linked_at: new Date().toISOString() };
    await db.doc(`pos_line/${lineUserId}`).set(binding);
    await writeAudit({
        ownerUid: code.owner_uid, propertyId: null, userId: code.account_uid, userName: code.name,
        role: code.account_uid === code.owner_uid ? 'owner' : 'staff', action: 'UPDATE', resourceType: 'line_link', resourceId: lineUserId,
        resourceLabel: 'POS Care LINE', note: 'POS Care linked',
    });
    return { ok: true, text: `✅ เชื่อม LINE กับ POS Care แล้ว\nสวัสดีคุณ ${code.name} · ${places.map(p => p.name).join(', ')}\n\nกด "เปิด POS Care" ในเมนูด้านล่างเพื่อเริ่มเก็บเงินได้เลย` };
}

/** A sign-in link for a linked LINE account: single use, 10 minutes. `go` opens a part of the page (e.g. the day close). */
export async function issuePosSession(binding: PosBinding, go?: 'close'): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await db.doc(`pos_sessions/${sha256(token)}`).set({
        account_uid: binding.account_uid, owner_uid: binding.owner_uid, created_at: new Date().toISOString(), expires_at: Date.now() + POS_SESSION_TTL_MS,
    });
    return `${appBaseUrl()}/?pos=${token}${go ? `&go=${go}` : ''}`;
}

/** Today at each place: what came in, what is still due on the round, who closed. Best effort: a place that fails is skipped. */
export async function posDaySummaries(places: PosPlace[], today = todayTh()): Promise<PosDaySummary[]> {
    const out: PosDaySummary[] = [];
    let sb: ReturnType<typeof supabase> | null = null;
    try { sb = supabase(); } catch { sb = null; }
    for (const p of places) {
        const base = `users/${p.owner_uid}/buildings/${p.building_id}`;
        const shop = (await db.collection(`${base}/shop_closures`).get()).docs.map(d => d.data() as ShopClosure);
        const closedToday = closuresOn(shop, today);
        const summary: PosDaySummary = { name: p.name, style: p.style, cash_satang: 0, transfer_satang: 0, payments: 0, due_stalls: 0, due_satang: 0, closed_today: closedToday.length, day_closed: false };
        if (sb) {
            try {
                const mine = (t: string) => sb!.from(t).select('*').eq('owner_uid', p.owner_uid).eq('building_id', p.building_id);
                const [pays, closes] = await Promise.all([
                    mine('charge_payments').gte('received_at', `${addDays(today, -1)}T00:00:00Z`).lte('received_at', `${addDays(today, 1)}T23:59:59Z`).limit(20000),
                    mine('day_closes').eq('close_date', today).limit(1),
                ]);
                if (!pays.error) {
                    const t = dayTotals((pays.data ?? []) as ChargePayment[], today);
                    summary.cash_satang = t.cash_satang; summary.transfer_satang = t.transfer_satang; summary.payments = t.count;
                }
                summary.day_closed = !closes.error && (closes.data ?? []).length > 0;
                if (p.style === 'stall') {
                    const [plans, charges, att, rates] = await Promise.all([
                        mine('stall_plans').eq('status', 'active').limit(5000),
                        mine('charges').gte('period_end', addDays(today, -7)).lte('period_start', today).limit(20000),
                        mine('stall_attendance').eq('visit_date', today).limit(5000),
                        mine('collection_rates').limit(1000),
                    ]);
                    if (!plans.error && !charges.error) {
                        const rooms = (await db.collection(`${base}/rooms`).get()).docs
                            .filter(d => (d.data() as { is_active?: boolean }).is_active !== false)
                            .map(d => ({ id: d.id, room_number: String((d.data() as { room_number?: string }).room_number ?? d.id), zone: (d.data() as { zone?: string }).zone ?? null }));
                        const zone = new Map(rooms.map(r => [r.id, r.zone]));
                        const rateList = (rates.data ?? []) as Rate[];
                        const rows = buildRound({
                            date: today, plans: (plans.data ?? []) as StallPlan[], charges: (charges.data ?? []) as Charge[],
                            closedToday: new Set(closedToday.map(c => c.room_id)),
                            absentToday: new Set(((att.data ?? []) as { room_id: string; present: boolean }[]).filter(a => !a.present).map(a => a.room_id)),
                            rooms,
                            dayRateOf: id => resolveRate(rateList, { purpose: 'stall', unit: 'day', roomId: id, zone: zone.get(id), date: today })?.amount_satang ?? null,
                            weekRateOf: id => resolveRate(rateList, { purpose: 'stall', unit: 'week', roomId: id, zone: zone.get(id), date: today })?.amount_satang ?? null,
                        });
                        const due = rows.filter(r => r.status === 'due' || r.status === 'partial');
                        summary.due_stalls = due.length;
                        summary.due_satang = due.reduce((t, r) => t + r.expected_satang, 0);
                    }
                }
            } catch (err) {
                console.warn('[pos] day summary failed:', (err as Error).message);
            }
        }
        out.push(summary);
    }
    return out;
}

/** "ร้านหยุดวันนี้": stalls that said they are closed today, and zones where the market itself is shut. */
export async function posClosedToday(places: PosPlace[], today = todayTh()): Promise<string> {
    const parts: string[] = [];
    for (const p of places) {
        const base = `users/${p.owner_uid}/buildings/${p.building_id}`;
        const [shop, market] = await Promise.all([db.collection(`${base}/shop_closures`).get(), db.collection(`${base}/market_closures`).get()]);
        const stalls = closuresOn(shop.docs.map(d => d.data() as ShopClosure), today);
        const shut = market.docs.map(d => d.data() as MarketClosure).filter(c => c.status === 'active' && c.from_date <= today && today <= c.to_date);
        const lines = [`🏪 ${p.name}`];
        for (const m of shut) lines.push(`⛔ ตลาดหยุด${m.zones ? ` (${m.zones.join(', ')})` : ' ทั้งตลาด'}${m.note ? ` — ${m.note}` : ''}`);
        lines.push(stalls.length > 0 ? `แจ้งหยุด ${stalls.length} แผง: ${stalls.slice(0, 40).map(c => c.room_number).join(', ')}` : 'วันนี้ไม่มีแผงแจ้งหยุด');
        parts.push(lines.join('\n'));
    }
    return parts.slice(0, 5).join('\n\n') || 'ไม่มีข้อมูล';
}

// ── /api/pos ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as { action?: string; owner_uid?: unknown; token?: unknown };

    if (body.action === 'redeem') {
        const limited = await rateLimit(req, 'pos:redeem', 60, 3600);
        if (!limited.ok) { res.status(429).json({ error: 'too_many_requests' }); return; }
        if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(body.token)) { res.status(401).json({ error: 'invalid_link' }); return; }
        const ref = db.doc(`pos_sessions/${sha256(body.token)}`);
        // single use, even when two taps race: the session is consumed inside a transaction
        const s = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            const d = snap.data() as { account_uid: string; owner_uid: string; expires_at: number; used?: boolean } | undefined;
            if (!d || d.used || d.expires_at <= Date.now()) return null;
            tx.update(ref, { used: true, used_at: new Date().toISOString() });
            return d;
        });
        if (!s) { res.status(401).json({ error: 'invalid_link' }); return; }
        const places = await posPlaces(s.account_uid, s.owner_uid);
        if (places.length === 0) { res.status(403).json({ error: 'no_access' }); return; }
        const token = await admin.auth().createCustomToken(s.account_uid);
        res.status(200).json({ token, owner_uid: s.owner_uid });
        return;
    }

    // everything else is about the signed-in account itself
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, permission: 'room.read' });
    if (!ctx) return;
    const owner = ctx.ownerUid;

    if (body.action === 'places') {
        const places = await posPlaces(ctx.uid, owner);
        if (places.length === 0) { res.status(403).json({ error: 'no_access' }); return; }
        // the accounts money is received into, for the transfer QR (a collector may not read the bank settings themselves)
        const accounts: Record<string, BankAccount[]> = {};
        for (const p of places) {
            accounts[p.building_id] = (await db.collection(`users/${owner}/buildings/${p.building_id}/bank_accounts`).get()).docs
                .map(d => d.data() as BankAccount).filter(a => a.status === 'active');
        }
        res.status(200).json({ places, accounts, name: ctx.displayName });
        return;
    }

    if (body.action === 'link_code') {
        if ((await posPlaces(ctx.uid, owner)).length === 0) { res.status(403).json({ error: 'forbidden' }); return; }
        let code = 'HCP-';
        for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
        const expires = Date.now() + POS_LINK_TTL_MS;
        await db.doc(`pos_link_codes/${sha256(code)}`).set({ account_uid: ctx.uid, owner_uid: owner, name: ctx.displayName || ctx.email || 'ทีมงาน', expires_at: expires, created_at: new Date().toISOString() });
        res.status(200).json({ code, expires_at: expires, oa_id: process.env.VITE_LINE_POS_OA_ID ?? null });
        return;
    }

    const mine = db.collection('pos_line').where('account_uid', '==', ctx.uid);
    if (body.action === 'status') {
        const snap = await mine.get();
        res.status(200).json({ linked: snap.docs.some(d => (d.data() as PosBinding).owner_uid === owner), can_use: (await posPlaces(ctx.uid, owner)).length > 0 });
        return;
    }
    if (body.action === 'unlink') {
        const snap = await mine.get();
        await Promise.all(snap.docs.filter(d => (d.data() as PosBinding).owner_uid === owner).map(d => d.ref.delete()));
        res.status(200).json({ ok: true });
        return;
    }
    res.status(400).json({ error: 'unknown_action' });
}
