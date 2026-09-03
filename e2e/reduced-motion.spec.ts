import { expect, guest, loggedIn, test } from './fixtures/test';
import { makeT } from './i18n';
import { ListShellPage } from './pages/list-shell';

/**
 * [8.13.6] The global `prefers-reduced-motion: reduce` rule in
 * `ui/src/styles/globals.css`, proven the only way it can be: by a browser
 * that actually reports the preference. jsdom never matches a media query
 * from a real stylesheet, and the drift gate can only prove the rule's text
 * exists — neither can prove it takes effect.
 *
 * Every assertion is paired. Each behaviour is measured first WITHOUT the
 * preference, to prove the thing genuinely animates, and only then with it.
 * A one-sided test ("duration is ~0 under reduce") passes just as happily on
 * an element that never animated at all, which is the failure mode this
 * suite exists to rule out — as of this ticket the Radix overlays are in
 * exactly that state (their `animate-in`/`zoom-in-95` classes come from
 * `tw-animate-css`, which is not installed, so they compile to nothing and
 * the overlays snap). They are therefore deliberately not the subject here;
 * [8.13.10] adds the package and re-times them.
 *
 * Subjects, both real product CSS:
 *  - the login page's submit button — the explicit transition property
 *    list from `button.tsx` (spelled out there, not here: Tailwind scans
 *    comment text, so writing the utility inline would compile a junk rule);
 *  - `animate-pulse` — the skeleton's infinite animation, mounted as a probe
 *    so the assertion does not depend on catching a loading state mid-flight.
 *    The class itself is the one `ui/src/components/skeleton.tsx` ships, so
 *    it is compiled into the same stylesheet a user gets.
 *
 * The login page is used because it is reachable signed-out and renders a
 * real button; heading text is Bangla (DEFAULT_LOCALE — see e2e/config.ts).
 */

const PULSE_PROBE_ID = 'reduced-motion-pulse-probe';

/** Computed timing values serialise per-property (`"0.15s, 0.15s"`) and in
 * seconds. Return the longest, in milliseconds, so a single number can be
 * compared regardless of how many properties transition. */
function longestMs(computed: string): number {
  return Math.max(
    ...computed.split(',').map((part) => {
      const value = part.trim();
      const seconds = value.endsWith('ms')
        ? Number.parseFloat(value) / 1000
        : Number.parseFloat(value);
      return Number.isFinite(seconds) ? seconds * 1000 : 0;
    }),
  );
}

async function mountPulseProbe(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate((id) => {
    const probe = document.createElement('div');
    probe.id = id;
    // The exact class ui/src/components/skeleton.tsx renders.
    probe.className = 'animate-pulse rounded-md bg-muted';
    document.body.append(probe);
  }, PULSE_PROBE_ID);
}

/**
 * Does a transition still FIRE under the reduced-motion rule?
 *
 * The distinction the rule turns on is `0.01ms` versus `0s`: at `0s` the
 * browser skips the transition entirely and never dispatches `transitionend`,
 * so anything awaiting that event hangs forever. At `0.01ms` the transition
 * runs, lands its end state, and dispatches the event within a frame.
 *
 * Reading the computed duration back and asserting `> 0` looks like it tests
 * the same thing but does not: `getComputedStyle` returns a serialised
 * seconds string, `0.01ms` is `0.00001s`, and how an engine rounds that for
 * serialisation is not specified. `E2E_BROWSERS` is explicitly designed to be
 * widened through `E2E_BROWSERS_JSON` with no code edit, so the first engine
 * that serialises `"0s"` would fail this suite while the rule works
 * perfectly. Awaiting the event tests the property that actually matters and
 * is engine-independent.
 *
 * The probe carries its transition as an inline style, which also re-proves
 * that the rule's `!important` outranks an inline declaration.
 */
async function transitionEndFires(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(async () => {
    const probe = document.createElement('div');
    probe.style.transitionProperty = 'opacity';
    probe.style.transitionDuration = '2s';
    probe.style.opacity = '1';
    document.body.append(probe);

    // Flush style so the change below is a transition from a settled value,
    // not part of the element's initial style resolution (which never
    // transitions).
    void getComputedStyle(probe).opacity;

    const fired = new Promise<boolean>((resolve) => {
      probe.addEventListener('transitionend', () => resolve(true), { once: true });
      // Comfortably longer than 0.01ms and shorter than the 2s the inline
      // style asks for, so a rule that failed to apply reads as `false`
      // rather than as a timeout.
      setTimeout(() => resolve(false), 1000);
    });
    probe.style.opacity = '0';
    return fired;
  });
}

