import { useEffect, useState } from 'react';
import { Package, MapPin } from 'lucide-react';
import { PARCEL_STATUS_LABELS_TH, type TenantParcelView } from '../../shared/parcels';
import { portalPost } from './portalApi';

interface Props {
  uid: string;
  buildingId: string;
  roomId: string;
  /** The portal's own section heading component, so styling stays consistent. */
  Label: React.ComponentType<{ icon: React.ReactNode; label: string }>;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

/**
 * Tenant portal view of parcels held for this room. Shows carrier, status, date and
 * where to collect it — never the tracking number, label name or photo.
 * Renders nothing while loading, on error, or when the room has no parcels.
 */
export default function TenantParcelSection({ uid, buildingId, roomId, Label }: Props) {
  const [parcels, setParcels] = useState<TenantParcelView[]>([]);

  useEffect(() => {
    if (!uid || !buildingId || !roomId) return;
    let cancelled = false;
    // the portal link proves the room; the ids only say which property's API to ask
    portalPost<{ parcels?: TenantParcelView[] }>('parcels', { action: 'tenant_list', building_id: buildingId })
      .then(data => { if (!cancelled && data.parcels) setParcels(data.parcels); })
      .catch(() => { /* optional section — fail silently */ });
    return () => { cancelled = true; };
  }, [uid, buildingId, roomId]);

  const open = parcels.filter(p => p.status !== 'picked_up');
  const recent = parcels.filter(p => p.status === 'picked_up').slice(0, 3);
  if (open.length === 0 && recent.length === 0) return null;

  return (
    <section>
      <Label icon={<Package size={14} />} label={open.length > 0 ? `พัสดุของคุณ (${open.length} ชิ้นรอรับ)` : 'พัสดุของคุณ'} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
        {[...open, ...recent].map(p => {
          const done = p.status === 'picked_up';
          return (
            <div key={p.id} style={{
              background: '#fff', borderRadius: 14, padding: '0.75rem 0.875rem',
              border: `1px solid ${done ? '#E2E8F0' : '#FDE68A'}`, opacity: done ? 0.7 : 1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: '#0F172A', fontSize: '0.9rem' }}>{p.carrier}</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: done ? '#059669' : '#B45309' }}>{PARCEL_STATUS_LABELS_TH[p.status]}</span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: 2, display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span>มาถึง {fmt(p.received_at)}</span>
                {p.picked_up_at && <span>รับแล้ว {fmt(p.picked_up_at)}</span>}
                {!done && p.storage_location && <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}><MapPin size={12} /> {p.storage_location}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
