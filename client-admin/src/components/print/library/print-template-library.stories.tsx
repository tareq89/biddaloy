import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import type { PrintSuggestion, PrintTemplateRow } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { PrintTemplateLibrary } from './print-template-library';

/**
 * [32.3.6] `Print/TemplateLibrary`. Same "client-admin isn't globbed into a running
 * Storybook instance yet" gap `CalendarSection.stories.tsx` notes — written
 * anyway, following that precedent. A loader sets an ADMIN role and a school.
 */
const template = (over: Partial<PrintTemplateRow>): PrintTemplateRow => ({
  id: 't-1',
  name: 'Classic',
  document_kind: 'STUDENT_ID_CARD',
  layout_kind: 'FIXED',
  is_default: true,
  batch_size: 50,
  current_version_id: 'v-1',
  archived_at: null,
  created_at: '2027-01-01T00:00:00.000Z',
  updated_at: '2027-01-02T00:00:00.000Z',
  ...over,
});

const suggestions: PrintSuggestion[] = (['student', 'staff'] as const).flatMap((who) =>
  (['portrait', 'landscape'] as const).flatMap((orientation) =>
    (['classic', 'modern'] as const).map((style) => ({
      key: `${who}-${orientation}-${style}`,
      documentKind: who === 'student' ? ('STUDENT_ID_CARD' as const) : ('STAFF_ID_CARD' as const),
      orientation,
      style,
      nameKey: `print.suggestion.${who}_${orientation}_${style}`,
    })),
  ),
);

const artwork = http.get('/api/v1/print-templates/suggestions/:key/artwork/:side', () =>
  HttpResponse.text(
    '<svg xmlns="http://www.w3.org/2000/svg" width="86" height="54"><rect width="86" height="54" fill="#e5e7eb"/></svg>',
    { headers: { 'Content-Type': 'image/svg+xml' } },
  ),
);

const serve = (templates: PrintTemplateRow[]) => ({
  msw: {
    handlers: [
      http.get('/api/v1/print-templates', () => HttpResponse.json(templates)),
      http.get('/api/v1/print-templates/suggestions', () => HttpResponse.json(suggestions)),
      artwork,
    ],
  },
});

const meta: Meta<typeof PrintTemplateLibrary> = {
  title: 'Print/TemplateLibrary',
  component: PrintTemplateLibrary,
  args: { onEdit: () => undefined },
  loaders: [
    () => {
      setActiveTenant('school-1');
      setActiveRole('ADMIN');
    },
  ],
};
export default meta;

type Story = StoryObj<typeof PrintTemplateLibrary>;

export const Populated: Story = {
  parameters: serve([
    template({}),
    template({ id: 't-2', name: 'Modern', is_default: false }),
    template({ id: 't-3', name: 'Draft only', is_default: false, current_version_id: null }),
    template({ id: 't-4', name: 'Staff card', document_kind: 'STAFF_ID_CARD' }),
  ]),
};

/** A school with no templates starts from a design, not an empty table. */
export const Empty: Story = {
  parameters: serve([]),
};

export const NewTemplateDialogOpen: Story = {
  args: { openNewDialog: true },
  parameters: serve([template({})]),
};
