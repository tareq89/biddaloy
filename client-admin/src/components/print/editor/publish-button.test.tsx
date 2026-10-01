import '@biddaloy/ui/test';

import { DocumentKind, type TemplateDefinition } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { PublishButton } from './publish-button';
import type { AutosaveStatus } from './use-draft-autosave';

const good: TemplateDefinition = {
  page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
  front: { elements: [] },
};
// A text element with no source at all is invalid.
const bad = {
  page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
  front: {
    elements: [
      {
        id: 'x',
        type: 'TEXT',
        x: 0,
        y: 0,
        w: 10,
        h: 5,
        fontFamily: 'Biddaloy Sans',
        sizePt: 10,
        weight: 400,
        color: '#000000',
        align: 'left',
        overflow: 'SHRINK',
      },
    ],
  },
} as unknown as TemplateDefinition;

let calls: string[];
function serve(opts: { versions?: number[]; hasDefault?: boolean; publishStatus?: number } = {}) {
  calls = [];
  server.use(
    http.get('/api/v1/print-templates/t-1/versions', () =>
      HttpResponse.json(
        (opts.versions ?? []).map((version) => ({ id: `v${version}`, version, published_at: 'x' })),
      ),
    ),
    http.get('/api/v1/print-templates', () =>
      HttpResponse.json(
        opts.hasDefault
          ? [{ id: 'other', is_default: true, archived_at: null, document_kind: 'STUDENT_ID_CARD' }]
          : [],
      ),
    ),
    http.post('/api/v1/print-templates/t-1/publish', () => {
      calls.push('publish');
      return opts.publishStatus && opts.publishStatus >= 400
        ? HttpResponse.json({ message: 'no' }, { status: opts.publishStatus })
        : HttpResponse.json({
            id: 'v9',
            version: (opts.versions?.length ?? 0) + 1,
            published_at: 'x',
          });
    }),
    http.post('/api/v1/print-templates/t-1/default', () => {
      calls.push('default');
      return HttpResponse.json({ id: 't-1' });
    }),
  );
}

const render = (draft = good, saveStatus: AutosaveStatus = 'saved') =>
  renderWithProviders(
    <PublishButton
      templateId="t-1"
      kind={DocumentKind.STUDENT_ID_CARD}
      draft={draft}
      saveStatus={saveStatus}
    />,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );

describe('PublishButton', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('offers the next version number after the highest published one', async () => {
    serve({ versions: [1, 3, 2] });
    render();
    expect(await screen.findByRole('button', { name: 'Publish v4' })).toBeTruthy();
  });

  it('waits for autosave: disabled with a hint while unsaved', async () => {
    serve();
    render(good, 'saving');
    const button = await screen.findByRole('button', { name: 'Publish v1' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Wait for saving to finish…')).toBeTruthy();
  });

  it('is blocked while the draft is invalid, and lists what to fix', async () => {
    serve();
    render(bad, 'saved');
    const button = await screen.findByRole('button', { name: 'Publish v1' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Fix these before publishing:')).toBeTruthy();
    expect(screen.queryByText('Wait for saving to finish…')).toBeNull();
  });

  it('Cancel in the confirm dialog publishes nothing', async () => {
    serve();
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Publish v1' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(calls).toEqual([]);
  });

  it('publishes, and offers to make it the default when the type has none; "Make default" does it', async () => {
    serve({ hasDefault: false });
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Publish v1' }));
    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Make this the default?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Make this the default/ }));
    await waitFor(() => expect(calls).toEqual(['publish', 'default']));
  });

  it('does not offer a default when one already exists', async () => {
    serve({ hasDefault: true });
    const first = render();
    await first.user.click(await screen.findByRole('button', { name: 'Publish v1' }));
    await first.user.click(await screen.findByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(calls).toEqual(['publish']));
    expect(screen.queryByText('Make this the default?')).toBeNull();
  });

  it('shows an error and keeps the dialog when publishing fails', async () => {
    serve({ publishStatus: 500 });
    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Publish v1' }));
    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Could not publish.')).toBeTruthy();
  });
});
