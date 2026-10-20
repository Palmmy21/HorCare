import { apiPost } from './api';

/**
 * A room's tenant portal URL. Links carry a per-room secret kept by the server, so the app asks for it instead of
 * building it from ids (needs tenant.read on the property).
 */
export async function fetchPortalUrl(ownerUid: string, buildingId: string, roomId: string, opts: { sign?: boolean } = {}): Promise<string> {
  const { url } = await apiPost<{ url: string }>('portal', { action: 'link', owner_uid: ownerUid, building_id: buildingId, room_id: roomId });
  return opts.sign ? `${url}&action=sign` : url;
}

/** Issue a new portal link for the room: every link given out before stops working (new tenant, leaked link). */
export async function resetPortalUrl(ownerUid: string, buildingId: string, roomId: string): Promise<string> {
  const { url } = await apiPost<{ url: string }>('portal', { action: 'rotate', owner_uid: ownerUid, building_id: buildingId, room_id: roomId });
  return url;
}
