/**
 * Checked-in Bangladesh public-holiday lists for 2016 to 2027: 2026 and 2027
 * from 17.2.6, 2016 to 2025 from [58.1.04] (demo-school history).
 *
 * **Source: MANUAL, not an external fetch.** The [17.2.4] platform flow
 * (`PublicHolidaysService.fetchIntoSet`) pulls a country/year set from
 * `NAGER_DATE` at request time — but a fresh dev/CI environment has no
 * network access to that service during `yarn seed`, so this file is a
 * hand-written stand-in that gets inserted directly as a `MANUAL`-sourced,
 * already-published `PublicHolidaySet` (see `ensurePublicHolidaySet` in
 * `../seed.util.ts`).
 *
 * The 2026 and 2027 dates are **approximate, not the official government gazette** — no
 * gazette is available to this script. Fixed-date holidays (Independence
 * Day, Victory Day, Language Movement Day, May Day, National Mourning Day,
 * Pohela Boishakh) are exact. Lunar-calendar holidays (the two Eids,
 * Shab-e-Barat, Ashura, Eid-e-Milad-un-Nabi) and the Hindu-calendar ones
 * (Durga Puja, Janmashtami) are plausible estimates, shifted ~11 days
 * earlier from the prior year the way the lunar calendar actually moves —
 * good enough for exercising the calendar UI and e2e suite with a
 * realistic-looking holiday spread, not a source of truth for real
 * scheduling.
 *
 * **2016 to 2025 sets ([58.1.04])** were transcribed from the per-year
 * Bangladesh lists at officeholidays.com/countries/bangladesh/<year>
 * (government-gazette based; fetched 2026-10-14), cross-checked against
 * date.nager.at for the fixed-date days. Eid / Puja ranges are the listed
 * holiday block. Left out because the source was unreliable: 2018
 * Shab-e-Barat (source says May 2, the moon puts it near Apr 30), and the
 * 2024 and 2025 National Mourning Day (the holiday was cancelled in August 2024;
 * the source still lists 2025). Still worth a
 * gazette check: 2017 and 2020 Eid-ul-Fitr first day, and the 2024 Durga
 * Puja date. 2016 to 2025 are demo history; none are legal records.
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

export const BD_PUBLIC_HOLIDAYS_2016: readonly SeedPublicHolidayEntry[] = [
  {
    date: '2016-02-21',
    end_date: '2016-02-21',
    name: 'International Mother Language Day',
    name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
  },
  {
    date: '2016-03-17',
    end_date: '2016-03-17',
    name: "Sheikh Mujibur Rahman's Birthday & National Children's Day",
    name_bn: 'জাতির পিতার জন্মদিন ও জাতীয় শিশু দিবস',
  },
  {
    date: '2016-03-26',
    end_date: '2016-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
  {
    date: '2016-04-14',
    end_date: '2016-04-14',
    name: 'Pohela Boishakh (Bengali New Year)',
    name_bn: 'পহেলা বৈশাখ',
  },
  {
    date: '2016-05-01',
    end_date: '2016-05-01',
    name: 'May Day',
    name_bn: 'মে দিবস',
  },
  {
    date: '2016-05-21',
    end_date: '2016-05-21',
    name: 'Buddha Purnima',
    name_bn: 'বুদ্ধ পূর্ণিমা',
  },
  {
    date: '2016-05-22',
    end_date: '2016-05-22',
    name: 'Shab-e-Barat',
    name_bn: 'শবে বরাত',
  },
  {
    date: '2016-07-04',
    end_date: '2016-07-07',
    name: 'Eid-ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
  },
  {
    date: '2016-08-15',
    end_date: '2016-08-15',
    name: 'National Mourning Day',
    name_bn: 'জাতীয় শোক দিবস',
  },
  {
    date: '2016-08-25',
    end_date: '2016-08-25',
    name: 'Janmashtami',
    name_bn: 'জন্মাষ্টমী',
  },
  {
    date: '2016-09-11',
    end_date: '2016-09-13',
    name: 'Eid-ul-Azha',
    name_bn: 'ঈদুল আযহা',
  },
  {
    date: '2016-10-11',
    end_date: '2016-10-11',
    name: 'Durga Puja (Vijaya Dashami)',
    name_bn: 'দুর্গাপূজা (বিজয়া দশমী)',
  },
  {
    date: '2016-10-12',
    end_date: '2016-10-12',
    name: 'Ashura',
    name_bn: 'আশুরা',
  },
  {
    date: '2016-12-13',
    end_date: '2016-12-13',
    name: 'Eid-e-Milad-un-Nabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
  },
  {
    date: '2016-12-16',
    end_date: '2016-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    date: '2016-12-25',
    end_date: '2016-12-25',
    name: 'Christmas Day',
    name_bn: 'বড়দিন',
  },
];

export const BD_PUBLIC_HOLIDAYS_2017: readonly SeedPublicHolidayEntry[] = [
  {
    date: '2017-02-21',
    end_date: '2017-02-21',
    name: 'International Mother Language Day',
    name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
  },
  {
    date: '2017-03-17',
    end_date: '2017-03-17',
    name: "Sheikh Mujibur Rahman's Birthday & National Children's Day",
    name_bn: 'জাতির পিতার জন্মদিন ও জাতীয় শিশু দিবস',
  },
  {
    date: '2017-03-26',
    end_date: '2017-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
  {
    date: '2017-04-14',
    end_date: '2017-04-14',
    name: 'Pohela Boishakh (Bengali New Year)',
    name_bn: 'পহেলা বৈশাখ',
  },
  {
    date: '2017-05-01',
    end_date: '2017-05-01',
    name: 'May Day',
    name_bn: 'মে দিবস',
  },
  {
    date: '2017-05-10',
    end_date: '2017-05-10',
    name: 'Buddha Purnima',
    name_bn: 'বুদ্ধ পূর্ণিমা',
  },
  {
    date: '2017-05-12',
    end_date: '2017-05-12',
    name: 'Shab-e-Barat',
    name_bn: 'শবে বরাত',
  },
  {
    date: '2017-06-25',
    end_date: '2017-06-27',
    name: 'Eid-ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
  },
  {
    date: '2017-08-14',
    end_date: '2017-08-14',
    name: 'Janmashtami',
    name_bn: 'জন্মাষ্টমী',
  },
  {
    date: '2017-08-15',
    end_date: '2017-08-15',
    name: 'National Mourning Day',
    name_bn: 'জাতীয় শোক দিবস',
  },
  {
    date: '2017-09-01',
    end_date: '2017-09-03',
    name: 'Eid-ul-Azha',
    name_bn: 'ঈদুল আযহা',
  },
  {
    date: '2017-09-30',
    end_date: '2017-09-30',
    name: 'Durga Puja (Vijaya Dashami)',
    name_bn: 'দুর্গাপূজা (বিজয়া দশমী)',
  },
  {
    date: '2017-10-01',
    end_date: '2017-10-01',
    name: 'Ashura',
    name_bn: 'আশুরা',
  },
  {
    date: '2017-12-01',
    end_date: '2017-12-01',
    name: 'Eid-e-Milad-un-Nabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
  },
  {
    date: '2017-12-16',
    end_date: '2017-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    date: '2017-12-25',
    end_date: '2017-12-25',
    name: 'Christmas Day',
    name_bn: 'বড়দিন',
  },
];

export const BD_PUBLIC_HOLIDAYS_2018: readonly SeedPublicHolidayEntry[] = [
  {
    date: '2018-02-21',
    end_date: '2018-02-21',
    name: 'International Mother Language Day',
    name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
  },
  {
    date: '2018-03-17',
    end_date: '2018-03-17',
    name: "Sheikh Mujibur Rahman's Birthday & National Children's Day",
    name_bn: 'জাতির পিতার জন্মদিন ও জাতীয় শিশু দিবস',
  },
  {
    date: '2018-03-26',
    end_date: '2018-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
  {
    date: '2018-04-14',
    end_date: '2018-04-14',
    name: 'Pohela Boishakh (Bengali New Year)',
    name_bn: 'পহেলা বৈশাখ',
  },
  {
    date: '2018-04-29',
    end_date: '2018-04-29',
    name: 'Buddha Purnima',
    name_bn: 'বুদ্ধ পূর্ণিমা',
  },
  {
    date: '2018-05-01',
    end_date: '2018-05-01',
    name: 'May Day',
    name_bn: 'মে দিবস',
  },
  {
    date: '2018-06-15',
    end_date: '2018-06-17',
    name: 'Eid-ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
  },
  {
    date: '2018-08-15',
    end_date: '2018-08-15',
    name: 'National Mourning Day',
    name_bn: 'জাতীয় শোক দিবস',
  },
  {
    date: '2018-08-21',
    end_date: '2018-08-23',
    name: 'Eid-ul-Azha',
    name_bn: 'ঈদুল আযহা',
  },
  {
    date: '2018-09-02',
    end_date: '2018-09-02',
    name: 'Janmashtami',
    name_bn: 'জন্মাষ্টমী',
  },
  {
    date: '2018-09-21',
    end_date: '2018-09-21',
    name: 'Ashura',
    name_bn: 'আশুরা',
  },
  {
    date: '2018-10-19',
    end_date: '2018-10-19',
    name: 'Durga Puja (Vijaya Dashami)',
    name_bn: 'দুর্গাপূজা (বিজয়া দশমী)',
  },
  {
    date: '2018-11-21',
    end_date: '2018-11-21',
    name: 'Eid-e-Milad-un-Nabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
  },
  {
    date: '2018-12-16',
    end_date: '2018-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    date: '2018-12-25',
    end_date: '2018-12-25',
    name: 'Christmas Day',
    name_bn: 'বড়দিন',
  },
];

export const BD_PUBLIC_HOLIDAYS_2019: readonly SeedPublicHolidayEntry[] = [
  {
    date: '2019-02-21',
    end_date: '2019-02-21',
    name: 'International Mother Language Day',
    name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
  },
  {
    date: '2019-03-17',
    end_date: '2019-03-17',
    name: "Sheikh Mujibur Rahman's Birthday & National Children's Day",
    name_bn: 'জাতির পিতার জন্মদিন ও জাতীয় শিশু দিবস',
  },
  {
    date: '2019-03-26',
    end_date: '2019-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
  {
    date: '2019-04-14',
    end_date: '2019-04-14',
    name: 'Pohela Boishakh (Bengali New Year)',
    name_bn: 'পহেলা বৈশাখ',
  },
  {
    date: '2019-04-21',
    end_date: '2019-04-21',
    name: 'Shab-e-Barat',
    name_bn: 'শবে বরাত',
  },
  {
    date: '2019-05-01',
    end_date: '2019-05-01',
    name: 'May Day',
    name_bn: 'মে দিবস',
  },
  {
    date: '2019-05-18',
    end_date: '2019-05-18',
    name: 'Buddha Purnima',
    name_bn: 'বুদ্ধ পূর্ণিমা',
  },
  {
    date: '2019-06-04',
    end_date: '2019-06-06',
    name: 'Eid-ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
  },
  {
    date: '2019-08-11',
    end_date: '2019-08-13',
    name: 'Eid-ul-Azha',
    name_bn: 'ঈদুল আযহা',
  },
  {
    date: '2019-08-15',
    end_date: '2019-08-15',
    name: 'National Mourning Day',
    name_bn: 'জাতীয় শোক দিবস',
  },
  {
    date: '2019-08-23',
    end_date: '2019-08-23',
    name: 'Janmashtami',
    name_bn: 'জন্মাষ্টমী',
  },
  {
    date: '2019-09-10',
    end_date: '2019-09-10',
    name: 'Ashura',
    name_bn: 'আশুরা',
  },
  {
    date: '2019-10-08',
    end_date: '2019-10-08',
    name: 'Durga Puja (Vijaya Dashami)',
    name_bn: 'দুর্গাপূজা (বিজয়া দশমী)',
  },
  {
    date: '2019-11-10',
    end_date: '2019-11-10',
    name: 'Eid-e-Milad-un-Nabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
  },
  {
    date: '2019-12-16',
    end_date: '2019-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    date: '2019-12-25',
    end_date: '2019-12-25',
    name: 'Christmas Day',
    name_bn: 'বড়দিন',
  },
];

export const BD_PUBLIC_HOLIDAYS_2020: readonly SeedPublicHolidayEntry[] = [
  {
    date: '2020-02-21',
    end_date: '2020-02-21',
    name: 'International Mother Language Day',
    name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
  },
  {
    date: '2020-03-17',
    end_date: '2020-03-17',
    name: "Sheikh Mujibur Rahman's Birthday & National Children's Day",
    name_bn: 'জাতির পিতার জন্মদিন ও জাতীয় শিশু দিবস',
  },
  {
    date: '2020-03-26',
    end_date: '2020-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
  {
    date: '2020-04-09',
    end_date: '2020-04-09',
    name: 'Shab-e-Barat',
    name_bn: 'শবে বরাত',
  },
  {
    date: '2020-04-14',
    end_date: '2020-04-14',
    name: 'Pohela Boishakh (Bengali New Year)',
    name_bn: 'পহেলা বৈশাখ',
  },
  {
    date: '2020-05-01',
    end_date: '2020-05-01',
    name: 'May Day',
    name_bn: 'মে দিবস',
  },
  {
    date: '2020-05-07',
    end_date: '2020-05-07',
    name: 'Buddha Purnima',
    name_bn: 'বুদ্ধ পূর্ণিমা',
  },
  {
    date: '2020-05-24',
    end_date: '2020-05-26',
    name: 'Eid-ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
  },
  {
    date: '2020-07-31',
    end_date: '2020-08-02',
    name: 'Eid-ul-Azha',
    name_bn: 'ঈদুল আযহা',
  },
  {
    date: '2020-08-11',
    end_date: '2020-08-11',
    name: 'Janmashtami',
    name_bn: 'জন্মাষ্টমী',
  },
  {
    date: '2020-08-15',
    end_date: '2020-08-15',
    name: 'National Mourning Day',
    name_bn: 'জাতীয় শোক দিবস',
  },
  {
    date: '2020-08-29',
    end_date: '2020-08-29',
    name: 'Ashura',
    name_bn: 'আশুরা',
  },
  {
    date: '2020-10-26',
    end_date: '2020-10-26',
    name: 'Durga Puja (Vijaya Dashami)',
    name_bn: 'দুর্গাপূজা (বিজয়া দশমী)',
  },
  {
    date: '2020-10-30',
    end_date: '2020-10-30',
    name: 'Eid-e-Milad-un-Nabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
  },
  {
    date: '2020-12-16',
    end_date: '2020-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    date: '2020-12-25',
    end_date: '2020-12-25',
    name: 'Christmas Day',
    name_bn: 'বড়দিন',
  },
];

export const BD_PUBLIC_HOLIDAYS_2021: readonly SeedPublicHolidayEntry[] = [
  {
    date: '2021-02-21',
    end_date: '2021-02-21',
    name: 'International Mother Language Day',
    name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
  },
  {
    date: '2021-03-17',
    end_date: '2021-03-17',
    name: "Sheikh Mujibur Rahman's Birthday & National Children's Day",
    name_bn: 'জাতির পিতার জন্মদিন ও জাতীয় শিশু দিবস',
  },
  {
    date: '2021-03-26',
    end_date: '2021-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
  {
    date: '2021-03-30',
    end_date: '2021-03-30',
    name: 'Shab-e-Barat',
    name_bn: 'শবে বরাত',
  },
  {
    date: '2021-04-14',
    end_date: '2021-04-14',
    name: 'Pohela Boishakh (Bengali New Year)',
    name_bn: 'পহেলা বৈশাখ',
  },
  {
    date: '2021-05-01',
    end_date: '2021-05-01',
    name: 'May Day',
    name_bn: 'মে দিবস',
  },
  {
    date: '2021-05-13',
    end_date: '2021-05-15',
    name: 'Eid-ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
  },
  {
    date: '2021-05-26',
    end_date: '2021-05-26',
    name: 'Buddha Purnima',
    name_bn: 'বুদ্ধ পূর্ণিমা',
  },
  {
    date: '2021-07-20',
    end_date: '2021-07-22',
    name: 'Eid-ul-Azha',
    name_bn: 'ঈদুল আযহা',
  },
  {
    date: '2021-08-15',
    end_date: '2021-08-15',
    name: 'National Mourning Day',
    name_bn: 'জাতীয় শোক দিবস',
  },
  {
    date: '2021-08-19',
    end_date: '2021-08-19',
    name: 'Ashura',
    name_bn: 'আশুরা',
  },
  {
    date: '2021-08-30',
    end_date: '2021-08-30',
    name: 'Janmashtami',
    name_bn: 'জন্মাষ্টমী',
  },
  {
    date: '2021-10-15',
    end_date: '2021-10-15',
    name: 'Durga Puja (Vijaya Dashami)',
    name_bn: 'দুর্গাপূজা (বিজয়া দশমী)',
  },
  {
    date: '2021-10-20',
    end_date: '2021-10-20',
    name: 'Eid-e-Milad-un-Nabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
  },
  {
    date: '2021-12-16',
    end_date: '2021-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    date: '2021-12-25',
    end_date: '2021-12-25',
    name: 'Christmas Day',
    name_bn: 'বড়দিন',
  },
];

export const BD_PUBLIC_HOLIDAYS_2022: readonly SeedPublicHolidayEntry[] = [
  {
    date: '2022-02-21',
    end_date: '2022-02-21',
    name: 'International Mother Language Day',
    name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
  },
  {
    date: '2022-03-17',
    end_date: '2022-03-17',
    name: "Sheikh Mujibur Rahman's Birthday & National Children's Day",
    name_bn: 'জাতির পিতার জন্মদিন ও জাতীয় শিশু দিবস',
  },
  {
    date: '2022-03-18',
    end_date: '2022-03-18',
    name: 'Shab-e-Barat',
    name_bn: 'শবে বরাত',
  },
  {
    date: '2022-03-26',
    end_date: '2022-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
  {
    date: '2022-04-14',
    end_date: '2022-04-14',
    name: 'Pohela Boishakh (Bengali New Year)',
    name_bn: 'পহেলা বৈশাখ',
  },
  {
    date: '2022-05-01',
    end_date: '2022-05-01',
    name: 'May Day',
    name_bn: 'মে দিবস',
  },
  {
    date: '2022-05-03',
    end_date: '2022-05-05',
    name: 'Eid-ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
  },
  {
    date: '2022-05-16',
    end_date: '2022-05-16',
    name: 'Buddha Purnima',
    name_bn: 'বুদ্ধ পূর্ণিমা',
  },
  {
    date: '2022-07-10',
    end_date: '2022-07-13',
    name: 'Eid-ul-Azha',
    name_bn: 'ঈদুল আযহা',
  },
  {
    date: '2022-08-09',
    end_date: '2022-08-09',
    name: 'Ashura',
    name_bn: 'আশুরা',
  },
  {
    date: '2022-08-15',
    end_date: '2022-08-15',
    name: 'National Mourning Day',
    name_bn: 'জাতীয় শোক দিবস',
  },
  {
    date: '2022-08-19',
    end_date: '2022-08-19',
    name: 'Janmashtami',
    name_bn: 'জন্মাষ্টমী',
  },
  {
    date: '2022-10-05',
    end_date: '2022-10-05',
    name: 'Durga Puja (Vijaya Dashami)',
    name_bn: 'দুর্গাপূজা (বিজয়া দশমী)',
  },
  {
    date: '2022-10-09',
    end_date: '2022-10-09',
    name: 'Eid-e-Milad-un-Nabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
  },
  {
    date: '2022-12-16',
    end_date: '2022-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    date: '2022-12-25',
    end_date: '2022-12-25',
    name: 'Christmas Day',
    name_bn: 'বড়দিন',
  },
];

export const BD_PUBLIC_HOLIDAYS_2023: readonly SeedPublicHolidayEntry[] = [
  {
    date: '2023-02-21',
    end_date: '2023-02-21',
    name: 'International Mother Language Day',
    name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
  },
  {
    date: '2023-03-08',
    end_date: '2023-03-08',
    name: 'Shab-e-Barat',
    name_bn: 'শবে বরাত',
  },
  {
    date: '2023-03-17',
    end_date: '2023-03-17',
    name: "Sheikh Mujibur Rahman's Birthday & National Children's Day",
    name_bn: 'জাতির পিতার জন্মদিন ও জাতীয় শিশু দিবস',
  },
  {
    date: '2023-03-26',
    end_date: '2023-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
  {
    date: '2023-04-14',
    end_date: '2023-04-14',
    name: 'Pohela Boishakh (Bengali New Year)',
    name_bn: 'পহেলা বৈশাখ',
  },
  {
    date: '2023-04-20',
    end_date: '2023-04-23',
    name: 'Eid-ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
  },
  {
    date: '2023-05-01',
    end_date: '2023-05-01',
    name: 'May Day',
    name_bn: 'মে দিবস',
  },
  {
    date: '2023-05-04',
    end_date: '2023-05-04',
    name: 'Buddha Purnima',
    name_bn: 'বুদ্ধ পূর্ণিমা',
  },
  {
    date: '2023-06-27',
    end_date: '2023-06-30',
    name: 'Eid-ul-Azha',
    name_bn: 'ঈদুল আযহা',
  },
  {
    date: '2023-07-29',
    end_date: '2023-07-29',
    name: 'Ashura',
    name_bn: 'আশুরা',
  },
  {
    date: '2023-08-15',
    end_date: '2023-08-15',
    name: 'National Mourning Day',
    name_bn: 'জাতীয় শোক দিবস',
  },
  {
    date: '2023-09-06',
    end_date: '2023-09-06',
    name: 'Janmashtami',
    name_bn: 'জন্মাষ্টমী',
  },
  {
    date: '2023-09-28',
    end_date: '2023-09-28',
    name: 'Eid-e-Milad-un-Nabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
  },
  {
    date: '2023-10-24',
    end_date: '2023-10-24',
    name: 'Durga Puja (Vijaya Dashami)',
    name_bn: 'দুর্গাপূজা (বিজয়া দশমী)',
  },
  {
    date: '2023-12-16',
    end_date: '2023-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    date: '2023-12-25',
    end_date: '2023-12-25',
    name: 'Christmas Day',
    name_bn: 'বড়দিন',
  },
];

export const BD_PUBLIC_HOLIDAYS_2024: readonly SeedPublicHolidayEntry[] = [
  {
    date: '2024-02-21',
    end_date: '2024-02-21',
    name: 'International Mother Language Day',
    name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
  },
  {
    date: '2024-02-26',
    end_date: '2024-02-26',
    name: 'Shab-e-Barat',
    name_bn: 'শবে বরাত',
  },
  {
    date: '2024-03-17',
    end_date: '2024-03-17',
    name: "Sheikh Mujibur Rahman's Birthday & National Children's Day",
    name_bn: 'জাতির পিতার জন্মদিন ও জাতীয় শিশু দিবস',
  },
  {
    date: '2024-03-26',
    end_date: '2024-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
  {
    date: '2024-04-10',
    end_date: '2024-04-12',
    name: 'Eid-ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
  },
  {
    date: '2024-04-14',
    end_date: '2024-04-14',
    name: 'Pohela Boishakh (Bengali New Year)',
    name_bn: 'পহেলা বৈশাখ',
  },
  {
    date: '2024-05-01',
    end_date: '2024-05-01',
    name: 'May Day',
    name_bn: 'মে দিবস',
  },
  {
    date: '2024-05-22',
    end_date: '2024-05-22',
    name: 'Buddha Purnima',
    name_bn: 'বুদ্ধ পূর্ণিমা',
  },
  {
    date: '2024-06-16',
    end_date: '2024-06-18',
    name: 'Eid-ul-Azha',
    name_bn: 'ঈদুল আযহা',
  },
  {
    date: '2024-07-17',
    end_date: '2024-07-17',
    name: 'Ashura',
    name_bn: 'আশুরা',
  },
  {
    date: '2024-08-26',
    end_date: '2024-08-26',
    name: 'Janmashtami',
    name_bn: 'জন্মাষ্টমী',
  },
  {
    date: '2024-09-16',
    end_date: '2024-09-16',
    name: 'Eid-e-Milad-un-Nabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
  },
  {
    date: '2024-10-13',
    end_date: '2024-10-13',
    name: 'Durga Puja (Vijaya Dashami)',
    name_bn: 'দুর্গাপূজা (বিজয়া দশমী)',
  },
  {
    date: '2024-12-16',
    end_date: '2024-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    date: '2024-12-25',
    end_date: '2024-12-25',
    name: 'Christmas Day',
    name_bn: 'বড়দিন',
  },
];

export const BD_PUBLIC_HOLIDAYS_2025: readonly SeedPublicHolidayEntry[] = [
  {
    date: '2025-02-14',
    end_date: '2025-02-14',
    name: 'Shab-e-Barat',
    name_bn: 'শবে বরাত',
  },
  {
    date: '2025-02-21',
    end_date: '2025-02-21',
    name: 'International Mother Language Day',
    name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
  },
  {
    date: '2025-03-26',
    end_date: '2025-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
  {
    date: '2025-03-29',
    end_date: '2025-04-03',
    name: 'Eid-ul-Fitr',
    name_bn: 'ঈদুল ফিতর',
  },
  {
    date: '2025-04-14',
    end_date: '2025-04-14',
    name: 'Pohela Boishakh (Bengali New Year)',
    name_bn: 'পহেলা বৈশাখ',
  },
  {
    date: '2025-05-01',
    end_date: '2025-05-01',
    name: 'May Day',
    name_bn: 'মে দিবস',
  },
  {
    date: '2025-05-11',
    end_date: '2025-05-11',
    name: 'Buddha Purnima',
    name_bn: 'বুদ্ধ পূর্ণিমা',
  },
  {
    date: '2025-06-07',
    end_date: '2025-06-12',
    name: 'Eid-ul-Azha',
    name_bn: 'ঈদুল আযহা',
  },
  {
    date: '2025-07-06',
    end_date: '2025-07-06',
    name: 'Ashura',
    name_bn: 'আশুরা',
  },
  {
    date: '2025-08-05',
    end_date: '2025-08-05',
    name: 'July Mass Uprising Day',
    name_bn: 'জুলাই গণ-অভ্যুত্থান দিবস',
  },
  {
    date: '2025-08-16',
    end_date: '2025-08-16',
    name: 'Janmashtami',
    name_bn: 'জন্মাষ্টমী',
  },
  {
    date: '2025-09-05',
    end_date: '2025-09-05',
    name: 'Eid-e-Milad-un-Nabi',
    name_bn: 'ঈদে মিলাদুন্নবী',
  },
  {
    date: '2025-10-01',
    end_date: '2025-10-02',
    name: 'Durga Puja (Vijaya Dashami)',
    name_bn: 'দুর্গাপূজা (বিজয়া দশমী)',
  },
  {
    date: '2025-12-16',
    end_date: '2025-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    date: '2025-12-25',
    end_date: '2025-12-25',
    name: 'Christmas Day',
    name_bn: 'বড়দিন',
  },
];

/** Every set keyed by year: 2016 to 2027, no gaps. */
export const BD_PUBLIC_HOLIDAYS_BY_YEAR: Readonly<
  Record<number, readonly SeedPublicHolidayEntry[]>
> = {
  2016: BD_PUBLIC_HOLIDAYS_2016,
  2017: BD_PUBLIC_HOLIDAYS_2017,
  2018: BD_PUBLIC_HOLIDAYS_2018,
  2019: BD_PUBLIC_HOLIDAYS_2019,
  2020: BD_PUBLIC_HOLIDAYS_2020,
  2021: BD_PUBLIC_HOLIDAYS_2021,
  2022: BD_PUBLIC_HOLIDAYS_2022,
  2023: BD_PUBLIC_HOLIDAYS_2023,
  2024: BD_PUBLIC_HOLIDAYS_2024,
  2025: BD_PUBLIC_HOLIDAYS_2025,
  2026: BD_PUBLIC_HOLIDAYS_2026,
  2027: BD_PUBLIC_HOLIDAYS_2027,
};
