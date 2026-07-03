import { useState, useEffect, memo } from 'react';
import {
    Check, Zap, Sparkles, Shield, Clock, CreditCard, X,
    ChevronLeft, Infinity as InfinityIcon,
    Home, Building, Building2, Package, PartyPopper, QrCode,
} from 'lucide-react';
import type { UserProfile, PlanName, BillingCycle } from '../../types';

/* ------------------------------------------
   CSS is injected once into <head>, avoids
   repeated style tag renders and enables
   GPU-composited CSS transitions (no JS hover).
------------------------------------------ */
const CSS = `
/* -- Animations (GPU-only: transform + opacity) -- */
@keyframes p-float {
  0%,100% { transform: translateY(0); }
  50%      { transform: translateY(-20px); }
}
@keyframes p-slide-up {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes p-scale-in {
  from { opacity: 0; transform: translate(-50%,-50%) scale(0.9); }
  to   { opacity: 1; transform: translate(-50%,-50%) scale(1); }
}
@keyframes p-spin {
  to { transform: rotate(360deg); }
}
@keyframes p-pop {
  0%  { opacity: 0; transform: scale(0.82); }
  65% { transform: scale(1.06); }
  100%{ opacity: 1; transform: scale(1); }
}
@keyframes p-shimmer {
  0%   { background-position: -300% center; }
  100% { background-position:  300% center; }
}
@keyframes p-check {
  0%  { transform: scale(0) rotate(-45deg); opacity: 0; }
  70% { transform: scale(1.12) rotate(0); }
  100%{ transform: scale(1) rotate(0); opacity: 1; }
}

/* -- Pricing page wrapper -- */
.pricing-page {
  min-height: 100vh;
  margin: 0;
  padding: 2.5rem 2rem 4rem;
  background: linear-gradient(160deg, #0d0820 0%, #0a0a18 50%, #060414 100%);
  position: relative;
  overflow: hidden;
}

/* -- Grid bg -- */
.pricing-grid-bg {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px);
  background-size: 52px 52px;
}

/* -- Ambient orb -- */
.pricing-orb {
  position: absolute; border-radius: 50%; pointer-events: none;
  will-change: transform;
}

/* -- Content inner -- */
.pricing-inner {
  max-width: 1120px; margin: 0 auto; position: relative; z-index: 1;
}

/* -- Slide-up stagger for sections -- */
.p-anim-0 { animation: p-slide-up 0.45s ease both; }
.p-anim-1 { animation: p-slide-up 0.45s ease 0.09s both; }
.p-anim-2 { animation: p-slide-up 0.45s ease 0.18s both; }
.p-anim-3 { animation: p-slide-up 0.45s ease 0.48s both; }

/* -- Static section: wrapper for cards — no animation to prevent re-flash on cycle toggle -- */
.pricing-section { opacity: 1; }

/* -- Card grid, equal height -- */
.pricing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
  align-items: stretch;   /* ← equal height */
}

/* -- Plan card -- */
.plan-card {
  position: relative;
  border-radius: 24px;
  padding: 2rem 1.75rem;
  display: flex; flex-direction: column;
  border: 1px solid rgba(255,255,255,0.09);
  background: rgba(255,255,255,0.032);
  /* Only composite properties transition */
  transition: transform 0.28s cubic-bezier(0.16,1,0.3,1),
              box-shadow 0.28s ease,
              border-color 0.28s ease;
  will-change: transform;
  overflow: hidden;
}
.plan-card:hover {
  transform: translateY(-4px);
}
.plan-card.popular {
  background: linear-gradient(160deg, #1a1040 0%, #0f0a24 100%);
}

/* Glow ring for popular */
.plan-card.popular::before {
  content: '';
  position: absolute; inset: -2px; border-radius: 26px; z-index: -1;
  background: linear-gradient(135deg, #8B5CF6, #EC4899);
  animation: p-float 3s ease-in-out infinite alternate;
  will-change: transform;
  opacity: 0.75;
}

/* -- CTA button inside card, CSS hover only -- */
.plan-cta {
  width: 100%; padding: 0.9rem; border-radius: 14px; border: none;
  font-weight: 700; font-size: 0.9375rem; cursor: pointer; letter-spacing: -0.01em;
  display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  color: #fff;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.13);
  transition: background 0.22s ease, box-shadow 0.22s ease, transform 0.15s ease;
  will-change: transform;
}
.plan-cta:hover { transform: translateY(-1px); }
.plan-cta:active { transform: translateY(0); }
.plan-cta.small  { --glow: rgba(99,102,241,0.45); }
.plan-cta.medium { --glow: rgba(139,92,246,0.45); }
.plan-cta.large  { --glow: rgba(245,158,11,0.45); }

.plan-card:hover .plan-cta.small  { background: linear-gradient(135deg,#3B82F6,#6366F1); border-color: transparent; box-shadow: 0 6px 20px var(--glow); }
.plan-card:hover .plan-cta.medium { background: linear-gradient(135deg,#8B5CF6,#EC4899); border-color: transparent; box-shadow: 0 6px 20px var(--glow); }
.plan-card:hover .plan-cta.large  { background: linear-gradient(135deg,#F59E0B,#EF4444); border-color: transparent; box-shadow: 0 6px 20px var(--glow); }

/* -- Card hover shadows -- */
.plan-card.small:hover  { box-shadow: 0 24px 60px rgba(99,102,241,0.3),  0 4px 16px rgba(0,0,0,0.4); border-color: rgba(99,102,241,0.45); }
.plan-card.medium:hover { box-shadow: 0 24px 60px rgba(139,92,246,0.35), 0 4px 16px rgba(0,0,0,0.4); border-color: rgba(236,72,153,0.5); }
.plan-card.large:hover  { box-shadow: 0 24px 60px rgba(245,158,11,0.3),  0 4px 16px rgba(0,0,0,0.4); border-color: rgba(239,68,68,0.45); }

/* -- Price text -- */
.price-number {
  font-size: 3.25rem; font-weight: 900; line-height: 1;
  letter-spacing: -0.04em; font-family: var(--font-mono);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
  will-change: contents;
}
.price-number.small  { background-image: linear-gradient(135deg,#3B82F6,#6366F1); }
.price-number.medium { background-image: linear-gradient(135deg,#8B5CF6,#EC4899); }
.price-number.large  { background-image: linear-gradient(135deg,#F59E0B,#EF4444); }

/* -- Price pop on key change -- */
.price-pop { animation: p-pop 0.32s cubic-bezier(0.16,1,0.3,1) both; }

/* -- Feature check icon -- */
.feat-check {
  width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; margin-top: 0.06rem;
  display: flex; align-items: center; justify-content: center;
}
.feat-check.small  { background: linear-gradient(135deg,#3B82F6,#6366F1); box-shadow: 0 2px 8px rgba(99,102,241,0.35); }
.feat-check.medium { background: linear-gradient(135deg,#8B5CF6,#EC4899); box-shadow: 0 2px 8px rgba(139,92,246,0.35); }
.feat-check.large  { background: linear-gradient(135deg,#F59E0B,#EF4444); box-shadow: 0 2px 8px rgba(245,158,11,0.35); }

/* -- Popular shimmer badge -- */
.popular-badge {
  position: absolute; top: -1px; left: 50%; transform: translateX(-50%);
  color: #fff; border-radius: 0 0 14px 14px; padding: 0.35rem 1.25rem;
  font-size: 0.72rem; font-weight: 800; letter-spacing: 0.06em;
  text-transform: uppercase; white-space: nowrap;
  display: flex; align-items: center; gap: 0.35rem;
  background: linear-gradient(90deg,#8B5CF6 0%,#EC4899 25%,#fff 50%,#EC4899 75%,#8B5CF6 100%);
  background-size: 300% auto;
  animation: p-shimmer 3s linear infinite;
  box-shadow: 0 4px 16px rgba(139,92,246,0.5);
  will-change: background-position;
}

/* -- Billing toggle -- */
.billing-toggle {
  display: inline-flex;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 16px; padding: 4px; gap: 4px;
}
.billing-btn {
  padding: 0.625rem 1.5rem; border-radius: 12px; border: none;
  font-weight: 700; font-size: 0.9375rem; cursor: pointer;
  color: rgba(255,255,255,0.4); background: transparent;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
  display: flex; align-items: center; gap: 0.5rem;
}
.billing-btn.active {
  background: linear-gradient(135deg,#8B5CF6,#6366F1);
  color: #fff; box-shadow: 0 4px 16px rgba(139,92,246,0.35);
}

/* -- Back button -- */
.pricing-back {
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09);
  border-radius: 10px; color: rgba(255,255,255,0.5);
  cursor: pointer; display: inline-flex; align-items: center; gap: 0.375rem;
  font-size: 0.875rem; padding: 0.5rem 1rem; margin-bottom: 2rem;
  transition: color 0.18s ease, background 0.18s ease;
}
.pricing-back:hover { color: #fff; background: rgba(255,255,255,0.08); }

/* -- Modal -- */
.pricing-modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.75);
  z-index: 300; backdrop-filter: blur(6px);
}
.pricing-modal {
  position: fixed; top: 50%; left: 50%; z-index: 301;
  background: linear-gradient(160deg,#1a1040 0%,#0c0a1e 100%);
  border-radius: 24px; padding: 2rem; width: min(420px,92vw);
  box-shadow: 0 32px 80px rgba(0,0,0,0.6);
  animation: p-scale-in 0.22s cubic-bezier(0.16,1,0.3,1) both;
}
.modal-close {
  position: absolute; top: 1rem; right: 1rem;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px; padding: 0.375rem; cursor: pointer; display: flex; color: rgba(255,255,255,0.5);
  transition: color 0.15s, background 0.15s;
}
.modal-close:hover { color: #fff; background: rgba(255,255,255,0.1); }
.modal-cancel {
  flex: 1; padding: 0.8rem; border-radius: 12px; cursor: pointer;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.55); font-weight: 600; font-size: 0.9rem;
  transition: background 0.18s, color 0.18s;
}
.modal-cancel:hover { background: rgba(255,255,255,0.09); color: #fff; }
.modal-confirm {
  flex: 2; padding: 0.8rem; border-radius: 12px; border: none;
  color: #fff; font-weight: 700; font-size: 0.9rem; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  transition: opacity 0.18s, transform 0.18s;
  will-change: transform;
}
.modal-confirm:hover { opacity: 0.88; transform: translateY(-1px); }

/* -- Processing spinner -- */
.pricing-spinner {
  width: 48px; height: 48px;
  border: 3px solid rgba(139,92,246,0.2);
  border-top-color: #8B5CF6; border-radius: 50%;
  animation: p-spin 0.7s linear infinite;
  will-change: transform;
}

/* -- Success check -- */
.success-check {
  width: 96px; height: 96px; border-radius: 50%;
  background: linear-gradient(135deg,#10B981,#059669);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 1.75rem;
  box-shadow: 0 12px 40px rgba(16,185,129,0.45);
  animation: p-check 0.55s cubic-bezier(0.16,1,0.3,1) both;
  will-change: transform;
}

/* -- Responsive: tighter internal padding on smaller screens
      (full-bleed handled by .main-content:has(.pricing-page) in index.css) -- */
@media (max-width: 768px) {
  .pricing-page { padding: 1.75rem 1rem 3rem; }
}
@media (max-width: 359px) {
  .pricing-page { padding: 1.5rem 0.75rem 2.5rem; }
}
`;

