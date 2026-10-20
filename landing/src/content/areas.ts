import type { Hue, L } from './hero';

/**
 * The 15 capability groups (D32), shared by the home "কী কী পারে" grid and the features page.
 * A bullet starting with "◌" is "coming soon". `slug` is the planned GitBook chapter (link to root until it exists).
 */
export interface Op { name: L; blurb: L; slug: string }
export interface Area { hue: Hue; icon: string; title: L; bullets: L[]; ops: Op[]; shots: L[] }

export const areasCopy = {
  title: { bn: 'SchoolManager কী কী পারে, দেখে নিন', en: 'See what SchoolManager can do' },
  lead: { bn: 'প্রতিটা কাজ ডকুমেন্টেশনের সেই পাতায় নিয়ে যায়।', en: 'Every item links to its documentation page.' },
  docs: { bn: 'ডকস →', en: 'Docs →' },
};

export const areas: Area[] = [
  { hue: 'indigo', icon: '◎', title: { bn: 'অ্যাটেনশন ইঞ্জিন, সিস্টেমের মাথা', en: 'Attention engine, the system’s brain' },
    bullets: [
      { bn: '৪৯টা নিয়ম প্রতিদিন স্কুলটা দেখে: হাজিরা না নেওয়া, নম্বর বাকি, রুটিন প্রকাশ না হওয়া, সেকশনে ক্লাস টিচার না থাকা, রিমাইন্ডার পড়ে থাকা, সেটআপ অসম্পূর্ণ, পরের বছর তৈরি না হওয়া। মানুষকে মনে রাখতে হয় না।', en: '49 rules watch the school every day: attendance not taken, marks pending, routine unpublished, section without a class teacher, reminders left waiting, setup incomplete, next year not prepared. Nobody has to remember.' },
      { bn: 'ধাপে ধাপে দায়িত্ব: প্রথমে যার কাজ তাকে, দেরি হলে উপরে (পরীক্ষা নিয়ন্ত্রক, অ্যাডমিন, প্রিন্সিপাল)।', en: 'Escalation in steps: first to the owner, then upward if late (exam controller, admin, principal).' },
      { bn: 'সকালের ডাইজেস্ট: অ্যাডমিন, প্রিন্সিপাল আর শিক্ষকের ফোনে কাজের দিনে পুশ, "আজ এই ৩টা কাজ আপনার", quiet hours মেনে।', en: 'Morning digest: a push on work days to admin, principal and teachers, "these 3 tasks are yours today", respecting quiet hours.' },
      { bn: 'অভিভাবক fallback: পুশ না পৌঁছালে SMS।', en: 'Guardian fallback: SMS when the push does not arrive.' },
      { bn: 'হাতে অ্যালার্ট + রিপোর্ট: অ্যাডমিন নিজেও অ্যালার্ট পাঠাতে পারেন; কোন অ্যালার্ট কতবার, কে সাড়া দিল, তার রিপোর্ট।', en: 'Manual alerts + report: the admin can send alerts too; a report of which alert fired how often and who responded.' },
    ],
    ops: [
      { name: { bn: 'অ্যালার্ট কেন্দ্র', en: 'Alert centre' }, blurb: { bn: '৪৯ নিয়মের আজকের তালিকা', en: 'Today’s list from 49 rules' }, slug: 'attention' },
      { name: { bn: 'সকালের ডাইজেস্ট', en: 'Morning digest' }, blurb: { bn: 'কাজের দিনে ফোনে পুশ', en: 'A push on work days' }, slug: 'attention/digest' },
      { name: { bn: 'ধাপে ধাপে দায়িত্ব', en: 'Escalation' }, blurb: { bn: 'দেরি হলে উপরে', en: 'Upward when late' }, slug: 'attention/escalation' },
      { name: { bn: 'হাতে অ্যালার্ট', en: 'Manual alerts' }, blurb: { bn: 'অ্যাডমিন নিজে পাঠান', en: 'Sent by the admin' }, slug: 'attention/manual' },
      { name: { bn: 'অ্যালার্ট রিপোর্ট', en: 'Alert report' }, blurb: { bn: 'কে সাড়া দিল', en: 'Who responded' }, slug: 'attention/report' },
    ],
    shots: [{ bn: 'অ্যাটেনশন কেন্দ্র', en: 'Attention centre' }, { bn: 'সকালের ডাইজেস্ট পুশ', en: 'Morning digest push' }] },

  { hue: 'teal', icon: '✓', title: { bn: 'হাজিরা', en: 'Attendance' },
    bullets: [
      { bn: 'দিন ও পিরিয়ড, দুই রকম রেজিস্টার; মাসের ম্যাট্রিক্স এক পাতায় সংশোধন।', en: 'Day and period registers; the month matrix corrected on one page.' },
      { bn: 'শিক্ষকের বাকি তালিকা: কোন সেকশনের হাজিরা আজ হয়নি, এক নজরে।', en: 'Teacher pending list: which section’s attendance is missing today, at a glance.' },
      { bn: 'অনুপস্থিতির SMS রেজিস্টার ফাইনাল হলেই; ভুল সংশোধন করলে সংশোধনের SMS-ও যায়।', en: 'Absence SMS once the register is final; a correction sends a correction SMS too.' },
      { bn: 'স্ক্যানার / ডিভাইস: কার্ড পাঞ্চ সরাসরি হাজিরা, প্রতিটা ডিভাইসের নিজস্ব key, স্কুলের নিজস্ব নীতি (কখন late)।', en: 'Scanner / device: a card punch is attendance, each device has its own key, the school sets its own policy (when is late).' },
      { bn: 'স্ট্রিক: টানা ৩ দিন অনুপস্থিত, ৩ দিন late, ১৫ দিন উপস্থিত, ক্লাস টিচারের পাতায় লাল/সবুজ।', en: 'Streaks: 3 days absent, 3 days late, 15 days present, red/green on the class teacher’s page.' },
      { bn: 'স্টাফ হাজিরা ও ছুটি: ছুটির ব্যালান্স লাইভ হিসাব, আবেদন ও অনুমোদন।', en: 'Staff attendance and leave: live leave balance, application and approval.' },
      { bn: '◌ "সন্তান স্কুলে পৌঁছেছে" পুশ।', en: '◌ "Your child has reached school" push.' },
    ],
    ops: [
      { name: { bn: 'দিন/পিরিয়ড রেজিস্টার', en: 'Day/period register' }, blurb: { bn: 'মাসের ম্যাট্রিক্স সহ', en: 'With month matrix' }, slug: 'attendance' },
      { name: { bn: 'অনুপস্থিতির SMS', en: 'Absence SMS' }, blurb: { bn: 'ফাইনাল হলেই', en: 'Once final' }, slug: 'attendance/sms' },
      { name: { bn: 'স্ক্যানার ও ডিভাইস', en: 'Scanner and devices' }, blurb: { bn: 'কার্ড পাঞ্চ', en: 'Card punch' }, slug: 'attendance/devices' },
      { name: { bn: 'স্ট্রিক', en: 'Streaks' }, blurb: { bn: 'টানা অনুপস্থিত/late', en: 'Consecutive absent/late' }, slug: 'attendance/streaks' },
      { name: { bn: 'স্টাফ হাজিরা ও ছুটি', en: 'Staff attendance and leave' }, blurb: { bn: 'ব্যালান্স লাইভ', en: 'Live balance' }, slug: 'staff-attendance' },
    ],
    shots: [{ bn: 'হাজিরা রেজিস্টার', en: 'Attendance register' }, { bn: 'ক্লাস টিচারের পাতা (স্ট্রিক)', en: 'Class teacher page (streaks)' }] },

  { hue: 'amber', icon: '▦', title: { bn: 'রুটিন', en: 'Routine' },
    bullets: [
      { bn: 'পিরিয়ড, কক্ষ, শিক্ষক ধরে গ্রিড; auto-fill প্রস্তাব দেয়, আপনি ঠিক করেন।', en: 'Grid by period, room and teacher; auto-fill proposes, you decide.' },
      { bn: 'বদলি (substitution): শিক্ষক না এলে কে নেবে, সিস্টেম প্রস্তাব করে।', en: 'Substitution: when a teacher is away, the system proposes who covers.' },
      { bn: 'বদলের অনুরোধ: শিক্ষক চাইলে অনুরোধ, অ্যাডমিন অনুমোদন, রুটিনে নিজে থেকে বসে।', en: 'Change requests: a teacher asks, the admin approves, the routine updates itself.' },
      { bn: 'এক বছরের রুটিন পরের বছরে কপি।', en: 'Copy one year’s routine into the next.' },
    ],
    ops: [
      { name: { bn: 'রুটিন গ্রিড ও auto-fill', en: 'Routine grid and auto-fill' }, blurb: { bn: 'প্রস্তাব, আপনি ঠিক করেন', en: 'Proposes, you decide' }, slug: 'routine' },
      { name: { bn: 'বদলি শিক্ষক', en: 'Substitute teacher' }, blurb: { bn: 'কে নেবে, প্রস্তাব', en: 'Who covers, proposed' }, slug: 'routine/substitution' },
      { name: { bn: 'বদলের অনুরোধ', en: 'Change requests' }, blurb: { bn: 'অনুমোদনে রুটিনে বসে', en: 'Applied on approval' }, slug: 'routine/change-requests' },
      { name: { bn: 'রুটিন কপি', en: 'Routine copy' }, blurb: { bn: 'পরের বছরে', en: 'Into next year' }, slug: 'routine/copy' },
    ],
    shots: [{ bn: 'রুটিন গ্রিড', en: 'Routine grid' }] },

  { hue: 'coral', icon: '✎', title: { bn: 'পরীক্ষা ও ফলাফল', en: 'Exams and results' },
    bullets: [
      { bn: 'পরীক্ষার টেমপ্লেট ও অংশ (লিখিত/ব্যবহারিক/MCQ), সময়সূচি, প্রকাশ।', en: 'Exam templates and parts (written/practical/MCQ), schedule, publishing.' },
      { bn: 'আসন বিন্যাস: প্রতি বিষয়-সিটিং ধরে allocation engine, সম্পাদনা, প্রকাশ।', en: 'Seat plan: allocation engine per subject sitting, edit, publish.' },
      { bn: 'নম্বর গ্রিড: ডেডলাইন সহ, কে দিল কে দেয়নি দেখা যায়।', en: 'Marks grid with deadlines; see who has submitted and who has not.' },
      { bn: 'গ্রেডিং স্কেল বদলালে ফলাফল নিজে থেকে recompute।', en: 'Change the grading scale and results recompute by themselves.' },
      { bn: 'ট্রান্সক্রিপ্ট, ফলাফলের SMS।', en: 'Transcripts, result SMS.' },
      { bn: 'নম্বর বিশ্লেষণ: সেকশন ধরে পাস/ফেল, অংশ ভাঙা, কোন শ্রেণিতে নজর দরকার।', en: 'Marks analysis: pass/fail by section, broken down by part, which class needs attention.' },
      { bn: 'প্রমোশন পরের বছরে।', en: 'Promotion into the next year.' },
    ],
    ops: [
      { name: { bn: 'পরীক্ষা ও সময়সূচি', en: 'Exams and schedule' }, blurb: { bn: 'টেমপ্লেট, অংশ, প্রকাশ', en: 'Templates, parts, publish' }, slug: 'exams' },
      { name: { bn: 'আসন বিন্যাস', en: 'Seat plan' }, blurb: { bn: 'বিষয়-সিটিং ধরে', en: 'Per subject sitting' }, slug: 'exams/seat-plan' },
      { name: { bn: 'নম্বর গ্রিড', en: 'Marks grid' }, blurb: { bn: 'ডেডলাইন সহ', en: 'With deadlines' }, slug: 'exams/marks' },
      { name: { bn: 'গ্রেডিং স্কেল', en: 'Grading scale' }, blurb: { bn: 'বদলালে recompute', en: 'Recomputes on change' }, slug: 'exams/grading' },
      { name: { bn: 'ফলাফল ও ট্রান্সক্রিপ্ট', en: 'Results and transcripts' }, blurb: { bn: 'SMS সহ', en: 'With SMS' }, slug: 'exams/results' },
      { name: { bn: 'নম্বর বিশ্লেষণ', en: 'Marks analysis' }, blurb: { bn: 'কোথায় নজর দরকার', en: 'Where attention is needed' }, slug: 'exams/analysis' },
      { name: { bn: 'প্রমোশন', en: 'Promotion' }, blurb: { bn: 'পরের বছরে', en: 'Into next year' }, slug: 'exams/promotion' },
    ],
    shots: [{ bn: 'নম্বর গ্রিড', en: 'Marks grid' }, { bn: 'আসন বিন্যাস', en: 'Seat plan' }] },

  { hue: 'indigo', icon: '৳', title: { bn: 'ফি, জরিমানা, ইনভয়েস', en: 'Fees, fines, invoices' },
    bullets: [
      { bn: 'এক ক্লিকে পুরো স্কুলের ইনভয়েস (batch), বকেয়া তালিকা, ছাড়ের নিয়ম, checkout cart।', en: 'Invoices for the whole school in one click (batch), dues list, discount rules, checkout cart.' },
      { bn: 'জরিমানার নিয়ম: অনুপস্থিত/late থেকে নিজে থেকেই জরিমানা, নিয়মিত sweep।', en: 'Fine rules: fines from absence/late automatically, with a regular sweep.' },
      { bn: 'ইনভয়েস শেয়ার লিংক: অভিভাবক লগ ইন ছাড়াই দেখেন, লিংক মেয়াদ শেষে বন্ধ।', en: 'Invoice share link: guardians view without logging in; the link expires.' },
      { bn: 'রিমাইন্ডার, বকেয়া রিপোর্ট।', en: 'Reminders, dues reports.' },
      { bn: '◌ সিট/সাবস্ক্রিপশন কেনা ড্যাশবোর্ড থেকে।', en: '◌ Buy seats/subscription from the dashboard.' },
    ],
    ops: [
      { name: { bn: 'ব্যাচ ইনভয়েস', en: 'Batch invoices' }, blurb: { bn: 'এক ক্লিকে পুরো স্কুল', en: 'Whole school in one click' }, slug: 'fees' },
      { name: { bn: 'বকেয়া ও রিমাইন্ডার', en: 'Dues and reminders' }, blurb: { bn: 'তালিকা, SMS', en: 'List, SMS' }, slug: 'fees/dues' },
      { name: { bn: 'জরিমানার নিয়ম', en: 'Fine rules' }, blurb: { bn: 'অনুপস্থিত/late থেকে', en: 'From absence/late' }, slug: 'fees/fines' },
      { name: { bn: 'ছাড় ও আদায়', en: 'Discounts and collection' }, blurb: { bn: 'checkout cart', en: 'Checkout cart' }, slug: 'fees/collection' },
      { name: { bn: 'ইনভয়েস শেয়ার লিংক', en: 'Invoice share link' }, blurb: { bn: 'লগ ইন ছাড়াই', en: 'No login needed' }, slug: 'fees/share-link' },
    ],
    shots: [{ bn: 'বকেয়া তালিকা', en: 'Dues list' }, { bn: 'ইনভয়েস', en: 'Invoice' }] },

  { hue: 'teal', icon: '✉', title: { bn: 'অভিভাবক-যোগাযোগ', en: 'Guardian communication' },
    bullets: [
      { bn: 'পুশ আগে, SMS পরে: খরচ কমে, বার্তা পৌঁছায়।', en: 'Push first, SMS second: lower cost, the message arrives.' },
      { bn: 'SMS গেটওয়ে (greenweb / mimsms), টেমপ্লেট, SMS ক্রেডিটের হিসাব প্রতিটা স্কুলে।', en: 'SMS gateway (greenweb / mimsms), templates, SMS credit accounting per school.' },
      { bn: 'অনুপস্থিতি, বকেয়া, ফলাফল: সব বার্তা বাংলায়।', en: 'Absence, dues, results: every message in Bangla.' },
    ],
    ops: [
      { name: { bn: 'পুশ ও SMS', en: 'Push and SMS' }, blurb: { bn: 'পুশ আগে, SMS পরে', en: 'Push first, SMS second' }, slug: 'communications' },
      { name: { bn: 'SMS গেটওয়ে ও ক্রেডিট', en: 'SMS gateway and credits' }, blurb: { bn: 'greenweb / mimsms', en: 'greenweb / mimsms' }, slug: 'communications/sms' },
      { name: { bn: 'বার্তার টেমপ্লেট', en: 'Message templates' }, blurb: { bn: 'বাংলায়', en: 'In Bangla' }, slug: 'communications/templates' },
    ],
    shots: [{ bn: 'যোগাযোগ লগ', en: 'Communication log' }] },

  { hue: 'amber', icon: '⎙', title: { bn: 'প্রিন্ট', en: 'Print' },
    bullets: [
      { bn: 'টেমপ্লেট এডিটর, ভার্সন সহ; প্রিন্টার প্রোফাইল; প্রিন্ট জবের ইতিহাস।', en: 'Template editor with versions; printer profiles; print job history.' },
      { bn: 'ID কার্ড, সনদ সিরিয়াল নম্বর সহ, প্রবেশপত্র, আসন তালিকা, ট্যাবুলেশন শিট।', en: 'ID cards, certificates with serial numbers, admit cards, seat lists, tabulation sheets.' },
      { bn: 'QR দিয়ে যাচাই: সনদ আসল কি না, পাবলিক পাতায়।', en: 'Verify by QR: is the certificate genuine, on a public page.' },
    ],
    ops: [
      { name: { bn: 'টেমপ্লেট এডিটর', en: 'Template editor' }, blurb: { bn: 'ভার্সন সহ', en: 'With versions' }, slug: 'print' },
      { name: { bn: 'ID কার্ড ও সনদ', en: 'ID cards and certificates' }, blurb: { bn: 'সিরিয়াল নম্বর', en: 'Serial numbers' }, slug: 'print/documents' },
      { name: { bn: 'প্রবেশপত্র ও আসন তালিকা', en: 'Admit cards and seat lists' }, blurb: { bn: 'পরীক্ষার কাগজ', en: 'Exam papers' }, slug: 'print/exam-documents' },
      { name: { bn: 'QR যাচাই', en: 'QR verification' }, blurb: { bn: 'সনদ আসল কি না', en: 'Is it genuine' }, slug: 'print/verify' },
    ],
    shots: [{ bn: 'টেমপ্লেট এডিটর', en: 'Template editor' }, { bn: 'সনদ ও QR', en: 'Certificate and QR' }] },

  { hue: 'coral', icon: '◔', title: { bn: 'স্টাডি প্ল্যান ও হোমওয়ার্ক', en: 'Study plans and homework' },
    bullets: [
      { bn: 'লেসন প্ল্যান সেকশন-বিষয় ধরে, কী পড়ানো হলো mark করা, টেমপ্লেট ও CSV।', en: 'Lesson plans per section and subject, mark what was taught, templates and CSV.' },
      { bn: 'এসকেলেশন: সন্ধ্যা ৬টায় না দিলে পরদিন সকাল ৮টায় শিক্ষককে পুশ, ২ দিন পরে প্রিন্সিপাল/অ্যাডমিনকে; সপ্তাহে অভিভাবক ও কমিটিকে ডাইজেস্ট।', en: 'Escalation: not marked by 6 pm, a push to the teacher at 8 am next day, to principal/admin after 2 days; a weekly digest to guardians and committee.' },
      { bn: 'হোমওয়ার্ক: জমা, analytics।', en: 'Homework: submissions, analytics.' },
    ],
    ops: [
      { name: { bn: 'লেসন প্ল্যান', en: 'Lesson plans' }, blurb: { bn: 'কী পড়ানো হলো', en: 'What was taught' }, slug: 'study-plans' },
      { name: { bn: 'এসকেলেশন', en: 'Escalation' }, blurb: { bn: '৬টা → পরদিন ৮টা → ২ দিন', en: '6 pm → 8 am → 2 days' }, slug: 'study-plans/escalation' },
      { name: { bn: 'হোমওয়ার্ক', en: 'Homework' }, blurb: { bn: 'জমা ও analytics', en: 'Submissions and analytics' }, slug: 'homework' },
    ],
    shots: [{ bn: 'স্টাডি প্ল্যান', en: 'Study plan' }] },

  { hue: 'indigo', icon: '▣', title: { bn: 'একাডেমিক ক্যালেন্ডার', en: 'Academic calendar' },
    bullets: [
      { bn: 'টার্ম, ইভেন্ট, ছুটি; import/export; ICS feed ফোনের ক্যালেন্ডারে; প্ল্যাটফর্মের holiday set।', en: 'Terms, events, holidays; import/export; ICS feed into the phone calendar; platform holiday set.' },
    ],
    ops: [
      { name: { bn: 'টার্ম ও ইভেন্ট', en: 'Terms and events' }, blurb: { bn: 'ছুটি সহ', en: 'With holidays' }, slug: 'calendar' },
      { name: { bn: 'ICS feed', en: 'ICS feed' }, blurb: { bn: 'ফোনের ক্যালেন্ডারে', en: 'Into the phone calendar' }, slug: 'calendar/ics' },
      { name: { bn: 'Holiday set', en: 'Holiday set' }, blurb: { bn: 'প্ল্যাটফর্ম থেকে', en: 'From the platform' }, slug: 'calendar/holidays' },
    ],
    shots: [{ bn: 'ক্যালেন্ডার', en: 'Calendar' }] },

  { hue: 'teal', icon: '☰', title: { bn: 'ভর্তি ও আবেদন', en: 'Admission and applications' },
    bullets: [
      { bn: 'পাবলিক ভর্তি ফর্ম স্কুলের নিজের লিংকে, বট-সুরক্ষা (Turnstile) সহ; আবেদন রিভিউ, ড্যাশবোর্ড, রিপোর্ট, নোটিফিকেশন।', en: 'Public admission form on the school’s own link, bot protection (Turnstile); review, dashboard, reports, notifications.' },
      { bn: 'আবেদন: ছুটি, ফি মওকুফ, সনদ, চিঠি; ধাপে ধাপে অনুমোদন (ক্লাস টিচারের ধাপ সহ), সংযুক্তি, রিপোর্ট।', en: 'Applications: leave, fee waiver, certificate, letter; step-by-step approval (including the class teacher), attachments, reports.' },
    ],
    ops: [
      { name: { bn: 'পাবলিক ভর্তি ফর্ম', en: 'Public admission form' }, blurb: { bn: 'স্কুলের নিজের লিংকে', en: 'On the school’s own link' }, slug: 'admission' },
      { name: { bn: 'আবেদন রিভিউ', en: 'Application review' }, blurb: { bn: 'ড্যাশবোর্ড ও রিপোর্ট', en: 'Dashboard and reports' }, slug: 'admission/review' },
      { name: { bn: 'ছুটি/মওকুফ/সনদ আবেদন', en: 'Leave/waiver/certificate applications' }, blurb: { bn: 'ধাপে ধাপে অনুমোদন', en: 'Step-by-step approval' }, slug: 'applications' },
    ],
    shots: [{ bn: 'ভর্তি ফর্ম', en: 'Admission form' }, { bn: 'আবেদন অনুমোদন', en: 'Application approval' }] },

  { hue: 'amber', icon: '☺', title: { bn: 'ছাত্র ও স্টাফ রেকর্ড', en: 'Student and staff records' },
    bullets: [
      { bn: 'ছাত্রের জীবনচক্র: ভর্তি, TC/leaving, graduate, পুনঃভর্তি, নোট, ছবি।', en: 'Student lifecycle: admission, TC/leaving, graduation, re-admission, notes, photos.' },
      { bn: 'ক্লাস টিচারের "আমার ক্লাস": এক পাতায় পুরো সেকশন।', en: 'The class teacher’s "My class": the whole section on one page.' },
      { bn: 'স্টাফ HR প্রোফাইল।', en: 'Staff HR profiles.' },
      { bn: 'এসিআর: criteria, assessment, incident; শিক্ষক-মূল্যায়ন survey, ফল seal করা; performance tab।', en: 'ACR: criteria, assessment, incidents; teacher evaluation survey with sealed results; performance tab.' },
      { bn: 'প্রোগ্রাম ও মাইলস্টোন।', en: 'Programs and milestones.' },
    ],
    ops: [
      { name: { bn: 'ছাত্রের জীবনচক্র', en: 'Student lifecycle' }, blurb: { bn: 'ভর্তি থেকে graduate', en: 'Admission to graduation' }, slug: 'students' },
      { name: { bn: 'আমার ক্লাস', en: 'My class' }, blurb: { bn: 'ক্লাস টিচারের পাতা', en: 'Class teacher’s page' }, slug: 'my-class' },
      { name: { bn: 'স্টাফ HR', en: 'Staff HR' }, blurb: { bn: 'প্রোফাইল', en: 'Profiles' }, slug: 'staff' },
      { name: { bn: 'এসিআর ও মূল্যায়ন', en: 'ACR and evaluation' }, blurb: { bn: 'survey, performance', en: 'Survey, performance' }, slug: 'acr' },
      { name: { bn: 'প্রোগ্রাম ও মাইলস্টোন', en: 'Programs and milestones' }, blurb: { bn: 'লক্ষ্য ধরে', en: 'By goal' }, slug: 'programs' },
    ],
    shots: [{ bn: 'ছাত্রের প্রোফাইল', en: 'Student profile' }, { bn: 'আমার ক্লাস', en: 'My class' }] },

  { hue: 'coral', icon: '⌂', title: { bn: 'প্রতিষ্ঠানের কাঠামো', en: 'Organisation structure' },
    bullets: [
      { bn: 'মাল্টি-ব্রাঞ্চ: প্রতিটা শাখা আলাদা, একই লগ ইন।', en: 'Multi-branch: each branch separate, one login.' },
      { bn: 'শিফট/ভার্সন/গ্রুপ, স্কুলের নিজের শব্দে।', en: 'Shift/version/group, in the school’s own words.' },
      { bn: 'প্রিসেট: NCTB, আলিয়া, কওমি, Cambridge, Blank, শ্রেণি-বিষয়-গ্রেডিং কয়েক মিনিটে।', en: 'Presets: NCTB, Alia, Qawmi, Cambridge, Blank; classes, subjects and grading in minutes.' },
      { bn: 'Bulk import Excel থেকে।', en: 'Bulk import from Excel.' },
      { bn: 'পুরো স্কুল export/import (workbook): নিজের তথ্য নিজের হাতে, lock-in নেই।', en: 'Whole-school export/import (workbook): your data in your hands, no lock-in.' },
    ],
    ops: [
      { name: { bn: 'মাল্টি-ব্রাঞ্চ', en: 'Multi-branch' }, blurb: { bn: 'একই লগ ইন', en: 'One login' }, slug: 'organisation' },
      { name: { bn: 'প্রিসেট', en: 'Presets' }, blurb: { bn: 'NCTB/আলিয়া/কওমি/Cambridge', en: 'NCTB/Alia/Qawmi/Cambridge' }, slug: 'presets' },
      { name: { bn: 'Bulk import', en: 'Bulk import' }, blurb: { bn: 'Excel থেকে', en: 'From Excel' }, slug: 'import' },
      { name: { bn: 'ব্যাকআপ export/import', en: 'Backup export/import' }, blurb: { bn: 'পুরো স্কুল workbook', en: 'Whole-school workbook' }, slug: 'backup' },
    ],
    shots: [{ bn: 'প্রিসেট প্রয়োগ', en: 'Applying a preset' }] },

  { hue: 'indigo', icon: '▤', title: { bn: 'প্রতিটা ভূমিকার নিজের ড্যাশবোর্ড', en: 'A dashboard for every role' },
    bullets: [
      { bn: 'অ্যাডমিন (১১ উইজেট), প্রিন্সিপাল (৮), শিক্ষক (৭), হিসাবরক্ষক (৮), অফিস স্টাফ (৭), পরীক্ষা নিয়ন্ত্রক, কমিটি।', en: 'Admin (11 widgets), principal (8), teacher (7), accountant (8), office staff (7), exam controller, committee.' },
      { bn: 'অভিভাবক/ছাত্র পোর্টাল: ফি, ফলাফল, রুটিন, হোমওয়ার্ক, হাজিরা, পরীক্ষার সময়সূচি, সিলেবাস, ক্যালেন্ডার, survey, প্রোগ্রাম।', en: 'Guardian/student portal: fees, results, routine, homework, attendance, exam schedule, syllabus, calendar, surveys, programs.' },
      { bn: '১০টা built-in ভূমিকা, শিক্ষক শুধু নিজের সেকশন দেখেন, অভিভাবক শুধু নিজের পরিবার।', en: '10 built-in roles; a teacher sees only their sections, a guardian only their family.' },
    ],
    ops: [
      { name: { bn: 'স্টাফ ড্যাশবোর্ড', en: 'Staff dashboards' }, blurb: { bn: 'ভূমিকা ধরে উইজেট', en: 'Widgets per role' }, slug: 'dashboards' },
      { name: { bn: 'অভিভাবক/ছাত্র পোর্টাল', en: 'Guardian/student portal' }, blurb: { bn: 'ফোনে সব', en: 'Everything on the phone' }, slug: 'portal' },
      { name: { bn: 'ভূমিকা ও অনুমতি', en: 'Roles and permissions' }, blurb: { bn: '১০টা built-in', en: '10 built-in' }, slug: 'roles' },
    ],
    shots: [{ bn: 'অ্যাডমিন ড্যাশবোর্ড', en: 'Admin dashboard' }, { bn: 'অভিভাবক পোর্টাল', en: 'Guardian portal' }] },

  { hue: 'teal', icon: '☼', title: { bn: 'ব্যবহারের অভিজ্ঞতা', en: 'Everyday experience' },
    bullets: [
      { bn: 'বাংলা ও English, বাংলা অঙ্ক সহ; দিন ও রাতের theme।', en: 'Bangla and English, with Bangla numerals; day and night themes.' },
      { bn: 'ফোনে ইনস্টল, অফলাইনে খোলে (PWA)।', en: 'Installs on the phone, opens offline (PWA).' },
      { bn: 'Ctrl+K: যেকোনো কাজ কিবোর্ডে।', en: 'Ctrl+K: any task from the keyboard.' },
      { bn: 'Step-up approval (সংবেদনশীল কাজে আবার OTP/পাসওয়ার্ড), audit log।', en: 'Step-up approval (OTP/password again for sensitive actions), audit log.' },
    ],
    ops: [
      { name: { bn: 'বাংলা/English, দিন/রাত', en: 'Bangla/English, day/night' }, blurb: { bn: 'বাংলা অঙ্ক সহ', en: 'With Bangla numerals' }, slug: 'settings/language' },
      { name: { bn: 'ফোনে ইনস্টল (PWA)', en: 'Install on the phone (PWA)' }, blurb: { bn: 'অফলাইনেও', en: 'Offline too' }, slug: 'pwa' },
      { name: { bn: 'Ctrl+K প্যালেট', en: 'Ctrl+K palette' }, blurb: { bn: 'কিবোর্ডে সব', en: 'Everything by keyboard' }, slug: 'palette' },
      { name: { bn: 'Step-up ও audit log', en: 'Step-up and audit log' }, blurb: { bn: 'সংবেদনশীল কাজে', en: 'For sensitive actions' }, slug: 'security/step-up' },
    ],
    shots: [{ bn: 'Ctrl+K প্যালেট', en: 'Ctrl+K palette' }] },

  { hue: 'coral', icon: '🛡', title: { bn: 'নিরাপত্তা ও ভরসা', en: 'Security and trust' },
    bullets: [
      { bn: 'প্রতিটা স্কুলের তথ্য আলাদা, সিস্টেমের ভেতরেই দেয়াল (tenant isolation)।', en: 'Each school’s data is separate, a wall inside the system (tenant isolation).' },
      { bn: '২৩টা লিখিত নিরাপত্তা নিয়ম, প্রতিটার পরীক্ষা কোডে।', en: '23 written security rules, each with a test in code.' },
      { bn: 'এনক্রিপ্টেড ব্যাকআপ (◌ প্রতি ঘণ্টায় দেশের বাইরের কপি)।', en: 'Encrypted backups (◌ hourly off-site copy).' },
      { bn: 'সাসপেন্ড/রিসেট করলে সব সেশন তৎক্ষণাৎ বন্ধ।', en: 'Suspend or reset ends every session immediately.' },
      { bn: 'পাবলিক ফর্মে বট-সুরক্ষা, rate limit, আপলোডের signature check।', en: 'Bot protection on public forms, rate limits, upload signature checks.' },
    ],
    ops: [
      { name: { bn: 'Tenant isolation', en: 'Tenant isolation' }, blurb: { bn: 'স্কুল আলাদা', en: 'Schools kept apart' }, slug: 'security' },
      { name: { bn: '২৩ নিরাপত্তা নিয়ম', en: '23 security rules' }, blurb: { bn: 'প্রতিটার পরীক্ষা', en: 'Each one tested' }, slug: 'security/rules' },
      { name: { bn: 'এনক্রিপ্টেড ব্যাকআপ', en: 'Encrypted backups' }, blurb: { bn: 'age, রিস্টোর ড্রিল', en: 'age, restore drills' }, slug: 'security/backup' },
      { name: { bn: 'সেশন নিয়ন্ত্রণ', en: 'Session control' }, blurb: { bn: 'তৎক্ষণাৎ বন্ধ', en: 'Ended immediately' }, slug: 'security/sessions' },
    ],
    shots: [{ bn: 'নিরাপত্তা সেটিংস', en: 'Security settings' }] },
];
