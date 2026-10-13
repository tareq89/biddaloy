import { assertLocalSeedTarget } from './seed-guard';

const url = (host: string) => `postgres://u:s3cret@${host}:5432/x`;

describe('assertLocalSeedTarget', () => {
  it('refuses a remote host without leaking the password', () => {
    const env = { NODE_ENV: 'development', DATABASE_URL: url('db.staging.example.com') };
    expect(() => assertLocalSeedTarget(env, 'seed')).toThrow(/seed.*db\.staging\.example\.com/);
    try {
      assertLocalSeedTarget(env, 'seed');
    } catch (e) {
      expect((e as Error).message).not.toContain('s3cret');
    }
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('allows %s in development and test', (host) => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(() =>
        assertLocalSeedTarget({ NODE_ENV, DATABASE_URL: url(host) }, 'db:reset'),
      ).not.toThrow();
    }
  });

  it('refuses production even on localhost', () => {
    expect(() =>
      assertLocalSeedTarget({ NODE_ENV: 'production', DATABASE_URL: url('localhost') }, 'db:clear'),
    ).toThrow(/db:clear.*production/);
  });

  it('refuses a missing or unparsable DATABASE_URL', () => {
    expect(() => assertLocalSeedTarget({ NODE_ENV: 'development' }, 'seed')).toThrow(
      /DATABASE_URL/,
    );
    expect(() =>
      assertLocalSeedTarget({ NODE_ENV: 'development', DATABASE_URL: 'nope' }, 'seed'),
    ).toThrow(/DATABASE_URL/);
  });
});
