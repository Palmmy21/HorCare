import { useEffect, useState } from 'react';
import { Megaphone, Pin } from 'lucide-react';
import type { TenantAnnouncementView } from '../../shared/chatbot';

interface Props {
  uid: string;
  buildingId: string;
  roomId: string;
  Label: React.ComponentType<{ icon: React.ReactNode; label: string }>;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

/** Notices from the property. Renders nothing while loading, on error, or when there are none. */
export default function TenantAnnouncementSection({ uid, buildingId, roomId, Label }: Props) {
  const [items, setItems] = useState<TenantAnnouncementView[]>([]);

  useEffect(() => {
    if (!uid || !buildingId || !roomId) return;
    let cancelled = false;
    fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tenant_list', owner_uid: uid, building_id: buildingId, room_id: roomId }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((data: { announcements?: TenantAnnouncementView[] } | null) => { if (!cancelled && data?.announcements) setItems(data.announcements); })
      .catch(() => { /* optional section */ });
    return () => { cancelled = true; };
  }, [uid, buildingId, roomId]);

  if (items.length === 0) return null;

  return (
    <section>
      <Label icon={<Megaphone size={14} />} label="ประกาศจากเจ้าของ" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
        {items.slice(0, 5).map(a => (
          <div key={a.id} style={{ padding: '0.75rem', borderRadius: 12, background: 'var(--card-bg, #fff)', border: '1px solid rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 700 }}>
              {a.pinned && <Pin size={13} />}<span style={{ overflowWrap: 'anywhere' }}>{a.title}</span>
            </div>
            <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 4 }}>{a.body}</div>
            <div style={{ fontSize: '0.72rem', opacity: 0.6, marginTop: 4 }}>{fmt(a.created_at)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
