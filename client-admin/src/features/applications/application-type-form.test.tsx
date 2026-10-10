/**
 * [52.4.2] `ApplicationTypeForm` — all ten types fill, validate and hand back the
 * exact `POST /applications` payload (MSW stands in for the lookups).
 */
import { ApplicationType } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { tenantTodayIso } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApplicationTypeForm,
  type ApplicationPayload,
  type ApplicationSubject,
} from './application-type-form';
import { APPLICATION_FORMS, canFillApplicationType } from './forms/registry';

type User = ReturnType<typeof userEvent.setup>;

const STUDENT: ApplicationSubject = {
  kind: 'STUDENT',
  studentId: 'stu-1',
  classId: 'c1',
  sectionId: 'sec-a',
};
const STAFF: ApplicationSubject = { kind: 'STAFF', staffProfileId: 'sp-1' };

const page = (data: unknown[]) => ({
  data,
  total: data.length,
  page: 1,
  limit: 100,
  totalPages: 1,
});

beforeEach(() => {
  server.use(
    http.get('/api/v1/classes', () => HttpResponse.json(page([{ id: 'c1', name: 'Six' }]))),
    http.get('/api/v1/classes/c1/sections', () =>
      HttpResponse.json([
        { id: 'sec-a', section_name: 'A', class_id: 'c1', enrolled_count: 10 },
        { id: 'sec-b', section_name: 'B', class_id: 'c1', enrolled_count: 8 },
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
        {
          leave_type: 'CASUAL',
          annual_quota_days: null,
          used_days: 0,
          balance: null,
        },
        { leave_type: 'SICK', annual_quota_days: 10, used_days: 2, balance: 8 },
      ]),
    ),
  );
});
afterEach(async () => {
  await cleanupTestState();
});

const ymd = (day: number) => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

async function renderForm(
  type: ApplicationType,
  subject: ApplicationSubject,
  extra: Partial<React.ComponentProps<typeof ApplicationTypeForm>> = {},
  locale: 'en' | 'bn' = 'en',
) {
  const onSubmit = vi.fn<(p: ApplicationPayload) => void>();
  const user = userEvent.setup();
  const { localeReady } = renderWithProviders(
    <ApplicationTypeForm
      type={type}
      subject={subject}
      formId="app-form"
      onSubmit={onSubmit}
      {...extra}
    />,
    { locale, tenantId: 'tenant-1' },
  );
  await localeReady;
  return { user, onSubmit };
}

const label = (text: string) => new RegExp(`^${text}`);
const submit = (user: User) => {
  (document.getElementById('app-form') as HTMLFormElement).requestSubmit();
  return user;
};

async function pickOption(user: User, field: string, option: string) {
  await user.click(await screen.findByLabelText(label(field)));
  await user.click(await screen.findByRole('option', { name: option }));
}
async function pickDate(user: User, field: string, day: number) {
  await user.click(await screen.findByLabelText(label(field)));
  await user.click(document.querySelector(`[data-date="${ymd(day)}"]`) as HTMLElement);
}
async function typeInto(user: User, field: string, value: string) {
  await user.type(await screen.findByLabelText(label(field)), value);
}

