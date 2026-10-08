import { useState } from 'react';
import { Megaphone, Bot, Plus, Pin, Archive, Trash2, Loader2, Send, Pencil, Zap, Droplets, Wrench } from 'lucide-react';
import {
    ANNOUNCEMENT_TEMPLATES, buildAnnouncement, missingFields, templateById,
    type TemplateField, type TemplateId, type TemplateValues,
} from '../../shared/announcementTemplates';

const TEMPLATE_ICONS = { Zap, Droplets, Wrench, Megaphone } as const;
const TEMPLATE_COLORS = { Zap: '#F97316', Droplets: '#0EA5E9', Wrench: '#94A3B8', Megaphone: '#E11D48' } as const;
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { useAnnouncements, useFaqs } from '../../hooks/useChatbotData';
import { ANNOUNCEMENT_LIMITS, FAQ_LIMITS, type Announcement, type FaqEntry } from '../../shared/chatbot';

interface Props { ownerUid: string; buildingId: string }

const ERRORS: Record<string, string> = {
    invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบหัวข้อ เนื้อหา และคีย์เวิร์ด (อย่างน้อย 2 ตัวอักษร)',
    forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
    limit_reached: 'มีคำถามครบจำนวนสูงสุดแล้ว',
    line_not_configured: 'ยังไม่ได้ตั้งค่า LINE บนเซิร์ฟเวอร์',
};

