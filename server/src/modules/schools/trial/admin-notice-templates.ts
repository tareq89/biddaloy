export type AdminNoticeKey =
  | 'welcome'
  | 'idle_d20'
  | 'idle_d27'
  | 'idle_suspended'
  | 'seats_d30'
  | 'seats_d7'
  | 'seats_expired'
  | 'seats_suspended'
  | 'receipt'
  /** [100.2.gB.04] Unused SMS package credit ends in 7 / 1 days. */
  | 'sms_expiring_d7'
  | 'sms_expiring_d1'
  /** [Epic 99] Biddaloy support access. Plain words only: see the glossary (D14). */
  | 'support_session_started'
  | 'support_emergency'
  | 'support_request'
  | 'support_mode_changed';
export type NoticeLocale = 'en' | 'bn';

export interface NoticeVars {
  school: string;
  link?: string;
  /** First day without paid seats (YYYY-MM-DD), for the seat notices. */
  date?: string;
  seats?: number;
  /** Receipt number (SMR-YYYY-NNNNNN), for the `receipt` notice. */
  receipt?: string;
  /** Unused SMS that end on `date`, for the `sms_expiring_*` notices. */
  units?: number;
  /** The seats that end are the free period (the school never paid for later seats). */
  free?: boolean;
  /** The school has more ACTIVE students than seats once they end: it goes read-only, then paused. */
  over?: boolean;
  /** [Epic 99] Biddaloy staff member who entered the school. */
  person?: string;
  /** [Epic 99] Role they entered as, already a plain label. */
  role?: string;
  /** [Epic 99] The new support-access setting. */
  mode?: SupportSetting;
  /** [Epic 99] Free-text reason given for the entry. */
  reason?: string;
  /** [Epic 99] When it happened, already formatted for the reader. */
  time?: string;
}

export type SupportSetting = 'allowed' | 'ask' | 'off';
const SETTING_LABEL: Record<NoticeLocale, Record<SupportSetting, string>> = {
  en: { allowed: 'allowed', ask: 'ask every time', off: 'off' },
  bn: { allowed: 'অনুমতি আছে', ask: 'প্রতিবার জিজ্ঞেস করুন', off: 'বন্ধ' },
};

interface Template {
  subject: (v: NoticeVars) => string;
  body: (v: NoticeVars) => string;
}