// Each type: how a user fills it, and the payload that must come out.
const CASES: {
  type: ApplicationType;
  subject: ApplicationSubject;
  fill: (u: User) => Promise<void>;
  payload: object;
}[] = [
  {
    type: ApplicationType.STAFF_LEAVE,
    subject: STAFF,
    fill: async (u) => {
      await pickDate(u, 'From', 10);
      await pickDate(u, 'To', 12);
      await typeInto(u, 'Reason', 'Family event');
    },
    payload: {
      leave_type: 'CASUAL',
      start_date: ymd(10),
      end_date: ymd(12),
      reason: 'Family event',
    },
  },
  {
    type: ApplicationType.STUDENT_LEAVE,
    subject: STUDENT,
    fill: async (u) => {
      await pickOption(u, 'Reason for leave', 'Illness');
      await pickDate(u, 'From', 10);
      await pickDate(u, 'To', 12);
      await typeInto(u, 'Details', 'Has a fever');
    },
    payload: {
      reason_kind: 'SICK',
      start_date: ymd(10),
      end_date: ymd(12),
      details: 'Has a fever',
    },
  },
  {
    type: ApplicationType.FEE_WAIVER,
    subject: STUDENT,
    fill: async (u) => {
      await typeInto(u, 'Percent \\(', '20');
      await typeInto(u, 'Reason', 'Father lost his job');
    },
    payload: { kind: 'PERCENT', value: 20, reason: 'Father lost his job' },
  },
  {
    type: ApplicationType.TESTIMONIAL,
    subject: STUDENT,
    fill: (u) => typeInto(u, 'Purpose', 'For college admission'),
    payload: { purpose: 'For college admission' },
  },
  {
    type: ApplicationType.TRANSFER_CERTIFICATE,
    subject: STUDENT,
    fill: async (u) => {
      await pickDate(u, 'Leaving date', 10);
      await typeInto(u, 'Reason', 'Family is moving');
    },
    payload: { leaving_date: ymd(10), reason: 'Family is moving' },
  },
  {
    type: ApplicationType.READMISSION,
    subject: STUDENT,
    fill: async (u) => {
      await pickOption(u, 'Section', 'B');
      await pickDate(u, 'Date of readmission', 1);
      await typeInto(u, 'Reason', 'Came back after illness');
    },
    payload: {
      class_section_id: 'sec-b',
      occurred_on: ymd(1),
      reason: 'Came back after illness',
    },
  },
  {
    type: ApplicationType.SECTION_CHANGE,
    subject: STUDENT,
    fill: async (u) => {
      await pickOption(u, 'Move to section', 'B');
      await typeInto(u, 'Reason', 'Friend is in B');
    },
    payload: { to_section_id: 'sec-b', reason: 'Friend is in B' },
  },
  {
    type: ApplicationType.SCRIPT_RECHECK,
    subject: STUDENT,
    fill: async (u) => {
      await pickOption(u, 'Exam', 'Half yearly');
      await pickOption(u, 'Subject', 'Mathematics');
      await typeInto(u, 'Reason', 'Marks look low');
    },
    payload: { exam_id: 'ex-1', subject_id: 'sub-1', reason: 'Marks look low' },
  },
  {
    type: ApplicationType.ID_CARD_REPRINT,
    subject: STAFF,
    fill: (u) => typeInto(u, 'Reason', 'Card was lost'),
    payload: { reason: 'Card was lost' },
  },
  {
    type: ApplicationType.GENERAL,
    subject: STUDENT,
    fill: async (u) => {
      await typeInto(u, 'Subject of the application', 'Request for a meeting');
      await typeInto(u, 'Application', 'Please give us a meeting time.');
    },
    payload: { subject_line: 'Request for a meeting', body: 'Please give us a meeting time.' },
  },
];

