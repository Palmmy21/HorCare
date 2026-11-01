import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, ChevronRight, Loader2, MapPin, PlayCircle, RefreshCw, Sparkles, Wrench } from 'lucide-react';
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
 */
export default function StaffPortalPage() {
    const token = new URLSearchParams(window.location.search).get('sp') ?? '';
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

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        void post<PortalOverview>({ action: 'overview', token }).then(r => {
            if (cancelled) return;
            if (!r.ok) { setState('gone'); return; }
            setData(r.data);
            setState('ready');
        });
        return () => { cancelled = true; };
    }, [token]);

    const updateCleaning = async (job: PortalCleaningJob, status: 'in_progress' | 'completed') => {
        setBusy(job.key);
        await post({ action: 'cleaning_update', token, job: job.key, status });
        setBusy(null);
        await load();
    };

    if (openJob) {
        return <StaffWorkPage portal={{ token, job: openJob, onBack: () => { setOpenJob(null); void load(); } }} />;
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
                {todo.length > 0 && (
                    <section>
                        <h2 className="sp-section"><Wrench size={16} aria-hidden /> ใบงาน</h2>
                        <ul className="sp-list">{todo.map(j => <WorkRow key={j.key} job={j} onOpen={() => setOpenJob(j.key)} />)}</ul>
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
                                        <span className="sp-chip">{CLEANING_STATUS_TH[c.status] ?? c.status}</span>
                                    </div>
                                    <p className="sp-job-desc">{SERVICE_TH[c.service_type] ?? c.service_type}{c.description ? ` · ${c.description}` : ''}</p>
                                    <p className="sp-job-meta">
                                        <span><MapPin size={13} aria-hidden /> {c.dorm_name}</span>
                                        {c.preferred_date && <span><Calendar size={13} aria-hidden /> {c.preferred_date}{c.preferred_time_slot ? ` ${c.preferred_time_slot}` : ''}</span>}
                                        {c.urgent && <span className="sp-urgent">ด่วน</span>}
                                    </p>
                                    <div className="sp-job-actions">
                                        {c.status !== 'in_progress' ? (
                                            <button type="button" className="btn btn-outline" disabled={busy === c.key} onClick={() => void updateCleaning(c, 'in_progress')}>
                                                <PlayCircle size={16} aria-hidden /> เริ่มทำ
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
                        <ul className="sp-list">{waiting.map(j => <WorkRow key={j.key} job={j} onOpen={() => setOpenJob(j.key)} />)}</ul>
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
