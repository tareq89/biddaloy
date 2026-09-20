/**
 * [30.5.1] Wires `CommandPalette` (30.4.1) into this app: owns the
 * `Ctrl/Cmd+K` listener, the `?` shortcuts-help listener, and the three
 * tabs' actual data — `usePaletteSearch` (30.2.1's `GET /search`) for
 * People, `STAFF_NAV_GROUPS` for Page, `ACTIONS` for Action — plus what
 * a selection in each tab navigates to. Replaces `GlobalSearchLauncher`
 * / the old single-list `GlobalSearch` (both retired by this ticket).
 *
 * Result targets — same "closest existing destination" reasoning the
 * old launcher used:
 * - student -> its own `/students/$studentId` page.
 * - guardian -> its own `/guardians/$guardianId` page.
 * - invoice -> its own `/invoices/$invoiceId` page.
 * - staff -> nowhere yet. No `/staff/:id` detail page exists (`/staff`
 *   is a list-only route in `nav-tree.ts`) — selecting one just closes
 *   the palette, same as "teacher" did in the old launcher.
 * - payment (receipt) -> also nowhere. The old launcher opened the
 *   paying student's own page here, but `GET /search`'s
 *   `SearchPaymentResult` (`search.dto.ts`) carries `student_name` for
 *   display only, not the student's `id` — there is no FK in the
 *   response to navigate with. A server-side gap, not something this
 *   ticket's territory (`server/`) can fix; selecting a payment result
 *   closes the palette without navigating, like staff.
 *
 * Action tab: an `ACTIONS` entry is offered only when the signed-in
 * role holds its `permission` *and*, if it declares a `context`, the
 * current route supplies at least one of those context types (a
 * `studentId`/`guardianId`/`invoiceId` route param) — see
 * `action-registry.ts`'s own header comment for why the permission
 * check alone is not enough to gate a shortcut the sidebar wouldn't
 * already show.
 */
import {
  Button,
  CommandPalette,
  type CommandPaletteTab,
  type GlobalSearchGroup,
  ShortcutsSheet,
} from '@biddaloy/ui/components';
import {
  hasPermission,
  useActiveRole,
  useDebouncedValue,
  useEntityLabel,
  usePaletteSearch,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useNavigate, useParams } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import * as React from 'react';

import { ACTIONS, type ActionContext } from '../action-registry';
import {
  matchesNavSearch,
  STAFF_NAV_GROUPS,
  type StaffNavItemDef,
  type StaffNavLabel,
} from '../nav-tree';

const SEARCH_DEBOUNCE_MS = 300;

