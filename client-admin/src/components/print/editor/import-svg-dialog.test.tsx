import '@biddaloy/ui/test';

import { DocumentKind, type TemplateDefinition } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { editorReducer, initEditorState } from './editor-state';
import { ImportSvgDialog } from './import-svg-dialog';
import type { Measure } from './svg-import';

const PAGE = { widthMm: 85.6, heightMm: 54, sides: ['front'] } as TemplateDefinition['page'];
const ASSET_ID = '22222222-2222-4222-8222-222222222222';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 856 540">
  <rect width="856" height="540" fill="#eee"/>
  <text x="0" y="0">{{student.name}}</text>
  <text x="0" y="0">{{student.class}}</text>
  <text x="0" y="0">{{oops.key}}</text>
</svg>`;

const NONE = 'none';
const measure: Measure = () => ({ x: 100, y: 200, width: 400, height: 60 });

let uploads: number;
const draft = (): TemplateDefinition => ({ page: PAGE, front: { elements: [] } });

/** The dialog wired to the real reducer, like the editor does, plus a way to undo. */
function Harness() {
  const [state, dispatch] = React.useReducer(
    editorReducer,
    initEditorState(draft(), DocumentKind.STUDENT_ID_CARD),
  );
  const [open, setOpen] = React.useState(true);
  return (
    <div>
      <ImportSvgDialog
        open={open}
        onOpenChange={setOpen}
        page={PAGE}
        kind={DocumentKind.STUDENT_ID_CARD}
        availableFonts={['Biddaloy Sans']}
        measure={measure}
        onImport={(assetId, elements) => dispatch({ type: 'IMPORT_SVG', assetId, elements })}
      />
      <output data-testid="count">{state.draft.front.elements.length}</output>
      <output data-testid="background">{state.draft.front.background?.assetId ?? NONE}</output>
      <button type="button" data-testid="undo" onClick={() => dispatch({ type: 'UNDO' })} />
    </div>
  );
}

describe('ImportSvgDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('previews the fields, uploads once on Import, adds them, and one undo removes everything', async () => {
    uploads = 0;
    server.use(
      http.post('/api/v1/print-assets', () => {
        uploads += 1;
        return HttpResponse.json(
          {
            id: ASSET_ID,
            asset_kind: 'ARTWORK',
            content_type: 'image/svg+xml',
            byte_size: 10,
            width_px: null,
            height_px: null,
            font_family: null,
            original_name: 'card.svg',
            archived_at: null,
            created_at: '2027-01-01T00:00:00.000Z',
          },
          { status: 201 },
        );
      }),
    );
    const { user, container } = renderWithProviders(<Harness />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });

    await screen.findByRole('dialog');
    const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File([SVG], 'card.svg', { type: 'image/svg+xml' }));

    // Two known fields listed; the unknown one is warned about, not listed.
    expect(await screen.findByText('student.name')).toBeTruthy();
    expect(screen.getByText('student.class')).toBeTruthy();
    expect(screen.getByText(/oops\.key is not a field of this document/)).toBeTruthy();
    expect(uploads).toBe(0); // nothing is sent until Import

    await user.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(uploads).toBe(1));
    expect(await screen.findByText(ASSET_ID)).toBeTruthy();
    expect(screen.getByTestId('count').textContent).toBe('2');

    // The whole import is ONE history step.
    await user.click(screen.getByTestId('undo'));
    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(screen.getByTestId('background').textContent).toBe(NONE);
  });

  it('says so when the file is not an SVG', async () => {
    const { user, container } = renderWithProviders(<Harness />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });
    await screen.findByRole('dialog');
    const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File(['<html/>'], 'x.svg', { type: 'image/svg+xml' }));
    expect(await screen.findByText('This file could not be read as an SVG.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import' }).hasAttribute('disabled')).toBe(true);
  });
});
