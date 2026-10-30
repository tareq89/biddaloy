# Epic 84 arrival screens: built UI vs mockup (EXPERT REVIEW)

**This is an expert review by the implementing agent, NOT a usability test.**
Ticket #3150 (84.0.1) still needs real participants (guardians with and without
the app, class teachers, office staff). Nothing here counts as its results.

Screens are the built app (bn locale, light theme, seeded e2e school), shot with
Playwright at 1440 px and 390 px. Files are in [`epic-84-built/`](epic-84-built/);
the design targets are in [`epic-84-mockups/`](epic-84-mockups/).

Capture notes: the 390 px images are full-page, so the fixed bottom tab bar
appears in the middle of tall pages. That is a capture artifact, not a bug.
Taken on a Friday, so the portal calendar shows "not a school day" for today.

| Screen | 1440 | 390 |
| --- | --- | --- |
| Portal card | `portal-card-1440.png` | `portal-card-390.png` |
| My class card | `my-class-card-1440.png` | `my-class-card-390.png` |
| Add yourself dialog | `my-class-add-dialog-1440.png` | `my-class-add-dialog-390.png` |
| Guardians cell | `guardians-tab-1440.png` | `guardians-tab-390.png` |
| Lock menu (open) | `guardians-lock-menu-1440.png` | `guardians-lock-menu-390.png` |
| Settings switches | `settings-switches-1440.png` | `settings-switches-390.png` |

## Heuristic findings (Nielsen)

| # | Screen | Heuristic | Finding | Severity (0-4) |
| --- | --- | --- | --- | --- |
| 1 | Add yourself dialog, 390 | Visibility of system status; flexibility | Unconfirmed, pending manual check: the "Every day" option appears cut off below "Once". This capture records no app revision or viewport height; the self-walkthrough (`7714da214`, 390 x 844) measured the text fully visible with only the card border overlapped by about 4 px. Not an established clipping finding. | 1 |
| 2 | Add yourself dialog, 390 | Consistency | Footer buttons stack full width with the primary "Add" disabled-looking and above "Cancel"; fine, but the dialog leaves a large empty strip below Cancel. | 1 |
| 3 | Guardians cell, 390 | Recognition over recall | The menu trigger is a bare 3-dot icon beside the channel word ("App") with no visible label; it is the only way to set the lock. | 2 |
| 4 | Guardians cell, 390 | Aesthetic and minimalist design | Status badge, channel, date-changed line and menu share one narrow column; the row reads dense. | 2 |
| 5 | Lock menu | Error prevention | Items "Always" and "Never" sit directly under "Stop" in one list; the only separator is one rule. Destructive-ish locks are not marked. | 2 |
| 6 | Lock menu, 390 | Consistency | A disabled item ("Clear lock") wraps to two lines; fine, but contrast of the disabled item is low. | 1 |
| 7 | Settings switches | Match with real world | The SMS switch caption mentions school SMS credit cost, good; but it sits under "Send arrival notices" with no visual indent to show it depends on it. | 2 |
| 8 | Portal card, 390 | Visibility of system status | "Waiting for the teacher" badge and the Ask switch sit on one row with the child name; long names will wrap the badge. | 2 |
| 9 | My class card | Consistency with mockup | Row layout (name, guardian, channel, mode badge, edit, remove) matches the mockup; the icon-only edit and remove actions rely on tooltips/labels not visible in a still image. | 1 |

Severity: 0 none, 1 cosmetic, 2 minor, 3 major, 4 blocker.

## Not covered

- Real users (see top). Mockup comparison was visual only, by one reviewer.
- Dark theme, `en` locale and the 320 px reflow are covered by the automated
  sweeps, not by these pictures.
- Finding 1 should be checked by hand in a real phone browser before it is
  filed as a bug: the clipping may be the screenshot's viewport height, not the app.
