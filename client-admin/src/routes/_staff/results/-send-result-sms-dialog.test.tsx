/**
 * [19.8.1] `SendResultSmsDialog` — disabled entirely while the exam isn't
 * published, otherwise shows the recipient-count/cost estimate before
 * sending.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { apiErrorBody, cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SendResultSmsDialog } from './-send-result-sms-dialog';

afterEach(async () => {
  await cleanupTestState();
});

async function renderDialog(examStatus: string, resultCount = 10) {
  setActiveTenant('tenant-1');
  setActiveRole('ADMIN');
  await i18n.changeLanguage('en');
  const queryClient = createTestQueryClient();
  const onOpenChange = vi.fn();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <SendResultSmsDialog
          open
          onOpenChange={onOpenChange}
          examId="exam-1"
          examStatus={examStatus}
          resultCount={resultCount}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...view, onOpenChange };
}

describe('SendResultSmsDialog', () => {
  it('is disabled with an explanatory message while the exam is unpublished', async () => {
    await renderDialog('PROCESSED');

    expect(
      await screen.findByText('Results must be published before an SMS can be sent.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows the recipient count and credit cost, and sends when published', async () => {
    let sent = false;
    server.use(
      http.post('/api/v1/exams/exam-1/results/sms', () => {
        sent = true;
        return HttpResponse.json({ queued: 10, skipped: [] });
      }),
    );

    const user = userEvent.setup();
    await renderDialog('PUBLISHED', 10);

    expect(
      await screen.findByText(
        "Up to 10 guardian(s) will be sent their child's result by SMS. Each message uses one SMS credit.",
      ),
    ).toBeTruthy();
    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(sendButton.hasAttribute('disabled')).toBe(false);

    await user.click(sendButton);

    await waitFor(() => expect(sent).toBe(true));
    expect(await screen.findByText('10 message(s) queued.')).toBeTruthy();
  });

  it('shows an error when sending fails, and Cancel clears it', async () => {
    server.use(
      http.post('/api/v1/exams/exam-1/results/sms', () =>
        HttpResponse.json(apiErrorBody(409, 'Exam is not published', '/exams/exam-1/results/sms'), {
          status: 409,
        }),
      ),
    );

    const user = userEvent.setup();
    const { onOpenChange } = await renderDialog('PUBLISHED', 4);

    await user.click(await screen.findByRole('button', { name: 'Send' }));

    expect(await screen.findByText("Couldn't send the result SMS.")).toBeTruthy();
    expect(screen.queryByText(/message\(s\) queued/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByText("Couldn't send the result SMS.")).toBeNull());
  });

  it('ignores Cancel while the SMS request is still in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('/api/v1/exams/exam-1/results/sms', async () => {
        await gate;
        return HttpResponse.json({ queued: 4, skipped: [] });
      }),
    );

    const user = userEvent.setup();
    const { onOpenChange } = await renderDialog('PUBLISHED', 4);

    const sendButton = await screen.findByRole('button', { name: 'Send' });
    await user.click(sendButton);
    await waitFor(() => expect(sendButton.getAttribute('aria-busy')).toBe('true'));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).not.toHaveBeenCalled();

    release();
    expect(await screen.findByText('4 message(s) queued.')).toBeTruthy();
  });
});
