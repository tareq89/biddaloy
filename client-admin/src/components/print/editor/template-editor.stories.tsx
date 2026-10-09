import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import type { PrintTemplateRow } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { TemplateEditor } from './template-editor';

/**
 * [32.3.1] `Print/TemplateEditor`. Same "client-admin isn't globbed into a running
 * Storybook instance yet" gap `CalendarSection.stories.tsx` notes — written
 * anyway, following that precedent. A loader sets an ADMIN role and a school.
 */
const text = (id: string, over: Record<string, unknown>) => ({
  id,
  type: 'TEXT',
  x: 4,
  y: 4,
  w: 50,
  h: 7,
  fontFamily: 'Biddaloy Sans',
  sizePt: 12,
  weight: 700,
  color: '#111111',
  align: 'left',
  overflow: 'SHRINK',
  ...over,
});

/** A CR80 portrait card like the "Classic" suggestion: school name, photo, name, class, QR. */
const cr80Portrait = (nameBox = { w: 50, h: 7 }) => ({
  page: { widthMm: 54, heightMm: 85.6, sides: ['front'] },
  front: {
    elements: [
      text('school', { field: 'school.name', x: 4, y: 4, w: 46, h: 6, sizePt: 9, align: 'center' }),
      {
        id: 'photo',
        type: 'IMAGE',
        x: 14,
        y: 14,
        w: 26,
        h: 32,
        field: 'student.photo',
        fit: 'COVER',
        alignY: 'top',
      },
      text('name', { field: 'student.name', x: 4, y: 50, ...nameBox, align: 'center' }),
      text('class', {
        field: 'student.class',
        x: 4,
        y: 58,
        w: 46,
        h: 6,
        sizePt: 9,
        weight: 400,
        align: 'center',
      }),
      { id: 'qr', type: 'QR', x: 17, y: 66, w: 20, h: 16 },
    ],
  },
});

const template = (draft: object): PrintTemplateRow =>
  ({
    id: 't-1',
    name: 'Classic portrait ID card',
    document_kind: 'STUDENT_ID_CARD',
    layout_kind: 'FIXED',
    is_default: true,
    batch_size: 50,
    current_version_id: null,
    archived_at: null,
    created_at: '2027-01-01T00:00:00.000Z',
    updated_at: '2027-01-01T00:00:00.000Z',
    draft,
  }) as unknown as PrintTemplateRow;

const serve = (draft: object) => ({
  msw: {
    handlers: [
      http.get('/api/v1/print-templates/t-1', () => HttpResponse.json(template(draft))),
      http.patch('/api/v1/print-templates/t-1', () => HttpResponse.json(template(draft))),
    ],
  },
});

const meta: Meta<typeof TemplateEditor> = {
  title: 'Print/TemplateEditor',
  component: TemplateEditor,
  args: { templateId: 't-1', onExit: () => undefined },
  parameters: { layout: 'fullscreen' },
  loaders: [
    () => {
      setActiveTenant('school-1');
      setActiveRole('ADMIN');
    },
  ],
};
export default meta;

type Story = StoryObj<typeof TemplateEditor>;

/** The CR80 portrait design, nothing selected. */
export const Default: Story = {
  parameters: serve(cr80Portrait()),
};

/** A layer is selected: the handles, the outline and the properties form are showing. */
export const SelectedElement: Story = {
  parameters: serve(cr80Portrait()),
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('storybook/test');
    const canvas = within(canvasElement);
    const layers = await canvas.findByRole('region', { name: 'Layers' });
    await userEvent.click(await within(layers).findByRole('button', { name: /Name/ }));
  },
};

/** The name box is far too small for the longest sample name, so its overflow policy is what shows. */
export const OverflowingElement: Story = {
  parameters: serve(cr80Portrait({ w: 14, h: 4 })),
};