export function CommandPaletteLauncher() {
  const { t, i18n } = useTranslation('nav');
  const navigate = useNavigate();
  const activeRole = useActiveRole();
  const [open, setOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const peopleResults = usePaletteSearch(debouncedQuery);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // [30.1.3]'s `nav-tree.ts` uses `useEntityLabel` for the same fixed,
  // known-at-build-time set of entity nouns `_staff.tsx` resolves its
  // own sidebar labels with — one hook call per entity at the
  // component's top level (rules-of-hooks forbids calling this inside
  // the `resolveNavLabel` loop below).
  const entityLabels: Record<string, string> = {
    student: useEntityLabel('student', { count: 2 }),
    guardian: useEntityLabel('guardian', { count: 2 }),
    staff: useEntityLabel('staff', { count: 2 }),
    class: useEntityLabel('class', { count: 2 }),
    academicYear: useEntityLabel('academicYear', { count: 2 }),
    invoice: useEntityLabel('invoice', { count: 2 }),
  };

  function resolveNavLabel(label: StaffNavLabel, namespace: 'items' | 'groups'): string {
    return 'entity' in label
      ? (entityLabels[label.entity] ?? label.entity)
      : t(`${namespace}.${label.key}`);
  }

  const params = useParams({ strict: false });
  const availableContexts = React.useMemo<Set<ActionContext>>(() => {
    const contexts = new Set<ActionContext>();
    if (params.studentId) contexts.add('student');
    if (params.guardianId) contexts.add('guardian');
    if (params.invoiceId) contexts.add('invoice');
    return contexts;
  }, [params.studentId, params.guardianId, params.invoiceId]);

  // Global `Ctrl/Cmd+K` (opens the palette) and `?` (opens the
  // shortcuts sheet) — [8.9.9]/[30.4.1]'s "opens from anywhere" ACs.
  // Neither is scoped to a particular element, so both fire regardless
  // of what currently has focus.
  //
  // [8.14.3]: `_staff.tsx` mounts this component twice (desktop top bar,
  // mobile header row) — only one is ever visible at a given viewport
  // width, but both stay mounted, so the `offsetParent` guard below
  // (same reasoning as the old `GlobalSearchLauncher`) makes only the
  // currently-visible instance respond, rather than both firing on
  // every keypress.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (triggerRef.current?.offsetParent === null) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((isOpen) => !isOpen);
        return;
      }
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (
        event.key === '?' &&
        !isTypingTarget &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setShortcutsOpen((isOpen) => !isOpen);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Closing always starts the next open on a blank query — same
  // reasoning as the old launcher.
  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const peopleGroups: GlobalSearchGroup[] = [
    {
      id: 'students',
      label: t('commandPalette.groups.students'),
      isLoading: peopleResults.isLoading,
      results: peopleResults.students.map((student) => {
        const description = [student.class_name, student.section_name].filter(Boolean).join(' – ');
        return {
          id: student.id,
          label: student.full_name,
          ...(description !== '' && { description }),
        };
      }),
    },
    {
      id: 'guardians',
      label: t('commandPalette.groups.guardians'),
      isLoading: peopleResults.isLoading,
      results: peopleResults.guardians.map((guardian) => ({
        id: guardian.id,
        label: guardian.full_name,
        ...(guardian.phone !== null && { description: guardian.phone }),
      })),
    },
    {
      id: 'staff',
      label: t('commandPalette.groups.staff'),
      isLoading: peopleResults.isLoading,
      results: peopleResults.staff.map((staffMember) => ({
        id: staffMember.id,
        label: staffMember.full_name,
        description: staffMember.employee_id,
      })),
    },
    {
      id: 'invoices',
      label: t('commandPalette.groups.invoices'),
      isLoading: peopleResults.isLoading,
      results: peopleResults.invoices.map((invoice) => ({
        id: invoice.id,
        label: invoice.invoice_number,
        ...(invoice.student_name !== null && { description: invoice.student_name }),
      })),
    },
    {
      id: 'payments',
      label: t('commandPalette.groups.payments'),
      isLoading: peopleResults.isLoading,
      results: peopleResults.payments.map((payment) => ({
        id: payment.id,
        label: payment.transaction_reference ?? t('commandPalette.receiptFallbackLabel'),
        ...(payment.student_name !== null && { description: payment.student_name }),
      })),
    },
  ];

  // Page tab — [30.1.4]'s `STAFF_NAV_GROUPS`, flattened (items +
  // pinnedItems), filtered by the item's own declared permission, then
  // matched against the query on the item's *currently rendered*
  // locale label plus its `synonyms`. Only searched once `query` is
  // non-empty — `CommandPalette` itself renders the searchable hint for
  // an empty query on this tab, so an empty `results` array here is
  // never shown.
  const trimmedQuery = query.trim().toLowerCase();
  const pageResults = React.useMemo(() => {
    if (trimmedQuery === '') return [];
    const seen = new Set<string>();
    const items: StaffNavItemDef[] = [];
    for (const group of STAFF_NAV_GROUPS) {
      for (const item of [...group.items, ...(group.pinnedItems ?? [])]) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    }
    return items
      .filter((item) => item.permission === undefined || hasPermission(activeRole, item.permission))
      .map((item) => ({ item, label: resolveNavLabel(item.label, 'items') }))
      .filter(({ item, label }) => matchesNavSearch(label, item.synonyms, trimmedQuery))
      .map(({ item, label }) => ({ id: item.id, label, description: item.to }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery, activeRole, i18n.language]);

  const pageGroups: GlobalSearchGroup[] = [
    { id: 'pages', label: t('commandPalette.groups.pages'), results: pageResults },
  ];

  // Action tab — `ACTIONS` (30.4.2), filtered by permission and by
  // whether the current route satisfies the action's declared context.
  const actionResults = React.useMemo(() => {
    if (trimmedQuery === '') return [];
    const locale = i18n.language.startsWith('bn') ? 'bn' : 'en';
    return ACTIONS.filter((action) => hasPermission(activeRole, action.permission))
      .filter(
        (action) => !action.context || action.context.some((ctx) => availableContexts.has(ctx)),
      )
      .filter((action) => action.label[locale].toLowerCase().includes(trimmedQuery))
      .map((action) => ({ id: action.id, label: action.label[locale] }));
  }, [trimmedQuery, activeRole, availableContexts, i18n.language]);

  const actionGroups: GlobalSearchGroup[] = [
    { id: 'actions', label: t('commandPalette.groups.actions'), results: actionResults },
  ];

  const tabs: readonly [CommandPaletteTab, CommandPaletteTab, CommandPaletteTab] = [
    {
      id: 'people',
      label: t('commandPalette.tabs.people'),
      groups: peopleGroups,
      searchableHint: t('commandPalette.searchableHint'),
      noResultsText: (searchQuery) => t('commandPalette.noResults', { query: searchQuery }),
    },
    {
      id: 'page',
      label: t('commandPalette.tabs.page'),
      groups: pageGroups,
      searchableHint: t('commandPalette.pageSearchableHint'),
      noResultsText: (searchQuery) => t('commandPalette.noResults', { query: searchQuery }),
    },
    {
      id: 'action',
      label: t('commandPalette.tabs.action'),
      groups: actionGroups,
      searchableHint: t('commandPalette.actionSearchableHint'),
      noResultsText: (searchQuery) => t('commandPalette.noResults', { query: searchQuery }),
    },
  ];

  function handleSelect(tabId: (typeof tabs)[number]['id'], groupId: string, resultId: string) {
    if (tabId === 'people') {
      if (groupId === 'students') {
        void navigate({ to: '/students/$studentId', params: { studentId: resultId } });
      } else if (groupId === 'guardians') {
        void navigate({ to: '/guardians/$guardianId', params: { guardianId: resultId } });
      } else if (groupId === 'invoices') {
        void navigate({ to: '/invoices/$invoiceId', params: { invoiceId: resultId } });
      }
      // 'staff' and 'payments' — no destination page/FK exists yet, see
      // this file's own header comment.
      return;
    }
    if (tabId === 'page') {
      const item = pageResults.find((result) => result.id === resultId);
      if (item?.description) void navigate({ to: item.description });
      return;
    }
    if (tabId === 'action') {
      const action = ACTIONS.find((candidate) => candidate.id === resultId);
      action?.run({ navigate: (opts) => void navigate({ to: opts.to }) });
    }
  }

  return (
    <>
      {/* [8.14.2]: input-shaped launcher, same reasoning as the retired
       * `GlobalSearchLauncher` — see its former header comment for why
       * this collapses to an icon-only square below `md` instead of
       * hiding, and why it stays a single element with a fixed
       * `aria-label` rather than a hidden/shown pair. */}
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={t('commandPalette.buttonLabel')}
        className="inline-flex h-[var(--control-h,2rem)] w-[var(--control-h,2rem)] items-center justify-center gap-2 rounded-md border-input px-0 font-normal text-muted-foreground md:w-56 md:justify-start md:px-2"
      >
        <SearchIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="hidden flex-1 truncate text-start md:inline">
          {t('commandPalette.launcherPlaceholder')}
        </span>
        <span className="hidden shrink-0 text-xs md:inline">
          {t('commandPalette.shortcutHint')}
        </span>
      </Button>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        query={query}
        onQueryChange={setQuery}
        tabs={tabs}
        onSelect={handleSelect}
        aria-label={t('commandPalette.ariaLabel')}
        title={t('commandPalette.title')}
        placeholder={t('commandPalette.placeholder')}
        description={t('commandPalette.description')}
        announceResults={(count) =>
          count === 1
            ? t('commandPalette.resultCount', { count })
            : t('commandPalette.resultCountPlural', { count })
        }
      />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
