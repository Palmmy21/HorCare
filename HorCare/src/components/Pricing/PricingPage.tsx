import { useState, useEffect, memo } from 'react';
import toast from 'react-hot-toast';
import {
    Check, X, Clock, ChevronLeft, ShieldCheck, Zap, MessageCircle, Loader2,
    Home, Building, Building2, CreditCard,
} from 'lucide-react';
import type { UserProfile, PlanName, BillingCycle } from '../../types';

/* ----------- Plan definitions (stable ref) ----------- */
interface Plan {
    id: PlanName;
    name: string;
    icon: React.ElementType;
    roomRange: string;
    monthlyPrice: number;
    yearlyPrice: number;
    originalYearlyPrice: number;
    features: string[];
}

const PLANS: Plan[] = [
    {
        id: 'small', name: 'Start', icon: Home, roomRange: 'สูงสุด 50 ห้อง · 1 หอ',
        monthlyPrice: 149, yearlyPrice: 950, originalYearlyPrice: 1788,
        features: [
            'ห้องสูงสุด 50 ห้อง · 1 หอพัก',
            'จดมิเตอร์ไฟ / น้ำ + ออกบิลอัตโนมัติ',
            'ส่งบิลผ่าน LINE อัตโนมัติ',
            'QR โอนเงินในบิล',
            'หน้าแจ้งซ่อม (Maintenance board)',
            'ระบบจัดการ (สต็อก / ทรัพย์สิน / ค่าใช้จ่าย)',
            'หน้าจัดการการชำระเงิน',
            'Export PDF / สรุปยอดรายเดือน',
            '[no] Multi-หอ',
            '[no] ข้อมูลผู้เช่าเต็มรูปแบบ',
        ],
    },
    {
        id: 'medium', name: 'Plus', icon: Building, roomRange: 'สูงสุด 150 ห้อง · 5 หอ',
        monthlyPrice: 259, yearlyPrice: 1590, originalYearlyPrice: 3108,
        features: [
            'ห้องสูงสุด 150 ห้อง · 5 หอพัก',
            'ทุกอย่างของ Start',
            'อ่านมิเตอร์จากรูปถ่ายด้วย AI',
            'Multi-หอ (สลับจัดการหลายอาคาร)',
            'ข้อมูลผู้เช่าเต็มรูปแบบ (สัญญา / มัดจำ)',
            'Dashboard วิเคราะห์รายได้ & vacancy',
            'Export รายงาน PDF / Excel',
            '[soon] ทีมงานสูงสุด 3 คน (RBAC)',
            '[soon] รายงานภาษี / บัญชี',
        ],
    },
    {
        id: 'large', name: 'HorCare', icon: Building2, roomRange: 'ไม่จำกัดห้อง · 10 หอ',
        monthlyPrice: 399, yearlyPrice: 2990, originalYearlyPrice: 4788,
        features: [
            'ห้องไม่จำกัด · สูงสุด 10 หอพัก',
            'ผู้ช่วย AI ส่วนตัว "น้องแคร์"',
            'ตรวจสอบสลิปอัตโนมัติด้วย AI',
            'จดมิเตอร์ไฟ / น้ำ + ออกบิลอัตโนมัติ',
            'ส่งบิลและแจ้งเตือนผ่าน LINE อัตโนมัติ',
            'QR โอนเงินในบิล สลิปเข้าอัตโนมัติ',
            'อ่านมิเตอร์จากรูปถ่ายด้วย AI',
            'ติดต่อทีมงานแบบ real-time (LINE)',
            'ทีมงาน HorCare ดูแลเซ็ตอัพให้',
            '[soon] ทีมงานไม่จำกัด (RBAC)',
            '[soon] Dashboard เปรียบเทียบหลายหอ',
            'Priority Support ตลอด 24 ชม.',
        ],
    },
];

const LINE_URL = `https://line.me/R/oaMessage/${encodeURIComponent('@127qwwfi')}/?${encodeURIComponent('สนใจสมัครแพ็กเกจ HorCare')}`;
const baht = (n: number) => `฿${n.toLocaleString('th-TH')}`;
const cycleLabel = (c: BillingCycle) => (c === 'monthly' ? 'รายเดือน' : 'รายปี');

/** Yearly price against twelve months at the full yearly list price, rounded down so the claim is never overstated */
const yearlySavings = (plan: Plan) => Math.floor((1 - plan.yearlyPrice / plan.originalYearlyPrice) * 100);

function parseFeature(f: string): { label: string; kind: 'yes' | 'no' | 'soon' } {
    if (f.startsWith('[soon]')) return { label: f.slice(7), kind: 'soon' };
    if (f.startsWith('[no]')) return { label: f.slice(5), kind: 'no' };
    return { label: f, kind: 'yes' };
}

