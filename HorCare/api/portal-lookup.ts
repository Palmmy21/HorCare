import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_firebase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'method_not_allowed' });
    }

    const lid = String(req.query.lid ?? '').trim();
    if (!lid || lid.length > 200) {
        return res.status(400).json({ error: 'bad_request' });
    }

    const snap = await db.collection('line_rooms').doc(lid).get();
    if (!snap.exists) {
        return res.status(404).json({ error: 'not_found' });
    }

    const { uid, building_id, room_id, room_number, dorm_name } = snap.data()!;
    return res.status(200).json({ uid, building_id, room_id, room_number, dorm_name });
}