/* ----------- Inject CSS once ----------- */
let cssInjected = false;
function injectCSS() {
    if (cssInjected || typeof document === 'undefined') return;
    const el = document.createElement('style');
    el.id = 'horcare-pricing-css';
    el.textContent = CSS;
    document.head.appendChild(el);
    cssInjected = true;
}

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
    gradient: string;
    glowColor: string;
    popular?: boolean;
}

const PLANS: Plan[] = [
    {
        id: 'small', name: 'Start', icon: Home, roomRange: 'สูงสุด 50 ห้อง · 1 หอ',
        monthlyPrice: 79, yearlyPrice: 790, originalYearlyPrice: 948,
        gradient: 'linear-gradient(135deg,#3B82F6,#6366F1)',
        glowColor: 'rgba(99,102,241,0.45)',
        features: [
            'ห้องสูงสุด 50 ห้อง · 1 หอพัก',
            'จดมิเตอร์ไฟ / น้ำ + ออกบิลอัตโนมัติ',
            'ส่งบิลผ่าน LINE อัตโนมัติ',
            'QR PromptPay ในบิล',
            'หน้าแจ้งซ่อม (Maintenance board)',
            'ระบบจัดการ (สต็อก / ทรัพย์สิน / ค่าใช้จ่าย)',
            'หน้าจัดการการชำระเงิน',
            'Export PDF / สรุปยอดรายเดือน',
            '❌ Multi-หอ',
            '❌ ข้อมูลผู้เช่าเต็มรูปแบบ',
        ],
    },
    {
        id: 'medium', name: 'Plus', icon: Building, roomRange: 'สูงสุด 150 ห้อง · 5 หอ',
        monthlyPrice: 199, yearlyPrice: 1990, originalYearlyPrice: 2388,
        gradient: 'linear-gradient(135deg,#8B5CF6,#EC4899)',
        glowColor: 'rgba(139,92,246,0.45)',
        popular: true,
        features: [
            'ห้องสูงสุด 150 ห้อง · 5 หอพัก',
            'ทุกอย่างของ Start',
            'Multi-หอ (สลับจัดการหลายอาคาร)',
            'ข้อมูลผู้เช่าเต็มรูปแบบ (สัญญา / มัดจำ)',
            'Dashboard วิเคราะห์รายได้ & vacancy',
            'Export รายงาน PDF / Excel',
            '[soon] ทีมงานสูงสุด 3 คน (RBAC)',
            '[soon] รายงานภาษี / บัญชี',
        ],
    },
    {
        id: 'large', name: 'Pro', icon: Building2, roomRange: 'ไม่จำกัดห้อง · 10 หอ',
        monthlyPrice: 399, yearlyPrice: 3990, originalYearlyPrice: 4788,
        gradient: 'linear-gradient(135deg,#F59E0B,#EF4444)',
        glowColor: 'rgba(245,158,11,0.45)',
        features: [
            'ห้องไม่จำกัด · สูงสุด 10 หอพัก',
            'ทุกอย่างของ Plus',
            'ติดต่อทีมงานแบบ real-time (LINE)',
            'ทีมงาน HorCare ดูแลเซ็ตอัพให้',
            '[soon] Job board — ผู้จัดการหอรับงานเสริม',
            '[soon] ทีมงานไม่จำกัด (RBAC)',
            '[soon] Dashboard เปรียบเทียบหลายหอ',
            'Priority Support ตลอด 24 ชม.',
        ],
    },
];

