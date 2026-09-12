import type { Meta, StoryObj } from '@storybook/react-vite';

import { CreateSchoolWizard } from './-create-school-wizard';

/**
 * #534's four required states: the school step, the admin step, success,
 * and a 409 slug-conflict error surfaced inline on the slug field.
 *
 * Same Storybook-not-wired-for-`client-admin` gap #533's own stories file
 * notes — only `ui/src/**` is globbed into this repo's Storybook config
 * today, so this file isn't actually reachable from a running Storybook
 * instance yet. Written anyway to follow #533's precedent (co-located
 * `-*.stories.tsx` next to the presentational component) so it's ready
 * the moment that wiring gap is fixed; not this lane's job to fix it.
 */
const meta: Meta<typeof CreateSchoolWizard> = {
  component: CreateSchoolWizard,
  args: {
    schoolDefaults: { name: '', slug: '' },
    adminDefaults: { name: '', email: '', phone: '' },
    submitting: false,
    onSchoolNext: () => {},
    onAdminBack: () => {},
    onAdminSubmit: () => {},
    renderDetailLink: (schoolId: string) => (
      <a className="font-medium text-primary underline" href={`/schools/${schoolId}`}>
        {schoolId}
      </a>
    ),
  },
};
export default meta;

type Story = StoryObj<typeof CreateSchoolWizard>;

export const SchoolStep: Story = {
  args: {
    step: 'school',
  },
};

export const AdminStep: Story = {
  args: {
    step: 'admin',
    schoolDefaults: { name: 'Ananta School', slug: 'ananta-school' },
  },
};

export const Success: Story = {
  args: {
    step: 'success',
    schoolDefaults: { name: 'Ananta School', slug: 'ananta-school' },
    // [14.13.3] feeds RestoreWizard's expectedSchoolName confirmation gate
    // inside the collapsed "Import data from a workbook" section below.
    schoolName: 'Ananta School',
    result: {
      school: {
        id: '00000000-0000-4000-8000-000000000001',
        slug: 'ananta-school',
        status: 'ACTIVE',
      },
      admin: { user_id: '00000000-0000-4000-8000-000000000002', existed: false },
      invitation: { id: '00000000-0000-4000-8000-000000000003', status: 'PENDING' },
    },
  },
};

export const SlugConflict: Story = {
  args: {
    step: 'school',
    schoolDefaults: { name: 'Ananta School', slug: 'ananta-school' },
    slugConflict: 'This slug is already taken.',
  },
};
