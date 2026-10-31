import { useEffect, useState } from 'react';
import { Megaphone, Copy, ExternalLink, Phone, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { apiPost } from '../../utils/api';
import { listingLink, type ListingConfig } from '../../shared/listing';
import type { DormConfig } from '../../types';

interface ViewingRequest {
    id: string; name: string; phone: string; line_id: string | null; room_number: string | null;
    move_in: string | null; note: string | null; created_at: string;
}

const ERR: Record<string, string> = {
    invalid_input: 'ข้อมูลไม่ถูกต้อง: เบอร์โทรต้องเป็นเบอร์ไทย และลิงก์ LINE ต้องขึ้นต้นด้วย https://line.me/ หรือ https://lin.ee/',
    forbidden: 'บัญชีนี้ไม่มีสิทธิ์จัดการการปล่อยเช่า',
};

/** Settings → การเชื่อมต่อ: the public vacancy page and the viewing requests it brings in. */
export default function ListingSettingsSection({ config, ownerUid, buildingId }: { config: DormConfig; ownerUid?: string; buildingId?: string }) {
    const saved = config.listing;
    const [form, setForm] = useState(() => formOf(saved));
    const [savedFor, setSavedFor] = useState(saved);
    const [busy, setBusy] = useState(false);
    const [requests, setRequests] = useState<ViewingRequest[]>([]);

    // follow the stored settings when they change (another device, or our own publish)
    if (saved !== savedFor) { setSavedFor(saved); setForm(formOf(saved)); }

    useEffect(() => {
        if (!ownerUid || !buildingId) return;
        return onSnapshot(
            query(collection(db, `users/${ownerUid}/buildings/${buildingId}/viewing_requests`), orderBy('created_at', 'desc'), limit(10)),
            snap => setRequests(snap.docs.map(d => d.data() as ViewingRequest)),
            () => setRequests([]),
        );
    }, [ownerUid, buildingId]);

    const link = saved?.slug ? listingLink(window.location.origin, saved.slug) : null;

    const publish = async (enabled: boolean) => {
        if (!ownerUid || !buildingId) return;
        setBusy(true);
        try {
            await apiPost('listing', { action: 'publish', owner_uid: ownerUid, building_id: buildingId, ...form, enabled });
            toast.success(enabled ? 'เปิดหน้าประกาศห้องว่างแล้ว' : 'ปิดหน้าประกาศแล้ว');
        } catch (err) {
            const code = (err as { code?: string }).code ?? (err as Error).message;
            toast.error(ERR[code] ?? `บันทึกไม่สำเร็จ: ${(err as Error).message}`);
        } finally {
            setBusy(false);
        }
    };

    const copy = async () => {
        if (!link) return;
        try { await navigator.clipboard.writeText(link); toast.success('คัดลอกลิงก์แล้ว'); } catch { toast.error('คัดลอกไม่สำเร็จ'); }
    };

    return (
        <div className="settings-section">
            <h3 className="settings-title">
                <Megaphone size={20} color="#0A6CC2" />
                หน้าประกาศห้องว่าง
                {saved?.enabled && <span className="badge badge-success" style={{ marginLeft: 'auto' }}>เปิดอยู่</span>}
            </h3>
            <p className="form-hint" style={{ marginBottom: '1rem' }}>
                หน้าเว็บสาธารณะแสดงห้องที่ว่างตอนนี้ (คำนวณจากสัญญาจริง) พร้อมราคาและสิ่งอำนวยความสะดวก
                คนที่สนใจกดขอนัดดูห้องได้เลย คำขอจะเข้ามาที่นี่และในหน้าปล่อยเช่า ไม่มีข้อมูลผู้เช่าแสดงบนหน้านี้
            </p>

            {link && saved?.enabled && (
                <div className="listing-link">
                    <code>{link}</code>
                    <div className="listing-link-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}><Copy size={14} aria-hidden /> คัดลอก</button>
                        <a className="btn btn-secondary btn-sm" href={link} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden /> เปิดดู</a>
                    </div>
                </div>
            )}

            <div className="form-group">
                <label className="form-label">หัวข้อประกาศ</label>
                <input className="form-input" maxLength={120} value={form.headline} onChange={e => setForm({ ...form, headline: e.target.value })} placeholder="เช่น ห้องใหม่ ใกล้ ม.ขอนแก่น เดิน 5 นาที" />
            </div>
            <div className="form-group">
                <label className="form-label">รายละเอียด</label>
                <textarea className="form-input" rows={4} maxLength={2000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="เช่น มีรปภ. 24 ชม. กล้องวงจรปิด ใกล้เซเว่น ไม่รวมค่าน้ำไฟ" />
            </div>
            <div className="settings-grid">
                <div className="form-group">
                    <label className="form-label">เบอร์ติดต่อ</label>
                    <input className="form-input mono" inputMode="tel" value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} placeholder={config.bill_customization?.dorm_phone || '08X-XXX-XXXX'} />
                    <p className="form-hint">เว้นว่าง = ใช้เบอร์ในใบแจ้งหนี้</p>
                </div>
                <div className="form-group">
                    <label className="form-label">ลิงก์ LINE OA (ถ้ามี)</label>
                    <input className="form-input" value={form.line_url} onChange={e => setForm({ ...form, line_url: e.target.value })} placeholder="https://lin.ee/xxxxx" />
                </div>
            </div>
            <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>แสดงค่าเช่าและเงินมัดจำ</span>
                    <input type="checkbox" checked={form.show_prices} onChange={e => setForm({ ...form, show_prices: e.target.checked })}
                        style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#0A6CC2' }} />
                </label>
            </div>

            <div className="listing-actions">
                {saved?.enabled ? (
                    <>
                        <button type="button" className="btn btn-primary" disabled={busy || !buildingId} onClick={() => void publish(true)}>
                            {busy && <Loader2 size={16} className="pp-spin" aria-hidden />} บันทึกการแก้ไข
                        </button>
                        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void publish(false)}>ปิดหน้าประกาศ</button>
                    </>
                ) : (
                    <button type="button" className="btn btn-primary" disabled={busy || !buildingId} onClick={() => void publish(true)}>
                        {busy && <Loader2 size={16} className="pp-spin" aria-hidden />} เปิดหน้าประกาศห้องว่าง
                    </button>
                )}
            </div>

            {requests.length > 0 && (
                <div className="listing-requests">
                    <h4 className="listing-requests-title">คำขอดูห้องล่าสุด</h4>
                    <ul>
                        {requests.map(r => (
                            <li key={r.id}>
                                <div className="listing-req-main">
                                    <strong>{r.name}</strong>
                                    {r.room_number && <span className="badge badge-gray">ห้อง {r.room_number}</span>}
                                    <span className="listing-req-time">{new Date(r.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                                </div>
                                <div className="listing-req-sub">
                                    <a href={`tel:${r.phone}`}><Phone size={12} aria-hidden /> {r.phone}</a>
                                    {r.line_id && <span>LINE: {r.line_id}</span>}
                                    {r.move_in && <span>อยากเข้าอยู่ {r.move_in}</span>}
                                </div>
                                {r.note && <p className="listing-req-note">{r.note}</p>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function formOf(l: ListingConfig | undefined) {
    return {
        headline: l?.headline ?? '',
        description: l?.description ?? '',
        contact_phone: l?.contact_phone ?? '',
        line_url: l?.line_url ?? '',
        show_prices: l?.show_prices !== false,
    };
}
