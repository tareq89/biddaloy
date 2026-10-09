import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ACR_CRITERIA_SLOTS, FIELD_CATALOG } from '@biddaloy/shared';
import { AcrAssessmentResolver } from './acr-assessment.resolver';

const SCHOOL = {
  id: 't1',
  name: 'Test School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
  logo_key: null,
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  status: 'COMPLETED',
  total: 82,
  full_name: 'Fatema',
  name_bn: null,
  designation: 'Teacher',
  year_name: '2026',
  completed_on: '2026-12-31',
  ...over,
});
const crits = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    assessment_id: 'a1',
    label_en: `C${i + 1}`,
    label_bn: `ক${i + 1}`,
    score: (i % 4) + 1,
  }));

/** First query = assessments, second = criteria. */
function manager(rows: unknown[], criteria: unknown[] = []) {
  return {
    query: vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce(criteria),
    findOne: vi.fn().mockResolvedValue(SCHOOL),
  } as any;
}

describe('AcrAssessmentResolver', () => {
  it('maps total and all 25 criteria into slots, with every catalog key present', async () => {
    const m = manager([row()], crits(25));
    const s = (await new AcrAssessmentResolver().resolve('t1', ['a1'], m, 'caller')).get('a1')!;
    expect(s.values['acr.total']).toBe('82');
    expect(s.values['acr.year']).toBe('2026');
    expect(s.values['acr.criterion.1.label']).toBe('C1');
    expect(s.values['acr.criterion.25.label_bn']).toBe('ক25');
    expect(s.values['acr.criterion.25.score']).toBe('1');
    expect(s.values['acr.criterion.26.label']).toBe('');
    expect(s.photoKey).toBeNull();
    for (const f of FIELD_CATALOG.ACR_ASSESSMENT) expect(s.values).toHaveProperty(f.key);
    expect(s.values).not.toHaveProperty('print.verify_qr');
  });

  it('binds tenant and caller into the query so own / foreign ACRs come back missing', async () => {
    const m = manager([]);
    const out = await new AcrAssessmentResolver().resolve('t1', ['a1'], m, 'caller');
    expect(out.size).toBe(0);
    expect(m.query.mock.calls[0][1]).toEqual(['t1', ['a1'], 'caller', 'Asia/Dhaka']);
    expect(m.query.mock.calls[0][0]).toMatch(/a\.tenant_id = \$1/);
    expect(m.query.mock.calls[0][0]).toMatch(/a\.user_id <> \$3/);
  });

  it('refuses an incomplete ACR with 409', async () => {
    await expect(
      new AcrAssessmentResolver().resolve(
        't1',
        ['a1'],
        manager([row({ status: 'INCOMPLETE' })]),
        'c',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a form with more criteria than slots instead of truncating', async () => {
    const m = manager([row()], crits(ACR_CRITERIA_SLOTS + 1));
    await expect(new AcrAssessmentResolver().resolve('t1', ['a1'], m, 'c')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
