/** [59.2.06] "Privacy · Terms" muted links for the sign-in and sign-up footers (D19). */
import { useLocale } from '@biddaloy/ui/i18n';

// ponytail: in-folder fallback until the 59.2.05 `legal` i18n keys land. Plain <a>: the /legal/* routes arrive in wave 3.
const LABELS = {
  bn: { privacy: 'গোপনীয়তা নীতি', terms: 'শর্তাবলি' },
  en: { privacy: 'Privacy policy', terms: 'Terms' },
};

const LINK = 'underline-offset-2 hover:underline';

export function LegalFooterLinks() {
  const { locale } = useLocale();
  const l = LABELS[locale === 'bn' ? 'bn' : 'en'];
  return (
    <nav className="text-text-muted flex items-center justify-center gap-2 text-caption">
      <a href="/legal/privacy" className={LINK}>
        {l.privacy}
      </a>
      <span aria-hidden="true">·</span>
      <a href="/legal/terms" className={LINK}>
        {l.terms}
      </a>
    </nav>
  );
}
