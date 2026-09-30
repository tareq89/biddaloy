import { describe, expect, it } from 'vitest';
import type { EntityManager } from 'typeorm';
import { AcrAssessment } from '../../../acr/entities/acr-assessment.entity';
import { AcrCriterion } from '../../../acr/entities/acr-criterion.entity';
import { AcrFormVersion } from '../../../acr/entities/acr-form-version.entity';
import { AcrScore } from '../../../acr/entities/acr-score.entity';
import { EXPECTED_TABS } from '../../codec/registry';
import {
  acrAssessmentsTab,
  acrCriteriaTab,
  acrFormVersionsTab,
  acrScoresTab,
  acrTabs,
} from './acr.tab';
import { roundTrip } from './ref-child-tab.test-helper';

const U = '11111111-1111-4111-8111-111111111111';
const AY = '22222222-2222-4222-8222-222222222222';
const V = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444';
const A = '55555555-5555-4555-8555-555555555555';

const keys = {
  users: { [U]: 'a@x.test' },
  academic_years: { [AY]: '2026' },
  acr_form_versions: { [V]: '1' },
  acr_criteria: { [C]: '1|BLOCK_2|T1' },
  acr_assessments: { [A]: 'a@x.test|2026' },
};

describe('acr tabs', () => {
  it('are registered in restore order: versions, criteria, assessments, scores', () => {
    const idx = acrTabs.map((t) => EXPECTED_TABS.indexOf(t.name as never));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('export then restore reproduces versions, criteria, assessments (with total) and scores', () => {
    const version = Object.assign(new AcrFormVersion(), { id: V, created_by: U, version: 1 });
    expect(roundTrip(acrFormVersionsTab, version, { creator: 'a@x.test' }, keys)).toMatchObject({
      created_by: U,
      version: 1,
    });

    const criterion = Object.assign(new AcrCriterion(), {
      id: C,
      form_version_id: V,
      block: 'BLOCK_2',
      code: 'T1',
      label_en: 'Punctuality',
      label_bn: 'সময়ানুবর্তিতা',
      sort_order: 3,
    });
    expect(roundTrip(acrCriteriaTab, criterion, { form_version: '1' }, keys)).toMatchObject({
      label_bn: 'সময়ানুবর্তিতা',
      sort_order: 3,
    });

    const assessment = Object.assign(new AcrAssessment(), {
      id: A,
      user_id: U,
      academic_year_id: AY,
      form_version_id: V,
      assessed_by: U,
      status: 'COMPLETED',
      total: 37,
      step1_data: { note: 'ok' },
      step3_data: null,
      completed_at: new Date('2026-06-01T10:00:00.000Z'),
    });
    expect(
      roundTrip(
        acrAssessmentsTab,
        assessment,
        { user: 'a@x.test', academic_year: '2026', form_version: '1', assessor: 'a@x.test' },
        keys,
      ),
    ).toMatchObject({ total: 37, step1_data: { note: 'ok' }, step3_data: null, status: 'COMPLETED' });

    const score = Object.assign(new AcrScore(), {
      id: '66666666-6666-4666-8666-666666666666',
      assessment_id: A,
      criterion_id: C,
      score: 4,
    });
    expect(
      roundTrip(acrScoresTab, score, { assessment: 'a@x.test|2026', criterion: '1|BLOCK_2|T1' }, keys),
    ).toMatchObject({ assessment_id: A, criterion_id: C, score: 4 });
  });

  it('upsert writes every field back onto the entity', async () => {
    const assessment = Object.assign(new AcrAssessment(), { id: A, total: 12, status: 'INCOMPLETE' });
    const row = roundTrip(
      acrAssessmentsTab,
      Object.assign(new AcrAssessment(), {
        id: A,
        user_id: U,
        academic_year_id: AY,
        form_version_id: V,
        assessed_by: U,
        status: 'COMPLETED',
        total: 37,
        step1_data: null,
        step3_data: null,
        completed_at: null,
      }),
      { user: 'a@x.test', academic_year: '2026', form_version: '1', assessor: 'a@x.test' },
      keys,
    );
    const m = { save: async (_t: unknown, e: unknown) => e } as unknown as EntityManager;
    const saved = await acrAssessmentsTab.upsert(row, assessment, 'tenant', m);
    expect(saved).toMatchObject({ tenant_id: 'tenant', total: 37, status: 'COMPLETED', user_id: U });
  });

  it('an unknown ref yields a RowError naming the column', () => {
    const res = acrScoresTab.fromRow(
      { id: A, assessment: 'ghost', criterion: '1|BLOCK_2|T1', score: '3' },
      5,
      { tenantId: 't', ref: () => undefined, warn: () => undefined },
    );
    expect('errors' in res && res.errors.map((e) => e.column)).toEqual(['assessment', 'criterion']);
  });
});
