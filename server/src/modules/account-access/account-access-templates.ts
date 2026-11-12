import { DEFAULT_REGION_SETTINGS } from '../schools/settings/tenant-settings-defaults';

export type TemplateKind =
  | 'INVITATION'
  | 'OTP'
  | 'PASSWORD_RESET_LINK'
  | 'EMAIL_VERIFY_LINK'
  | 'CONTACT_CHANGE_APPROVAL_LINK'
  | 'SHARED_CONTACT_CHANGE_NOTICE'
  | 'CONTACT_CHANGE_DECLINED_NOTICE'
  | 'BACKUP_READY'
  | 'BACKUP_FAILED'
  | 'RESTORE_DONE'
  | 'RESTORE_FAILED'
  /** [Epic 98] Platform owner sign-in messages. The code is the only secret in a body. */
  | 'COCKPIT_DEVICE_CODE'
  | 'COCKPIT_ENROL_CODE'
  | 'COCKPIT_SIGNIN_NOTICE'
  | 'COCKPIT_RECOVERY_NOTICE'
  | 'COCKPIT_LOCKOUT_ALERT'
  /** [Epic 98] The other owner asked for a two-person approval. `detail` is a short summary, no secret. */
  | 'PLATFORM_APPROVAL_REQUEST'
  /** [Epic 98] An owner account was locked or unlocked. `detail` names who did it. */
  | 'PLATFORM_OWNER_LOCKED'
  | 'PLATFORM_OWNER_UNLOCKED'
  /** [Epic 99] Both owners are told at every Biddaloy support entry. No secret. */
  | 'SUPPORT_SESSION_OWNER_NOTICE'
  /** [Epic 99] The school allowed the request. `link` opens the cockpit school page; never a code. */
  | 'SUPPORT_TICKET_READY'
  /** [Epic 99] A platform announcement to one school admin. SMS short, email full. */
  | 'PLATFORM_ANNOUNCEMENT';
export type TemplateMedium = 'SMS' | 'EMAIL';
export type TemplateLocale = 'bn' | 'en';

export interface TemplateVars {
  school: string;
  name: string;
  link?: string;
  code?: string;
  size_mb?: string;
  finished_at?: string;
  expires_at?: string;
  reason?: string;
  /** [75.1] School that asked for the change (not the sender when the platform sends it). */
  from_school?: string;
  /** [75.1] Which contact: shown as a localized label. */
  field?: ContactField;
  /** [75.1] Full name of the person whose contact is being changed. */
  person?: string;
  /** [75.1] The proposed value(s), MASKED, shown only to the person who must approve. */
  new_value?: string;
  /** [Epic 98] Free text such as "IP 1.2.3.4, Chrome on Mac, 10:32". Never a secret. */
  detail?: string;
  /** [Epic 98] Recovery codes left. */
  count?: string;
  /** [Epic 99] The customer school the message is about (`school` is the platform sender). */
  target_school?: string;
  /** [Epic 99] Role entered as, already a plain label. */
  role?: string;
  /** [Epic 99] Announcement title and text. */
  title?: string;
  message?: string;
}

export type ContactField = 'email' | 'phone' | 'both';

const FIELD_LABEL: Record<TemplateLocale, Record<ContactField, string>> = {
  en: { email: 'email', phone: 'phone number', both: 'email and phone number' },
  bn: { email: 'ইমেইল', phone: 'ফোন নম্বর', both: 'ইমেইল ও ফোন নম্বর' },
};

interface RenderedMessage {
  body: string;
  subject?: string;
}

export const REDACTED = '••••••';

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? '');
}

// Kept short: SMS bodies stay <=160 chars in English so a single-segment
// SMS carries the whole message.
const TEMPLATES: Record<
  TemplateKind,
  Record<TemplateMedium, Record<TemplateLocale, { body: string; subject?: string }>>
