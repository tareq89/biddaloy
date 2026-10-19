export type AdminNoticeKey = 'welcome';
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
};

export function renderNotice(
  key: AdminNoticeKey,
  locale: NoticeLocale,
  vars: NoticeVars,
): { subject: string; body: string } {
  const t = TEMPLATES[key][locale];
  return { subject: t.subject(vars), body: t.body(vars) };
}
