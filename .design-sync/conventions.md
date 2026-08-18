## Wrapping and setup

Most components render correctly standalone. One exception: anything using
`useTranslation()`/`useLocale()` (LocaleSwitcher, most form components'
built-in copy) needs to be inside `I18nProvider`:

```jsx
<I18nProvider>
  <YourLayout />
</I18nProvider>
```

Without it, translated content suspends indefinitely instead of rendering.
No other provider is required for anything in this library — none of the
synced components read from `QueryClientProvider` or a router context
directly; they're presentational, driven entirely by props.

## Styling idiom

Tailwind utility classes, using this design system's own semantic layer —
never a raw hex value, never Tailwind's own default palette (`bg-blue-600`,
`text-gray-500`, etc. don't exist here):

| Class                                        | Use for                                     |
| -------------------------------------------- | ------------------------------------------- |
| `bg-primary` / `text-primary-foreground`     | Primary actions (buttons, active nav items) |
| `bg-secondary` / `text-secondary-foreground` | Secondary surfaces and actions              |
| `bg-muted` / `text-muted-foreground`         | De-emphasized text, subtle backgrounds      |
| `bg-destructive` / `text-destructive`        | Destructive actions, error text             |
| `bg-background` / `text-foreground`          | Page/card background and primary text       |
| `border-border` / `border-input`             | Default borders, form field borders         |
| `ring-ring`                                  | Focus rings                                 |

A second, narrower vocabulary exists specifically for fee/payment/invoice
status pills (`StatusBadge`) — five tones, each pairing a color with a
distinct icon shape so status is never conveyed by color alone:

| Tone    | Classes                                       | Meaning                    |
| ------- | --------------------------------------------- | -------------------------- |
| success | `text-status-paid-fg bg-status-paid-bg`       | Paid, delivered, completed |
| info    | `text-status-partial-fg bg-status-partial-bg` | Partially complete         |
| warning | `text-status-due-fg bg-status-due-bg`         | Due, pending               |
| danger  | `text-status-overdue-fg bg-status-overdue-bg` | Overdue, failed            |
| neutral | `text-muted-foreground bg-muted`              | Draft, cancelled, inactive |

Border radius: `rounded-md` for controls (buttons, inputs, badges),
`rounded-lg` for containers (cards, panels), `rounded-full` for pills and
avatars. No custom typeface — Tailwind's default system-font stack, used
as-is throughout.

## Where the truth lives

`styles.css` (this bundle) is the compiled stylesheet every class above
resolves against — read it directly rather than guessing whether a class
exists. Each component's own `.prompt.md` documents its specific props and
usage; `.d.ts` is the authoritative prop contract.

## Example

```jsx
import { FeeStatus } from '@biddaloy/shared';

<div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium text-foreground">Rahim Uddin</span>
    <StatusBadge domain="fee" status={FeeStatus.PAID} />
  </div>
  <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80">
    Record payment
  </button>
</div>;
```
