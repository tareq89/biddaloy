import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { RefreshTokenService, RefreshTokenReuseDetectedException } from "./refresh-token.service";

const TTL_MS = 30 * 24 * 60 * 60_000;

function fakeRepo() {
  const rows = new Map<string, any>();

  function matcher(cond: string, params: Record<string, any>) {
    if (cond.includes("family_id")) return (row: any) => row.family_id === params.familyId;
    if (cond.includes("user_id")) return (row: any) => row.user_id === params.userId;
    if (cond.includes("revoked_at IS NULL")) return (row: any) => row.revoked_at === null;
    if (cond.includes("expires_at")) return (row: any) => row.expires_at.getTime() < params.now.getTime();
    return () => true;
  }

  function createQueryBuilder() {
    let mode: "update" | "delete" | null = null;
    let patch: any = {};
    const wheres: Array<(row: any) => boolean> = [];

    const builder: any = {
      update: () => {
        mode = "update";
        return builder;
      },
      delete: () => {
        mode = "delete";
        return builder;
      },
      from: () => builder,
      set: (p: any) => {
        patch = p;
        return builder;
      },
      where: (cond: string, params: any) => {
        wheres.push(matcher(cond, params));
        return builder;
      },
      andWhere: (cond: string, params: any) => {
        wheres.push(matcher(cond, params));
        return builder;
      },
      execute: async () => {
        const matches = [...rows.values()].filter((row) => wheres.every((w) => w(row)));
        if (mode === "update") {
          for (const row of matches) Object.assign(row, patch);
        } else if (mode === "delete") {
          for (const row of matches) rows.delete(row.id);
        }
        return { affected: matches.length };
      },
    };
    return builder;
  }

  return {
    insert: vi.fn(async (row: any) => {
      rows.set(row.id, { ...row });
    }),
    findOne: vi.fn(async ({ where: { id } }: any) => {
      const row = rows.get(id);
      return row ? { ...row } : null;
    }),
    update: vi.fn(async (id: string, patch: any) => {
      const row = rows.get(id);
      if (row) Object.assign(row, patch);
    }),
    createQueryBuilder: vi.fn(createQueryBuilder),
    rows,
  };
}

function parseCookie(cookieValue: string) {
  const [id, secret] = cookieValue.split(".");
  return { id, secret };
}

