import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CommunicationMedium } from '@biddaloy/shared';
import { UpdateOwnGuardianDto } from './students.dto';

/**
 * `PATCH /guardians/mine` is self-service: a parent edits their own contact
 * details. Two things go wrong without shape/length pinning —
 *  1. an over-long value hits the varchar(20)/varchar(100) columns as a raw
 *     Postgres 22001 and surfaces as a 500, and
 *  2. free text ("call me") lands in the column that fee-reminder SMS dials.
 * `''` must still clear the column (the service maps it to NULL). [5.4a]
 */
const failedProps = async (dto: object) => (await validate(dto)).map((e) => e.property);
const dto0 = (email: string) => plainToInstance(UpdateOwnGuardianDto, { email });

describe('UpdateOwnGuardianDto', () => {
  it('accepts a well-formed Bangladeshi phone', async () => {
    const dto = plainToInstance(UpdateOwnGuardianDto, {
      phone: '+8801712345678',
      alternate_phone: '01812345678',
      email: 'parent@example.com',
      preferred_communication: CommunicationMedium.SMS,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it("still lets '' clear phone, alternate_phone and email", async () => {
    const dto = plainToInstance(UpdateOwnGuardianDto, {
      phone: '',
      alternate_phone: '',
      email: '',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects free text in phone — this is the number the SMS job dials', async () => {
    const dto = plainToInstance(UpdateOwnGuardianDto, { phone: 'call me' });
    expect(await failedProps(dto)).toContain('phone');
  });

  it('rejects free text in alternate_phone', async () => {
    const dto = plainToInstance(UpdateOwnGuardianDto, { alternate_phone: 'ring the bell' });
    expect(await failedProps(dto)).toContain('alternate_phone');
  });

  it('rejects a phone longer than the varchar(20) column', async () => {
    const dto = plainToInstance(UpdateOwnGuardianDto, { phone: '0'.repeat(21) });
    expect(await failedProps(dto)).toContain('phone');
  });

  it('rejects an alternate_phone longer than the varchar(20) column', async () => {
    const dto = plainToInstance(UpdateOwnGuardianDto, { alternate_phone: '0'.repeat(21) });
    expect(await failedProps(dto)).toContain('alternate_phone');
  });

  it('rejects an email longer than the varchar(100) column', async () => {
    // A syntactically VALID address of 101 characters — `@IsEmail()` alone
    // waves this through (it caps the local part at 64 and each domain label
    // at 63, not the whole string), so only `@MaxLength(100)` catches it
    // before Postgres does with a 22001.
    const email = `${'a'.repeat(60)}@${'b'.repeat(36)}.com`;
    expect(email).toHaveLength(101);
    expect(await failedProps(dto0(email))).toContain('email');
  });

  it('accepts a syntactically valid email of exactly 100 characters', async () => {
    const email = `${'a'.repeat(60)}@${'b'.repeat(35)}.com`;
    expect(email).toHaveLength(100);
    expect(await validate(dto0(email))).toHaveLength(0);
  });
});
