/**
 * [8.12.2]'s "you're told a new version is available" surface.
 *
 * Lives outside React on purpose: the only thing that knows a new service
 * worker is waiting is `pwa/register.ts`, which runs at module scope from
 * `main.tsx` and has no component tree to hang state off. The design-
 * system `toast()` (sonner, via `@biddaloy/ui/components`) is callable from
 * anywhere as long as `<Toaster />` is mounted — it is, in `main.tsx` —
 * and the `i18n` singleton (`@biddaloy/ui/i18n`) translates without a
 * hook. Nothing here renders markup of its own.
 *
 * Accessibility comes from the design system rather than from this file:
 * `Toaster` sets `closeButton` (a real focusable "Close toast" button) and
 * sonner's container is already a polite live region. Adding a second live
 * region here would double-announce.
 */
import { toast } from '@biddaloy/ui/components';
import { i18n } from '@biddaloy/ui/i18n';

/**
 * One id for both prompts. `onNeedRefresh` fires once per waiting worker,
 * but a second deploy (or a re-registration) can fire it again, and the
 * "updated in another tab" prompt can follow the first one — a fixed id
 * makes sonner replace the existing toast instead of stacking a pile of
 * identical banners on top of a half-typed fee form.
 */
const UPDATE_TOAST_ID = 'app-update';

/**
 * `duration: Infinity`: the prompt is polite, not urgent. It waits for a
 * decision rather than expiring while the user is mid-payment, and the
 * close button dismisses it without reloading.
 */
export function showUpdatePrompt(onReload: () => void): void {
  toast(i18n.t('update.available'), {
    id: UPDATE_TOAST_ID,
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: i18n.t('update.reload'),
      onClick: onReload,
    },
  });
}

/**
 * Shown in the tabs that did *not* accept, once another tab's acceptance
 * activated the new worker. `sw.ts` calls `clientsClaim()`, so this tab is
 * now running old code under a new worker — reloading is the right move,
 * but only when its own user is ready. Force-reloading here is exactly the
 * "interrupts a payment mid-entry" failure the issue rules out.
 */
export function showUpdatedElsewherePrompt(onReload: () => void): void {
  toast(i18n.t('update.activatedElsewhere'), {
    id: UPDATE_TOAST_ID,
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: i18n.t('update.reload'),
      onClick: onReload,
    },
  });
}
