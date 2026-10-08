import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Search, Send, Loader2, ArrowLeft, MessageCircle, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { useThreadMessages } from '../../hooks/useLineThreads';
import { apiPost, ApiError } from '../../utils/api';
import { MAX_OUTGOING_CHARS, type LineMessage, type LineThread } from '../../shared/messages';

interface Props {
    ownerUid: string;
    buildingId: string;
    unitName: string;
    threads: LineThread[];
    loading: boolean;
    error: string | null;
}

const ERRORS: Record<string, string> = {
    tenant_unlinked: 'ผู้เช่าคนนี้ไม่ได้เชื่อม LINE กับห้องนี้แล้ว จึงส่งข้อความไม่ได้',
    line_not_configured: 'ยังไม่ได้ตั้งค่า LINE บนเซิร์ฟเวอร์',
    send_failed: 'ส่งข้อความทาง LINE ไม่สำเร็จ กรุณาลองใหม่',
    forbidden: 'คุณไม่มีสิทธิ์ส่งข้อความของสถานที่นี้',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
};

function when(iso: string): string {
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

// Files come back as data URLs. They never change, so keep a few in memory while scrolling
// (bounded: the oldest entry is dropped first).
const MEDIA_CACHE_MAX = 40;
const mediaCache = new Map<string, string>();

async function fetchMediaUrl(ownerUid: string, buildingId: string, lineUserId: string, messageId: string): Promise<string> {
    const key = `${ownerUid}/${buildingId}/${lineUserId}/${messageId}`;
    const hit = mediaCache.get(key);
    if (hit) return hit;
    const { data_url } = await apiPost<{ data_url: string }>('line-inbox', {
        action: 'media', owner_uid: ownerUid, building_id: buildingId, line_user_id: lineUserId, message_id: messageId,
    });
    mediaCache.set(key, data_url);
    if (mediaCache.size > MEDIA_CACHE_MAX) mediaCache.delete(mediaCache.keys().next().value as string);
    return data_url;
}

/** A tenant's photo or voice message. Files are fetched through a permission-checked signed link. */
function MediaBubble({ ownerUid, buildingId, lineUserId, message, onZoom }: {
    ownerUid: string; buildingId: string; lineUserId: string; message: LineMessage; onZoom: (url: string) => void;
}) {
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [loadingAudio, setLoadingAudio] = useState(false);
    const isImage = message.kind === 'image';

    // Photos load as soon as they appear; voice messages wait until the owner presses play.
    useEffect(() => {
        if (!isImage) return;
        let cancelled = false;
        fetchMediaUrl(ownerUid, buildingId, lineUserId, message.id)
            .then(u => { if (!cancelled) setUrl(u); })
            .catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; };
    }, [isImage, ownerUid, buildingId, lineUserId, message.id]);

    if (isImage) {
        if (failed) return <div style={{ fontSize: '0.8rem', fontStyle: 'italic' }}>โหลดรูปไม่ได้</div>;
        if (!url) return <div style={{ width: 160, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader2 size={18} className="spin" /></div>;
        return (
            <button type="button" onClick={() => onZoom(url)} aria-label="ขยายรูป" style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}>
                <img src={url} alt="รูปจากผู้เช่า" loading="lazy" style={{ maxWidth: 240, maxHeight: 280, borderRadius: 10, display: 'block' }} />
            </button>
        );
    }

    // audio
    if (url) return <audio controls autoPlay src={url} style={{ maxWidth: 240 }} />;
    return (
        <button
            type="button" disabled={loadingAudio}
            onClick={() => {
                setLoadingAudio(true);
                fetchMediaUrl(ownerUid, buildingId, lineUserId, message.id)
                    .then(setUrl)
                    .catch(() => toast.error('เปิดข้อความเสียงไม่ได้ กรุณาลองใหม่'))
                    .finally(() => setLoadingAudio(false));
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', fontWeight: 600 }}
        >
            {loadingAudio ? <Loader2 size={16} className="spin" /> : <Play size={16} />} ฟังข้อความเสียง
        </button>
    );
}

export default function MessagesPage({ ownerUid, buildingId, unitName, threads, loading, error }: Props) {
    const [zoomUrl, setZoomUrl] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    const selected = threads.find(t => t.line_user_id === selectedId) ?? null;
    const { messages, loading: msgLoading } = useThreadMessages(ownerUid, buildingId, selected?.line_user_id ?? null);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return threads;
        return threads.filter(t => `${t.room_number} ${t.tenant_name ?? ''} ${t.last_message_text}`.toLowerCase().includes(q));
    }, [threads, search]);

    // Opening a conversation (or receiving a message while it's open) marks it read.
    const unread = selected?.unread_count ?? 0;
    useEffect(() => {
        if (!selectedId || unread === 0) return;
        void apiPost('line-inbox', { action: 'mark_read', owner_uid: ownerUid, building_id: buildingId, line_user_id: selectedId }).catch(() => undefined);
    }, [selectedId, unread, ownerUid, buildingId]);

    useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length, selectedId]);

    const send = async () => {
        const text = draft.trim();
        if (!selected || !text || sending) return;
        setSending(true);
        try {
            await apiPost('line-inbox', { action: 'send', owner_uid: ownerUid, building_id: buildingId, line_user_id: selected.line_user_id, text });
            setDraft('');
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'ส่งไม่สำเร็จ');
        } finally {
            setSending(false);
        }
    };

    const showList = !selected;   // on narrow screens the two panes alternate
    const pane: React.CSSProperties = { background: 'var(--color-white)', border: '1px solid var(--color-gray-200)', borderRadius: 16, minHeight: 0 };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="page-header">
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><MessageSquare size={28} /> ข้อความ LINE</h1>
                    <p className="page-subtitle">คุยกับ{unitName}ผ่าน LINE Official Account โดยไม่ต้องออกจาก HorCare</p>
                </div>
            </div>

            <div className="messages-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: '1rem', height: 'min(68vh, 680px)' }}>
                {/* Conversation list */}
                <div className={showList ? '' : 'messages-hide-narrow'} style={{ ...pane, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--color-gray-100)', position: 'relative' }}>
                        <Search size={14} style={{ position: 'absolute', left: 22, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-gray-400)' }} />
                        <input className="form-input" style={{ width: '100%', paddingLeft: '1.9rem' }} placeholder={`ค้นหา ${unitName} / ชื่อ / ข้อความ`} value={search} onChange={e => setSearch(e.target.value)} />
                    </div>
                    <div style={{ overflowY: 'auto', flex: 1 }}>
                        {loading ? (
                            <div style={{ padding: '2rem', textAlign: 'center' }}><Loader2 size={22} className="spin" /></div>
                        ) : error ? (
                            <div role="alert" style={{ padding: '1.5rem', color: '#DC2626', textAlign: 'center' }}>{error}</div>
                        ) : filtered.length === 0 ? (
                            <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--color-gray-500)' }}>
                                <MessageCircle size={34} style={{ opacity: 0.4, margin: '0 auto 8px' }} />
                                <div>{threads.length === 0 ? 'ยังไม่มีข้อความ' : 'ไม่พบข้อความที่ตรงกัน'}</div>
                                {threads.length === 0 && <div style={{ fontSize: '0.75rem', marginTop: 4 }}>เมื่อมีคนทักมาที่ LINE จะแสดงที่นี่</div>}
                            </div>
                        ) : filtered.map(t => {
                            const on = t.line_user_id === selectedId;
                            return (
                                <button key={t.line_user_id} type="button" onClick={() => setSelectedId(t.line_user_id)} aria-current={on}
                                    style={{
                                        width: '100%', textAlign: 'left', display: 'flex', gap: 10, padding: '0.75rem', border: 'none', cursor: 'pointer',
                                        borderBottom: '1px solid var(--color-gray-100)', background: on ? 'rgba(6,199,85,0.08)' : 'transparent',
                                    }}>
                                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#06C755', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>
                                        {t.room_number.slice(0, 3)}
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                                            <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.tenant_name || `${unitName} ${t.room_number}`}</b>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--color-gray-500)', flexShrink: 0 }}>{when(t.last_message_at)}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--color-gray-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {t.last_direction === 'out' ? 'คุณ: ' : ''}{t.last_message_text}
                                            </span>
                                            {t.unread_count > 0 && (
                                                <span aria-label={`${t.unread_count} ข้อความใหม่`} style={{ background: '#EF4444', color: '#fff', borderRadius: 999, fontSize: '0.68rem', fontWeight: 800, padding: '0 6px', minWidth: 18, textAlign: 'center' }}>{t.unread_count}</span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Conversation */}
                <div className={selected ? '' : 'messages-hide-narrow'} style={{ ...pane, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {!selected ? (
                        <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--color-gray-500)' }}>
                            <MessageSquare size={40} style={{ opacity: 0.35, margin: '0 auto 8px' }} />
                            <div>เลือกผู้ส่งข้อความเพื่อดูรายละเอียด</div>
                        </div>
                    ) : (
                        <>
                            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-gray-100)', display: 'flex', gap: 10, alignItems: 'center' }}>
                                <button type="button" className="btn-icon messages-back" onClick={() => setSelectedId(null)} aria-label="กลับไปรายชื่อ"><ArrowLeft size={18} /></button>
                                <div>
                                    <b>{selected.tenant_name || `${unitName} ${selected.room_number}`}</b>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>{unitName} {selected.room_number}</div>
                                </div>
                            </div>

                            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--color-gray-50)' }}>
                                {msgLoading ? <Loader2 size={20} className="spin" style={{ margin: 'auto' }} /> : messages.map(m => {
                                    const mine = m.direction === 'out';
                                    return (
                                        <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                                            <div style={{
                                                padding: '0.5rem 0.75rem', borderRadius: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                                background: mine ? '#06C755' : '#fff', color: mine ? '#fff' : 'var(--color-gray-800)',
                                                border: mine ? 'none' : '1px solid var(--color-gray-200)', fontStyle: m.kind === 'sticker' ? 'italic' : 'normal',
                                            }}>
                                                {(m.kind === 'image' || m.kind === 'audio') && m.media ? (
                                                    <MediaBubble ownerUid={ownerUid} buildingId={buildingId} lineUserId={selected.line_user_id} message={m} onZoom={setZoomUrl} />
                                                ) : m.text}
                                            </div>
                                            <div style={{ fontSize: '0.65rem', color: 'var(--color-gray-400)', textAlign: mine ? 'right' : 'left', marginTop: 2 }}>
                                                {when(m.at)}{mine && m.by ? ` · ${m.by}` : ''}
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={bottomRef} />
                            </div>

                            <div style={{ padding: '0.75rem', borderTop: '1px solid var(--color-gray-100)' }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                                    <textarea
                                        className="form-input" rows={2} style={{ flex: 1, resize: 'none' }} maxLength={MAX_OUTGOING_CHARS}
                                        placeholder="พิมพ์ข้อความตอบกลับ (Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่)" value={draft}
                                        onChange={e => setDraft(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
                                    />
                                    <button className="btn btn-primary" onClick={() => void send()} disabled={!draft.trim() || sending} aria-label="ส่งข้อความ">
                                        {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                                    </button>
                                </div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--color-gray-400)', marginTop: 4 }}>
                                    ส่งผ่าน LINE Official Account ของหอ · {draft.length}/{MAX_OUTGOING_CHARS}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
            {zoomUrl && (
                <div onClick={() => setZoomUrl(null)} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <img src={zoomUrl} alt="รูปจากผู้เช่า" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
                </div>
            )}
            <style>{`
                .messages-back { display: none; }
                @media (max-width: 760px) {
                    .messages-grid { grid-template-columns: 1fr !important; }
                    .messages-hide-narrow { display: none !important; }
                    .messages-back { display: inline-flex; }
                }
            `}</style>
        </div>
    );
}
