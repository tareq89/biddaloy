import '@biddaloy/ui/test';

import type { PrintAssetRow, PrintTemplateRow } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TemplateEditor } from './template-editor';

const ARTWORK_ID = '11111111-1111-4111-8111-111111111111';

const draft = () => ({
  page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
  front: {
    elements: [
      {
        id: 'el-1',
        type: 'TEXT',
        x: 4,
        y: 4,
        w: 60,
        h: 8,
        field: 'student.name',
        fontFamily: 'Biddaloy Sans',
        sizePt: 12,
        weight: 700,
        color: '#111111',
        align: 'left',
        overflow: 'SHRINK',
      },
    ],
  },
});

let published = false;
let patches: Array<Record<string, unknown>>;
let posted: string[];

const template = (): PrintTemplateRow =>
  ({
    id: 't-1',
    name: 'Classic',
    document_kind: 'STUDENT_ID_CARD',
    layout_kind: 'FIXED',
    is_default: false,
    batch_size: 50,
    current_version_id: published ? 'v-1' : null,
    archived_at: null,
    created_at: '2027-01-01T00:00:00.000Z',
    updated_at: '2027-01-01T00:00:00.000Z',
    draft: draft(),
  }) as unknown as PrintTemplateRow;

const artwork = (): PrintAssetRow => ({
  id: ARTWORK_ID,
  asset_kind: 'ARTWORK',
  content_type: 'image/png',
  byte_size: 4096,
  width_px: 400, // far too small for an 85.6 mm card
  height_px: 250,
  font_family: null,
  original_name: 'front.png',
  archived_at: null,
  created_at: '2027-01-01T00:00:00.000Z',
});

let assets: PrintAssetRow[];

function serve() {
  published = false;
  patches = [];
  posted = [];
  assets = [];
  server.use(
    http.get('/api/v1/print-templates/t-1', () => HttpResponse.json(template())),
    http.patch('/api/v1/print-templates/t-1', async ({ request }) => {
      patches.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(template());
    }),
    http.get('/api/v1/print-templates/t-1/versions', () =>
      HttpResponse.json(
        published
          ? [{ id: 'v-1', template_id: 't-1', version: 1, definition: draft(), published_at: 'x' }]
          : [],
      ),
    ),
    http.post('/api/v1/print-templates/t-1/publish', () => {
      posted.push('publish');
      published = true;
      return HttpResponse.json({
        id: 'v-1',
        template_id: 't-1',
        version: 1,
        definition: draft(),
        published_at: 'x',
      });
    }),
    http.get('/api/v1/print-templates', () => HttpResponse.json([template()])),
    http.get('/api/v1/print-assets', () => HttpResponse.json(assets)),
    http.get('/api/v1/print-assets/:id/file', () =>
      HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer, {
        headers: { 'Content-Type': 'image/png' },
      }),
    ),
    http.post('/api/v1/print-assets', () => {
      posted.push('upload');
      assets = [artwork()];
      return HttpResponse.json(artwork(), { status: 201 });
    }),
  );
}

function setup() {
  return renderWithProviders(<TemplateEditor templateId="t-1" onExit={vi.fn()} />, {
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'school-1',
  });
}

async function openTab(user: ReturnType<typeof setup>['user'], name: 'Page' | 'Files') {
  await user.click(await screen.findByRole('button', { name, pressed: false }));
}

const lastDraft = () =>
  (patches.at(-1) as { draft: ReturnType<typeof draft> & { front: { background?: unknown } } })
    .draft;

