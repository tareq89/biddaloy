import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import * as React from 'react';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';
import { withSession } from '../../../../../ui/.storybook/session-decorator';

import { advancedFilters, EMPTY_VOCAB } from './advanced-filter-fields';
import { INITIAL_FILTERS, type AudienceFilterState } from './audience-tabs';
import { NoticeCompose } from './notice-compose';
import { PublishConfirmDialog } from './publish-confirm-dialog';

/**
 * [53.3.g2.01] The notice compose page and its publish confirm. Fake people only.
 * Same "client-admin isn't globbed into a running Storybook yet" gap the applications stories note.
 */
const meta: Meta<typeof NoticeCompose> = {
  component: NoticeCompose,
  args: { onClose: () => undefined, onPublished: () => undefined },
  decorators: [withMemoryRouter(['/']), withSession('ADMIN')],
};
export default meta;
type Story = StoryObj<typeof NoticeCompose>;

const ID = '11111111-1111-4111-8111-111111111111';
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 25 });
const handlers = [
  http.get('/api/v1/notices/:id', () =>
    HttpResponse.json({
      id: ID,
      title: 'শীতকালীন ছুটি',
      body: 'রবিবার থেকে স্কুল বন্ধ থাকবে।',
      status: 'DRAFT',
      important: true,
      pinned: false,
      isPublic: false,
      expiresOn: null,
      smsStatus: 'NONE',
      recipientCount: 2,
      seenCount: 0,
    }),
  ),
  http.get('/api/v1/notices/:id/recipients', () =>
    HttpResponse.json(
      page([
        {
          id: 'r1',
          kind: 'GUARDIAN',
          name: 'করিম হোসেন',
          forStudent: 'রহিম উদ্দিন',
          hasLogin: true,
          unreachable: false,
        },
        {
          id: 'r2',
          kind: 'GUARDIAN',
          name: 'সালমা খাতুন',
          forStudent: 'আয়েশা আক্তার',
          hasLogin: false,
          unreachable: false,
        },
      ]),
    ),
  ),
  http.get('/api/v1/audience/people', () =>
    HttpResponse.json(
      page([
        {
          kind: 'GUARDIAN',
          userId: 'u1',
          studentId: null,
          guardianId: 'g1',
          name: 'নাসির আহমেদ',
          detail: 'ষষ্ঠ · ক',
          hasLogin: true,
          hasPhone: true,
        },
      ]),
    ),
  ),
  http.get('/api/v1/classes', () =>
    HttpResponse.json({
      data: [{ id: 'c1', name: 'ষষ্ঠ' }],
      total: 1,
      page: 1,
      limit: 100,
      totalPages: 1,
    }),
  ),
  http.get('/api/v1/classes/c1/sections', () =>
    HttpResponse.json([{ id: 's1', section_name: 'ক', class_id: 'c1', enrolled_count: 30 }]),
  ),
];

/** A new notice: nothing written yet. */
export const Empty: Story = { parameters: { msw: { handlers } } };

/** An existing draft, filled in. */
export const Filled: Story = { args: { noticeId: ID }, parameters: { msw: { handlers } } };

/** The same page on a phone. */
export const Phone: Story = {
  args: { noticeId: ID },
  parameters: { msw: { handlers }, viewport: { defaultViewport: 'mobile1' } },
};

/** The publish confirm with SMS ticked: it says the request goes to an admin. */
export const PublishConfirm: StoryObj<typeof PublishConfirmDialog> = {
  render: () => (
    <PublishConfirmDialog
      open
      onOpenChange={() => undefined}
      counts={{ app: 120, smsOnly: 8, unreachable: 2 }}
      sms
      busy={false}
      onConfirm={() => undefined}
    />
  ),
};

/** [#3442] The four advanced audience tabs' filter fields, with their own state. */
function AdvancedFilters({
  tab,
  initial,
}: {
  tab: 'examFailed' | 'feeDue' | 'lowAttendance' | 'orgGroup';
  initial?: Partial<AudienceFilterState>;
}) {
  const [f, setF] = React.useState<AudienceFilterState>({ ...INITIAL_FILTERS, ...initial });
  const vocab = {
    shifts: ['সকাল', 'দিন'],
    versions: ['বাংলা', 'English'],
    groups: ['বিজ্ঞান', 'মানবিক'],
  };
  return (
    <div className="flex flex-wrap gap-3 p-4">
      {
        advancedFilters(
          f,
          (n) => setF((o) => ({ ...o, ...n })),
          tab === 'orgGroup' ? vocab : EMPTY_VOCAB,
        )[tab]
      }
    </div>
  );
}
const exam = (i: number) => ({
  id: `e${i}`,
  name: `অর্ধবার্ষিক ${i}`,
  status: 'PUBLISHED',
  created_at: `2026-0${i}-01T00:00:00Z`,
  class: { name: 'ষষ্ঠ' },
});
const examsHandler = (body: () => Response | Promise<Response>) => http.get('/api/v1/exams', body);
const advDecorators = [withMemoryRouter(['/']), withSession('ADMIN')];
type AdvStory = StoryObj<typeof AdvancedFilters>;
const advMeta = { decorators: advDecorators };

export const ExamPickerLoading: AdvStory = {
  ...advMeta,
  render: () => <AdvancedFilters tab="examFailed" />,
  parameters: { msw: { handlers: [examsHandler(() => new Promise<Response>(() => undefined))] } },
};
export const ExamPickerError: AdvStory = {
  ...advMeta,
  render: () => <AdvancedFilters tab="examFailed" />,
  parameters: { msw: { handlers: [examsHandler(() => HttpResponse.json({}, { status: 500 }))] } },
};
/** More published exams exist than fit the picker: the field says so. */
export const ExamPickerPartialList: AdvStory = {
  ...advMeta,
  render: () => <AdvancedFilters tab="examFailed" />,
  parameters: {
    msw: {
      handlers: [
        examsHandler(() =>
          HttpResponse.json({
            data: [exam(1), exam(2)],
            total: 150,
            page: 1,
            limit: 100,
            totalPages: 2,
          }),
        ),
      ],
    },
  },
};
export const FeeDue: AdvStory = { ...advMeta, render: () => <AdvancedFilters tab="feeDue" /> };
export const LowAttendancePercentError: AdvStory = {
  ...advMeta,
  render: () => <AdvancedFilters tab="lowAttendance" initial={{ belowPercent: '150' }} />,
};
export const OrgGroup: AdvStory = { ...advMeta, render: () => <AdvancedFilters tab="orgGroup" /> };
