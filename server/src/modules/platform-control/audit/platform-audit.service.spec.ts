import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { PlatformAuditService } from './platform-audit.service';

const mk = () => {
  const query = vi.fn().mockResolvedValue([]);
  return { query, svc: new PlatformAuditService({ query } as unknown as DataSource) };
};

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

describe('PlatformAuditService cursor', () => {
  const expectBadCursor = async (cursor: string) => {
    const { svc, query } = mk();
    for (const call of [() => svc.search({ cursor }), () => svc.sessions({ cursor })]) {
      const err = await call().catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(err.getResponse())).not.toContain('DROP');
      expect(err.message).toBe('Invalid cursor');
    }
    expect(query).not.toHaveBeenCalled();
  };

  it('a non-base64 cursor is a fixed 400 that runs no query', () => expectBadCursor('!!!'));
  it('a wrong-shape cursor is a fixed 400 that runs no query', () => expectBadCursor(b64({ a: 1 })));
  it('an injection-shaped cursor is a fixed 400 that does not echo input', () =>
    expectBadCursor(b64(['2026-01-01 00:00:00+00', "x'; DROP TABLE users;--"])));
  it('a non-date cursor is a fixed 400 that runs no query', () =>
    expectBadCursor(b64(['not a date', '22222222-2222-4222-8222-222222222222'])));

  it('never selects value columns', async () => {
    const { svc, query } = mk();
    await svc.search({});
    expect(String(query.mock.calls[0][0])).not.toMatch(/old_values|new_values/);
  });
});