/* ----------- Plan card ----------- */
const PlanCard = memo(function PlanCard({ plan, cycle, isCurrent, isUpgrade, wide, onSelect }: {
    plan: Plan; cycle: BillingCycle; isCurrent?: boolean; isUpgrade?: boolean; wide?: boolean; onSelect: (p: Plan) => void;
}) {
    const price = cycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;
    const savings = yearlySavings(plan);
    const Icon = plan.icon;
    const cta = isCurrent ? `ต่ออายุ ${plan.name}` : isUpgrade ? `อัปเกรดเป็น ${plan.name}` : `สมัคร ${plan.name}`;

    return (
        <article className={`panel pp-card${wide ? ' pp-card-wide' : ''}`} aria-labelledby={`pp-name-${plan.id}`}>
            <div className="pp-buy">
                <div className="pp-plan-head">
                    <h2 id={`pp-name-${plan.id}`} className="pp-plan-name">
                        <Icon size={18} aria-hidden /> {plan.name}
                    </h2>
                    {isCurrent && <span className="badge badge-gray">แพ็กเกจปัจจุบัน</span>}
                </div>
                <p className="pp-plan-scope">{plan.roomRange}</p>

                <div className="pp-price" key={cycle}>
                    <span className="pp-price-value">{baht(price)}</span>
                    <span className="pp-price-per">/ {cycle === 'monthly' ? 'เดือน' : 'ปี'}</span>
                </div>
                <p className="pp-price-note">
                    {cycle === 'yearly' ? (
                        <>เฉลี่ย {baht(Math.round(plan.yearlyPrice / 12))} / เดือน · <s>{baht(plan.originalYearlyPrice)}</s> ประหยัด {savings}%</>
                    ) : (
                        <>หรือ {baht(plan.yearlyPrice)} / ปี ประหยัด {savings}%</>
                    )}
                </p>

                <button type="button" id={`pricing-btn-${plan.id}`} className="btn btn-primary pp-cta" onClick={() => onSelect(plan)}>
                    {cta} <Zap size={16} aria-hidden />
                </button>
                <p className="pp-pay-note"><CreditCard size={14} aria-hidden /> ชำระด้วย QR PromptPay หรือบัตร ผ่าน Stripe</p>
            </div>

            <ul className="pp-features" aria-label={`สิ่งที่ได้ในแพ็กเกจ ${plan.name}`}>
                {plan.features.map(f => {
                    const { label, kind } = parseFeature(f);
                    return (
                        <li key={f} className={`pp-feature pp-feature-${kind}`}>
                            {kind === 'yes' && <Check size={16} className="pp-feature-icon" aria-hidden />}
                            {kind === 'no' && <X size={16} className="pp-feature-icon" aria-label="ไม่รวม" />}
                            {kind === 'soon' && <Clock size={16} className="pp-feature-icon" aria-hidden />}
                            <span>{label}</span>
                            {kind === 'soon' && <span className="badge badge-gray">เร็วๆ นี้</span>}
                        </li>
                    );
                })}
            </ul>
        </article>
    );
});

