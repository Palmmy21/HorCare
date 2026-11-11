import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Calendar, Camera, CheckCircle2, ChevronRight, Gauge, Loader2, MapPin, PlayCircle, RefreshCw, Sparkles, Wrench } from 'lucide-react';
import { startHousekeeperSession } from '../../hooks/useHousekeepers';
import { compressImage } from '../../utils/imageCompress';
import type { HousekeeperSession } from '../../types';
import StaffWorkPage from '../WorkOrders/StaffWorkPage';
import { PRIORITY_LABELS_TH, WORK_STATUS_LABELS_TH, WORK_TYPE_LABELS_TH } from '../../shared/workOrders';
import { sortWork, type PortalCleaningJob, type PortalOverview, type PortalWorkJob } from '../../shared/staffPortal';
import { LOGO_SRC } from '../../utils/brand';

const CLEANING_STATUS_TH: Record<string, string> = { open: 'รอรับงาน', pending: 'รอรับงาน', assigned: 'ได้รับมอบหมาย', in_progress: 'กำลังทำ' };
const SERVICE_TH: Record<string, string> = {
    general: 'ทำความสะอาดทั่วไป', general_cleaning: 'ทำความสะอาดทั่วไป', bathroom: 'ล้างห้องน้ำ', bathroom_cleaning: 'ล้างห้องน้ำ',
    balcony: 'ล้างระเบียง', bed_linen: 'เปลี่ยนผ้าปู / ซักรีด', deep: 'บิ๊กคลีนนิ่ง', deep_cleaning: 'บิ๊กคลีนนิ่ง',
    checkout: 'ทำความสะอาดก่อนย้ายออก', move_out_cleaning: 'ทำความสะอาดก่อนย้ายออก', other: 'อื่นๆ',
};