describe('template editor: page, files and publishing', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('picking the CR80 portrait preset swaps width and height', async () => {
    serve();
    const { user } = setup();
    await openTab(user, 'Page');
    expect(screen.getByLabelText<HTMLInputElement>('Width (mm)').value).toBe('85.6');

    await user.click(screen.getByRole('combobox', { name: 'Paper' }));
    await user.click(await screen.findByRole('option', { name: 'CR80 card, portrait' }));

    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Width (mm)').value).toBe('54'),
    );
    expect(screen.getByLabelText<HTMLInputElement>('Height (mm)').value).toBe('85.6');
  });

  it('a batch size above the ceiling of 200 is clamped, and saved as 200', async () => {
    serve();
    const { user } = setup();
    await openTab(user, 'Page');

    const batch = screen.getByLabelText<HTMLInputElement>('Cards per batch');
    await user.clear(batch);
    await user.type(batch, '201');
    await user.tab(); // commit

    await waitFor(() => expect(batch.value).toBe('200'));
    await waitFor(() => expect(patches.some((p) => p.batch_size === 200)).toBe(true));
    expect(patches.some((p) => p.batch_size === 201)).toBe(false);
  });

  it("uploading artwork sets the side's background and warns that 400 px is too blurry", async () => {
    serve();
    const { user, container } = setup();
    await openTab(user, 'Files');

    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
    await user.upload(inputs[0]!, new File(['x'], 'front.png', { type: 'image/png' }));

    // The badge appears once the uploaded asset is listed: 400 px over 85.6 mm is ~119 dpi.
    expect(await screen.findByText(/Will look blurry/)).toBeTruthy();
    await waitFor(() => expect(patches.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(lastDraft().front.background).toEqual({ assetId: ARTWORK_ID, print: true });
  }, 15000);

  it('unticking "Print the background" keeps the artwork but stops printing it (pre-printed stock)', async () => {
    serve();
    const { user, container } = setup();
    await openTab(user, 'Files');
    await user.upload(
      container.querySelectorAll<HTMLInputElement>('input[type="file"]')[0]!,
      new File(['x'], 'front.png', { type: 'image/png' }),
    );

    const box = await screen.findByRole('checkbox', { name: 'Print the background' });
    expect((box as HTMLInputElement).checked).toBe(true);
    await user.click(box);

    await waitFor(
      () => expect(lastDraft().front.background).toEqual({ assetId: ARTWORK_ID, print: false }),
      { timeout: 6000 },
    );
  }, 15000);

  it('the font upload button stays disabled until a name, a file AND the rights box are given', async () => {
    serve();
    const { user, container } = setup();
    await openTab(user, 'Files');
    const upload = screen.getByRole('button', { name: 'Upload font' });
    expect(upload.hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText('Font name'), 'My Font');
    await user.upload(
      container.querySelectorAll<HTMLInputElement>('input[type="file"]')[2]!,
      new File(['x'], 'my.woff2', { type: 'font/woff2' }),
    );
    expect(upload.hasAttribute('disabled')).toBe(true); // still no rights confirmation

    await user.click(screen.getByRole('checkbox', { name: 'I have the right to use this font' }));
    expect(upload.hasAttribute('disabled')).toBe(false);
  });

  it('publishing asks first, sends the request, and moves on to the next version number', async () => {
    serve();
    const { user } = setup();

    const publish = await screen.findByRole('button', { name: 'Publish v1' });
    await waitFor(() => expect(publish.hasAttribute('disabled')).toBe(false));
    await user.click(publish);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Earlier prints keep their version/)).toBeTruthy();
    expect(posted).toEqual([]); // nothing sent until confirmed
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(posted).toEqual(['publish']));
    expect(await screen.findByRole('button', { name: 'Publish v2', hidden: true })).toBeTruthy();
    // With no default for this document type yet, it offers to make this one the default.
    expect(await screen.findByText('Make this the default?')).toBeTruthy();
  });

  it('"Longest values" swaps the sample text for the longest realistic name', async () => {
    serve();
    const { user } = setup();
    expect((await screen.findAllByText('Mohammad Rahim Uddin')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('checkbox', { name: 'Longest values' }));

    expect(
      (await screen.findAllByText('Mohammad Abdullah Al Mamun Rahim Uddin')).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Mohammad Rahim Uddin')).toBeNull();
  });

  it('a real student can be previewed only after the first publish', async () => {
    serve();
    setup();
    expect(await screen.findByText('Publish once to preview with a real student.')).toBeTruthy();
  });
});
