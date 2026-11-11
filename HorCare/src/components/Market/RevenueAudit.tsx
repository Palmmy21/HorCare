import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Download, FlaskConical, Info, Loader2, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { apiPost, ApiError } from '../../utils/api';
import {
    EXCUSED_LABELS, GAP_LABELS, auditCsv, auditRevenue,
    type AuditReport, type ExcusedKey, type Finding, type GapKey, type StallLine,
} from '../../shared/revenueAudit';
import { sampleAuditInput } from '../../shared/revenueAuditSample';
import { todayTh } from '../../shared/market';
import { downloadBlob } from '../../utils/qrCardImage';

const baht = (s: number) => `฿${Math.round(s / 100).toLocaleString('th-TH')}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const monthLabel = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const prevMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };

/** Buckets that point at money that may have gone missing (red), money still to chase (amber), or paperwork (grey). */
const GAP_TONE: Record<GapKey, 'risk' | 'chase' | 'info'> = {
    not_billed: 'risk', billed_low: 'risk', not_recorded: 'risk', absent_unreported: 'risk', voided: 'risk', unexplained: 'risk',
    unpaid: 'chase', partial: 'chase', discount: 'info', pending_slip: 'info',
};
const SEVERITY_LABEL: Record<Finding['severity'], string> = { high: 'ควรตรวจด่วน', medium: 'ควรตรวจ', info: 'ข้อสังเกต' };

const ERRORS: Record<string, string> = {
    forbidden: 'บัญชีนี้ไม่มีสิทธิ์ดูข้อมูลการเงิน',
    future_month: 'เดือนนี้ยังไม่เริ่ม',
    invalid_input: 'เดือนหรือโซนไม่ถูกต้อง',
};

interface Props { ownerUid: string; buildingId: string; dormName?: string }

/**
 * ตรวจยอดรายได้: for a month (and a zone), what should have come in, what did, where the difference went, and what to
 * do about it. "ข้อมูลตัวอย่าง" runs the same engine on a built-in example (nothing is read or saved) — for showing how
 * it works before a market's own data is in.
 */
export default function RevenueAudit({ ownerUid, buildingId, dormName }: Props) {
    const thisMonth = todayTh().slice(0, 7);
    const [month, setMonth] = useState(() => prevMonth(thisMonth));
    const [zone, setZone] = useState('');
    const [sample, setSample] = useState(false);
    const [live, setLive] = useState<{ report: AuditReport; zones: string[] } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [stallFilter, setStallFilter] = useState<string[] | null>(null);

    const load = useCallback(async () => {
        if (sample) return;
        setLoading(true);
        setError(null);
        try {
            setLive(await apiPost<{ report: AuditReport; zones: string[] }>('revenue-audit', { action: 'report', owner_uid: ownerUid, building_id: buildingId, month, zone: zone || null }));
        } catch (e) {
            const err = e as ApiError;
            setError(ERRORS[err.code] ?? err.message ?? 'โหลดรายงานไม่สำเร็จ');
        } finally {
            setLoading(false);
        }
    }, [ownerUid, buildingId, month, zone, sample]);

    useEffect(() => { void load(); }, [load]);

    const sampleData = useMemo(() => {
        if (!sample) return null;
        const input = sampleAuditInput();
        return { report: auditRevenue({ ...input, zone: zone || null }), zones: [...new Set(input.stalls.map(s => s.zone))] };
    }, [sample, zone]);
    const data = sample ? sampleData : live;
    const r = data?.report ?? null;

    // the example opens on zone A: the customer's story (64 stalls × ฿3,000, ฿192,000 due, ฿140,000 in)
    const toggleSample = () => { setZone(sample ? '' : 'โซน A'); setSample(s => !s); setStallFilter(null); };
    const exportCsv = () => {
        if (!r) return;
        downloadBlob(new Blob([auditCsv(r)], { type: 'text/csv;charset=utf-8' }), `ตรวจยอด ${dormName ?? 'ตลาด'} ${r.month}${r.zone ? ` ${r.zone}` : ''}.csv`);
    };

    return (
        <div className="ra">
            <div className="ra-toolbar">
                <label className="ra-field">
                    <span>เดือน</span>
                    <input type="month" className="form-input" value={sample ? '2026-10' : month} max={thisMonth} disabled={sample}
                        onChange={e => { if (e.target.value) { setMonth(e.target.value); setStallFilter(null); } }} />
                </label>
                <label className="ra-field">
                    <span>โซน</span>
                    <select className="form-input" value={zone} onChange={e => { setZone(e.target.value); setStallFilter(null); }}>
                        <option value="">ทุกโซน</option>
                        {(data?.zones ?? []).map(z => <option key={z} value={z}>{z}</option>)}
                    </select>
                </label>
                <div className="ra-toolbar-actions">
                    {!sample && <button type="button" className="btn btn-outline btn-sm" onClick={() => void load()} disabled={loading}><RefreshCw size={14} aria-hidden /> โหลดใหม่</button>}
                    <button type="button" className={`btn btn-sm ${sample ? 'btn-primary' : 'btn-outline'}`} onClick={toggleSample} aria-pressed={sample}>
                        <FlaskConical size={14} aria-hidden /> {sample ? 'กำลังดูข้อมูลตัวอย่าง' : 'ดูข้อมูลตัวอย่าง'}
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={exportCsv} disabled={!r}><Download size={14} aria-hidden /> CSV</button>
                </div>
            </div>

            {sample && (
                <div className="ra-banner" role="note">
                    <FlaskConical size={16} aria-hidden />
                    <span>ข้อมูลตัวอย่าง: ตลาด 300 แผง โซน A มีผู้เช่า 64 แผง ค่าเช่าเดือนละ ฿3,000 ควรได้ ฿192,000 แต่เก็บได้จริง ฿140,000 — ตัวเลขทั้งหมดคำนวณด้วยระบบจริง ไม่ได้อ่านหรือบันทึกข้อมูลของคุณ</span>
                </div>
            )}

            {loading && !r ? <div className="ra-loading"><Loader2 size={22} className="spin" aria-label="กำลังโหลด" /></div>
                : error && !sample ? <div className="ra-error" role="alert"><AlertTriangle size={18} aria-hidden /> {error}</div>
                : r && <Report r={r} sample={sample} stallFilter={stallFilter} setStallFilter={setStallFilter} />}
        </div>
    );
}

function Report({ r, sample, stallFilter, setStallFilter }: { r: AuditReport; sample: boolean; stallFilter: string[] | null; setStallFilter: (s: string[] | null) => void }) {
    const excusedTotal = Object.values(r.excused).reduce((a, b) => a + b, 0);
    const rate = r.expected_satang > 0 ? r.collected_satang / r.expected_satang : 1;
    const gapRows = (Object.entries(r.gaps) as [GapKey, number][]).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
    const maxGap = Math.max(1, ...gapRows.map(([, v]) => Math.abs(v)));
    const excusedRows = (Object.entries(r.excused) as [ExcusedKey, number][]).filter(([, v]) => v > 0);
    const risky = gapRows.filter(([k]) => GAP_TONE[k] === 'risk').reduce((t, [, v]) => t + Math.max(0, v), 0);

    if (r.stalls_total === 0) {
        return <div className="ra-empty"><Info size={20} aria-hidden /> ยังไม่มีแผงในตลาดนี้ (หรือในโซนที่เลือก) เพิ่มแผงที่หน้า "จัดการแผง" ก่อน</div>;
    }

    return (
        <>
            <p className="ra-period">{monthLabel(r.month)}{r.zone ? ` · ${r.zone}` : ' · ทุกโซน'} · {r.stalls_rented} จาก {r.stalls_total} แผงมีผู้ค้า</p>

            <div className="ra-kpis">
                <div className="ra-kpi">
                    <span className="ra-kpi-label">ยอดพึงประเมิน</span>
                    <strong className="ra-kpi-value">{baht(r.potential_satang)}</strong>
                    <span className="ra-kpi-sub">แผงที่มีผู้ค้า คิดเต็มอัตรา</span>
                </div>
                <div className="ra-kpi">
                    <span className="ra-kpi-label">ยอดพึงเก็บ</span>
                    <strong className="ra-kpi-value">{baht(r.expected_satang)}</strong>
                    <span className="ra-kpi-sub">{excusedTotal > 0 ? `หักวันหยุดที่แจ้ง/ตลาดหยุด ${baht(excusedTotal)}` : 'ไม่มีรายการหักลด'}</span>
                </div>
                <div className="ra-kpi is-good">
                    <span className="ra-kpi-label">เก็บได้จริง</span>
                    <strong className="ra-kpi-value">{baht(r.collected_satang)}</strong>
                    <span className="ra-meter" aria-hidden><span style={{ width: `${Math.min(100, rate * 100)}%` }} /></span>
                    <span className="ra-kpi-sub">{pct(rate)} ของยอดพึงเก็บ</span>
                </div>
                <div className={`ra-kpi ${r.gap_satang > 0 ? 'is-bad' : 'is-good'}`}>
                    <span className="ra-kpi-label">ส่วนต่าง</span>
                    <strong className="ra-kpi-value">{r.gap_satang > 0 ? baht(r.gap_satang) : 'ครบ'}</strong>
                    <span className="ra-kpi-sub">{risky > 0 ? `เสี่ยงหาย ${baht(risky)} · ที่เหลือคือค้างเก็บ/รอตรวจ` : r.gap_satang > 0 ? 'ส่วนใหญ่เป็นยอดค้างเก็บ/รอตรวจ' : 'เก็บได้ครบตามยอด'}</span>
                </div>
            </div>

            {r.notes.length > 0 && <ul className="ra-notes">{r.notes.map(n => <li key={n}><Info size={14} aria-hidden /> {n}</li>)}</ul>}

            <div className="ra-grid">
                <section className="ra-card">
                    <h3 className="ra-h">ส่วนต่าง {baht(r.gap_satang)} ไปไหน</h3>
                    {gapRows.length === 0 ? <p className="ra-muted"><CheckCircle2 size={16} aria-hidden /> ไม่มีส่วนต่าง</p> : (
                        <ul className="ra-bars">
                            {gapRows.map(([k, v]) => (
                                <li key={k} className={`ra-bar is-${GAP_TONE[k]}`}>
                                    <span className="ra-bar-label">{GAP_LABELS[k]}</span>
                                    <span className="ra-bar-track" aria-hidden><span style={{ width: `${(Math.abs(v) / maxGap) * 100}%` }} /></span>
                                    <span className="ra-bar-value">{v < 0 ? '−' : ''}{baht(Math.abs(v))}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="ra-legend"><i className="is-risk" /> เสี่ยงเงินหาย <i className="is-chase" /> ต้องตามเก็บ <i className="is-info" /> เอกสาร/รอตรวจ</p>
                    {excusedRows.length > 0 && (
                        <div className="ra-excused">
                            <span className="ra-excused-title">หักออกจากยอดแล้ว (ไม่นับเป็นเงินหาย)</span>
                            {excusedRows.map(([k, v]) => <span key={k}>{EXCUSED_LABELS[k]} <strong>{baht(v)}</strong></span>)}
                        </div>
                    )}
                    {r.vacancy_satang > 0 && <p className="ra-muted">แผงว่าง {r.stalls_total - r.stalls_rented} แผง · รายได้ที่ยังไม่ได้ (ถ้าปล่อยเช่าได้) ประมาณ {baht(r.vacancy_satang)}</p>}
                </section>

                <section className="ra-card">
                    <h3 className="ra-h">รายโซน</h3>
                    <div className="ra-table-wrap">
                        <table className="ra-table">
                            <thead><tr><th>โซน</th><th>มีผู้ค้า</th><th>พึงเก็บ</th><th>เก็บได้</th><th>ส่วนต่าง</th></tr></thead>
                            <tbody>
                                {r.zones.map(z => (
                                    <tr key={z.zone}>
                                        <td>{z.zone}</td>
                                        <td className="num">{z.rented}/{z.stalls}</td>
                                        <td className="num">{baht(z.expected_satang)}</td>
                                        <td className="num">{baht(z.collected_satang)} <small>({pct(z.rate)})</small></td>
                                        <td className={`num ${z.gap_satang > 0 ? 'is-bad' : ''}`}>{z.gap_satang > 0 ? baht(z.gap_satang) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {r.collectors.length > 0 && (
                        <>
                            <h3 className="ra-h" style={{ marginTop: '1rem' }}>คนเก็บเงิน</h3>
                            <div className="ra-table-wrap">
                                <table className="ra-table">
                                    <thead><tr><th>ชื่อ</th><th>เก็บได้</th><th>เงินสด</th><th>บันทึกไม่มา (ไม่แจ้ง)</th><th>เงินสดขาด</th></tr></thead>
                                    <tbody>
                                        {r.collectors.map(c => (
                                            <tr key={c.name}>
                                                <td>{c.name}</td>
                                                <td className="num">{baht(c.collected_satang)}</td>
                                                <td className="num">{baht(c.cash_satang)}</td>
                                                <td className={`num ${c.absent_unreported > 0 ? 'is-warn' : ''}`}>{c.absent_unreported || '—'}</td>
                                                <td className={`num ${c.short_satang > 0 ? 'is-bad' : ''}`}>{c.short_satang > 0 ? baht(c.short_satang) : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </section>
            </div>

            <section className="ra-section">
                <h3 className="ra-h"><ShieldAlert size={18} aria-hidden /> สาเหตุที่เป็นไปได้ และสิ่งที่ควรทำ</h3>
                {r.findings.length === 0
                    ? <p className="ra-muted"><CheckCircle2 size={16} aria-hidden /> ไม่พบสิ่งผิดปกติในเดือนนี้</p>
                    : <div className="ra-findings">{r.findings.map(f => <FindingCard key={f.id} f={f} onStalls={setStallFilter} />)}</div>}
            </section>

            <StallTable lines={r.stalls} filter={stallFilter} setFilter={setStallFilter} sample={sample} />
        </>
    );
}

function FindingCard({ f, onStalls }: { f: Finding; onStalls: (s: string[]) => void }) {
    const [open, setOpen] = useState(f.severity === 'high');
    return (
        <article className={`ra-finding is-${f.severity}`}>
            <button type="button" className="ra-finding-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
                <span className={`ra-sev is-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span>
                <span className="ra-finding-title">{f.title}</span>
                {f.amount_satang > 0 && <strong className="ra-finding-amount">{baht(f.amount_satang)}</strong>}
                <ChevronDown size={18} className={`ra-chevron${open ? ' is-open' : ''}`} aria-hidden />
            </button>
            {open && (
                <div className="ra-finding-body">
                    <p>{f.detail}</p>
                    <div className="ra-finding-cols">
                        <div>
                            <h4>สาเหตุที่เป็นไปได้</h4>
                            <ul>{f.causes.map(c => <li key={c}>{c}</li>)}</ul>
                        </div>
                        <div>
                            <h4>สิ่งที่ควรทำ</h4>
                            <ol>{f.actions.map(a => <li key={a}>{a}</li>)}</ol>
                        </div>
                    </div>
                    {f.stalls.length > 0 && (
                        <div className="ra-chips">
                            {f.stalls.slice(0, 24).map(s => <span key={s} className="ra-chip">{s}</span>)}
                            {f.stalls.length > 24 && <span className="ra-chip">+{f.stalls.length - 24}</span>}
                            {f.id !== 'walkin_uncharged' && f.id !== 'cash_short' && (
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStalls(f.stalls)}>ดูในตารางรายแผง</button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </article>
    );
}

function StallTable({ lines, filter, setFilter, sample }: { lines: StallLine[]; filter: string[] | null; setFilter: (s: string[] | null) => void; sample: boolean }) {
    const [q, setQ] = useState('');
    const [all, setAll] = useState(false);
    const shown = useMemo(() => {
        const t = q.trim().toLowerCase();
        return lines.filter(l => (filter ? filter.includes(l.number) : all || l.gap_satang !== 0 || l.notes.length > 0)
            && (!t || l.number.toLowerCase().includes(t) || (l.tenant ?? '').toLowerCase().includes(t)));
    }, [lines, filter, all, q]);
    const kind = { monthly: 'รายเดือน', daily: 'รายวัน', vacant: 'ว่าง' } as const;

    return (
        <section className="ra-section" id="ra-stalls">
            <div className="ra-section-head">
                <h3 className="ra-h">รายแผง {filter ? `(${filter.length} แผงที่เลือก)` : all ? '(ทั้งหมด)' : '(เฉพาะแผงที่มีส่วนต่างหรือข้อสังเกต)'}</h3>
                <div className="ra-section-tools">
                    <label className="ra-search"><Search size={14} aria-hidden /><input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาแผง / ผู้ค้า" aria-label="ค้นหาแผงหรือผู้ค้า" /></label>
                    {filter ? <button type="button" className="btn btn-outline btn-sm" onClick={() => setFilter(null)}>แสดงทุกแผงที่มีส่วนต่าง</button>
                        : <button type="button" className="btn btn-outline btn-sm" onClick={() => setAll(a => !a)}>{all ? 'เฉพาะแผงที่มีส่วนต่าง' : 'แสดงทุกแผง'}</button>}
                </div>
            </div>
            <div className="ra-table-wrap">
                <table className="ra-table ra-stalls">
                    <thead><tr><th>แผง</th><th>ผู้ค้า</th><th>ประเภท</th><th>พึงเก็บ</th><th>เก็บได้</th><th>ส่วนต่าง</th><th>สาเหตุ</th></tr></thead>
                    <tbody>
                        {shown.length === 0 && <tr><td colSpan={7} className="ra-muted">ไม่มีแผงที่ตรงเงื่อนไข</td></tr>}
                        {shown.slice(0, 400).map(l => (
                            <tr key={l.room_id}>
                                <td><strong>{l.number}</strong><small className="ra-zone">{l.zone}</small></td>
                                <td>{l.tenant ?? '—'}</td>
                                <td>{kind[l.kind]}</td>
                                <td className="num">{l.kind === 'vacant' ? '—' : baht(l.expected_satang)}</td>
                                <td className="num">{l.kind === 'vacant' ? '—' : baht(l.collected_satang)}</td>
                                <td className={`num ${l.gap_satang > 0 ? 'is-bad' : ''}`}>{l.gap_satang !== 0 ? `${l.gap_satang < 0 ? '−' : ''}${baht(Math.abs(l.gap_satang))}` : '—'}</td>
                                <td className="ra-why">
                                    {(Object.entries(l.gaps) as [GapKey, number][]).filter(([, v]) => v !== 0).map(([k, v]) => (
                                        <span key={k} className={`ra-tag is-${GAP_TONE[k]}`}>{GAP_LABELS[k]} {baht(Math.abs(v))}</span>
                                    ))}
                                    {l.notes.filter(n => !n.startsWith('ยังไม่ได้ออกบิล')).map(n => <span key={n} className="ra-note">{n}</span>)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {shown.length > 400 && <p className="ra-muted">แสดง 400 แถวแรก ดาวน์โหลด CSV เพื่อดูทั้งหมด</p>}
            {sample && <p className="ra-muted">ข้อมูลตัวอย่าง</p>}
        </section>
    );
}
