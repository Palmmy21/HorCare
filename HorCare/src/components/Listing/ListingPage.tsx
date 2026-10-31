import { useEffect, useState } from 'react';
import { BedDouble, Building2, Check, MapPin, MessageCircle, Phone, Ruler, X } from 'lucide-react';
import AntiBot, { captchaRequired } from '../Common/AntiBot';
import { amenityLabel } from '../../utils/amenities';
import { todayTh } from '../../shared/market';
import type { ListingRoom, PublicListing } from '../../shared/listing';
import { LOGO_SRC } from '../../utils/brand';

const ERR: Record<string, string> = {
    invalid_input: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบชื่อและเบอร์โทร',
    not_found: 'ประกาศนี้ปิดไปแล้ว หรือลิงก์ไม่ถูกต้อง',
    too_many_requests: 'ส่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
    captcha_failed: 'ยืนยันตัวตนไม่ผ่าน กรุณาลองใหม่อีกครั้ง',
};

const RENT_UNIT: Record<string, string> = { monthly: '/เดือน', daily: '/วัน', weekly: '/สัปดาห์', semester: '/เทอม', yearly: '/ปี' };
const baht = (n: number) => `฿${n.toLocaleString('th-TH')}`;

async function post<T>(body: object): Promise<T> {
    const res = await fetch('/api/listing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? 'request_failed');
    return data as T;
}

/** Public vacancy page (no login). Opened from ?listing=<slug>. */
export default function ListingPage() {
    const slug = new URLSearchParams(window.location.search).get('listing') ?? '';
    const [data, setData] = useState<PublicListing | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [asking, setAsking] = useState<ListingRoom | 'any' | null>(null);

    useEffect(() => {
        post<PublicListing>({ action: 'view', slug })
            .then(d => { setData(d); document.title = `${d.name} · ห้องว่าง`; })
            .catch(err => setLoadError(ERR[(err as Error).message] ?? 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่'));
    }, [slug]);

    if (loadError) {
        return (
            <div className="lp-page lp-center">
                <img src={LOGO_SRC} alt="" width={56} height={56} />
                <p>{loadError}</p>
            </div>
        );
    }
    if (!data) {
        return <div className="lp-page lp-center"><div className="loading-spinner" style={{ width: 32, height: 32 }} /></div>;
    }

    return (
        <div className="lp-page">
            <header className="lp-hero">
                <div className="lp-hero-inner">
                    <div className="lp-brand">
                        {data.logo ? <img src={data.logo} alt="" className="lp-logo" /> : <span className="lp-logo lp-logo-fallback"><Building2 size={26} aria-hidden /></span>}
                        <div>
                            <h1 className="lp-name">{data.name}</h1>
                            {data.address && <p className="lp-address"><MapPin size={14} aria-hidden /> {data.address}</p>}
                        </div>
                    </div>
                    {data.headline && <p className="lp-headline">{data.headline}</p>}
                    {data.description && <p className="lp-desc">{data.description}</p>}
                    <div className="lp-contact">
                        {data.phone && <a className="btn btn-secondary" href={`tel:${data.phone}`}><Phone size={16} aria-hidden /> โทร {data.phone}</a>}
                        {data.line_url && <a className="btn lp-line" href={data.line_url} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} aria-hidden /> แชท LINE</a>}
                        <button type="button" className="btn btn-primary" onClick={() => setAsking('any')}>ขอนัดดูห้อง</button>
                    </div>
                </div>
            </header>

            <main className="lp-main">
                <h2 className="lp-section-title">
                    ห้องว่างตอนนี้ <span className="lp-count">{data.rooms.length} ห้อง</span>
                </h2>
                {data.rooms.length === 0 ? (
                    <div className="lp-empty">
                        ตอนนี้ห้องเต็ม ฝากชื่อไว้ได้ เมื่อมีห้องว่างจะติดต่อกลับ
                        <button type="button" className="btn btn-primary" onClick={() => setAsking('any')}>ฝากชื่อไว้</button>
                    </div>
                ) : (
                    <ul className="lp-rooms">
                        {data.rooms.map(r => (
                            <li key={r.id} className="lp-room">
                                <div className="lp-room-head">
                                    <span className="lp-room-no"><BedDouble size={18} aria-hidden /> ห้อง {r.number}</span>
                                    {(r.floor || r.building_name) && (
                                        <span className="lp-room-where">{[r.building_name && `ตึก ${r.building_name}`, r.floor && `ชั้น ${r.floor}`].filter(Boolean).join(' · ')}</span>
                                    )}
                                </div>
                                {r.rent !== null && (
                                    <p className="lp-rent">{baht(r.rent)}<span>{RENT_UNIT[r.rent_type] ?? ''}</span></p>
                                )}
                                <p className="lp-room-meta">
                                    {r.deposit !== null && <span>มัดจำ {baht(r.deposit)}</span>}
                                    {r.area_sqm !== null && <span><Ruler size={13} aria-hidden /> {r.area_sqm} ตร.ม.</span>}
                                </p>
                                {r.amenities.length > 0 && (
                                    <ul className="lp-amenities">
                                        {r.amenities.map(a => <li key={a}><Check size={12} aria-hidden /> {amenityLabel(a)}</li>)}
                                    </ul>
                                )}
                                <button type="button" className="btn btn-primary lp-ask" onClick={() => setAsking(r)}>ขอนัดดูห้องนี้</button>
                            </li>
                        ))}
                    </ul>
                )}
            </main>

            <footer className="lp-footer">
                <img src={LOGO_SRC} alt="" width={18} height={18} /> จัดการด้วย <a href="/" target="_blank" rel="noopener">HorCare</a>
            </footer>

            {asking && <ViewingForm slug={slug} room={asking === 'any' ? null : asking} onClose={() => setAsking(null)} />}
        </div>
    );
}

function ViewingForm({ slug, room, onClose }: { slug: string; room: ListingRoom | null; onClose: () => void }) {
    const today = todayTh();
    const [form, setForm] = useState({ name: '', phone: '', line_id: '', move_in: '', note: '' });
    const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [trap, setTrap] = useState('');
    const [token, setToken] = useState('');
    const ready = form.name.trim().length >= 2 && form.phone.replace(/\D/g, '').length >= 9 && (!captchaRequired || token !== '');

    const submit = async () => {
        setState('busy');
        setError(null);
        try {
            await post({ action: 'request', slug, room_id: room?.id ?? null, ...form, website: trap, captcha_token: token });
            setState('done');
        } catch (err) {
            setError(ERR[(err as Error).message] ?? 'ส่งไม่สำเร็จ กรุณาลองใหม่');
            setState('idle');
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal lp-form" role="dialog" aria-modal="true" aria-labelledby="lp-form-title" onClick={e => e.stopPropagation()}>
                <div className="modal-header lp-form-head">
                    <h2 id="lp-form-title" className="modal-title">{room ? `ขอนัดดูห้อง ${room.number}` : 'ขอนัดดูห้อง'}</h2>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="ปิด"><X size={18} /></button>
                </div>
                {state === 'done' ? (
                    <div className="modal-body lp-done">
                        <Check size={28} aria-hidden />
                        <p>ส่งเรียบร้อยแล้ว เจ้าของหอจะติดต่อกลับที่ {form.phone}</p>
                        <button type="button" className="btn btn-primary" onClick={onClose}>ปิด</button>
                    </div>
                ) : (
                    <div className="modal-body lp-fields">
                        <label className="form-label">ชื่อ<input className="form-input" maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoComplete="name" /></label>
                        <label className="form-label">เบอร์โทร<input className="form-input" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} autoComplete="tel" placeholder="08X-XXX-XXXX" /></label>
                        <label className="form-label">LINE ID (ถ้ามี)<input className="form-input" maxLength={60} value={form.line_id} onChange={e => setForm({ ...form, line_id: e.target.value })} /></label>
                        <label className="form-label">อยากเข้าอยู่วันที่ (ถ้าทราบ)<input className="form-input" type="date" min={today} value={form.move_in} onChange={e => setForm({ ...form, move_in: e.target.value })} /></label>
                        <label className="form-label">ข้อความ (ถ้ามี)<textarea className="form-input" rows={2} maxLength={500} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="เช่น สะดวกดูห้องช่วงเย็น" /></label>
                        <AntiBot trap={trap} onTrap={setTrap} onToken={setToken} />
                        {error && <div role="alert" className="lp-error">{error}</div>}
                        <button type="button" className="btn btn-primary lp-submit" disabled={state === 'busy' || !ready} onClick={() => void submit()}>
                            {state === 'busy' ? 'กำลังส่ง…' : 'ส่งคำขอ'}
                        </button>
                        <p className="lp-privacy">ข้อมูลนี้ส่งถึงเจ้าของหอเพื่อนัดดูห้องเท่านั้น</p>
                    </div>
                )}
            </div>
        </div>
    );
}
