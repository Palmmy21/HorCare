import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithCustomToken, signOut, type User } from 'firebase/auth';
import { AlertTriangle, Building2, Loader2, LogOut, RefreshCw, Wallet } from 'lucide-react';
import { auth } from '../../firebase/config';
import { apiPost, ApiError } from '../../utils/api';
import { useCollections } from '../../hooks/useCollections';
import { addDays, todayTh } from '../../shared/market';
import { dayTotals, outstanding, type Charge, CHARGE_KIND_LABELS_TH } from '../../shared/collections';
import type { BankAccount } from '../../shared/banks';
import { LOGO_SRC } from '../../utils/brand';
import RoundView from '../Collections/RoundView';
import PayDialog from '../Collections/PayDialog';
import DayClosePanel from '../Collections/DayClosePanel';

interface Place { owner_uid: string; building_id: string; name: string; style: 'monthly' | 'nightly' | 'stall'; building_type: string | null; can_close: boolean }
interface Places { places: Place[]; accounts: Record<string, BankAccount[]>; name: string }

const OWNER_KEY = 'horcare_pos_owner';
const PLACE_KEY = 'horcare_pos_place';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ } };

const SIGNIN_ERRORS: Record<string, string> = {
    invalid_link: 'ลิงก์นี้ใช้ไม่ได้แล้ว (ใช้ได้ครั้งเดียวภายใน 10 นาที) กดปุ่ม "เปิด POS Care" ในแชท LINE อีกครั้ง',
    no_access: 'บัญชีนี้ไม่มีสิทธิ์เก็บเงินแล้ว กรุณาติดต่อเจ้าของหรือผู้จัดการ',
    too_many_requests: 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
};

type Phase = { kind: 'starting' } | { kind: 'error'; message: string } | { kind: 'signed_out' } | { kind: 'ready'; user: User };

/**
 * POS Care (/?pos=<token>): the collector's screen, opened from the "HorCare Staff" LINE OA. The link signs the person in
 * as their own HorCare account (once, for 10 minutes); after that it is the ordinary app with the ordinary permission
 * checks. Markets get the stall round; resorts and hotels get the open bills to collect; both close the day.
 */
