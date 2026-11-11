import { describe, expect, it } from 'vitest';
import { legendOf, unitMark, type UnitFacts } from './planLayers';

const L = { occupied: 'มีผู้เช่า', vacant: 'ว่าง', reserved: 'ติดจอง' };
const today = '2026-10-26';
const f = (over: Partial<UnitFacts> = {}): UnitFacts => ({ status: 'occupied', openJobs: 0, ...over });

describe('unitMark', () => {
  it('payment: paid / slip waiting / unpaid, and no bill yet', () => {
    expect(unitMark('payment', f({ bill: { payment_status: 'paid', total: 1 } }), today, L).tone).toBe('good');
    expect(unitMark('payment', f({ bill: { payment_status: 'pending', total: 1 } }), today, L).label).toBe('รอตรวจสลิป');
    expect(unitMark('payment', f({ bill: { total: 1 } }), today, L).tone).toBe('bad');
    expect(unitMark('payment', f(), today, L).label).toBe('ยังไม่มีบิล');
    expect(unitMark('payment', f({ status: 'vacant' }), today, L).tone).toBe('muted');
  });
  it('contract: days left inside 90, ended, and a vacant unit is just vacant', () => {
    expect(unitMark('contract', f({ contractEnd: '2026-11-25' }), today, L).label).toBe('เหลือ 30 วัน');
    expect(unitMark('contract', f({ contractEnd: '2026-10-01' }), today, L).tone).toBe('bad');
    expect(unitMark('contract', f({ status: 'vacant', contractEnd: '2026-10-01' }), today, L).tone).toBe('muted');
  });
  it('jobs and the market day', () => {
    expect(unitMark('jobs', f({ openJobs: 2 }), today, L).label).toBe('งานค้าง 2');
    expect(unitMark('today', f({ today: 'paid' }), today, L).tone).toBe('good');
    expect(unitMark('today', f({ today: 'not_trading' }), today, L).label).toBe('รายเดือน');
  });
});

describe('legendOf', () => {
  it('counts each label, problems first', () => {
    const marks = [unitMark('jobs', f(), today, L), unitMark('jobs', f({ openJobs: 1 }), today, L), unitMark('jobs', f(), today, L)];
    expect(legendOf(marks)).toEqual([
      { tone: 'warn', label: 'งานค้าง 1', icon: 'wrench', count: 1 },
      { tone: 'base', label: 'ไม่มีงานค้าง', icon: 'none', count: 2 },
    ]);
  });
});

describe('layer names follow the property', () => {
    it('a dorm keeps "การเข้าพัก"; a market and a shophouse are rented', async () => {
        const { layerLabel, occupancyRateLabel } = await import('./planLayers');
        expect(layerLabel('occupancy', 'ห้อง')).toBe('การเข้าพัก');
        expect(layerLabel('occupancy', 'แผง')).toBe('การเช่าแผง');
        expect(layerLabel('occupancy', 'คูหา')).toBe('การเช่าคูหา');
        expect(layerLabel('payment', 'แผง')).toBe('การจ่ายเงิน');
        expect(occupancyRateLabel('ห้อง')).toBe('อัตราเข้าพัก');
        expect(occupancyRateLabel('แผง')).toBe('อัตราการเช่าแผง');
    });
});
