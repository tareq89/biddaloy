import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('@biddaloy/ui/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@biddaloy/ui/api')>()),
  apiClient: { get: (...args: unknown[]) => get(...args) },
}));

import { openApplicantDocument } from './useApplicants';

// Applicant files come from unauthenticated uploads, and a blob URL runs on
// the staff app's origin, so the viewer tab must not reach back into the app.
describe('openApplicantDocument', () => {
  afterEach(() => vi.restoreAllMocks());

  function openWith(blob: Blob) {
    get.mockResolvedValue({ data: blob });
    const tab = { opener: window as unknown, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const created: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      created.push(b as Blob);
      return 'blob:x';
    });
    return { tab, created };
  }

  it('detaches the new tab from the staff app and renders a PDF', async () => {
    const pdf = new Blob(['%PDF'], { type: 'application/pdf' });
    const { tab, created } = openWith(pdf);
    await openApplicantDocument('a1', 'photo');
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe('blob:x');
    expect(created[0]?.type).toBe('application/pdf');
  });

  it('hands any other type over as a download, never rendered on our origin', async () => {
    const { created } = openWith(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
    await openApplicantDocument('a1', 'photo');
    expect(created[0]?.type).toBe('application/octet-stream');
  });
});
