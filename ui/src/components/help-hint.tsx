/**
 * [44.1.01] The (?) that opens a small help card linked to the user guide.
 * `ui/` never imports from `client-admin/`: the generated help index is
 * injected through `HelpProvider` (E14). Renders nothing without an index
 * entry or a base URL (E4), so a missing guide never shows a dead icon.
 */
import { CircleHelpIcon } from 'lucide-react';
import * as React from 'react';

import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

type Bilingual = { bn: string; en: string };
type VideoRef = { id: string; durationSec: number };

export type HelpEntry = {
  title: Bilingual;
  summary: Bilingual;
  path: string;
  anchor: string;
  knownIssues: number;
  /** A field entry's summary is `<ns>:help.<key>` at runtime (E14). */
  field?: { ns: string; key: string };
  video?: { bn: VideoRef; en: VideoRef };
};

export type HelpIndex = Record<string, HelpEntry>;

type HelpLang = 'bn' | 'en';

interface HelpContextValue {
  index: HelpIndex;
  lang: HelpLang;
  baseUrl: string;
  pageId: string | null;
}

// No provider (existing stories/tests): nothing resolves, so nothing renders.
const HelpContext = React.createContext<HelpContextValue>({
  index: {},
  lang: 'bn',
  baseUrl: '',
  pageId: null,
});

export function HelpProvider({
  index,
  lang,
  baseUrl,
  pageId = null,
  children,
}: {
  index: HelpIndex;
  lang: HelpLang;
  baseUrl: string;
  pageId?: string | null | undefined;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ index, lang, baseUrl, pageId }),
    [index, lang, baseUrl, pageId],
  );
  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export interface ResolvedHelp {
  title: string;
  summary: string;
  /** Namespace to load for a field entry's `help.<key>` text. */
  fieldNs?: string;
  href: string;
  knownIssuesHref?: string;
  video?: { href: string; durationSec: number };
}

/** Just the page id, for callers (PageHeader) that need no resolver. */
export function usePageHelpId() {
  return React.useContext(HelpContext).pageId;
}

export function useHelp() {
  const { index, lang, baseUrl, pageId } = React.useContext(HelpContext);
  const { t } = useTranslation();

  const resolve = React.useCallback(
    (id: string | null | undefined): ResolvedHelp | null => {
      const entry = id ? index[id] : undefined;
      if (!entry || baseUrl === '') return null;
      const pageUrl = `${baseUrl}/${lang}/${entry.path}`;
      const video = entry.video?.[lang];
      return {
        title: entry.title[lang],
        summary: entry.field ? t(`${entry.field.ns}:help.${entry.field.key}`) : entry.summary[lang],
        ...(entry.field && { fieldNs: entry.field.ns }),
        href: `${pageUrl}#${entry.anchor}`,
        ...(entry.knownIssues > 0 && { knownIssuesHref: `${pageUrl}#known-issues` }),
        ...(video && {
          video: {
            href: `https://www.youtube.com/watch?v=${video.id}`,
            durationSec: video.durationSec,
          },
        }),
      };
    },
    [index, lang, baseUrl, t],
  );

  return { resolve, pageHref: resolve(pageId)?.href ?? null, pageId, lang };
}

function formatDuration(totalSec: number) {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 200;

export interface HelpHintProps {
  helpId: string | null | undefined;
  /** `md` beside titles, `sm` beside fields and actions. */
  size?: 'sm' | 'md';
  /** Extra classes on the (?) button (e.g. hide it with the button it follows). */
  className?: string | undefined;
}

export function HelpHint({ helpId, size = 'sm', className }: HelpHintProps) {
  const { resolve } = useHelp();
  const help = resolve(helpId);
  if (!help) return null;
  // Split + Suspense so the `helpHint` namespace only loads when a (?) renders,
  // and a slow load never blanks the page around it.
  return (
    <React.Suspense fallback={null}>
      <HelpButton help={help} helpId={helpId} size={size} className={className} />
    </React.Suspense>
  );
}

/** How the card was opened: decides whether a mouse leaving closes it and
 * whether focus returns to the (?) afterwards. */
type OpenSource = 'mouse' | 'click' | 'key';

function HelpButton({
  help,
  helpId,
  size,
  className,
}: {
  help: ResolvedHelp;
  helpId: string | null | undefined;
  size: 'sm' | 'md';
  className: string | undefined;
}) {
  const { t } = useTranslation('helpHint');
  // Separate call (not `useTranslation(['helpHint', fieldNs])`): check-i18n-keys.mjs
  // reads this file's namespace from the first single-quoted `useTranslation('...')`
  // and an array or ternary argument does not match. This one only loads the field's
  // namespace so the summary resolved in `useHelp` renders.
  useTranslation(help.fieldNs ?? 'helpHint');
  const titleId = React.useId();
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const source = React.useRef<OpenSource | null>(null);
  const content = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => () => clearTimeout(timer.current), []);

  // Mouse hover only (a tap is one click-open). A click or key open is
  // "pinned": leaving the card with the mouse does not close it.
  const enter = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(timer.current);
    if (open) return;
    timer.current = setTimeout(() => {
      source.current = 'mouse';
      setOpen(true);
    }, OPEN_DELAY_MS);
  };
  const leave = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(timer.current);
    if (!open || source.current !== 'mouse') return;
    timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    // Radix only reports dismissals here (Esc, outside click); toggling is ours.
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-help-id={helpId}
          aria-label={t('ariaLabel', { title: help.title })}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full text-text-secondary outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
            size === 'md' ? 'size-11 md:size-8' : 'size-11 md:size-6',
            className,
          )}
          onPointerEnter={enter}
          onPointerLeave={leave}
          onClick={(e) => {
            e.preventDefault();
            clearTimeout(timer.current);
            if (open && source.current === 'mouse') {
              source.current = 'click'; // hover-then-click pins the card open
              return;
            }
            if (!open) source.current = e.detail === 0 ? 'key' : 'click';
            setOpen(!open);
          }}
        >
          <CircleHelpIcon className={size === 'md' ? 'size-5' : 'size-4'} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        align="start"
        aria-labelledby={titleId}
        className="w-[min(22rem,calc(100vw-2rem))]"
        // A keyboard open moves focus to the guide link so Tab/Enter work in the
        // card (it is portaled, so focus would otherwise leave it). A hover or
        // click open leaves focus where it is.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (source.current === 'key') {
            content.current?.querySelector<HTMLElement>('[data-help-guide]')?.focus();
          }
        }}
        // A hover-open must not pull focus out of whatever the user is typing in.
        onCloseAutoFocus={(e) => {
          if (source.current === 'mouse') e.preventDefault();
          source.current = null;
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') clearTimeout(timer.current);
        }}
        onPointerLeave={leave}
      >
        <p className="text-caption text-text-secondary">{t('caption')}</p>
        <p id={titleId} className="text-h3">
          {help.title}
        </p>
        <p className="text-text-secondary">{help.summary}</p>
        {help.knownIssuesHref && (
          <p className="text-text-secondary">
            <a
              href={help.knownIssuesHref}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {t('knownIssues')}
            </a>
          </p>
        )}
        <Button asChild variant="default" className="w-full md:w-auto md:self-start">
          <a data-help-guide href={help.href} target="_blank" rel="noopener noreferrer">
            {t('openGuide')}
          </a>
        </Button>
        {help.video && (
          <Button asChild variant="outline" className="w-full md:w-auto md:self-start">
            <a href={help.video.href} target="_blank" rel="noopener noreferrer">
              {t('watchVideo', { duration: formatDuration(help.video.durationSec) })}
            </a>
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
