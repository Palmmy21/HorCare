// Which LINE Official Account a property's residents add as a friend: market stalls use the vendor OA when it is set
// up (VITE_LINE_MARKET_OA_ID), everyone else the tenant OA (VITE_LINE_OA_ID). The server picks the same OA per room
// (api/_line.ts roomLineToken), so invitations, bills and replies all come from the account the person follows.
export function residentOaId(buildingType: string | undefined): string | undefined {
  const market = import.meta.env.VITE_LINE_MARKET_OA_ID as string | undefined;
  if (buildingType === 'market' && market) return market;
  return import.meta.env.VITE_LINE_OA_ID as string | undefined;
}

/** Opens a chat with the OA with the code typed in: the resident only presses send. */
export const oaRegistrationLink = (oaId: string, code: string): string =>
  `https://line.me/R/oaMessage/${encodeURIComponent(oaId)}/?${encodeURIComponent(code)}`;
