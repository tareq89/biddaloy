import { describe, expect, it } from 'vitest';
import { assertThrowawayDatabase } from './load-seed-guard';

const url = (db: string, host = 'localhost') => `postgres://u:p@${host}:5432/${db}`;
const ok = { LOAD_SEED_CONFIRM: 'yes', NODE_ENV: 'test' } as NodeJS.ProcessEnv;

describe('assertThrowawayDatabase', () => {
  it('refuses without LOAD_SEED_CONFIRM=yes', () => {
    expect(() => assertThrowawayDatabase(url('biddaloy_load_x'), { NODE_ENV: 'test' })).toThrow(
      /LOAD_SEED_CONFIRM/,
    );
    expect(() =>
      assertThrowawayDatabase(url('biddaloy_load_x'), { ...ok, LOAD_SEED_CONFIRM: 'true' }),
    ).toThrow(/LOAD_SEED_CONFIRM/);
  });

  it('refuses in production even with the confirm flag and a good name', () => {
    expect(() =>
      assertThrowawayDatabase(url('biddaloy_load_x'), { ...ok, NODE_ENV: 'production' }),
    ).toThrow(/production/);
  });

  it('refuses real / shared database names', () => {
    for (const name of ['biddaloy', 'biddaloy_test', 'biddaloy_test_w1', 'postgres', 'e2e']) {
      expect(() => assertThrowawayDatabase(url(name), ok)).toThrow(/must start with/);
    }
  });

  it('refuses a name that only contains the prefix later on', () => {
    expect(() => assertThrowawayDatabase(url('prod_biddaloy_load_x'), ok)).toThrow(
      /must start with/,
    );
  });

  it('refuses a remote host even with a good name', () => {
    expect(() =>
      assertThrowawayDatabase(url('biddaloy_load_x', 'db.prod.example.com'), ok),
    ).toThrow(/host/);
  });

  it('refuses a missing or invalid DATABASE_URL', () => {
    expect(() => assertThrowawayDatabase('', ok)).toThrow(/DATABASE_URL/);
  });

  it('passes for the test-env and load-local names', () => {
    expect(() => assertThrowawayDatabase(url('biddaloy_test_run_ab12'), ok)).not.toThrow();
    expect(() => assertThrowawayDatabase(url('biddaloy_load_local'), ok)).not.toThrow();
  });
});
