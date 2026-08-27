import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '@biddaloy/shared';
import { CreateUserDto, UpdateUserDto } from './users.dto';

/**
 * Length pinning for the two user fields that were missed when `email` and
 * `phone` got theirs. Both columns are fixed-width varchars; without a
 * `@MaxLength` an over-long value reaches Postgres, comes back as 22001
 * (`string_data_right_truncation`), and — since `UserService.update`'s catch
 * only maps 23505 — surfaces to the caller as a 500. [5.4a]
 */
const failedProps = async (dto: object) => (await validate(dto)).map((e) => e.property);

describe('UpdateUserDto length pinning', () => {
  it('rejects a full_name longer than the varchar(100) column', async () => {
    const dto = plainToInstance(UpdateUserDto, { full_name: 'a'.repeat(101) });
    expect(await failedProps(dto)).toContain('full_name');
  });

  it('accepts a full_name of exactly 100 characters', async () => {
    const dto = plainToInstance(UpdateUserDto, { full_name: 'a'.repeat(100) });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a profile_picture_url longer than the varchar(255) column', async () => {
    const dto = plainToInstance(UpdateUserDto, {
      profile_picture_url: `https://cdn.example.com/${'a'.repeat(255)}`,
    });
    expect(await failedProps(dto)).toContain('profile_picture_url');
  });

  it('accepts a profile_picture_url of exactly 255 characters', async () => {
    const dto = plainToInstance(UpdateUserDto, { profile_picture_url: 'a'.repeat(255) });
    expect(await validate(dto)).toHaveLength(0);
  });
});

describe('CreateUserDto length pinning', () => {
  it('rejects a full_name longer than the varchar(100) column', async () => {
    const dto = plainToInstance(CreateUserDto, {
      full_name: 'a'.repeat(101),
      role: UserRole.TEACHER,
      tenantId: '00000000-0000-4000-8000-000000000000',
    });
    expect(await failedProps(dto)).toContain('full_name');
  });

  it('accepts a full_name of exactly 100 characters', async () => {
    const dto = plainToInstance(CreateUserDto, {
      full_name: 'a'.repeat(100),
      role: UserRole.TEACHER,
      tenantId: '00000000-0000-4000-8000-000000000000',
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});

/**
 * Phone shape on `users.phone`. The earlier fix pinned it to the
 * Bangladesh-only `BD_PHONE_REGEX`, which rejects a staff member's foreign
 * number and a human-formatted local one. The rule here is E.164-ish:
 * optional `+`, separators allowed, 8–15 digits, and — the part that
 * actually protects login — nothing email-shaped, because
 * `AuthService.validateUser` matches on `email OR phone`. Guardian phones
 * keep the BD rule and are not covered by this file. [5.4a]
 */
describe('user phone shape (international)', () => {
  const updateWith = (phone: string) => plainToInstance(UpdateUserDto, { phone });

  const createWith = (phone: string) =>
    plainToInstance(CreateUserDto, {
      phone,
      full_name: 'X',
      role: UserRole.TEACHER,
      tenantId: '00000000-0000-4000-8000-000000000000',
    });

  it('accepts 01712345678 on UpdateUserDto — BD local, unchanged', async () => {
    expect(await failedProps(updateWith('01712345678'))).not.toContain('phone');
  });

  it('accepts 01712345678 on CreateUserDto — BD local, unchanged', async () => {
    expect(await failedProps(createWith('01712345678'))).not.toContain('phone');
  });

  it('accepts +8801712345678 on UpdateUserDto — BD E.164', async () => {
    expect(await failedProps(updateWith('+8801712345678'))).not.toContain('phone');
  });

  it('accepts +8801712345678 on CreateUserDto — BD E.164', async () => {
    expect(await failedProps(createWith('+8801712345678'))).not.toContain('phone');
  });

  it('accepts +880 1712-345678 on UpdateUserDto — human-formatted', async () => {
    expect(await failedProps(updateWith('+880 1712-345678'))).not.toContain('phone');
  });

  it('accepts +880 1712-345678 on CreateUserDto — human-formatted', async () => {
    expect(await failedProps(createWith('+880 1712-345678'))).not.toContain('phone');
  });

  it('accepts +447700900123 on UpdateUserDto — UK', async () => {
    expect(await failedProps(updateWith('+447700900123'))).not.toContain('phone');
  });

  it('accepts +447700900123 on CreateUserDto — UK', async () => {
    expect(await failedProps(createWith('+447700900123'))).not.toContain('phone');
  });

  it('accepts +1 (555) 123-4567 on UpdateUserDto — US, parenthesised', async () => {
    expect(await failedProps(updateWith('+1 (555) 123-4567'))).not.toContain('phone');
  });

  it('accepts +1 (555) 123-4567 on CreateUserDto — US, parenthesised', async () => {
    expect(await failedProps(createWith('+1 (555) 123-4567'))).not.toContain('phone');
  });

  it('rejects not-a-phone on CreateUserDto — plainly not a number', async () => {
    expect(await failedProps(createWith('not-a-phone'))).toContain('phone');
  });

  it('rejects admin@example.com on CreateUserDto — the impersonation case: @ is not in the identifier class', async () => {
    expect(await failedProps(createWith('admin@example.com'))).toContain('phone');
  });

  it('rejects 1234567 on CreateUserDto — 7 digits — below the 8-digit floor', async () => {
    expect(await failedProps(createWith('1234567'))).toContain('phone');
  });

  it('rejects 1234567890123456 on CreateUserDto — 16 digits — above the E.164 maximum of 15', async () => {
    expect(await failedProps(createWith('1234567890123456'))).toContain('phone');
  });

  it('rejects (empty string) on CreateUserDto — handled by @ValidateIf on UpdateUserDto only', async () => {
    expect(await failedProps(createWith(''))).toContain('phone');
  });

  it('rejects + on CreateUserDto — a lone plus carries no digits', async () => {
    expect(await failedProps(createWith('+'))).toContain('phone');
  });

  it('still rejects a phone longer than the varchar(20) column', async () => {
    const dto = plainToInstance(UpdateUserDto, { phone: '+880171234567890123456789' });
    expect(await failedProps(dto)).toContain('phone');
  });
});

/**
 * A browser form submits a cleared input as `''`. `phone: ''` already meant
 * "clear this column"; `email: ''` 400'd with "email must be an email", so
 * a form clearing both failed for the wrong reason — and the sibling
 * self-service DTO (`UpdateOwnGuardianDto`) already got this right. Clearing
 * both is still refused, but by the service, with a message that explains
 * the real problem. [5.4a]
 */
describe("UpdateUserDto email: '' (cleared form input)", () => {
  it("lets '' through validation, the same way phone: '' does", async () => {
    const dto = plainToInstance(UpdateUserDto, { email: '', phone: '' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('still rejects a non-empty value that is not an email', async () => {
    const dto = plainToInstance(UpdateUserDto, { email: 'nope' });
    expect(await failedProps(dto)).toContain('email');
  });

  it('still rejects an email longer than the varchar(100) column', async () => {
    const dto = plainToInstance(UpdateUserDto, {
      email: `${'a'.repeat(60)}@${'b'.repeat(50)}.example`,
    });
    expect(await failedProps(dto)).toContain('email');
  });
});