> = {
  INVITATION: {
    SMS: {
      en: {
        body: 'Hi {{name}}, {{school}} invited you to SchoolManager. Set your password: {{link}}',
      },
      bn: {
        body: '{{name}}, {{school}} আপনাকে বিদ্যালয়ে যুক্ত করেছে। পাসওয়ার্ড সেট করুন: {{link}}',
      },
    },
    EMAIL: {
      en: {
        subject: 'You have been invited to {{school}}',
        body: 'Hi {{name}},\n\n{{school}} has invited you to SchoolManager. Set your password using the link below:\n\n{{link}}\n\nThis link expires in 7 days.',
      },
      bn: {
        subject: '{{school}} থেকে আমন্ত্রণ',
        body: '{{name}},\n\n{{school}} আপনাকে বিদ্যালয়ে যুক্ত হওয়ার আমন্ত্রণ জানিয়েছে। নিচের লিংক থেকে পাসওয়ার্ড সেট করুন:\n\n{{link}}\n\nএই লিংকটি ৭ দিনের মধ্যে মেয়াদোত্তীর্ণ হবে।',
      },
    },
  },
  OTP: {
    SMS: {
      en: { body: 'Your {{school}} verification code is {{code}}. It expires in 5 minutes.' },
      bn: { body: 'আপনার {{school}} যাচাইকরণ কোড {{code}}। এটি ৫ মিনিটে মেয়াদোত্তীর্ণ হবে।' },
    },
    EMAIL: {
      en: {
        subject: 'Your verification code',
        body: 'Hi {{name}},\n\nYour verification code for {{school}} is {{code}}. It expires in 5 minutes.',
      },
      bn: {
        subject: 'আপনার যাচাইকরণ কোড',
        body: '{{name}},\n\n{{school}}-এর জন্য আপনার যাচাইকরণ কোড হলো {{code}}। এটি ৫ মিনিটে মেয়াদোত্তীর্ণ হবে।',
      },
    },
  },
  PASSWORD_RESET_LINK: {
    SMS: {
      en: { body: 'Reset your {{school}} password: {{link}} (expires in 1 hour)' },
      bn: { body: '{{school}} পাসওয়ার্ড রিসেট করুন: {{link}} (১ ঘণ্টায় মেয়াদোত্তীর্ণ)' },
    },
    EMAIL: {
      en: {
        subject: 'Reset your password',
        body: 'Hi {{name}},\n\nUse the link below to reset your {{school}} password:\n\n{{link}}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this message.',
      },
      bn: {
        subject: 'পাসওয়ার্ড রিসেট করুন',
        body: '{{name}},\n\n{{school}}-এর পাসওয়ার্ড রিসেট করতে নিচের লিংক ব্যবহার করুন:\n\n{{link}}\n\nএই লিংকটি ১ ঘণ্টায় মেয়াদোত্তীর্ণ হবে। আপনি অনুরোধ না করলে এই বার্তাটি উপেক্ষা করুন।',
      },
    },
  },
  EMAIL_VERIFY_LINK: {
    SMS: {
      en: { body: 'Verify your {{school}} contact: {{link}} (expires in 1 hour)' },
      bn: { body: '{{school}} যোগাযোগ যাচাই করুন: {{link}} (১ ঘণ্টায় মেয়াদোত্তীর্ণ)' },
    },
    EMAIL: {
      en: {
        subject: 'Verify your contact',
        body: 'Hi {{name}},\n\nUse the link below to verify your contact for {{school}}:\n\n{{link}}\n\nThis link expires in 1 hour.',
      },
      bn: {
        subject: 'যোগাযোগ যাচাই করুন',
        body: '{{name}},\n\n{{school}}-এর জন্য আপনার যোগাযোগ যাচাই করতে নিচের লিংক ব্যবহার করুন:\n\n{{link}}\n\nএই লিংকটি ১ ঘণ্টায় মেয়াদোত্তীর্ণ হবে।',
      },
    },
  },
  CONTACT_CHANGE_APPROVAL_LINK: {
    SMS: {
      en: {
        body: '{{from_school}} asked to change the {{field}} on your account to {{new_value}}. If you agree, open: {{link}} (expires in 3 days). If not, ignore this message.',
      },
      bn: {
        body: '{{from_school}} আপনার অ্যাকাউন্টের {{field}} পরিবর্তন করে {{new_value}} করার অনুরোধ করেছে। আপনি রাজি হলে খুলুন: {{link}} (৩ দিনে মেয়াদোত্তীর্ণ)। রাজি না হলে এই বার্তা উপেক্ষা করুন।',
      },
    },
    EMAIL: {
      en: {
        subject: 'Approve a change to your contact details',
        body: 'Hi {{name}},\n\n{{from_school}} asked to change the {{field}} on your account to {{new_value}}.\n\nIf you agree, open the link below and press Approve:\n\n{{link}}\n\nThis link expires in 3 days. If you do not agree, ignore this message and nothing will change.',
      },
      bn: {
        subject: 'আপনার যোগাযোগের তথ্য পরিবর্তন অনুমোদন করুন',
        body: '{{name}},\n\n{{from_school}} আপনার অ্যাকাউন্টের {{field}} পরিবর্তন করে {{new_value}} করার অনুরোধ করেছে।\n\nআপনি রাজি হলে নিচের লিংক খুলে "অনুমোদন করুন" চাপুন:\n\n{{link}}\n\nএই লিংকটি ৩ দিনে মেয়াদোত্তীর্ণ হবে। রাজি না হলে এই বার্তা উপেক্ষা করুন, কিছুই পরিবর্তন হবে না।',
      },
    },
  },
  SHARED_CONTACT_CHANGE_NOTICE: {
    SMS: {
      en: {
        body: '{{from_school}} asked to change the {{field}} of {{person}}, who is also a member of {{school}}. It changes only if {{person}} approves it.',
      },
      bn: {
        body: '{{from_school}} {{person}}-এর {{field}} পরিবর্তনের অনুরোধ করেছে; তিনি {{school}}-এরও সদস্য। {{person}} অনুমোদন করলেই কেবল এটি পরিবর্তন হবে।',
      },
    },
    EMAIL: {
      en: {
        subject: 'A contact change was requested for {{person}}',
        body: 'Hi {{name}},\n\n{{from_school}} asked to change the {{field}} of {{person}}, who is also a member of {{school}}.\n\nIt changes only if {{person}} approves it from their current contact. No action is needed from you.',
      },
      bn: {
        subject: '{{person}}-এর যোগাযোগের তথ্য পরিবর্তনের অনুরোধ',
        body: '{{name}},\n\n{{from_school}} {{person}}-এর {{field}} পরিবর্তনের অনুরোধ করেছে; তিনি {{school}}-এরও সদস্য।\n\n{{person}} তাঁর বর্তমান যোগাযোগ থেকে অনুমোদন করলেই কেবল এটি পরিবর্তন হবে। আপনাকে কিছু করতে হবে না।',
      },
    },
  },
  CONTACT_CHANGE_DECLINED_NOTICE: {
    SMS: {
      en: {
        body: '{{person}} declined the {{field}} change that {{school}} asked for. Nothing was changed.',
      },
      bn: {
        body: '{{school}}-এর অনুরোধ করা {{field}} পরিবর্তন {{person}} প্রত্যাখ্যান করেছেন। কিছুই পরিবর্তন হয়নি।',
      },
    },
    EMAIL: {
      en: {
        subject: '{{person}} declined a contact change',
        body: 'Hi {{name}},\n\n{{person}} declined the {{field}} change that {{school}} asked for. Nothing was changed.',
      },
      bn: {
        subject: '{{person}} যোগাযোগ পরিবর্তন প্রত্যাখ্যান করেছেন',
        body: '{{name}},\n\n{{school}}-এর অনুরোধ করা {{field}} পরিবর্তন {{person}} প্রত্যাখ্যান করেছেন। কিছুই পরিবর্তন হয়নি।',
      },
    },
  },
  BACKUP_READY: {
    SMS: {
      en: {
        body: '{{school}} backup is ready. Sign in to download: {{link}} (expires {{expires_at}})',
      },
      bn: {
        body: '{{school}}-এর ব্যাকআপ তৈরি। সাইন ইন করে ডাউনলোড করুন: {{link}} (মেয়াদ {{expires_at}})',
      },
    },
    EMAIL: {
      en: {
        subject: 'Your {{school}} backup is ready',
        body: 'Hi {{name}},\n\nThe backup you requested for {{school}} finished on {{finished_at}}. It is {{size_mb}} MB.\n\nOpen the link below, sign in, and the download starts automatically:\n\n{{link}}\n\nThe file is available until {{expires_at}}. After that it is deleted and you will need to run a new backup.',
      },
      bn: {
        subject: '{{school}}-এর ব্যাকআপ তৈরি হয়েছে',
        body: '{{name}},\n\n{{school}}-এর জন্য আপনার অনুরোধ করা ব্যাকআপ {{finished_at}}-এ সম্পন্ন হয়েছে। ফাইলের আকার {{size_mb}} MB।\n\nনিচের লিংকে গিয়ে সাইন ইন করুন, ডাউনলোড স্বয়ংক্রিয়ভাবে শুরু হবে:\n\n{{link}}\n\nফাইলটি {{expires_at}} পর্যন্ত পাওয়া যাবে। এরপর এটি মুছে যাবে এবং আপনাকে নতুন ব্যাকআপ নিতে হবে।',
      },
    },
  },
  BACKUP_FAILED: {
    SMS: {
      en: {
        body: '{{school}} backup failed on {{finished_at}}. Reason: {{reason}}. Try again from Settings.',
      },
      bn: {
        body: '{{school}}-এর ব্যাকআপ {{finished_at}}-এ ব্যর্থ হয়েছে। কারণ: {{reason}}। সেটিংস থেকে আবার চেষ্টা করুন।',
      },
    },
    EMAIL: {
      en: {
        subject: 'Your {{school}} backup failed',
        body: 'Hi {{name}},\n\nThe backup for {{school}} did not finish. It stopped on {{finished_at}}.\n\nReason: {{reason}}\n\nNothing in your data was changed. You can start a new backup from Settings:\n\n{{link}}\n\nIf it fails again, contact support with the time above.',
      },
      bn: {
        subject: '{{school}}-এর ব্যাকআপ ব্যর্থ হয়েছে',
        body: '{{name}},\n\n{{school}}-এর ব্যাকআপ সম্পন্ন হয়নি। এটি {{finished_at}}-এ থেমে গেছে।\n\nকারণ: {{reason}}\n\nআপনার কোনো তথ্য পরিবর্তন হয়নি। সেটিংস থেকে নতুন ব্যাকআপ শুরু করতে পারেন:\n\n{{link}}\n\nআবার ব্যর্থ হলে উপরের সময়টি জানিয়ে সহায়তা কেন্দ্রে যোগাযোগ করুন।',
      },
    },
  },
  RESTORE_DONE: {
    SMS: {
      en: { body: '{{school}} restore finished on {{finished_at}}. Review your data: {{link}}' },
      bn: {
        body: '{{school}}-এর রিস্টোর {{finished_at}}-এ সম্পন্ন হয়েছে। তথ্য দেখে নিন: {{link}}',
      },
    },
    EMAIL: {
      en: {
        subject: 'Your {{school}} restore finished',
        body: 'Hi {{name}},\n\nThe restore for {{school}} finished on {{finished_at}}.\n\nOpen Settings to review the restored data:\n\n{{link}}\n\nA safety snapshot was taken before the restore, so this can still be rolled back.',
      },
      bn: {
        subject: '{{school}}-এর রিস্টোর সম্পন্ন হয়েছে',
        body: '{{name}},\n\n{{school}}-এর রিস্টোর {{finished_at}}-এ সম্পন্ন হয়েছে।\n\nপুনরুদ্ধার করা তথ্য দেখতে সেটিংস খুলুন:\n\n{{link}}\n\nরিস্টোরের আগে একটি সুরক্ষা স্ন্যাপশট নেওয়া হয়েছে, তাই এটি এখনও ফিরিয়ে আনা সম্ভব।',
      },
    },
  },
  RESTORE_FAILED: {
    SMS: {
      en: {
        body: '{{school}} restore failed on {{finished_at}}. Reason: {{reason}}. Your data is unchanged.',
      },
      bn: {
        body: '{{school}}-এর রিস্টোর {{finished_at}}-এ ব্যর্থ হয়েছে। কারণ: {{reason}}। আপনার তথ্য অপরিবর্তিত।',
      },
    },
    EMAIL: {
      en: {
        subject: 'Your {{school}} restore failed',
        body: 'Hi {{name}},\n\nThe restore for {{school}} did not finish. It stopped on {{finished_at}}.\n\nReason: {{reason}}\n\nYour existing data was left as it was. You can try again from Settings:\n\n{{link}}',
      },
      bn: {
        subject: '{{school}}-এর রিস্টোর ব্যর্থ হয়েছে',
        body: '{{name}},\n\n{{school}}-এর রিস্টোর সম্পন্ন হয়নি। এটি {{finished_at}}-এ থেমে গেছে।\n\nকারণ: {{reason}}\n\nআপনার বর্তমান তথ্য অপরিবর্তিত রয়েছে। সেটিংস থেকে আবার চেষ্টা করতে পারেন:\n\n{{link}}',
      },
    },
  },
  COCKPIT_DEVICE_CODE: {
    SMS: {
      en: { body: '{{school}}: code {{code}} to sign in on a new device. Expires in 5 minutes.' },
      bn: { body: '{{school}}: নতুন ডিভাইসে সাইন-ইনের কোড {{code}}। ৫ মিনিটে মেয়াদোত্তীর্ণ হবে।' },
    },
    EMAIL: {
      en: {
        subject: 'Code for a new device',
        body: 'Hi {{name}},\n\nYour code to sign in on a new device is {{code}}. It expires in 5 minutes. If this was not you, do not share the code.',
      },
      bn: {
        subject: 'নতুন ডিভাইসের কোড',
        body: '{{name}},\n\nনতুন ডিভাইসে সাইন-ইনের জন্য আপনার কোড {{code}}। এটি ৫ মিনিটে মেয়াদোত্তীর্ণ হবে। এটি আপনি না হলে কোডটি কাউকে দেবেন না।',
      },
    },
  },
  COCKPIT_ENROL_CODE: {
    SMS: {
      en: { body: '{{school}}: code {{code}} to set up your authenticator. Expires in 5 minutes.' },
      bn: { body: '{{school}}: অথেনটিকেটর সেট করার কোড {{code}}। ৫ মিনিটে মেয়াদোত্তীর্ণ হবে।' },
    },
    EMAIL: {
      en: {
        subject: 'Code to set up your authenticator',
        body: 'Hi {{name}},\n\nYour code to set up the authenticator is {{code}}. It expires in 5 minutes. You need this code and the one sent by SMS.',
      },
      bn: {
        subject: 'অথেনটিকেটর সেট করার কোড',
        body: '{{name}},\n\nঅথেনটিকেটর সেট করার জন্য আপনার কোড {{code}}। এটি ৫ মিনিটে মেয়াদোত্তীর্ণ হবে। এই কোড এবং এসএমএসে পাঠানো কোড, দুটোই লাগবে।',
      },
    },
  },
  COCKPIT_SIGNIN_NOTICE: {
    SMS: {
      en: { body: '{{school}}: new sign-in. {{detail}}. Not you? Lock the account now.' },
      bn: { body: '{{school}}: নতুন সাইন-ইন। {{detail}}। আপনি না হলে এখনই অ্যাকাউন্ট লক করুন।' },
    },
    EMAIL: {
      en: {
        subject: 'New sign-in to your owner account',
        body: 'Hi {{name}},\n\nYour owner account was just signed in. {{detail}}\n\nIf this was not you, lock the account now.',
      },
      bn: {
        subject: 'আপনার মালিক অ্যাকাউন্টে নতুন সাইন-ইন',
        body: '{{name}},\n\nআপনার মালিক অ্যাকাউন্টে এইমাত্র সাইন-ইন হয়েছে। {{detail}}\n\nএটি আপনি না হলে এখনই অ্যাকাউন্ট লক করুন।',
      },
    },
  },
  COCKPIT_RECOVERY_NOTICE: {
    SMS: {
      en: { body: '{{school}}: a recovery code was used to sign in. {{count}} left.' },
      bn: { body: '{{school}}: সাইন-ইনে একটি রিকভারি কোড ব্যবহার হয়েছে। আর {{count}}টি বাকি।' },
    },
    EMAIL: {
      en: {
        subject: 'A recovery code was used',
        body: 'Hi {{name}},\n\nA recovery code was used to sign in to your owner account. {{count}} recovery codes are left. If this was not you, lock the account now.',
      },
      bn: {
        subject: 'একটি রিকভারি কোড ব্যবহার হয়েছে',
        body: '{{name}},\n\nআপনার মালিক অ্যাকাউন্টে সাইন-ইনে একটি রিকভারি কোড ব্যবহার হয়েছে। আর {{count}}টি রিকভারি কোড বাকি। এটি আপনি না হলে এখনই অ্যাকাউন্ট লক করুন।',
      },
    },
  },
  PLATFORM_APPROVAL_REQUEST: {
    SMS: {
      en: {
        body: '{{school}}: the other owner asks for your approval: {{detail}}. Open the cockpit.',
      },
      bn: { body: '{{school}}: অন্য মালিক আপনার অনুমোদন চেয়েছেন: {{detail}}। ককপিট খুলুন।' },
    },
    EMAIL: {
      en: {
        subject: 'Approval requested',
        body: 'Hi {{name}},\n\nThe other owner asks for your approval: {{detail}}.\n\nOpen the cockpit to approve or deny. The request expires in 24 hours.',
      },
      bn: {
        subject: 'অনুমোদনের অনুরোধ',
        body: '{{name}},\n\nঅন্য মালিক আপনার অনুমোদন চেয়েছেন: {{detail}}।\n\nককপিট খুলে অনুমোদন বা প্রত্যাখ্যান করুন। অনুরোধটি ২৪ ঘণ্টায় মেয়াদোত্তীর্ণ হবে।',
      },
    },
  },
  PLATFORM_OWNER_LOCKED: {
    SMS: {
      en: { body: '{{school}}: an owner account was locked. {{detail}}' },
      bn: { body: '{{school}}: একটি মালিক অ্যাকাউন্ট লক করা হয়েছে। {{detail}}' },
    },
    EMAIL: {
      en: {
        subject: 'An owner account was locked',
        body: 'Hi {{name}},\n\nAn owner account was locked. {{detail}}\n\nA locked owner is signed out everywhere at once.',
      },
      bn: {
        subject: 'একটি মালিক অ্যাকাউন্ট লক করা হয়েছে',
        body: '{{name}},\n\nএকটি মালিক অ্যাকাউন্ট লক করা হয়েছে। {{detail}}\n\nলক হওয়া মালিক সব জায়গা থেকে একসঙ্গে সাইন-আউট হন।',
      },
    },
  },
  PLATFORM_OWNER_UNLOCKED: {
    SMS: {
      en: { body: '{{school}}: an owner account was unlocked. {{detail}}' },
      bn: { body: '{{school}}: একটি মালিক অ্যাকাউন্ট আনলক করা হয়েছে। {{detail}}' },
    },
    EMAIL: {
      en: {
        subject: 'An owner account was unlocked',
        body: 'Hi {{name}},\n\nAn owner account was unlocked. {{detail}}\n\nThe owner can sign in again.',
      },
      bn: {
        subject: 'একটি মালিক অ্যাকাউন্ট আনলক করা হয়েছে',
        body: '{{name}},\n\nএকটি মালিক অ্যাকাউন্ট আনলক করা হয়েছে। {{detail}}\n\nমালিক আবার সাইন-ইন করতে পারবেন।',
      },
    },
  },
  COCKPIT_LOCKOUT_ALERT: {
    SMS: {
      en: { body: '{{school}}: 5 failed sign-in attempts on an owner account. Check it now.' },
      bn: {
        body: '{{school}}: একটি মালিক অ্যাকাউন্টে ৫ বার ভুল সাইন-ইনের চেষ্টা হয়েছে। এখনই দেখুন।',
      },
    },
    EMAIL: {
      en: {
        subject: 'Failed sign-ins on an owner account',
        body: 'Hi {{name}},\n\nThere were 5 failed sign-in attempts on an owner account. Check it now.',
      },
      bn: {
        subject: 'মালিক অ্যাকাউন্টে ভুল সাইন-ইন',
        body: '{{name}},\n\nএকটি মালিক অ্যাকাউন্টে ৫ বার ভুল সাইন-ইনের চেষ্টা হয়েছে। এখনই দেখুন।',
      },
    },
  },
  SUPPORT_SESSION_OWNER_NOTICE: {
    SMS: {
      en: {
        body: '{{target_school}}: {{person}} entered as {{role}} via Login as. Reason: {{reason}}',
      },
      bn: {
        body: '{{target_school}}: {{person}} স্কুল হিসেবে প্রবেশে {{role}} হয়ে ঢুকেছেন। কারণ: {{reason}}',
      },
    },
    EMAIL: {
      en: {
        subject: 'Login as started for {{target_school}}',
        body: 'Hi {{name}},\n\n{{person}} entered {{target_school}} as {{role}} using Login as.\nReason: {{reason}}\n\nBoth owners get this message every time.',
      },
      bn: {
        subject: '{{target_school}}-এ স্কুল হিসেবে প্রবেশ শুরু হয়েছে',
        body: '{{name}},\n\n{{person}} স্কুল হিসেবে প্রবেশ ব্যবহার করে {{target_school}}-এ {{role}} হয়ে ঢুকেছেন।\nকারণ: {{reason}}\n\nপ্রতিবার দুজন মালিকই এই বার্তা পান।',
      },
    },
  },
  SUPPORT_TICKET_READY: {
    SMS: {
      en: {
        body: '{{target_school}} allowed your request. Open the school page to enter: {{link}}',
      },
      bn: {
        body: '{{target_school}} আপনার অনুরোধে অনুমতি দিয়েছে। প্রবেশ করতে স্কুলের পাতা খুলুন: {{link}}',
      },
    },
    EMAIL: {
      en: {
        subject: '{{target_school}} allowed your request',
        body: 'Hi {{name}},\n\n{{target_school}} allowed your request to enter. Open the school page within 24 hours and use Login as once:\n\n{{link}}',
      },
      bn: {
        subject: '{{target_school}} আপনার অনুরোধে অনুমতি দিয়েছে',
        body: '{{name}},\n\n{{target_school}} প্রবেশের অনুরোধে অনুমতি দিয়েছে। ২৪ ঘণ্টার মধ্যে স্কুলের পাতা খুলে একবার স্কুল হিসেবে প্রবেশ ব্যবহার করুন:\n\n{{link}}',
      },
    },
  },
  PLATFORM_ANNOUNCEMENT: {
    SMS: {
      en: { body: '{{title}}: {{message}}' },
      bn: { body: '{{title}}: {{message}}' },
    },
    EMAIL: {
      en: { subject: '{{title}}', body: 'Hi {{name}},\n\n{{message}}' },
      bn: { subject: '{{title}}', body: '{{name}},\n\n{{message}}' },
    },
  },
};

