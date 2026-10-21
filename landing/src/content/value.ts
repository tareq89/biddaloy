import type { Hue, L } from './hero';

/** "মাসে ছাত্র প্রতি ১০ টাকায় কী পাচ্ছেন" (D41). */
export interface ValueRow { hue: Hue; icon: string; name: L; before: L; after: L }

export const value = {
  eyebrow: { bn: 'মাসে ছাত্র প্রতি ১০ টাকায় কী পাচ্ছেন', en: 'What ৳10 per student per month buys' },
  title: { bn: 'যে পাঁচটা কাজে স্কুলের সবচেয়ে বেশি সময় যায়', en: 'The five jobs that eat most of a school’s time' },
  lead: { bn: '৫০০ ছাত্রের একটা স্কুলে সাধারণত যা হয়। আপনার স্কুলের সংখ্যা ডেমোতে নিজে মিলিয়ে দেখুন।', en: 'What usually happens in a 500-student school. Check your own numbers in the demo.' },
  rows: [
    { hue: 'coral', icon: '✎', name: { bn: 'রেজাল্ট', en: 'Results' },
      before: { bn: 'তিন-চার জন শিক্ষক, তিন থেকে পাঁচ দিন। একটা নম্বর ভুল হলে পুরো শিট আবার।', en: 'Three or four teachers, three to five days. One wrong mark and the whole sheet is redone.' },
      after: { bn: 'নম্বর তোলার সাথে সাথে ট্যাবুলেশন, গ্রেড আর মার্কশিট তৈরি। ভুল থাকলে তখনই ধরা পড়ে।', en: 'Tabulation, grades and mark sheets the moment marks are entered. Errors are caught right there.' } },
    { hue: 'teal', icon: '✓', name: { bn: 'হাজিরা', en: 'Attendance' },
      before: { bn: 'খাতায় টিক, মাস শেষে যোগ। অভিভাবক জানতেন না সন্তান স্কুলে গেছে কি না।', en: 'Ticks in a register, totals at month end. Guardians never knew if the child reached school.' },
      after: { bn: 'ফোনে ৩০ সেকেন্ড। অনুপস্থিত থাকলে অভিভাবকের ফোনে সেদিনই SMS।', en: '30 seconds on the phone. If absent, the guardian gets an SMS the same day.' } },
    { hue: 'amber', icon: '⎙', name: { bn: 'প্রিন্ট', en: 'Printing' },
      before: { bn: 'ID কার্ড, প্রবেশপত্র, সনদ, সব দোকানে গিয়ে। প্রতিবার নতুন করে টাইপ।', en: 'ID cards, admit cards, certificates: all at the print shop, retyped every time.' },
      after: { bn: 'স্কুলের নিজের প্রিন্টারে, নিজের নকশায়, সিরিয়াল নম্বর আর QR সহ।', en: 'On the school’s own printer, in its own design, with serial numbers and QR.' } },
    { hue: 'indigo', icon: '৳', name: { bn: 'ফি', en: 'Fees' },
      before: { bn: 'কে দিল, কে দিল না, খাতা উল্টে খোঁজা। বকেয়া জমতে জমতে বছর শেষ।', en: 'Who paid, who did not: flip through the ledger. Dues pile up until year end.' },
      after: { bn: 'বকেয়ার তালিকা শ্রেণি ধরে, রিমাইন্ডার SMS এক ক্লিকে সবাইকে।', en: 'Dues listed by class, reminder SMS to everyone in one click.' } },
    { hue: 'coral', icon: '◎', name: { bn: 'নজরদারি', en: 'Oversight' },
      before: { bn: 'কোন শিক্ষক হাজিরা নেননি, কার নম্বর বাকি, জানা যেত মাস শেষে।', en: 'Which teacher skipped attendance, whose marks are pending: known at month end.' },
      after: { bn: 'সিস্টেম সকালেই বলে দেয় কার কী বাকি। প্রথমে তাঁকে, দেরি হলে আপনাকে।', en: 'The system says each morning who owes what. First to them, then to you if it slips.' } },
  ] as ValueRow[],
  sum: { bn: '৳৫,০০০', en: '৳5,000' },
  sumSmall: { bn: 'মাসে, ৫০০ ছাত্রে', en: 'per month, 500 students' },
  sumText: { bn: 'একজন পিয়নের অর্ধেক বেতনে পুরো অফিসের হিসাব, রেজাল্ট আর অভিভাবক-যোগাযোগ। আর ১ জানুয়ারি ২০২৭ পর্যন্ত এটুকুও লাগছে না।', en: 'Half a peon’s salary for the whole office’s accounts, results and guardian contact. And until 1 January 2027 not even that.' },
};

/** "শুরু করতে তিনটা ধাপ, এক দুপুর" (D42). Lives here: value + setup are the two "why/how" sections. */
export const setup = {
  title: { bn: 'শুরু করতে তিনটা ধাপ, এক দুপুর', en: 'Three steps to start, one afternoon' },
  lead: { bn: 'কম্পিউটার না জানলেও চলে। আটকে গেলে WhatsApp-এ আমরা আছি।', en: 'No computer skills needed. If you get stuck, we are on WhatsApp.' },
  steps: [
    { title: { bn: 'ফোন নম্বর দিয়ে অ্যাকাউন্ট', en: 'Account with a phone number' }, text: { bn: 'নাম, স্কুলের নাম, ফোন নম্বর। SMS-এ একটা কোড আসে, ব্যস। দুই মিনিট।', en: 'Name, school name, phone number. A code arrives by SMS, done. Two minutes.' } },
    { title: { bn: 'স্কুলের ধরন বেছে নিন', en: 'Pick your school type' }, text: { bn: 'NCTB, আলিয়া, কওমি বা Cambridge। শ্রেণি, বিষয় আর গ্রেডিং নিজে থেকেই বসে যায়। পরে যা খুশি বদলানো যায়।', en: 'NCTB, Alia, Qawmi or Cambridge. Classes, subjects and grading fall into place by themselves. Change anything later.' } },
    { title: { bn: 'ছাত্রদের তালিকা Excel-এ দিন', en: 'Give the student list in Excel' }, text: { bn: 'আমাদের Excel ছকে নাম, শ্রেণি, অভিভাবকের ফোন। এক ফাইলে পুরো স্কুল উঠে যায়।', en: 'Name, class and guardian phone in our Excel template. The whole school goes up in one file.' } },
  ],
  nums: ['১', '২', '৩'],
  excel: { bn: 'Excel ছক নামান →', en: 'Download the Excel template →' },
  promiseB: { bn: 'Excel নেই?', en: 'No Excel?' },
  promise: { bn: 'পুরোনো খাতা বা রেজিস্টারের ছবি WhatsApp করুন। ৫০০ ছাত্র পর্যন্ত আমরা নিজেরা তুলে দিই, বিনামূল্যে। এর বেশি হলে কথা বলে নেব।', en: 'WhatsApp us photos of the old register. Up to 500 students we enter ourselves, free. Beyond that, we talk.' },
  register: { bn: 'ফ্রি অ্যাকাউন্ট খুলুন', en: 'Open a free account' },
  whatsapp: { bn: 'WhatsApp-এ কথা বলুন', en: 'Talk on WhatsApp' },
};
