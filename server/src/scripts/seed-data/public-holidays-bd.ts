/**
 * Checked-in Bangladesh public-holiday list for 2026 and 2027 (17.2.6).
 *
 * **Source: MANUAL, not an external fetch.** The [17.2.4] platform flow
 * (`PublicHolidaysService.fetchIntoSet`) pulls a country/year set from
 * `NAGER_DATE` at request time — but a fresh dev/CI environment has no
 * network access to that service during `yarn seed`, so this file is a
 * hand-written stand-in that gets inserted directly as a `MANUAL`-sourced,
 * already-published `PublicHolidaySet` (see `ensurePublicHolidaySet` in
 * `../seed.util.ts`).
 *
 * Dates are **approximate, not the official government gazette** — no
 * gazette is available to this script. Fixed-date holidays (Independence
 * Day, Victory Day, Language Movement Day, May Day, National Mourning Day,
 * Pohela Boishakh) are exact. Lunar-calendar holidays (the two Eids,
 * Shab-e-Barat, Ashura, Eid-e-Milad-un-Nabi) and the Hindu-calendar ones
 * (Durga Puja, Janmashtami) are plausible estimates, shifted ~11 days
 * earlier from the prior year the way the lunar calendar actually moves —
 * good enough for exercising the calendar UI and e2e suite with a
 * realistic-looking holiday spread, not a source of truth for real
 * scheduling.
 */

export interface SeedPublicHolidayEntry {
  /** ISO date, inclusive start. */
  date: string;
  /** ISO date, inclusive end — same as `date` for single-day holidays. */
  end_date: string;
  name: string;
  name_bn: string;
}

export const BD_PUBLIC_HOLIDAYS_2026: readonly SeedPublicHolidayEntry[] = [
  {
    date: '2026-02-21',
    end_date: '2026-02-21',
    name: 'International Mother Language Day',
    name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
  },
  {
    date: '2026-03-17',
    end_date: '2026-03-17',
    name: "Sheikh Mujibur Rahman's Birthday & National Children's Day",
    name_bn: 'জাতির পিতার জন্মদিন ও জাতীয় শিশু দিবস',
  },
  {
    date: '2026-03-20',
    end_date: '2026-03-22',
    name: 'Eid-ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
  },
  {
    date: '2026-03-26',
    end_date: '2026-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
  {
    date: '2026-04-14',
    end_date: '2026-04-14',
    name: 'Pohela Boishakh (Bengali New Year)',
    name_bn: 'পহেলা বৈশাখ',
  },
  {
    date: '2026-05-01',
    end_date: '2026-05-01',
    name: 'May Day',
    name_bn: 'মে দিবস',
  },
  {
    date: '2026-05-27',
    end_date: '2026-05-29',
    name: 'Eid-ul-Azha',
    name_bn: 'ঈদুল আযহা',
  },
  {
    date: '2026-06-17',
    end_date: '2026-06-17',
    name: 'Ashura',
    name_bn: 'আশুরা',
  },
  {
    date: '2026-08-15',
    end_date: '2026-08-15',
    name: 'National Mourning Day',
    name_bn: 'জাতীয় শোক দিবস',
  },
  {
    date: '2026-09-16',
    end_date: '2026-09-16',
    name: 'Eid-e-Milad-un-Nabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
  },
  {
    date: '2026-10-20',
    end_date: '2026-10-20',
    name: 'Durga Puja (Vijaya Dashami)',
    name_bn: 'দুর্গাপূজা (বিজয়া দশমী)',
  },
  {
    date: '2026-12-16',
    end_date: '2026-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    date: '2026-12-25',
    end_date: '2026-12-25',
    name: 'Christmas Day',
    name_bn: 'বড়দিন',
  },
];

export const BD_PUBLIC_HOLIDAYS_2027: readonly SeedPublicHolidayEntry[] = [
  {
    date: '2027-02-21',
    end_date: '2027-02-21',
    name: 'International Mother Language Day',
    name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
  },
  {
    date: '2027-03-09',
    end_date: '2027-03-11',
    name: 'Eid-ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
  },
  {
    date: '2027-03-17',
    end_date: '2027-03-17',
    name: "Sheikh Mujibur Rahman's Birthday & National Children's Day",
    name_bn: 'জাতির পিতার জন্মদিন ও জাতীয় শিশু দিবস',
  },
  {
    date: '2027-03-26',
    end_date: '2027-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
  {
    date: '2027-04-14',
    end_date: '2027-04-14',
    name: 'Pohela Boishakh (Bengali New Year)',
    name_bn: 'পহেলা বৈশাখ',
  },
  {
    date: '2027-05-01',
    end_date: '2027-05-01',
    name: 'May Day',
    name_bn: 'মে দিবস',
  },
  {
    date: '2027-05-16',
    end_date: '2027-05-18',
    name: 'Eid-ul-Azha',
    name_bn: 'ঈদুল আযহা',
  },
  {
    date: '2027-06-06',
    end_date: '2027-06-06',
    name: 'Ashura',
    name_bn: 'আশুরা',
  },
  {
    date: '2027-08-15',
    end_date: '2027-08-15',
    name: 'National Mourning Day',
    name_bn: 'জাতীয় শোক দিবস',
  },
  {
    date: '2027-09-05',
    end_date: '2027-09-05',
    name: 'Eid-e-Milad-un-Nabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
  },
  {
    date: '2027-10-09',
    end_date: '2027-10-09',
    name: 'Durga Puja (Vijaya Dashami)',
    name_bn: 'দুর্গাপূজা (বিজয়া দশমী)',
  },
  {
    date: '2027-12-16',
    end_date: '2027-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    date: '2027-12-25',
    end_date: '2027-12-25',
    name: 'Christmas Day',
    name_bn: 'বড়দিন',
  },
];
