/**
 * Hand-curated Bangla data pools, standing in for what `@faker-js/faker`'s
 * `bn_BD` locale doesn't provide (see `./faker.ts`). Small, real, and
 * enough to exercise Bangla script in tests — not an attempt at exhaustive
 * coverage of Bangladeshi names or geography.
 */
import { faker } from './faker';

const BN_MALE_FIRST_NAMES = [
  'রাকিব',
  'তানভীর',
  'আরাফাত',
  'সজীব',
  'ফাহিম',
  'ইমরান',
  'নাফিস',
  'রায়হান',
  'তাহসিন',
  'শাকিল',
] as const;

const BN_FEMALE_FIRST_NAMES = [
  'তাসনিম',
  'নুসরাত',
  'সুমাইয়া',
  'ফারিয়া',
  'মাহিয়া',
  'জান্নাতুল',
  'সাদিয়া',
  'রুমানা',
  'তানজিলা',
  'ইশরাত',
] as const;

const BN_LAST_NAMES = [
  'ইসলাম',
  'রহমান',
  'আহমেদ',
  'চৌধুরী',
  'খান',
  'হোসেন',
  'আক্তার',
  'সরকার',
  'মিয়া',
  'তালুকদার',
] as const;

const BN_DISTRICTS = [
  'ঢাকা',
  'চট্টগ্রাম',
  'রাজশাহী',
  'খুলনা',
  'সিলেট',
  'বরিশাল',
  'রংপুর',
  'ময়মনসিংহ',
] as const;

// 01[3-9] — the fixed set of BD mobile operator prefixes — followed by 8
// more digits: 11 digits total, the domestic format every BD phone field
// in this codebase expects (no +880 country code).
const BD_MOBILE_PREFIXES = ['013', '014', '015', '016', '017', '018', '019'] as const;

export type Gender = 'male' | 'female';

export function bnFullName(gender?: Gender): string {
  const pool =
    gender === 'female'
      ? BN_FEMALE_FIRST_NAMES
      : gender === 'male'
        ? BN_MALE_FIRST_NAMES
        : [...BN_MALE_FIRST_NAMES, ...BN_FEMALE_FIRST_NAMES];
  const first = faker.helpers.arrayElement(pool);
  const last = faker.helpers.arrayElement(BN_LAST_NAMES);
  return `${first} ${last}`;
}

export function bnPhoneNumber(): string {
  const prefix = faker.helpers.arrayElement(BD_MOBILE_PREFIXES);
  return `${prefix}${faker.string.numeric(8)}`;
}

export function bnAddress(): string {
  const houseNo = faker.number.int({ min: 1, max: 200 });
  const roadNo = faker.number.int({ min: 1, max: 30 });
  const district = faker.helpers.arrayElement(BN_DISTRICTS);
  return `বাড়ি নং ${houseNo}, রোড নং ${roadNo}, ${district}`;
}
