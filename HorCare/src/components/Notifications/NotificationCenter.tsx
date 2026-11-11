import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, BellRing, Check, Settings2, X } from 'lucide-react';
import type { Inbox } from '../../hooks/useInbox';
import { ALERT_INFO, alertTypesFor, wantsAlert, wantsPush, type InboxItem } from '../../shared/alerts';
import type { Permission } from '../../shared/permissions';
import type { NotifPermission } from '../../hooks/usePushNotification';

function ago(iso: string): string {
    const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (min < 1) return 'เมื่อสักครู่';
    if (min < 60) return `${min} นาทีที่แล้ว`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} ชม.ที่แล้ว`;
    return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

interface BellProps {
    inbox: Inbox;
    /** null = the owner. Decides which switches are shown: only kinds this account can be sent. */
    permissions: readonly Permission[] | null;
    /** Open the screen an alert points at (an in-app link such as /?view=operations&tab=team). */
    onOpen: (url: string) => void;
    /** The device's permission for notifications outside the app, and how to ask for it. */
    pushPermission: NotifPermission;
    onEnablePush: () => void;
    className?: string;
}

/**
 * The bell: how many alerts are new, the recent list, and this person's own switches — here rather than in Settings,
 * because accounting, front desk, housekeepers and technicians cannot open Settings but still choose what reaches them.
 */
export function NotificationBell({ inbox, permissions, onOpen, pushPermission, onEnablePush, className }: BellProps) {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<'list' | 'settings'>('list');
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const away = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', away);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
    }, [open]);

    // A notification tapped outside the app (the phone's own notification) asks the open app to show that screen.
    const onOpenRef = useRef(onOpen);
    useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);
    useEffect(() => {
        if (!('serviceWorker' in navigator)) return;
        const heard = (e: MessageEvent) => {
            const d = e.data as { type?: string; url?: unknown } | null;
            if (d?.type === 'HORCARE_OPEN_URL' && typeof d.url === 'string') onOpenRef.current(d.url);
        };
        navigator.serviceWorker.addEventListener('message', heard);
        return () => navigator.serviceWorker.removeEventListener('message', heard);
    }, []);

    const toggle = () => {
        if (open) inbox.markAllSeen();
        setOpen(o => !o);
        setTab('list');
    };
    const go = (item: InboxItem) => { inbox.markAllSeen(); setOpen(false); onOpen(item.url); };
    const types = alertTypesFor(permissions);
    const pushOn = wantsPush(inbox.prefs);

    return (
        <div className={`notif-bell ${className ?? ''}`} ref={root}>
            <button type="button" className="notif-bell-btn" onClick={toggle} aria-label={`การแจ้งเตือน${inbox.unread ? ` ${inbox.unread} รายการใหม่` : ''}`} aria-expanded={open}>
                {inbox.unread > 0 ? <BellRing size={20} aria-hidden /> : <Bell size={20} aria-hidden />}
                {inbox.unread > 0 && <span className="notif-badge" aria-hidden>{inbox.unread > 9 ? '9+' : inbox.unread}</span>}
            </button>

            {open && (
                <div className="notif-panel" role="dialog" aria-label="การแจ้งเตือน">
                    <div className="notif-panel-head">
                        <strong>{tab === 'list' ? 'การแจ้งเตือน' : 'เลือกสิ่งที่จะแจ้งเตือน'}</strong>
                        <button type="button" className="notif-icon-btn" onClick={() => setTab(tab === 'list' ? 'settings' : 'list')}
                            aria-label={tab === 'list' ? 'ตั้งค่าการแจ้งเตือน' : 'กลับไปรายการ'}>
                            {tab === 'list' ? <Settings2 size={18} aria-hidden /> : <X size={18} aria-hidden />}
                        </button>
                    </div>

                    {tab === 'list' ? (
                        inbox.items.length === 0 ? (
                            <p className="notif-empty">ยังไม่มีการแจ้งเตือน เมื่อมีงานใหม่ แชท หรือเงินเข้า จะขึ้นที่นี่ทันที</p>
                        ) : (
                            <ul className="notif-list">
                                {inbox.items.map(i => (
                                    <li key={i.id}>
                                        <button type="button" className="notif-item" onClick={() => go(i)}>
                                            <span className="notif-item-title">{i.title}</span>
                                            {i.body && <span className="notif-item-body">{i.body}</span>}
                                            <span className="notif-item-when">{ALERT_INFO[i.type]?.label ?? ''} · {ago(i.created_at)}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )
                    ) : (
                        <div className="notif-settings">
                            <div className="notif-push">
                                {pushPermission === 'granted' ? (
                                    <label className="notif-switch">
                                        <span>
                                            <strong>แจ้งเตือนแม้ปิดแอป</strong>
                                            <small>เด้งบนเครื่องนี้เหมือนแอปทั่วไป แม้ไม่ได้เปิด HorCare อยู่</small>
                                        </span>
                                        <input type="checkbox" checked={pushOn} onChange={e => inbox.setPref('push', e.target.checked)} />
                                    </label>
                                ) : pushPermission === 'denied' ? (
                                    <p className="notif-note"><BellOff size={16} aria-hidden /> เครื่องนี้ปิดการแจ้งเตือนของ HorCare ไว้ เปิดได้ที่การตั้งค่าเว็บไซต์ของเบราว์เซอร์ แล้วโหลดหน้าใหม่</p>
                                ) : pushPermission === 'unsupported' ? (
                                    <p className="notif-note"><BellOff size={16} aria-hidden /> เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนนอกแอป บน iPhone ให้ “เพิ่มไปยังหน้าจอโฮม” ก่อน</p>
                                ) : (
                                    <button type="button" className="btn btn-primary btn-sm" onClick={onEnablePush}><BellRing size={15} aria-hidden /> เปิดแจ้งเตือนแม้ปิดแอป</button>
                                )}
                            </div>
                            {types.map(t => (
                                <label key={t} className="notif-switch">
                                    <span>
                                        <strong>{ALERT_INFO[t].label}</strong>
                                        <small>{ALERT_INFO[t].hint}</small>
                                    </span>
                                    <input type="checkbox" checked={wantsAlert(inbox.prefs, t)} onChange={e => inbox.setPref(t, e.target.checked)} />
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/** Alerts that arrive while the app is open pop up here, without a reload. */
export function InboxToasts({ inbox, onOpen, skip }: { inbox: Inbox; onOpen: (url: string) => void; skip?: (item: InboxItem) => boolean }) {
    const shown = inbox.fresh.filter(i => !skip?.(i));
    const newest = shown[0]?.id;

    // each toast leaves by itself after a few seconds
    useEffect(() => {
        if (inbox.fresh.length === 0) return;
        const last = inbox.fresh[inbox.fresh.length - 1].id;
        const timer = setTimeout(() => inbox.dismissFresh(last), 7000);
        return () => clearTimeout(timer);
    }, [inbox]);

    // a short chime for a new one (silently skipped until the page has been tapped once: browsers require that)
    useEffect(() => {
        if (!newest) return;
        try {
            const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            const ctx = new Ctx();
            const now = ctx.currentTime;
            [880, 1100].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, now + i * 0.16);
                gain.gain.linearRampToValueAtTime(0.2, now + i * 0.16 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.16 + 0.3);
                osc.start(now + i * 0.16);
                osc.stop(now + i * 0.16 + 0.3);
            });
            setTimeout(() => void ctx.close().catch(() => undefined), 1000);
        } catch { /* no sound is fine */ }
    }, [newest]);

    if (shown.length === 0) return null;
    return (
        <div className="notif-toasts" role="status" aria-live="polite">
            {shown.map(i => (
                <div key={i.id} className="notif-toast">
                    <button type="button" className="notif-toast-main" onClick={() => { inbox.dismissFresh(i.id); onOpen(i.url); }}>
                        <span className="notif-item-title">{i.title}</span>
                        {i.body && <span className="notif-item-body">{i.body}</span>}
                    </button>
                    <button type="button" className="notif-icon-btn" onClick={() => inbox.dismissFresh(i.id)} aria-label="ปิด"><Check size={16} aria-hidden /></button>
                </div>
            ))}
        </div>
    );
}