describe("RefreshTokenService", () => {
  let repo: ReturnType<typeof fakeRepo>;
  let service: RefreshTokenService;
  const userId = "user-1";

  beforeEach(() => {
    repo = fakeRepo();
    service = new RefreshTokenService(repo as any, TTL_MS);
  });

  describe("issueForUser", () => {
    it("persists a hashed row and returns a selector.validator cookie value", async () => {
      const familyId = randomUUID();
      const issued = await service.issueForUser(userId, familyId, { ip: "1.2.3.4", userAgent: "ua" });

      expect(issued.cookieValue).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
      const { id } = parseCookie(issued.cookieValue);
      const row = repo.rows.get(id);
      expect(row.user_id).toBe(userId);
      expect(row.family_id).toBe(familyId);
      expect(row.token_hash).not.toContain(parseCookie(issued.cookieValue).secret);
      expect(row.revoked_at).toBeNull();
    });
  });

  describe("rotate", () => {
    async function issue() {
      const familyId = randomUUID();
      return service.issueForUser(userId, familyId, { ip: null, userAgent: null });
    }

    it("rejects a malformed cookie value with no separator", async () => {
      await expect(service.rotate("not-a-valid-cookie", { ip: null, userAgent: null })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejects an unknown token id", async () => {
      await expect(
        service.rotate(`${randomUUID()}.${"a".repeat(64)}`, { ip: null, userAgent: null }),
      ).rejects.toThrow("Invalid refresh token");
    });

    // A non-UUID selector would otherwise reach `WHERE id = :id` against a
    // uuid column and surface as a raw DB type error (500) instead of a
    // clean 401 — this must be rejected before the query runs at all.
    it("rejects a well-formed-looking but non-UUID selector without touching the repository", async () => {
      await expect(
        service.rotate(`${"0".repeat(36)}.${"a".repeat(64)}`, { ip: null, userAgent: null }),
      ).rejects.toThrow("Invalid refresh token");
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it("rejects the wrong secret for a known id", async () => {
      const issued = await issue();
      const { id } = parseCookie(issued.cookieValue);

      await expect(service.rotate(`${id}.${"f".repeat(64)}`, { ip: null, userAgent: null })).rejects.toThrow(
        "Invalid refresh token",
      );
    });

    it("rejects an expired token", async () => {
      const issued = await issue();
      const { id } = parseCookie(issued.cookieValue);
      repo.rows.get(id).expires_at = new Date(Date.now() - 1000);

      await expect(service.rotate(issued.cookieValue, { ip: null, userAgent: null })).rejects.toThrow(
        "Refresh token expired",
      );
    });

    it("rotates a valid token: revokes the old row and issues a new one in the same family", async () => {
      const issued = await issue();
      const { id: oldId } = parseCookie(issued.cookieValue);
      const familyId = repo.rows.get(oldId).family_id;

      const result = await service.rotate(issued.cookieValue, { ip: "9.9.9.9", userAgent: "ua2" });

      expect(result.userId).toBe(userId);
      const oldRow = repo.rows.get(oldId);
      expect(oldRow.revoked_at).not.toBeNull();

      const { id: newId } = parseCookie(result.refreshToken.cookieValue);
      expect(oldRow.replaced_by_id).toBe(newId);
      const newRow = repo.rows.get(newId);
      expect(newRow.family_id).toBe(familyId);
      expect(newRow.revoked_at).toBeNull();
    });

    it("rejects presenting the same token twice outside the grace window: revokes the whole family", async () => {
      const issued = await issue();
      const { id: firstId } = parseCookie(issued.cookieValue);
      const familyId = repo.rows.get(firstId).family_id;

      const rotated = await service.rotate(issued.cookieValue, { ip: null, userAgent: null });
      // Push the revocation outside the grace window before replaying it.
      repo.rows.get(firstId).revoked_at = new Date(Date.now() - 60_000);

      await expect(service.rotate(issued.cookieValue, { ip: null, userAgent: null })).rejects.toThrow(
        RefreshTokenReuseDetectedException,
      );

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

    it("treats replaying the just-rotated token within the grace window as a concurrent race, not theft", async () => {
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

    it("rejects a revoked token with no successor to walk to (explicit revoke, e.g. via logout)", async () => {
      const issued = await issue();
      const { id } = parseCookie(issued.cookieValue);
      repo.rows.get(id).revoked_at = new Date(); // no replaced_by_id set

      await expect(service.rotate(issued.cookieValue, { ip: null, userAgent: null })).rejects.toThrow(
        RefreshTokenReuseDetectedException,
      );
    });
  });

  describe("revokeByCookieValue", () => {
    it("revokes a live token and returns its user id", async () => {
      const familyId = randomUUID();
      const issued = await service.issueForUser(userId, familyId, { ip: null, userAgent: null });

      const result = await service.revokeByCookieValue(issued.cookieValue);

      expect(result).toBe(userId);
      const { id } = parseCookie(issued.cookieValue);
      expect(repo.rows.get(id).revoked_at).not.toBeNull();
    });

    it("returns null for a malformed cookie value", async () => {
      expect(await service.revokeByCookieValue("garbage")).toBeNull();
    });

    it("returns null for an unknown token", async () => {
      expect(await service.revokeByCookieValue(`${randomUUID()}.${"a".repeat(64)}`)).toBeNull();
    });

    it("returns null for an already-revoked token", async () => {
      const familyId = randomUUID();
      const issued = await service.issueForUser(userId, familyId, { ip: null, userAgent: null });
      await service.revokeByCookieValue(issued.cookieValue);

      expect(await service.revokeByCookieValue(issued.cookieValue)).toBeNull();
    });
  });

  describe("revokeAllForUser", () => {
    it("revokes every live token for the user, leaving other users untouched", async () => {
      const otherUserId = "user-2";
      const mine = await service.issueForUser(userId, randomUUID(), { ip: null, userAgent: null });
      const theirs = await service.issueForUser(otherUserId, randomUUID(), { ip: null, userAgent: null });

      await service.revokeAllForUser(userId);

      expect(repo.rows.get(parseCookie(mine.cookieValue).id).revoked_at).not.toBeNull();
      expect(repo.rows.get(parseCookie(theirs.cookieValue).id).revoked_at).toBeNull();
    });
  });

  describe("cleanupExpired", () => {
    it("deletes only rows past their expiry, revoked or not", async () => {
      const live = await service.issueForUser(userId, randomUUID(), { ip: null, userAgent: null });
      const expiredButLive = await service.issueForUser(userId, randomUUID(), { ip: null, userAgent: null });
      const expiredAndRevoked = await service.issueForUser(userId, randomUUID(), { ip: null, userAgent: null });

      repo.rows.get(parseCookie(expiredButLive.cookieValue).id).expires_at = new Date(Date.now() - 1000);
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
