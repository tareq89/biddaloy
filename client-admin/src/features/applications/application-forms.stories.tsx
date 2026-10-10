import { ApplicationType } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { userEvent, within } from 'storybook/test';

import { ApplicationTypeForm, type ApplicationSubject } from './application-type-form';
import { DraftLetterPreview } from './draft-letter-preview';
import { LetterPreview } from './letter-preview';

/**
 * [52.4.2] The ten type forms and the letter preview. The host page owns the
 * filled button (its footer); the one here is story scaffolding outside the
 * form, wired by `form=`. Same "client-admin isn't globbed into a running
 * Storybook yet" gap `AdmissionReports.stories.tsx` notes.
 */
const meta: Meta<typeof ApplicationTypeForm> = { component: ApplicationTypeForm };
export default meta;
type Story = StoryObj<typeof ApplicationTypeForm>;

// Fake people: রহিম উদ্দিন (student, class Six section A), সালমা খাতুন (staff).
const STUDENT: ApplicationSubject = {
  kind: 'STUDENT',
  studentId: 'stu-rahim',
  classId: 'c1',
  sectionId: 'sec-a',
};
const STAFF: ApplicationSubject = { kind: 'STAFF', staffProfileId: 'sp-salma' };

const page = (data: unknown[]) => ({
  data,
  total: data.length,
  page: 1,
  limit: 100,
  totalPages: 1,
});

const lookups = [
  http.get('/api/v1/classes', () => HttpResponse.json(page([{ id: 'c1', name: 'Six' }]))),
  http.get('/api/v1/classes/c1/sections', () =>
    HttpResponse.json([
      { id: 'sec-a', section_name: 'A', class_id: 'c1', enrolled_count: 30 },
      { id: 'sec-b', section_name: 'B', class_id: 'c1', enrolled_count: 28 },
    ]),
  ),
  http.get('/api/v1/exams', () =>
    HttpResponse.json(page([{ id: 'ex-1', name: 'Half yearly', academic_year_id: 'y1' }])),
  ),
  http.get('/api/v1/classes/c1/subjects', () =>
    HttpResponse.json([
      {
        id: 'cs-1',
        subject_id: 'sub-1',
        subject: { id: 'sub-1', name_en: 'Mathematics', name_bn: 'গণিত' },
      },
    ]),
  ),
  http.get('/api/v1/leave/balance', () =>
    HttpResponse.json([
      { leave_type: 'CASUAL', annual_quota_days: 12, used_days: 4, balance: 8 },
      { leave_type: 'SICK', annual_quota_days: null, used_days: 0, balance: null },
    ]),
  ),
];
const msw = { handlers: lookups };

function Harness(props: React.ComponentProps<typeof ApplicationTypeForm>) {
  const { t } = useTranslation('common');
  return (
    <div className="space-y-4">
      <ApplicationTypeForm {...props} />
      <Button form={props.formId} type="submit" data-testid="story-submit">
        {t('actions.save')}
      </Button>
    </div>
  );
}

const form = (type: ApplicationType, subject: ApplicationSubject): Story => ({
  args: { type, subject, formId: 'story-form', onSubmit: () => undefined },
  render: (args) => <Harness {...args} />,
  parameters: { msw },
});

export const StaffLeave: Story = form(ApplicationType.STAFF_LEAVE, STAFF);
export const StudentLeave: Story = form(ApplicationType.STUDENT_LEAVE, STUDENT);
export const FeeWaiver: Story = form(ApplicationType.FEE_WAIVER, STUDENT);
export const Testimonial: Story = form(ApplicationType.TESTIMONIAL, STUDENT);
export const TransferCertificate: Story = form(ApplicationType.TRANSFER_CERTIFICATE, STUDENT);
export const Readmission: Story = form(ApplicationType.READMISSION, STUDENT);
export const SectionChange: Story = form(ApplicationType.SECTION_CHANGE, STUDENT);
export const ScriptRecheck: Story = form(ApplicationType.SCRIPT_RECHECK, STUDENT);
export const IdCardReprint: Story = form(ApplicationType.ID_CARD_REPRINT, STAFF);
export const General: Story = form(ApplicationType.GENERAL, STUDENT);

/** Submitting an empty form: every required field shows its inline message. */
export const ValidationError: Story = {
  ...form(ApplicationType.STUDENT_LEAVE, STUDENT),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('story-submit'));
  },
};

/** The host is sending: every control is disabled. */
export const Submitting: Story = {
  ...form(ApplicationType.STAFF_LEAVE, STAFF),
  args: { ...form(ApplicationType.STAFF_LEAVE, STAFF).args, disabled: true },
};