/* ----------- PlanCard (memo = skip re-render unless props change) ----------- */
const PlanCard = memo(function PlanCard({
    plan, cycle, currentPlanId, onSelect,
}: { plan: Plan; cycle: BillingCycle; currentPlanId?: string; onSelect: (p: Plan) => void }) {
    const [priceKey, setPriceKey] = useState(0);
    const price = cycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;
    const savings = cycle === 'yearly'
        ? Math.round((1 - plan.yearlyPrice / plan.originalYearlyPrice) * 100)
        : 0;

    useEffect(() => { setPriceKey(k => k + 1); }, [cycle]);

    return (
        <div className={`plan-card ${plan.id}${plan.popular ? ' popular' : ''}`}>
            {plan.popular && (
                <div className="popular-badge">
                    <Sparkles size={10} fill="currentColor" />
                    ยอดนิยม
                </div>
            )}

            {/* Icon + name */}
            <div style={{ marginBottom: '1rem', marginTop: plan.popular ? '0.75rem' : 0 }}>
                <div style={{
                    width: 52, height: 52, borderRadius: '16px',
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.11)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: '1rem',
                }}>
                    <plan.icon size={26} color="rgba(255,255,255,0.85)" />
                </div>
                <div style={{ fontWeight: 800, fontSize: '1.25rem', color: '#fff', letterSpacing: '-0.02em' }}>
                    {plan.name}
                </div>
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    marginTop: '0.35rem', background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.09)',
                    borderRadius: '999px', padding: '0.2rem 0.7rem',
                    fontSize: '0.76rem', color: 'rgba(255,255,255,0.55)',
                }}>
                    <Package size={11} /> {plan.roomRange}
                </div>
            </div>

            {/* Price */}
            <div style={{ marginBottom: '1.5rem' }}>
                <div key={priceKey} className="price-pop" style={{
                    display: 'flex', alignItems: 'flex-end', gap: '0.2rem',
                }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'rgba(255,255,255,0.45)', paddingBottom: '0.6rem' }}>฿</span>
                    <span className={`price-number ${plan.id}`}>{price.toLocaleString()}</span>
                    <span style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.35)', paddingBottom: '0.5rem' }}>
                        {cycle === 'monthly' ? '/เดือน' : '/ปี'}
                    </span>
                </div>
                {cycle === 'yearly' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.45rem', flexWrap: 'wrap' }}>
                        <span style={{ textDecoration: 'line-through', color: 'rgba(255,255,255,0.22)', fontSize: '0.875rem' }}>
                            ฿{plan.originalYearlyPrice.toLocaleString()}
                        </span>
                        <span style={{
                            background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.32)',
                            color: '#34D399', borderRadius: '999px', padding: '0.15rem 0.6rem',
                            fontSize: '0.72rem', fontWeight: 800,
                        }}>ประหยัด {savings}%</span>
                    </div>
                ) : (
                    <div style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.3)', marginTop: '0.35rem' }}>
                        หรือ ฿{plan.yearlyPrice.toLocaleString()}/ปี (ประหยัดกว่า)
                    </div>
                )}
            </div>

            {/* Divider */}
            <div style={{
                height: 1,
                background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent)',
                marginBottom: '1.25rem',
            }} />

            {/* Features, flex:1 makes all cards same height */}
            <ul style={{
                listStyle: 'none', padding: 0, margin: '0 0 1.75rem',
                flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6rem',
            }}>
                {plan.features.map(f => {
                    const coming = f.startsWith('[soon]');
                    const unavailable = !coming && f.startsWith('❌');
                    const label = coming ? f.slice(7) : (unavailable ? f.slice(2) : f);
                    return (
                        <li key={f} style={{
                            display: 'flex', alignItems: 'flex-start',
                            gap: '0.6rem', fontSize: '0.86rem',
                            color: (unavailable || coming) ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.72)',
                        }}>
                            {coming ? (
                                <div style={{
                                    background: 'rgba(245,158,11,0.12)',
                                    border: '1px solid rgba(245,158,11,0.25)',
                                    borderRadius: '50%', width: 18, height: 18,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                }}>
                                    <Clock size={9} color="rgba(245,158,11,0.7)" strokeWidth={2.5} />
                                </div>
                            ) : unavailable ? (
                                <div className="feat-check unavailable" style={{
                                    background: 'rgba(255,255,255,0.08)',
                                    borderRadius: '50%', width: 18, height: 18,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                }}>
                                    <X size={10} color="rgba(255,255,255,0.4)" strokeWidth={3} />
                                </div>
                            ) : (
                                <div className={`feat-check ${plan.id}`}>
                                    <Check size={10} color="#fff" strokeWidth={3} />
                                </div>
                            )}
                            <span>
                                {label}
                                {coming && (
                                    <span style={{
                                        marginLeft: '0.35rem', fontSize: '0.62rem', fontWeight: 800,
                                        background: 'rgba(245,158,11,0.13)',
                                        border: '1px solid rgba(245,158,11,0.28)',
                                        color: 'rgba(245,158,11,0.75)', borderRadius: '999px',
                                        padding: '0.06rem 0.4rem', verticalAlign: 'middle',
                                        letterSpacing: '0.02em',
                                    }}>เร็วๆ นี้</span>
                                )}
                            </span>
                        </li>
                    );
                })}
            </ul>

            {/* CTA, purely CSS hover, no JS state */}
            <button
                id={`pricing-btn-${plan.id}`}
                className={`plan-cta ${plan.id}`}
                onClick={() => onSelect(plan)}
            >
                {currentPlanId === plan.id 
                    ? 'ต่ออายุแพ็กเกจ' 
                    : (currentPlanId 
                        ? (plan.monthlyPrice > (PLANS.find(p => p.id === currentPlanId)?.monthlyPrice ?? 0) ? 'อัปเกรดเป็นแผนนี้' : 'เปลี่ยนเป็นแผนนี้') 
                        : 'เลือกแผนนี้'
                    )}
                <Zap size={15} />
            </button>
        </div>
    );
});

