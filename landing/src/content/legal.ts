/**
 * Company lines used by the contact office card, privacy and terms pages.
 * Empty / placeholder until Epic 62 (#1783) supplies the registered details.
 * ponytail: a placeholder renders as the mockup's bracketed text; nothing is hidden.
 */
export const company = {
  /** Street address lines; bracketed = placeholder. */
  address: {
    bn: ['[অফিসের ঠিকানা: বাড়ি/রোড]', '[এলাকা], [শহর] [পোস্ট কোড]'],
    en: ['[Office address: house/road]', '[Area], [City] [Post code]'],
  },
  hours: { bn: 'শনি–বৃহস্পতি, সকাল ১০টা – সন্ধ্যা ৬টা।', en: 'Saturday–Thursday, 10 am – 6 pm.' },
  phone: '+880 1XXX-XXXXXX',
  whatsapp: 'https://wa.me/8801000000000',
  email: 'hello@schoolmanagerp.com',
  privacyEmail: 'privacy@schoolmanagerp.com',
  mapsUrl: 'https://maps.google.com/?q=Dhaka',
} as const;