async function post<T>(body: object): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
    const res = await fetch('/api/staff-portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

/**
 * Staff portal (/?sp=<token>): every job assigned to this technician / housekeeper, at every property they work for.
 * The token comes from the team LINE OA ("งานของฉัน"); there is no password. See docs/STAFF_LINE_ARCHITECTURE.md.
 *
 * The rich menu's other buttons land here too: `&go=next` opens the job to do next, `&go=meter` signs a housekeeper in
 * to the app's meter page. Built for people who rarely use apps: few words, large buttons, and the phone's back button
 * returns to the list instead of closing the page.
 */
interface HkState { state: 'idle' | 'busy' | 'choose' | 'error'; places?: { key: string; name: string }[]; message?: string }
const HK_ERRORS: Record<string, string> = {
    account_disabled: 'บัญชีแม่บ้านของคุณถูกปิดอยู่ กรุณาแจ้งผู้จัดการ',
    not_housekeeping: 'หน้านี้เปิดให้แม่บ้านเท่านั้น กรุณาแจ้งผู้จัดการ',
};

export default function StaffPortalPage() {
    const [{ token, go }] = useState(() => {
        const p = new URLSearchParams(window.location.search);
        return { token: p.get('sp') ?? '', go: p.get('go') };
    });
    const [hk, setHk] = useState<HkState>({ state: 'idle' });
    const [photos, setPhotos] = useState<Record<string, string>>({});
    const [sendError, setSendError] = useState<string | null>(null);
    const [data, setData] = useState<PortalOverview | null>(null);
    const [state, setState] = useState<'loading' | 'ready' | 'gone'>(token ? 'loading' : 'gone');
    const [openJob, setOpenJob] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        const r = await post<PortalOverview>({ action: 'overview', token });
        if (!r.ok) { setState('gone'); return; }
        setData(r.data);
        setState('ready');
    }, [token]);

    // Open the app's meter page as this housekeeper.
    const openMeter = useCallback(async (place?: string) => {
        setHk({ state: 'busy' });
        const r = await post<{ token?: string; session?: HousekeeperSession; places?: { key: string; name: string }[] }>({ action: 'housekeeper_session', token, place });
        if (r.ok && r.data.places) { setHk({ state: 'choose', places: r.data.places }); return; }
        if (!r.ok || !r.data.token || !r.data.session) {
            setHk({ state: 'error', message: HK_ERRORS[r.data.error ?? ''] ?? 'เปิดหน้านี้ไม่ได้ กรุณาลองใหม่อีกครั้ง' });
            return;
        }
        try {
            await startHousekeeperSession(r.data.token, r.data.session);
            window.location.replace('/?view=recording');
        } catch {
            setHk({ state: 'error', message: 'เปิดหน้านี้ไม่ได้ กรุณาลองใหม่อีกครั้ง' });
        }
    }, [token]);

    // One job at a time on screen; the phone's back button returns to the list.
    const openJobPage = useCallback((key: string) => {
        window.history.pushState({ spJob: key }, '');
        setOpenJob(key);
    }, []);
    useEffect(() => {
        const onPop = (e: PopStateEvent) => setOpenJob((e.state as { spJob?: string } | null)?.spJob ?? null);
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    // First load. A rich-menu button may have asked for more than the list: the meter page, or the job to do next.
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        void post<PortalOverview>({ action: 'overview', token }).then(r => {
            if (cancelled) return;
            if (!r.ok) { setState('gone'); return; }
            setData(r.data);
            setState('ready');
            if (go === 'meter') void openMeter();
            if (go === 'next') {
                const next = sortWork(r.data.work).find(j => j.status !== 'completed');
                if (next) openJobPage(next.key);
            }
        });
        return () => { cancelled = true; };
    }, [token, go, openMeter, openJobPage]);

    const updateCleaning = async (job: PortalCleaningJob, status: 'in_progress' | 'completed') => {
        setBusy(job.key);
        setSendError(null);
        const photo = status === 'completed' ? photos[job.key] : undefined;
        const r = await post({ action: 'cleaning_update', token, job: job.key, status, ...(photo ? { photo } : {}) });
        setBusy(null);
        if (!r.ok) { setSendError('ส่งงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'); return; }
        setPhotos(p => { const rest = { ...p }; delete rest[job.key]; return rest; });
        await load();
    };

    // The "after" photo for a housekeeping job, kept until the job is sent.
    const addPhoto = async (jobKey: string, file: File | undefined) => {
        if (!file) return;
        try {
            const { base64 } = await compressImage(file, 900);
            setPhotos(p => ({ ...p, [jobKey]: `data:image/jpeg;base64,${base64}` }));
        } catch { setSendError('อ่านรูปไม่ได้ กรุณาถ่ายใหม่'); }
    };

    if (openJob) {
        return <StaffWorkPage portal={{ token, job: openJob, onBack: () => { window.history.back(); void load(); } }} />;
    }
    if (state === 'loading') {
        return <div className="sp-page sp-center"><Loader2 size={32} className="spin" aria-label="กำลังโหลด" /></div>;
    }
    if (state === 'gone' || !data) {
        return (
            <div className="sp-page sp-center">
                <div className="sp-card sp-gone">
                    <AlertTriangle size={36} color="#E8740C" aria-hidden />
                    <h1>ลิงก์นี้ใช้ไม่ได้แล้ว</h1>
                    <p>ลิงก์หมดอายุ (ใช้ได้ 30 วัน) หรือบัญชีถูกปิด พิมพ์ <strong>งานของฉัน</strong> ในแชท LINE ของทีมงานเพื่อรับลิงก์ใหม่</p>
                </div>
            </div>
        );
    }

    const work = sortWork(data.work);
    const todo = work.filter(j => j.status !== 'completed');
    const waiting = work.filter(j => j.status === 'completed');
    const total = todo.length + data.cleaning.length;

    return (
        <div className="sp-page">
            <header className="sp-head">
                <img src={LOGO_SRC} alt="" width={36} height={36} />
                <div className="sp-head-text">
                    <h1>สวัสดีคุณ {data.name}</h1>
                    <p>{total === 0 ? 'ไม่มีงานค้าง 🎉' : `งานที่ต้องทำ ${total} งาน`}{data.properties > 1 ? ` · ${data.properties} สถานที่` : ''}</p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()} aria-label="โหลดใหม่"><RefreshCw size={18} /></button>
            </header>

            <main className="sp-main">
                {data.can_meter && (
                    <button type="button" className="sp-tile" disabled={hk.state === 'busy'} onClick={() => void openMeter()}>
                        {hk.state === 'busy' ? <Loader2 size={34} className="spin" aria-hidden /> : <Gauge size={34} aria-hidden />}
                        <span className="sp-tile-text">
                            <strong>จดมิเตอร์</strong>
                            <span>พิมพ์เลข หรือถ่ายรูปมิเตอร์น้ำ-ไฟ</span>
                        </span>
                        <ChevronRight size={22} className="sp-tile-go" aria-hidden />
                    </button>
                )}
                {hk.state === 'choose' && hk.places && (
                    <section className="sp-card" role="dialog" aria-label="เลือกสถานที่">
                        <p className="sp-choose-title">เลือกสถานที่</p>
                        <div className="sp-choose">
                            {hk.places.map(p => (
                                <button key={p.key} type="button" className="btn btn-outline" onClick={() => void openMeter(p.key)}>{p.name}</button>
                            ))}
                        </div>
                    </section>
                )}
                {hk.state === 'error' && <div className="sp-card sp-alert" role="alert"><AlertTriangle size={20} aria-hidden /> {hk.message}</div>}
                {sendError && <div className="sp-card sp-alert" role="alert"><AlertTriangle size={20} aria-hidden /> {sendError}</div>}

                {todo.length > 0 && (
                    <section>
                        <h2 className="sp-section"><Wrench size={16} aria-hidden /> ใบงาน</h2>
                        <ul className="sp-list">{todo.map(j => <WorkRow key={j.key} job={j} onOpen={() => openJobPage(j.key)} />)}</ul>
                    </section>
                )}

                {data.cleaning.length > 0 && (
                    <section>
                        <h2 className="sp-section"><Sparkles size={16} aria-hidden /> งานทำความสะอาด</h2>
                        <ul className="sp-list">
                            {data.cleaning.map(c => (
                                <li key={c.key} className={`sp-card sp-job${c.urgent ? ' is-urgent' : ''}`}>
                                    <div className="sp-job-top">
                                        <strong>ห้อง {c.room_number}</strong>
                                        <span className={`sp-chip${c.unassigned ? ' is-warn' : ''}`}>{c.unassigned ? 'งานใหม่ รอคนรับ' : CLEANING_STATUS_TH[c.status] ?? c.status}</span>
                                    </div>
                                    <p className="sp-job-desc">{SERVICE_TH[c.service_type] ?? c.service_type}{c.description ? ` · ${c.description}` : ''}</p>
                                    <p className="sp-job-meta">
                                        <span><MapPin size={13} aria-hidden /> {c.dorm_name}</span>
                                        {c.preferred_date && <span><Calendar size={13} aria-hidden /> {c.preferred_date}{c.preferred_time_slot ? ` ${c.preferred_time_slot}` : ''}</span>}
                                        {c.urgent && <span className="sp-urgent">ด่วน</span>}
                                    </p>
                                    {photos[c.key] && <img className="sp-job-photo" src={photos[c.key]} alt="รูปหลังทำความสะอาด" />}
                                    <label className="btn btn-outline sp-photo-btn">
                                        <Camera size={18} aria-hidden /> {photos[c.key] ? 'ถ่ายรูปใหม่' : 'ถ่ายรูปหลังทำ'}
                                        <input type="file" accept="image/*" capture="environment" hidden
                                            onChange={e => { void addPhoto(c.key, e.target.files?.[0]); e.target.value = ''; }} />
                                    </label>
                                    <div className="sp-job-actions">
                                        {c.status !== 'in_progress' ? (
                                            <button type="button" className="btn btn-outline" disabled={busy === c.key} onClick={() => void updateCleaning(c, 'in_progress')}>
                                                <PlayCircle size={16} aria-hidden /> {c.unassigned ? 'รับงานนี้' : 'เริ่มทำ'}
                                            </button>
                                        ) : null}
                                        <button type="button" className="btn btn-primary" disabled={busy === c.key} onClick={() => void updateCleaning(c, 'completed')}>
                                            {busy === c.key ? <Loader2 size={16} className="spin" aria-hidden /> : <CheckCircle2 size={16} aria-hidden />} เสร็จแล้ว
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {waiting.length > 0 && (
                    <section>
                        <h2 className="sp-section sp-muted">ส่งแล้ว รอผู้จัดการตรวจ</h2>
                        <ul className="sp-list">{waiting.map(j => <WorkRow key={j.key} job={j} onOpen={() => openJobPage(j.key)} />)}</ul>
                    </section>
                )}

                {total === 0 && waiting.length === 0 && (
                    <div className="sp-card sp-empty">
                        <CheckCircle2 size={32} aria-hidden />
                        <p>ตอนนี้ไม่มีงานที่มอบหมายให้คุณ งานใหม่จะแจ้งเข้ามาทาง LINE</p>
                    </div>
                )}
            </main>
        </div>
    );
}

function WorkRow({ job, onOpen }: { job: PortalWorkJob; onOpen: () => void }) {
    const reopened = !!job.reopen_note && job.status !== 'completed';
    return (
        <li>
            <button type="button" className={`sp-card sp-job sp-job-link${job.priority === 'urgent' ? ' is-urgent' : ''}`} onClick={onOpen}>
                <div className="sp-job-top">
                    <strong>{job.area}</strong>
                    <span className={`sp-chip${reopened ? ' is-warn' : ''}`}>{reopened ? 'ส่งกลับแก้ไข' : WORK_STATUS_LABELS_TH[job.status]}</span>
                </div>
                <p className="sp-job-desc">{WORK_TYPE_LABELS_TH[job.work_type]} · {job.description}</p>
                <p className="sp-job-meta">
                    <span><MapPin size={13} aria-hidden /> {job.dorm_name}</span>
                    {job.due_date && <span><Calendar size={13} aria-hidden /> ภายใน {job.due_date}</span>}
                    {(job.priority === 'urgent' || job.priority === 'high') && <span className="sp-urgent">{PRIORITY_LABELS_TH[job.priority]}</span>}
                </p>
                <ChevronRight size={18} className="sp-job-go" aria-hidden />
            </button>
        </li>
    );
}