/* ----------- Demo Modal ----------- */
const DemoModal = memo(function DemoModal({ plan, cycle, onClose, onConfirm }: {
    plan: Plan; cycle: BillingCycle; onClose: () => void; onConfirm: () => void;
}) {
    const price = cycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;

    return (
        <>
            <div className="pricing-modal-backdrop" onClick={onClose} />
            <div className="pricing-modal" style={{ border: `1px solid ${plan.glowColor}` }}>
                <button className="modal-close" onClick={onClose}><X size={16} /></button>

                <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'center' }}>
                        <plan.icon size={40} color="rgba(255,255,255,0.8)" />
                    </div>
                    <h2 style={{ fontWeight: 800, fontSize: '1.3rem', color: '#fff', marginBottom: '0.375rem', letterSpacing: '-0.025em' }}>
                        {plan.name} ({cycle === 'monthly' ? 'รายเดือน' : 'รายปี'})
                    </h2>
                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '0.25rem', marginTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.4)', paddingBottom: '0.5rem' }}>฿</span>
                        <span className={`price-number ${plan.id}`} style={{ fontSize: '2.5rem' }}>
                            {price.toLocaleString()}
                        </span>
                        <span style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.35)', paddingBottom: '0.4rem' }}>
                            {cycle === 'monthly' ? '/เดือน' : '/ปี'}
                        </span>
                    </div>
                </div>

                <div style={{
                    background: 'rgba(139,92,246,0.09)', border: '1px solid rgba(139,92,246,0.22)',
                    borderRadius: '14px', padding: '1rem', marginBottom: '1.5rem',
                    display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
                }}>
                    <QrCode size={16} color="#A78BFA" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                    <div>
                        <div style={{ fontWeight: 700, color: '#C4B5FD', fontSize: '0.8rem', marginBottom: '0.2rem' }}>ชำระด้วย QR PromptPay</div>
                        <div style={{ fontSize: '0.775rem', color: 'rgba(196,181,253,0.7)', lineHeight: 1.55 }}>
                            กด "ยืนยัน" เพื่อไปหน้าชำระเงินที่ปลอดภัยของ Stripe<br />
                            แล้วสแกน QR ด้วยแอปธนาคารได้เลย
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button className="modal-cancel" onClick={onClose}>ยกเลิก</button>
                    <button
                        className="modal-confirm"
                        onClick={onConfirm}
                        style={{ background: plan.gradient, boxShadow: `0 6px 24px ${plan.glowColor}` }}
                    >
                        <Shield size={15} /> ยืนยันชำระเงิน
                    </button>
                </div>
            </div>
        </>
    );
});


