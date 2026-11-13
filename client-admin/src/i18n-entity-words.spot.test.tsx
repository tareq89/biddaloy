import '@biddaloy/ui/test';
import type { SchoolLabels } from '@biddaloy/shared';
import { useSchoolProfile } from '@biddaloy/ui/hooks';
import { i18n, useTranslation } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

// Epic 77 D19/D49: converted namespaces render the school's word. Three real strings,
// one each from classes, students and fees, with section -> Batch from the profile.
const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: 'school-1' };

function useProfileWords(labels: SchoolLabels) {
  server.use(
    http.get('/api/v1/schools/me/profile', () =>
      HttpResponse.json({ name: 'S', slug: 's', modules: {}, labels }),
    ),
  );
}

function Strings() {
  useSchoolProfile();
  const classesT = useTranslation('classes').t;
  const fees = useTranslation('fees').t;
  const students = useTranslation('students').t;
  return (
    <ul>
      <li data-testid="fees">{fees('dues.columnSection')}</li>
      <li data-testid="classes">{classesT('list.columnSections')}</li>
      <li data-testid="students">{students('list.columnSection')}</li>
    </ul>
  );
}

describe('entity words in converted namespaces', () => {
  afterEach(async () => {
    i18n.addResource('en', 'common', 'entities.section_one', 'Section');
    i18n.addResource('en', 'common', 'entities.section_other', 'Sections');
    i18n.addResource('en', 'common', 'entities.student_other', 'Students');
    await cleanupTestState();
  });

  it('shows the stock words when the profile has no labels', async () => {
    useProfileWords({});
    renderWithProviders(<Strings />, opts);
    expect((await screen.findByTestId('classes')).textContent).toBe('Sections');
    expect(screen.getByTestId('students').textContent).toBe('Section');
  });

  it('section -> Batch, student -> Trainee reach classes, students and fees copy', async () => {
    useProfileWords({
      section: { en: { one: 'Batch', other: 'Batches' }, bn: 'ব্যাচ' },
      student: { en: { one: 'Trainee', other: 'Trainees' }, bn: 'প্রশিক্ষণার্থী' },
    });
    renderWithProviders(<Strings />, opts);
    expect(await screen.findByText('Batches')).toBeTruthy();
    expect(screen.getByTestId('students').textContent).toBe('Batch');
    expect(screen.getByTestId('fees').textContent).toBe('Batch');
  });
});
