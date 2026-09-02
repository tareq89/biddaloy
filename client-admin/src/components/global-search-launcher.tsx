/**
 * [8.9.9]'s "find anything from anywhere". Owns the three things
 * `@biddaloy/ui`'s route-agnostic `GlobalSearch`/`useGlobalSearch`
 * deliberately don't (see `global-search.tsx`'s own header comment):
 * the Ctrl/Cmd+K listener, the debounce, and — the actual navigation —
 * deciding what a `(groupId, resultId)` selection opens in *this* app's
 * route tree.
 *
 * Result targets today:
 * - student -> its own `/students/$studentId` page.
 * - guardian -> its own `/guardians/$guardianId` page ([8.11.4] — before
 *   that page existed, this fell back to the first student the guardian
 *   linked, since a guardian had nowhere else to land on).
 * - invoice -> `/invoices/$invoiceId` ([8.9.9] adds this minimal stub
 *   page; the endpoint it reads already existed).
 * - receipt (payment) -> the paying student's own `/students/$studentId`
 *   page — same "closest existing destination" reasoning as guardian
 *   above; a receipt has no page of its own yet either.
 * - teacher -> nowhere. No `/teachers/:id` page or `GET /teachers/:id`
 *   endpoint exists anywhere in the app yet (see `global-search.ts`'s own
 *   comment on why the group is still shown despite that) — selecting one
 *   just closes the palette rather than linking to a page that can't
 *   exist until that ticket lands.
 */
import { Button, GlobalSearch, type GlobalSearchGroup } from '@biddaloy/ui/components';
import { useDebouncedValue, useGlobalSearch } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useNavigate } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import * as React from 'react';

const SEARCH_DEBOUNCE_MS = 300;

