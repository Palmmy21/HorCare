/**
 * Whose organisation the app is working in.
 *
 * Someone with a HorCare account of their own may also be on other owners' teams (added through "เพิ่มสมาชิกทีม").
 * They pick a workspace: their own account (`SELF`, full owner rights on their own branches and plan) or one of the
 * teams (that owner's data, only the branches granted, with that owner's plan and the role given).
 *
 * An account an owner created for an administrator (`managed`) has no organisation of its own: it always works in a
 * team, the owner's that made it by default.
 */
export const SELF = 'self';

export interface WorkspaceMembership { owner_uid: string; managed: boolean }

export interface Workspaces<M extends WorkspaceMembership> {
  /** null = the person's own account. */
  active: M | null;
  /** The teams the person may switch to. */
  teams: M[];
  /** May the person switch to their own account? (no for an owner-created administrator account) */
  hasOwn: boolean;
}

export function pickWorkspace<M extends WorkspaceMembership>(memberships: M[], choice: string | null): Workspaces<M> {
  const managed = memberships.find(m => m.managed) ?? null;
  const hasOwn = !managed;
  const chosen = choice && choice !== SELF ? memberships.find(m => m.owner_uid === choice) ?? null : null;
  const active = chosen ?? (hasOwn ? null : managed);
  return { active, teams: memberships, hasOwn };
}

export const workspaceStorageKey = (uid: string) => `horcare_workspace_${uid}`;

/** Where the last-used branch is remembered: per workspace, so a team's branch never opens in the person's own account. */
export function activeBuildingStorageKey(uid: string, active: WorkspaceMembership | null): string {
  return !active || active.managed ? `horcare_active_building_${uid}` : `horcare_active_building_${uid}__${active.owner_uid}`;
}