async function timings(page: import('@playwright/test').Page) {
  const button = page.getByRole('button', { name: 'লগ ইন' });
  await expect(button).toBeVisible();
  await mountPulseProbe(page);

  const transitionDuration = await button.evaluate((el) => getComputedStyle(el).transitionDuration);
  const probe = page.locator(`#${PULSE_PROBE_ID}`);
  const animationDuration = await probe.evaluate((el) => getComputedStyle(el).animationDuration);
  const iterationCount = await probe.evaluate((el) => getComputedStyle(el).animationIterationCount);

  return {
    transitionMs: longestMs(transitionDuration),
    animationMs: longestMs(animationDuration),
    iterationCount,
  };
}

test.describe('global prefers-reduced-motion rule', () => {
  test.use(guest);

  test('animates normally with no motion preference, and stops under reduce', async ({ page }) => {
    // --- Baseline. Without this half the assertions below are vacuous.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/login');
    const normal = await timings(page);

    expect(normal.transitionMs).toBeGreaterThanOrEqual(100);
    expect(normal.animationMs).toBeGreaterThanOrEqual(100);
    expect(normal.iterationCount).toBe('infinite');

    // --- Same page, same elements, preference on.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    const reduced = await timings(page);

    expect(reduced.transitionMs).toBeLessThan(1);
    expect(reduced.animationMs).toBeLessThan(1);
    // What stops an infinite spinner becoming a 0.01ms strobe.
    expect(reduced.iterationCount).toBe('1');

    // The point of 0.01ms rather than 0: the transition still RUNS, so it
    // still lands its end state and `transitionend` still fires, and code
    // that awaits that event does not hang. That is a behaviour, so assert
    // the behaviour — see the note on `transitionEndFires` for why reading
    // the computed sub-millisecond string back is not a sound way to prove it.
    expect(await transitionEndFires(page)).toBe(true);
  });

  test('the rule is global — it reaches an element no component opted in', async ({ page }) => {
    // The contract's §7 decision is "one global rule, not per-component
    // `motion-reduce:` variants". An arbitrary element with a hand-written
    // inline animation — nothing to do with the design system — proves the
    // universal selector really is universal, and that the `!important`
    // beats even an inline style.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');

    const inlineAnimated = await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.animation = 'spin 2s linear infinite';
      el.style.transition = 'opacity 2s linear';
      document.body.append(el);
      const computed = getComputedStyle(el);
      return {
        animationDuration: computed.animationDuration,
        transitionDuration: computed.transitionDuration,
        iterationCount: computed.animationIterationCount,
      };
    });

    expect(longestMs(inlineAnimated.animationDuration)).toBeLessThan(1);
    expect(longestMs(inlineAnimated.transitionDuration)).toBeLessThan(1);
    expect(inlineAnimated.iterationCount).toBe('1');
  });
});

/**
 * [8.13.10] The Radix overlays this ticket brings to life with
 * `tw-animate-css` (see the file header) must obey the same global rule as
 * everything above, not just re-time under normal conditions. A real
 * dialog rather than a synthetic probe: `DialogContent` carries
 * `animate-in fade-in-0 zoom-in-95 ... duration-(--motion-duration-slow)`
 * verbatim (`ui/src/primitives/dialog.tsx`), so its `animationDuration`
 * either resolves to the contract's 240ms or, under reduce, to the global
 * rule's `0.01ms !important` — same paired-assertion shape as `timings()`
 * above, just read off a component instead of a hand-mounted probe.
 *
 * The create-fee-structure dialog is reused rather than a bespoke fixture:
 * `e2e/a11y/overlay-openers.ts` already opens it this exact way for the a11y
 * suite, so this is the same reachable overlay, not a new one.
 */
