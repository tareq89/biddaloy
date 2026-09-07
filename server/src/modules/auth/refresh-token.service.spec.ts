import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RefreshTokenService, RefreshTokenReuseDetectedException } from './refresh-token.service';

const TTL_MS = 30 * 24 * 60 * 60_000;

function fakeRepo() {
  const rows = new Map<string, any>();

  function matcher(cond: string, params: Record<string, any>) {
    // "id = :id" must be checked before the broader "_id"-suffixed cases
    // below, and via a word-boundary match rather than .includes — plain
    // .includes("id") would also match "family_id"/"user_id"/"replaced_by_id".
    if (/(^|\s)id\s*=/.test(cond)) return (row: any) => row.id === params.id;
    if (cond.includes('family_id')) return (row: any) => row.family_id === params.familyId;
    if (cond.includes('user_id')) return (row: any) => row.user_id === params.userId;
    if (cond.includes('revoked_at IS NULL')) return (row: any) => row.revoked_at === null;
    if (cond.includes('expires_at >'))
      return (row: any) => row.expires_at.getTime() > params.now.getTime();
    if (cond.includes('expires_at'))
      return (row: any) => row.expires_at.getTime() < params.now.getTime();
    return () => true;
  }

  function createQueryBuilder(alias?: string) {
    let mode: 'update' | 'delete' | 'select' | null = alias ? 'select' : null;
    let patch: any = {};
    let order: { field: string; dir: 'ASC' | 'DESC' } | null = null;
    let groupByField: string | null = null;
    const wheres: Array<(row: any) => boolean> = [];

    function stripAlias(cond: string): string {
      return alias ? cond.replace(new RegExp(`\\b${alias}\\.`, 'g'), '') : cond;
    }

    const builder: any = {
      update: () => {
        mode = 'update';
        return builder;
      },
      delete: () => {
        mode = 'delete';
        return builder;
      },
      select: () => builder,
      addSelect: () => builder,
      groupBy: (field: string) => {
        groupByField = stripAlias(field);
        return builder;
      },
      orderBy: (field: string, dir: 'ASC' | 'DESC') => {
        order = { field: stripAlias(field), dir };
        return builder;
      },
      from: () => builder,
      set: (p: any) => {
        patch = p;
        return builder;
      },
      where: (cond: string, params: any) => {
        wheres.push(matcher(stripAlias(cond), params));
        return builder;
      },
      andWhere: (cond: string, params: any) => {
        wheres.push(matcher(stripAlias(cond), params));
        return builder;
      },
      getMany: async () => {
        let matches = [...rows.values()]
          .filter((row) => wheres.every((w) => w(row)))
          .map((row) => ({ ...row }));
        if (order) {
          const { field, dir } = order;
          matches.sort((a, b) => {
            const diff = new Date(a[field]).getTime() - new Date(b[field]).getTime();
            return dir === 'ASC' ? diff : -diff;
          });
        }
        return matches;
      },
      getRawMany: async () => {
        const matches = [...rows.values()].filter((row) => wheres.every((w) => w(row)));
        if (!groupByField) return matches;
        const grouped = new Map<string, any[]>();
        for (const row of matches) {
          const key = row[groupByField];
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(row);
        }
        return [...grouped.entries()].map(([key, groupRows]) => ({
          [groupByField as string]: key,
          started_at: groupRows.reduce(
            (min, r) => (r.created_at < min ? r.created_at : min),
            groupRows[0].created_at,
          ),
        }));
      },
      execute: async () => {
        const matches = [...rows.values()].filter((row) => wheres.every((w) => w(row)));
        if (mode === 'update') {
          for (const row of matches) Object.assign(row, patch);
        } else if (mode === 'delete') {
          for (const row of matches) rows.delete(row.id);
        }
        return { affected: matches.length };
      },
    };
    return builder;
  }

  return {
    insert: vi.fn(async (row: any) => {
      // Real Postgres stamps `created_at` via @CreateDateColumn on insert —
      // this fake mirrors that so listActiveSessions' ordering/grouping has
      // something real to work with. A tiny counter (not just `new Date()`)
      // keeps successive inserts within the same millisecond distinguishable.
      rows.set(row.id, { created_at: new Date(Date.now() + rows.size), ...row });
    }),
    findOne: vi.fn(async ({ where: { id } }: any) => {
      const row = rows.get(id);
      return row ? { ...row } : null;
    }),
    update: vi.fn(async (id: string, patch: any) => {
      const row = rows.get(id);
      if (row) Object.assign(row, patch);
    }),
    count: vi.fn(async ({ where: { family_id, user_id } }: any) => {
      return [...rows.values()].filter(
        (row) => row.family_id === family_id && row.user_id === user_id,
      ).length;
    }),
    createQueryBuilder: vi.fn(createQueryBuilder),
    rows,
  };
}

