import { describe, expect, it } from 'vitest';
import { activeBuildingStorageKey, pickWorkspace, SELF } from './workspace';

const teamA = { owner_uid: 'owner-A', managed: false };
const teamB = { owner_uid: 'owner-B', managed: false };
const made = { owner_uid: 'owner-M', managed: true };

describe('pickWorkspace', () => {
  it('a person with no team works in their own account', () => {
    expect(pickWorkspace([], null)).toEqual({ active: null, teams: [], hasOwn: true });
    expect(pickWorkspace([], 'owner-A').active).toBeNull(); // a stale choice falls back to their own
  });

  it('an existing account on other teams opens its own account until a team is chosen', () => {
    expect(pickWorkspace([teamA, teamB], null)).toEqual({ active: null, teams: [teamA, teamB], hasOwn: true });
    expect(pickWorkspace([teamA, teamB], SELF).active).toBeNull();
    expect(pickWorkspace([teamA, teamB], 'owner-B').active).toBe(teamB);
  });

  it('a team the person was removed from is no longer chosen', () => {
    expect(pickWorkspace([teamA], 'owner-B').active).toBeNull();
  });

  it('an owner-created administrator account always works in a team, never in an own account', () => {
    expect(pickWorkspace([made], null)).toEqual({ active: made, teams: [made], hasOwn: false });
    expect(pickWorkspace([made], SELF).active).toBe(made);
    expect(pickWorkspace([made, teamA], 'owner-A').active).toBe(teamA);
  });
});

describe('activeBuildingStorageKey', () => {
  it('a team branch is remembered apart from the person\'s own', () => {
    expect(activeBuildingStorageKey('u1', null)).toBe('horcare_active_building_u1');
    expect(activeBuildingStorageKey('u1', made)).toBe('horcare_active_building_u1'); // unchanged for existing admin accounts
    expect(activeBuildingStorageKey('u1', teamA)).toBe('horcare_active_building_u1__owner-A');
  });
});
