import { Button } from '@biddaloy/ui/components';
import type { MaskedSecret } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

/**
 * The one place #8.7.13's "credentials are write-only" contract becomes
 * UI: a secret never renders as a value, only as *state* — "Configured —
 * ends 4821" — with Replace/Clear actions, exactly the issue's own
 * acceptance criterion. There is deliberately no way to reveal the
 * plaintext here, because the API never sends it back to reveal.
 *
 * `value` mirrors the three states a PATCH body can express for a secret
 * field (see `tenant-settings.dto.ts`'s own comment on the same contract):
 * - `undefined` — unchanged, omitted from the save entirely.
 * - `null` — explicitly cleared.
 * - a string (possibly empty while mid-edit) — a fresh plaintext value
 *   about to be encrypted.
 *
 * Not wired through `FormField`/`FormControl` like the plain-text fields
 * next to it — `FormControl` merges its `id`/`aria-*` props onto a
 * *single* child element (Radix `Slot`), and this widget's editing state
 * needs to render an input alongside a Cancel button, two elements. It
 * manages its own `id`/`<label htmlFor>` pairing directly instead; a
 * parent section keeps this field's value in local `useState` rather than
 * under `react-hook-form` for the same reason (see e.g.
 * `WhatsAppSection.tsx`).
 *
 * Clicking "Replace"/"Set" switches straight to editing (no separate
 * "reveal" step, since there's nothing to reveal); "Cancel" reverts to
 * `undefined` — the caller doesn't need to remember to reset it. The
 * connection-test flow reads the same `value` a save would submit, so
 * typing a replacement and clicking "Test connection" (before saving)
 * tests exactly the value that would be saved.
 */
export interface SecretFieldProps {
  id: string;
  label: string;
  masked: MaskedSecret | undefined;
  value: string | null | undefined;
  onChange: (value: string | null | undefined) => void;
  onBlur?: () => void;
}

export function SecretField({ id, label, masked, value, onChange, onBlur }: SecretFieldProps) {
  const { t } = useTranslation('settings');
  const isEditing = typeof value === 'string';
  const isCleared = value === null;

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {isEditing ? (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="password"
            autoComplete="new-password"
            className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
            {t('secret.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm text-muted-foreground">
            {isCleared || !masked?.configured
              ? t('secret.notConfigured')
              : t('secret.configured', { hint: masked.hint })}
          </span>
          {/* No `id` here — this button shares `label`'s `htmlFor={id}`
              with the editing-mode `<input>` below, and a <label for> on
              a <button> replaces its accessible name with the label's
              text instead of its own ("Access token" instead of
              "Replace"). The input picks the id back up once editing
              starts; this button's own visible text is its name. */}
          <Button type="button" variant="outline" size="sm" onClick={() => onChange('')}>
            {isCleared || !masked?.configured ? t('secret.set') : t('secret.replace')}
          </Button>
          {!isCleared && masked?.configured && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              {t('secret.clear')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
