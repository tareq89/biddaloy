/** [52.4.2] `DraftLetterPreview` (MSW) and `LetterPreview` (text safety, decision block). */
import type { LetterPreviewDto } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { DraftLetterPreview } from './draft-letter-preview';
import { LetterPreview } from './letter-preview';

afterEach(async () => {
  await cleanupTestState();
});

const INPUT: LetterPreviewDto = {
  type: 'TESTIMONIAL',
  subject_student_id: '6b1b8f0e-1c0e-4d52-a3a5-0d6f4f0d9a11',
  payload: { purpose: 'For college admission' },
};

async function render(ui: React.ReactElement, locale: 'en' | 'bn' = 'bn') {
  const { localeReady } = renderWithProviders(ui, { locale, tenantId: 'tenant-1' });
  await localeReady;
}

describe('DraftLetterPreview', () => {
  it('POSTs the input and shows the returned letter with the draft badge', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/applications/letter-preview', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          letter_text: 'সম্মানিত প্রধান শিক্ষক,\n\nবিনীত নিবেদন।',
          letter_locale: 'bn',
        });
      }),
    );
    await render(<DraftLetterPreview input={INPUT} />);

    expect(await screen.findByText('বিনীত নিবেদন।')).toBeTruthy();
    expect(body).toEqual(INPUT);
    expect(screen.getByText('খসড়া')).toBeTruthy();
    expect(screen.getByText('জমা দেওয়ার সময় এই চিঠি সংরক্ষিত হবে।')).toBeTruthy();
  });

  it('shows a skeleton while loading', async () => {
    server.use(
      http.post('/api/v1/applications/letter-preview', () => new Promise<Response>(() => {})),
    );
    await render(<DraftLetterPreview input={INPUT} />);
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  });

  it('keeps the last letter (marked busy) while a changed input loads, no skeleton flash', async () => {
    let release: () => void = () => {};
    server.use(
      http.post('/api/v1/applications/letter-preview', async ({ request }) => {
        const { payload } = (await request.json()) as { payload: { purpose: string } };
        if (payload.purpose === 'second') await new Promise<void>((r) => (release = r));
        return HttpResponse.json({
          letter_text: `Letter: ${payload.purpose}`,
          letter_locale: 'en',
        });
      }),
    );
    const { rerender, localeReady } = renderWithProviders(<DraftLetterPreview input={INPUT} />, {
      locale: 'en',
      tenantId: 'tenant-1',
    });
    await localeReady;
    expect(await screen.findByText('Letter: For college admission')).toBeTruthy();

    rerender(<DraftLetterPreview input={{ ...INPUT, payload: { purpose: 'second' } }} />);
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(screen.getByText('Letter: For college admission')).toBeTruthy();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();

    release();
    expect(await screen.findByText('Letter: second')).toBeTruthy();
  });

  // A 500 is retried twice with backoff (~3 s) before the error shows.
  it('shows ErrorState on a 500 and Retry asks again', { timeout: 20_000 }, async () => {
    let failing = true;
    server.use(
      http.post('/api/v1/applications/letter-preview', () =>
        failing
          ? HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 })
          : HttpResponse.json({ letter_text: 'Second try works.', letter_locale: 'en' }),
      ),
    );
    await render(<DraftLetterPreview input={INPUT} />, 'en');

    expect(
      await screen.findByText('The letter could not be loaded.', undefined, { timeout: 10_000 }),
    ).toBeTruthy();
    failing = false;
    await userEvent.setup().click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Second try works.')).toBeTruthy();
  });
});

describe('LetterPreview', () => {
  it('renders markup in the text as plain text', async () => {
    await render(<LetterPreview text={'Hello <script>alert(1)</script>'} />, 'en');
    expect(screen.getByText('Hello <script>alert(1)</script>')).toBeTruthy();
    expect(document.querySelector('article script')).toBeNull();
  });

  it('splits on blank lines into paragraphs and keeps single newlines as breaks', async () => {
    await render(<LetterPreview text={'one\ntwo\n\nthree'} />, 'en');
    const paragraphs = document.querySelectorAll('article p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.querySelector('br')).toBeTruthy();
  });

  it('treats Windows line endings the same way', async () => {
    await render(<LetterPreview text={'one\r\ntwo\r\n\r\nthree'} />, 'en');
    const paragraphs = document.querySelectorAll('article p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.querySelector('br')).toBeTruthy();
  });

  it('shows the translated decision block, no draft badge for a stored letter', async () => {
    await render(
      <LetterPreview
        text="Letter"
        decision={{
          status: 'APPROVED' as never,
          by: 'রহিমা খাতুন',
          at: '2026-10-10T08:00:00.000Z',
          note: 'ঠিক আছে',
        }}
      />,
    );
    expect(screen.getByText(/সিদ্ধান্ত: অনুমোদিত · রহিমা খাতুন/)).toBeTruthy();
    expect(screen.getByText('ঠিক আছে')).toBeTruthy();
    expect(screen.queryByText('খসড়া')).toBeNull();
    expect(document.getElementById('application-letter-print-area')).toBeTruthy();
  });
});
