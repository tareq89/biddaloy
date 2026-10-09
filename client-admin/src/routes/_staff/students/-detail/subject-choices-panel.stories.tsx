import { setAccessToken, setActiveRole } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { SubjectChoicesPanel } from './subject-choices-panel';

setActiveRole('ADMIN');
setAccessToken(`h.${btoa(JSON.stringify({ sub: 'user-me' }))}.s`);

const subject = (id: string, name_en: string) => ({ id, name_en });
const subjects = [
  subject('s-hist', 'History'),
  subject('s-geo', 'Geography'),
  subject('s-islam', 'Islam'),
  subject('s-hindu', 'Hindu'),
  subject('s-buddhist', 'Buddhist'),
  subject('s-christian', 'Christian'),
];
const opt = (
  cs: string,
  subject_id: string,
  group: string | null,
  chosen = false,
  fourth = false,
) => ({
  class_subject_id: cs,
  subject_id,
  chosen,
  is_fourth: fourth,
  choice_group: group,
});
const fourthOnly = [opt('cs-hist', 's-hist', null), opt('cs-geo', 's-geo', null, true, true)];
const religion = (picked?: string) => [
  opt('cs-islam', 's-islam', 'Religion', picked === 'cs-islam'),
  opt('cs-hindu', 's-hindu', 'Religion', picked === 'cs-hindu'),
  opt('cs-buddhist', 's-buddhist', 'Religion', picked === 'cs-buddhist'),
  opt('cs-christian', 's-christian', 'Religion', picked === 'cs-christian'),
];

const handlers = (choices: unknown[]) => [
  http.get('/api/v1/academic-years', () =>
    HttpResponse.json({
      data: [{ id: 'year-1', is_current: true, name: '2026' }],
      total: 1,
      page: 1,
      limit: 100,
      totalPages: 1,
    }),
  ),
  http.get('/api/v1/subjects', () =>
    HttpResponse.json({
      data: subjects,
      total: subjects.length,
      page: 1,
      limit: 100,
      totalPages: 1,
    }),
  ),
  http.get('/api/v1/students/:id/subject-choices', () => HttpResponse.json(choices)),
  http.put('/api/v1/students/:id/subject-choices', () => HttpResponse.json({})),
];

const meta: Meta<typeof SubjectChoicesPanel> = {
  component: SubjectChoicesPanel,
  args: { studentId: 'student-1' },
};

export default meta;
type Story = StoryObj<typeof SubjectChoicesPanel>;

export const FourthSubjectOnly: Story = { parameters: { msw: { handlers: handlers(fourthOnly) } } };

export const ReligionUnpicked: Story = { parameters: { msw: { handlers: handlers(religion()) } } };

export const ReligionPickedWithFourth: Story = {
  parameters: { msw: { handlers: handlers([...religion('cs-hindu'), ...fourthOnly]) } },
};
