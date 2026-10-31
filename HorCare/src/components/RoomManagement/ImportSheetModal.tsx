import { useMemo, useState } from 'react';
import { FileSpreadsheet, Loader2, Sparkles, Upload, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { apiPost } from '../../utils/api';
import { readSheet } from '../../utils/sheetReader';
import { logActivity } from '../../utils/auditLog';
import {
    guessMapping, IMPORT_FIELD_LABELS, IMPORT_FIELDS, maskCell, toImportRecords, type ColumnMapping, type ImportField, type ImportRecord,
} from '../../shared/importMapping';
import type { Room } from '../../types';

interface Props {
    uid?: string;
    buildingId?: string;
    rooms: Room[];
    remainingSlots: number;
    unitName: string;
    onBulkCreate: (rooms: Partial<Room>[]) => Promise<{ created: number; ids?: string[] }>;
    onUpdateRoom: (roomId: string, updates: Partial<Room>) => Promise<void>;
    onClose: () => void;
    onDone: (result: { created: number; updated: number; tenants: number; skipped: string[] }) => void;
}

const READ_ERRORS: Record<string, string> = {
    unsupported_file: 'รองรับไฟล์ .xlsx และ .csv (ไฟล์ .xls รุ่นเก่า ให้เปิดใน Excel แล้ว "บันทึกเป็น" .xlsx ก่อน)',
    empty_file: 'ไม่พบข้อมูลในไฟล์ ต้องมีแถวหัวตารางและข้อมูลอย่างน้อย 1 แถว',
    bad_file: 'อ่านไฟล์ไม่ได้ ไฟล์อาจเสียหรือมีรหัสผ่าน',
};

const ROOM_FIELDS = ['floor', 'building_name', 'rent_amount', 'deposit_amount', 'area_sqm', 'current_meter_elec', 'current_meter_water'] as const;

/** Import rooms (and their tenants) from any Excel / CSV: the AI matches the columns, the owner checks, then saves. */
export default function ImportSheetModal({ uid, buildingId, rooms, remainingSlots, unitName, onBulkCreate, onUpdateRoom, onClose, onDone }: Props) {
    const [rows, setRows] = useState<string[][] | null>(null);
    const [fileName, setFileName] = useState('');
    const [mapping, setMapping] = useState<ColumnMapping>([]);
    const [source, setSource] = useState<'ai' | 'guess' | null>(null);
    const [stage, setStage] = useState<'pick' | 'mapping' | 'saving'>('pick');
    const [error, setError] = useState<string | null>(null);

    const result = useMemo(() => (rows ? toImportRecords(rows, mapping) : null), [rows, mapping]);
    const existing = useMemo(() => new Map(rooms.map(r => [r.room_number, r])), [rooms]);
    const newCount = result?.records.filter(r => !existing.has(r.room_number)).length ?? 0;
    const overLimit = Math.max(0, newCount - remainingSlots);

    const pick = async (file: File) => {
        setError(null);
        try {
            const sheet = await readSheet(file);
            setRows(sheet);
            setFileName(file.name);
            setStage('mapping');
            setMapping(guessMapping(sheet[0]));
            setSource(null);
            // ask the AI; the keyword guess stays on screen meanwhile and if it fails
            apiPost<{ mapping: ColumnMapping; source: 'ai' | 'guess' }>('import-map', {
                owner_uid: uid, building_id: buildingId, headers: sheet[0],
                samples: sheet.slice(1, 6).map(r => r.map(maskCell)), // masked here too: real data never leaves the browser
            }).then(r => { setMapping(r.mapping); setSource(r.source); }).catch(() => setSource('guess'));
        } catch (err) {
            setError(READ_ERRORS[(err as Error).message] ?? `อ่านไฟล์ไม่สำเร็จ: ${(err as Error).message}`);
        }
    };

    const setColumn = (i: number, field: ImportField | null) => {
        setMapping(prev => prev.map((f, j) => (j === i ? field : f === field && field !== null ? null : f)));
    };

    const save = async () => {
        if (!result || !uid || !buildingId) return;
        setStage('saving');
        setError(null);
        try {
            const roomFields = (r: ImportRecord): Partial<Room> => {
                const out: Partial<Room> = {};
                for (const f of ROOM_FIELDS) if (r[f] !== undefined) (out as Record<string, unknown>)[f] = r[f];
                return out;
            };
            const fresh = result.records.filter(r => !existing.has(r.room_number));
            const allowed = fresh.slice(0, remainingSlots);
            const skipped = fresh.slice(remainingSlots).map(r => r.room_number);

            // 1. new rooms in one go, existing rooms updated with the columns the file has
            const created = allowed.length ? await onBulkCreate(allowed.map(r => ({ room_number: r.room_number, ...roomFields(r) }))) : { created: 0, ids: [] };
            const roomIdOf = new Map<string, string>();
            allowed.forEach((r, i) => { const id = created.ids?.[i]; if (id) roomIdOf.set(r.room_number, id); });
            let updated = 0;
            for (const r of result.records) {
                const room = existing.get(r.room_number);
                if (!room) continue;
                roomIdOf.set(r.room_number, room.id);
                const changes = roomFields(r);
                if (Object.keys(changes).length) { await onUpdateRoom(room.id, changes); updated++; }
            }

            // 2. tenant profiles — only for rooms that have none yet (never overwrite what the owner typed in)
            const base = `users/${uid}/buildings/${buildingId}`;
            const have = new Set((await getDocs(collection(db, `${base}/tenants`))).docs.filter(d => d.data().full_name).map(d => d.id));
            const now = new Date().toISOString();
            const tenantRows = result.records.filter(r => r.tenant && roomIdOf.has(r.room_number) && !have.has(roomIdOf.get(r.room_number)!));
            for (let i = 0; i < tenantRows.length; i += 400) {
                const batch = writeBatch(db);
                for (const r of tenantRows.slice(i, i + 400)) {
                    const roomId = roomIdOf.get(r.room_number)!;
                    batch.set(doc(db, `${base}/tenants/${roomId}`), {
                        id: roomId, room_id: roomId, building_id: buildingId, ...r.tenant, created_at: now, updated_at: now,
                    }, { merge: true });
                }
                await batch.commit();
            }
            if (tenantRows.length) {
                logActivity({ action: 'CREATE', resourceType: 'tenant', resourceId: null, resourceLabel: `${tenantRows.length} tenants`, note: `import ${fileName}` });
            }
            onDone({ created: created.created, updated, tenants: tenantRows.length, skipped });
        } catch (err) {
            const dupes = (err as { duplicates?: string[] }).duplicates;
            setError(dupes ? `เลขห้องซ้ำกับที่มีอยู่: ${dupes.slice(0, 5).join(', ')}` : `บันทึกไม่สำเร็จ: ${(err as Error).message}`);
            setStage('mapping');
        }
    };

    const headers = rows?.[0] ?? [];
    const samples = rows?.slice(1, 4) ?? [];
    const withTenant = result?.records.filter(r => r.tenant).length ?? 0;

    return (
        <div className="modal-overlay" onClick={stage === 'saving' ? undefined : onClose}>
            <div className="modal imp-modal" role="dialog" aria-modal="true" aria-labelledby="imp-title" onClick={e => e.stopPropagation()}>
                <div className="modal-header imp-head">
                    <h2 id="imp-title" className="modal-title"><FileSpreadsheet size={20} aria-hidden /> นำเข้า{unitName}จาก Excel</h2>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={stage === 'saving'} aria-label="ปิด"><X size={18} /></button>
                </div>

                {stage === 'pick' && (
                    <div className="modal-body">
                        <label className="imp-drop">
                            <Upload size={28} aria-hidden />
                            <strong>เลือกไฟล์ .xlsx หรือ .csv</strong>
                            <span>ไฟล์รูปแบบไหนก็ได้ ขอแค่มีแถวหัวตาราง ระบบจะจับคู่คอลัมน์ให้ (เลขห้อง ค่าเช่า ชื่อผู้เช่า เบอร์โทร วันเข้าอยู่ ฯลฯ)</span>
                            <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                onChange={e => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
                        </label>
                        <p className="form-hint imp-privacy">ไฟล์ถูกอ่านในเครื่องของคุณ AI เห็นแค่ชื่อคอลัมน์และรูปแบบข้อมูล (ปิดบังแล้ว) ไม่เห็นชื่อหรือเบอร์โทรจริง</p>
                        {error && <p className="imp-error" role="alert">{error}</p>}
                    </div>
                )}

                {stage !== 'pick' && rows && result && (
                    <>
                        <div className="modal-body">
                            <p className="imp-source">
                                {source === null ? <><Loader2 size={14} className="pp-spin" aria-hidden /> AI กำลังจับคู่คอลัมน์…</>
                                    : source === 'ai' ? <><Sparkles size={14} aria-hidden /> AI จับคู่ให้แล้ว ตรวจและแก้ได้</>
                                    : <>จับคู่จากชื่อคอลัมน์ ตรวจและแก้ได้</>}
                                <span className="imp-file">{fileName} · {rows.length - 1} แถว</span>
                            </p>
                            <div className="imp-table-wrap">
                                <table className="imp-table">
                                    <thead>
                                        <tr>{headers.map((h, i) => <th key={i}>{h || `คอลัมน์ ${i + 1}`}</th>)}</tr>
                                        <tr>
                                            {headers.map((_, i) => (
                                                <td key={i}>
                                                    <select className={`form-input imp-select${mapping[i] ? ' is-set' : ''}`} value={mapping[i] ?? ''} disabled={stage === 'saving'}
                                                        onChange={e => setColumn(i, (e.target.value || null) as ImportField | null)}>
                                                        <option value="">— ไม่ใช้ —</option>
                                                        {IMPORT_FIELDS.map(f => <option key={f} value={f}>{IMPORT_FIELD_LABELS[f]}</option>)}
                                                    </select>
                                                </td>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {samples.map((r, j) => <tr key={j}>{headers.map((_, i) => <td key={i}>{r[i] ?? ''}</td>)}</tr>)}
                                    </tbody>
                                </table>
                            </div>

                            <ul className="imp-summary">
                                <li><CheckCircle2 size={15} aria-hidden /> พร้อมนำเข้า {result.records.length} {unitName} (ใหม่ {newCount}, อัปเดต {result.records.length - newCount}){withTenant ? ` · พร้อมข้อมูลผู้เช่า ${withTenant} ราย` : ''}</li>
                                {overLimit > 0 && <li className="imp-warn"><AlertTriangle size={15} aria-hidden /> เกินจำนวนที่แพ็กเกจรองรับ {overLimit} {unitName} จะข้ามไป</li>}
                                {result.problems.slice(0, 6).map(p => <li key={p.line} className="imp-warn"><AlertTriangle size={15} aria-hidden /> แถว {p.line}: {p.message}</li>)}
                                {result.problems.length > 6 && <li className="imp-warn">…และอีก {result.problems.length - 6} แถวที่มีปัญหา (จะข้ามไป)</li>}
                            </ul>
                            {error && <p className="imp-error" role="alert">{error}</p>}
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" disabled={stage === 'saving'} onClick={() => { setStage('pick'); setRows(null); }}>เลือกไฟล์ใหม่</button>
                            <button type="button" className="btn btn-primary" disabled={stage === 'saving' || result.records.length === 0} onClick={() => void save()}>
                                {stage === 'saving' && <Loader2 size={16} className="pp-spin" aria-hidden />} นำเข้า {result.records.length} รายการ
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
