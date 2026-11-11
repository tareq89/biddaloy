import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { GroupsFilterBar } from './filter-bar';
import { NoSourceNotice } from './no-source-notice';

/** [69.5.01] Same "client-admin is not globbed into Storybook yet" note as the other
 * client-admin stories; written anyway so it is ready once that is wired. */
const meta: Meta<typeof GroupsFilterBar> = {
  title: 'Promotions/Set groups',
  component: GroupsFilterBar,
};
export default meta;

type Story = StoryObj<typeof GroupsFilterBar>;

function Stateful({ initial }: { initial: Record<string, string> }) {
  const [values, setValues] = React.useState(initial);
  return (
    <GroupsFilterBar
      subjects={['BAN', 'ENG', 'MAT']}
      values={values}
      resultCount={12}
      onChange={(patch) =>
        setValues((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === '') delete next[k];
            else next[k] = v;
          }
          return next;
        })
      }
    />
  );
}

export const Empty: Story = { render: () => <Stateful initial={{}} /> };

export const SubjectAndMarks: Story = {
  render: () => <Stateful initial={{ subject_code: 'MAT', marks_min: '60', gpa_min: '4' }} />,
};

/** D16: no student has a result, so the filter is replaced by this note. */
export const EmptySource: StoryObj<typeof NoSourceNotice> = { render: () => <NoSourceNotice /> };
