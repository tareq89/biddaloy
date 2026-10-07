import '@biddaloy/ui/test';

import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  examFactory,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExamFormDialog } from './-exam-form-dialog';

// No Toaster is mounted in tests, so the toast calls are spies.
const toastSuccess = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('@biddaloy/ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/components')>();
  return {
    ...actual,
    toast: Object.assign(
      (...a: Parameters<typeof actual.toast>) => actual.toast(...a),
      actual.toast,
      {
        success: toastSuccess,
        info: toastInfo,
      },
    ),
  };
});

const year = academicYearFactory({ id: 'year-1', name: '2026' });
const cls = classFactory({ id: 'class-1', name: 'Class 6' });
const TEMPLATES = [
  { id: 'tpl-1', name: 'Half-yearly', kind: 'TERM', rowCount: 4, classGrades: [6] },
];

function mockApi(opts: { templates?: unknown[]; post?: () => Response | Promise<Response> } = {}) {
  const bodies: Record<string, unknown>[] = [];
  let templateCalls = 0;
  server.use(
    http.get('/api/v1/academic-years', () => HttpResponse.json({ data: [year], total: 1 })),
    http.get('/api/v1/classes', () => HttpResponse.json({ data: [cls], total: 1 })),
    http.get('/api/v1/exam-templates', () => {
      templateCalls += 1;
      return HttpResponse.json(opts.templates ?? TEMPLATES);
    }),
    http.post('/api/v1/exams', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return (
        opts.post?.() ??
        HttpResponse.json(
          { ...examFactory({ id: 'exam-9' }), components_created: 3 },
          { status: 201 },
        )
      );
    }),
  );
  return { bodies, templateCalls: () => templateCalls };
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, template?: string) {
  await user.type(screen.getByLabelText('Name'), 'Half Yearly');
  await user.click(screen.getByRole('combobox', { name: 'Academic year' }));
  await user.click(await screen.findByRole('option', { name: '2026' }));
  await user.click(screen.getByRole('combobox', { name: 'Class' }));
  await user.click(await screen.findByRole('option', { name: 'Class 6' }));
  if (template) {
    await user.click(screen.getByRole('combobox', { name: 'Start from an exam structure (optional)' }));
    await user.click(await screen.findByRole('option', { name: template }));
  }
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

const renderDialog = (props: Partial<React.ComponentProps<typeof ExamFormDialog>> = {}) =>
  renderWithProviders(
    <ExamFormDialog open onOpenChange={() => {}} mode="create" onSaved={() => {}} {...props} />,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );

describe('ExamFormDialog template field', () => {
  afterEach(async () => {
    toastSuccess.mockReset();
    toastInfo.mockReset();
    await cleanupTestState();
  });

  it('is hidden when the tenant has no templates', async () => {
    const api = mockApi({ templates: [] });
    renderDialog();
    await waitFor(() => expect(api.templateCalls()).toBe(1));
    expect(screen.queryByRole('combobox', { name: 'Start from an exam structure (optional)' })).toBeNull();
  });

  it('is hidden in edit mode and does not fetch templates', async () => {
    const api = mockApi();
    renderDialog({ mode: 'edit', examId: 'exam-1' });
    await screen.findByLabelText('Name');
    expect(screen.queryByRole('combobox', { name: 'Start from an exam structure (optional)' })).toBeNull();
    expect(api.templateCalls()).toBe(0);
  });

  it('sends template_id and toasts the component count', async () => {
    const api = mockApi();
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('combobox', { name: 'Start from an exam structure (optional)' });
    await fillAndSubmit(user, 'Half-yearly');
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Exam created with ৩ parts'),
    );
    expect(api.bodies[0]).toMatchObject({ template_id: 'tpl-1' });
  });

  it('prefills from defaultTemplateId', async () => {
    const api = mockApi();
    const user = userEvent.setup();
    renderDialog({ defaultTemplateId: 'tpl-1' });
    await screen.findByRole('combobox', { name: 'Start from an exam structure (optional)' });
    await fillAndSubmit(user);
    await waitFor(() => expect(api.bodies[0]).toMatchObject({ template_id: 'tpl-1' }));
  });

  it('hints when the template matched nothing', async () => {
    mockApi({
      post: () =>
        HttpResponse.json(
          { ...examFactory({ id: 'exam-9' }), components_created: 0 },
          { status: 201 },
        ),
    });
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('combobox', { name: 'Start from an exam structure (optional)' });
    await fillAndSubmit(user, 'Half-yearly');
    await waitFor(() => expect(toastInfo).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('omits template_id and toasts nothing without a template', async () => {
    const api = mockApi();
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('combobox', { name: 'Start from an exam structure (optional)' });
    await fillAndSubmit(user);
    await waitFor(() => expect(api.bodies).toHaveLength(1));
    expect(api.bodies[0]).not.toHaveProperty('template_id');
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('disables the class select until an academic year is picked', async () => {
    mockApi();
    renderDialog();
    const classSelect = await screen.findByRole('combobox', { name: 'Class' });
    expect((classSelect as HTMLButtonElement).disabled).toBe(true);
    expect(classSelect.textContent).toContain('Pick an academic year first');
  });

  it('shows the translated error, never the server text', async () => {
    mockApi({
      post: () => HttpResponse.json({ message: 'Exam template x not found' }, { status: 404 }),
    });
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('combobox', { name: 'Start from an exam structure (optional)' });
    await fillAndSubmit(user, 'Half-yearly');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Couldn't save the exam.");
    expect(alert.textContent).not.toMatch(/404|not found/);
  });
});
