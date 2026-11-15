import { describe, expect, it } from 'vitest';
import type { EntityManager } from 'typeorm';
import { assertRevivedSeats } from './students.tab';

const ID = '11111111-1111-4111-8111-111111111111';

/** `deletedActive`: soft-deleted ACTIVE students among the ids; `used`/`limit`: the School's seats. */
function manager(deletedActive: number, used: number, limit: number | null) {
  return {
    query: async (sql: string) => {
      if (sql.includes('seat_limit')) return [{ seat_limit: limit }];
      if (sql.includes('deleted_at IS NOT NULL')) return [{ n: deletedActive }];
      return [{ n: String(used) }];
    },
  } as unknown as EntityManager;
}

describe('assertRevivedSeats [688]', () => {
  const rows = [{ id: ID, enrollment_status: 'ACTIVE' }];

  it('refuses a revival that would pass the seat limit', async () => {
    await expect(
      assertRevivedSeats(manager(1, 5, 5), 't', new Set([ID]), rows),
    ).rejects.toMatchObject({ response: { details: { code: 'SEAT_LIMIT_REACHED' } } });
  });

  it('allows it while a seat is free, with no limit, or when the file row is not ACTIVE', async () => {
    await expect(
      assertRevivedSeats(manager(1, 4, 5), 't', new Set([ID]), rows),
    ).resolves.toBeUndefined();
    await expect(
      assertRevivedSeats(manager(1, 5, null), 't', new Set([ID]), rows),
    ).resolves.toBeUndefined();
    await expect(
      assertRevivedSeats(manager(1, 5, 5), 't', new Set([ID]), [
        { id: ID, enrollment_status: 'INACTIVE' },
      ]),
    ).resolves.toBeUndefined();
  });
});
