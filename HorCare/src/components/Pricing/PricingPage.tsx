import { useState, memo } from 'react';
import {
    Check, Zap, Sparkles, Shield, Clock, CreditCard, X, Heart,
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
/* -- Animations -- */
@keyframes p-slide-up {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes p-scale-in {
  from { opacity: 0; transform: translate(-50%,-50%) scale(0.95); }
  to   { opacity: 1; transform: translate(-50%,-50%) scale(1); }
}
@keyframes p-spin {
  to { transform: rotate(360deg); }
}
@keyframes p-pop {
  0%   { opacity: 0; transform: scale(0.95); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes p-check {
  0%   { transform: scale(0); opacity: 0; }
  70%  { transform: scale(1.08); }
  100% { transform: scale(1); opacity: 1; }
}

/* -- Page Wrapper -- */
.pricing-page {
  min-height: 100vh;
  margin: 0;
  padding: 3rem 1.5rem 5rem;
  background-color: #090D16;
  background-image: radial-gradient(circle at 50% -10%, rgba(14, 165, 233, 0.12) 0%, rgba(9, 13, 22, 0) 65%);
  position: relative;
  overflow-x: hidden;
  color: #F8FAFC;
  font-family: var(--font-sans);
}

.pricing-inner {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* -- Slide-up animation -- */
.p-anim-0 { animation: p-slide-up 0.35s ease both; }
.p-anim-1 { animation: p-slide-up 0.35s ease 0.08s both; }
.p-anim-2 { animation: p-slide-up 0.35s ease 0.16s both; }
.p-anim-3 { animation: p-slide-up 0.35s ease 0.24s both; }

.pricing-section { opacity: 1; }

.pricing-grid {
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  align-items: stretch;
}

/* -- Minimalist Plan Card -- */
.plan-card {
  position: relative;
  width: 100%;
  max-width: 460px;
  border-radius: 20px;
  padding: 2.25rem 2rem;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 16px 36px -12px rgba(0, 0, 0, 0.6);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  will-change: transform;
  overflow: hidden;
}
.plan-card:hover {
  transform: translateY(-3px);
  border-color: rgba(14, 165, 233, 0.32);
  box-shadow: 0 20px 44px -10px rgba(14, 165, 233, 0.12), 0 12px 28px -6px rgba(0, 0, 0, 0.5);
}
.plan-card.popular {
  border-color: rgba(14, 165, 233, 0.25);
}
.plan-card.popular::before {
  content: '';
  position: absolute;
  top: 0; left: 15%; right: 15%;
  height: 2px;
  background: linear-gradient(90deg, transparent, #38BDF8, transparent);
}

/* -- Popular micro-badge -- */
.popular-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: rgba(14, 165, 233, 0.1);
  border: 1px solid rgba(14, 165, 233, 0.25);
  color: #38BDF8;
  border-radius: 999px;
  padding: 0.25rem 0.75rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

/* -- Minimal CTA button -- */
.plan-cta {
  width: 100%;
  padding: 0.95rem;
  border-radius: 12px;
  border: none;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: #FFFFFF;
  background: linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%);
  box-shadow: 0 4px 16px rgba(2, 132, 199, 0.3);
  transition: transform 0.15s ease, box-shadow 0.2s ease, opacity 0.2s ease;
  text-decoration: none;
}
.plan-cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(2, 132, 199, 0.45);
  opacity: 0.96;
}
.plan-cta:active {
  transform: translateY(0);
}

/* -- Price typography -- */
.price-number {
  font-size: 3.25rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.03em;
  color: #FFFFFF;
  font-family: var(--font-sans);
}
.price-pop {
  animation: p-pop 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* -- Feature check icon -- */
.feat-check {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 0.08rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(14, 165, 233, 0.12);
  border: 1px solid rgba(14, 165, 233, 0.24);
  color: #38BDF8;
}
.feat-check.unavailable {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #64748B;
}

/* -- Minimal Billing Toggle -- */
.billing-toggle {
  display: inline-flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 4px;
  gap: 4px;
}
.billing-btn {
  padding: 0.55rem 1.25rem;
  border-radius: 10px;
  border: none;
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
  color: #94A3B8;
  background: transparent;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.billing-btn:hover {
  color: #F8FAFC;
}
.billing-btn.active {
  background: #0284C7;
  color: #FFFFFF;
  box-shadow: 0 2px 10px rgba(2, 132, 199, 0.35);
}

/* -- Back button -- */
.pricing-back {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  color: #94A3B8;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.5rem 1rem;
  margin-bottom: 2.25rem;
  transition: all 0.18s ease;
}
.pricing-back:hover {
  color: #FFFFFF;
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.16);
}

/* -- Minimal Modal -- */
.pricing-modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 300;
  backdrop-filter: blur(8px);
}
.pricing-modal {
  position: fixed; top: 50%; left: 50%; z-index: 301;
  background: #0F172A;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  padding: 2rem;
  width: min(420px, 92vw);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
  animation: p-scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
  color: #F8FAFC;
}
.modal-close {
  position: absolute; top: 1rem; right: 1rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px; padding: 0.375rem; cursor: pointer;
  display: flex; color: #94A3B8;
  transition: all 0.15s;
}
.modal-close:hover { color: #FFFFFF; background: rgba(255, 255, 255, 0.12); }
.modal-cancel {
  flex: 1; padding: 0.8rem; border-radius: 12px; cursor: pointer;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #94A3B8; font-weight: 600; font-size: 0.9rem;
  transition: all 0.15s;
}
.modal-cancel:hover { background: rgba(255, 255, 255, 0.09); color: #FFFFFF; }
.modal-confirm {
  flex: 2; padding: 0.8rem; border-radius: 12px; border: none;
  background: linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%);
  color: #FFFFFF; font-weight: 600; font-size: 0.9rem; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  box-shadow: 0 4px 16px rgba(2, 132, 199, 0.35);
  transition: all 0.15s;
}
.modal-confirm:hover { opacity: 0.92; transform: translateY(-1px); }

/* -- Processing spinner -- */
.pricing-spinner {
  width: 44px; height: 44px;
  border: 3px solid rgba(14, 165, 233, 0.2);
  border-top-color: #0EA5E9;
  border-radius: 50%;
  animation: p-spin 0.7s linear infinite;
}

/* -- Success check -- */
.success-check {
  width: 80px; height: 80px; border-radius: 50%;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #34D399;
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 1.5rem;
  animation: p-check 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@media (max-width: 768px) {
  .pricing-page { padding: 2rem 1rem 3.5rem; }
  .plan-card { padding: 1.75rem 1.25rem; }
}
`;

/* ----------- Inject CSS once ----------- */
function injectCSS() {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('horcare-pricing-css') as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement('style');
        el.id = 'horcare-pricing-css';
        document.head.appendChild(el);
    }
    el.textContent = CSS;
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
        monthlyPrice: 149, yearlyPrice: 950, originalYearlyPrice: 1788,
        gradient: 'linear-gradient(135deg,#0EA5E9,#0284C7)',
        glowColor: 'rgba(14,165,233,0.3)',
        features: [
            'ห้องสูงสุด 50 ห้อง · 1 หอพัก',
            'จดมิเตอร์ไฟ / น้ำ + ออกบิลอัตโนมัติ',
            'ส่งบิลผ่าน LINE อัตโนมัติ',
            'QR PromptPay ในบิล',
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
        gradient: 'linear-gradient(135deg,#0EA5E9,#0284C7)',
        glowColor: 'rgba(14,165,233,0.3)',
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
        gradient: 'linear-gradient(135deg,#0EA5E9,#0284C7)',
        glowColor: 'rgba(14,165,233,0.3)',
        popular: true,
        features: [
            'ห้องไม่จำกัด · สูงสุด 10 หอพัก',
            'ผู้ช่วย AI ส่วนตัว "น้องแคร์"',
            'ตรวจสอบสลิปอัตโนมัติด้วย AI',
            'จดมิเตอร์ไฟ / น้ำ + ออกบิลอัตโนมัติ',
            'ส่งบิลและแจ้งเตือนผ่าน LINE อัตโนมัติ',
            'QR PromptPay ในบิล สลิปเข้าอัตโนมัติ',
            'อ่านมิเตอร์จากรูปถ่ายด้วย AI',
            'ติดต่อทีมงานแบบ real-time (LINE)',
            'ทีมงาน HorCare ดูแลเซ็ตอัพให้',
            '[soon] ทีมงานไม่จำกัด (RBAC)',
            '[soon] Dashboard เปรียบเทียบหลายหอ',
            'Priority Support ตลอด 24 ชม.',
        ],
    },
];

/* ----------- PlanCard ----------- */
const PlanCard = memo(function PlanCard({
    plan, cycle, currentPlanId,
}: { plan: Plan; cycle: BillingCycle; currentPlanId?: string; onSelect?: (p: Plan) => void }) {
    const price = cycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;
    const savings = cycle === 'yearly'
        ? Math.round((1 - plan.yearlyPrice / plan.originalYearlyPrice) * 100)
        : 0;


    return (
        <div className={`plan-card ${plan.id}${plan.popular ? ' popular' : ''}`}>
            {/* Header: Icon + Badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div style={{
                    width: 44, height: 44, borderRadius: '12px',
                    background: 'rgba(14, 165, 233, 0.1)',
                    border: '1px solid rgba(14, 165, 233, 0.22)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#38BDF8',
                }}>
                    <plan.icon size={22} />
                </div>
                {plan.popular && (
                    <div className="popular-badge">
                        <Sparkles size={11} fill="currentColor" />
                        ยอดนิยม
                    </div>
                )}
            </div>

            {/* Plan Name & Scope */}
            <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontWeight: 800, fontSize: '1.4rem', color: '#FFFFFF', letterSpacing: '-0.02em', marginBottom: '0.35rem' }}>
                    {plan.name}
                </div>
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                    color: '#94A3B8', fontSize: '0.8125rem',
                }}>
                    <Package size={13} color="#38BDF8" /> {plan.roomRange}
                </div>
            </div>

            {/* Price */}
            <div style={{ marginBottom: '1.5rem' }}>
                <div key={cycle} className="price-pop" style={{
                    display: 'flex', alignItems: 'baseline', gap: '0.3rem',
                }}>
                    <span style={{ fontSize: '1.35rem', fontWeight: 700, color: '#38BDF8' }}>฿</span>
                    <span className="price-number">{price.toLocaleString()}</span>
                    <span style={{ fontSize: '0.9rem', color: '#94A3B8', marginLeft: '0.2rem' }}>
                        {cycle === 'monthly' ? '/ เดือน' : '/ ปี'}
                    </span>
                </div>
                {cycle === 'yearly' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ textDecoration: 'line-through', color: '#64748B', fontSize: '0.85rem' }}>
                            ฿{plan.originalYearlyPrice.toLocaleString()}
                        </span>
                        <span style={{
                            background: 'rgba(16,185,129,0.14)', border: '1px solid rgba(16,185,129,0.28)',
                            color: '#34D399', borderRadius: '999px', padding: '0.12rem 0.55rem',
                            fontSize: '0.72rem', fontWeight: 700,
                        }}>ประหยัด {savings}%</span>
                        <span style={{ color: '#94A3B8', fontSize: '0.8rem' }}>
                            (เฉลี่ยเพียง ฿{Math.round(plan.yearlyPrice / 12).toLocaleString()} / ด.)
                        </span>
                    </div>
                ) : (
                    <div style={{ fontSize: '0.8125rem', color: '#94A3B8', marginTop: '0.45rem' }}>
                        หรือจ่ายรายปี <span style={{ color: '#38BDF8', fontWeight: 600 }}>฿{plan.yearlyPrice.toLocaleString()}</span> / ปี (ประหยัดกว่า 49%)
                    </div>
                )}
            </div>

            {/* Divider */}
            <div style={{
                height: 1,
                background: 'rgba(255, 255, 255, 0.08)',
                marginBottom: '1.5rem',
            }} />

            {/* Features */}
            <ul style={{
                listStyle: 'none', padding: 0, margin: '0 0 2rem',
                flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem',
            }}>
                {plan.features.map(f => {
                    const coming = f.startsWith('[soon]');
                    const unavailable = !coming && (f.startsWith('[no]') || f.startsWith('❌'));
                    const label = coming ? f.slice(7) : (f.startsWith('[no]') ? f.slice(5) : (f.startsWith('❌') ? f.slice(2) : f));
                    return (
                        <li key={f} style={{
                            display: 'flex', alignItems: 'center',
                            gap: '0.75rem', fontSize: '0.875rem', fontWeight: 450,
                            color: (unavailable || coming) ? '#64748B' : '#E2E8F0',
                        }}>
                            {coming ? (
                                <div style={{
                                    background: 'rgba(245,158,11,0.12)',
                                    border: '1px solid rgba(245,158,11,0.25)',
                                    borderRadius: '50%', width: 20, height: 20,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                }}>
                                    <Clock size={10} color="#FBBF24" strokeWidth={2.5} />
                                </div>
                            ) : unavailable ? (
                                <div className="feat-check unavailable">
                                    <X size={10} strokeWidth={2.5} />
                                </div>
                            ) : (
                                <div className="feat-check">
                                    <Check size={11} strokeWidth={2.5} />
                                </div>
                            )}
                            <span style={{ flex: 1, lineHeight: 1.4 }}>
                                {label}
                                {coming && (
                                    <span style={{
                                        marginLeft: '0.4rem', fontSize: '0.65rem', fontWeight: 700,
                                        background: 'rgba(245,158,11,0.12)',
                                        border: '1px solid rgba(245,158,11,0.25)',
                                        color: '#FBBF24', borderRadius: '999px',
                                        padding: '0.1rem 0.45rem', verticalAlign: 'middle',
                                    }}>เร็วๆ นี้</span>
                                )}
                            </span>
                        </li>
                    );
                })}
            </ul>

            {/* CTA — direct to LINE Support */}
            <a
                id={`pricing-btn-${plan.id}`}
                className="plan-cta"
                href={`https://line.me/R/oaMessage/${encodeURIComponent('@127qwwfi')}/?${encodeURIComponent('สนใจสมัครแพ็กเกจ HorCare')}`}
                target="_blank"
                rel="noopener noreferrer"
            >
                <span>{currentPlanId === plan.id ? 'ต่ออายุแพ็กเกจ' : 'สมัครใช้งานผ่าน LINE'}</span>
                <Zap size={16} />
            </a>
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
            <div className="pricing-modal">
                <button className="modal-close" onClick={onClose}><X size={16} /></button>

                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                    <div style={{
                        width: 48, height: 48, borderRadius: '14px',
                        background: 'rgba(14, 165, 233, 0.1)',
                        border: '1px solid rgba(14, 165, 233, 0.25)',
                        color: '#38BDF8', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', margin: '0 auto 1rem',
                    }}>
                        <plan.icon size={26} />
                    </div>
                    <h2 style={{ fontWeight: 800, fontSize: '1.25rem', color: '#FFFFFF', marginBottom: '0.25rem', letterSpacing: '-0.02em' }}>
                        {plan.name} ({cycle === 'monthly' ? 'รายเดือน' : 'รายปี'})
                    </h2>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '0.25rem', marginTop: '0.5rem' }}>
                        <span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#38BDF8' }}>฿</span>
                        <span className="price-number" style={{ fontSize: '2.5rem' }}>
                            {price.toLocaleString()}
                        </span>
                        <span style={{ fontSize: '0.875rem', color: '#94A3B8' }}>
                            {cycle === 'monthly' ? '/ เดือน' : '/ ปี'}
                        </span>
                    </div>
                </div>

                <div style={{
                    background: 'rgba(14, 165, 233, 0.06)', border: '1px solid rgba(14, 165, 233, 0.18)',
                    borderRadius: '12px', padding: '0.875rem 1rem', marginBottom: '1.5rem',
                    display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
                }}>
                    <QrCode size={16} color="#38BDF8" style={{ flexShrink: 0, marginTop: '0.15rem' }} />
                    <div>
                        <div style={{ fontWeight: 600, color: '#F8FAFC', fontSize: '0.825rem', marginBottom: '0.2rem' }}>ชำระผ่าน QR PromptPay หรือ บัตรเครดิต</div>
                        <div style={{ fontSize: '0.775rem', color: '#94A3B8', lineHeight: 1.5 }}>
                            กด "ไปหน้าชำระเงิน" เพื่อดำเนินการผ่านระบบที่ปลอดภัยของ Stripe
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button className="modal-cancel" onClick={onClose}>ยกเลิก</button>
                    <button className="modal-confirm" onClick={onConfirm}>
                        <Shield size={15} /> ไปหน้าชำระเงิน
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
            justifyContent: 'center', minHeight: '60vh', textAlign: 'center', padding: '2rem',
        }}>
            <div className="success-check">
                <Check size={40} strokeWidth={2.5} />
            </div>
            <h2 style={{
                fontWeight: 800, fontSize: '1.75rem', letterSpacing: '-0.02em',
                color: '#34D399', marginBottom: '0.5rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}>
                <PartyPopper size={24} color="#10B981" />
                ชำระเงินสำเร็จ!
            </h2>
            <p style={{ color: '#94A3B8', maxWidth: 360, lineHeight: 1.6, marginBottom: '0.5rem', fontSize: '0.925rem' }}>
                อัปเกรดเป็นแผน <strong style={{ color: '#FFFFFF' }}>{plan.name}</strong>{' '}
                ({cycle === 'monthly' ? 'รายเดือน' : 'รายปี'}) เรียบร้อยแล้ว
            </p>
            <p style={{ color: '#64748B', fontSize: '0.8rem', marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                ขอบคุณที่ไว้วางใจ HorCare <Heart size={13} color="#0EA5E9" fill="#0EA5E9" />
            </p>
            <button onClick={onBack} className="plan-cta" style={{ maxWidth: 220 }}>
                <Zap size={16} /> เริ่มใช้งานเลย
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
    injectCSS();

    const [cycle, setCycle] = useState<BillingCycle>(initialCycle ?? 'monthly');
    const [selectedPlan, setSelectedPlan] = useState<Plan | null>(() =>
        initialPlanId ? PLANS.find(p => p.id === initialPlanId) ?? null : null
    );
    const [processing, setProcessing] = useState(false);
    const [successPlan] = useState<Plan | null>(null);

    const handlePlanSelect = (plan: Plan) => {
        if (isGuest) {
            onNeedAuth?.(plan.id, cycle);
        } else {
            setSelectedPlan(plan);
        }
    };

    const handleConfirmPayment = async () => {
        if (!selectedPlan) return;

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
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ plan: selectedPlan.id, cycle }),
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to create checkout session');
            }

            const { data } = await res.json();
            if (!data?.url) throw new Error('No checkout URL returned');

            if (checkoutTab) checkoutTab.location.href = data.url;
            else window.location.href = data.url;

            setSelectedPlan(null);
        } catch (err: unknown) {
            if (checkoutTab) checkoutTab.close();
            console.error('Checkout error:', err);
            const errMsg = err instanceof Error ? err.message : String(err);
            alert(`เกิดข้อผิดพลาด: ${errMsg}`);
            setSelectedPlan(null);
        } finally {
            setProcessing(false);
        }
    };

    const currentPlanId = profile && profile.license !== 'free' ? profile.plan_name : undefined;
    const currentPlan = PLANS.find(p => p.id === currentPlanId);

    return (
        <div className="pricing-page">
            <div className="pricing-inner">
                {onBack && (
                    <button className="pricing-back" onClick={onBack}>
                        <ChevronLeft size={16} /> ย้อนกลับ
                    </button>
                )}

                {successPlan ? (
                    <SuccessScreen plan={successPlan} cycle={cycle} onBack={onBack} />
                ) : (
                    <>
                        {/* Header */}
                        <div className="p-anim-0" style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                                background: 'rgba(14, 165, 233, 0.08)', border: '1px solid rgba(14, 165, 233, 0.22)',
                                borderRadius: '999px', padding: '0.35rem 0.95rem', marginBottom: '1rem',
                            }}>
                                <Sparkles size={12} color="#38BDF8" />
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#38BDF8', letterSpacing: '0.02em' }}>
                                    {currentPlanId ? 'ต่ออายุหรือเปลี่ยนแพ็กเกจ' : 'เลือกแผนที่เหมาะสำหรับคุณ'}
                                </span>
                            </div>

                            <h1 style={{
                                fontSize: 'clamp(2rem, 5vw, 2.75rem)', fontWeight: 800,
                                color: '#FFFFFF', letterSpacing: '-0.03em', lineHeight: 1.2, marginBottom: '0.75rem',
                            }}>
                                {currentPlanId ? 'จัดการแพ็กเกจ ' : 'แพ็กเกจ '}
                                <span style={{
                                    background: 'linear-gradient(135deg, #FFFFFF 40%, #38BDF8 100%)',
                                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                                }}>HorCare</span>
                            </h1>
                            <p style={{ color: '#94A3B8', fontSize: '1rem', maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }}>
                                {currentPlanId ? 'ต่ออายุแพ็กเกจปัจจุบัน หรืออัปเกรดเพื่อรับฟีเจอร์ที่มากขึ้น' : 'ยกระดับการบริหารหอพักด้วยระบบอัตโนมัติ AI และ LINE แจ้งเตือนครบวงจร'}
                            </p>
                            {currentPlanId && currentPlan && (
                                <div style={{
                                    marginTop: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                    background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.22)',
                                    borderRadius: '999px', padding: '0.3rem 0.85rem',
                                    fontSize: '0.8rem', color: '#34D399', fontWeight: 600,
                                }}>
                                    <InfinityIcon size={13} />
                                    แผนปัจจุบันของคุณ: {currentPlan.name}
                                </div>
                            )}
                        </div>

                        {/* Billing toggle */}
                        <div className="p-anim-1" style={{ display: 'flex', justifyContent: 'center', marginBottom: '2.5rem' }}>
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
                                                background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.32)',
                                                color: '#34D399', borderRadius: '999px',
                                                padding: '0.1rem 0.5rem', fontSize: '0.68rem', fontWeight: 700,
                                            }}>ประหยัด 49%</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {currentPlanId && currentPlan ? (
                            <>
                                <div className="pricing-section" style={{ marginBottom: '2.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <h3 style={{ color: '#CBD5E1', fontSize: '1rem', marginBottom: '1.25rem', fontWeight: 600 }}>
                                        แพ็กเกจปัจจุบันของคุณ
                                    </h3>
                                    <div style={{ maxWidth: '460px', width: '100%' }}>
                                        <PlanCard
                                            key={currentPlan.id}
                                            plan={currentPlan}
                                            cycle={cycle}
                                            currentPlanId={currentPlanId}
                                            onSelect={handlePlanSelect}
                                        />
                                    </div>
                                </div>

                                {currentPlanId !== 'large' && (
                                    <div className="pricing-section" style={{ marginBottom: '2rem' }}>
                                        <h3 style={{ color: '#94A3B8', fontSize: '0.95rem', marginBottom: '1.25rem', fontWeight: 500, textAlign: 'center' }}>
                                            อัปเกรดเป็นแพ็กเกจ HorCare เพื่อฟีเจอร์ที่ครบกว่า
                                        </h3>
                                        <div className="pricing-grid" style={{ maxWidth: 460, margin: '0 auto' }}>
                                            <PlanCard
                                                plan={PLANS.find(p => p.id === 'large')!}
                                                cycle={cycle}
                                                currentPlanId={currentPlanId}
                                                onSelect={handlePlanSelect}
                                            />
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="pricing-grid pricing-section" style={{ maxWidth: 460, margin: '0 auto' }}>
                                <PlanCard
                                    plan={PLANS.find(p => p.id === 'large')!}
                                    cycle={cycle}
                                    onSelect={handlePlanSelect}
                                />
                            </div>
                        )}

                        {/* Trust signals */}
                        <div className="p-anim-3" style={{
                            display: 'flex', justifyContent: 'center', gap: '2rem',
                            marginTop: '2.5rem', flexWrap: 'wrap',
                        }}>
                            {[
                                { icon: Shield, text: 'ระบบปลอดภัย ได้มาตรฐาน' },
                                { icon: Clock, text: 'เริ่มใช้งานได้ทันทีหลังยืนยัน' },
                                { icon: CreditCard, text: 'ปรึกษาทีมงานผ่าน LINE ตลอดเวลา' },
                            ].map(item => (
                                <div key={item.text} style={{
                                    display: 'flex', alignItems: 'center', gap: '0.45rem',
                                    color: '#64748B', fontSize: '0.8125rem', fontWeight: 500,
                                }}>
                                    <item.icon size={14} color="#38BDF8" />
                                    <span>{item.text}</span>
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
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
                    zIndex: 400, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: '1rem',
                    backdropFilter: 'blur(6px)',
                }}>
                    <div className="pricing-spinner" />
                    <p style={{ color: '#CBD5E1', fontWeight: 500, fontSize: '0.95rem' }}>
                        กำลังดำเนินการ...
                    </p>
                </div>
            )}
        </div>
    );
}