/* ----------- Confirm before leaving for Stripe ----------- */
function ConfirmDialog({ plan, cycle, busy, onClose, onConfirm }: {
    plan: Plan; cycle: BillingCycle; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
    const price = cycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [busy, onClose]);

    return (
        <div className="modal-overlay" onClick={() => !busy && onClose()}>
            <div className="modal pp-dialog" role="dialog" aria-modal="true" aria-labelledby="pp-dialog-title" onClick={e => e.stopPropagation()}>
                <div className="modal-body">
                    <h2 id="pp-dialog-title" className="pp-dialog-title">ยืนยันการสมัคร</h2>
                    <dl className="pp-summary">
                        <div><dt>แพ็กเกจ</dt><dd>{plan.name} · {cycleLabel(cycle)}</dd></div>
                        <div><dt>ใช้งานได้</dt><dd>{cycle === 'monthly' ? '1 เดือน' : '1 ปี'} นับจากวันที่ชำระ</dd></div>
                        <div className="pp-summary-total"><dt>ยอดชำระ</dt><dd>{baht(price)}</dd></div>
                    </dl>
                    <p className="pp-dialog-note">
                        <ShieldCheck size={16} aria-hidden />
                        <span>ระบบจะเปิดหน้าชำระเงินของ Stripe ในแท็บใหม่ จ่ายด้วย QR PromptPay หรือบัตรได้ แพ็กเกจจะเปิดใช้ทันทีหลังชำระสำเร็จ</span>
                    </p>
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>ยกเลิก</button>
                    <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
                        {busy ? <Loader2 size={16} className="pp-spin" aria-hidden /> : <ShieldCheck size={16} aria-hidden />}
                        {busy ? 'กำลังเปิดหน้าชำระเงิน…' : 'ไปหน้าชำระเงิน'}
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ----------- Main PricingPage ----------- */
interface PricingPageProps {
    profile?: UserProfile | null;
    onBack?: () => void;
    /** ผู้ใช้ยังไม่ได้ล็อกอิน — แสดงแผนได้ แต่คลิกซื้อ → เรียก onNeedAuth แทน checkout */
    isGuest?: boolean;
    onNeedAuth?: (planId: string, cycle: BillingCycle) => void;
    /** Pre-select a plan from the guest flow after login */
    initialPlanId?: string;
    initialCycle?: BillingCycle;
    onSubscribed?: () => void;
}

export default function PricingPage({ profile, onBack, isGuest, onNeedAuth, initialPlanId, initialCycle }: PricingPageProps) {
    const [cycle, setCycle] = useState<BillingCycle>(initialCycle ?? 'monthly');
    const [selectedPlan, setSelectedPlan] = useState<Plan | null>(() =>
        initialPlanId ? PLANS.find(p => p.id === initialPlanId) ?? null : null
    );
    const [processing, setProcessing] = useState(false);

    const handlePlanSelect = (plan: Plan) => {
        if (isGuest) onNeedAuth?.(plan.id, cycle);
        else setSelectedPlan(plan);
    };

    const handleConfirmPayment = async () => {
        if (!selectedPlan) return;

        const checkoutTab = window.open('', '_blank');
        setProcessing(true);
        try {
            const { getAuth } = await import('firebase/auth');
            const app = (await import('../../firebase/config')).default;
            const token = await getAuth(app).currentUser?.getIdToken();
            if (!token) throw new Error('กรุณาเข้าสู่ระบบใหม่อีกครั้ง');

            const res = await fetch('/api/create-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ plan: selectedPlan.id, cycle }),
            });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${res.status}`);
            }
            const { data } = await res.json();
            if (!data?.url) throw new Error('ไม่ได้รับลิงก์หน้าชำระเงิน');

            if (checkoutTab) checkoutTab.location.href = data.url;
            else window.location.href = data.url;
            setSelectedPlan(null);
        } catch (err: unknown) {
            checkoutTab?.close();
            console.error('Checkout error:', err);
            toast.error(`เปิดหน้าชำระเงินไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setProcessing(false);
        }
    };

    const currentPlanId = profile && profile.license !== 'free' ? profile.plan_name : undefined;
    const currentPlan = PLANS.find(p => p.id === currentPlanId);
    const largePlan = PLANS.find(p => p.id === 'large')!;
    // Owners on a smaller plan see it to renew beside the HorCare upgrade; everyone else sees HorCare alone
    const cards = currentPlan && currentPlan.id !== 'large' ? [currentPlan, largePlan] : [largePlan];
    const periodEnd = profile?.current_period_end
        ? new Date(profile.current_period_end).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
        : null;

    return (
        <div className="pricing-page">
            <div className="pricing-inner">
                {onBack && (
                    <button type="button" className="btn btn-ghost btn-sm pp-back" onClick={onBack}>
                        <ChevronLeft size={16} /> ย้อนกลับ
                    </button>
                )}

                <header className="pp-head">
                    <h1 className="page-title">{currentPlan ? 'จัดการแพ็กเกจ' : 'แพ็กเกจ HorCare'}</h1>
                    <p className="page-subtitle">
                        {currentPlan
                            ? <>ตอนนี้ใช้ <strong>{currentPlan.name}</strong>{profile?.license === 'active' ? ' แบบตลอดชีพ' : periodEnd ? ` · ใช้ได้ถึง ${periodEnd}` : ''}</>
                            : 'จดมิเตอร์ ออกบิล ส่ง LINE และตรวจสลิป ครบในที่เดียว'}
                    </p>
                </header>

                <div className="seg pp-cycle" role="group" aria-label="รอบการชำระ">
                    {(['monthly', 'yearly'] as BillingCycle[]).map(c => (
                        <button
                            key={c}
                            type="button"
                            id={`billing-toggle-${c}`}
                            className={`seg-item${cycle === c ? ' active' : ''}`}
                            onClick={() => setCycle(c)}
                            aria-pressed={cycle === c}
                        >
                            {cycleLabel(c)}
                            {c === 'yearly' && <span className="pp-cycle-save">ประหยัด {yearlySavings(largePlan)}%</span>}
                        </button>
                    ))}
                </div>

                <div className={`pp-cards${cards.length > 1 ? ' pp-cards-2' : ''}`}>
                    {cards.map(p => (
                        <PlanCard
                            key={p.id}
                            plan={p}
                            cycle={cycle}
                            wide={cards.length === 1}
                            isCurrent={p.id === currentPlanId}
                            isUpgrade={!!currentPlan && p.id !== currentPlanId}
                            onSelect={handlePlanSelect}
                        />
                    ))}
                </div>

                <ul className="pp-trust">
                    <li><ShieldCheck size={16} aria-hidden /> ชำระเงินผ่าน Stripe ปลอดภัย</li>
                    <li><Zap size={16} aria-hidden /> เปิดใช้ทันทีหลังชำระ</li>
                    <li>
                        <MessageCircle size={16} aria-hidden />
                        <span>มีคำถาม? <a href={LINE_URL} target="_blank" rel="noopener noreferrer">คุยกับทีมงานทาง LINE</a></span>
                    </li>
                </ul>
            </div>

            {selectedPlan && (
                <ConfirmDialog
                    plan={selectedPlan}
                    cycle={cycle}
                    busy={processing}
                    onClose={() => setSelectedPlan(null)}
                    onConfirm={handleConfirmPayment}
                />
            )}
        </div>
    );
}
