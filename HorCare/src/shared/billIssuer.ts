// Who a bill is from. A branch may hold several places with their own name (อพาร์ตเมนต์, วันเดอร์แลนด์, โชคชัยการ์เด้นโฮม),
// told apart by the unit's building (Room.building_name). The owner may give each its own name, address and phone for
// the head of the bill; whatever is left empty comes from the branch. Pure.

export interface PlaceIssuer { name?: string; address?: string; phone?: string }

interface BranchIssuer {
  dorm_name?: string; dorm_address?: string; dorm_phone?: string; dorm_logo?: string;
  /** Per building of the branch, keyed by the building's name as written on its units. */
  place_issuers?: Record<string, PlaceIssuer>;
}

export interface BillIssuer { name?: string; address?: string; phone?: string; logo?: string }

export const MAX_PLACE_ISSUERS = 50;
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

/** The head of the bill for a unit in this building (none / unknown building = the branch's own). */
export function issuerFor(bc: BranchIssuer | null | undefined, buildingName?: string | null): BillIssuer {
  const place = bc?.place_issuers?.[clean(buildingName, 200)];
  return {
    name: clean(place?.name, 200) || bc?.dorm_name || undefined,
    address: clean(place?.address, 500) || bc?.dorm_address || undefined,
    phone: clean(place?.phone, 100) || bc?.dorm_phone || undefined,
    logo: bc?.dorm_logo || undefined,
  };
}

/** What is saved: only buildings that exist, only fields that were filled in. Undefined when nothing is left. */
export function cleanPlaceIssuers(raw: Record<string, PlaceIssuer> | undefined, buildings: string[]): Record<string, PlaceIssuer> | undefined {
  const out: Record<string, PlaceIssuer> = {};
  for (const b of buildings.slice(0, MAX_PLACE_ISSUERS)) {
    const p = raw?.[b];
    const name = clean(p?.name, 200), address = clean(p?.address, 500), phone = clean(p?.phone, 100);
    if (name || address || phone) out[b] = { ...(name ? { name } : {}), ...(address ? { address } : {}), ...(phone ? { phone } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}
