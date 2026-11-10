import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ExternalLink, Loader2, MessageCircle, RefreshCw, Unplug } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { readyToConnect, routePasted, setupProblem } from '../../shared/lineOaSetup';

interface Status {
    connected: boolean;
    oa_id?: string;
    display_name?: string;
    webhook_url?: string;
    /** null = LINE could not be asked just now */
    webhook_active?: boolean | null;
    webhook_matches?: boolean | null;
    token_valid?: boolean | null;
    encryption_ready?: boolean;
}

const CONSOLE_URL = 'https://developers.line.biz/console/';
const MANAGER_URL = 'https://manager.line.biz/';

const ERRORS: Record<string, string> = {
    invalid_input: 'ค่าที่วางยังไม่ครบหรือไม่ถูกรูปแบบ กรุณาคัดลอกใหม่ทั้งสองช่อง',
    invalid_token: 'LINE ไม่ยอมรับ Channel access token นี้ ลองกด Issue ใหม่ในแท็บ Messaging API แล้วคัดลอกมาอีกครั้ง',
    invalid_secret: 'Channel secret ไม่ตรงกับ OA นี้ ตรวจว่าคัดลอกจาก OA เดียวกับ access token',
    webhook_failed: 'ตั้งค่า webhook ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    shared_oa: 'บัญชีนี้เป็น OA กลางของ HorCare ใช้เชื่อมเป็นของคุณเองไม่ได้',
    oa_taken: 'OA นี้ถูกเชื่อมกับบัญชี HorCare อื่นอยู่',
    encryption_not_configured: 'ระบบยังไม่พร้อมเก็บข้อมูลลับ กรุณาติดต่อทีมงาน HorCare',
    forbidden: 'เฉพาะเจ้าของบัญชีเท่านั้นที่เชื่อม OA ได้',
};

const errorText = (e: ApiError) => (e.code === 'rooms_linked'
    ? 'ยังมีผู้เช่าผูกกับ OA นี้อยู่ ต้องย้ายหรือยกเลิกการผูกทุกห้องก่อน'
    : ERRORS[e.code] ?? e.message ?? 'ดำเนินการไม่สำเร็จ');

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
    return <a className="btn btn-outline btn-sm" href={href} target="_blank" rel="noopener noreferrer">{children} <ExternalLink size={13} aria-hidden /></a>;
}

