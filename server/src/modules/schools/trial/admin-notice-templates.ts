export type AdminNoticeKey = 'trial_warning_d7' | 'trial_warning_d2' | 'trial_ended' | 'welcome';
export type NoticeLocale = 'en' | 'bn';

export interface NoticeVars {
  school: string;
  /** Formatted end date, for the warning templates. */
  date?: string;
  link?: string;
}

interface Template {
  subject: (v: NoticeVars) => string;
  body: (v: NoticeVars) => string;
}

const TEMPLATES: Record<AdminNoticeKey, Record<NoticeLocale, Template>> = {
  trial_warning_d7: {
    en: {
      subject: (v) => `${v.school}: your trial ends in 7 days`,
      body: (v) =>
        `${v.school}'s free trial ends on ${v.date}. Contact us to keep your school's access.`,
    },
    bn: {
      subject: (v) => `${v.school}: আপনার ট্রায়াল ৭ দিনে শেষ হবে`,
      body: (v) =>
        `${v.school}-এর ফ্রি ট্রায়াল ${v.date} তারিখে শেষ হবে। অ্যাক্সেস চালু রাখতে আমাদের সাথে যোগাযোগ করুন।`,
    },
  },
  trial_warning_d2: {
    en: {
      subject: (v) => `${v.school}: your trial ends in 2 days`,
      body: (v) =>
        `${v.school}'s free trial ends on ${v.date}. After that the school is suspended until the trial is extended.`,
    },
    bn: {
      subject: (v) => `${v.school}: আপনার ট্রায়াল ২ দিনে শেষ হবে`,
      body: (v) =>
        `${v.school}-এর ফ্রি ট্রায়াল ${v.date} তারিখে শেষ হবে। এরপর ট্রায়াল বাড়ানো না পর্যন্ত স্কুলটি স্থগিত থাকবে।`,
    },
  },
  trial_ended: {
    en: {
      subject: (v) => `${v.school}: your trial has ended`,
      body: (v) =>
        `${v.school}'s free trial has ended and the school is suspended. Your data is kept; contact us to continue.`,
    },
    bn: {
      subject: (v) => `${v.school}: আপনার ট্রায়াল শেষ হয়েছে`,
      body: (v) =>
        `${v.school}-এর ফ্রি ট্রায়াল শেষ হয়েছে এবং স্কুলটি স্থগিত। আপনার তথ্য সংরক্ষিত আছে; চালিয়ে যেতে আমাদের সাথে যোগাযোগ করুন।`,
    },
  },
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
};

export function renderNotice(
  key: AdminNoticeKey,
  locale: NoticeLocale,
  vars: NoticeVars,
): { subject: string; body: string } {
  const t = TEMPLATES[key][locale];
  return { subject: t.subject(vars), body: t.body(vars) };
}
