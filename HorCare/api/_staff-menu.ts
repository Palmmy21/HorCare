/**
 * Which rich menu a person sees in the team LINE OA.
 *
 * The OA's default menu is "register" (everyone, until they are linked). Once a LINE account is linked — a technician,
 * a housekeeper, or an admin's HorCare account — the server links that person to the menu for their job, and takes it
 * away again the moment they are no longer linked. The menus themselves are created by scripts/setup-staff-rich-menu.mjs;
 * the server finds them by name, so reinstalling them needs no configuration change.
 *
 * Always best effort: a menu that cannot be switched never fails a registration or a reply.
 */
import { db } from './_firebase.js';
import { staffLineToken } from './_line.js';
import { linkedStaff, type LinkedStaff } from './_staff-portal.js';
import { isLineAdmin } from './_owner-line.js';
import { STAFF_MENUS, menuFor, staffMenuName, type StaffMenu } from '../src/shared/staffBot.js';

const LINE_API = 'https://api.line.me/v2/bot';
const IDS_TTL_MS = 5 * 60_000;
let idsCache: { at: number; ids: Partial<Record<StaffMenu, string>> } | null = null;

/** For tests: forget the menu ids read from LINE. */
export const resetStaffMenuCache = () => { idsCache = null; };

async function menuIds(token: string): Promise<Partial<Record<StaffMenu, string>>> {
    if (idsCache && Date.now() - idsCache.at < IDS_TTL_MS) return idsCache.ids;
    const res = await fetch(`${LINE_API}/richmenu/list`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return {};
    const { richmenus = [] } = (await res.json()) as { richmenus?: { richMenuId: string; name: string }[] };
    const ids: Partial<Record<StaffMenu, string>> = {};
    for (const menu of STAFF_MENUS) {
        const found = richmenus.find(m => m.name === staffMenuName(menu));
        if (found) ids[menu] = found.richMenuId;
    }
    idsCache = { at: Date.now(), ids };
    return ids;
}

export interface LineIdentity { staff: LinkedStaff[]; admin: boolean; menu: StaffMenu }

/** Who a LINE account is in the team OA, re-read every time: unlinking or deactivating someone takes effect at once. */
export async function staffIdentity(lineUserId: string): Promise<LineIdentity> {
    const [staff, admin] = await Promise.all([linkedStaff(lineUserId), isLineAdmin(lineUserId)]);
    return { staff, admin, menu: menuFor({ admin, roles: staff.map(s => s.staff.role) }) };
}

/** Put the person on the rich menu they should have now. Returns the menu, or null when nothing could be done. */
export async function syncStaffMenu(lineUserId: string | null | undefined, known?: LineIdentity): Promise<StaffMenu | null> {
    try {
        const token = staffLineToken();
        if (!token || !lineUserId) return null;
        const want = (known ?? await staffIdentity(lineUserId)).menu;
        const ref = db.doc(`staff_line_menus/${lineUserId}`);
        const prev = (await ref.get()).data() as { menu?: StaffMenu; id?: string } | undefined;
        if (!prev && want === 'register') return want;            // already on the default menu

        const headers = { Authorization: `Bearer ${token}` };
        if (want === 'register') {
            const res = await fetch(`${LINE_API}/user/${lineUserId}/richmenu`, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000) });
            if (!res.ok) return null;
            await ref.delete();
            return want;
        }
        const id = (await menuIds(token))[want];
        if (!id) return null;                                     // menus not installed on this OA yet
        if (prev?.id === id) return want;
        const res = await fetch(`${LINE_API}/user/${lineUserId}/richmenu/${id}`, { method: 'POST', headers, signal: AbortSignal.timeout(5000) });
        if (!res.ok) return null;
        await ref.set({ menu: want, id, at: new Date().toISOString() });
        return want;
    } catch (err) {
        console.error('[staff-menu] sync failed:', (err as Error).message);
        return null;
    }
}
