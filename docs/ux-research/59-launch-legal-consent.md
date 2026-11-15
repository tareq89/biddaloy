# Epic 59.0 — legal consent: mockups and usability test plan

Ticket #3943. Decisions D7, D11, D26, D27, D31 (epic #1743).

**Status.** Mockups: done (10 screens, desktop 1440 px + phone 390 px). Usability test: **not run yet**.
Per D1 this ticket ships the mockups, the glossary and the test script. Running the test with two
real office staff is an owner to-do (below). Screen tickets 59.3.01–59.3.03 can start from these
mockups; if the test changes a mockup, the owner updates this page.

```mermaid
flowchart LR
  A[Mockups built from the kit] --> B[Owner runs T1-T3 with 2 office staff]
  B -->|all pass unaided, 2 min each| C[Post final screenshots on 59.3.01-03]
  B -->|any task fails| D[Fix the mockup, re-test]
  D --> B
```

## Owner to-do (not done by the agent)

- [ ] Recruit two school office staff. Record **first names or initials only**, never contacts.
- [ ] Run T1, T2, T3 below on the mockups in `assets/59/`. Write the results in the table.
- [ ] If a mockup changes, replace its two PNGs here and re-run the task it affects.
- [ ] Confirm or amend the glossary. A change is also commented on #1743.
- [ ] Upload the final desktop and phone PNGs as comments on 59.3.01, 59.3.02 and 59.3.03 (uploaded images, never scratch paths).

## The job of each screen

| # | Screen | Job in one sentence | Files |
|---|---|---|---|
| 1 | Sign-up form | A new school admin agrees to the terms in one tap after reading them | `01-signup` |
| 2 | Terms dialog | They read the three documents and agree in one tap (phone: full-height sheet) | `02-terms-dialog` |
| 3 | `/legal/terms` | Anyone reads the terms on a public page | `03-legal-terms` |
| 4 | `/legal/accept` | A signed-in admin accepts changed terms before going on | `04-legal-accept` |
| 5 | Student Overview, consent row | Office sees a student's photo consent and changes it in two taps | `05-student-overview` |
| 6 | Student form, consent Select | Office records the consent from a paper form | `06-student-form` |
| 7 | REFUSED confirm | Office knows setting "দেননি" deletes the stored photo before it happens | `07-refused-confirm` |
| 8 | `/students` filter and empty state | Office finds students whose photo consent was not taken | `08-students-filter` |
| 9 | Admission form radio group | A parent chooses photo consent when applying | `09-admission-form` |
| 10 | Bulk-photo skip message | Office sees which photos were skipped and why | `10-bulk-photo-skip` |

Every image is `assets/59/<file>-desktop.png` and `assets/59/<file>-mobile.png`.

| | Desktop 1440 px | Phone 390 px |
|---|---|---|
| 1 Sign-up | ![](assets/59/01-signup-desktop.png) | ![](assets/59/01-signup-mobile.png) |
| 2 Terms dialog | ![](assets/59/02-terms-dialog-desktop.png) | ![](assets/59/02-terms-dialog-mobile.png) |
| 3 /legal/terms | ![](assets/59/03-legal-terms-desktop.png) | ![](assets/59/03-legal-terms-mobile.png) |
| 4 /legal/accept | ![](assets/59/04-legal-accept-desktop.png) | ![](assets/59/04-legal-accept-mobile.png) |
| 5 Overview row | ![](assets/59/05-student-overview-desktop.png) | ![](assets/59/05-student-overview-mobile.png) |
| 6 Student form | ![](assets/59/06-student-form-desktop.png) | ![](assets/59/06-student-form-mobile.png) |
| 7 REFUSED confirm | ![](assets/59/07-refused-confirm-desktop.png) | ![](assets/59/07-refused-confirm-mobile.png) |
| 8 Students filter | ![](assets/59/08-students-filter-desktop.png) | ![](assets/59/08-students-filter-mobile.png) |
| 9 Admission radios | ![](assets/59/09-admission-form-desktop.png) | ![](assets/59/09-admission-form-mobile.png) |
| 10 Bulk-photo skip | ![](assets/59/10-bulk-photo-skip-desktop.png) | ![](assets/59/10-bulk-photo-skip-mobile.png) |

## Usability tasks (script)

Say the task aloud in Bangla, hand over the mockup (open the image or the clickable page), say
nothing else. Start the timer when they start. **Pass** = done unaided, in 2 minutes or less.
Note every hesitation, wrong tap and question.

| Task | Say | Starts on | Success looks like |
|---|---|---|---|
| T1 | "সাইন আপ করুন, আগে শর্ত পড়ে নিন" | Screen 1 | Opens the terms from the link (screen 2), reads, agrees, ends with the box ticked |
| T2 | "এই কাগজের ফর্মে লেখা ছবি রাখা যাবে না — সেটা লিখে রাখুন" | Screen 5 | Reaches the consent field (screen 5 "পরিবর্তন" or screen 6), picks "দেননি", sees and understands the confirm (screen 7) |
| T3 | "কোন ছাত্রদের ছবির সম্মতি নেওয়া হয়নি খুঁজুন" | Screen 8 without the filter | Finds the "ছবির সম্মতি" filter, applies it, reads the result |

### Results (owner fills in)

| Participant (first name / initials) | T1 pass? | T1 time | T2 pass? | T2 time | T3 pass? | T3 time | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
| | | | | | | | |

### Findings and mockup changes (owner fills in)

_None yet. Write each problem as: what the person did, what we changed, which screen._

## Design choices taken while building (so the test checks them)

- **Terms dialog has three tabs** (শর্তাবলি, গোপনীয়তা নীতি, তথ্য চুক্তি). The সেবার মান চুক্তি is a numbered section inside শর্তাবলি, because the epic says three tabs and the glossary lists four documents. Test point: does anyone look for it in its own tab?
- **One filled button per view.** Red appears only on the REFUSED confirm (the kit's rule for destructive confirms).
- **Phone dialog is a full-height sheet** (epic state rule). Desktop is a centred dialog.
- **Consent badges** reuse the status tones: দিয়েছেন (paid/green), দেননি (overdue/red), জানা নেই (partial/amber), with an icon so colour is not the only signal.
- **Checkbox with links** copies the kit pattern: the box is its own 44 px target and the links sit in the sentence (so the 22 px link height on phone is allowed).
- **Empty filter message** is the epic's text: "সবার ছবির সম্মতি নেওয়া আছে".
- **Bulk-photo skip** lists who was skipped and why, with one link to the same `/students` filter (task T3 path).
- Mockups use sample names and numbers only (no real people).

## Glossary (from the epic, unchanged so far)

| Bangla | English | Never say on screen |
|---|---|---|
| শর্তাবলি | Terms | ToS |
| গোপনীয়তা নীতি | Privacy policy | — |
| তথ্য চুক্তি | Data agreement | DPA |
| সেবার মান চুক্তি | Service agreement | SLA |
| ছবির সম্মতি | Photo consent | consent status |
| দিয়েছেন / দেননি / জানা নেই | Given / Refused / Not recorded | GIVEN / REFUSED / UNKNOWN |

Checked: no mockup shows a "never say" term.

## How these were made

`.claude/skills/redesign-page/` steps 3–5: the kit starters (`starter.html`, `starter-guest.html`),
patterns copied from `patterns.html`, shot with `scripts/shoot.mjs` against the app's real
`globals.css`. Shoot report for every screen: no sideways scroll, one `<h1>`, no unlabeled control,
no script error; the only small phone targets are links inside a sentence.
