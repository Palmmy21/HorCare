import { Camera, CheckCircle2, ClipboardList, Gauge, QrCode, ShieldCheck, Smartphone, UserCheck, Wrench } from 'lucide-react';
import { LOGO_SRC } from '../../utils/brand';

/**
 * /?guide=staff — how to register and work in the team LINE OA (HorCare Maintenance), opened from the "คู่มือ" button.
 * Public and static: it shows no data. Written for people who rarely use apps — a picture, a number and one short
 * sentence per step — with housekeepers first, since they send work in every day.
 */

interface Step { Icon: React.ComponentType<{ size?: number }>; text: string }

function Steps({ steps }: { steps: Step[] }) {
    return (
        <ol className="sg-steps">
            {steps.map(({ Icon, text }, i) => (
                <li key={text}>
                    <span className="sg-num" aria-hidden>{i + 1}</span>
                    <span className="sg-icon" aria-hidden><Icon size={28} /></span>
                    <span className="sg-text">{text}</span>
                </li>
            ))}
        </ol>
    );
}

export default function StaffGuidePage() {
    const oaId = import.meta.env.VITE_LINE_STAFF_OA_ID as string | undefined;
    const addFriend = oaId ? `https://line.me/R/ti/p/${encodeURIComponent(oaId)}` : null;

    return (
        <div className="sp-page sg-page">
            <header className="sp-head">
                <img src={LOGO_SRC} alt="" width={36} height={36} />
                <div className="sp-head-text">
                    <h1>คู่มือทีมงาน</h1>
                    <p>LINE HorCare Maintenance · ช่าง แม่บ้าน ผู้ดูแล</p>
                </div>
            </header>

            <main className="sp-main sg-main">
                <section className="sp-card">
                    <h2 className="sg-title">ลงทะเบียน (ทำครั้งเดียว)</h2>
                    <Steps steps={[
                        { Icon: QrCode, text: 'ขอ QR จากผู้จัดการ แล้วใช้ LINE สแกน' },
                        { Icon: Smartphone, text: 'กด "เพิ่มเพื่อน" แล้วกด "ส่ง" ข้อความที่ขึ้นมา' },
                        { Icon: UserCheck, text: 'ตอบคำถาม 3 ข้อ: หน้าที่ ชื่อ เบอร์โทร' },
                        { Icon: CheckCircle2, text: 'รอผู้จัดการอนุมัติ เมนูด้านล่างจะเปลี่ยนเป็นเมนูทำงานเอง' },
                    ]} />
                    <p className="sg-note">ไม่มี QR? พิมพ์รหัสที่ผู้จัดการให้ (ขึ้นต้น HCR- หรือ HCS-) ส่งในแชทได้เลย</p>
                    {addFriend && <a className="btn btn-primary sg-cta" href={addFriend}>เปิด LINE HorCare Maintenance</a>}
                </section>

                <section className="sp-card">
                    <h2 className="sg-title">แม่บ้าน</h2>
                    <h3 className="sg-sub"><Gauge size={18} aria-hidden /> จดมิเตอร์</h3>
                    <Steps steps={[
                        { Icon: Gauge, text: 'กดปุ่ม "จดมิเตอร์" ในเมนู แล้วกดปุ่มสีฟ้าที่ตอบกลับมา' },
                        { Icon: Camera, text: 'เลือกห้อง แล้วพิมพ์เลขมิเตอร์ หรือถ่ายรูปมิเตอร์' },
                        { Icon: CheckCircle2, text: 'กด "บันทึก" ทำห้องถัดไปได้เลย' },
                    ]} />
                    <h3 className="sg-sub"><Camera size={18} aria-hidden /> ส่งงานทำความสะอาด</h3>
                    <Steps steps={[
                        { Icon: ClipboardList, text: 'กดปุ่ม "งานของฉัน" จะเห็นห้องที่ต้องทำ' },
                        { Icon: Camera, text: 'ทำเสร็จแล้ว กด "ถ่ายรูปหลังทำ" ถ่ายรูปห้อง' },
                        { Icon: CheckCircle2, text: 'กด "เสร็จแล้ว" ผู้จัดการจะเห็นรูปทันที' },
                    ]} />
                </section>

                <section className="sp-card">
                    <h2 className="sg-title">ช่าง</h2>
                    <Steps steps={[
                        { Icon: Smartphone, text: 'มีงานใหม่ LINE จะเด้งเตือน กดที่ข้อความนั้น' },
                        { Icon: Wrench, text: 'กด "รับงาน" แล้วกด "เริ่มงาน" เมื่อเริ่มทำ' },
                        { Icon: Camera, text: 'ถ่ายรูปก่อนทำและหลังทำ' },
                        { Icon: CheckCircle2, text: 'กด "งานเสร็จแล้ว" จบ' },
                    ]} />
                    <p className="sg-note">หาข้อความไม่เจอ? กดปุ่ม "ส่งงาน" ในเมนู จะเปิดงานถัดไปให้เลย</p>
                </section>

                <section className="sp-card">
                    <h2 className="sg-title">ผู้ดูแล / แอดมิน</h2>
                    <Steps steps={[
                        { Icon: Smartphone, text: 'เข้าแอป HorCare ด้วยบัญชีของคุณ ไปที่ ตั้งค่า → การเชื่อมต่อ' },
                        { Icon: QrCode, text: 'กด "สร้างรหัสเชื่อม LINE" แล้วส่งรหัส HCO- ในแชท' },
                        { Icon: ClipboardList, text: 'เมนูจะเปลี่ยนเป็น งานทั้งหมด · ทีมงาน · จดมิเตอร์' },
                    ]} />
                    <p className="sg-note">ให้ทีมงานลงทะเบียน: เปิด ระบบจัดการ → ทีมช่าง/แม่บ้าน แล้วพิมพ์หรือโชว์ QR ลงทะเบียน จากนั้นกดอนุมัติเมื่อมีคำขอเข้ามา</p>
                </section>

                <section className="sp-card sg-safe">
                    <ShieldCheck size={24} aria-hidden />
                    <div>
                        <strong>ปลอดภัย ไม่ต้องจำรหัสผ่าน</strong>
                        <p>LINE ของคุณคือกุญแจ ทุกคนต้องได้รับอนุมัติจากผู้จัดการก่อน และผู้จัดการปิดสิทธิ์ได้ทันที อย่าส่งลิงก์งานของคุณให้คนอื่น</p>
                    </div>
                </section>
            </main>
        </div>
    );
}