/** Leave type with no yearly limit (`balance: null`): the help line says so. */
export const LeaveQuotaUnlimited: Story = {
  ...form(ApplicationType.STAFF_LEAVE, STAFF),
  args: {
    ...form(ApplicationType.STAFF_LEAVE, STAFF).args,
    defaultValues: { leave_type: 'SICK' } as never,
  },
};

const serverError = (code: string) =>
  new ApiError({
    statusCode: 409,
    message: code,
    details: { code },
    timestamp: '',
    path: '',
    requestId: 'story',
  });

/** Readmission of a student who is still active (`POST /applications` 422). */
export const ServerErrorSubjectActive: Story = {
  ...form(ApplicationType.READMISSION, STUDENT),
  args: {
    ...form(ApplicationType.READMISSION, STUDENT).args,
    error: serverError('APPLICATION_SUBJECT_ACTIVE'),
  },
};
export const ServerErrorNoClassTeacher: Story = {
  ...form(ApplicationType.FEE_WAIVER, STUDENT),
  args: {
    ...form(ApplicationType.FEE_WAIVER, STUDENT).args,
    error: serverError('APPLICATION_NO_CLASS_TEACHER'),
  },
};
export const ServerErrorAddresseeInvalid: Story = {
  ...form(ApplicationType.GENERAL, STUDENT),
  args: {
    ...form(ApplicationType.GENERAL, STUDENT).args,
    error: serverError('APPLICATION_ADDRESSEE_INVALID'),
  },
};

/** The class has only the student's own section: the picker says so instead of opening empty. */
export const SectionChangeNoOtherSection: Story = {
  ...form(ApplicationType.SECTION_CHANGE, STUDENT),
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/classes/c1/sections', () =>
          HttpResponse.json([
            { id: 'sec-a', section_name: 'A', class_id: 'c1', enrolled_count: 30 },
          ]),
        ),
        ...lookups,
      ],
    },
  },
};

/** The exam list failed (e.g. 403 for a role without exam access): error + Try again. */
export const ScriptRecheckExamsFailed: Story = {
  ...form(ApplicationType.SCRIPT_RECHECK, STUDENT),
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/exams', () =>
          HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 }),
        ),
        ...lookups,
      ],
    },
  },
};

export const FeeWaiverBangla: Story = {
  ...form(ApplicationType.FEE_WAIVER, STUDENT),
  globals: { locale: 'bn' },
};
export const FeeWaiverMobile: Story = {
  ...form(ApplicationType.FEE_WAIVER, STUDENT),
  parameters: { msw, viewport: { defaultViewport: 'mobile1' } },
};

// ---- Letter preview ----

const LETTER =
  'সম্মানিত প্রধান শিক্ষক,\n\nআমি রহিম উদ্দিন, ষষ্ঠ শ্রেণির শিক্ষার্থী। কলেজে ভর্তির জন্য একটি প্রশংসাপত্র প্রয়োজন।\n\nবিনীত\nরহিম উদ্দিন';

export const LetterStored: StoryObj<typeof LetterPreview> = {
  render: () => <LetterPreview text={LETTER} />,
};
export const LetterWithDecision: StoryObj<typeof LetterPreview> = {
  render: () => (
    <LetterPreview
      text={LETTER}
      decision={{
        status: 'APPROVED' as never,
        by: 'রহিমা খাতুন',
        at: '2026-10-10T08:00:00.000Z',
        note: 'আগামী সপ্তাহে অফিস থেকে সংগ্রহ করুন।',
      }}
    />
  ),
};

const draftInput = {
  type: 'TESTIMONIAL' as const,
  subject_student_id: '6b1b8f0e-1c0e-4d52-a3a5-0d6f4f0d9a11',
  payload: { purpose: 'কলেজে ভর্তির জন্য' },
};
export const LetterDraft: StoryObj<typeof DraftLetterPreview> = {
  render: () => <DraftLetterPreview input={draftInput} />,
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/applications/letter-preview', () =>
          HttpResponse.json({ letter_text: LETTER, letter_locale: 'bn' }),
        ),
      ],
    },
  },
};
export const LetterDraftError: StoryObj<typeof DraftLetterPreview> = {
  render: () => <DraftLetterPreview input={draftInput} />,
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/applications/letter-preview', () =>
          HttpResponse.json({ statusCode: 422, message: 'invalid' }, { status: 422 }),
        ),
      ],
    },
  },
};
