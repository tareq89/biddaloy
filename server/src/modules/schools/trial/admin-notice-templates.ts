export type AdminNoticeKey =
  | 'welcome'
  | 'idle_d20'
  | 'idle_d27'
  | 'idle_suspended'
  | 'seats_d30'
  | 'seats_d7'
  | 'seats_expired'
  | 'seats_suspended'
  | 'receipt';
export type NoticeLocale = 'en' | 'bn';

export interface NoticeVars {
  school: string;
  link?: string;
  /** First day without paid seats (YYYY-MM-DD), for the seat notices. */
  date?: string;
  seats?: number;
  /** Receipt number (SMR-YYYY-NNNNNN), for the `receipt` notice. */
  receipt?: string;
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
  seats_d30: {
    en: {
      subject: (v) => `${v.school}: seats run out in 30 days`,
      body: (v) =>
        `The ${v.seats ?? ''} paid seats of ${v.school} run out on ${v.date ?? ''}. Buy seats for the next period in Settings, Seats & billing to keep adding students.`,
    },
    bn: {
      subject: (v) => `${v.school}: ৩০ দিনের মধ্যে সিট শেষ হবে`,
      body: (v) =>
        `${v.school}-এর ${v.seats ?? ''}টি পরিশোধিত সিট ${v.date ?? ''} তারিখে শেষ হবে। শিক্ষার্থী যোগ করা চালু রাখতে সেটিংস, সিট ও বিলিং থেকে পরবর্তী সময়ের জন্য সিট কিনুন।`,
    },
  },
  seats_d7: {
    en: {
      subject: (v) => `${v.school}: seats run out in 7 days`,
      body: (v) =>
        `Only 7 days left. The paid seats of ${v.school} run out on ${v.date ?? ''}, then the school becomes read-only. Buy seats in Settings, Seats & billing.`,
    },
    bn: {
      subject: (v) => `${v.school}: ৭ দিনের মধ্যে সিট শেষ হবে`,
      body: (v) =>
        `আর মাত্র ৭ দিন বাকি। ${v.school}-এর পরিশোধিত সিট ${v.date ?? ''} তারিখে শেষ হবে, তারপর স্কুল শুধু দেখা যাবে। সেটিংস, সিট ও বিলিং থেকে সিট কিনুন।`,
    },
  },
  seats_expired: {
    en: {
      subject: (v) => `${v.school}: seats have expired`,
      body: (v) =>
        `The paid seats of ${v.school} ended on ${v.date ?? ''}. The school is read-only for 7 days, then paused. Your data is safe. Buy seats in Settings, Seats & billing to continue.`,
    },
    bn: {
      subject: (v) => `${v.school}: সিটের মেয়াদ শেষ`,
      body: (v) =>
        `${v.school}-এর পরিশোধিত সিটের মেয়াদ ${v.date ?? ''} তারিখে শেষ হয়েছে। ৭ দিন স্কুল শুধু দেখা যাবে, তারপর সাময়িক বন্ধ হবে। আপনার তথ্য নিরাপদ আছে। চালু রাখতে সেটিংস, সিট ও বিলিং থেকে সিট কিনুন।`,
    },
  },
  receipt: {
    en: {
      subject: (v) => `${v.school}: payment receipt ${v.receipt ?? ''}`,
      body: (v) =>
        `Thank you. We received the payment for the seats of ${v.school}. Receipt ${v.receipt ?? ''}: download it in Settings, Seats & billing. ${v.link ?? ''}`.trim(),
    },
    bn: {
      subject: (v) => `${v.school}: পেমেন্ট রসিদ ${v.receipt ?? ''}`,
      body: (v) =>
        `ধন্যবাদ। ${v.school}-এর সিটের পেমেন্ট পেয়েছি। রসিদ ${v.receipt ?? ''}: সেটিংস, সিট ও বিলিং থেকে ডাউনলোড করুন। ${v.link ?? ''}`.trim(),
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
};

export function renderNotice(
  key: AdminNoticeKey,
  locale: NoticeLocale,
  vars: NoticeVars,
): { subject: string; body: string } {
  const t = TEMPLATES[key][locale];
  return { subject: t.subject(vars), body: t.body(vars) };
}
