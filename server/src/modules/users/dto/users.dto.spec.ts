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
