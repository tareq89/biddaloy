import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateStudentDto,
  QueryGuardianDto,
  QueryStudentIdsDto,
  UpdateStudentDto,
} from './students.dto';

/**
 * [8.14.9] Regression test for a boolean query-param coercion bug: an HTTP
 * query string always arrives as a *string* (`req.query.is_primary_contact
 * === 'false'`, never a real `false`), and `@Type(() => Boolean)`'s
 * underlying `Boolean(value)` treats any non-empty string — including the
 * literal text `"false"` — as truthy. `?is_primary_contact=false` would
 * silently become `is_primary_contact: true`, returning the opposite of
 * what was asked. The fix (`@Transform` matching the two literal strings a
 * query param can carry) must be exercised via `plainToInstance` with
 * string input, the same shape NestJS's query-param pipe hands the DTO —
 * passing a real JS boolean (as the service-level integration tests do)
 * would never catch this.
 */
describe('QueryGuardianDto is_primary_contact boolean coercion', () => {
  it('parses the query string "false" as boolean false, not true', () => {
    const dto = plainToInstance(QueryGuardianDto, { is_primary_contact: 'false' });
    expect(dto.is_primary_contact).toBe(false);
  });

  it('parses the query string "true" as boolean true', () => {
    const dto = plainToInstance(QueryGuardianDto, { is_primary_contact: 'true' });
    expect(dto.is_primary_contact).toBe(true);
  });

  it('leaves is_primary_contact undefined when absent from the query', () => {
    const dto = plainToInstance(QueryGuardianDto, {});
    expect(dto.is_primary_contact).toBeUndefined();
  });
});

/**
 * [money-tier review, bug 3 regression] The global pipe
 * (`server/src/validation-pipe.ts`) runs with `whitelist: true` but *not*
 * `forbidNonWhitelisted` — a field the request DTO doesn't declare is
 * silently stripped before it ever reaches the service, no error, no
 * signal. That's the exact mechanism that made bug 3 invisible:
 * `shift`/`version` compiled against `buildStudentIdsQuery`'s
 * `Pick<QueryStudentDto, ...>` parameter type while `QueryStudentIdsDto`
 * didn't actually declare either field, so whitelisting silently dropped
 * both before the service ever saw them. A service-level test calling
 * `findAllIds(query, tenantId)` directly with a plain object bypasses this
 * boundary entirely and would have passed even before the fix — this one
 * exercises the same `whitelist: true` the real pipe applies.
 */
describe('QueryStudentIdsDto shift/version survive whitelisting', () => {
  it('keeps shift and version after whitelist validation, matching the pipe', async () => {
    const dto = plainToInstance(QueryStudentIdsDto, { shift: 'Morning', version: 'English' });

    const errors = await validate(dto, { whitelist: true });

    expect(errors).toHaveLength(0);
    expect(dto.shift).toBe('Morning');
    expect(dto.version).toBe('English');
  });
});

/** [32.2.5] blood_group allowlist + Bangla-name sanitisation (D43). */
describe('Student blood_group / full_name_bn', () => {
  const base = { full_name: 'A', class_section_id: '00000000-0000-4000-8000-000000000001' };

  it.each(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])('accepts %s', async (blood_group) => {
    const dto = plainToInstance(CreateStudentDto, { ...base, blood_group });
    expect(await validate(dto, { whitelist: true })).toHaveLength(0);
  });

  it.each(['C+', 'a+', 'O', ''])('rejects %j', async (blood_group) => {
    const dto = plainToInstance(UpdateStudentDto, { blood_group });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.map((e) => e.property)).toContain('blood_group');
  });

  it('strips markup from full_name_bn and survives whitelisting', async () => {
    const dto = plainToInstance(CreateStudentDto, {
      ...base,
      full_name_bn: 'রহিম<script>alert(1)</script>',
    });
    expect(await validate(dto, { whitelist: true })).toHaveLength(0);
    expect(dto.full_name_bn).not.toContain('<');
    expect(dto.full_name_bn).toContain('রহিম');
  });

  it('rejects full_name_bn over 200 chars', async () => {
    const dto = plainToInstance(UpdateStudentDto, { full_name_bn: 'ক'.repeat(201) });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.map((e) => e.property)).toContain('full_name_bn');
  });
});