const TEMPLATES: Record<AdminNoticeKey, Record<NoticeLocale, Template>> = {
  welcome: {
    en: {
      subject: (v) => `Welcome to Biddaloy, ${v.school}`,
      body: (v) => `Welcome! ${v.school} is ready. Sign in here: ${v.link ?? ''}`.trim(),
    },
    bn: {
      subject: (v) => `বিদ্যালয়-এ স্বাগতম, ${v.school}`,
      body: (v) => `স্বাগতম! ${v.school} প্রস্তুত। এখানে সাইন ইন করুন: ${v.link ?? ''}`.trim(),
    },
  },
  idle_d20: {
    en: {
      subject: (v) => `${v.school}: add your first student`,
      body: (v) =>
        `${v.school} has no students yet. Add your first student to keep the school open. A school with no student after 30 days is paused. Need help? Contact us.`,
    },
    bn: {
      subject: (v) => `${v.school}: প্রথম শিক্ষার্থী যোগ করুন`,
      body: (v) =>
        `${v.school}-এ এখনো কোনো শিক্ষার্থী নেই। স্কুল চালু রাখতে প্রথম শিক্ষার্থী যোগ করুন। ৩০ দিনেও কোনো শিক্ষার্থী না থাকলে স্কুল সাময়িক বন্ধ হয়ে যায়। সাহায্য লাগলে আমাদের সঙ্গে যোগাযোগ করুন।`,
    },
  },
  idle_d27: {
    en: {
      subject: (v) => `${v.school}: 3 days left to add a student`,
      body: (v) =>
        `${v.school} still has no students. Add your first student within 3 days, or the school will be paused. Need more time? Contact us.`,
    },
    bn: {
      subject: (v) => `${v.school}: শিক্ষার্থী যোগ করতে আর ৩ দিন বাকি`,
      body: (v) =>
        `${v.school}-এ এখনো কোনো শিক্ষার্থী নেই। ৩ দিনের মধ্যে প্রথম শিক্ষার্থী যোগ করুন, না হলে স্কুল সাময়িক বন্ধ হয়ে যাবে। আরও সময় লাগলে আমাদের সঙ্গে যোগাযোগ করুন।`,
    },
  },
  idle_suspended: {
    en: {
      subject: (v) => `${v.school} is paused`,
      body: (v) =>
        `${v.school} was paused because no student was added. Your data is safe. Contact us to reopen it.`,
    },
    bn: {
      subject: (v) => `${v.school} সাময়িক বন্ধ করা হয়েছে`,
      body: (v) =>
        `কোনো শিক্ষার্থী যোগ না হওয়ায় ${v.school} সাময়িক বন্ধ করা হয়েছে। আপনার তথ্য নিরাপদ আছে। আবার চালু করতে আমাদের সঙ্গে যোগাযোগ করুন।`,
    },
  },
  seats_d30: {
    en: {
      subject: (v) => `${v.school}: seats run out in 30 days`,
      body: (v) =>
        v.free
          ? `Free use of ${v.school} ends on ${v.date ?? ''}. Buy seats in Settings, Seats & billing to keep adding students.`
          : `The ${v.seats ?? ''} paid seats of ${v.school} run out on ${v.date ?? ''}. Buy seats for the next period in Settings, Seats & billing to keep adding students.`,
    },
    bn: {
      subject: (v) => `${v.school}: ৩০ দিনের মধ্যে সিট শেষ হবে`,
      body: (v) =>
        v.free
          ? `${v.school}-এর বিনা খরচে ব্যবহার ${v.date ?? ''} তারিখে শেষ হবে। শিক্ষার্থী যোগ করা চালু রাখতে সেটিংস, সিট ও বিলিং থেকে সিট কিনুন।`
          : `${v.school}-এর ${v.seats ?? ''}টি পরিশোধিত সিট ${v.date ?? ''} তারিখে শেষ হবে। শিক্ষার্থী যোগ করা চালু রাখতে সেটিংস, সিট ও বিলিং থেকে পরবর্তী সময়ের জন্য সিট কিনুন।`,
    },
  },
  seats_d7: {
    en: {
      subject: (v) => `${v.school}: seats run out in 7 days`,
      body: (v) =>
        `Only 7 days left. ${v.free ? `Free use of ${v.school} ends` : `The paid seats of ${v.school} run out`} on ${v.date ?? ''}${v.over ? ', then the school becomes read-only' : ''}. Buy seats in Settings, Seats & billing.`,
    },
    bn: {
      subject: (v) => `${v.school}: ৭ দিনের মধ্যে সিট শেষ হবে`,
      body: (v) =>
        `আর মাত্র ৭ দিন বাকি। ${v.free ? `${v.school}-এর বিনা খরচে ব্যবহার` : `${v.school}-এর পরিশোধিত সিট`} ${v.date ?? ''} তারিখে শেষ হবে${v.over ? ', তারপর স্কুল শুধু দেখা যাবে' : ''}। সেটিংস, সিট ও বিলিং থেকে সিট কিনুন।`,
    },
  },
  seats_expired: {
    en: {
      subject: (v) => `${v.school}: seats have expired`,
      body: (v) =>
        `${v.free ? `Free use of ${v.school}` : `The paid seats of ${v.school}`} ended on ${v.date ?? ''}. ${v.over ? 'The school is read-only for 7 days, then paused. Your data is safe.' : 'You cannot add students until you buy seats.'} Buy seats in Settings, Seats & billing to continue.`,
    },
    bn: {
      subject: (v) => `${v.school}: সিটের মেয়াদ শেষ`,
      body: (v) =>
        `${v.free ? `${v.school}-এর বিনা খরচে ব্যবহারের` : `${v.school}-এর পরিশোধিত সিটের`} মেয়াদ ${v.date ?? ''} তারিখে শেষ হয়েছে। ${v.over ? '৭ দিন স্কুল শুধু দেখা যাবে, তারপর সাময়িক বন্ধ হবে। আপনার তথ্য নিরাপদ আছে।' : 'সিট না কেনা পর্যন্ত নতুন শিক্ষার্থী যোগ করা যাবে না।'} চালু রাখতে সেটিংস, সিট ও বিলিং থেকে সিট কিনুন।`,
    },
  },
  receipt: {
    en: {
      subject: (v) => `${v.school}: payment receipt ${v.receipt ?? ''}`,
      body: (v) =>
        `Thank you. We received the payment for ${v.school}. Receipt ${v.receipt ?? ''}: you can download it from the page where you paid. ${v.link ?? ''}`.trim(),
    },
    bn: {
      subject: (v) => `${v.school}: পেমেন্ট রসিদ ${v.receipt ?? ''}`,
      body: (v) =>
        `ধন্যবাদ। ${v.school}-এর পেমেন্ট পেয়েছি। রসিদ ${v.receipt ?? ''}: যে পেজে পেমেন্ট করেছেন সেখান থেকে ডাউনলোড করুন। ${v.link ?? ''}`.trim(),
    },
  },
  sms_expiring_d7: {
    en: {
      subject: (v) => `${v.school}: unused SMS end in 7 days`,
      body: (v) =>
        `${v.units ?? ''} unused SMS of ${v.school} end on ${v.date ?? ''}. Use them before then, or buy a new SMS package. ${v.link ?? ''}`.trim(),
    },
    bn: {
      subject: (v) => `${v.school}: অব্যবহৃত এসএমএস ৭ দিন পর শেষ হবে`,
      body: (v) =>
        `${v.school}-এর ${v.units ?? ''}টি অব্যবহৃত এসএমএস ${v.date ?? ''} তারিখে শেষ হবে। তার আগে ব্যবহার করুন, অথবা নতুন এসএমএস প্যাকেজ কিনুন। ${v.link ?? ''}`.trim(),
    },
  },
  sms_expiring_d1: {
    en: {
      subject: (v) => `${v.school}: unused SMS end in 1 day`,
      body: (v) =>
        `${v.units ?? ''} unused SMS of ${v.school} end on ${v.date ?? ''}. Use them before then, or buy a new SMS package. ${v.link ?? ''}`.trim(),
    },
    bn: {
      subject: (v) => `${v.school}: অব্যবহৃত এসএমএস ১ দিন পর শেষ হবে`,
      body: (v) =>
        `${v.school}-এর ${v.units ?? ''}টি অব্যবহৃত এসএমএস ${v.date ?? ''} তারিখে শেষ হবে। তার আগে ব্যবহার করুন, অথবা নতুন এসএমএস প্যাকেজ কিনুন। ${v.link ?? ''}`.trim(),
    },
  },
  seats_suspended: {
    en: {
      subject: (v) => `${v.school}: school paused, seats ended`,
      body: (v) =>
        `${v.school} is paused because its paid seats ended. Your data is safe. Buy seats in Settings, Seats & billing and the school reopens immediately.`,
    },
    bn: {
      subject: (v) => `${v.school}: সিট শেষ, স্কুল সাময়িক বন্ধ`,
      body: (v) =>
        `সিটের মেয়াদ শেষ হওয়ায় ${v.school} সাময়িক বন্ধ আছে। আপনার তথ্য নিরাপদ আছে। সেটিংস, সিট ও বিলিং থেকে সিট কিনলে স্কুল সঙ্গে সঙ্গে আবার চালু হবে।`,
    },
  },
  support_session_started: {
    en: {
      subject: (v) => `${v.school}: Biddaloy support entered your school`,
      body: (v) =>
        `${v.person ?? ''} from Biddaloy support entered ${v.school} as ${v.role ?? ''} at ${v.time ?? ''}. Reason: ${v.reason ?? ''}. You can see this in Settings, Biddaloy support access.`,
    },
    bn: {
      subject: (v) => `${v.school}: Biddaloy সহায়তা স্কুলে প্রবেশ করেছে`,
      body: (v) =>
        `Biddaloy সহায়তার ${v.person ?? ''} ${v.time ?? ''} সময়ে ${v.school}-এ ${v.role ?? ''} হিসেবে প্রবেশ করেছেন। কারণ: ${v.reason ?? ''}। সেটিংস, Biddaloy সহায়তা প্রবেশ-এ এটি দেখতে পাবেন।`,
    },
  },
  support_emergency: {
    en: {
      subject: (v) => `${v.school}: emergency access by Biddaloy support`,
      body: (v) =>
        `Biddaloy support used emergency access to ${v.school}. ${v.person ?? ''} entered as ${v.role ?? ''} at ${v.time ?? ''}. Reason: ${v.reason ?? ''}. The entry is view only. Check it in Settings, Biddaloy support access.`,
    },
    bn: {
      subject: (v) => `${v.school}: Biddaloy সহায়তার জরুরি প্রবেশ`,
      body: (v) =>
        `Biddaloy সহায়তা ${v.school}-এ জরুরি প্রবেশ করেছে। ${v.person ?? ''} ${v.time ?? ''} সময়ে ${v.role ?? ''} হিসেবে প্রবেশ করেছেন। কারণ: ${v.reason ?? ''}। এই প্রবেশে শুধু দেখা যায়। সেটিংস, Biddaloy সহায়তা প্রবেশ-এ দেখুন।`,
    },
  },
  support_request: {
    en: {
      subject: (v) => `${v.school}: Biddaloy support asks to enter`,
      body: (v) =>
        `${v.person ?? ''} from Biddaloy support asks to enter ${v.school} as ${v.role ?? ''}. Reason: ${v.reason ?? ''}. Allow or refuse within 24 hours: ${v.link ?? ''}`.trim(),
    },
    bn: {
      subject: (v) => `${v.school}: Biddaloy সহায়তা প্রবেশের অনুমতি চেয়েছে`,
      body: (v) =>
        `Biddaloy সহায়তার ${v.person ?? ''} ${v.school}-এ ${v.role ?? ''} হিসেবে প্রবেশের অনুমতি চেয়েছেন। কারণ: ${v.reason ?? ''}। ২৪ ঘণ্টার মধ্যে অনুমতি দিন বা না করুন: ${v.link ?? ''}`.trim(),
    },
  },
  support_mode_changed: {
    en: {
      subject: (v) => `${v.school}: Biddaloy support access changed`,
      body: (v) =>
        `${v.person ?? ''} changed Biddaloy support access for ${v.school} to "${v.mode ? SETTING_LABEL.en[v.mode] : ''}" at ${v.time ?? ''}. If this was not expected, check Settings, Biddaloy support access.`,
    },
    bn: {
      subject: (v) => `${v.school}: Biddaloy সহায়তা প্রবেশ বদলানো হয়েছে`,
      body: (v) =>
        `${v.person ?? ''} ${v.time ?? ''} সময়ে ${v.school}-এর Biddaloy সহায়তা প্রবেশ "${v.mode ? SETTING_LABEL.bn[v.mode] : ''}" করেছেন। এটি আপনার জানা না থাকলে সেটিংস, Biddaloy সহায়তা প্রবেশ দেখুন।`,
    },
  },
};

export function renderNotice(
  key: AdminNoticeKey,
  locale: NoticeLocale,
  vars: NoticeVars,
): { subject: string; body: string } {
  const t = TEMPLATES[key][locale];
  return { subject: t.subject(vars), body: t.body(vars) };
}
