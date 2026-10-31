import { useState } from 'react';
import { Sparkles, LogIn, Gauge, Send, ScanLine, Map as MapIcon, BookOpenCheck, Users, Wrench, Package, Eye } from 'lucide-react';
import Dashboard from '../Dashboard/Dashboard';
import { getCurrentMonth } from '../../utils/calculations';
import { TRIAL_DAYS } from '../../shared/trial';
import { DEMO_BILLS, DEMO_BUILDING_NAME, DEMO_CONFIG, DEMO_ROOMS, demoStats } from './demoData';
import horcareLogo from '../../assets/horcare_logo.png';

interface GuestHomeProps {
    /** Sign up and start the free HorCare Pro trial */
    onStartTrial: () => void;
    onLogin: () => void;
    onPricing: () => void;
}

const MODULES = [
    { icon: Gauge, label: 'จดมิเตอร์ + AI อ่านเลข' },
    { icon: Send, label: 'ส่งบิลทาง LINE' },
    { icon: ScanLine, label: 'ตรวจสลิปอัตโนมัติ' },
    { icon: MapIcon, label: 'ผังห้อง 2D/3D' },
    { icon: Users, label: 'ผู้เช่าและสัญญา' },
    { icon: Wrench, label: 'แจ้งซ่อม' },
    { icon: Package, label: 'พัสดุ' },
    { icon: BookOpenCheck, label: 'บัญชีและงบ' },
];

/**
 * What a visitor sees before signing in: the real Dashboard filled with a sample property, read-only.
 * Anything that would change data asks them to sign up (or sign in) first.
 */
export default function GuestHome({ onStartTrial, onLogin, onPricing }: GuestHomeProps) {
    const [prompt, setPrompt] = useState<string | null>(null);
    const month = getCurrentMonth();
    const ask = (what: string) => () => setPrompt(what);

    return (
        <div className="guest-home">
            <header className="guest-bar">
                <div className="guest-brand">
                    <img src={horcareLogo} alt="" width={32} height={32} />
                    <span className="guest-brand-name">HorCare</span>
                    <span className="guest-demo-tag"><Eye size={12} aria-hidden /> ตัวอย่าง</span>
                </div>
                <nav className="guest-actions">
                    <button type="button" className="btn btn-ghost btn-sm guest-pricing" onClick={onPricing}>แพ็กเกจ</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onLogin}>
                        <LogIn size={16} aria-hidden /> เข้าสู่ระบบ
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={onStartTrial}>
                        <Sparkles size={16} aria-hidden /> ทดลองใช้ฟรี
                    </button>
                </nav>
            </header>

            <main className="guest-main">
                <section className="guest-hero">
                    <div>
                        <h1 className="guest-hero-title">ลองดูระบบจัดการหอพักได้เลย ไม่ต้องสมัคร</h1>
                        <p className="guest-hero-text">
                            ด้านล่างคือหน้าจอจริงของ HorCare พร้อมข้อมูลหอตัวอย่าง 24 ห้อง
                            อยากใช้กับหอของคุณ ทดลองใช้ <strong>HorCare Pro ฟรี {TRIAL_DAYS} วัน</strong> ครบทุกฟีเจอร์ ไม่ต้องผูกบัตร
                        </p>
                    </div>
                    <button type="button" className="btn btn-primary guest-hero-cta" onClick={onStartTrial}>
                        <Sparkles size={18} aria-hidden /> เริ่มทดลองใช้ฟรี {TRIAL_DAYS} วัน
                    </button>
                </section>

                <ul className="guest-modules" aria-label="ฟีเจอร์ในแพ็กเกจ Pro">
                    {MODULES.map(({ icon: Icon, label }) => (
                        <li key={label}>
                            <button type="button" className="guest-module" onClick={ask(label)}>
                                <Icon size={18} aria-hidden /> {label}
                            </button>
                        </li>
                    ))}
                </ul>

                <Dashboard
                    config={DEMO_CONFIG}
                    stats={demoStats(month)}
                    currentMonth={month}
                    recentBills={DEMO_BILLS.filter(b => b.month === month)}
                    allBills={DEMO_BILLS}
                    rooms={DEMO_ROOMS}
                    onOpenRoom={room => setPrompt(`ห้อง ${room.room_number}`)}
                    buildingName={DEMO_BUILDING_NAME}
                    onGoToPayments={ask('การรับชำระเงิน')}
                    onUpgrade={onPricing}
                    license="free"
                />
            </main>

            {prompt && (
                <div className="modal-overlay" onClick={() => setPrompt(null)}>
                    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="guest-prompt-title" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 id="guest-prompt-title" className="modal-title">ใช้งาน “{prompt}” กับหอของคุณ</h2>
                        </div>
                        <div className="modal-body guest-prompt-body">
                            นี่คือข้อมูลตัวอย่าง สมัครฟรีแล้วเริ่มทดลองใช้ HorCare Pro {TRIAL_DAYS} วัน
                            ใช้ได้ทุกฟีเจอร์ ครบกำหนดแล้วกลับเป็นแผนฟรีเอง ข้อมูลไม่หาย
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={onLogin}>มีบัญชีแล้ว เข้าสู่ระบบ</button>
                            <button type="button" className="btn btn-primary" onClick={onStartTrial}>
                                <Sparkles size={16} aria-hidden /> ทดลองใช้ฟรี
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
