import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GrantSmsCreditsDto } from './grant-sms-credits.dto';

const failedProps = async (plain: object) => {
  const dto = plainToInstance(GrantSmsCreditsDto, plain);
  return (await validate(dto)).map((e) => e.property);
};

describe('GrantSmsCreditsDto', () => {
  const valid = { units: 500, reason: 'Top-up for the term', idempotency_key: 'key-1' };

  it('accepts a valid grant (positive units)', async () => {
    expect(await failedProps(valid)).toEqual([]);
  });

  it('accepts a valid adjust (negative units)', async () => {
    expect(await failedProps({ ...valid, units: -50 })).toEqual([]);
  });

  it('rejects units: 0', async () => {
    expect(await failedProps({ ...valid, units: 0 })).toContain('units');
  });

  it('rejects a non-integer units value', async () => {
    expect(await failedProps({ ...valid, units: 1.5 })).toContain('units');
  });

  it('rejects a reason shorter than 5 characters', async () => {
    expect(await failedProps({ ...valid, reason: 'abcd' })).toContain('reason');
  });

  it('rejects a missing idempotency_key', async () => {
    const { idempotency_key: _omit, ...rest } = valid;
    expect(await failedProps(rest)).toContain('idempotency_key');
  });
});