/** One line of the after-connect checklist. `ok` null = could not be checked right now. */
function Check_({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
    return (
        <li className={`oa-check${ok === false ? ' is-todo' : ''}`}>
            {ok === false ? <AlertTriangle size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}
            <span>{children}</span>
        </li>
    );
}

/**
 * Settings → การเชื่อมต่อ: a property that already has its own LINE Official Account connects it here. Tenants then
 * register, chat and receive bills through that OA, under the property's own name, instead of the shared HorCare OA.
 *
 * Made to need as little as possible: two values copied from LINE's console (put in the wrong box, they sort themselves
 * out), one button. The webhook is set and proven by the server; what only LINE's console can do is shown as a
 * checklist that re-checks itself.
 */
export default function LineOaCard({ ownerUid, buildingId }: { ownerUid: string; buildingId?: string }) {
    const [status, setStatus] = useState<Status | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [fields, setFields] = useState({ secret: '', token: '' });
    const [moved, setMoved] = useState(false);
    const [busy, setBusy] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setStatus(await apiPost<Status>('line-oa', { action: 'status', owner_uid: ownerUid, building_id: buildingId }));
        } catch (e) {
            if ((e as ApiError).code === 'forbidden') setForbidden(true);
        }
    }, [ownerUid, buildingId]);

    useEffect(() => { void load(); }, [load]);

    const change = (box: 'secret' | 'token', value: string) => {
        const next = routePasted(fields, box, value);
        setFields({ secret: next.secret, token: next.token });
        setMoved(next.moved);
        setError(null);
    };

    const connect = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await apiPost<Status>('line-oa', { action: 'connect', owner_uid: ownerUid, building_id: buildingId, channel_secret: fields.secret, access_token: fields.token });
            setStatus({ ...res, webhook_matches: true, token_valid: true });
            setFields({ secret: '', token: '' });
            setMoved(false);
            toast.success(`เชื่อม ${res.display_name ?? res.oa_id} แล้ว`);
        } catch (e) {
            setError(errorText(e as ApiError));
        } finally {
            setBusy(false);
        }
    };

    const recheck = async () => {
        setChecking(true);
        await load();
        setChecking(false);
    };

    const disconnect = async () => {
        if (!confirm('ยกเลิกการเชื่อม OA ของคุณ? ผู้เช่าใหม่จะกลับไปใช้ OA กลางของ HorCare')) return;
        setBusy(true);
        try {
            await apiPost('line-oa', { action: 'disconnect', owner_uid: ownerUid, building_id: buildingId });
            toast.success('ยกเลิกการเชื่อมแล้ว');
            await load();
        } catch (e) {
            toast.error(errorText(e as ApiError));
        } finally {
            setBusy(false);
        }
    };

    if (forbidden) return null;

    const problem = setupProblem(fields);
    const broken = status?.connected && (status.token_valid === false || status.webhook_matches === false);

    return (
        <div className="card mb-6">
            <div className="card-header">
                <div>
                    <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><MessageCircle size={18} /> LINE OA ของคุณเอง</div>
                    <p className="card-subtitle">มี LINE Official Account ของที่พักอยู่แล้ว? เชื่อมที่นี่ ผู้เช่าจะลงทะเบียน คุยแชท และรับบิลผ่าน OA ของคุณ ในชื่อของคุณ แทน OA กลางของ HorCare</p>
                </div>
            </div>

            {!status ? <Loader2 size={18} className="spin" aria-label="กำลังโหลด" /> : status.connected && !broken ? (
                <div className="oa-setup">
                    <div className="oa-connected"><Check size={18} aria-hidden /> เชื่อมแล้ว: {status.display_name} ({status.oa_id})</div>
                    <ul className="oa-checklist">
                        <Check_ ok>HorCare ตั้ง Webhook ให้แล้ว และ LINE ยืนยันว่ารับข้อความได้</Check_>
                        <Check_ ok={status.webhook_active ?? null}>
                            {status.webhook_active === false
                                ? <>เหลืออีกขั้นเดียว: เปิดสวิตช์ <strong>Use webhook</strong> ในแท็บ Messaging API ของ OA นี้ ไม่อย่างนั้นระบบจะไม่ได้รับข้อความจากผู้เช่า</>
                                : <>สวิตช์ <strong>Use webhook</strong> เปิดอยู่</>}
                        </Check_>
                    </ul>
                    {status.webhook_active === false && (
                        <div className="oa-actions">
                            <ExtLink href={CONSOLE_URL}>เปิด LINE Developers Console</ExtLink>
                            <button type="button" className="btn btn-primary btn-sm" disabled={checking} onClick={() => void recheck()}>
                                {checking ? <Loader2 size={14} className="spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />} เปิดแล้ว ตรวจอีกครั้ง
                            </button>
                        </div>
                    )}
                    <details className="oa-more">
                        <summary><ChevronDown size={14} aria-hidden /> แนะนำให้ทำเพิ่ม: ปิดข้อความตอบกลับอัตโนมัติของ LINE</summary>
                        <p>ถ้าเปิดไว้ ผู้เช่าจะได้ทั้งคำตอบจากบอท HorCare และข้อความอัตโนมัติของ LINE ซ้อนกัน เข้า LINE Official Account Manager → ตั้งค่า → ตั้งค่าการตอบกลับ แล้วปิด “ข้อความตอบกลับอัตโนมัติ” (ข้อความทักทายเปิดไว้ได้)</p>
                        <ExtLink href={MANAGER_URL}>เปิด LINE Official Account Manager</ExtLink>
                    </details>
                    <p className="form-hint">
                        QR ที่พิมพ์ไว้จะพาไป OA นี้อัตโนมัติ ไม่ต้องพิมพ์ใหม่ ผู้เช่าที่อยู่บน OA กลางยังรับบิลได้ตามเดิม จนกว่าจะสแกนใหม่และแอดมินอนุมัติ
                    </p>
                    <div><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void disconnect()}><Unplug size={14} aria-hidden /> ยกเลิกการเชื่อม</button></div>
                </div>
            ) : (
                <div className="oa-setup">
                    {broken && (
                        <div className="oa-alert" role="alert">
                            <AlertTriangle size={16} aria-hidden />
                            <span>
                                การเชื่อมกับ {status.display_name} ({status.oa_id}) ใช้ไม่ได้แล้ว: {status.token_valid === false
                                    ? 'Channel access token ถูกออกใหม่หรือยกเลิกใน LINE'
                                    : 'Webhook ของ OA ถูกเปลี่ยนไปที่อื่น'} ทำ 3 ขั้นด้านล่างอีกครั้งเพื่อเชื่อมใหม่ (ผู้เช่าไม่ต้องลงทะเบียนใหม่)
                            </span>
                        </div>
                    )}
                    {status.encryption_ready === false && (
                        <div className="oa-alert" role="alert"><AlertTriangle size={16} aria-hidden /><span>{ERRORS.encryption_not_configured}</span></div>
                    )}

                    <ol className="oa-steps">
                        <li>
                            <div className="oa-step-title">เปิด LINE Developers Console แล้วเลือก OA ของคุณ</div>
                            <div className="oa-actions"><ExtLink href={CONSOLE_URL}>เปิด Console</ExtLink></div>
                            <details className="oa-more">
                                <summary><ChevronDown size={14} aria-hidden /> ไม่เห็น OA ของคุณใน Console?</summary>
                                <p>ต้องเปิดใช้ Messaging API ก่อน (ครั้งเดียว ฟรี): เข้า LINE Official Account Manager → ตั้งค่า → Messaging API → กด “ใช้ Messaging API” แล้วกลับมาที่ Console</p>
                                <ExtLink href={MANAGER_URL}>เปิด LINE Official Account Manager</ExtLink>
                            </details>
                        </li>
                        <li>
                            <label className="oa-step-title" htmlFor="oa-secret">แท็บ <strong>Basic settings</strong> → คัดลอก <strong>Channel secret</strong> มาวาง</label>
                            <input id="oa-secret" className="form-input" type="password" autoComplete="off" spellCheck={false} placeholder="32 ตัวอักษร"
                                value={fields.secret} onChange={e => change('secret', e.target.value)} />
                        </li>
                        <li>
                            <label className="oa-step-title" htmlFor="oa-token">แท็บ <strong>Messaging API</strong> → เลื่อนลงล่างสุด → กด <strong>Issue</strong> ที่ Channel access token (long-lived) → คัดลอกมาวาง</label>
                            <input id="oa-token" className="form-input" type="password" autoComplete="off" spellCheck={false} placeholder="ข้อความยาว ลงท้ายด้วย ="
                                value={fields.token} onChange={e => change('token', e.target.value)} />
                        </li>
                    </ol>

                    {moved && <p className="form-hint" role="status">วางสลับช่องมา ระบบย้ายไปไว้ช่องที่ถูกให้แล้ว</p>}
                    {(error ?? problem) && <div className="oa-alert" role="alert"><AlertTriangle size={16} aria-hidden /><span>{error ?? problem}</span></div>}

                    <div className="oa-actions">
                        <button type="button" className="btn btn-primary" disabled={busy || !readyToConnect(fields)} onClick={() => void connect()}>
                            {busy ? <Loader2 size={16} className="spin" aria-hidden /> : <MessageCircle size={16} aria-hidden />} {busy ? 'กำลังเชื่อมและทดสอบ…' : 'เชื่อม OA'}
                        </button>
                    </div>
                    <p className="form-hint">
                        กดแล้ว HorCare จะตั้ง Webhook ให้เองและให้ LINE ส่งข้อความทดสอบทันที ถ้าค่าใดไม่ถูกจะบอกว่าค่าไหน
                        หาก OA นี้ต่อกับระบบแชทบอทอื่นอยู่ การเชื่อมจะแทนที่ Webhook เดิมของระบบนั้น ค่าทั้งสองถูกเข้ารหัสก่อนเก็บ
                    </p>
                </div>
            )}
        </div>
    );
}
