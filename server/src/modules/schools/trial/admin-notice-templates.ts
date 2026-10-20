export type AdminNoticeKey = 'welcome' | 'idle_d20' | 'idle_d27' | 'idle_suspended';
export type NoticeLocale = 'en' | 'bn';

export interface NoticeVars {
  school: string;
  link?: string;
}

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
};

export function renderNotice(
  key: AdminNoticeKey,
  locale: NoticeLocale,
  vars: NoticeVars,
): { subject: string; body: string } {
  const t = TEMPLATES[key][locale];
  return { subject: t.subject(vars), body: t.body(vars) };
}
