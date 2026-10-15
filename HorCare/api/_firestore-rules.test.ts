// @vitest-environment node
// There is no Firestore emulator in this project, so these tests read firestore.rules as text and guard the one property
// that must never regress: staff can reach a building only through a permission granted ON THAT BUILDING.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// comments are not rules: strip them so a word in a comment cannot fail (or satisfy) a check
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8').split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');

/** Every `allow … ;` statement with its text, so multi-line conditions are checked as one. */
const statements = [...rules.matchAll(/allow\s+([a-z, ]+):\s*if\s+([\s\S]*?);/g)].map(m => ({ ops: m[1].replace(/\s/g, ''), cond: m[2].replace(/\s+/g, ' ') }));

describe('firestore.rules: staff are scoped to their buildings', () => {
  it('finds the rules', () => {
    expect(statements.length).toBeGreaterThan(40);
  });

  it('a permission check that is not tied to one building also demands an organisation-wide grant', () => {
    const loose = statements.filter(s => /memberHasPerm\(/.test(s.cond));
    expect(loose.length).toBeGreaterThan(0); // ledgers, accounting, audit log, member list
    for (const s of loose) {
      expect(s.cond, s.cond).toMatch(/memberAll\(|memberCoversAll\(/);
    }
  });

  it('every write open to staff goes through a per-building check', () => {
    const writes = statements.filter(s => /(^|,)(write|create|update|delete)(,|$)/.test(s.ops) && /member(Can|HasPerm|HasPermOn|All)\(|activeMember\(/.test(s.cond));
    expect(writes.length).toBeGreaterThan(8);
    for (const s of writes) {
      expect(s.cond, s.cond).toMatch(/memberCan\(userId, buildingId,|memberHasPermOn\(userId, buildingId,|activeMember\(userId\)/);
      expect(s.cond, s.cond).not.toMatch(/memberHasPerm\(userId,/);
    }
  });

  it('staff can never create, rename or delete a building, nor touch the legacy owner-level paths', () => {
    const building = rules.slice(rules.indexOf('match /buildings/{buildingId}'));
    const head = building.slice(0, building.indexOf('match /rooms/'));
    expect(head).toMatch(/allow write: if isOwner\(userId\) && isNotBanned\(\) && licenseActive\(userId\);/);
    expect(head).not.toMatch(/member/);
    const legacy = rules.slice(rules.indexOf('Legacy flat paths'));
    expect(legacy).not.toMatch(/member(Can|HasPerm|All)/);
  });

  it('what staff may change needs the organisation\'s licence like the owner\'s own writes', () => {
    const body = rules.slice(rules.indexOf('function memberCan'), rules.indexOf('function memberCan') + 300);
    expect(body).toContain('licenseActive(ownerId)');
  });
});
