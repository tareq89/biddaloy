import { Permission } from '@biddaloy/shared';

/**
 * [30.4.2] The command-palette action registry.
 *
 * Lives beside `route-permissions.ts` / `route-loaders.ts`, not in `ui/` —
 * `ui/` only holds the *types* the palette component renders; the actual
 * seed data belongs here because `run()` is a router navigation, and the
 * router is `client-admin`-owned (the palette contract keeps `ui/` route
 * agnostic, D12).
 *
 * ## The rule this file enforces
 *
 * An action becomes reachable from the palette **only** by being listed
 * here — never by scanning routes at runtime. Every entry's `permission`
 * must be the *exact* permission the corresponding route (or the nav item
 * that already links to it) is gated on in `route-permissions.ts` — the
 * palette must never grant a shortcut to something the sidebar wouldn't
 * already show. Do not widen access to add an entry.
 *
 * ## Why only ~7 seeded, not ~12
 *
 * The ticket named 12 candidate actions. Five of them — invite/add a
 * staff member, reset a user's password, add/edit a class, edit a fee
 * structure, switch school/role, toggle theme/language — do not have a
 * *standalone route* that mounts their dialog on its own (the dialog is
 * local `useState` on a list page, e.g. `staff/-add-user-dialog.tsx`), or
 * (switch school / toggle theme) are self-contained shell widgets with no
 * imperative open function to call. Wiring either requires a query-param
 * "open on mount" contract on files outside this ticket's territory
 * (`staff/index.tsx`, `classes/index.tsx`, …) or new hook plumbing in
 * `ui/src/components` — both out of scope for this ticket. They stay in
 * `UNREGISTERED_ACTIONS` (`owningEpic: '31.0'`, the retrofit epic) rather
 * than being faked here.
 *
 * ## Delete-your-lines protocol
 *
 * If you delete or rename a route this file points at, delete (or fix)
 * the matching entry in the same commit — a dangling `run()` target is a
 * silent 404 from the palette, not a compile error `tsc` would catch.
 */

/** The entity kinds a palette action may be scoped to. */
export type ActionContext = 'student' | 'guardian' | 'invoice' | 'gradingScale';

/** How the palette presents the action once triggered. */
export type ActionKind = 'modal' | 'navigate' | 'inline';

/** What `run()` receives — currently just a TanStack Router navigate. */
export interface ActionRunContext {
  readonly navigate: (opts: { readonly to: string }) => void;
}

export interface PaletteAction {
  readonly id: string;
  readonly label: { readonly en: string; readonly bn: string };
  readonly permission: Permission;
  readonly kind: ActionKind;
  readonly context?: readonly ActionContext[];
  readonly run: (ctx: ActionRunContext) => void;
}

/**
 * Seed actions, drawn from dialogs that already have a dedicated route
 * (so `run()` can reuse the page's own component by navigating to it,
 * per U7 — never a second copy of the form). Each `permission` is copied
 * verbatim from `route-permissions.ts`'s entry for the same route.
 */