function parseCookie(cookieValue: string) {
  const [id, secret] = cookieValue.split('.');
  return { id, secret };
}

describe('RefreshTokenService', () => {
  let repo: ReturnType<typeof fakeRepo>;
  let service: RefreshTokenService;
  const userId = 'user-1';

  beforeEach(() => {
    repo = fakeRepo();
    service = new RefreshTokenService(repo as any, TTL_MS);
  });

  describe('issueForUser', () => {
    it('persists a hashed row and returns a selector.validator cookie value', async () => {
      const familyId = randomUUID();
      const issued = await service.issueForUser(userId, familyId, {
        ip: '1.2.3.4',
        userAgent: 'ua',
      });

      expect(issued.cookieValue).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
      const { id } = parseCookie(issued.cookieValue);
      const row = repo.rows.get(id);
      expect(row.user_id).toBe(userId);
      expect(row.family_id).toBe(familyId);
      expect(row.token_hash).not.toContain(parseCookie(issued.cookieValue).secret);
      expect(row.revoked_at).toBeNull();
    });
  });

  describe('rotate', () => {
    async function issue() {
      const familyId = randomUUID();
      return service.issueForUser(userId, familyId, { ip: null, userAgent: null });
    }

    it('rejects a malformed cookie value with no separator', async () => {
      await expect(
        service.rotate('not-a-valid-cookie', { ip: null, userAgent: null }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown token id', async () => {
      await expect(
        service.rotate(`${randomUUID()}.${'a'.repeat(64)}`, { ip: null, userAgent: null }),
      ).rejects.toThrow('Invalid refresh token');
    });

    // A non-UUID selector would otherwise reach `WHERE id = :id` against a
    // uuid column and surface as a raw DB type error (500) instead of a
    // clean 401 — this must be rejected before the query runs at all.
    it('rejects a well-formed-looking but non-UUID selector without touching the repository', async () => {
      await expect(
        service.rotate(`${'0'.repeat(36)}.${'a'.repeat(64)}`, { ip: null, userAgent: null }),
      ).rejects.toThrow('Invalid refresh token');
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('rejects the wrong secret for a known id', async () => {
      const issued = await issue();
      const { id } = parseCookie(issued.cookieValue);

      await expect(
        service.rotate(`${id}.${'f'.repeat(64)}`, { ip: null, userAgent: null }),
      ).rejects.toThrow('Invalid refresh token');
    });

    it('rejects an expired token', async () => {
      const issued = await issue();
      const { id } = parseCookie(issued.cookieValue);
      repo.rows.get(id).expires_at = new Date(Date.now() - 1000);

      await expect(
        service.rotate(issued.cookieValue, { ip: null, userAgent: null }),
      ).rejects.toThrow('Refresh token expired');
    });

    it('rotates a valid token: revokes the old row and issues a new one in the same family', async () => {
      const issued = await issue();
      const { id: oldId } = parseCookie(issued.cookieValue);
      const familyId = repo.rows.get(oldId).family_id;

      const result = await service.rotate(issued.cookieValue, { ip: '9.9.9.9', userAgent: 'ua2' });

      expect(result.userId).toBe(userId);
      const oldRow = repo.rows.get(oldId);
      expect(oldRow.revoked_at).not.toBeNull();

      const { id: newId } = parseCookie(result.refreshToken.cookieValue);
      expect(oldRow.replaced_by_id).toBe(newId);
      const newRow = repo.rows.get(newId);
      expect(newRow.family_id).toBe(familyId);
      expect(newRow.revoked_at).toBeNull();
    });

    // Regression test for the read-then-write race a conditional UPDATE
    // closes: two concurrent requests presenting the same live token would
    // otherwise both observe revoked_at === null and both unconditionally
    // issue + write a successor, with the second write silently clobbering
    // the first's replaced_by_id. Simulated here by mutating the *live* row
    // (via a live rows.get() reference, not the snapshot rotateRow received)
    // between this call's own read and its own conditional update — exactly
    // the window a second request would land in.
    it("closes the concurrent-rotation race: a losing request re-reads instead of clobbering the winner's claim", async () => {
      const issued = await issue();
      const { id: originalId } = parseCookie(issued.cookieValue);
      const familyId = repo.rows.get(originalId).family_id;

      const concurrentWinnerId = randomUUID();
      await repo.insert({
        id: concurrentWinnerId,
        user_id: userId,
        family_id: familyId,
        token_hash: '0'.repeat(64),
        expires_at: new Date(Date.now() + TTL_MS),
        revoked_at: null,
        replaced_by_id: null,
        ip_address: null,
        user_agent: null,
      });

      const originalFindOne = repo.findOne.getMockImplementation()!;
      let sideEffectApplied = false;
      repo.findOne.mockImplementationOnce(async (query: any) => {
        const snapshot = await originalFindOne(query);
        if (!sideEffectApplied) {
          sideEffectApplied = true;
          const live = repo.rows.get(originalId);
          live.revoked_at = new Date();
          live.replaced_by_id = concurrentWinnerId;
        }
        return snapshot;
      });

      const result = await service.rotate(issued.cookieValue, { ip: null, userAgent: null });

      // The losing request must never have written to the original row —
      // it should still point at the concurrent winner's successor, not
      // whatever this call would have generated on its own.
      expect(repo.rows.get(originalId).replaced_by_id).toBe(concurrentWinnerId);

      // Instead, it must walk the grace chain forward from the winner and
      // return a fresh pair rotated from *that* row.
      const winnerRow = repo.rows.get(concurrentWinnerId);
      const { id: resultId } = parseCookie(result.refreshToken.cookieValue);
      expect(winnerRow.replaced_by_id).toBe(resultId);
      expect(result.userId).toBe(userId);
    });

    it('rejects presenting the same token twice outside the grace window: revokes the whole family', async () => {
      const issued = await issue();
      const { id: firstId } = parseCookie(issued.cookieValue);
      const familyId = repo.rows.get(firstId).family_id;

      const rotated = await service.rotate(issued.cookieValue, { ip: null, userAgent: null });
      // Push the revocation outside the grace window before replaying it.
      repo.rows.get(firstId).revoked_at = new Date(Date.now() - 60_000);

      await expect(
        service.rotate(issued.cookieValue, { ip: null, userAgent: null }),
      ).rejects.toThrow(RefreshTokenReuseDetectedException);

      // Every non-revoked row in the family — including the one just issued
      // by the rotation above — must now be revoked too.
      const { id: secondId } = parseCookie(rotated.refreshToken.cookieValue);
      expect(repo.rows.get(secondId).revoked_at).not.toBeNull();
      for (const row of repo.rows.values()) {
        if (row.family_id === familyId) {
          expect(row.revoked_at).not.toBeNull();
        }
      }
    });

    it('treats replaying the just-rotated token within the grace window as a concurrent race, not theft', async () => {
      const issued = await issue();
      const { id: firstId } = parseCookie(issued.cookieValue);

      // First caller rotates normally.
      await service.rotate(issued.cookieValue, { ip: null, userAgent: null });
      expect(repo.rows.get(firstId).revoked_at).not.toBeNull();

      // Second, near-simultaneous caller presents the same (now-revoked,
      // but within-grace) original token.
      const result = await service.rotate(issued.cookieValue, { ip: null, userAgent: null });

      expect(result.userId).toBe(userId);
      const { id: raceId } = parseCookie(result.refreshToken.cookieValue);
      expect(repo.rows.get(raceId).revoked_at).toBeNull();
    });

    it('rejects a revoked token with no successor to walk to (explicit revoke, e.g. via logout)', async () => {
      const issued = await issue();
      const { id } = parseCookie(issued.cookieValue);
      repo.rows.get(id).revoked_at = new Date(); // no replaced_by_id set

      await expect(
        service.rotate(issued.cookieValue, { ip: null, userAgent: null }),
      ).rejects.toThrow(RefreshTokenReuseDetectedException);
    });
  });

  describe('revokeByCookieValue', () => {
    it('revokes a live token and returns its user id', async () => {
      const familyId = randomUUID();
      const issued = await service.issueForUser(userId, familyId, { ip: null, userAgent: null });

      const result = await service.revokeByCookieValue(issued.cookieValue);

      expect(result).toBe(userId);
      const { id } = parseCookie(issued.cookieValue);
      expect(repo.rows.get(id).revoked_at).not.toBeNull();
    });

    it('returns null for a malformed cookie value', async () => {
      expect(await service.revokeByCookieValue('garbage')).toBeNull();
    });

    it('returns null for an unknown token', async () => {
      expect(await service.revokeByCookieValue(`${randomUUID()}.${'a'.repeat(64)}`)).toBeNull();
    });

    it('returns null for an already-revoked token', async () => {
      const familyId = randomUUID();
      const issued = await service.issueForUser(userId, familyId, { ip: null, userAgent: null });
      await service.revokeByCookieValue(issued.cookieValue);

      expect(await service.revokeByCookieValue(issued.cookieValue)).toBeNull();
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every live token for the user, leaving other users untouched', async () => {
      const otherUserId = 'user-2';
      const mine = await service.issueForUser(userId, randomUUID(), { ip: null, userAgent: null });
      const theirs = await service.issueForUser(otherUserId, randomUUID(), {
        ip: null,
        userAgent: null,
      });

      await service.revokeAllForUser(userId);

      expect(repo.rows.get(parseCookie(mine.cookieValue).id).revoked_at).not.toBeNull();
      expect(repo.rows.get(parseCookie(theirs.cookieValue).id).revoked_at).toBeNull();
    });
  });

  describe('listActiveSessions', () => {
    it('returns one row per live, unexpired family and excludes revoked/expired/other-user rows', async () => {
      const otherUserId = 'user-2';
      const familyA = randomUUID();
      const familyB = randomUUID();

      const a = await service.issueForUser(userId, familyA, { ip: '1.1.1.1', userAgent: 'ua-a' });
      const b = await service.issueForUser(userId, familyB, { ip: '2.2.2.2', userAgent: 'ua-b' });
      await service.issueForUser(otherUserId, randomUUID(), { ip: null, userAgent: null });

      // Family A is revoked (e.g. a prior sign-out) — must be excluded.
      const { id: aId } = parseCookie(a.cookieValue);
      repo.rows.get(aId).revoked_at = new Date();

      // Family B rotates once: the predecessor is revoked, the successor is
      // live — listActiveSessions must return exactly one row for B, whose
      // `startedAt` is the family's *first* row, not the rotated one's.
      const rotated = await service.rotate(b.cookieValue, { ip: '2.2.2.2', userAgent: 'ua-b' });

      const sessions = await service.listActiveSessions(userId);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].familyId).toBe(familyB);
      expect(sessions[0].userAgent).toBe('ua-b');
      const { id: rotatedId } = parseCookie(rotated.refreshToken.cookieValue);
      const { id: originalBId } = parseCookie(b.cookieValue);
      expect(sessions[0].lastUsedAt).toEqual(repo.rows.get(rotatedId).created_at);
      expect(sessions[0].startedAt).toEqual(repo.rows.get(originalBId).created_at);
    });

    it('excludes an expired-but-not-revoked family', async () => {
      const familyId = randomUUID();
      const issued = await service.issueForUser(userId, familyId, { ip: null, userAgent: null });
      const { id } = parseCookie(issued.cookieValue);
      repo.rows.get(id).expires_at = new Date(Date.now() - 1000);

      expect(await service.listActiveSessions(userId)).toHaveLength(0);
    });
  });

  describe('familyIdForCookie', () => {
    it('returns the family id for a valid, live cookie', async () => {
      const familyId = randomUUID();
      const issued = await service.issueForUser(userId, familyId, { ip: null, userAgent: null });

      expect(await service.familyIdForCookie(issued.cookieValue)).toBe(familyId);
    });

    it('returns null for undefined, malformed, or unknown cookies', async () => {
      expect(await service.familyIdForCookie(undefined)).toBeNull();
      expect(await service.familyIdForCookie('garbage')).toBeNull();
      expect(await service.familyIdForCookie(`${randomUUID()}.${'a'.repeat(64)}`)).toBeNull();
    });

    it('returns null on a hash mismatch and does not revoke anything', async () => {
      const familyId = randomUUID();
      const issued = await service.issueForUser(userId, familyId, { ip: null, userAgent: null });
      const { id } = parseCookie(issued.cookieValue);

      const result = await service.familyIdForCookie(`${id}.${'f'.repeat(64)}`);

      expect(result).toBeNull();
      expect(repo.rows.get(id).revoked_at).toBeNull();
    });
  });

  describe('countForFamily', () => {
    it('counts only rows for the given user and family', async () => {
      const familyId = randomUUID();
      await service.issueForUser(userId, familyId, { ip: null, userAgent: null });
      await service.issueForUser('user-2', randomUUID(), { ip: null, userAgent: null });

      expect(await service.countForFamily(familyId, userId)).toBe(1);
      expect(await service.countForFamily(familyId, 'user-2')).toBe(0);
      expect(await service.countForFamily(randomUUID(), userId)).toBe(0);
    });
  });

  describe('cleanupExpired', () => {
    it('deletes only rows past their expiry, revoked or not', async () => {
      const live = await service.issueForUser(userId, randomUUID(), { ip: null, userAgent: null });
      const expiredButLive = await service.issueForUser(userId, randomUUID(), {
        ip: null,
        userAgent: null,
      });
      const expiredAndRevoked = await service.issueForUser(userId, randomUUID(), {
        ip: null,
        userAgent: null,
      });

      repo.rows.get(parseCookie(expiredButLive.cookieValue).id).expires_at = new Date(
        Date.now() - 1000,
      );
      const revokedRow = repo.rows.get(parseCookie(expiredAndRevoked.cookieValue).id);
      revokedRow.expires_at = new Date(Date.now() - 1000);
      revokedRow.revoked_at = new Date(Date.now() - 500);

      const deleted = await service.cleanupExpired();

      expect(deleted).toBe(2);
      expect(repo.rows.has(parseCookie(live.cookieValue).id)).toBe(true);
      expect(repo.rows.has(parseCookie(expiredButLive.cookieValue).id)).toBe(false);
      expect(repo.rows.has(parseCookie(expiredAndRevoked.cookieValue).id)).toBe(false);
    });
  });
});
