import type { Meta, StoryObj } from '@storybook/react-vite';

import { IssuerHeader } from './issuer-header';

const meta: Meta<typeof IssuerHeader> = {
  title: 'Print/IssuerHeader',
  component: IssuerHeader,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof IssuerHeader>;

const FULL_ISSUER = {
  name: 'Ananta High School',
  name_bn: 'অনন্ত উচ্চ বিদ্যালয়',
  address: '123 Green Road, Dhaka-1205',
  phone: '+8801712345678',
  email: 'info@anantahs.example',
  registration_id: 'EIIN-123456',
  logo_key: 'tenants/school-1/logo/abc-123.png',
};

/** Every field present, English-first (the default, non-bn locale). */
export const WithLogo: Story = {
  args: {
    issuer: FULL_ISSUER,
    logoUrl: 'https://placehold.co/56x56/png?text=Logo',
  },
};

/** No `logo_key` at all — no `<img>` renders. */
export const WithoutLogo: Story = {
  args: {
    issuer: { ...FULL_ISSUER, logo_key: null },
    logoUrl: null,
  },
};

/** The logo object was removed after the document was issued — `logo_key`
 * is still set (it's frozen on the snapshot), but the URL now 404s.
 * `onError` hides the broken image; nothing else in the header changes. */
export const LogoRemovedAfterIssue: Story = {
  args: {
    issuer: FULL_ISSUER,
    logoUrl: 'https://example.invalid/404-logo.png',
  },
};

/** Active language is Bengali — the Bengali name renders first, with the
 * English name below it. */
export const BengaliFirst: Story = {
  args: {
    issuer: FULL_ISSUER,
    logoUrl: 'https://placehold.co/56x56/png?text=Logo',
    activeLanguage: 'bn',
  },
};

/** A school with no Bengali name set — the English name still renders
 * regardless of `activeLanguage`, with no empty secondary line. */
export const NoBengaliName: Story = {
  args: {
    issuer: { ...FULL_ISSUER, name_bn: null },
    logoUrl: 'https://placehold.co/56x56/png?text=Logo',
    activeLanguage: 'bn',
  },
};

/** Minimal issuer — only the (required) `name`, everything else null. */
export const MinimalIdentity: Story = {
  args: {
    issuer: {
      name: 'Ananta High School',
      name_bn: null,
      address: null,
      phone: null,
      email: null,
      registration_id: null,
      logo_key: null,
    },
    logoUrl: null,
  },
};
