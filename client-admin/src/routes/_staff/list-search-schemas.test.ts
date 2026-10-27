/**
 * [#3043] The four list routes declare the keys they read, so a stray query
 * param is stripped (and never becomes a filter chip) while the declared
 * list-state and filter params survive.
 */
import { describe, expect, it } from 'vitest';

import { Route as academicYears } from './academic-years/index';
import { Route as classes } from './classes/index';
import { Route as templates } from './exams/templates/index';
import { Route as gradingScales } from './grading-scales/index';

type Validate = (search: Record<string, unknown>) => Record<string, unknown>;
const validate = (
  route: { options: { validateSearch?: unknown } },
  search: Record<string, unknown>,
) => (route.options.validateSearch as { parse: Validate }).parse(search);

describe('list route search schemas', () => {
  it.each([
    ['classes', classes],
    ['academic-years', academicYears],
    ['grading-scales', gradingScales],
    ['exams/templates', templates],
  ])('%s strips a stray param and keeps page/sort', (_name, route) => {
    const out = validate(route, { page: 2, sort: 'name', order: 'desc', stray: 'x' });
    expect(out).not.toHaveProperty('stray');
    expect(out).toMatchObject({ page: 2, sort: 'name', order: 'desc' });
  });

  it('classes and grading-scales keep their declared filters', () => {
    expect(validate(classes, { academic_year_id: 'y', shift: 's', version: 'v' })).toMatchObject({
      academic_year_id: 'y',
      shift: 's',
      version: 'v',
    });
    expect(validate(gradingScales, { academic_year_id: 'y' })).toMatchObject({
      academic_year_id: 'y',
    });
  });
});
