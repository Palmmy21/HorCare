import { useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useCollections } from '../../hooks/useCollections';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { addDays, todayTh } from '../../shared/market';
import type { CollectionStyle } from '../../types';
import StaysView from './StaysView';
import RoundView from './RoundView';
import RatesPlansView from './RatesPlansView';

interface Props { ownerUid: string; buildingId: string; style: CollectionStyle }

type Tab = 'main' | 'rates';

/**
 * Collection for properties that do not bill monthly: a hotel / resort takes bookings and collects per stay, a market
 * collects stall fees weekly in advance or daily as the stall trades. The server prices and records everything; money
 * taken here lands in the books straight away.
 */
export default function CollectionsPage({ ownerUid, buildingId, style }: Props) {
  const stall = style === 'stall';
  const today = todayTh();
  const [from, setFrom] = useState(today);
  const [tab, setTab] = useState<Tab>('main');
  const window = useMemo(() => (stall ? { from: today, to: addDays(today, 7) } : { from, to: addDays(from, 14) }), [stall, today, from]);
  const { data, error, busy, load, call, act } = useCollections(ownerUid, buildingId, window.from, window.to);
  const { activeAccounts } = useBankAccounts(ownerUid, buildingId);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{stall ? 'เก็บเงินแผง' : 'เก็บค่าห้อง'}</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
            {stall ? 'เดินเก็บรายวัน / รายสัปดาห์ รับเงินสดหรือโอน ปิดยอดประจำวัน' : 'จองห้อง เช็กอิน–เช็กเอาต์ เก็บเงินต่อคืน สร้าง QR และแนบสลิปให้ AI อ่าน'} · ยอดที่รับจะลงสมุดบัญชีให้อัตโนมัติ
          </p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => void load()} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><RefreshCw size={14} /> โหลดใหม่</button>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button className={tab === 'main' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setTab('main')}>{stall ? 'เดินเก็บวันนี้' : 'ห้องและปฏิทินจอง'}</button>
        <button className={tab === 'rates' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setTab('rates')}>{stall ? 'ราคาและแผน' : 'ราคา'}</button>
      </div>

      {error && <div style={{ border: '1px solid #DC2626', color: '#B91C1C', borderRadius: 12, padding: '0.75rem' }}>{error}</div>}
      {!data && !error && <Loader2 className="spin" />}
      {busy && <span style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>กำลังบันทึก…</span>}

      {data && tab === 'main' && (stall
        ? <RoundView data={data} accounts={activeAccounts} canClose call={call} act={act} reload={() => void load()} />
        : <StaysView data={data} from={from} onShift={n => setFrom(f => addDays(f, n))} accounts={activeAccounts} canManage call={call} act={act} reload={() => void load()} />)}
      {data && tab === 'rates' && <RatesPlansView data={data} style={style} call={call} act={act} reload={() => void load()} />}
    </div>
  );
}