export default function PosCarePage() {
    const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
    const go = useMemo(() => new URLSearchParams(window.location.search).get('go'), []);

    useEffect(() => {
        let unsub: (() => void) | undefined;
        let cancelled = false;
        const token = new URLSearchParams(window.location.search).get('pos') ?? '';
        const listen = () => {
            unsub = onAuthStateChanged(auth, u => { if (!cancelled) setPhase(u ? { kind: 'ready', user: u } : { kind: 'signed_out' }); });
        };
        (async () => {
            if (token) {
                try {
                    const res = await fetch('/api/pos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'redeem', token }) });
                    const data = await res.json().catch(() => ({})) as { token?: string; owner_uid?: string; error?: string };
                    if (!res.ok || !data.token) throw new ApiError(res.status, data.error ?? 'invalid_link');
                    await signInWithCustomToken(auth, data.token);
                    write(OWNER_KEY, data.owner_uid ?? null);
                } catch (e) {
                    if (!cancelled) setPhase({ kind: 'error', message: SIGNIN_ERRORS[(e as ApiError).code] ?? 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่' });
                    return;
                } finally {
                    // the link is spent: keep the page, drop the token from the address
                    window.history.replaceState({}, '', `/?pos=${go ? `&go=${go}` : ''}`);
                }
            }
            if (!cancelled) listen();
        })();
        return () => { cancelled = true; unsub?.(); };
    }, [go]);

    if (phase.kind === 'starting') return <Center><Loader2 size={30} className="spin" aria-label="กำลังเข้าสู่ระบบ" /><p>กำลังเปิด POS Care…</p></Center>;
    if (phase.kind === 'error' || phase.kind === 'signed_out') {
        return (
            <Center>
                <AlertTriangle size={36} color="#E8740C" aria-hidden />
                <h1 className="pos-title">เปิด POS Care ไม่ได้</h1>
                <p className="pos-muted">{phase.kind === 'error' ? phase.message : 'ออกจากระบบแล้ว กดปุ่ม "เปิด POS Care" ในแชท LINE HorCare Staff เพื่อเข้าใหม่'}</p>
            </Center>
        );
    }
    return <PosHome user={phase.user} openClose={go === 'close'} onSignedOut={() => setPhase({ kind: 'signed_out' })} />;
}

function Center({ children }: { children: React.ReactNode }) {
    return <div className="pos-page pos-center"><div className="pos-card pos-center-card">{children}</div></div>;
}

function PosHome({ user, openClose, onSignedOut }: { user: User; openClose: boolean; onSignedOut: () => void }) {
    const owner = read(OWNER_KEY) || user.uid;
    const [data, setData] = useState<Places | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [placeId, setPlaceId] = useState<string | null>(() => read(PLACE_KEY));

    useEffect(() => {
        let cancelled = false;
        apiPost<Places>('pos', { action: 'places', owner_uid: owner })
            .then(r => { if (!cancelled) setData(r); })
            .catch(e => { if (!cancelled) setError((e as ApiError).code === 'no_access' || (e as ApiError).code === 'forbidden' ? 'บัญชีนี้ไม่มีสิทธิ์เก็บเงินที่ไหนเลย กรุณาติดต่อผู้จัดการ' : 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่'); });
        return () => { cancelled = true; };
    }, [owner]);

    const place = data?.places.find(p => p.building_id === placeId) ?? (data?.places.length === 1 ? data.places[0] : null);
    const choose = (id: string | null) => { setPlaceId(id); write(PLACE_KEY, id); };
    const leave = async () => { write(OWNER_KEY, null); write(PLACE_KEY, null); await signOut(auth).catch(() => undefined); onSignedOut(); };

    return (
        <div className="pos-page">
            <header className="pos-head">
                <img src={LOGO_SRC} alt="" width={34} height={34} />
                <div className="pos-head-text">
                    <strong>POS Care</strong>
                    <span>{place ? place.name : data?.name ?? ''}</span>
                </div>
                {data && data.places.length > 1 && place && <button type="button" className="btn btn-ghost btn-sm" onClick={() => choose(null)}><Building2 size={16} aria-hidden /> เปลี่ยนที่</button>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void leave()} aria-label="ออกจากระบบ"><LogOut size={16} aria-hidden /></button>
            </header>
            <main className="pos-main">
                {error ? <div className="pos-card pos-alert" role="alert"><AlertTriangle size={18} aria-hidden /> {error}</div>
                    : !data ? <div className="pos-center-inline"><Loader2 size={24} className="spin" aria-label="กำลังโหลด" /></div>
                    : !place ? (
                        <section className="pos-places">
                            <h1 className="pos-title">เลือกสถานที่</h1>
                            {data.places.map(p => (
                                <button key={p.building_id} type="button" className="pos-card pos-place" onClick={() => choose(p.building_id)}>
                                    <Building2 size={22} aria-hidden /> <span>{p.name}</span>
                                </button>
                            ))}
                        </section>
                    ) : <PlaceView key={place.building_id} place={place} accounts={data.accounts[place.building_id] ?? []} openClose={openClose} />}
            </main>
        </div>
    );
}

function PlaceView({ place, accounts, openClose }: { place: Place; accounts: BankAccount[]; openClose: boolean }) {
    const today = todayTh();
    const { data, error, busy, load, call, act } = useCollections(place.owner_uid, place.building_id, today, addDays(today, 7));
    const closeRef = useRef<HTMLDivElement>(null);
    const scrolled = useRef(false);

    // "ปิดยอด" in LINE opens here: bring the day close into view once the data is in
    useEffect(() => {
        if (!openClose || !data || scrolled.current) return;
        scrolled.current = true;
        setTimeout(() => closeRef.current?.querySelector('.pos-close, input, button')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
    }, [openClose, data]);

    if (place.style === 'monthly') {
        return <div className="pos-card pos-alert"><Wallet size={18} aria-hidden /> {place.name} เก็บเงินรายเดือนด้วยบิล POS Care ใช้กับตลาด รีสอร์ท และโรงแรม</div>;
    }
    return (
        <div className="pos-place-view" ref={closeRef}>
            <div className="pos-toolbar">
                <span className="pos-muted">{place.style === 'stall' ? 'เดินเก็บแผงวันนี้' : 'รับเงินค่าห้อง / ค่าบริการ'}{busy ? ' · กำลังบันทึก…' : ''}</span>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => void load()}><RefreshCw size={14} aria-hidden /> โหลดใหม่</button>
            </div>
            {error && <div className="pos-card pos-alert" role="alert"><AlertTriangle size={18} aria-hidden /> {error}</div>}
            {!data && !error && <div className="pos-center-inline"><Loader2 size={24} className="spin" aria-label="กำลังโหลด" /></div>}
            {data && place.style === 'stall' && <RoundView data={data} accounts={accounts} canClose={place.can_close} call={call} act={act} reload={() => void load()} />}
            {data && place.style === 'nightly' && <OpenBills data={data} accounts={accounts} canClose={place.can_close} call={call} reload={() => void load()} />}
        </div>
    );
}

const baht = (s: number) => (s / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Resorts and hotels: every bill with money still to take, oldest first, one tap to collect. */
function OpenBills({ data, accounts, canClose, call, reload }: {
    data: NonNullable<ReturnType<typeof useCollections>['data']>; accounts: BankAccount[]; canClose: boolean;
    call: <T>(body: Record<string, unknown>) => Promise<T>; reload: () => void;
}) {
    const [paying, setPaying] = useState<Charge | null>(null);
    const [q, setQ] = useState('');
    const open = data.charges.filter(c => c.status === 'open' && outstanding(c) > 0)
        .filter(c => !q.trim() || `${c.room_number ?? ''} ${c.party_name}`.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => a.period_start.localeCompare(b.period_start));
    const totals = dayTotals(data.payments, data.today);
    const due = data.charges.filter(c => c.status === 'open').reduce((t, c) => t + outstanding(c), 0);
    return (
        <div className="pos-bills">
            <div className="pos-kpis">
                <div className="pos-card pos-kpi is-due"><span>ค้างรับทั้งหมด</span><strong>฿{baht(due)}</strong></div>
                <div className="pos-card pos-kpi is-in"><span>รับแล้ววันนี้</span><strong>฿{baht(totals.cash_satang + totals.transfer_satang)}</strong><small>สด {baht(totals.cash_satang)} · โอน {baht(totals.transfer_satang)}</small></div>
            </div>
            <input className="form-input pos-search" placeholder="ค้นหาห้อง / ชื่อแขก" value={q} onChange={e => setQ(e.target.value)} inputMode="search" />
            {open.length === 0 ? <div className="pos-card pos-muted">ไม่มีรายการค้างรับ 🎉</div> : open.map(c => (
                <div key={c.id} className="pos-card pos-bill">
                    <div className="pos-bill-text">
                        <strong>{c.room_number ? `ห้อง ${c.room_number}` : c.party_name}</strong>
                        <span>{CHARGE_KIND_LABELS_TH[c.kind]} · {c.party_name}{c.period_start ? ` · ${c.period_start}` : ''}</span>
                    </div>
                    <button type="button" className="btn btn-primary pos-pay" onClick={() => setPaying(c)}>รับ ฿{baht(outstanding(c))}</button>
                </div>
            ))}
            {canClose && <div className="pos-close"><DayClosePanel data={data} totals={totals} call={call} reload={reload} /></div>}
            {paying && <PayDialog charge={paying} accounts={accounts} call={call} onDone={reload} onClose={() => setPaying(null)} />}
        </div>
    );
}