function resolve(kind: TemplateKind, medium: TemplateMedium, locale: TemplateLocale) {
  return TEMPLATES[kind][medium][locale];
}

export function render(
  kind: TemplateKind,
  medium: TemplateMedium,
  locale: TemplateLocale,
  vars: TemplateVars,
): RenderedMessage {
  const template = resolve(kind, medium, locale);
  const varsRecord: Record<string, string> = {
    school: vars.school,
    name: vars.name,
    link: vars.link ?? '',
    code: vars.code ?? '',
    size_mb: vars.size_mb ?? '',
    finished_at: vars.finished_at ?? '',
    expires_at: vars.expires_at ?? '',
    reason: vars.reason ?? '',
    from_school: vars.from_school ?? '',
    field: vars.field ? FIELD_LABEL[locale][vars.field] : '',
    person: vars.person ?? '',
    new_value: vars.new_value ?? '',
    detail: vars.detail ?? '',
    count: vars.count ?? '',
    target_school: vars.target_school ?? '',
    role: vars.role ?? '',
    title: vars.title ?? '',
    message: vars.message ?? '',
  };
  return {
    body: fill(template.body, varsRecord),
    subject: template.subject ? fill(template.subject, varsRecord) : undefined,
  };
}

/** Same render, with `link`/`code` replaced by a redacted placeholder — what actually gets stored in `communication_logs.message_body` (D4). */
export function redact(
  kind: TemplateKind,
  medium: TemplateMedium,
  locale: TemplateLocale,
  vars: TemplateVars,
): RenderedMessage {
  return render(kind, medium, locale, {
    ...vars,
    link: vars.link ? REDACTED : undefined,
    code: vars.code ? REDACTED : undefined,
  });
}

/** Sender name for messages that belong to no single school (shared users, D28). */
export const PLATFORM_SENDER_NAME = 'SchoolManager';

/**
 * `settings.region.locale` (e.g. `bn-BD`) -> template locale. The one resolver every sender uses.
 * A missing, empty or non-string locale (raw stored settings are untyped) means the platform
 * default region (`DEFAULT_REGION_SETTINGS.locale`, bn-BD), the same answer `resolveTenantSettings`
 * gives. Any other locale not starting with `bn` is English.
 */
export function resolveTemplateLocale(regionLocale: unknown): TemplateLocale {
  const locale =
    typeof regionLocale === 'string' && regionLocale
      ? regionLocale
      : DEFAULT_REGION_SETTINGS.locale;
  return locale.toLowerCase().startsWith('bn') ? 'bn' : 'en';
}