export const ACTIONS: readonly PaletteAction[] = [
  {
    id: 'payments.record',
    label: { en: 'Record payment', bn: 'পেমেন্ট রেকর্ড করুন' },
    permission: Permission.PAYMENT_RECORD,
    kind: 'modal',
    context: ['student', 'invoice'],
    run: (ctx) => ctx.navigate({ to: '/payments/record' }),
  },
  {
    id: 'communications.sendMessage',
    label: { en: 'Send message', bn: 'বার্তা পাঠান' },
    permission: Permission.COMMUNICATION_SEND,
    kind: 'navigate',
    context: ['student', 'guardian'],
    run: (ctx) => ctx.navigate({ to: '/communications/send' }),
  },
  {
    id: 'communications.sendFeeReminder',
    label: { en: 'Send fee reminder', bn: 'ফি রিমাইন্ডার পাঠান' },
    permission: Permission.COMMUNICATION_BULK_SEND,
    kind: 'navigate',
    run: (ctx) => ctx.navigate({ to: '/communications/reminders' }),
  },
  {
    id: 'attendance.take',
    label: { en: 'Take attendance', bn: 'হাজিরা নিন' },
    permission: Permission.ATTENDANCE_READ,
    kind: 'navigate',
    run: (ctx) => ctx.navigate({ to: '/attendance' }),
  },
  {
    id: 'fees.generate',
    label: { en: 'Generate fees', bn: 'ফি তৈরি করুন' },
    permission: Permission.FEE_GENERATE,
    kind: 'modal',
    run: (ctx) => ctx.navigate({ to: '/fees/generate' }),
  },
  {
    id: 'students.add',
    label: { en: 'Add student', bn: 'শিক্ষার্থী যোগ করুন' },
    permission: Permission.STUDENT_CREATE,
    kind: 'modal',
    run: (ctx) => ctx.navigate({ to: '/students/new' }),
  },
  {
    id: 'students.import',
    label: { en: 'Import students', bn: 'শিক্ষার্থী আমদানি করুন' },
    permission: Permission.STUDENT_BULK_UPLOAD,
    kind: 'navigate',
    run: (ctx) => ctx.navigate({ to: '/students/import' }),
  },
  {
    id: 'grading.copyScale',
    label: { en: 'Copy grading scale', bn: 'গ্রেডিং স্কেল কপি করুন' },
    permission: Permission.GRADING_SCALE_MANAGE,
    kind: 'modal',
    context: ['gradingScale'],
    // `ActionRunContext` carries no entity id ([31.0]'s own retrofit
    // territory, not this ticket's) — lands on the scales list instead of
    // a specific scale's editor; its own Copy button opens
    // `-copy-scale-dialog.tsx` from there (U7: reuse the page, never a
    // second copy of the dialog).
    run: (ctx) => ctx.navigate({ to: '/grading-scales' }),
  },
  /**
   * [21.9.1] `run()` only carries `navigate({ to })` — there is no way to
   * pass the slot/date "context" the ticket names, or to auto-open a
   * dialog remotely. Both land the caller on the page that has it, one
   * click away, the same limitation this file's own header comment
   * already documents for the five actions in `UNREGISTERED_ACTIONS`
   * (flagged here rather than silently pretending it's context-aware).
   */
  {
    id: 'routines.openMyRoutine',
    label: { en: 'Open my routine', bn: 'আমার রুটিন খুলুন' },
    permission: Permission.ROUTINE_READ,
    kind: 'navigate',
    run: (ctx) => ctx.navigate({ to: '/routines/my' }),
  },
  {
    id: 'routines.addSubstitution',
    label: { en: 'Add substitution', bn: 'প্রতিনিধিত্ব যোগ করুন' },
    permission: Permission.ROUTINE_MANAGE,
    kind: 'modal',
    run: (ctx) => ctx.navigate({ to: '/routines/substitutions' }),
  },
  {
    id: 'routines.copyLastYearRoutine',
    label: { en: "Copy last year's routine", bn: 'গত বছরের রুটিন কপি করুন' },
    // The copy button itself is `ROUTINE_MANAGE`-gated inside
    // `review.tsx` — but that route's own blanket gate is `ROUTINE_READ`
    // (a teacher can open it too, to see their own slots), and this
    // file's own rule requires the action's permission to match the
    // *route's* gate, not the narrower in-page control.
    permission: Permission.ROUTINE_READ,
    kind: 'modal',
    run: (ctx) => ctx.navigate({ to: '/routines/review' }),
  },
  {
    id: 'results.enterMarks',
    label: { en: 'Enter marks', bn: 'নম্বর প্রবেশ করান' },
    permission: Permission.MARK_VIEW,
    kind: 'navigate',
    run: (ctx) => ctx.navigate({ to: '/marks' }),
  },
  {
    id: 'results.process',
    label: { en: 'Process result', bn: 'ফলাফল প্রক্রিয়া করুন' },
    permission: Permission.RESULT_PROCESS,
    kind: 'modal',
    // Same "no entity id" pattern as `grading.copyScale` above — lands on
    // the exam picker (`/results`) rather than a specific exam's dialog.
    run: (ctx) => ctx.navigate({ to: '/results' }),
  },
  {
    id: 'results.publish',
    label: { en: 'Publish result', bn: 'ফলাফল প্রকাশ করুন' },
    // Matches `/_staff/results/`'s own gate (`RESULT_PROCESS`), not
    // `RESULT_PUBLISH` — see `route-permissions.ts`'s comment on why the
    // whole route shares one permission.
    permission: Permission.RESULT_PROCESS,
    kind: 'modal',
    run: (ctx) => ctx.navigate({ to: '/results' }),
  },
  {
    id: 'results.sendSms',
    label: { en: 'Send result SMS', bn: 'ফলাফল এসএমএস পাঠান' },
    permission: Permission.RESULT_PROCESS,
    kind: 'modal',
    run: (ctx) => ctx.navigate({ to: '/results' }),
  },
  {
    id: 'analysis.meritList',
    label: { en: 'Analysis: merit list', bn: 'বিশ্লেষণ: মেধা তালিকা' },
    permission: Permission.MARK_VIEW,
    kind: 'navigate',
    // Same "no entity id" pattern as `results.process` above — lands on
    // the exam/section picker rather than a specific exam (the palette's
    // `ActionRunContext` carries no exam id to prefill, D12).
    run: (ctx) => ctx.navigate({ to: '/analysis' }),
  },
  {
    id: 'analysis.defaultedList',
    label: { en: 'Analysis: defaulters', bn: 'বিশ্লেষণ: অকৃতকার্য/অনুপস্থিত' },
    permission: Permission.MARK_VIEW,
    kind: 'navigate',
    run: (ctx) => ctx.navigate({ to: '/analysis' }),
  },
  {
    id: 'exams.copyComponents',
    label: { en: 'Copy exam components', bn: 'পরীক্ষার উপাদান কপি করুন' },
    permission: Permission.EXAM_MANAGE,
    kind: 'modal',
    // The dialog itself (`-copy-components-dialog.tsx`) shipped with
    // #902 on the exam Setup tab; this only registers the palette entry.
    run: (ctx) => ctx.navigate({ to: '/exams' }),
  },
  {
    id: 'homework.assign',
    label: { en: 'Assign homework', bn: 'বাড়ির কাজ দিন' },
    permission: Permission.HOMEWORK_ASSIGN,
    kind: 'modal',
    run: (ctx) => ctx.navigate({ to: '/academics/homework/new' }),
  },
  {
    id: 'homework.import',
    label: { en: 'Upload homework (CSV)', bn: 'বাড়ির কাজ আপলোড করুন (CSV)' },
    permission: Permission.HOMEWORK_IMPORT,
    kind: 'navigate',
    run: (ctx) => ctx.navigate({ to: '/academics/homework/import' }),
  },
  {
    id: 'syllabus.markTopic',
    // Gated on SYLLABUS_READ (must match the target route's own gate, see
    // route-permissions.ts), so the label promises only what a read-only
    // user can actually do here — open the syllabus screen. Mark/edit/
    // reorder controls on that screen are separately gated on
    // SYLLABUS_MANAGE (index.tsx), same as every other inline control.
    label: { en: 'Open syllabus', bn: 'সিলেবাস খুলুন' },
    permission: Permission.SYLLABUS_READ,
    kind: 'inline',
    // No standalone route for one topic's status change — same reasoning
    // this file's header gives for the five actions kept out of
    // `ACTIONS` entirely, except this one DOES have a route to land on:
    // the syllabus list page itself, where status is an inline control
    // per topic (U7: reuse the page, never a second copy of the edit UI).
    run: (ctx) => ctx.navigate({ to: '/academics/syllabus' }),
  },
  {
    id: 'promotions.promote',
    label: { en: 'Promote students', bn: 'শিক্ষার্থী উত্তরণ করুন' },
    permission: Permission.PROMOTION_MANAGE,
    kind: 'navigate',
    // Same "no entity id" pattern as `analysis.meritList` above — lands on
    // the empty new-run form; the user picks the source class there.
    // `/promotions/new?classId=` prefill exists for direct links, but
    // `ActionRunContext` can't supply a class ([31.0]'s retrofit).
    run: (ctx) => ctx.navigate({ to: '/promotions/new' }),
  },
];