test.describe('overlay open animation obeys the reduced-motion rule', () => {
  test.use(loggedIn('accountant'));

  test('a real dialog animates normally, and settles instantly under reduce', async ({ page }) => {
    const t = makeT();

    async function openDialogAndReadAnimationMs(): Promise<number> {
      await page.goto('/fee-structures');
      const list = new ListShellPage(page, { titleKey: 'feeStructures.list.title' });
      await list.expectLoaded();
      await page.getByRole('button', { name: t('feeStructures.list.addStructure') }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      return longestMs(await dialog.evaluate((el) => getComputedStyle(el).animationDuration));
    }

    // --- Baseline. Without this the reduced assertion below is vacuous.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await openDialogAndReadAnimationMs()).toBeGreaterThanOrEqual(100);

    // --- Same dialog, preference on.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await openDialogAndReadAnimationMs()).toBeLessThan(1);
  });
});

/**
 * [8.14.5] — the route cross-fade's own reduced-motion pair. Guarded on
 * `document.startViewTransition` actually existing: `E2E_BROWSERS` can
 * widen this suite onto engines without the View Transitions API, where
 * `defaultViewTransition: true` (`client-admin/src/main.tsx`) is simply a
 * no-op and there is nothing here to measure either way.
 */
test.describe('route cross-fade obeys the reduced-motion rule', () => {
  test.use(loggedIn('admin'));

  test('#main-content cross-fades normally, and settles instantly under reduce', async ({
    page,
  }) => {
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: 'শিক্ষার্থী' })).toBeVisible();

    const supportsViewTransitions = await page.evaluate(
      () => typeof document.startViewTransition === 'function',
    );
    test.skip(!supportsViewTransitions, 'browser has no View Transitions API to measure');

    async function navigateAndReadTransitionMs(): Promise<number> {
      await page.goto('/students');
      await expect(page.getByRole('heading', { name: 'শিক্ষার্থী' })).toBeVisible();
      await page.getByRole('link', { name: 'অভিভাবক', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'অভিভাবক' })).toBeVisible();
      return page.evaluate(() =>
        Math.max(
          0,
          ...document
            .getAnimations()
            .filter((animation) => {
              const effect = animation.effect as KeyframeEffect | null;
              return effect?.pseudoElement?.startsWith('::view-transition') ?? false;
            })
            .map((animation) => {
              const timing = animation.effect?.getComputedTiming();
              return typeof timing?.duration === 'number' ? timing.duration : 0;
            }),
        ),
      );
    }

    // --- Baseline. Without this the reduced assertion below is vacuous.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await navigateAndReadTransitionMs()).toBeGreaterThan(0);

    // --- Same navigation, preference on — globals.css's dedicated
    // `::view-transition-*` reduced-motion block (see that file's own
    // comment for why the blanket `*, *::before, *::after` rule can't
    // reach these pseudo-elements) collapses it to near-zero.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await navigateAndReadTransitionMs()).toBeLessThan(1);
  });
});

/**
 * [8.14.12] Toast enter/exit motion is bound in `globals.css` via
 * `[data-sonner-toaster] [data-sonner-toast][data-styled='true']`, a 0-3-0
 * selector chosen specifically to beat `sonner`'s own injected stylesheet
 * regardless of `<head>` insertion order (see that block's own comment).
 * That selector can't be proven live any other way: jsdom never resolves a
 * specificity contest between two real stylesheets, and the compiled-CSS
 * gate (`check-contrast.mjs`) can only prove the rule's text exists, not
 * that it wins at runtime against sonner's rule.
 *
 * `sonner` is mounted app-wide (`client-admin/src/main.tsx`'s `<Toaster />`),
 * so its stylesheet is already in `<head>` on any page — this suite reuses
 * the synthetic-probe technique `mountPulseProbe` established above rather
 * than driving a real toast through the app, because the two attributes
 * this rule keys off (`data-mounted`, `data-removed`) are a snapshot of a
 * transient state a real toast only occupies for one animation frame.
 *
 * The reduced-motion half proves plan correction #2, not a mistake: this
 * rule is NOT expected to win under `prefers-reduced-motion`. Sonner ships
 * its own `@media (prefers-reduced-motion)` rule that sets
 * `transition: none !important` on `[data-sonner-toast]` — a 0-1-0
 * selector that already beats this file's 0-3-0 one for the
 * `transition-duration` longhand specifically because sonner's rule wins
 * the whole `transition` shorthand outright, stopping it rather than
 * shrinking it to the global blanket rule's `0.01ms`. That's stricter,
 * not a bug — see the CSS block's own comment for why toasts don't need
 * the `transitionend` safety net that rule exists for.
 */
test.describe("[8.14.12] toast enter/exit motion, and sonner's own reduced-motion rule", () => {
  test.use(guest);

  async function opacityTransitionMs(page: import('@playwright/test').Page): Promise<number> {
    const duration = await page.evaluate(() => {
      const toaster = document.createElement('div');
      toaster.setAttribute('data-sonner-toaster', '');
      const toastEl = document.createElement('div');
      toastEl.setAttribute('data-sonner-toast', '');
      toastEl.setAttribute('data-styled', 'true');
      toastEl.setAttribute('data-mounted', 'true');
      toaster.append(toastEl);
      document.body.append(toaster);
      const value = getComputedStyle(toastEl).transitionDuration;
      toaster.remove();
      return value;
    });
    return longestMs(duration);
  }

  test("enter transition binds --motion-duration-slow, and sonner's own rule (not ours) stops it under reduce", async ({
    page,
  }) => {
    await page.goto('/login');

    // --- Baseline. Without this the reduced assertion below is vacuous.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await opacityTransitionMs(page)).toBeGreaterThanOrEqual(200);

    // --- Same probe shape, preference on. Sonner's own rule wins outright
    // (`transition: none`), which computes back as `0s` — unlike the
    // global blanket rule's deliberate `0.01ms`, because toasts don't rely
    // on `transitionend` to advance any state machine (see block comment).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await opacityTransitionMs(page)).toBe(0);
  });
});
