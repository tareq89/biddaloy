/**
 * [15.2.6] — one story per entity type this lane added audit coverage
 * for (Guardian, Class, ClassSection, AcademicYear, Enrollment), plus
 * one for an entity type the client has never labeled (the
 * `entityTypes.unknown` fallback path). Each renders `DiffPanel`
 * directly with a representative `old_values`/`new_values` pair — the
 * same panel `index.tsx` mounts inside a row's expansion, just without
 * the `DataTable` and network layer around it.
 *
 * `entityType` only changes rendering for `'Enrollment'` (see
 * `-diff-panel.tsx`'s `linkFor`); every other story exists to prove the
 * generic field-label + humanized-value path reads correctly for that
 * entity's real column names.
 */
import { RegionConfigProvider, REGION_BD_EN } from '@biddaloy/ui/i18n';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { DiffPanel } from './-diff-panel';

const meta: Meta<typeof DiffPanel> = {
  title: 'AuditLogs/DiffPanel',
  component: DiffPanel,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <RegionConfigProvider value={REGION_BD_EN}>
        <Story />
      </RegionConfigProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DiffPanel>;

export const Guardian: Story = {
  args: {
    entityType: 'Guardian',
    oldValues: { phone: '+8801700000000', relationship: 'FATHER' },
    newValues: { phone: '+8801700000001', relationship: 'FATHER' },
  },
};

export const Class: Story = {
  args: {
    entityType: 'Class',
    oldValues: { name: 'Class Six', numeric_grade: 6 },
    newValues: { name: 'Class Six (Morning)', numeric_grade: 6 },
  },
};

export const ClassSection: Story = {
  args: {
    entityType: 'ClassSection',
    oldValues: { section_name: 'A', capacity: 40 },
    newValues: { section_name: 'A', capacity: 45 },
  },
};

export const AcademicYear: Story = {
  args: {
    entityType: 'AcademicYear',
    oldValues: { is_current: true },
    newValues: { is_current: false },
  },
};

/**
 * `student_id`/`class_id` in a real Enrollment row render as links (see
 * the `index.test.tsx` test covering that) — this story sticks to
 * `enrollment_status` on purpose so it renders standalone, without a
 * `RouterProvider` in scope for `@tanstack/react-router`'s `Link`.
 */
export const Enrollment: Story = {
  args: {
    entityType: 'Enrollment',
    oldValues: { enrollment_status: 'ACTIVE' },
    newValues: { enrollment_status: 'INACTIVE' },
  },
};

/**
 * A stored `entity_type` this client has no label for — a legacy value,
 * or a type a future lane hasn't wired a translation for yet. The diff
 * itself doesn't know or care about `entityType` here; this story exists
 * to document that omitting it (or passing an unrecognized value) still
 * renders a normal, generic diff — never hidden, never a crash.
 */
export const UnknownEntityType: Story = {
  args: {
    entityType: 'Legacy',
    oldValues: { status: 'PENDING' },
    newValues: { status: 'DONE' },
  },
};
