/** Guardian occupations ([58.1.04]), weighted. A slice picks one with `ctx.rng`. */

import type { NamePair } from './names';

export interface WeightedOccupation extends NamePair {
  weight: number;
}

export const GUARDIAN_OCCUPATIONS: readonly WeightedOccupation[] = [
  { en: 'Businessman', bn: 'ব্যবসায়ী', weight: 22 },
  { en: 'Private Service Holder', bn: 'বেসরকারি চাকরিজীবী', weight: 20 },
  { en: 'Government Service Holder', bn: 'সরকারি চাকরিজীবী', weight: 10 },
  { en: 'Teacher', bn: 'শিক্ষক', weight: 6 },
  { en: 'Driver', bn: 'চালক', weight: 7 },
  { en: 'Day Labourer', bn: 'দিনমজুর', weight: 6 },
  { en: 'Garments Worker', bn: 'পোশাক শ্রমিক', weight: 7 },
  { en: 'Shopkeeper', bn: 'দোকানদার', weight: 7 },
  { en: 'Farmer', bn: 'কৃষক', weight: 3 },
  { en: 'Doctor', bn: 'চিকিৎসক', weight: 2 },
  { en: 'Engineer', bn: 'প্রকৌশলী', weight: 2 },
  { en: 'Overseas Worker', bn: 'প্রবাসী', weight: 5 },
  { en: 'Housewife', bn: 'গৃহিণী', weight: 3 },
];
