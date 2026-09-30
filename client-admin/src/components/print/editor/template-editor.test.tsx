import '@biddaloy/ui/test';

import type { PrintTemplateRow } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplateEditor } from './template-editor';

const draft = () => ({
  page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
  front: {
    elements: [
      {
        id: 'el-1',
        type: 'TEXT',
        x: 10,
        y: 10,
        w: 30,
        h: 6,
        text: 'Hello',
        fontFamily: 'Biddaloy Sans',
        sizePt: 10,
        weight: 400,
        color: '#000000',
        align: 'left',
        overflow: 'SHRINK',
      },
    ],
  },
});

const template = (): PrintTemplateRow =>
  ({
    id: 't-1',
    name: 'Classic',
    document_kind: 'STUDENT_ID_CARD',
    layout_kind: 'FIXED',
    is_default: true,
    batch_size: 50,
    current_version_id: null,
    archived_at: null,
    created_at: '2027-01-01T00:00:00.000Z',
    updated_at: '2027-01-01T00:00:00.000Z',
    draft: draft(),
  }) as unknown as PrintTemplateRow;

let patches: Array<Record<string, unknown>>;

function serve() {
  patches = [];
  server.use(
    http.get('/api/v1/print-templates/t-1', () => HttpResponse.json(template())),
    http.patch('/api/v1/print-templates/t-1', async ({ request }) => {
      patches.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(template());
    }),
  );
}

function setup(onExit = vi.fn()) {
  const view = renderWithProviders(<TemplateEditor templateId="t-1" onExit={onExit} />, {
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'school-1',
  });
  return { ...view, onExit };
}

/** Select the only layer; focus lands on it (as it would for a keyboard user). */
async function selectLayer(user: ReturnType<typeof setup>['user']) {
  const layers = await screen.findByRole('region', { name: 'Layers' });
  const layer = await within(layers).findByRole('button', { name: /“Hello”/ });
  await user.click(layer);
  return layer;
}

/** The canvas draws its own button per element too, so ask the Layers panel specifically. */
const layerButtons = () =>
  within(screen.getByRole('region', { name: 'Layers' })).queryAllByRole('button', {
    name: /“Hello”/,
  });

describe('TemplateEditor', () => {
  beforeEach(() => {
    serve();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await cleanupTestState();
  });

  it('shows the template and its layers once loaded', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Classic' })).toBeTruthy();
    await waitFor(() => expect(layerButtons()).toHaveLength(1));
    expect(screen.getByText('Select an element to edit it.')).toBeTruthy();
  });

  it('arrows nudge the selected element: Right x2 = +1 mm, Shift+Down = +5 mm', async () => {
    const { user } = setup();
    await selectLayer(user);
    expect(screen.getByLabelText<HTMLInputElement>('X').value).toBe('10');

    await user.keyboard('{ArrowRight}{ArrowRight}{Shift>}{ArrowDown}{/Shift}');

    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('X').value).toBe('11'));
    expect(screen.getByLabelText<HTMLInputElement>('Y').value).toBe('15');
  });

  it('Delete removes the selected element', async () => {
    const { user } = setup();
    await selectLayer(user);

    await user.keyboard('{Delete}');

    expect(await screen.findByText(/Nothing on this side yet/)).toBeTruthy();
    expect(layerButtons()).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /“Hello”/ })).toHaveLength(0); // gone from the canvas too
  });

  it('undo (Ctrl+Z) brings a deleted element back, redo removes it again', async () => {
    const { user } = setup();
    await selectLayer(user);
    await user.keyboard('{Delete}');
    await screen.findByText(/Nothing on this side yet/);

    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(layerButtons()).toHaveLength(1));

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(await screen.findByText(/Nothing on this side yet/)).toBeTruthy();
  });

  it('autosaves the draft once, 1.5 s after the last change', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await selectLayer(user);

    await user.keyboard('{ArrowRight}');
    expect(await screen.findByText('Unsaved changes…')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(1000);
    expect(patches).toHaveLength(0); // still waiting

    await user.keyboard('{ArrowRight}'); // another change restarts the wait
    await vi.advanceTimersByTimeAsync(1000);
    expect(patches).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => expect(patches).toHaveLength(1));
    const saved = patches[0] as { draft: ReturnType<typeof draft> };
    expect(saved.draft.front.elements[0]!.x).toBe(11);
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it("switching a text element to a data field shows that field's sample on the canvas", async () => {
    const { user } = setup();
    await selectLayer(user);
    expect(screen.getAllByText('Hello').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('radio', { name: 'Data field' }));

    // The catalog's first text field is the school name; its sample replaces the fixed text.
    await waitFor(() => expect(screen.queryByText('Hello')).toBeNull());
    expect((await screen.findAllByText(/Ananta|School|Sample/i)).length).toBeGreaterThan(0);
  });

  it('asks before leaving with unsaved changes, and can save first', async () => {
    const { user, onExit } = setup();
    await selectLayer(user);
    await user.keyboard('{ArrowRight}');
    await screen.findByText('Unsaved changes…');

    await user.click(screen.getByRole('button', { name: 'Back to templates' }));
    expect(await screen.findByText('You have changes that are not saved yet')).toBeTruthy();
    expect(onExit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save and leave' }));
    await waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    expect(patches).toHaveLength(1);
  });

  it('leaves straight away when nothing is unsaved', async () => {
    const { user, onExit } = setup();
    await user.click(await screen.findByRole('button', { name: 'Back to templates' }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('shows an error state with a retry when the template cannot be loaded', async () => {
    server.use(
      http.get('/api/v1/print-templates/t-1', () =>
        HttpResponse.json({ message: 'no' }, { status: 500 }),
      ),
    );
    setup();
    expect(
      await screen.findByText('Could not load this template.', {}, { timeout: 8000 }),
    ).toBeTruthy();
  }, 15000);
});
