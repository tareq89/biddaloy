import { expect, guest, test } from './fixtures/test';

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