/* ----------- Success Screen ----------- */
function SuccessScreen({ plan, cycle, onBack }: { plan: Plan; cycle: BillingCycle; onBack?: () => void }) {
    return (
        <div className="p-anim-0" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: '65vh', textAlign: 'center', padding: '2rem',
        }}>
            <div className="success-check">
                <Check size={44} color="#fff" strokeWidth={2.5} />
            </div>
            <h2 style={{
                fontWeight: 900, fontSize: '2rem', letterSpacing: '-0.03em',
                color: '#34D399',
                marginBottom: '0.625rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}>
                <PartyPopper size={28} color="#10B981" />
                ชำระเงินสำเร็จ!
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.55)', maxWidth: 340, lineHeight: 1.7, marginBottom: '0.375rem' }}>
                อัปเกรดเป็นแผน <strong style={{ color: '#fff' }}>{plan.name}</strong>{' '}
                ({cycle === 'monthly' ? 'รายเดือน' : 'รายปี'}) เรียบร้อยแล้ว
            </p>
            <p style={{ color: 'rgba(255,255,255,0.28)', fontSize: '0.8rem', marginBottom: '2rem' }}>
                ขอบคุณที่อุดหนุน HorCare 💜
            </p>
            <button onClick={onBack} style={{
                background: 'linear-gradient(135deg,#10B981,#059669)',
                color: '#fff', border: 'none', borderRadius: '14px',
                padding: '0.9rem 2.25rem', fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
                letterSpacing: '-0.01em', boxShadow: '0 8px 28px rgba(16,185,129,0.4)',
                display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}>
                <Zap size={17} fill="currentColor" /> เริ่มใช้งานเลย
            </button>
        </div>
    );
}

