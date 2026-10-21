import type { Lang } from '../i18n';

/** One string per language. Pick with `x[lang]`. */
export type L = Record<Lang, string>;
export type Hue = 'indigo' | 'teal' | 'amber' | 'coral';

/** Rotating hero phrase (D29): the comma travels with the phrase. */
export interface Phrase { hue: Hue; text: L }

export const phrases: Phrase[] = [
  { hue: 'indigo', text: { bn: 'প্রশাসনিক কাজ কমান,', en: 'cut admin work,' } },
  { hue: 'teal', text: { bn: 'শিক্ষকদের সময় বাঁচান,', en: 'save teachers time,' } },
  { hue: 'indigo', text: { bn: 'শিক্ষার মান বাড়ান,', en: 'raise learning quality,' } },
  { hue: 'amber', text: { bn: 'স্বচ্ছতা আনুন,', en: 'bring transparency,' } },
  { hue: 'coral', text: { bn: 'নজরদারি বাড়ান,', en: 'keep a closer watch,' } },
];

export const hero = {
  before: { bn: 'আপনার স্কুলে', en: 'In your school,' },
  after: { bn: 'এক সফটওয়্যারে', en: 'with one software' },
  sub: {
    bn: 'হাজিরা, রেজাল্ট, রুটিন, ফি আর অভিভাবকের SMS, সব এক জায়গায়, ফোনেই চলে। কোন কাজ বাকি, সিস্টেম নিজেই মনে করিয়ে দেয়।',
    en: 'Attendance, results, routine, fees and guardian SMS, all in one place, right on the phone. The system itself reminds you what is still pending.',
  },
  subStrong: {
    bn: 'আপনার পুরোনো Excel বা খাতা থেকে ছাত্রদের তথ্য আমরা তুলে দিই।',
    en: 'We move your student records over from your old Excel or register.',
  },
  register: { bn: 'ফ্রি অ্যাকাউন্ট খুলুন', en: 'Open a free account' },
  demo: { bn: '▶ ডেমো স্কুল ঘুরে দেখুন', en: '▶ Tour the demo school' },
  tiny: { bn: '৩১ ডিসেম্বর ২০২৬ পর্যন্ত সব ছাত্র ফ্রি · কোনো কার্ড লাগে না', en: 'Free for every student until 31 December 2026 · no card needed' },
  video: { bn: '৯০ সেকেন্ডে দেখুন (ভিডিও আসছে)', en: 'See it in 90 seconds (video coming)' },
  trust: [
    { icon: '🇧🇩', text: { bn: 'ডেটা দেশেই থাকে', en: 'Data stays in Bangladesh' } },
    { icon: '📵', text: { bn: 'ইন্টারনেট গেলেও চলে', en: 'Works when the internet drops' } },
    { icon: '📤', text: { bn: 'যখন খুশি Excel-এ নিয়ে যান', en: 'Export to Excel any time' } },
    { icon: '☎', text: { bn: 'ফোন করলে মানুষ ধরে', en: 'A human answers the phone' } },
  ],
  prev: { bn: 'আগের', en: 'Previous' },
  next: { bn: 'পরের', en: 'Next' },
};
