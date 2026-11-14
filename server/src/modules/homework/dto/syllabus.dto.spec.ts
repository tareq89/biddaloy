import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SyllabusTopicStatus } from '@biddaloy/shared';
import { UpdateSyllabusTopicDto } from './syllabus.dto';

// [#986] `null` on a non-nullable field is a 400 (never a DB 500); `description` stays nullable.
const errorsFor = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(UpdateSyllabusTopicDto, body))).map((e) => e.property);

describe('UpdateSyllabusTopicDto', () => {
  it.each(['name', 'sequence', 'status'])('rejects %s: null', async (field) => {
    expect(await errorsFor({ [field]: null })).toContain(field);
  });

  it('accepts a body that omits every optional field', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('accepts description: null and valid values', async () => {
    expect(await errorsFor({ description: null })).toEqual([]);
    expect(await errorsFor({ name: 'Algebra', sequence: 2, status: SyllabusTopicStatus.DONE })).toEqual([]);
  });
});
