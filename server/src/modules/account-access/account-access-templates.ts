export type TemplateKind = 'INVITATION' | 'OTP' | 'PASSWORD_RESET_LINK' | 'EMAIL_VERIFY_LINK';
export type TemplateMedium = 'SMS' | 'EMAIL';
export type TemplateLocale = 'bn' | 'en';

export interface TemplateVars {
  school: string;
  name: string;
  link?: string;
  code?: string;
}

interface RenderedMessage {
  body: string;
  subject?: string;
}

const REDACTED = '••••••';

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
      en: { body: 'Hi {{name}}, {{school}} invited you to Biddaloy. Set your password: {{link}}' },
      bn: {
        body: '{{name}}, {{school}} আপনাকে বিদ্যালয়ে যুক্ত করেছে। পাসওয়ার্ড সেট করুন: {{link}}',
      },
    },
    EMAIL: {
      en: {
        subject: 'You have been invited to {{school}}',
        body: 'Hi {{name}},\n\n{{school}} has invited you to Biddaloy. Set your password using the link below:\n\n{{link}}\n\nThis link expires in 7 days.',
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

/** `settings.region.locale` (e.g. `bn-BD`) -> template locale. Anything not starting with `bn` falls back to English. */
export function resolveTemplateLocale(regionLocale: string | undefined | null): TemplateLocale {
  return regionLocale?.toLowerCase().startsWith('bn') ? 'bn' : 'en';
}