const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 12, padding: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--color-white, #fff)' };
const input: React.CSSProperties = { padding: '0.5rem 0.65rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 8, font: 'inherit', minWidth: 0, width: '100%', boxSizing: 'border-box' };

async function call(ownerUid: string, buildingId: string, route: string, body: Record<string, unknown>): Promise<boolean> {
    try {
        await apiPost(route, { owner_uid: ownerUid, building_id: buildingId, ...body });
        return true;
    } catch (e) {
        const err = e as ApiError;
        toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ');
        return false;
    }
}

// ── Q&A ─────────────────────────────────────────────────────────────────────

function FaqTab({ ownerUid, buildingId }: Props) {
    const { faqs, loading } = useFaqs(ownerUid, buildingId);
    const [editing, setEditing] = useState<FaqEntry | 'new' | null>(null);
    const [form, setForm] = useState({ title: '', keywords: '', answer: '' });
    const [busy, setBusy] = useState(false);

    const open = (f: FaqEntry | 'new') => {
        setEditing(f);
        setForm(f === 'new' ? { title: '', keywords: '', answer: '' } : { title: f.title, keywords: f.keywords.join(', '), answer: f.answer });
    };
    const save = async () => {
        setBusy(true);
        const keywords = form.keywords.split(/[,\n،]/).map(k => k.trim()).filter(Boolean);
        const ok = editing === 'new'
            ? await call(ownerUid, buildingId, 'chatbot', { action: 'create', title: form.title, keywords, answer: form.answer })
            : await call(ownerUid, buildingId, 'chatbot', { action: 'update', faq_id: (editing as FaqEntry).id, title: form.title, keywords, answer: form.answer });
        setBusy(false);
        if (ok) { toast.success('บันทึกแล้ว'); setEditing(null); }
    };
    const toggle = (f: FaqEntry) => void call(ownerUid, buildingId, 'chatbot', { action: 'update', faq_id: f.id, enabled: !f.enabled });
    const remove = async (f: FaqEntry) => {
        if (window.confirm(`ลบคำถาม "${f.title}" ?`) && await call(ownerUid, buildingId, 'chatbot', { action: 'delete', faq_id: f.id })) toast.success('ลบแล้ว');
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                เมื่อลูกบ้านพิมพ์ข้อความที่มีคีย์เวิร์ดตรงกับคำถามใด บอทจะตอบด้วยคำตอบที่คุณเขียนไว้ทันที (ข้อความทั้งหมดยังเข้ากล่องข้อความ LINE ให้คุณเห็นเสมอ)
                ถ้าไม่ตรงกับข้อใดเลย บอทจะไม่ตอบ และรอให้คุณตอบเอง
            </p>
            <div><button className="btn btn-primary btn-sm" onClick={() => open('new')} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Plus size={14} /> เพิ่มคำถาม</button></div>

            {editing && (
                <div style={card}>
                    <input style={input} placeholder="ชื่อคำถาม เช่น รหัส Wi-Fi" maxLength={FAQ_LIMITS.title} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                    <input style={input} placeholder="คีย์เวิร์ด คั่นด้วยเครื่องหมายจุลภาค เช่น wifi, ไวไฟ, อินเทอร์เน็ต" value={form.keywords} onChange={e => setForm({ ...form, keywords: e.target.value })} />
                    <textarea style={{ ...input, minHeight: 90 }} placeholder="คำตอบที่บอทจะส่งให้ลูกบ้าน" maxLength={FAQ_LIMITS.answer} value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} />
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>{busy ? <Loader2 size={14} className="spin" /> : 'บันทึก'}</button>
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setEditing(null)}>ยกเลิก</button>
                    </div>
                </div>
            )}

            {loading ? <Loader2 className="spin" /> : faqs.length === 0 ? (
                <div style={{ color: 'var(--color-gray-500)', padding: '1rem 0' }}>ยังไม่มีคำถาม-คำตอบ เริ่มจากเรื่องที่ลูกบ้านถามบ่อย เช่น รหัส Wi-Fi เวลาปิดประตู ที่ซักผ้า</div>
            ) : faqs.map(f => (
                <div key={f.id} style={{ ...card, opacity: f.enabled ? 1 : 0.6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <strong style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.title}</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>ตอบแล้ว {f.hit_count} ครั้ง</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)', overflowWrap: 'anywhere' }}>คีย์เวิร์ด: {f.keywords.join(' · ')}</div>
                    <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{f.answer}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => open(f)} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Pencil size={13} /> แก้ไข</button>
                        <button className="btn btn-outline btn-sm" onClick={() => toggle(f)}>{f.enabled ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
                        <button className="btn btn-outline btn-sm" onClick={() => void remove(f)} aria-label="ลบ"><Trash2 size={13} /></button>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Announcements ───────────────────────────────────────────────────────────

function AnnouncementsTab({ ownerUid, buildingId }: Props) {
    const { announcements, loading } = useAnnouncements(ownerUid, buildingId);
    const [show, setShow] = useState(false);
    const [form, setForm] = useState({ title: '', body: '', pinned: false, expires: '', sendLine: true });
    const [busy, setBusy] = useState(false);
    const [templateId, setTemplateId] = useState<TemplateId>('general');
    const [values, setValues] = useState<TemplateValues>({});
    /** Once the owner edits the text by hand, changing a field no longer overwrites it. */
    const [edited, setEdited] = useState(false);
    const template = templateById(templateId);
    const missing = missingFields(templateId, values);

    const fill = (id: TemplateId, v: TemplateValues) => {
        const t = buildAnnouncement(id, v);
        setForm(f => ({ ...f, title: t.title, body: t.body }));
    };
    const pickTemplate = (id: TemplateId) => {
        setTemplateId(id);
        setValues({});
        setEdited(false);
        setForm(f => ({ ...f, ...buildAnnouncement(id, {}), pinned: templateById(id).pinned }));
    };
    const changeValue = (key: TemplateField['key'], value: string) => {
        const next = { ...values, [key]: value };
        setValues(next);
        if (!edited) fill(templateId, next);
    };

    const publish = async () => {
        setBusy(true);
        try {
            const res = await apiPost<{ announcement: Announcement }>('announcements', {
                owner_uid: ownerUid, building_id: buildingId, action: 'create', title: form.title, body: form.body,
                pinned: form.pinned, expires_at: form.expires ? new Date(form.expires).toISOString() : null, send_line: form.sendLine,
            });
            const a = res.announcement;
            toast.success(form.sendLine ? `เผยแพร่แล้ว · ส่ง LINE ${a.line_sent} คน${a.line_failed ? ` (ไม่สำเร็จ ${a.line_failed})` : ''}` : 'เผยแพร่แล้ว');
            setShow(false);
            setForm({ title: '', body: '', pinned: false, expires: '', sendLine: true });
            setTemplateId('general'); setValues({}); setEdited(false);
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ');
        } finally {
            setBusy(false);
        }
    };
    const update = (a: Announcement, patch: Record<string, unknown>) => void call(ownerUid, buildingId, 'announcements', { action: 'update', announcement_id: a.id, ...patch });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                ประกาศจะแสดงในพอร์ทัลของลูกบ้านทุกห้อง และพิมพ์ “ประกาศ” ใน LINE เพื่อดูประกาศล่าสุดได้ จะส่งเข้า LINE ให้ลูกบ้านทุกคนที่เชื่อม LINE ไว้ด้วยหรือไม่ก็ได้
            </p>
            <div><button className="btn btn-primary btn-sm" onClick={() => setShow(s => !s)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Plus size={14} /> สร้างประกาศ</button></div>

            {show && (
                <div style={card}>
                    <strong style={{ fontSize: '0.95rem' }}>เลือก Template</strong>
                    <div role="radiogroup" aria-label="เลือก Template" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                        {ANNOUNCEMENT_TEMPLATES.map(t => {
                            const Icon = TEMPLATE_ICONS[t.icon];
                            const active = t.id === templateId;
                            return (
                                <button key={t.id} type="button" role="radio" aria-checked={active} onClick={() => pickTemplate(t.id)} style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '0.9rem 0.5rem', cursor: 'pointer', font: 'inherit', fontSize: '0.85rem',
                                    borderRadius: 12, background: active ? '#EFF6FF' : 'var(--color-white, #fff)', border: active ? '2px solid #111827' : '2px solid #E5E7EB',
                                }}>
                                    <Icon size={26} color={TEMPLATE_COLORS[t.icon]} />
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>

                    {template.fields.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                            {template.fields.map(f => (
                                <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.8rem' }}>
                                    {f.label}{f.required ? ' *' : ''}
                                    <input type={f.type} style={input} placeholder={f.placeholder} maxLength={f.type === 'text' ? 100 : undefined}
                                        value={values[f.key] ?? ''} onChange={e => changeValue(f.key, e.target.value)} />
                                </label>
                            ))}
                        </div>
                    )}
                    {edited && template.fields.length > 0 && (
                        <div><button type="button" className="btn btn-outline btn-sm" onClick={() => { setEdited(false); fill(templateId, values); }}>สร้างข้อความใหม่จากแบบฟอร์ม</button></div>
                    )}

                    <input style={input} placeholder="หัวข้อประกาศ" maxLength={ANNOUNCEMENT_LIMITS.title} value={form.title} onChange={e => { setEdited(true); setForm({ ...form, title: e.target.value }); }} />
                    <textarea style={{ ...input, minHeight: 130 }} placeholder="รายละเอียด" maxLength={ANNOUNCEMENT_LIMITS.body} value={form.body} onChange={e => { setEdited(true); setForm({ ...form, body: e.target.value }); }} />
                    {missing.length > 0 && <div style={{ fontSize: '0.8rem', color: '#B45309' }}>ยังไม่ได้กรอก: {missing.join(', ')}</div>}
                    <label style={{ fontSize: '0.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                        แสดงถึงวันที่ (ถ้าไม่ระบุ จะแสดงจนกว่าจะเก็บ)
                        <input type="datetime-local" style={{ ...input, width: 'auto' }} value={form.expires} onChange={e => setForm({ ...form, expires: e.target.value })} />
                    </label>
                    <label style={{ fontSize: '0.85rem', display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.pinned} onChange={e => setForm({ ...form, pinned: e.target.checked })} /> ปักหมุดไว้บนสุด</label>
                    <label style={{ fontSize: '0.85rem', display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.sendLine} onChange={e => setForm({ ...form, sendLine: e.target.checked })} /> ส่งเข้า LINE ลูกบ้านทุกคนทันที</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary btn-sm" disabled={busy || !form.title.trim() || !form.body.trim() || missing.length > 0} onClick={() => void publish()} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} เผยแพร่
                        </button>
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setShow(false)}>ยกเลิก</button>
                    </div>
                </div>
            )}

            {loading ? <Loader2 className="spin" /> : announcements.length === 0 ? (
                <div style={{ color: 'var(--color-gray-500)', padding: '1rem 0' }}>ยังไม่มีประกาศ</div>
            ) : announcements.map(a => (
                <div key={a.id} style={{ ...card, opacity: a.status === 'archived' ? 0.6 : 1 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {a.pinned && <Pin size={14} />}
                        <strong style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{a.title}</strong>
                        {a.status === 'archived' && <span style={{ fontSize: '0.75rem' }}>เก็บแล้ว</span>}
                    </div>
                    <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{a.body}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>
                        {when(a.created_at)} · โดย {a.created_by}{a.line_sent + a.line_failed > 0 ? ` · ส่ง LINE ${a.line_sent}/${a.line_sent + a.line_failed}` : ''}
                        {a.expires_at ? ` · แสดงถึง ${when(a.expires_at)}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => update(a, { pinned: !a.pinned })} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Pin size={13} /> {a.pinned ? 'เลิกปักหมุด' : 'ปักหมุด'}</button>
                        <button className="btn btn-outline btn-sm" onClick={() => update(a, { status: a.status === 'published' ? 'archived' : 'published' })} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <Archive size={13} /> {a.status === 'published' ? 'เก็บประกาศ' : 'แสดงอีกครั้ง'}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function AnnouncementsPage({ ownerUid, buildingId }: Props) {
    const [tab, setTab] = useState<'announcements' | 'faq'>('announcements');
    return (
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h1 style={{ margin: 0, fontSize: '1.4rem' }}>ประกาศ & ตอบอัตโนมัติ</h1>
            <div style={{ display: 'flex', gap: 6 }}>
                <button className={tab === 'announcements' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setTab('announcements')} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Megaphone size={14} /> ประกาศ</button>
                <button className={tab === 'faq' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setTab('faq')} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Bot size={14} /> ถาม-ตอบอัตโนมัติ</button>
            </div>
            {tab === 'announcements' ? <AnnouncementsTab ownerUid={ownerUid} buildingId={buildingId} /> : <FaqTab ownerUid={ownerUid} buildingId={buildingId} />}
        </div>
    );
}