export function GlobalSearchLauncher() {
  const { t } = useTranslation('nav');
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const results = useGlobalSearch(debouncedQuery);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // Global Ctrl/Cmd+K — [8.9.9]'s "opens from anywhere" AC. Not scoped to
  // any particular element, so it fires regardless of what currently has
  // focus; `preventDefault` stops the browser's own bookmark/location-bar
  // binding on that key combo from also firing.
  //
  // [8.14.3]: `_staff.tsx` now mounts this component twice — once in the
  // desktop `topBar` (`hidden md:flex`), once in the mobile header row
  // (`md:hidden`) — so exactly one instance is ever visible at a given
  // width, but *both* stay mounted (a CSS `display:none` ancestor doesn't
  // unmount its children). Without the `offsetParent` guard below, both
  // instances' listeners would fire on every Ctrl/Cmd+K, flipping both
  // `open` states and rendering two stacked `GlobalSearch` dialogs. The
  // guard makes only the currently-visible trigger's instance respond —
  // `offsetParent` is `null` exactly when the element or an ancestor has
  // `display: none` (unlike `visibility: hidden`, which this app doesn't
  // use for layout toggles), so this is a correct, dependency-free way to
  // ask "is my trigger the one actually on screen right now".
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (triggerRef.current?.offsetParent === null) return;
        event.preventDefault();
        setOpen((isOpen) => !isOpen);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Closing (Esc, a selection, or the shortcut re-firing) always starts
  // the next open on a blank query — a stale leftover search from last
  // time would otherwise flash before the user gets a chance to type.
  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const groups: GlobalSearchGroup[] = [
    {
      id: 'students',
      label: t('globalSearch.groups.students'),
      isLoading: results.students.isLoading,
      results: results.students.data.map((student) => ({
        id: student.id,
        label: student.full_name,
        description: student.class_section?.class?.name,
      })),
    },
    {
      id: 'guardians',
      label: t('globalSearch.groups.guardians'),
      isLoading: results.guardians.isLoading,
      results: results.guardians.data.map((guardian) => ({
        id: guardian.id,
        label: guardian.full_name,
        description: guardian.relationship,
      })),
    },
    {
      id: 'teachers',
      label: t('globalSearch.groups.teachers'),
      isLoading: results.teachers.isLoading,
      results: results.teachers.data.map((teacher) => ({
        id: teacher.id,
        label: teacher.user.full_name,
        description: teacher.employee_id,
      })),
    },
    {
      id: 'invoices',
      label: t('globalSearch.groups.invoices'),
      isLoading: results.invoices.isLoading,
      results: results.invoices.data.map((invoice) => ({
        id: invoice.id,
        label: invoice.invoice_number,
        description: invoice.student.full_name,
      })),
    },
    {
      id: 'receipts',
      label: t('globalSearch.groups.receipts'),
      isLoading: results.receipts.isLoading,
      results: results.receipts.data.map((receipt) => ({
        id: receipt.id,
        label:
          receipt.transaction_reference ??
          t('globalSearch.receiptFallbackLabel', { amount: receipt.total_amount }),
        description: receipt.student.full_name,
      })),
    },
  ];

  function handleSelect(groupId: string, resultId: string) {
    if (groupId === 'students') {
      void navigate({ to: '/students/$studentId', params: { studentId: resultId } });
      return;
    }
    if (groupId === 'guardians') {
      void navigate({ to: '/guardians/$guardianId', params: { guardianId: resultId } });
      return;
    }
    if (groupId === 'invoices') {
      void navigate({ to: '/invoices/$invoiceId', params: { invoiceId: resultId } });
      return;
    }
    if (groupId === 'receipts') {
      const receipt = results.receipts.data.find((item) => item.id === resultId);
      if (receipt) {
        void navigate({ to: '/students/$studentId', params: { studentId: receipt.student.id } });
      }
      return;
    }
    // 'teachers' — no destination page exists yet, see this file's own
    // header comment.
  }

  return (
    <>
      {/* [8.14.2]: input-shaped launcher — reads like the search box it
       * opens rather than a plain text button, matching the epic's
       * desktop-header mockup. One trigger, two shapes: below `md` it
       * collapses to an icon-only square (the input shape needs width this
       * viewport does not have) rather than hiding — Ctrl+K is unreachable
       * on a touch device, so hiding it with no replacement would leave a
       * phone user no way at all into global search. [8.14.3] reuses this
       * same collapsed trigger inside the staff mobile header row
       * (`_staff.tsx`'s `mobileHeaderActions`) rather than building a
       * second, separate icon button — one component, two mounting points.
       * Accessible name stays the short `buttonLabel` ("Search (Ctrl+K)")
       * via `aria-label` regardless of width — the longer placeholder text
       * is visual only, so screen reader users get the concise
       * announcement instead of the full search hint. Kept as a single
       * element rather than a hidden/shown pair so that accessible name
       * resolves to exactly one node — `e2e/pages/app-shell.ts` and
       * `global-search-launcher.test.tsx` both look it up by role+name. */}
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={t('globalSearch.buttonLabel')}
        className="inline-flex h-(--control-h) w-(--control-h) items-center justify-center gap-2 rounded-md border-input px-0 font-normal text-muted-foreground md:w-56 md:justify-start md:px-2"
      >
        <SearchIcon className="size-4 shrink-0" aria-hidden="true" />
        {/* `launcherPlaceholder`, not the dialog's own `placeholder`: the
            full "Search students, guardians, teachers, invoices, receipts…"
            hint is written for a full-width dialog input and would truncate
            to a couple of words inside `w-56`. */}
        <span className="hidden flex-1 truncate text-start md:inline">
          {t('globalSearch.launcherPlaceholder')}
        </span>
        <span className="hidden shrink-0 text-xs md:inline">{t('globalSearch.shortcutHint')}</span>
      </Button>
      <GlobalSearch
        open={open}
        onOpenChange={setOpen}
        query={query}
        onQueryChange={setQuery}
        groups={groups}
        onSelect={handleSelect}
        aria-label={t('globalSearch.ariaLabel')}
        title={t('globalSearch.title')}
        placeholder={t('globalSearch.placeholder')}
        description={t('globalSearch.description')}
        searchableHint={t('globalSearch.searchableHint')}
        noResultsText={(searchQuery) => t('globalSearch.noResults', { query: searchQuery })}
        announceResults={(count) =>
          count === 1
            ? t('globalSearch.resultCount', { count })
            : t('globalSearch.resultCountPlural', { count })
        }
      />
    </>
  );
}
