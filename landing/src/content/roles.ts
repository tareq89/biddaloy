import type { Hue, L } from './hero';

/** Carousel slides (D6, D30, D40). `key` = demo role key from server/src/modules/demo/demo-accounts.ts. */
export interface Role {
  key: 'admin' | 'principal' | 'class-teacher-8a' | 'guardian' | 'accountant' | 'student-9b';
  hue: Hue;
  frame: 'desktop' | 'phone';
  url: string;
  tag: L;
  title: L;
  shot: L;
  shotName: string; // screenshot manifest name (`role/page`) shown in the carousel
  before: L;
  after: L;
}

export const roles: Role[] = [
  {
    key: 'admin', hue: 'indigo', frame: 'desktop', url: 'app.schoolmanagerp.com/dashboard',
    tag: { bn: 'অ্যাডমিন', en: 'Admin' },
    title: { bn: 'সকাল ৮টায় পুরো স্কুল এক পাতায়', en: 'The whole school on one page at 8 am' },
    shot: { bn: 'অ্যাডমিন ড্যাশবোর্ড', en: 'Admin dashboard' },
    shotName: 'admin/dashboard',
    before: { bn: 'সকালে পাঁচজনকে ফোন করে জানতে হতো, কী হলো, কী হলো না।', en: 'Five phone calls every morning to learn what got done and what did not.' },
    after: { bn: 'সকাল ৮টায় ফোনে তিন লাইনে পুরো স্কুল: কী বাকি, কার কাছে।', en: 'At 8 am, three lines on the phone: what is pending and with whom.' },
  },
  {
    key: 'principal', hue: 'teal', frame: 'desktop', url: 'app.schoolmanagerp.com/dashboard',
    tag: { bn: 'প্রিন্সিপাল', en: 'Principal' },
    title: { bn: 'ফলাফল বিশ্লেষণ আর অনুমোদন', en: 'Result analysis and approvals' },
    shot: { bn: 'প্রিন্সিপাল ড্যাশবোর্ড', en: 'Principal dashboard' },
    shotName: 'principal/dashboard',
    before: { bn: 'রেজাল্ট বেরোনোর পর কোন শ্রেণি পিছিয়ে, বুঝতে লাগত সপ্তাহ।', en: 'After results, it took a week to see which class was falling behind.' },
    after: { bn: 'পাসের হার শ্রেণি ও বিষয় ধরে সাথে সাথে; ছুটির অনুমোদন এক ক্লিকে।', en: 'Pass rate by class and subject instantly; leave approved in one click.' },
  },
  {
    key: 'class-teacher-8a', hue: 'amber', frame: 'phone', url: 'app.schoolmanagerp.com/my-class',
    tag: { bn: 'শিক্ষক · ফোনে (PWA)', en: 'Teacher · on the phone (PWA)' },
    title: { bn: 'হাজিরা, ৩০ সেকেন্ডে', en: 'Attendance in 30 seconds' },
    shot: { bn: 'শিক্ষকের হাজিরা পাতা', en: "Teacher's attendance page" },
    shotName: 'class-teacher-8a/attendance',
    before: { bn: 'খাতায় হাজিরা, মাস শেষে যোগ, অভিভাবক কিছু জানতেন না।', en: 'Attendance in a register, totals at month end, guardians knew nothing.' },
    after: { bn: '৩০ সেকেন্ডে হাজিরা, অনুপস্থিতির SMS নিজে থেকেই সেদিনই।', en: 'Attendance in 30 seconds, absence SMS goes out by itself the same day.' },
  },
  {
    key: 'guardian', hue: 'coral', frame: 'phone', url: 'app.schoolmanagerp.com/portal',
    tag: { bn: 'অভিভাবক · ফোনে (PWA)', en: 'Guardian · on the phone (PWA)' },
    title: { bn: 'সন্তানের খবর, SMS-এর অপেক্ষা নেই', en: "Your child's news, no waiting for SMS" },
    shot: { bn: 'অভিভাবক পোর্টাল', en: 'Guardian portal' },
    shotName: 'guardian/home',
    before: { bn: 'ফি-র কাগজ হারাত, রেজাল্ট জানতে স্কুলে যেতে হতো।', en: 'Fee slips got lost; you went to school to learn the result.' },
    after: { bn: 'বকেয়া, রেজাল্ট, রুটিন ফোনে; সন্তান অনুপস্থিত হলে সাথে সাথে খবর।', en: 'Dues, results, routine on the phone; instant word if your child is absent.' },
  },
  {
    key: 'accountant', hue: 'teal', frame: 'desktop', url: 'app.schoolmanagerp.com/fees/dues',
    tag: { bn: 'হিসাবরক্ষক', en: 'Accountant' },
    title: { bn: 'বকেয়া থেকে রিমাইন্ডার, এক ক্লিক', en: 'From dues to reminders in one click' },
    shot: { bn: 'বকেয়া তালিকা', en: 'Dues list' },
    shotName: 'accountant/dues',
    before: { bn: 'কে দিল, কে দিল না, খাতা খুঁজে বের করা।', en: 'Who paid and who did not: dig through the ledger.' },
    after: { bn: 'বকেয়ার তালিকা শ্রেণি ধরে, রিমাইন্ডার এক ক্লিকে সবাইকে।', en: 'Dues listed by class, reminders to everyone in one click.' },
  },
  {
    key: 'student-9b', hue: 'indigo', frame: 'phone', url: 'app.schoolmanagerp.com/portal',
    tag: { bn: 'ছাত্র · ফোনে (PWA)', en: 'Student · on the phone (PWA)' },
    title: { bn: 'আজকের রুটিন, হোমওয়ার্ক, সিলেবাস', en: "Today's routine, homework, syllabus" },
    shot: { bn: 'ছাত্র পোর্টাল', en: 'Student portal' },
    shotName: 'student-9b/routine',
    before: { bn: 'রুটিন বদলালে জানা যেত পরদিন ক্লাসে এসে।', en: 'A routine change was learned the next day, in class.' },
    after: { bn: 'আজকের রুটিন, হোমওয়ার্ক, পরীক্ষার সূচি ফোনে।', en: "Today's routine, homework and exam schedule on the phone." },
  },
];

export const captions = { before: { bn: 'আগে', en: 'Before' }, after: { bn: 'এখন', en: 'Now' } };
