import { useMemo } from 'react';
import type { DormConfig, MonthlyBill, MaintenanceRequest, CleaningRequest, Room } from '../../types';
import { tenantGroups, type FloorPlan } from '../../shared/floorPlan';
import { unitMark, type PlanLayer, type UnitMark } from '../../shared/planLayers';
import type { Occupancy, RoomStatus } from '../../shared/roomOccupancy';
import type { RoundStatus } from '../../shared/collections';
import { todayTh } from '../../shared/market';
import type { WorkspaceTerms } from '../../utils/workspaceTerminology';
import type { BoardUnit } from './FloorPlanBoard';

const OPEN_MAINTENANCE = new Set(['open', 'in_progress']);
const OPEN_CLEANING = new Set(['open', 'pending', 'assigned', 'in_progress']);

/** Types whose units are let to businesses: the tile shows the shop / company instead of only a number. */
export const showsTenantOnTile = (t?: DormConfig['building_type']) => t === 'commercial' || t === 'office' || t === 'condo';

export interface PlanInputs {
  plan: FloorPlan;
  rooms: Room[];
  occupancy: Record<string, Occupancy>;
  termsByRoom: Record<string, { tenant?: string; end?: string }>;
  /** Bills of the month the payment layer shows. */
  monthBills: MonthlyBill[];
  maintenance: MaintenanceRequest[];
  cleaning: CleaningRequest[];
  todayByRoom?: Record<string, RoundStatus>;
  layer: PlanLayer;
  terms: WorkspaceTerms;
}

/** Everything the board draws: the tiles' text, each unit's mark for the chosen layer, and units of one tenant. */
export function usePlanView({ plan, rooms, occupancy, termsByRoom, monthBills, maintenance, cleaning, todayByRoom, layer, terms }: PlanInputs) {
  return useMemo(() => {
    const today = todayTh();
    const statusOf = (id: string): RoomStatus => occupancy[id]?.status ?? 'vacant';
    const billByRoom = new Map(monthBills.filter(b => b.is_saved).map(b => [b.room_id, b]));
    const jobs = new Map<string, number>();
    for (const r of maintenance) if (OPEN_MAINTENANCE.has(r.status)) jobs.set(r.room_id, (jobs.get(r.room_id) ?? 0) + 1);
    for (const r of cleaning) if (r.room_id && OPEN_CLEANING.has(r.status)) jobs.set(r.room_id, (jobs.get(r.room_id) ?? 0) + 1);
    const tileTenant = showsTenantOnTile(terms.buildingType);
    const labels = { occupied: terms.occupiedUnitLabel, vacant: terms.vacantUnitLabel, reserved: terms.reservedUnitLabel };

    const units: Record<string, BoardUnit> = {};
    const marks: Record<string, UnitMark> = {};
    const tenantOf: Record<string, string | undefined> = {};
    for (const r of rooms) {
      if (!r.is_active) continue;
      const status = statusOf(r.id);
      const tenant = status === 'occupied' ? termsByRoom[r.id]?.tenant : undefined;
      tenantOf[r.id] = tenant;
      units[r.id] = {
        id: r.id,
        number: r.room_number,
        sub: tileTenant ? tenant ?? (status === 'vacant' ? undefined : r.business_type) : terms.isMarket ? r.business_type ?? tenant : undefined,
        meta: r.area_sqm ? `${r.area_sqm.toLocaleString('th-TH')} ตร.ม.` : undefined,
      };
      const bill = billByRoom.get(r.id);
      marks[r.id] = unitMark(layer, {
        status,
        bill: bill ? { payment_status: bill.payment_status, total: bill.total_bill } : null,
        contractEnd: termsByRoom[r.id]?.end,
        openJobs: jobs.get(r.id) ?? 0,
        today: todayByRoom?.[r.id],
      }, today, labels);
    }

    const active = rooms.filter(r => r.is_active);
    const occupied = active.filter(r => statusOf(r.id) === 'occupied');
    const withArea = active.filter(r => (r.area_sqm ?? 0) > 0);
    const area = withArea.reduce((s, r) => s + (r.area_sqm ?? 0), 0);
    const areaLet = withArea.filter(r => statusOf(r.id) === 'occupied').reduce((s, r) => s + (r.area_sqm ?? 0), 0);

    return {
      units, marks, jobs,
      groups: tenantGroups(plan, tenantOf),
      summary: {
        total: active.length,
        occupied: occupied.length,
        occupancyPct: active.length ? Math.round((occupied.length / active.length) * 100) : 0,
        area, areaLet,
      },
    };
  }, [plan, rooms, occupancy, termsByRoom, monthBills, maintenance, cleaning, todayByRoom, layer, terms]);
}
