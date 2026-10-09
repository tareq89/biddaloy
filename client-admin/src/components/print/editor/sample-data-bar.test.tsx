import '@biddaloy/ui/test';

import { DocumentKind } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SampleDataBar, type SampleDataBarProps } from './sample-data-bar';

function serve(previewStatus = 200) {
  server.use(
    http.get('/api/v1/students', () =>
      HttpResponse.json({
        data: [{ id: 's-1', full_name: 'Rahim Uddin', registration_number: 'R-1' }],
        total: 1,
        page: 1,
        limit: 20,
      }),
    ),
    http.post('/api/v1/print-jobs/preview', () =>
      previewStatus === 200
        ? HttpResponse.json({
            items: [
              {
                values: {
                  'student.name': 'Rahim Uddin',
                  roll: 7,
                  ok: true,
                  nothing: null,
                  obj: { a: 1 },
                },
              },
            ],
          })
        : HttpResponse.json({ message: 'no' }, { status: previewStatus }),
    ),
  );
}

function setup(over: Partial<SampleDataBarProps> = {}) {
  const props: SampleDataBarProps = {
    kind: DocumentKind.STUDENT_ID_CARD,
    templateId: 't-1',
    published: true,
    longest: false,
    onLongestChange: vi.fn(),
    onSample: vi.fn(),
    ...over,
  };
  return {
    props,
    ...renderWithProviders(<SampleDataBar {...props} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    }),
  };
}

describe('SampleDataBar', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('asks the user to publish before a real student can be previewed', async () => {
    serve();
    setup({ published: false });
    expect(await screen.findByText('Publish once to preview with a real student.')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('a staff template has no student picker', async () => {
    serve();
    setup({ kind: DocumentKind.STAFF_ID_CARD });
    await screen.findByText('Sample');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('Publish once to preview with a real student.')).toBeNull();
  });

  it('choosing a student loads their real values, stringified, and "Sample text" goes back', async () => {
    serve();
    const { user, props } = setup();
    await user.click(await screen.findByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /Rahim Uddin/ }));
    await waitFor(() => expect(props.onSample).toHaveBeenCalled());
    expect(props.onSample).toHaveBeenLastCalledWith({
      'student.name': 'Rahim Uddin',
      roll: '7',
      ok: 'true',
      nothing: '',
      obj: '{"a":1}',
    });

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Sample text' }));
    expect(props.onSample).toHaveBeenLastCalledWith(null);
  });

  it('says so when the preview cannot be loaded', async () => {
    serve(500);
    const { user } = setup();
    await user.click(await screen.findByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /Rahim Uddin/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('the "Longest values" switch reports its state', async () => {
    serve();
    const { user, props } = setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Longest values' }));
    expect(props.onLongestChange).toHaveBeenCalledWith(true);
  });
});
