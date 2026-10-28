/**
 * The (?) is data-driven: every story injects a tiny help index through
 * `HelpProvider`. "Open" stories click the (?) in a play function. The card
 * chrome (caption, "গাইড দেখুন") follows the Storybook locale toolbar; the
 * entry text follows the provider's `lang`. No loading/error state: the
 * index is static, and a missing entry renders nothing.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { HelpHint, HelpProvider, type HelpEntry, type HelpIndex } from './help-hint';

const base: HelpEntry = {
  title: { bn: 'হাজিরা নেওয়া', en: 'Taking attendance' },
  summary: {
    bn: 'শ্রেণি ও শাখা বেছে প্রতিটি শিক্ষার্থীর উপস্থিতি লিখুন।',
    en: 'Pick a class and section, then mark each student present or absent.',
  },
  path: 'attendance/attendance-register',
  anchor: 'task-main',
  knownIssues: 0,
};

const index: HelpIndex = {
  page: base,
  withIssue: { ...base, knownIssues: 2 },
  withVideo: {
    ...base,
    video: { bn: { id: 'bnVideo', durationSec: 95 }, en: { id: 'enVideo', durationSec: 125 } },
  },
  field: {
    ...base,
    title: { bn: 'রোল নম্বর', en: 'Roll number' },
    summary: { bn: '', en: '' },
    field: { ns: 'storyFieldNs', key: 'rollNo' },
    anchor: 'more',
  },
};

const meta: Meta<typeof HelpHint> = {
  title: 'Components/HelpHint',
  component: HelpHint,
  tags: ['autodocs'],
  args: { helpId: 'page', size: 'md' },
  decorators: [
    (Story, ctx) => (
      <HelpProvider
        index={index}
        lang={(ctx.globals['locale'] as 'bn' | 'en' | undefined) === 'en' ? 'en' : 'bn'}
        baseUrl="https://schoolmanagerp.gitbook.io/schoolmanagerp-docs"
      >
        <div className="flex min-h-72 items-start gap-2 p-6">
          <h1 className="text-h1">Attendance</h1>
          <Story />
        </div>
      </HelpProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof HelpHint>;

const open: Story['play'] = async ({ canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(await body.findByRole('button'));
  await expect(await body.findByRole('dialog')).toBeTruthy();
};

export const Closed: Story = {};

/** Entry text in Bangla; opens as hover/focus/tap would. */
export const OpenBangla: Story = {
  globals: { locale: 'bn' },
  play: open,
};

export const OpenEnglish: Story = {
  globals: { locale: 'en' },
  play: open,
};

/** `knownIssues > 0` adds the "known issues" link (E13). */
export const WithKnownIssue: Story = {
  args: { helpId: 'withIssue' },
  play: open,
};

/** A `video` entry adds the watch link (E21); none exist today. */
export const WithVideo: Story = {
  args: { helpId: 'withVideo' },
  play: open,
};

/** `sm` is the size used beside a form field; summary comes from `<ns>:help.<key>`. */
export const FieldSize: Story = {
  args: { helpId: 'field', size: 'sm' },
};

/** Phone: a 44 px target and a full-width card with full-width buttons (E16). */
export const PhoneWidth: Story = {
  args: { helpId: 'withVideo' },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  play: open,
};
