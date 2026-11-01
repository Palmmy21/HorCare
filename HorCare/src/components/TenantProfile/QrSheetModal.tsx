import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, QrCode, Loader2, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { Room } from '../../types';
import { apiPost, ApiError } from '../../utils/api';
import { residentOaId } from '../../utils/lineOa';

interface QrSheetModalProps {
    ownerUid: string;
    buildingId: string;
    rooms: Room[];
    unitName: string;
    dormName?: string;
    /** Picks the OA the codes go to (market stalls → the vendor OA). */
    buildingType?: string;
    onClose: () => void;
}

interface SheetCode { room_id: string; room_number: string; code: string }
interface Sheet { codes: SheetCode[]; expires_at?: number; dorm_name?: string }

const TTL_OPTIONS = [
    { hours: 168, label: '7 วัน' },
    { hours: 336, label: '14 วัน' },
    { hours: 720, label: '30 วัน' },
];

/**
 * One printable sheet of single-use LINE registration QR codes — one card per room — for an owner moving
 * every resident over at once: cut the cards, hand one to each room, the resident scans and presses send.
 */
export default function QrSheetModal({ ownerUid, buildingId, rooms, unitName, dormName, buildingType, onClose }: QrSheetModalProps) {
    const [ttl, setTtl] = useState(720);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sheet, setSheet] = useState<Sheet | null>(null);

    const oaId = residentOaId(buildingType);
    const waiting = rooms.filter(r => r.is_active && !r.line_user_id);
    const linkFor = (code: string) => `https://line.me/R/oaMessage/${encodeURIComponent(oaId ?? '')}/?${encodeURIComponent(code)}`;
    const name = sheet?.dorm_name || dormName || '';

    const generate = async () => {
        setBusy(true);
        setError(null);
        try {
            setSheet(await apiPost<Sheet>('invitations', {
                action: 'create_sheet', owner_uid: ownerUid, building_id: buildingId, expires_in_hours: ttl,
            }));
        } catch (e) {
            const err = e as ApiError;
            setError(err.code === 'forbidden' ? 'คุณไม่มีสิทธิ์สร้างรหัสเชิญ' : err.message || 'สร้าง QR ไม่สำเร็จ');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal" style={{ maxWidth: sheet ? 860 : 520 }} role="dialog" aria-modal="true" aria-label="QR ลงทะเบียนทุกห้อง">
                <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <QrCode size={20} /> QR ลงทะเบียน LINE ทุก{unitName}
                    </span>
                    <button className="btn-icon" onClick={onClose} aria-label="ปิด"><X size={18} /></button>
                </div>

                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {!oaId && (
                        <div role="alert" style={{ color: '#B45309', fontSize: '0.8125rem' }}>
                            ยังไม่ได้ตั้งค่า LINE OA ของระบบ — QR จะใช้ไม่ได้จนกว่าจะตั้งค่า
                        </div>
                    )}
                    {!sheet ? (
                        <>
                            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-gray-600)' }}>
                                สร้าง QR หนึ่งใบต่อ{unitName} สำหรับ{unitName}ที่ยังไม่ได้เชื่อม LINE ({waiting.length} {unitName})
                                พิมพ์แล้วตัดแจกได้เลย ผู้เช่าสแกน → กดส่ง → ผูกกับ{unitName}ทันที ไม่ต้องพิมพ์เลข{unitName}
                            </p>
                            <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8125rem', color: 'var(--color-gray-600)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <li>แต่ละ QR ใช้ได้ครั้งเดียว และผูกได้เฉพาะ{unitName}ของตัวเอง</li>
                                <li>รหัสแสดงครั้งเดียว — สร้างใหม่ได้ทุกเมื่อ (ใบเก่ายังใช้ได้จนหมดอายุ)</li>
                                <li>เก็บใบที่พิมพ์ไว้ให้ดี ใครถือใบไหนก็ผูก{unitName}นั้นได้</li>
                            </ul>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <span className="form-label">อายุของ QR</span>
                                <select className="form-input" value={ttl} onChange={e => setTtl(Number(e.target.value))}>
                                    {TTL_OPTIONS.map(o => <option key={o.hours} value={o.hours}>{o.label}</option>)}
                                </select>
                            </label>
                            {error && <div role="alert" style={{ color: '#DC2626', fontSize: '0.8125rem' }}>{error}</div>}
                        </>
                    ) : sheet.codes.length === 0 ? (
                        <p style={{ margin: 0, textAlign: 'center', color: 'var(--color-gray-600)' }}>
                            ทุก{unitName}เชื่อม LINE แล้ว ไม่มี QR ที่ต้องพิมพ์
                        </p>
                    ) : (
                        <>
                            <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-600)' }}>
                                {sheet.codes.length} {unitName}
                                {sheet.expires_at ? ` · หมดอายุ ${new Date(sheet.expires_at).toLocaleDateString('th-TH')}` : ''}
                            </div>
                            <div className="qr-sheet-grid">
                                {sheet.codes.map(c => <QrCard key={c.room_id} code={c} link={linkFor(c.code)} unitName={unitName} dormName={name} />)}
                            </div>
                        </>
                    )}
                </div>

                <div className="modal-footer" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button className="btn btn-outline" onClick={onClose}>ปิด</button>
                    {!sheet ? (
                        <button className="btn btn-primary" onClick={generate} disabled={busy || waiting.length === 0}>
                            {busy ? <Loader2 size={16} className="spin" /> : <QrCode size={16} />} สร้าง QR {waiting.length} {unitName}
                        </button>
                    ) : sheet.codes.length > 0 && (
                        <button className="btn btn-primary" onClick={() => window.print()}>
                            <Printer size={16} /> พิมพ์
                        </button>
                    )}
                </div>
            </div>

            {/* printed copy lives outside the modal so it lays out on plain A4 pages */}
            {sheet && sheet.codes.length > 0 && createPortal(
                <div className="qr-sheet-print">
                    <div className="qr-sheet-grid">
                        {sheet.codes.map(c => <QrCard key={c.room_id} code={c} link={linkFor(c.code)} unitName={unitName} dormName={name} />)}
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}

function QrCard({ code, link, unitName, dormName }: { code: SheetCode; link: string; unitName: string; dormName: string }) {
    return (
        <div className="qr-sheet-card">
            {dormName && <div className="qr-sheet-dorm">{dormName}</div>}
            <div className="qr-sheet-room">{unitName} {code.room_number}</div>
            <QRCodeSVG value={link} size={128} />
            <div className="qr-sheet-steps">สแกนด้วย LINE → กด “ส่ง” → เสร็จ<br />รับบิลและแจ้งชำระผ่าน LINE ได้ทันที</div>
            <div className="qr-sheet-code mono">{code.code}</div>
        </div>
    );
}