describe('ApplicationTypeForm', () => {
  it.each(CASES)('$type submits the exact payload', async ({ type, subject, fill, payload }) => {
    const { user, onSubmit } = await renderForm(type, subject);
    await fill(user);
    submit(user);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(payload);
  });

  it.each([ApplicationType.STAFF_LEAVE, ApplicationType.STUDENT_LEAVE])(
    '%s sends dates as YYYY-MM-DD only, never an ISO datetime',
    async (type) => {
      const c = CASES.find((x) => x.type === type)!;
      const { user, onSubmit } = await renderForm(type, c.subject);
      await c.fill(user);
      submit(user);
      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      const sent = onSubmit.mock.calls[0]?.[0] as unknown as Record<string, string>;
      for (const key of ['start_date', 'end_date']) {
        expect(sent[key]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(sent[key]).not.toContain('T');
      }
    },
  );

  it('STAFF_LEAVE: end before start fails on end_date (the picker also disables those days)', async () => {
    const bad = APPLICATION_FORMS.STAFF_LEAVE.schema(
      ((k: string) => k) as never,
      REGION_BD_EN,
    ).safeParse({
      leave_type: 'CASUAL',
      start_date: ymd(12),
      end_date: ymd(10),
      reason: 'Family event',
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(['end_date']);
    // And through the UI: an empty end date blocks the submit with an inline error.
    const { user, onSubmit } = await renderForm(ApplicationType.STAFF_LEAVE, STAFF);
    await pickDate(user, 'From', 12);
    await typeInto(user, 'Reason', 'Family event');
    submit(user);
    expect(await screen.findByText('Choose a date.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('STAFF_LEAVE: a null balance reads as "No limit", a number as days left', async () => {
    const { user } = await renderForm(ApplicationType.STAFF_LEAVE, STAFF);
    expect(await screen.findByText('No limit')).toBeTruthy();
    await pickOption(user, 'Leave type', 'Sick');
    expect(await screen.findByText('Left this year: ৮ days')).toBeTruthy();
  });

  it('FEE_WAIVER: PERCENT 120 is rejected, FLAT 500 is accepted', async () => {
    const { user, onSubmit } = await renderForm(ApplicationType.FEE_WAIVER, STUDENT);
    await typeInto(user, 'Percent \\(', '120');
    await typeInto(user, 'Reason', 'Father lost his job');
    submit(user);
    expect(await screen.findByText('Enter a number between 1 and 100.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('Flat amount'));
    const value = await screen.findByLabelText(/^Amount in taka/);
    await user.clear(value);
    await user.type(value, '500');
    submit(user);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      kind: 'FLAT',
      value: 500,
      reason: 'Father lost his job',
    });
  });

  it('FEE_WAIVER: back-navigation re-feeds the submitted payload (value is a number) and it submits again', async () => {
    const first = { kind: 'PERCENT', value: 20, reason: 'Father lost his job' };
    const { onSubmit } = await renderForm(ApplicationType.FEE_WAIVER, STUDENT, {
      defaultValues: first as never,
    });
    expect((await screen.findByLabelText<HTMLInputElement>(/^Percent \(/)).value).toBe('20');
    submit(userEvent.setup());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(first);
  });

  it('FEE_WAIVER: a value typed in Bangla digits is accepted', async () => {
    const { user, onSubmit } = await renderForm(ApplicationType.FEE_WAIVER, STUDENT);
    await typeInto(user, 'Percent \\(', '২০');
    await typeInto(user, 'Reason', 'Father lost his job');
    submit(user);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ value: 20 });
  });

  it('READMISSION: a future date is rejected by the schema', () => {
    const t = ((k: string) => k) as never;
    const base = { class_section_id: 'sec-b', reason: 'abc' };
    const schema = APPLICATION_FORMS.READMISSION.schema(t, REGION_BD_EN);
    const today = tenantTodayIso(REGION_BD_EN);
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    expect(schema.safeParse({ ...base, occurred_on: today }).success).toBe(true);
    expect(
      schema.safeParse({ ...base, occurred_on: tomorrow.toISOString().slice(0, 10) }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...base, occurred_on: '2020-01-01' }).success).toBe(true);
  });

  it('READMISSION: defaults derive class_id from the section default', () => {
    const d = APPLICATION_FORMS.READMISSION.defaults;
    expect(d(STUDENT, { class_section_id: 'sec-a' }).class_id).toBe('c1');
    expect(d(STUDENT, { class_id: 'c2', class_section_id: 'sec-x' }).class_id).toBe('c2');
    expect(d(STUDENT).class_id).toBe('c1');
  });

  it('READMISSION: a re-fed section that is not in the shown class is dropped, not submitted unseen', async () => {
    const { user, onSubmit } = await renderForm(ApplicationType.READMISSION, STUDENT, {
      defaultValues: { class_section_id: 'sec-of-another-class' } as never,
    });
    await pickDate(user, 'Date of readmission', 1);
    await typeInto(user, 'Reason', 'Came back after illness');
    // The class's sections have loaded once the section picker is enabled.
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLButtonElement>(/^Section/).disabled).toBe(false),
    );
    submit(user);
    expect(await screen.findByText('Choose one.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('SECTION_CHANGE: a class with no other section says so instead of an empty list', async () => {
    server.use(
      http.get('/api/v1/classes/c1/sections', () =>
        HttpResponse.json([{ id: 'sec-a', section_name: 'A', class_id: 'c1', enrolled_count: 10 }]),
      ),
    );
    await renderForm(ApplicationType.SECTION_CHANGE, STUDENT);
    expect(await screen.findByText('There is no other section in this class.')).toBeTruthy();
    expect(screen.getByLabelText<HTMLButtonElement>(/^Move to section/).disabled).toBe(true);
  });

  it('SCRIPT_RECHECK: a failed exam list shows an error with Try again, which reloads it', async () => {
    let fail = true;
    server.use(
      http.get('/api/v1/exams', () =>
        fail
          ? HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 })
          : HttpResponse.json(page([{ id: 'ex-1', name: 'Half yearly', academic_year_id: 'y1' }])),
      ),
    );
    const { user } = await renderForm(ApplicationType.SCRIPT_RECHECK, STUDENT);
    expect(await screen.findByText('The list could not be loaded.')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await pickOption(user, 'Exam', 'Half yearly');
  });

  it('SCRIPT_RECHECK: exams are scoped to the current academic year', async () => {
    let yearParam: string | null = null;
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json(
          page([
            { id: 'y0', name: '2025', is_current: false },
            { id: 'y1', name: '2026', is_current: true },
          ]),
        ),
      ),
      http.get('/api/v1/exams', ({ request }) => {
        yearParam = new URL(request.url).searchParams.get('academic_year_id');
        return HttpResponse.json(page([]));
      }),
    );
    await renderForm(ApplicationType.SCRIPT_RECHECK, STUDENT);
    expect(await screen.findByText('No exams for this class this year.')).toBeTruthy();
    expect(yearParam).toBe('y1');
  });

  it('canFillApplicationType: types whose pickers a role cannot load are not offered', () => {
    expect(canFillApplicationType(ApplicationType.STUDENT_LEAVE, 'PARENT')).toBe(true);
    expect(canFillApplicationType(ApplicationType.READMISSION, 'PARENT')).toBe(false);
    expect(canFillApplicationType(ApplicationType.SECTION_CHANGE, 'STUDENT')).toBe(false);
    expect(canFillApplicationType(ApplicationType.SCRIPT_RECHECK, 'OFFICE_STAFF')).toBe(false);
    expect(canFillApplicationType(ApplicationType.SCRIPT_RECHECK, 'TEACHER')).toBe(true);
    expect(canFillApplicationType(ApplicationType.READMISSION, 'OFFICE_STAFF')).toBe(true);
  });

  it('SECTION_CHANGE: the current section is not offered', async () => {
    const { user } = await renderForm(ApplicationType.SECTION_CHANGE, STUDENT);
    await user.click(await screen.findByLabelText(/^Move to section/));
    await screen.findByRole('option', { name: 'B' });
    expect(screen.queryByRole('option', { name: 'A' })).toBeNull();
  });

  it('calls onDirtyChange(true) after the first edit', async () => {
    const onDirtyChange = vi.fn();
    const { user } = await renderForm(ApplicationType.TESTIMONIAL, STUDENT, { onDirtyChange });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await typeInto(user, 'Purpose', 'x');
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  });

  it('keeps what was typed through defaultValues', async () => {
    await renderForm(ApplicationType.TESTIMONIAL, STUDENT, {
      defaultValues: { purpose: 'Earlier text' },
    });
    expect((await screen.findByLabelText<HTMLInputElement>(/^Purpose/)).value).toBe('Earlier text');
  });

  it('has no button inside the form (the host footer owns submit)', async () => {
    await renderForm(ApplicationType.GENERAL, STUDENT);
    await screen.findByLabelText(/^Application/);
    expect(document.querySelectorAll('#app-form button[type="submit"]')).toHaveLength(0);
  });

  it.each([
    [
      'APPLICATION_SUBJECT_ACTIVE',
      'This student is already active, so a readmission is not needed.',
    ],
    [
      'APPLICATION_NO_CLASS_TEACHER',
      'This student has no class teacher right now. Ask the office to assign one, then try again.',
    ],
    ['APPLICATION_REFERENCE_NOT_FOUND', 'Something you chose no longer exists. Choose it again.'],
    ['APPLICATION_SUBJECT_MISMATCH', 'This kind of application is not for this person.'],
    ['LEAVE_OVERLAP', 'The application could not be saved. Try again.'],
    [
      'APPLICATION_ADDRESSEE_INVALID',
      'The person this application is addressed to is not available. Choose someone else.',
    ],
  ])('maps server code %s to a translated sentence, not the server text', async (code, text) => {
    const error = new ApiError({
      statusCode: 409,
      message: 'raw server words',
      details: { code },
      timestamp: '',
      path: '',
      requestId: 'r',
    });
    await renderForm(ApplicationType.STAFF_LEAVE, STAFF, { error });
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByText('raw server words')).toBeNull();
  });

  it.each(CASES)(
    '$type: every control is reachable by label in Bangla',
    async ({ type, subject }) => {
      await renderForm(type, subject, {}, 'bn');
      // Every visible control (input, textarea, select trigger, picker, radio) has an accessible name.
      await screen.findAllByRole('textbox');
      const controls = document.querySelectorAll(
        '#app-form input:not([type="hidden"]), #app-form textarea, #app-form button[role="combobox"], #app-form button[aria-haspopup]',
      );
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        const name =
          control.getAttribute('aria-label') ??
          (control.id ? document.querySelector(`label[for="${control.id}"]`)?.textContent : null) ??
          control.closest('label')?.textContent;
        expect(name, control.outerHTML).toBeTruthy();
      }
    },
  );
});
