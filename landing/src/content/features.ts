import type { Lang } from '../i18n';

/** The owner's 15 areas (landing-mockup-v5.html, AREAS). bn text verbatim; a bullet starting with ◌ renders the amber শীঘ্রই badge (D34). */
export type Hue = 'indigo' | 'teal' | 'amber' | 'coral';
export interface AreaCopy {
  title: string;
  bullets: string[];
  shots: string[];
}
export interface Area {
  hue: Hue;
  icon: string;
  docs: string;
  bn: AreaCopy;
  en: AreaCopy;
}

export const SOON = '◌';

export const areas: Area[] = [
  {
    hue: 'indigo',
    icon: '◎',
    docs: 'attention',
    bn: {
      title: 'অ্যাটেনশন ইঞ্জিন, সিস্টেমের মাথা',
      bullets: [
        '৪৯টা নিয়ম প্রতিদিন স্কুলটা দেখে: হাজিরা না নেওয়া, নম্বর বাকি, রুটিন প্রকাশ না হওয়া, সেকশনে ক্লাস টিচার না থাকা, রিমাইন্ডার পড়ে থাকা, সেটআপ অসম্পূর্ণ, পরের বছর তৈরি না হওয়া। মানুষকে মনে রাখতে হয় না।',
        'ধাপে ধাপে দায়িত্ব: প্রথমে যার কাজ তাকে, দেরি হলে উপরে (পরীক্ষা নিয়ন্ত্রক, অ্যাডমিন, প্রিন্সিপাল)।',
        'সকালের ডাইজেস্ট: অ্যাডমিন, প্রিন্সিপাল আর শিক্ষকের ফোনে কাজের দিনে পুশ, "আজ এই ৩টা কাজ আপনার", quiet hours মেনে।',
        'অভিভাবক fallback: পুশ না পৌঁছালে SMS।',
        'হাতে অ্যালার্ট + রিপোর্ট: অ্যাডমিন নিজেও অ্যালার্ট পাঠাতে পারেন; কোন অ্যালার্ট কতবার, কে সাড়া দিল, তার রিপোর্ট।',
      ],
      shots: ['অ্যাটেনশন কেন্দ্র', 'সকালের ডাইজেস্ট পুশ'],
    },
    en: {
      title: 'Attention engine, the brain of the system',
      bullets: [
        '49 rules watch the school every day: attendance not taken, marks missing, routine not published, a section without a class teacher, reminders left unanswered, setup incomplete, next year not created. Nobody has to remember.',
        'Step-by-step responsibility: first to whoever owns the task, then upwards when it is late (exam controller, admin, principal).',
        'Morning digest: a push on working days to the admin, principal and teachers, "these 3 tasks are yours today", respecting quiet hours.',
        'Guardian fallback: SMS when the push does not arrive.',
        'Manual alerts + reports: admins can send alerts themselves; reports on which alert fired how often and who responded.',
      ],
      shots: ['Attention centre', 'Morning digest push'],
    },
  },
  {
    hue: 'teal',
    icon: '✓',
    docs: 'attendance',
    bn: {
      title: 'হাজিরা',
      bullets: [
        'দিন ও পিরিয়ড, দুই রকম রেজিস্টার; মাসের ম্যাট্রিক্স এক পাতায় সংশোধন।',
        'শিক্ষকের বাকি তালিকা: কোন সেকশনের হাজিরা আজ হয়নি, এক নজরে।',
        'অনুপস্থিতির SMS রেজিস্টার ফাইনাল হলেই; ভুল সংশোধন করলে সংশোধনের SMS-ও যায়।',
        'স্ক্যানার / ডিভাইস: কার্ড পাঞ্চ সরাসরি হাজিরা, প্রতিটা ডিভাইসের নিজস্ব key, স্কুলের নিজস্ব নীতি (কখন late)।',
        'স্ট্রিক: টানা ৩ দিন অনুপস্থিত, ৩ দিন late, ১৫ দিন উপস্থিত, ক্লাস টিচারের পাতায় লাল/সবুজ।',
        'স্টাফ হাজিরা ও ছুটি: ছুটির ব্যালান্স লাইভ হিসাব, আবেদন ও অনুমোদন।',
        '◌ "সন্তান স্কুলে পৌঁছেছে" পুশ।',
      ],
      shots: ['হাজিরা রেজিস্টার', 'ক্লাস টিচারের পাতা (স্ট্রিক)'],
    },
    en: {
      title: 'Attendance',
      bullets: [
        'Daily and period registers; the month matrix corrected on one page.',
        'Teacher backlog: which sections have no attendance today, at a glance.',
        'Absence SMS only once the register is final; correct a mistake and a correction SMS goes out too.',
        'Scanners / devices: a card punch is attendance, each device has its own key, the school sets its own policy (when is "late").',
        'Streaks: 3 days absent in a row, 3 days late, 15 days present, red/green on the class teacher page.',
        'Staff attendance and leave: live leave balance, applications and approval.',
        '◌ "Your child has reached school" push.',
      ],
      shots: ['Attendance register', 'Class teacher page (streaks)'],
    },
  },
  {
    hue: 'amber',
    icon: '▦',
    docs: 'routine',
    bn: {
      title: 'রুটিন',
      bullets: [
        'পিরিয়ড, কক্ষ, শিক্ষক ধরে গ্রিড; auto-fill প্রস্তাব দেয়, আপনি ঠিক করেন।',
        'বদলি (substitution): শিক্ষক না এলে কে নেবে, সিস্টেম প্রস্তাব করে।',
        'বদলের অনুরোধ: শিক্ষক চাইলে অনুরোধ, অ্যাডমিন অনুমোদন, রুটিনে নিজে থেকে বসে।',
        'এক বছরের রুটিন পরের বছরে কপি।',
      ],
      shots: ['রুটিন গ্রিড'],
    },
    en: {
      title: 'Routine',
      bullets: [
        'A grid by period, room and teacher; auto-fill proposes, you decide.',
        'Substitution: when a teacher is absent the system proposes who takes over.',
        'Change requests: a teacher asks, the admin approves, the routine updates itself.',
        'Copy one year’s routine into the next.',
      ],
      shots: ['Routine grid'],
    },
  },
  {
    hue: 'coral',
    icon: '✎',
    docs: 'exams',
    bn: {
      title: 'পরীক্ষা ও ফলাফল',
      bullets: [
        'পরীক্ষার টেমপ্লেট ও অংশ (লিখিত/ব্যবহারিক/MCQ), সময়সূচি, প্রকাশ।',
        'আসন বিন্যাস: প্রতি বিষয়-সিটিং ধরে allocation engine, সম্পাদনা, প্রকাশ।',
        'নম্বর গ্রিড: ডেডলাইন সহ, কে দিল কে দেয়নি দেখা যায়।',
        'গ্রেডিং স্কেল বদলালে ফলাফল নিজে থেকে recompute।',
        'ট্রান্সক্রিপ্ট, ফলাফলের SMS।',
        'নম্বর বিশ্লেষণ: সেকশন ধরে পাস/ফেল, অংশ ভাঙা, কোন শ্রেণিতে নজর দরকার।',
        'প্রমোশন পরের বছরে।',
      ],
      shots: ['নম্বর গ্রিড', 'আসন বিন্যাস'],
    },
    en: {
      title: 'Exams and results',
      bullets: [
        'Exam templates and parts (written/practical/MCQ), schedule, publishing.',
        'Seat plan: an allocation engine per subject sitting, edit, publish.',
        'Marks grid with deadlines; see who has entered and who has not.',
        'Change the grading scale and results recompute themselves.',
        'Transcripts, result SMS.',
        'Marks analysis: pass/fail by section, part breakdown, which class needs attention.',
        'Promotion into the next year.',
      ],
      shots: ['Marks grid', 'Seat plan'],
    },
  },
  {
    hue: 'indigo',
    icon: '৳',
    docs: 'fees',
    bn: {
      title: 'ফি, জরিমানা, ইনভয়েস',
      bullets: [
        'এক ক্লিকে পুরো স্কুলের ইনভয়েস (batch), বকেয়া তালিকা, ছাড়ের নিয়ম, checkout cart।',
        'জরিমানার নিয়ম: অনুপস্থিত/late থেকে নিজে থেকেই জরিমানা, নিয়মিত sweep।',
        'ইনভয়েস শেয়ার লিংক: অভিভাবক লগ ইন ছাড়াই দেখেন, লিংক মেয়াদ শেষে বন্ধ।',
        'রিমাইন্ডার, বকেয়া রিপোর্ট।',
        '◌ সিট/সাবস্ক্রিপশন কেনা ড্যাশবোর্ড থেকে।',
      ],
      shots: ['বকেয়া তালিকা', 'ইনভয়েস'],
    },
    en: {
      title: 'Fees, fines, invoices',
      bullets: [
        'Invoice the whole school in one click (batch), dues list, discount rules, checkout cart.',
        'Fine rules: fines from absence/lateness automatically, with a regular sweep.',
        'Invoice share link: guardians view without logging in; the link expires.',
        'Reminders, dues reports.',
        '◌ Buy seats/subscription from the dashboard.',
      ],
      shots: ['Dues list', 'Invoice'],
    },
  },
  {
    hue: 'teal',
    icon: '✉',
    docs: 'communications',
    bn: {
      title: 'অভিভাবক-যোগাযোগ',
      bullets: [
        'পুশ আগে, SMS পরে: খরচ কমে, বার্তা পৌঁছায়।',
        'SMS গেটওয়ে (greenweb / mimsms), টেমপ্লেট, SMS ক্রেডিটের হিসাব প্রতিটা স্কুলে।',
        'অনুপস্থিতি, বকেয়া, ফলাফল: সব বার্তা বাংলায়।',
      ],
      shots: ['যোগাযোগ লগ'],
    },
    en: {
      title: 'Guardian communication',
      bullets: [
        'Push first, SMS second: lower cost, the message still arrives.',
        'SMS gateway (greenweb / mimsms), templates, SMS credit accounting per school.',
        'Absence, dues, results: every message in Bangla.',
      ],
      shots: ['Communication log'],
    },
  },
  {
    hue: 'amber',
    icon: '⎙',
    docs: 'print',
    bn: {
      title: 'প্রিন্ট',
      bullets: [
        'টেমপ্লেট এডিটর, ভার্সন সহ; প্রিন্টার প্রোফাইল; প্রিন্ট জবের ইতিহাস।',
        'ID কার্ড, সনদ সিরিয়াল নম্বর সহ, প্রবেশপত্র, আসন তালিকা, ট্যাবুলেশন শিট।',
        'QR দিয়ে যাচাই: সনদ আসল কি না, পাবলিক পাতায়।',
      ],
      shots: ['টেমপ্লেট এডিটর', 'সনদ ও QR'],
    },
    en: {
      title: 'Print',
      bullets: [
        'Template editor with versions; printer profiles; print job history.',
        'ID cards, certificates with serial numbers, admit cards, seat lists, tabulation sheets.',
        'QR verification: is a certificate genuine, on a public page.',
      ],
      shots: ['Template editor', 'Certificate and QR'],
    },
  },
  {
    hue: 'coral',
    icon: '◔',
    docs: 'study-plans',
    bn: {
      title: 'স্টাডি প্ল্যান ও হোমওয়ার্ক',
      bullets: [
        'লেসন প্ল্যান সেকশন-বিষয় ধরে, কী পড়ানো হলো mark করা, টেমপ্লেট ও CSV।',
        'এসকেলেশন: সন্ধ্যা ৬টায় না দিলে পরদিন সকাল ৮টায় শিক্ষককে পুশ, ২ দিন পরে প্রিন্সিপাল/অ্যাডমিনকে; সপ্তাহে অভিভাবক ও কমিটিকে ডাইজেস্ট।',
        'হোমওয়ার্ক: জমা, analytics।',
      ],
      shots: ['স্টাডি প্ল্যান'],
    },
    en: {
      title: 'Study plans and homework',
      bullets: [
        'Lesson plans per section and subject, mark what was taught, templates and CSV.',
        'Escalation: not entered by 6 pm → push to the teacher at 8 am next day, after 2 days to the principal/admin; a weekly digest to guardians and the committee.',
        'Homework: submissions, analytics.',
      ],
      shots: ['Study plan'],
    },
  },
  {
    hue: 'indigo',
    icon: '▣',
    docs: 'calendar',
    bn: {
      title: 'একাডেমিক ক্যালেন্ডার',
      bullets: [
        'টার্ম, ইভেন্ট, ছুটি; import/export; ICS feed ফোনের ক্যালেন্ডারে; প্ল্যাটফর্মের holiday set।',
      ],
      shots: ['ক্যালেন্ডার'],
    },
    en: {
      title: 'Academic calendar',
      bullets: [
        'Terms, events, holidays; import/export; an ICS feed into the phone calendar; platform holiday sets.',
      ],
      shots: ['Calendar'],
    },
  },
  {
    hue: 'teal',
    icon: '☰',
    docs: 'admission',
    bn: {
      title: 'ভর্তি ও আবেদন',
      bullets: [
        'পাবলিক ভর্তি ফর্ম স্কুলের নিজের লিংকে, বট-সুরক্ষা (Turnstile) সহ; আবেদন রিভিউ, ড্যাশবোর্ড, রিপোর্ট, নোটিফিকেশন।',
        'আবেদন: ছুটি, ফি মওকুফ, সনদ, চিঠি; ধাপে ধাপে অনুমোদন (ক্লাস টিচারের ধাপ সহ), সংযুক্তি, রিপোর্ট।',
      ],
      shots: ['ভর্তি ফর্ম', 'আবেদন অনুমোদন'],
    },
    en: {
      title: 'Admission and applications',
      bullets: [
        'A public admission form on the school’s own link, with bot protection (Turnstile); application review, dashboard, reports, notifications.',
        'Applications: leave, fee waiver, certificates, letters; step-by-step approval (including a class teacher step), attachments, reports.',
      ],
      shots: ['Admission form', 'Application approval'],
    },
  },
  {
    hue: 'amber',
    icon: '☺',
    docs: 'students',
    bn: {
      title: 'ছাত্র ও স্টাফ রেকর্ড',
      bullets: [
        'ছাত্রের জীবনচক্র: ভর্তি, TC/leaving, graduate, পুনঃভর্তি, নোট, ছবি।',
        'ক্লাস টিচারের "আমার ক্লাস": এক পাতায় পুরো সেকশন।',
        'স্টাফ HR প্রোফাইল।',
        'এসিআর: criteria, assessment, incident; শিক্ষক-মূল্যায়ন survey, ফল seal করা; performance tab।',
        'প্রোগ্রাম ও মাইলস্টোন।',
      ],
      shots: ['ছাত্রের প্রোফাইল', 'আমার ক্লাস'],
    },
    en: {
      title: 'Student and staff records',
      bullets: [
        'Student lifecycle: admission, TC/leaving, graduate, re-admission, notes, photos.',
        'The class teacher’s "My class": the whole section on one page.',
        'Staff HR profiles.',
        'ACR: criteria, assessment, incidents; teacher-evaluation surveys with sealed results; performance tab.',
        'Programs and milestones.',
      ],
      shots: ['Student profile', 'My class'],
    },
  },
  {
    hue: 'coral',
    icon: '⌂',
    docs: 'organisation',
    bn: {
      title: 'প্রতিষ্ঠানের কাঠামো',
      bullets: [
        'মাল্টি-ব্রাঞ্চ: প্রতিটা শাখা আলাদা, একই লগ ইন।',
        'শিফট/ভার্সন/গ্রুপ, স্কুলের নিজের শব্দে।',
        'প্রিসেট: NCTB, আলিয়া, কওমি, Cambridge, Blank, শ্রেণি-বিষয়-গ্রেডিং কয়েক মিনিটে।',
        'Bulk import Excel থেকে।',
        'পুরো স্কুল export/import (workbook): নিজের তথ্য নিজের হাতে, lock-in নেই।',
      ],
      shots: ['প্রিসেট প্রয়োগ'],
    },
    en: {
      title: 'Institution structure',
      bullets: [
        'Multi-branch: every branch separate, one login.',
        'Shift/version/group, in the school’s own words.',
        'Presets: NCTB, Alia, Qawmi, Cambridge, Blank; classes, subjects and grading in minutes.',
        'Bulk import from Excel.',
        'Whole-school export/import (workbook): your data in your own hands, no lock-in.',
      ],
      shots: ['Applying a preset'],
    },
  },
  {
    hue: 'indigo',
    icon: '▤',
    docs: 'dashboards',
    bn: {
      title: 'প্রতিটা ভূমিকার নিজের ড্যাশবোর্ড',
      bullets: [
        'অ্যাডমিন (১১ উইজেট), প্রিন্সিপাল (৮), শিক্ষক (৭), হিসাবরক্ষক (৮), অফিস স্টাফ (৭), পরীক্ষা নিয়ন্ত্রক, কমিটি।',
        'অভিভাবক/ছাত্র পোর্টাল: ফি, ফলাফল, রুটিন, হোমওয়ার্ক, হাজিরা, পরীক্ষার সময়সূচি, সিলেবাস, ক্যালেন্ডার, survey, প্রোগ্রাম।',
        '১০টা built-in ভূমিকা, শিক্ষক শুধু নিজের সেকশন দেখেন, অভিভাবক শুধু নিজের পরিবার।',
      ],
      shots: ['অ্যাডমিন ড্যাশবোর্ড', 'অভিভাবক পোর্টাল'],
    },
    en: {
      title: 'A dashboard for every role',
      bullets: [
        'Admin (11 widgets), principal (8), teacher (7), accountant (8), office staff (7), exam controller, committee.',
        'Guardian/student portal: fees, results, routine, homework, attendance, exam schedule, syllabus, calendar, surveys, programs.',
        '10 built-in roles; teachers see only their own sections, guardians only their own family.',
      ],
      shots: ['Admin dashboard', 'Guardian portal'],
    },
  },
  {
    hue: 'teal',
    icon: '☼',
    docs: 'settings/language',
    bn: {
      title: 'ব্যবহারের অভিজ্ঞতা',
      bullets: [
        'বাংলা ও English, বাংলা অঙ্ক সহ; দিন ও রাতের theme।',
        'ফোনে ইনস্টল, অফলাইনে খোলে (PWA)।',
        'Ctrl+K: যেকোনো কাজ কিবোর্ডে।',
        'Step-up approval (সংবেদনশীল কাজে আবার OTP/পাসওয়ার্ড), audit log।',
      ],
      shots: ['Ctrl+K প্যালেট'],
    },
    en: {
      title: 'Everyday experience',
      bullets: [
        'Bangla and English, with Bangla numerals; day and night themes.',
        'Install on the phone, opens offline (PWA).',
        'Ctrl+K: any task from the keyboard.',
        'Step-up approval (OTP/password again for sensitive actions), audit log.',
      ],
      shots: ['Ctrl+K palette'],
    },
  },
  {
    hue: 'coral',
    icon: '🛡',
    docs: 'security',
    bn: {
      title: 'নিরাপত্তা ও ভরসা',
      bullets: [
        'প্রতিটা স্কুলের তথ্য আলাদা, সিস্টেমের ভেতরেই দেয়াল (tenant isolation)।',
        '২৩টা লিখিত নিরাপত্তা নিয়ম, প্রতিটার পরীক্ষা কোডে।',
        'এনক্রিপ্টেড ব্যাকআপ (◌ প্রতি ঘণ্টায় দেশের বাইরের কপি)।',
        'সাসপেন্ড/রিসেট করলে সব সেশন তৎক্ষণাৎ বন্ধ।',
        'পাবলিক ফর্মে বট-সুরক্ষা, rate limit, আপলোডের signature check।',
      ],
      shots: ['নিরাপত্তা সেটিংস'],
    },
    en: {
      title: 'Security and trust',
      bullets: [
        'Every school’s data is separate, a wall inside the system itself (tenant isolation).',
        '23 written security rules, each with a test in code.',
        'Encrypted backups (◌ hourly off-site copy).',
        'Suspend/reset and every session closes immediately.',
        'Bot protection on public forms, rate limits, upload signature checks.',
      ],
      shots: ['Security settings'],
    },
  },
];

export const areaCopy = (a: Area, lang: Lang): AreaCopy => a[lang];
export const areaId = (n: number) => `a${n}`;