/* ----------- Main PricingPage ----------- */
interface PricingPageProps {
    profile?: UserProfile | null;
    onSubscribed?: (planId: PlanName, cycle: BillingCycle) => void;
    onBack?: () => void;
    /** ผู้ใช้ยังไม่ได้ล็อกอิน — แสดงแผนได้ แต่คลิกซื้อ → เรียก onNeedAuth แทน checkout */
    isGuest?: boolean;
    onNeedAuth?: (planId: string, cycle: BillingCycle) => void;
    /** Pre-select a plan from the guest flow after login */
    initialPlanId?: string;
    initialCycle?: BillingCycle;
}

export default function PricingPage({ profile, onBack, isGuest, onNeedAuth, initialPlanId, initialCycle }: Omit<PricingPageProps, 'onSubscribed'> & { onSubscribed?: () => void }) {
    injectCSS(); // idempotent

    const [cycle, setCycle] = useState<BillingCycle>(initialCycle ?? 'monthly');
    const [selectedPlan, setSelectedPlan] = useState<Plan | null>(() =>
        initialPlanId ? PLANS.find(p => p.id === initialPlanId) ?? null : null
    );
    const [processing, setProcessing] = useState(false);
    const [successPlan] = useState<Plan | null>(null);

    // เมื่อ guest เลือกแผน → ข้าม modal ไปเรียก onNeedAuth ทันที
    const handlePlanSelect = (plan: Plan) => {
        if (isGuest) {
            onNeedAuth?.(plan.id, cycle);
        } else {
            setSelectedPlan(plan);
        }
    };

    const handleConfirmPayment = async () => {
        if (!selectedPlan) return;

        // Open a blank tab synchronously (inside the click gesture) so the
        // browser's popup blocker doesn't block it after the async fetch.
        // We redirect this tab to Stripe once the session URL is ready.
        const checkoutTab = window.open('', '_blank');

        setProcessing(true);
        try {
            const { getAuth } = await import('firebase/auth');
            const app = (await import('../../firebase/config')).default;
            const auth = getAuth(app);
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error('Not authenticated');

            const res = await fetch('/api/create-checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ plan: selectedPlan.id, cycle })
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to create checkout session');
            }

            const { data } = await res.json();
            if (!data?.url) throw new Error('No checkout URL returned');

            if (checkoutTab) {
                checkoutTab.location.href = data.url;
            } else {
                window.location.href = data.url;
            }
            setSelectedPlan(null);
        } catch (err: any) {
            if (checkoutTab) checkoutTab.close();
            console.error('Checkout error:', err);
            alert(`เกิดข้อผิดพลาด: ${err.message}`);
            setSelectedPlan(null);
        } finally {
            setProcessing(false);
        }
    };

    const currentPlanId = profile && profile.license !== 'free' ? profile.plan_name : undefined;
    const currentPlan = PLANS.find(p => p.id === currentPlanId);
    const otherPlans = PLANS.filter(p => p.id !== currentPlanId);

    return (
        <div className="pricing-page">
            {/* Static background layers (no JS, no state) */}
            <div className="pricing-grid-bg" />
            <div className="pricing-orb" style={{
                width: 560, height: 560, top: -180, left: -80,
                background: 'radial-gradient(circle,rgba(139,92,246,0.13) 0%,transparent 65%)',
                animation: 'p-float 11s ease-in-out infinite',
            }} />
            <div className="pricing-orb" style={{
                width: 460, height: 460, top: '32%', right: -100,
                background: 'radial-gradient(circle,rgba(236,72,153,0.10) 0%,transparent 65%)',
                animation: 'p-float 9s ease-in-out 2s infinite',
            }} />
            <div className="pricing-orb" style={{
                width: 380, height: 380, bottom: -60, left: '42%',
                background: 'radial-gradient(circle,rgba(59,130,246,0.09) 0%,transparent 65%)',
                animation: 'p-float 13s ease-in-out 5s infinite',
            }} />

            <div className="pricing-inner">
                {onBack && (
                    <button className="pricing-back" onClick={onBack}>
                        <ChevronLeft size={16} /> กลับ
                    </button>
                )}

                {successPlan ? (
                    <SuccessScreen plan={successPlan} cycle={cycle} onBack={onBack} />
                ) : (
                    <>
                        {/* Header */}
                        <div className="p-anim-0" style={{ textAlign: 'center', marginBottom: '3rem' }}>
                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                background: 'rgba(139,92,246,0.13)', border: '1px solid rgba(139,92,246,0.28)',
                                borderRadius: '999px', padding: '0.4rem 1.1rem', marginBottom: '1.25rem',
                            }}>
                                <Sparkles size={13} color="#A78BFA" />
                                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#A78BFA', letterSpacing: '0.04em' }}>
                                    {currentPlanId ? 'ต่ออายุหรือเปลี่ยนแพ็กเกจ' : 'เลือกแผนที่ใช่สำหรับคุณ'}
                                </span>
                            </div>

                            <h1 style={{
                                fontSize: 'clamp(2rem, 6vw, 3.25rem)', fontWeight: 900,
                                color: '#fff', letterSpacing: '-0.04em', lineHeight: 1.1, marginBottom: '1rem',
                            }}>
                                {currentPlanId ? 'จัดการแพ็กเกจ ' : 'แพ็กเกจ '}
                                <span style={{
                                    background: 'linear-gradient(135deg,#A78BFA 0%,#EC4899 50%,#F59E0B 100%)',
                                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                                }}>HorCare</span>
                            </h1>
                            <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: '1.0625rem', maxWidth: 480, margin: '0 auto', lineHeight: 1.65 }}>
                                {currentPlanId ? 'ต่ออายุแพ็กเกจปัจจุบันของคุณ หรืออัปเกรดเพื่อรับฟีเจอร์ที่มากขึ้น' : 'เริ่มต้นฟรี — อัปเกรดรับ LINE ส่งบิลอัตโนมัติและฟีเจอร์ครบครัน'}
                            </p>
                            {currentPlanId && currentPlan && (
                                <div style={{
                                    marginTop: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                    background: 'rgba(16,185,129,0.11)', border: '1px solid rgba(16,185,129,0.24)',
                                    borderRadius: '999px', padding: '0.375rem 1rem',
                                    fontSize: '0.8rem', color: '#34D399', fontWeight: 600,
                                }}>
                                    <InfinityIcon size={13} />
                                    แผนปัจจุบัน: {currentPlan.name}
                                </div>
                            )}
                        </div>

                        {/* Billing toggle */}
                        <div className="p-anim-1" style={{ display: 'flex', justifyContent: 'center', marginBottom: '3rem' }}>
                            <div className="billing-toggle">
                                {(['monthly', 'yearly'] as BillingCycle[]).map(c => (
                                    <button
                                        key={c}
                                        id={`billing-toggle-${c}`}
                                        className={`billing-btn${cycle === c ? ' active' : ''}`}
                                        onClick={() => setCycle(c)}
                                    >
                                        {c === 'monthly' ? 'รายเดือน' : 'รายปี'}
                                        {c === 'yearly' && (
                                            <span style={{
                                                background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.3)',
                                                color: '#34D399', borderRadius: '999px',
                                                padding: '0.1rem 0.55rem', fontSize: '0.68rem', fontWeight: 800,
                                            }}>ประหยัด 49%</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Free tier banner */}
                        {!currentPlanId && (
                            <div className="p-anim-2" style={{ marginBottom: '2rem' }}>
                                <div style={{
                                    border: '1px solid rgba(16,185,129,0.25)',
                                    borderRadius: '16px',
                                    padding: '1.1rem 1.5rem',
                                    background: 'rgba(16,185,129,0.05)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    flexWrap: 'wrap',
                                    gap: '1rem',
                                }}>
                                    <div>
                                        <div style={{ color: '#34D399', fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem' }}>
                                            ฟรี — ไม่มีค่าใช้จ่าย
                                        </div>
                                        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' }}>
                                            จดมิเตอร์ · ออกบิล · ดาวน์โหลด PDF · Dashboard · ข้อมูลบน Cloud
                                        </div>
                                    </div>
                                    {profile?.license === 'free' ? (
                                        <div style={{
                                            background: 'rgba(16,185,129,0.15)',
                                            border: '1px solid rgba(16,185,129,0.3)',
                                            color: '#34D399', borderRadius: '999px',
                                            padding: '0.375rem 1rem', fontSize: '0.8rem', fontWeight: 700,
                                        }}>
                                            แผนของคุณ
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => isGuest ? onNeedAuth?.('free', cycle) : onBack?.()}
                                            style={{
                                                background: 'rgba(16,185,129,0.08)',
                                                border: '1px solid rgba(16,185,129,0.22)',
                                                color: '#34D399', borderRadius: '12px',
                                                padding: '0.6rem 1.25rem', fontSize: '0.875rem', fontWeight: 600,
                                                cursor: 'pointer', whiteSpace: 'nowrap',
                                            }}
                                        >
                                            เริ่มใช้งานฟรี →
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Cards grid, align-items:stretch = equal height */}
                        {currentPlanId && currentPlan ? (
                            <>
                                <div className="pricing-section" style={{ marginBottom: '3rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <h3 style={{ color: 'rgba(255,255,255,0.9)', fontSize: '1.1rem', marginBottom: '1.25rem', fontWeight: 700, letterSpacing: '0.02em' }}>
                                        แพ็กเกจปัจจุบันของคุณ
                                    </h3>
                                    <div style={{ maxWidth: '400px', width: '100%' }}>
                                        <PlanCard
                                            key={currentPlan.id}
                                            plan={currentPlan}
                                            cycle={cycle}
                                            currentPlanId={currentPlanId}
                                            onSelect={handlePlanSelect}
                                        />
                                    </div>
                                </div>

                                <div className="pricing-section" style={{ marginBottom: '2rem' }}>
                                    <h3 style={{ color: 'rgba(255,255,255,0.7)', fontSize: '1rem', marginBottom: '1.25rem', fontWeight: 600, textAlign: 'center' }}>
                                        หรือเลือกแพ็กเกจอื่นที่คุ้มค่ากว่า
                                    </h3>
                                    <div className="pricing-grid">
                                        {otherPlans.map(plan => (
                                            <PlanCard
                                                key={plan.id}
                                                plan={plan}
                                                cycle={cycle}
                                                currentPlanId={currentPlanId}
                                                onSelect={handlePlanSelect}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="pricing-grid pricing-section">
                                {PLANS.map(plan => (
                                    <PlanCard
                                        key={plan.id}
                                        plan={plan}
                                        cycle={cycle}
                                        onSelect={handlePlanSelect}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Trust signals */}
                        <div className="p-anim-3" style={{
                            display: 'flex', justifyContent: 'center', gap: '2.5rem',
                            marginTop: '3rem', flexWrap: 'wrap',
                        }}>
                            {[
                                { icon: Shield, text: 'ปลอดภัย 100%' },
                                { icon: Clock, text: 'ยกเลิกได้ทุกเมื่อ' },
                                { icon: CreditCard, text: 'ชำระผ่าน Stripe' },
                            ].map(item => (
                                <div key={item.text} style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    color: 'rgba(255,255,255,0.22)', fontSize: '0.875rem',
                                }}>
                                    <item.icon size={14} />
                                    {item.text}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Demo Modal */}
            {selectedPlan && !processing && (
                <DemoModal
                    plan={selectedPlan}
                    cycle={cycle}
                    onClose={() => setSelectedPlan(null)}
                    onConfirm={handleConfirmPayment}
                />
            )}

            {/* Processing */}
            {processing && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
                    zIndex: 400, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: '1rem',
                    backdropFilter: 'blur(4px)',
                }}>
                    <div className="pricing-spinner" />
                    <p style={{ color: 'rgba(255,255,255,0.65)', fontWeight: 600, fontSize: '1rem' }}>
                        กำลังดำเนินการ...
                    </p>
                </div>
            )}
        </div>
    );
}
