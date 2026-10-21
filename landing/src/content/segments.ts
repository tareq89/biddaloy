import type { Lang } from '../i18n';

export type Text = Record<Lang, string>;
export type SegmentId = 'school' | 'madrasa' | 'english-medium';

export interface Segment {
  title: Text;
  /** Meta description, ≤155 chars per language. */
  description: Text;
  /** Preset pack ids from server/src/modules/presets/packs/index.ts. */
  presets: string[];
  h1: Text;
  sub: Text;
  features: { title: Text; body: Text }[];
  /** Placeholder shot ids; W3 swaps real images by `data-shot`. */
  shots: string[];
  faq: { q: Text; a: Text }[];
}

export const SEGMENT_IDS: SegmentId[] = ['school', 'madrasa', 'english-medium'];

// Features shared by every segment (D9: only shipped things).
const common = {
  attention: {
    title: { bn: 'কার দিকে নজর দরকার, নিজে থেকে বলে', en: 'Tells you who needs attention' },
    body: {
      bn: 'অনুপস্থিতি, বকেয়া বেতন, বাকি থাকা কাজ—সব এক জায়গায়। সকালে খুললেই দেখবেন কোন ছাত্রকে আজ ডাকা দরকার।',
      en: 'Absences, unpaid fees, overdue tasks — one list. Open it in the morning and see which student to call today.',
    },
  },
  exams: {
    title: { bn: 'সিট প্ল্যান থেকে মার্কশিট, এক ধারায়', en: 'Seat plan to mark sheet, one flow' },
    body: {
      bn: 'পরীক্ষার সিট প্ল্যান বানান, শিক্ষক নম্বর তোলেন, ফল হিসাব হয়, মার্কশিট ছাপা হয়। মাঝে কোনো Excel নেই।',
      en: 'Make the seat plan, teachers enter marks, results compute, mark sheets print. No Excel in between.',
    },
  },
  fees: {
    title: { bn: 'বেতন ও বকেয়া, হিসাব মিলে যায়', en: 'Fees and dues that add up' },
    body: {
      bn: 'মাসিক বেতন, ভর্তি ফি, জরিমানা—সব আদায়ের রসিদ ছাপুন। কে কত বাকি, এক ক্লিকে।',
      en: 'Monthly fees, admission fees, fines — print a receipt for every collection. Who owes what, in one click.',
    },
  },
  routine: {
    title: { bn: 'ক্লাস রুটিন ও পড়ার পরিকল্পনা', en: 'Class routine and study plans' },
    body: {
      bn: 'রুটিন বানান, অনুপস্থিত শিক্ষকের বদলি দিন। পাঠ্যসূচি ধরে পড়ার পরিকল্পনা ছাত্র ও অভিভাবক দেখেন।',
      en: 'Build the routine, cover absent teachers with substitutions. Study plans follow the syllabus and are visible to students and guardians.',
    },
  },
  offline: {
    title: { bn: 'নেট না থাকলেও চলে', en: 'Works without internet' },
    body: {
      bn: 'অফলাইন PWA—হাজিরা নিন, নেট ফিরলে নিজে থেকে মিলে যায়। বাংলা সংখ্যা সব জায়গায়।',
      en: 'Offline PWA — take attendance and it syncs when the connection returns. Bangla numerals everywhere.',
    },
  },
  branches: {
    title: { bn: 'একাধিক শাখা, এক হিসাব', en: 'Many branches, one account' },
    body: {
      bn: 'শহরের দুই-তিনটা শাখা একসাথে চালান। প্রতিটি শাখার নিজের ছাত্র, নিজের হিসাব, এক লগইন।',
      en: 'Run two or three branches together. Each branch keeps its own students and accounts, one login.',
    },
  },
  print: {
    title: { bn: 'যা ছাপা দরকার, সব ছাপে', en: 'Prints everything you need' },
    body: {
      bn: 'আইডি কার্ড, প্রশংসাপত্র, রসিদ, মার্কশিট—ব্রাউজার থেকেই ছাপুন। স্কুলের নাম-লোগো নিজে বসান।',
      en: 'ID cards, certificates, receipts, mark sheets — print from the browser. Your own name and logo on each.',
    },
  },
};

