import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { QueryGuardianDto } from './students.dto';

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
