import { apiPost } from './api';
import type { AlertType } from '../shared/alerts';

/**
 * Tell the rest of the team about something this person just did in the app that only the browser knows of — a stock
 * count changed, a housekeeper finished a room, a housekeeping request was written by the front desk. The server
 * checks the caller may raise it, works out who should hear, and skips the caller. Never throws and never blocks:
 * the action it follows has already been saved.
 */
export function raiseTeamAlert(input: {
    ownerUid: string; buildingId: string; type: Extract<AlertType, 'stock' | 'job_status' | 'cleaning' | 'maintenance'>;
    title: string; body?: string; kind?: string; roomNumber?: string;
}): void {
    void apiPost('alerts', {
        action: 'raise', owner_uid: input.ownerUid, building_id: input.buildingId, type: input.type,
        title: input.title, body: input.body ?? '', kind: input.kind, room_number: input.roomNumber,
    }).catch(() => undefined);
}