export const SEGMENTS: Record<SegmentId, Segment> = {
  school: {
    title: { bn: 'স্কুল ম্যানেজমেন্ট সফটওয়্যার', en: 'School management software' },
    description: {
      bn: 'এনসিটিবি পাঠ্যক্রমে তৈরি স্কুল সফটওয়্যার। হাজিরা, বেতন, পরীক্ষা, রুটিন, মার্কশিট—বাংলায়, অফলাইনেও চলে।',
      en: 'School software built on the Bangladesh NCTB curriculum. Attendance, fees, exams, routine, mark sheets — in Bangla, works offline.',
    },
    presets: ['bd/nctb'],
    h1: { bn: 'আপনার স্কুলের পুরো অফিস, এক জায়গায়', en: 'Your whole school office, in one place' },
    sub: {
      bn: 'বাংলাদেশ এনসিটিবি পাঠ্যক্রম আগে থেকেই বসানো। শ্রেণি, বিষয়, গ্রেডিং—প্রথম দিনেই তৈরি। খাতা আর Excel থেকে মুক্তি।',
      en: 'The Bangladesh NCTB curriculum comes pre-loaded. Classes, subjects, grading — ready on day one. No more registers and Excel.',
    },
    features: [common.attention, common.exams, common.fees, common.routine, common.offline],
    shots: ['school-dashboard', 'school-results'],
    faq: [
      {
        q: { bn: 'আমাদের শ্রেণি আর বিষয় কি নিজে বসাতে হবে?', en: 'Do we have to set up classes and subjects ourselves?' },
        a: {
          bn: 'না। “বাংলাদেশ এনসিটিবি পাঠ্যক্রম” প্রিসেট বেছে নিলে শ্রেণি, বিষয় ও গ্রেডিং স্কেল নিজে থেকে আসে। পরে বদলাতে পারবেন।',
          en: 'No. Pick the “Bangladesh NCTB curriculum” preset and classes, subjects and the grading scale come ready. You can change them later.',
        },
      },
      {
        q: { bn: 'শিক্ষকরা কি মোবাইলে হাজিরা নিতে পারবেন?', en: 'Can teachers take attendance on a phone?' },
        a: {
          bn: 'পারবেন। মোবাইল ব্রাউজার থেকেই চলে, PWA হিসেবে ইনস্টল করা যায়। নেট না থাকলেও হাজিরা নেওয়া যায়।',
          en: 'Yes. It runs in the phone browser and installs as a PWA. Attendance works even without internet.',
        },
      },
      {
        q: { bn: 'খরচ কত?', en: 'What does it cost?' },
        a: {
          bn: '৩১ ডিসেম্বর ২০২৬ পর্যন্ত সব ছাত্র ফ্রি। কোনো কার্ড লাগে না। আগে ডেমো স্কুলে ঢুকে দেখুন।',
          en: 'Free for every student until 31 December 2026. No card needed. Try the demo school first.',
        },
      },
    ],
  },
  madrasa: {
    title: { bn: 'মাদ্রাসা ম্যানেজমেন্ট সফটওয়্যার', en: 'Madrasa management software' },
    description: {
      bn: 'আলিয়া ও কওমি মাদ্রাসার জন্য তৈরি সফটওয়্যার। ইবতেদায়ি থেকে কামিল বা তাকমিল—হাজিরা, বেতন, পরীক্ষা, বাংলায়।',
      en: 'Software made for Alia and Qawmi madrasas. Ebtedayee to Kamil or Takmil — attendance, fees, exams, in Bangla.',
    },
    presets: ['bd/alia-madrasa', 'bd/qawmi-madrasa'],
    h1: { bn: 'মাদ্রাসার হিসাব, মাদ্রাসার ভাষায়', en: 'Madrasa records, in the madrasa’s own terms' },
    sub: {
      bn: 'আলিয়া (ইবতেদায়ি, দাখিল, আলিম, ফাযিল, কামিল) ও কওমি (ইবতেদায়ী থেকে তাকমিল) দুই ধারার প্রিসেট আছে। কুরআন, হাদিস, ফিকহ, আরবি—বিষয়গুলো আগে থেকেই তৈরি।',
      en: 'Presets for both Alia (Ebtedayee, Dakhil, Alim, Fazil, Kamil) and Qawmi (Ibtedayi to Takmil). Qur’an, Hadith, Fiqh and Arabic subjects come ready.',
    },
    features: [
      {
        title: { bn: 'আলিয়া ও কওমি, দুই প্রিসেট', en: 'Alia and Qawmi, two presets' },
        body: {
          bn: 'আলিয়ায় আরবি প্রথম ও দ্বিতীয় পত্র, আকাইদ ও ফিকহ, হাদিস শরিফ। কওমিতে কুরআন ও তাজবীদ, হাদীস, ফিকহ, আরবি ভাষা ও সাহিত্য। আপনার ধারা বেছে নিন।',
          en: 'Alia carries Arabic 1st and 2nd paper, Aqaid and Fiqh, Hadith. Qawmi carries Qur’an and Tajwid, Hadith, Fiqh, Arabic language and literature. Pick your stream.',
        },
      },
      common.attention,
      common.exams,
      common.fees,
      common.offline,
    ],
    shots: ['madrasa-dashboard', 'madrasa-results'],
    faq: [
      {
        q: { bn: 'আমরা কওমি মাদ্রাসা। শ্রেণির নাম কি বদলাতে পারব?', en: 'We are a Qawmi madrasa. Can we change class names?' },
        a: {
          bn: 'কওমি প্রিসেটে ইবতেদায়ী, মুতাওয়াসসিতা, সানাবিয়্যাহ, ফযিলত, তাকমিল—এই স্তরগুলো আগে থেকেই থাকে। নাম বদলানো যায়।',
          en: 'The Qawmi preset ships with Ibtedayi, Mutawassitah, Sanawiyya, Fazilat and Takmil stages. Names can be edited.',
        },
      },
      {
        q: { bn: 'দাখিল ও আলিমের জিপিএ হিসাব হবে?', en: 'Does it compute Dakhil and Alim GPA?' },
        a: {
          bn: 'হবে। আলিয়া প্রিসেটে দাখিল/আলিম জিপিএ ৫.০০ গ্রেডিং স্কেল আছে। ফল ও মার্কশিট সেই স্কেলেই ছাপা হয়।',
          en: 'Yes. The Alia preset includes the Dakhil/Alim GPA 5.00 grading scale. Results and mark sheets use it.',
        },
      },
      {
        q: { bn: 'খরচ কত?', en: 'What does it cost?' },
        a: {
          bn: '৩১ ডিসেম্বর ২০২৬ পর্যন্ত সব ছাত্র ফ্রি। কোনো কার্ড লাগে না। আগে ডেমো স্কুলে ঢুকে দেখুন।',
          en: 'Free for every student until 31 December 2026. No card needed. Try the demo school first.',
        },
      },
    ],
  },
  'english-medium': {
    title: { bn: 'ইংলিশ মিডিয়াম স্কুল সফটওয়্যার', en: 'English-medium school software' },
    description: {
      bn: 'ক্যামব্রিজ ইন্টারন্যাশনাল প্রিসেটসহ ইংলিশ মিডিয়াম স্কুলের সফটওয়্যার। প্রাইমারি থেকে এ লেভেল, পুরোটা ইংরেজিতে চলে।',
      en: 'English-medium school software with a Cambridge International preset. Primary to A Level, runs fully in English.',
    },
    presets: ['intl/cambridge'],
    h1: { bn: 'ইংলিশ মিডিয়াম স্কুলের জন্য, ইংরেজিতেই', en: 'Built for English-medium schools, in English' },
    sub: {
      bn: 'ক্যামব্রিজ ইন্টারন্যাশনাল প্রিসেট: প্রাইমারি, লোয়ার সেকেন্ডারি, আইজিসিএসই / ও লেভেল, এএস / এ লেভেল। পুরো সফটওয়্যার ইংরেজিতে চলে; চাইলে বাংলাও।',
      en: 'Cambridge International preset: Primary, Lower Secondary, IGCSE / O Level, AS / A Level. The whole product runs fully in English; Bangla if you want it.',
    },
    features: [
      {
        title: { bn: 'ক্যামব্রিজ প্রিসেট, প্রথম দিনেই', en: 'Cambridge preset, day one' },
        body: {
          bn: 'ইয়ার ১ থেকে ইয়ার ১৩, চার স্তরে ভাগ। ইংরেজি, গণিত, বিজ্ঞান থেকে পদার্থ, রসায়ন, জীববিজ্ঞান, কম্পিউটার সায়েন্স, অর্থনীতি, ব্যবসায় শিক্ষা—বিষয় তৈরি।',
          en: 'Year 1 to Year 13 across four stages. Subjects from English, Mathematics and Science up to Physics, Chemistry, Biology, Computer Science, Economics and Business Studies.',
        },
      },
      common.attention,
      common.exams,
      common.fees,
      common.branches,
    ],
    shots: ['english-medium-dashboard', 'english-medium-results'],
    faq: [
      {
        q: { bn: 'পুরো সফটওয়্যার কি ইংরেজিতে চলে?', en: 'Does the whole product run in English?' },
        a: {
          bn: 'হ্যাঁ। প্রতিটি পাতা, রসিদ ও মার্কশিট ইংরেজিতে পাওয়া যায়। যে ব্যবহারকারী চান, বাংলায়ও দেখতে পারেন।',
          en: 'Yes. Every page, receipt and mark sheet is available in English. Any user who prefers Bangla can switch.',
        },
      },
      {
        q: { bn: 'আমাদের বিষয়ের নাম ক্যামব্রিজের তালিকার সাথে মেলে না। সমস্যা?', en: 'Our subject names differ from the Cambridge list. Problem?' },
        a: {
          bn: 'না। প্রিসেট শুধু শুরুর তালিকা। বিষয় যোগ, বাদ বা নাম বদল যখন খুশি করা যায়।',
          en: 'No. The preset is only a starting list. Add, remove or rename subjects whenever you like.',
        },
      },
      {
        q: { bn: 'খরচ কত?', en: 'What does it cost?' },
        a: {
          bn: '৩১ ডিসেম্বর ২০২৬ পর্যন্ত সব ছাত্র ফ্রি। কোনো কার্ড লাগে না। আগে ডেমো স্কুলে ঢুকে দেখুন।',
          en: 'Free for every student until 31 December 2026. No card needed. Try the demo school first.',
        },
      },
    ],
  },
};
