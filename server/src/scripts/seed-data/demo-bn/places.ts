/**
 * Demo addresses ([58.1.04]). Dhaka areas plus road/house patterns, so a slice
 * builds an address with `ctx.rng` and never invents text. Phones are NOT
 * stored here: they are generated (D26).
 */

import type { NamePair } from './names';

/** The school's own fixed area. */
export const SCHOOL_AREA: NamePair = { en: 'Mirpur, Dhaka', bn: 'মিরপুর, ঢাকা' };

/** Dhaka thanas / areas the families live in (weighted toward the school's own area by the slice). */
export const DHAKA_AREAS: readonly NamePair[] = [
  { en: 'Mirpur', bn: 'মিরপুর' },
  { en: 'Pallabi', bn: 'পল্লবী' },
  { en: 'Kafrul', bn: 'কাফরুল' },
  { en: 'Mohammadpur', bn: 'মোহাম্মদপুর' },
  { en: 'Dhanmondi', bn: 'ধানমন্ডি' },
  { en: 'Uttara', bn: 'উত্তরা' },
  { en: 'Badda', bn: 'বাড্ডা' },
  { en: 'Rampura', bn: 'রামপুরা' },
  { en: 'Khilgaon', bn: 'খিলগাঁও' },
  { en: 'Tejgaon', bn: 'তেজগাঁও' },
  { en: 'Gulshan', bn: 'গুলশান' },
  { en: 'Shyamoli', bn: 'শ্যামলী' },
  { en: 'Kallyanpur', bn: 'কল্যাণপুর' },
  { en: 'Agargaon', bn: 'আগারগাঁও' },
  { en: 'Shah Ali', bn: 'শাহ আলী' },
  { en: 'Jatrabari', bn: 'যাত্রাবাড়ী' },
];

/** Road and house patterns. `{n}` is replaced with a number by the slice. */
export const ROAD_PATTERNS: readonly NamePair[] = [
  { en: 'House {n}, Road {n}, Block C', bn: 'বাড়ি {n}, রোড {n}, ব্লক সি' },
  { en: 'House {n}, Lane {n}, Section 10', bn: 'বাড়ি {n}, লেন {n}, সেকশন ১০' },
  { en: 'Flat {n}, Holding {n}, Main Road', bn: 'ফ্ল্যাট {n}, হোল্ডিং {n}, মেইন রোড' },
  { en: 'House {n}, Avenue {n}, Block B', bn: 'বাড়ি {n}, অ্যাভিনিউ {n}, ব্লক বি' },
  { en: 'Village Road {n}, Ward {n}', bn: 'গ্রাম সড়ক {n}, ওয়ার্ড {n}' },
];
