import { UnprocessableEntityException } from '@nestjs/common';
import { assertDemoRowLimit } from './demo-row-limit';

describe('assertDemoRowLimit', () => {
  const saved = process.env.DEMO_MODE;
  afterEach(() => {
    if (saved === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = saved;
  });

  it('allows 100 rows in demo mode', () => {
    process.env.DEMO_MODE = 'true';
    expect(() => assertDemoRowLimit(100)).not.toThrow();
  });

  it('refuses 101 rows with a fixed message, code, limit and count', () => {
    process.env.DEMO_MODE = 'true';
    let err: UnprocessableEntityException | undefined;
    try {
      assertDemoRowLimit(101);
    } catch (e) {
      err = e as UnprocessableEntityException;
    }
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err!.getStatus()).toBe(422);
    expect(err!.getResponse()).toEqual({
      message: 'Demo: at most 100 rows per request',
      details: { code: 'DEMO_ROW_LIMIT', limit: 100, count: 101 },
    });
  });

  it('never throws when DEMO_MODE is unset', () => {
    delete process.env.DEMO_MODE;
    expect(() => assertDemoRowLimit(100000)).not.toThrow();
  });
});
