/**
 * /api/import-map — which spreadsheet column is which room/tenant field, decided by the AI.
 *
 * The browser reads the file; only the header row and a few sample rows reach the server, and the samples are
 * masked first (maskCell: digits → 9, letters → ก/a) so no tenant's real name or phone goes to the AI provider.
 * Without an AI key, or when the AI fails, the header-keyword guess is returned instead (source: 'guess').
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authorize } from './_rbac.js';
import { rateLimitBy } from './_abuse-guard.js';
import { AiError, aiGenerate, extractJson } from './_ai.js';
import { cleanMapping, guessMapping, IMPORT_FIELD_LABELS, IMPORT_FIELDS, maskCell, type ColumnMapping } from '../src/shared/importMapping.js';
import { errorInfo } from '../src/shared/errorInfo.js';

export const config = { maxDuration: 30 };

const MAX_COLS = 60;
const MAX_SAMPLES = 5;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
    const body = (req.body ?? {}) as { owner_uid?: unknown; building_id?: unknown; headers?: unknown; samples?: unknown };
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId: body.building_id, permission: 'room.create' });
    if (!ctx) return;

    if (!Array.isArray(body.headers) || body.headers.length === 0 || body.headers.length > MAX_COLS || !body.headers.every(h => typeof h === 'string')) {
        res.status(400).json({ error: 'invalid_input' }); return;
    }
    const headers = (body.headers as string[]).map(h => h.slice(0, 80));
    // masked again here: never trust the client to have done it
    const samples = (Array.isArray(body.samples) ? body.samples : []).slice(0, MAX_SAMPLES)
        .filter((r): r is unknown[] => Array.isArray(r))
        .map(r => headers.map((_, i) => maskCell(typeof r[i] === 'string' ? r[i] as string : '')));
    const guess = guessMapping(headers);

    if (!(await rateLimitBy(ctx.uid, 'import-map', 30, 3600)).ok) { res.status(200).json({ mapping: guess, source: 'guess' }); return; }

    const fields = IMPORT_FIELDS.map(f => `- ${f}: ${IMPORT_FIELD_LABELS[f]}`).join('\n');
    const prompt = `คุณช่วยจับคู่คอลัมน์ในไฟล์ Excel ของเจ้าของหอพัก/อพาร์ตเมนต์ไทย กับฟิลด์ของระบบ HorCare

ฟิลด์ที่มี:
${fields}

คอลัมน์ในไฟล์ (เรียงตามลำดับ, เริ่มที่ 0) พร้อมตัวอย่างข้อมูลที่ถูกปิดบังแล้ว (ตัวเลขเป็น 9, อักษรไทยเป็น ก, อักษรอังกฤษเป็น a — ดูรูปแบบได้ แต่ไม่ใช่ค่าจริง):
${headers.map((h, i) => `${i}. "${h}" ตัวอย่าง: ${samples.map(s => `"${s[i]}"`).join(', ') || '-'}`).join('\n')}

กติกา:
- ตอบเป็น JSON เท่านั้น: {"mapping": [ฟิลด์ของคอลัมน์ 0, ฟิลด์ของคอลัมน์ 1, ...]} ยาวเท่าจำนวนคอลัมน์ (${headers.length})
- ใช้ชื่อฟิลด์ตามรายการข้างบนเท่านั้น คอลัมน์ที่ไม่ตรงกับฟิลด์ใด ให้ใส่ null
- แต่ละฟิลด์ใช้ได้ครั้งเดียว ถ้ามีหลายคอลัมน์เข้าข่าย เลือกคอลัมน์ที่ตรงที่สุด
- เลขห้อง มักเป็นตัวเลขหรือรหัสสั้น เช่น 999, a99, ก-99
- เบอร์โทรไทยมี 9–10 หลัก เช่น 999-999-9999 ส่วนวันที่มักเป็น 9/9/9999 หรือ 9999-99-99
- คำใบ้จากชื่อคอลัมน์ (อาจผิด): ${JSON.stringify(guess)}`;

    let mapping: ColumnMapping | null = null;
    try {
        const text = await aiGenerate({ kind: 'text', prompt, json: true, temperature: 0, maxTokens: 800 });
        mapping = cleanMapping(extractJson(text), headers.length);
    } catch (err) {
        if (!(err instanceof AiError && err.code === 'missing_key')) console.warn('import-map: AI failed:', errorInfo(err).message);
    }
    // an AI answer without the room column is no better than the keyword guess
    if (mapping && mapping.includes('room_number')) { res.status(200).json({ mapping, source: 'ai' }); return; }
    res.status(200).json({ mapping: guess, source: 'guess' });
}
