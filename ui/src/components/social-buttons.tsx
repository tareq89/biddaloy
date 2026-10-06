/**
 * [13.4.3] "Continue with Google / Facebook" buttons for the signed-out
 * pages. Presentational: the provider list comes from
 * `socialProvidersQueryOptions`, the target from `socialStartUrl` (both in
 * `hooks`), and labels from the screen's own copy.
 *
 * Each button is a real link — the server answers with a 302 to the
 * provider, so there is nothing to `fetch`. Icons are inline SVG (no
 * network request) in `currentColor`, so no brand colour enters the app.
 */
import type { SocialProvider } from '../hooks/social';
import { cn } from '../primitives/lib/utils';

import { Button } from './button';

const ICON_PATHS: Record<SocialProvider, string> = {
  google:
    'M12 11v2.8h6.5c-.3 1.7-2 4.9-6.5 4.9a7.2 7.2 0 1 1 0-14.4c2.3 0 3.8.9 4.7 1.8l2.1-2A10 10 0 0 0 12 2a10 10 0 1 0 0 20c5.8 0 9.6-4 9.6-9.8 0-.7-.1-1.2-.2-1.7z',
  facebook:
    'M13.5 22v-8.2h2.8l.4-3.3h-3.2V8.4c0-.9.3-1.6 1.6-1.6h1.7V3.9a22 22 0 0 0-2.4-.1c-2.4 0-4.1 1.5-4.1 4.2v2.5H7.5v3.3h2.8V22z',
};

export interface SocialButtonsProps {
  providers: readonly SocialProvider[];
  labelFor: (provider: SocialProvider) => string;
  hrefFor: (provider: SocialProvider) => string;
  /** Inert (`aria-disabled`, no navigation) while a form is submitting. */
  disabled?: boolean;
  className?: string;
}

export function SocialButtons({
  providers,
  labelFor,
  hrefFor,
  disabled,
  className,
}: SocialButtonsProps) {
  if (providers.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {providers.map((provider) => (
        // 44 px: the signed-out pages are touch-first, so the density
        // variable is overridden rather than followed.
        <Button key={provider} asChild variant="outline" className="h-11 w-full">
          <a
            href={hrefFor(provider)}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : undefined}
            onClick={disabled ? (e) => e.preventDefault() : undefined}
            className={cn(disabled && 'pointer-events-none opacity-50')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-current">
              <path d={ICON_PATHS[provider]} />
            </svg>
            {labelFor(provider)}
          </a>
        </Button>
      ))}
    </div>
  );
}
