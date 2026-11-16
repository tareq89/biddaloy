/** [59.2.06] "Privacy · Terms" muted links for the sign-in and sign-up footers (D19). */
import { useTranslation } from '@biddaloy/ui/i18n';

// Plain <a>: the typed /legal/* routes are not in routeTree.gen.ts on this branch (lane #3953 adds them); swap to <Link> then.
const LINK = 'underline-offset-2 hover:underline';

export function LegalFooterLinks() {
  const { t } = useTranslation('legal');
  return (
    <nav className="text-text-muted flex items-center justify-center gap-2 text-caption">
      <a href="/legal/privacy" className={LINK}>
        {t('footerLinks.privacy')}
      </a>
      <span aria-hidden="true">·</span>
      <a href="/legal/terms" className={LINK}>
        {t('footerLinks.terms')}
      </a>
    </nav>
  );
}
