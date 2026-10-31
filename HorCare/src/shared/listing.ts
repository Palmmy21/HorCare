// Public vacancy page ("หน้าประกาศห้องว่าง"): what the owner sets, what a visitor sees, and the viewing request a
// visitor sends. Pure, shared by the page (src/components/Listing) and /api/listing.

/** Stored on DormConfig.listing; written only by /api/listing (publish), which also owns the slug index. */
export interface ListingConfig {
    enabled: boolean;
    /** Random public id in the link (?listing=<slug>); never the owner's uid. */
    slug: string;
    headline?: string;
    description?: string;
    /** Contact shown on the page; empty = the bill phone (bill_customization.dorm_phone). */
    contact_phone?: string;
    /** https://line.me/... link to the property's LINE OA, shown as a button. */
    line_url?: string;
    /** Show rent per room (default true). */
    show_prices?: boolean;
}

export interface ListingRoom {
    id: string;
    number: string;
    floor: string | null;
    building_name: string | null;
    rent: number | null;
    rent_type: string;
    deposit: number | null;
    area_sqm: number | null;
    amenities: string[];
}

/** The public payload of GET-like `view`. Contains nothing about tenants. */
export interface PublicListing {
    name: string;
    address: string | null;
    phone: string | null;
    logo: string | null;
    headline: string | null;
    description: string | null;
    line_url: string | null;
    building_type: string;
    rooms: ListingRoom[];
    updated_at: string;
}

export interface ViewingRequestInput {
    name: string;
    phone: string;
    line_id: string | null;
    room_id: string | null;
    move_in: string | null;
    note: string | null;
}

export const SLUG_RE = /^[a-z0-9]{8,24}$/;

const text = (v: unknown, max: number, min = 0): string | null | undefined => {
    if (v === undefined || v === null || v === '') return min > 0 ? undefined : null;
    if (typeof v !== 'string') return undefined;
    const t = v.replace(/\s+/g, ' ').trim();
    if (t.length < min || t.length > max) return undefined;
    return t || (min > 0 ? undefined : null);
};

/** Thai phone, digits only (9–10 digits, starting with 0). */
export function cleanListingPhone(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const digits = v.replace(/[\s-]/g, '');
    return /^0\d{8,9}$/.test(digits) ? digits : null;
}

/** A visitor's viewing request, or null when something required is missing or malformed. */
export function cleanViewingRequest(raw: Record<string, unknown>, today: string): ViewingRequestInput | null {
    const name = text(raw.name, 80, 2);
    const phone = cleanListingPhone(raw.phone);
    const line_id = text(raw.line_id, 60);
    const room_id = text(raw.room_id, 128);
    const note = text(raw.note, 500);
    if (!name || !phone || line_id === undefined || room_id === undefined || note === undefined) return null;
    let move_in: string | null = null;
    if (raw.move_in !== undefined && raw.move_in !== null && raw.move_in !== '') {
        if (typeof raw.move_in !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.move_in) || raw.move_in < today) return null;
        move_in = raw.move_in;
    }
    return { name, phone, line_id, room_id, move_in, note };
}

/** Owner's settings from the form, or null when malformed. The slug is kept (or created) by the server. */
export function cleanListingSettings(raw: Record<string, unknown>): Omit<ListingConfig, 'slug'> | null {
    const headline = text(raw.headline, 120);
    const description = text(raw.description, 2000);
    const phone = raw.contact_phone === '' || raw.contact_phone == null ? null : cleanListingPhone(raw.contact_phone);
    const lineUrl = text(raw.line_url, 200);
    if (headline === undefined || description === undefined || lineUrl === undefined) return null;
    if (raw.contact_phone && !phone) return null;
    if (lineUrl && !/^https:\/\/(line\.me|lin\.ee|page\.line\.me)\//.test(lineUrl)) return null;
    return {
        enabled: raw.enabled === true,
        headline: headline ?? undefined,
        description: description ?? undefined,
        contact_phone: phone ?? undefined,
        line_url: lineUrl ?? undefined,
        show_prices: raw.show_prices !== false,
    };
}

export function listingLink(origin: string, slug: string): string {
    return `${origin.replace(/\/$/, '')}/?listing=${slug}`;
}
