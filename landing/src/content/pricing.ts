import type { Lang } from '../i18n';

export const PRICE_PER_SEAT_PAISA = 1000;
export const FREE_UNTIL = '2027-01-01';
export const SLAB_STUDENTS = [300, 500, 1000, 2000];
export const SLAB_MONTHS = [1, 6, 12];
export const SLIDER = {
  students: { min: 50, max: 5000, step: 50, value: 500 },
  months: { min: 1, max: 12, step: 1, value: 6 },
};

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const toBnDigits = (s: string) => s.replace(/\d/g, (d) => BN_DIGITS[+d]);

/** 30000 → '৩০,০০০' (en-IN lakh grouping, Bangla digits; matches the mockup `fmt`). */
export const formatBn = (n: number | string) => toBnDigits(Number(n).toLocaleString('en-IN'));

export function formatNumber(lang: Lang, n: number): string {
  const s = n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return lang === 'bn' ? toBnDigits(s) : s;
}

export const formatMoney = (lang: Lang, paisa: number) => `৳${formatNumber(lang, paisa / 100)}`;

export const total = (students: number, months: number) => students * months * PRICE_PER_SEAT_PAISA;

export const slabRows = () =>
  SLAB_STUDENTS.map((students) => ({ students, totals: SLAB_MONTHS.map((m) => total(students, m)) }));

export const copy = {
  bn: {
    title: 'দাম',
    eyebrow: 'দাম',
    h1Pre: 'প্রতি ছাত্র',
    h1Post: '/ মাস',
    leadPre: 'সরল হিসাব, কোনো প্যাকেজ নেই। ',
    leadStrong: '৩১ ডিসেম্বর ২০২৬ পর্যন্ত সব ছাত্র ফ্রি।',
    leadPost: ' জানুয়ারি ২০২৭ থেকে আগে থেকে (প্রিপেইড) সিট কিনে নেবেন।',
    calcH2: 'আপনার স্কুলে কত পড়বে?',
    students: 'ছাত্র সংখ্যা:',
    months: 'কত মাসের জন্য:',
    totalLabel: 'মোট (প্রিপেইড)',
    perMonth: 'মাসে {n}',
    thStudents: 'ছাত্র',
    thMonths: ['১ মাস', '৬ মাস', '১২ মাস'],
    buyH2: 'কীভাবে কিনবেন',
    steps: [
      { h: 'অ্যাকাউন্ট খুলুন', p: 'ফোন নম্বর যাচাই করে, ২ মিনিটে। কোনো টাকা লাগে না।', soon: false },
      {
        h: 'স্কুল সাজান',
        p: 'প্রিসেট বেছে নিন (NCTB / আলিয়া / কওমি / Cambridge), শ্রেণি-সেকশন, শিক্ষক, ছাত্র।',
        soon: false,
      },
      {
        h: 'সিট কিনুন, ড্যাশবোর্ড থেকেই',
        p: '২০২৭ থেকে ছাত্র যোগ করার সময় সেটিংস › সিট ও বিলিং-এ কতজন × কত মাস, এটুকুই।',
        soon: true,
      },
    ],
    soon: 'শীঘ্রই',
    tryPre: 'কেনার আগে ',
    demo: 'ডেমো',
    tryMid: ' ঘুরে দেখুন আর ',
    docs: 'ডকুমেন্টেশন',
    tryPost: ' পড়ুন।',
    faq: [
      { q: 'সিট মানে কী?', a: 'একজন সক্রিয় ছাত্র, এক মাসের জন্য। ছাত্র চলে গেলে সিট খালি হয়, নতুন ছাত্র সেটায় বসে।' },
      { q: 'সিট শেষ হলে?', a: '৭ দিন শুধু দেখা যাবে, তারপর বন্ধ; সিট কিনলেই সাথে সাথে চালু।' },
      { q: 'ভ্যাট?', a: 'প্রযোজ্য হলে রসিদে আলাদা লাইন থাকবে।' },
    ],
  },
  en: {
    title: 'Pricing',
    eyebrow: 'Pricing',
    h1Pre: 'Per student',
    h1Post: '/ month',
    leadPre: 'Simple maths, no packages. ',
    leadStrong: 'Every student is free until 31 December 2026.',
    leadPost: ' From January 2027 you buy seats in advance (prepaid).',
    calcH2: 'What will it cost your school?',
    students: 'Students:',
    months: 'For how many months:',
    totalLabel: 'Total (prepaid)',
    perMonth: '{n} / month',
    thStudents: 'Students',
    thMonths: ['1 month', '6 months', '12 months'],
    buyH2: 'How to buy',
    steps: [
      { h: 'Open an account', p: 'Verify your phone number, 2 minutes. No money needed.', soon: false },
      {
        h: 'Set up your school',
        p: 'Pick a preset (NCTB / Alia / Qawmi / Cambridge), then classes and sections, teachers, students.',
        soon: false,
      },
      {
        h: 'Buy seats, right from the dashboard',
        p: 'From 2027, while adding students, go to Settings › Seats & billing: how many × how many months, that is all.',
        soon: true,
      },
    ],
    soon: 'Soon',
    tryPre: 'Before buying, try the ',
    demo: 'demo',
    tryMid: ' and read the ',
    docs: 'documentation',
    tryPost: '.',
    faq: [
      { q: 'What is a seat?', a: 'One active student for one month. When a student leaves, the seat frees up and a new student takes it.' },
      { q: 'What if seats run out?', a: 'Read-only for 7 days, then locked; buying seats turns it back on at once.' },
      { q: 'VAT?', a: 'If it applies, it is a separate line on the receipt.' },
    ],
  },
};

export type PricingCopy = (typeof copy)[Lang];
