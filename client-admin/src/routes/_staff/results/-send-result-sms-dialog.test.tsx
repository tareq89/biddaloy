/**
 * [19.8.1] `SendResultSmsDialog` — disabled entirely while the exam isn't
 * published, otherwise shows the recipient-count/cost estimate before
 * sending.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
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
});
